import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmieCallResult, OmieClient } from "../../clients/omie.js";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/omie.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../clients/omie.js")>();
  return { ...actual, getOmieCompanies: vi.fn() };
});

import { getOmieCompanies } from "../../clients/omie.js";
import { consultarFinanceiroHandler } from "./consultar-financeiro.js";

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

describe("consultarFinanceiroHandler", () => {
  it("aggregates open / overdue / paid amounts and lists the oldest 25", async () => {
    const items = [
      {
        codigo_lancamento_omie: 1,
        numero_documento: "DOC-1",
        data_vencimento: "10/03/2026",
        valor_documento: 100,
        status_titulo: "RECEBIDO",
        observacao: null,
      },
      {
        codigo_lancamento_omie: 2,
        numero_documento: "DOC-2",
        data_vencimento: "10/04/2026",
        valor_documento: 200,
        status_titulo: "VENCIDO",
        observacao: null,
      },
      {
        codigo_lancamento_omie: 3,
        numero_documento: "DOC-3",
        data_vencimento: "10/05/2026",
        valor_documento: 300,
        status_titulo: "A_RECEBER",
        observacao: null,
      },
    ];
    const client = fakeOmie([
      { ok: true, data: { conta_receber_cadastro: items } },
      { ok: true, data: { categoria_cadastro: [] } }, // ListarCategorias (enrichment)
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarFinanceiroHandler(
      { codigoCliente: 999 },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("A receber: R$ 300.00");
    expect(text).toContain("Vencido: R$ 200.00");
    expect(text).toContain("Recebido: R$ 100.00");
    // Oldest first (DOC-1 March before DOC-2 April before DOC-3 May)
    const idx1 = text.indexOf("DOC-1");
    const idx2 = text.indexOf("DOC-2");
    const idx3 = text.indexOf("DOC-3");
    expect(idx1).toBeGreaterThan(0);
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it("aggregates across all clients (paginated) when no codigoCliente is given", async () => {
    const page1 = {
      ok: true as const,
      data: {
        total_de_paginas: 2,
        total_de_registros: 3,
        conta_receber_cadastro: [
          {
            codigo_lancamento_omie: 1,
            codigo_cliente_fornecedor: 501,
            numero_documento: "DOC-1",
            data_vencimento: "10/03/2026",
            valor_documento: 100,
            status_titulo: "A_RECEBER",
            observacao: null,
          },
          {
            codigo_lancamento_omie: 2,
            codigo_cliente_fornecedor: 502,
            numero_documento: "DOC-2",
            data_vencimento: "10/04/2026",
            valor_documento: 200,
            status_titulo: "VENCIDO",
            observacao: null,
          },
        ],
      },
    };
    const page2 = {
      ok: true as const,
      data: {
        total_de_paginas: 2,
        total_de_registros: 3,
        conta_receber_cadastro: [
          {
            codigo_lancamento_omie: 3,
            codigo_cliente_fornecedor: 503,
            numero_documento: "DOC-3",
            data_vencimento: "10/05/2026",
            valor_documento: 300,
            status_titulo: "RECEBIDO",
            observacao: null,
          },
        ],
      },
    };
    const categoriaRes = { ok: true as const, data: { categoria_cadastro: [] } };
    const nameFor = (razao: string) => ({
      ok: true as const,
      data: { razao_social: razao, nome_fantasia: null },
    });
    const client = fakeOmie([
      page1,
      page2,
      categoriaRes,
      nameFor("Cliente 501 LTDA"), // resolved in vencimento order: 501, 502, 503
      nameFor("Cliente 502 LTDA"),
      nameFor("Cliente 503 LTDA"),
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarFinanceiroHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("todos os clientes");
    expect(text).toContain("A receber: R$ 100.00");
    expect(text).toContain("Vencido: R$ 200.00");
    expect(text).toContain("Recebido: R$ 300.00");
    // all-clients lines now resolve the supplier/customer name, not just the code
    expect(text).toContain("Cliente 501 LTDA");
    // 2 page fetches + 1 categoria fetch + 3 name resolutions (501/502/503)
    expect(client.call).toHaveBeenCalledTimes(6);
  });

  it("handles 'não existem registros' fault gracefully", async () => {
    const client = fakeOmie([
      {
        ok: false,
        status: 200,
        faultstring: "Não existem registros para a página informada.",
      },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarFinanceiroHandler(
      { codigoCliente: 999 },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Nenhum lançamento financeiro");
  });

  it("returns empty-list message when conta_receber_cadastro is empty", async () => {
    const client = fakeOmie([
      { ok: true, data: { conta_receber_cadastro: [] } },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarFinanceiroHandler(
      { codigoCliente: 999 },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Nenhum lançamento");
  });

  it("rejects desde without ate (and vice versa)", async () => {
    const res = await consultarFinanceiroHandler({ ate: "2026-08-09" }, makeCtx());
    expect(res.isError).toBe(true);
  });

  describe("windowed (desde/ate)", () => {
    it("sorts descending by DATA_VENCIMENTO and stops the instant a row falls before desde", async () => {
      let captured: Record<string, unknown> = {};
      const page1 = {
        ok: true as const,
        data: {
          total_de_paginas: 5, // would keep paging if not for the early stop
          conta_receber_cadastro: [
            // descending due date: future (skip, ahead of window), in-window, then before desde (stop)
            { codigo_lancamento_omie: 1, numero_documento: "DOC-FUTURE", data_vencimento: "01/12/2026", valor_documento: 999, status_titulo: "A_RECEBER", observacao: null },
            { codigo_lancamento_omie: 2, numero_documento: "DOC-IN", data_vencimento: "01/06/2026", valor_documento: 100, status_titulo: "RECEBIDO", observacao: null },
            { codigo_lancamento_omie: 3, numero_documento: "DOC-OLD", data_vencimento: "01/01/2020", valor_documento: 9999, status_titulo: "RECEBIDO", observacao: null },
          ],
        },
      };
      const client: OmieClient = {
        call: vi.fn(async (a: { param: Record<string, unknown> }) => {
          if (!captured.ordenar_por) captured = a.param; // capture the first (ListarContasReceber) call only
          return page1;
        }) as unknown as OmieClient["call"],
      };
      vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

      const res = await consultarFinanceiroHandler(
        { codigoCliente: 999, desde: "2026-05-11", ate: "2026-08-09" },
        makeCtx(),
      );
      expect(res.isError).toBeUndefined();
      const text = res.content[0]?.text ?? "";
      expect(captured.ordenar_por).toBe("DATA_VENCIMENTO");
      expect(captured.ordem_descrescente).toBe("S");
      expect(text).toContain("DOC-IN");
      expect(text).not.toContain("DOC-FUTURE");
      expect(text).not.toContain("DOC-OLD");
      // only 1 ListarContasReceber page fetched (DOC-OLD triggers an immediate
      // stop, no second page requested) + 1 ListarCategorias enrichment call
      expect(client.call).toHaveBeenCalledTimes(2);
    });
  });
});
