import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmieCallResult, OmieClient } from "../../clients/omie.js";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/omie.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../clients/omie.js")>();
  return { ...actual, getOmieCompanies: vi.fn() };
});

import { getOmieCompanies } from "../../clients/omie.js";
import { contasAPagarHandler } from "./contas-a-pagar.js";

function asCompany(client: OmieClient) {
  return [{ code: "principal", client }];
}
const silentLogger = pino({ level: "silent" });

function makeCtx(): ToolContext {
  return {
    tenant: {
      id: "t_test",
      slug: "test",
      displayName: "Test",
      brand: "cpg_labs",
      shopifyShop: null,
      ssmPrefix: "/nami-works/tenants/test",
      role: "operator",
      principalId: null,
      actorLabel: null,
      access: { isOwner: true, systems: {} },
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

function fakeOmie(responses: Array<OmieCallResult<unknown>>): OmieClient {
  const call = vi.fn(async () => responses.shift() ?? null);
  return { call } as unknown as OmieClient;
}

beforeEach(() => {
  vi.mocked(getOmieCompanies).mockReset();
});

describe("contasAPagarHandler", () => {
  it("aggregates a-pagar / vencido / pago", async () => {
    const client = fakeOmie([
      {
        ok: true,
        data: {
          conta_pagar_cadastro: [
            { codigo_lancamento_omie: 1, numero_documento: "AP-1", data_vencimento: "10/03/2026", valor_documento: 100, status_titulo: "A_PAGAR", observacao: null },
            { codigo_lancamento_omie: 2, numero_documento: "AP-2", data_vencimento: "10/02/2026", valor_documento: 200, status_titulo: "VENCIDO", observacao: null },
            { codigo_lancamento_omie: 3, numero_documento: "AP-3", data_vencimento: "10/01/2026", valor_documento: 300, status_titulo: "PAGO", observacao: null },
            { codigo_lancamento_omie: 4, numero_documento: "AP-4", data_vencimento: "10/09/2026", valor_documento: 50, status_titulo: "A VENCER", observacao: null },
          ],
        },
      },
      { ok: true, data: { categoria_cadastro: [] } }, // ListarCategorias (enrichment)
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await contasAPagarHandler({ codigoFornecedor: 999 }, makeCtx());
    const text = res.content[0]?.text ?? "";
    // "A VENCER" (50) must count as a-pagar, NOT vencido
    expect(text).toContain("A pagar: R$ 150.00");
    expect(text).toContain("Vencido: R$ 200.00");
    expect(text).toContain("Pago: R$ 300.00");
    // oldest-first ordering
    expect(text.indexOf("AP-3")).toBeLessThan(text.indexOf("AP-2"));
  });

  it("sends filtrar_por_cpf_cnpj (digits only) when cnpjFornecedor is given", async () => {
    let captured: Record<string, unknown> = {};
    const client: OmieClient = {
      call: vi.fn(async (a: { param: Record<string, unknown> }) => {
        captured = a.param;
        return { ok: true, data: { conta_pagar_cadastro: [] } } as unknown;
      }) as unknown as OmieClient["call"],
    };
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));
    await contasAPagarHandler({ cnpjFornecedor: "65.912.950/0001-38" }, makeCtx());
    expect(captured.filtrar_por_cpf_cnpj).toBe("65912950000138");
  });

  it("handles 'não existem registros' gracefully", async () => {
    const client = fakeOmie([
      { ok: false, status: 200, faultstring: "Não existem registros para a página informada." },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));
    const res = await contasAPagarHandler({ codigoFornecedor: 1 }, makeCtx());
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Nenhum lançamento a pagar");
  });

  it("rejects desde without ate (and vice versa)", async () => {
    const res = await contasAPagarHandler({ desde: "2026-05-01" }, makeCtx());
    expect(res.isError).toBe(true);
  });

  it("rejects a non-ISO date", async () => {
    const res = await contasAPagarHandler(
      { desde: "01/05/2026", ate: "2026-08-01" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
  });

  describe("windowed (desde/ate)", () => {
    it("sorts descending by CODIGO and keeps only rows inside the window", async () => {
      let captured: Record<string, unknown> = {};
      const page1 = {
        ok: true as const,
        data: {
          total_de_paginas: 1,
          conta_pagar_cadastro: [
            // most-recently-entered first (descending CODIGO) — mixed due dates
            { codigo_lancamento_omie: 100, numero_documento: "AP-100", data_vencimento: "01/08/2026", valor_documento: 500, status_titulo: "A_PAGAR", observacao: null },
            { codigo_lancamento_omie: 99, numero_documento: "AP-99", data_vencimento: "01/06/2026", valor_documento: 300, status_titulo: "PAGO", observacao: null },
            // outside the window (too old) — must be excluded from totals
            { codigo_lancamento_omie: 98, numero_documento: "AP-98", data_vencimento: "01/01/2025", valor_documento: 9999, status_titulo: "PAGO", observacao: null },
          ],
        },
      };
      const client: OmieClient = {
        call: vi.fn(async (a: { param: Record<string, unknown> }) => {
          if (!captured.ordenar_por) captured = a.param;
          return page1;
        }) as unknown as OmieClient["call"],
      };
      vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

      const res = await contasAPagarHandler(
        { desde: "2026-05-11", ate: "2026-08-09" },
        makeCtx(),
      );
      expect(res.isError).toBeUndefined();
      const text = res.content[0]?.text ?? "";
      expect(captured.ordenar_por).toBe("CODIGO");
      expect(captured.ordem_descrescente).toBe("S");
      expect(text).toContain("AP-100");
      expect(text).toContain("AP-99");
      expect(text).not.toContain("AP-98");
      // AP-98's 9999 must not leak into the window-scoped total
      expect(text).toContain("A pagar no período: R$ 500.00");
      expect(text).toContain("Pago: R$ 300.00");
    });

    it("stops after 3 consecutive pages with nothing in the window", async () => {
      const inWindowPage = {
        ok: true as const,
        data: {
          total_de_paginas: 10,
          // full page (100 rows, matching real Omie behavior where only the
          // LAST page is short) — one row in-window, the rest padding before it
          conta_pagar_cadastro: [
            { codigo_lancamento_omie: 200, numero_documento: "AP-200", data_vencimento: "01/06/2026", valor_documento: 100, status_titulo: "A_PAGAR", observacao: null },
            ...Array.from({ length: 99 }, (_, i) => ({
              codigo_lancamento_omie: 199 - i,
              numero_documento: `PAD-${i}`,
              data_vencimento: "01/01/2020",
              valor_documento: 1,
              status_titulo: "PAGO",
              observacao: null,
            })),
          ],
        },
      };
      const emptyPage = {
        ok: true as const,
        data: {
          total_de_paginas: 10,
          // full page (100 rows) but all dated before the window
          conta_pagar_cadastro: Array.from({ length: 100 }, (_, i) => ({
            codigo_lancamento_omie: 100 - i,
            numero_documento: `OLD-${i}`,
            data_vencimento: "01/01/2020",
            valor_documento: 1,
            status_titulo: "PAGO",
            observacao: null,
          })),
        },
      };
      const categoriaRes = { ok: true as const, data: { categoria_cadastro: [] } };
      const calls = vi.fn();
      const client: OmieClient = {
        call: vi.fn(async (a: unknown) => {
          calls(a);
          const n = calls.mock.calls.length;
          if (n === 1) return inWindowPage; // page 1: 1 hit
          if (n >= 2 && n <= 4) return emptyPage; // pages 2-4: 3 consecutive empty -> stop
          return categoriaRes;
        }) as unknown as OmieClient["call"],
      };
      vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

      const res = await contasAPagarHandler(
        { desde: "2026-05-11", ate: "2026-08-09" },
        makeCtx(),
      );
      expect(res.isError).toBeUndefined();
      // 4 ListarContasPagar pages (1 hit + 3 empty) + 1 ListarCategorias = 5
      expect(calls).toHaveBeenCalledTimes(5);
      expect(res.content[0]?.text ?? "").toContain("AP-200");
    });
  });
});
