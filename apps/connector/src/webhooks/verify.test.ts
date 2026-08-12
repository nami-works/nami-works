import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyShopifyHmac } from "./verify.js";

const SECRET = "test-webhook-secret";
const BODY = Buffer.from(JSON.stringify({ id: 12345, total_price: "100.00" }));

function sign(body: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyShopifyHmac", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyShopifyHmac(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ id: 12345, total_price: "999.00" }));
    expect(verifyShopifyHmac(tampered, sign(BODY, SECRET), SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyShopifyHmac(BODY, sign(BODY, SECRET), "wrong-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyShopifyHmac(BODY, undefined, SECRET)).toBe(false);
  });
});
