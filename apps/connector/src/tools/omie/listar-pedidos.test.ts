import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmieCallResult, OmieClient } from "../../clients/omie.js";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/omie.js", () => ({
  getOmieClient: vi.fn(),
}));

import { getOmieClient } from "../../clients/omie.js";
import { listarPedidosHandler } from "./listar-pedidos.js";

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
  vi.mocked(getOmieClient).mockReset();
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
    vi.mocked(getOmieClient).mockResolvedValue(client);

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
    vi.mocked(getOmieClient).mockResolvedValue(client);
    const res = await listarPedidosHandler(
      { desde: "2026-04-01", ate: "2026-04-02" },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Nenhum pedido encontrado");
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
    vi.mocked(getOmieClient).mockResolvedValue(client);
    await listarPedidosHandler(
      { desde: "2026-04-01", ate: "2026-04-02", codigoCliente: 12345 },
      makeCtx(),
    );
    expect(captureSeen).toBe(true);
    expect(captured.filtrar_por_cliente).toBe(12345);
  });
});
