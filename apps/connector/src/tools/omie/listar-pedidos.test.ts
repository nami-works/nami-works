import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmieCallResult, OmieClient } from "../../clients/omie.js";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/omie.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../clients/omie.js")>();
  return { ...actual, getOmieCompanies: vi.fn(), getB2BRegistry: vi.fn() };
});

import { getB2BRegistry, getOmieCompanies } from "../../clients/omie.js";
import { listarPedidosHandler } from "./listar-pedidos.js";

function asCompany(client: OmieClient) {
  return [{ code: "principal", client }];
}

function pedido(numero: string, dInc: string, valor: number) {
  return {
    cabecalho: {
      codigo_pedido: 1,
      numero_pedido: numero,
      codigo_cliente: 999,
      etapa: "80",
      data_previsao: null,
    },
    total_pedido: {
      valor_total_pedido: valor,
      valor_total_produtos: valor,
      valor_descontos: 0,
    },
    infoCadastro: { dInc, dAlt: null },
  };
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
  vi.mocked(getB2BRegistry).mockReset().mockResolvedValue([]);
});

describe("listarPedidosHandler", () => {
  it("validates ISO date format", async () => {
    const res = await listarPedidosHandler(
      { desde: "01/04/2026", ate: "30/04/2026" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("ISO");
  });

  it("converts ISO dates to Omie's dd/mm/yyyy format and lists results", async () => {
    const calls: Array<{ desde: string; ate: string }> = [];
    const client: OmieClient = {
      call: vi.fn(async (args: { param: { filtrar_por_data_de: string; filtrar_por_data_ate: string } }) => {
        calls.push({
          desde: args.param.filtrar_por_data_de,
          ate: args.param.filtrar_por_data_ate,
        });
        return {
          ok: true,
          data: {
            pedido_venda_produto: [
              {
                cabecalho: {
                  codigo_pedido: 1,
                  numero_pedido: "1001",
                  codigo_cliente: 999,
                  etapa: "10",
                  data_previsao: null,
                },
                total_pedido: {
                  valor_total_pedido: 250.5,
                  valor_total_produtos: 250.5,
                  valor_descontos: 0,
                },
                infoCadastro: { dInc: "20/04/2026", dAlt: null },
              },
            ],
          },
        } as unknown;
      }) as unknown as OmieClient["call"],
    };
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await listarPedidosHandler(
      { desde: "2026-04-01", ate: "2026-04-30" },
      makeCtx(),
    );
    expect(calls[0]).toEqual({ desde: "01/04/2026", ate: "30/04/2026" });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("#1001");
    expect(text).toContain("250.50");
    expect(text).toContain("etapa 10");
  });

  it("returns clean message on Omie 'não existem registros'", async () => {
    const client = fakeOmie([
      {
        ok: false,
        status: 200,
        faultstring: "Não existem registros para a página informada.",
      },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));
    const res = await listarPedidosHandler(
      { desde: "2026-04-01", ate: "2026-04-02" },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Nenhum pedido");
  });

  it("excludes out-of-window orders client-side and sums only in-window (Omie date filter is unreliable)", async () => {
    const client = fakeOmie([
      {
        ok: true,
        data: {
          pedido_venda_produto: [
            pedido("OLD", "15/06/2024", 999), // out of window
            pedido("IN1", "15/10/2025", 100),
            pedido("IN2", "20/11/2025", 250),
          ],
          total_de_paginas: 1,
        },
      },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));
    const res = await listarPedidosHandler(
      { desde: "2025-10-01", ate: "2026-07-02" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Total: R$ 350.00"); // 100 + 250, NOT the 999
    expect(text).toContain("2 pedido(s)");
    expect(text).toContain("#IN1");
    expect(text).not.toContain("#OLD");
  });

  it("resolves a customer by name via the registry (no code needed) and queries that código", async () => {
    let captured: Record<string, unknown> = {};
    const client: OmieClient = {
      call: vi.fn(async (a: { param: Record<string, unknown> }) => {
        captured = a.param;
        return { ok: true, data: { pedido_venda_produto: [], total_de_paginas: 0 } } as unknown;
      }) as unknown as OmieClient["call"],
    };
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));
    vi.mocked(getB2BRegistry).mockResolvedValue([
      { nome: "Amazon", codigos: { principal: 6800644256 } },
    ]);
    await listarPedidosHandler(
      { desde: "2025-10-01", ate: "2026-07-02", nome: "amazon" },
      makeCtx(),
    );
    expect(captured.filtrar_por_cliente).toBe(6800644256);
  });

  it("scopes to a single client when codigoCliente is given", async () => {
    let captured: Record<string, unknown> = {};
    let captureSeen = false;
    const client: OmieClient = {
      call: vi.fn(async (args: { param: Record<string, unknown> }) => {
        captured = args.param;
        captureSeen = true;
        return { ok: true, data: { pedido_venda_produto: [] } } as unknown;
      }) as unknown as OmieClient["call"],
    };
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));
    await listarPedidosHandler(
      { desde: "2026-04-01", ate: "2026-04-02", codigoCliente: 12345 },
      makeCtx(),
    );
    expect(captureSeen).toBe(true);
    expect(captured.filtrar_por_cliente).toBe(12345);
  });
});
