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
import { consultarClienteHandler } from "./consultar-cliente.js";

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

describe("consultarClienteHandler", () => {
  it("looks up by codigo when provided (no Listar call)", async () => {
    const client = fakeOmie([
      {
        ok: true,
        data: {
          codigo_cliente_omie: 12345,
          codigo_cliente_integracao: "INT-1",
          razao_social: "Acme Ltda.",
          nome_fantasia: "Acme",
          cnpj_cpf: "12.345.678/0001-90",
          inscricao_estadual: "ISENTO",
          endereco: "Rua A",
          endereco_numero: "100",
          bairro: "Centro",
          cidade: "São Paulo",
          estado: "SP",
          cep: "01000-000",
          inativo: "N",
          bloqueado: "N",
          tags: [{ tag: "vip" }, { tag: "atacado" }],
        },
      },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarClienteHandler({ codigo: 12345 }, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Cliente Omie #12345");
    expect(text).toContain("Acme Ltda.");
    expect(text).toContain("vip, atacado");
    expect(text).toContain("01000-000");
    expect(res.isError).toBeUndefined();
    expect((client.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("looks up by CNPJ via Listar then Consultar", async () => {
    const client = fakeOmie([
      {
        ok: true,
        data: {
          clientes_cadastro_resumido: [
            {
              codigo_cliente: 999,
              razao_social: "Found",
              nome_fantasia: null,
              cnpj_cpf: "12345678000190",
            },
          ],
        },
      },
      {
        ok: true,
        data: {
          codigo_cliente_omie: 999,
          codigo_cliente_integracao: null,
          razao_social: "Found",
          nome_fantasia: null,
          cnpj_cpf: "12345678000190",
          inscricao_estadual: null,
          endereco: null,
          endereco_numero: null,
          bairro: null,
          cidade: null,
          estado: null,
          cep: null,
          inativo: "N",
          bloqueado: "N",
        },
      },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarClienteHandler(
      { cnpj: "12.345.678/0001-90" },
      makeCtx(),
    );
    expect(res.content[0]?.text).toContain("Cliente Omie #999");
    expect((client.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("returns clean 'not found' when CNPJ has no match", async () => {
    const client = fakeOmie([
      { ok: true, data: { clientes_cadastro_resumido: [] } },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarClienteHandler(
      { cnpj: "99.999.999/9999-99" },
      makeCtx(),
    );
    expect(res.content[0]?.text).toContain("Nenhum cliente encontrado");
    expect(res.isError).toBeUndefined();
  });

  it("rejects when neither cnpj nor codigo is provided", async () => {
    const res = await consultarClienteHandler({}, makeCtx());
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("cnpj");
  });

  it("surfaces 'cliente não cadastrado' fault as friendly text, not error", async () => {
    const client = fakeOmie([
      {
        ok: false,
        status: 200,
        faultstring: "Cliente não cadastrado.",
        faultcode: "SOAP-ENV:Client-101",
      },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));

    const res = await consultarClienteHandler({ codigo: 7 }, makeCtx());
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Cliente não cadastrado");
  });

  it("throws on unexpected Omie faults so the registry wrapper marks isError", async () => {
    const client = fakeOmie([
      { ok: false, status: 500, faultstring: "internal" },
    ]);
    vi.mocked(getOmieCompanies).mockResolvedValue(asCompany(client));
    await expect(
      consultarClienteHandler({ codigo: 1 }, makeCtx()),
    ).rejects.toThrow(/Omie ConsultarCliente failed/);
  });
});
