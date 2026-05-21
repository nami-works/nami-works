import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearSecretsCacheForTesting, getSecret } from "./ssm.js";

function makeClient(responses: Array<string | null>): SSMClient {
  const send = vi.fn(async (command: unknown) => {
    const next = responses.shift() ?? null;
    const name =
      command instanceof GetParameterCommand ? command.input.Name : undefined;
    if (next === null) {
      return { Parameter: { Name: name, Value: undefined } };
    }
    return { Parameter: { Name: name, Value: next } };
  });
  // SSMClient is a class; we mock only the .send method used by getSecret.
  return { send } as unknown as SSMClient;
}

beforeEach(() => {
  __clearSecretsCacheForTesting();
});

afterEach(() => {
  __clearSecretsCacheForTesting();
});

describe("getSecret", () => {
  it("returns the parameter value", async () => {
    const client = makeClient(["shh-secret"]);
    const v = await getSecret("/nami-works/tenants/x/key", { client });
    expect(v).toBe("shh-secret");
  });

  it("caches the value across calls within TTL", async () => {
    const send = vi.fn(async () => ({
      Parameter: { Value: "cached-value" },
    }));
    const client = { send } as unknown as SSMClient;
    const a = await getSecret("/p", { client });
    const b = await getSecret("/p", { client });
    expect(a).toBe("cached-value");
    expect(b).toBe("cached-value");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Parameter: { Value: "v1" } })
      .mockResolvedValueOnce({ Parameter: { Value: "v2" } });
    const client = { send } as unknown as SSMClient;

    let clock = 1_000_000;
    const now = () => clock;

    const a = await getSecret("/p", { client, ttlMs: 1000, now });
    clock += 2000;
    const b = await getSecret("/p", { client, ttlMs: 1000, now });

    expect(a).toBe("v1");
    expect(b).toBe("v2");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("throws a descriptive error when the parameter is missing", async () => {
    const send = vi.fn(async () => ({ Parameter: { Value: undefined } }));
    const client = { send } as unknown as SSMClient;
    await expect(getSecret("/missing", { client })).rejects.toThrow(
      /SSM parameter not found or empty: \/missing/,
    );
  });
});
