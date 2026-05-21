import test from "node:test";
import assert from "node:assert/strict";
import { validateCredentialInput } from "../app/services/lalamove-credentials.server";

test("validateCredentialInput accepts valid values", () => {
  const result = validateCredentialInput("key_abc-123", "sec/abc+123=");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.apiKey, "key_abc-123");
    assert.equal(result.apiSecret, "sec/abc+123=");
  }
});

test("validateCredentialInput rejects empty", () => {
  const result = validateCredentialInput("", "");
  assert.equal(result.ok, false);
});

test("validateCredentialInput rejects invalid chars", () => {
  const result = validateCredentialInput("abc xyz", "secret");
  assert.equal(result.ok, false);
});
