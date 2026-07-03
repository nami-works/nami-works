import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOmieClient } from "./omie.js";

const noBackoff = async () => undefined;

function fakeFetch(
  responses: Array<
    | { status: number; body: unknown }
    | { throws: unknown }
  >,
): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[i++];
    if (!r) throw new Error("no more scripted responses");
    if ("throws" in r) throw r.throws;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("buildOmieClient", () => {
  it("posts the expected JSON-RPC envelope and returns ok on 200", async () => {
    const captured: { url?: string; body?: string } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.body = init.body as string;
      return new Response(
        JSON.stringify({ codigo_cliente_omie: 12345, razao_social: "Acme" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = buildOmieClient("APPK", "APPS", {
      baseUrl: "https://test.example/api",
      fetchImpl,
      backoff: noBackoff,
    });

    const result = await client.call<
      { codigo_cliente_omie: number },
      { razao_social: string }
    >({
      resource: "geral/clientes",
      method: "ConsultarCliente",
      param: { codigo_cliente_omie: 12345 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.razao_social).toBe("Acme");
    expect(captured.url).toBe("https://test.example/api/geral/clientes/");
    const body = JSON.parse(captured.body ?? "{}");
    expect(body.app_key).toBe("APPK");
    expect(body.app_secret).toBe("APPS");
    expect(body.call).toBe("ConsultarCliente");
    expect(body.param).toEqual([{ codigo_cliente_omie: 12345 }]);
  });

  it("treats faultstring on a 200 as a logical failure", async () => {
    const client = buildOmieClient("k", "s", {
      fetchImpl: fakeFetch([
        {
          status: 200,
          body: { faultstring: "Cliente não cadastrado", faultcode: "SOAP-ENV:Client-101" },
        },
      ]),
      backoff: noBackoff,
    });
    const r = await client.call({
      resource: "geral/clientes",
      method: "ConsultarCliente",
      param: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faultstring).toContain("Cliente não cadastrado");
      expect(r.faultcode).toBe("SOAP-ENV:Client-101");
    }
  });

  it("retries on 429 and succeeds on the next attempt", async () => {
    const client = buildOmieClient("k", "s", {
      fetchImpl: fakeFetch([
        { status: 429, body: { error: "rate limited" } },
        { status: 200, body: { ok: 1 } },
      ]),
      backoff: noBackoff,
    });
    const r = await client.call({
      resource: "geral/clientes",
      method: "ListarClientes",
      param: {},
    });
    expect(r.ok).toBe(true);
  });

  it("retries the concurrency fault ('Já existe uma requisição'), then succeeds", async () => {
    const waits: number[] = [];
    const client = buildOmieClient("k", "s", {
      fetchImpl: fakeFetch([
        {
          status: 200,
          body: { faultstring: "Já existe uma requisição desse método sendo executada" },
        },
        { status: 200, body: { clientes_cadastro: [{ codigo_cliente_omie: 1 }] } },
      ]),
      backoff: noBackoff,
      throttleWait: async (ms) => {
        waits.push(ms);
      },
    });
    const r = await client.call({
      resource: "geral/clientes",
      method: "ListarClientes",
      param: {},
    });
    expect(r.ok).toBe(true);
    expect(waits).toEqual([8000]);
  });

  it("does NOT retry 'Consumo redundante' — returns it immediately (no wait)", async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            faultstring:
              "ERROR: Consumo redundante detectado. Aguarde 31 segundos para tentar novamente (REDUNDANT).",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = buildOmieClient("k", "s", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoff: noBackoff,
      throttleWait: async (ms) => {
        waits.push(ms);
      },
    });
    const r = await client.call({ resource: "x", method: "ListarClientes", param: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.faultstring).toContain("Consumo redundante");
    expect(waits).toEqual([]); // no wait
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry
  });

  it("returns the last error when retries are exhausted", async () => {
    const client = buildOmieClient("k", "s", {
      fetchImpl: fakeFetch([
        { status: 500, body: {} },
        { status: 502, body: {} },
        { status: 503, body: {} },
        { status: 504, body: {} },
        { status: 500, body: {} },
      ]),
      backoff: noBackoff,
    });
    const r = await client.call({
      resource: "geral/clientes",
      method: "ListarClientes",
      param: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect([500, 502, 503, 504]).toContain(r.status);
  });

  it("does NOT retry on 4xx (other than 425/429)", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const client = buildOmieClient("k", "s", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoff: noBackoff,
    });
    const r = await client.call({ resource: "x", method: "y", param: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on a network throw, then surfaces it on final attempt", async () => {
    const errors = [
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
    ];
    let i = 0;
    const fetchImpl = (async () => {
      throw errors[i++];
    }) as unknown as typeof fetch;
    const client = buildOmieClient("k", "s", {
      fetchImpl,
      backoff: noBackoff,
    });
    const r = await client.call({ resource: "x", method: "y", param: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(0);
      expect(r.faultstring).toContain("ECONNRESET");
    }
  });
});

// In-process state from getOmieClient (cache + SSM fetches) tested separately
// in the SSM module's own tests; we don't repeat that wiring here.

describe("client cache reset helper", () => {
  beforeEach(() => undefined);
  afterEach(() => undefined);
  it("is exported and callable", async () => {
    const { __clearOmieClientCacheForTesting } = await import("./omie.js");
    __clearOmieClientCacheForTesting();
    expect(true).toBe(true);
  });
});
