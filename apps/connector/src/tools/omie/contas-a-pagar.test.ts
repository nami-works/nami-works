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
});
