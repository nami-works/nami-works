import { describe, expect, it } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from "../src/webhooks/signer.js";

describe("signWebhookPayload", () => {
  it("produces deterministic signature for fixed inputs", () => {
    const headers = signWebhookPayload({
      secret: "whsec_test_1234567890abcdef",
      body: '{"id":"evt_x","type":"order.received","data":{}}',
      eventType: "order.received",
      deliveryId: "dlv_01HXYZ",
      timestamp: 1716307200,
    });
    expect(headers["X-Rota-Local-Timestamp"]).toBe("1716307200");
    expect(headers["X-Rota-Local-Event"]).toBe("order.received");
    expect(headers["X-Rota-Local-Delivery"]).toBe("dlv_01HXYZ");
    expect(headers["X-Rota-Local-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    // Round-trip with verifyWebhookSignature to confirm the algorithm
    // matches what merchants will run on their side.
    expect(
      verifyWebhookSignature({
        secret: "whsec_test_1234567890abcdef",
        body: '{"id":"evt_x","type":"order.received","data":{}}',
        timestamp: "1716307200",
        signature: headers["X-Rota-Local-Signature"],
      }),
    ).toBe(true);
  });

  it("verify rejects wrong-secret signature", () => {
    const headers = signWebhookPayload({
      secret: "whsec_correct",
      body: "{}",
      eventType: "order.picked",
      deliveryId: "dlv_y",
      timestamp: 1000,
    });
    expect(
      verifyWebhookSignature({
        secret: "whsec_wrong",
        body: "{}",
        timestamp: "1000",
        signature: headers["X-Rota-Local-Signature"],
      }),
    ).toBe(false);
  });

  it("verify rejects tampered body", () => {
    const headers = signWebhookPayload({
      secret: "s",
      body: '{"amount":100}',
      eventType: "order.delivered",
      deliveryId: "d",
      timestamp: 1,
    });
    expect(
      verifyWebhookSignature({
        secret: "s",
        body: '{"amount":999}',
        timestamp: "1",
        signature: headers["X-Rota-Local-Signature"],
      }),
    ).toBe(false);
  });
});
