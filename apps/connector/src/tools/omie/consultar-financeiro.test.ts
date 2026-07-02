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
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarFinanceiroHandler(
      { codigoCliente: 999 },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("A receber: R$ 300.00");
    expect(text).toContain("Vencido:   R$ 200.00");
    expect(text).toContain("Recebido:  R$ 100.00");
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
    const client = fakeOmie([page1, page2]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarFinanceiroHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("todos os clientes");
    expect(text).toContain("A receber: R$ 100.00");
    expect(text).toContain("Vencido:   R$ 200.00");
    expect(text).toContain("Recebido:  R$ 300.00");
    // all-clients lines carry the client code
    expect(text).toContain("cliente 501");
    expect(client.call).toHaveBeenCalledTimes(2);
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
});
