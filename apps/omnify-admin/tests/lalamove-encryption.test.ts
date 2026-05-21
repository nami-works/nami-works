import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptSecret,
  encryptSecret,
} from "../app/services/security/encryption.server";
import {
  buildLalamoveSignature,
  detectLalamoveCredentialPrefixMismatch,
  detectLalamoveEnvironmentFromBaseUrl,
  normalizeLalamoveError,
  isPhoneValidForMarket,
  normalizePhoneForMarket,
  normalizePhoneToE164,
  sanitizeLalamoveErrorMessage,
} from "../app/services/lalamove.server";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.APP_ENCRYPTION_KEY_VERSION = "1";

test("encrypt/decrypt roundtrip", () => {
  const original = "secret-value-123";
  const encrypted = encryptSecret(original);
  assert.ok(encrypted.ciphertext.length > 0);
  assert.equal(encrypted.keyVersion, 1);
  const clear = decryptSecret(encrypted.ciphertext);
  assert.equal(clear, original);
});

test("decrypt fails when payload is tampered", () => {
  const encrypted = encryptSecret("secret-value-123");
  const buf = Buffer.from(encrypted.ciphertext, "base64");
  buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
  const tampered = buf.toString("base64");
  assert.throws(() => decryptSecret(tampered));
});

test("sanitize error message redacts auth material", () => {
  const input =
    "401: invalid hmac abc:def:ghi api_key=foobar secret=mysecretvalue";
  const safe = sanitizeLalamoveErrorMessage(input);
  assert.match(safe, /hmac \[redacted\]/);
  assert.match(safe, /api_key=\[redacted\]/i);
  assert.match(safe, /secret=\[redacted\]/i);
});

test("signature generation is deterministic", () => {
  const signature = buildLalamoveSignature(
    "secret123",
    "1700000000000",
    "POST",
    "/v3/quotations",
    '{"data":{"market":"BR"}}',
  );
  assert.equal(
    signature,
    "51a96386d5a56db5e40db99661e192f44ec31290bf25068e0e4298e7989d7cfe",
  );
});

test("detects environment from base url", () => {
  assert.equal(
    detectLalamoveEnvironmentFromBaseUrl("https://rest.sandbox.lalamove.com/v3"),
    "sandbox",
  );
  assert.equal(
    detectLalamoveEnvironmentFromBaseUrl("https://rest.lalamove.com/v3"),
    "production",
  );
});

test("detects key prefix mismatch by environment", () => {
  const prodMismatch = detectLalamoveCredentialPrefixMismatch(
    "pk_test_abc",
    "sk_test_xyz",
    "production",
  );
  assert.ok(prodMismatch);

  const sandboxMismatch = detectLalamoveCredentialPrefixMismatch(
    "pk_prod_abc",
    "sk_prod_xyz",
    "sandbox",
  );
  assert.ok(sandboxMismatch);

  const noMismatch = detectLalamoveCredentialPrefixMismatch(
    "pk_prod_abc",
    "sk_prod_xyz",
    "production",
  );
  assert.equal(noMismatch, null);
});

test("normalizes retryable and non-retryable errors", () => {
  const rateLimited = normalizeLalamoveError(429, "429: Too many requests");
  assert.equal(rateLimited.retryable, true);
  assert.equal(rateLimited.code, "rate_limited");

  const authError = normalizeLalamoveError(401, "401: Unauthorized");
  assert.equal(authError.retryable, false);
  assert.equal(authError.code, "unauthorized");
});

test("normalizePhoneToE164 - no market (legacy behavior)", () => {
  assert.equal(normalizePhoneToE164("11 966-208-929"), "+11966208929");
  assert.equal(normalizePhoneToE164("+5511966208929"), "+5511966208929");
  assert.equal(normalizePhoneToE164(null), "");
  assert.equal(normalizePhoneToE164(""), "");
});

test("normalizePhoneToE164 - BR market adds +55 when missing", () => {
  assert.equal(normalizePhoneToE164("21994683997", "BR"), "+5521994683997");
  assert.equal(normalizePhoneToE164("11966208929", "BR"), "+5511966208929");
});

test("normalizePhoneToE164 - BR market leaves correct prefix intact", () => {
  assert.equal(normalizePhoneToE164("+5511966208929", "BR"), "+5511966208929");
  assert.equal(normalizePhoneToE164("5511966208929", "BR"), "+5511966208929");
});

test("normalizePhoneToE164 - BR market corrects wrong +21 prefix", () => {
  assert.equal(normalizePhoneToE164("+21994683997", "BR"), "+5521994683997");
});

test("normalizePhoneToE164 - HK market handles 3-digit code 852", () => {
  assert.equal(normalizePhoneToE164("91234567", "HK"), "+85291234567");
  assert.equal(normalizePhoneToE164("+85291234567", "HK"), "+85291234567");
});

test("normalizePhoneToE164 - unknown market falls back to legacy", () => {
  assert.equal(normalizePhoneToE164("11966208929", "ZZ"), "+11966208929");
});

test("normalizePhoneToE164 - market is case-insensitive", () => {
  assert.equal(normalizePhoneToE164("11966208929", "br"), "+5511966208929");
  assert.equal(normalizePhoneToE164("11966208929", "Br"), "+5511966208929");
});

// ── isPhoneValidForMarket ──────────────────────────────────────────────────

test("isPhoneValidForMarket - BR phone in BR market is valid", () => {
  assert.equal(isPhoneValidForMarket("+5511966208929", "BR"), true);
});

test("isPhoneValidForMarket - US phone in BR market is invalid", () => {
  assert.equal(isPhoneValidForMarket("+14694695534", "BR"), false);
});

test("isPhoneValidForMarket - no market is always valid", () => {
  assert.equal(isPhoneValidForMarket("+14694695534", null), true);
  assert.equal(isPhoneValidForMarket("+14694695534", undefined), true);
});

test("isPhoneValidForMarket - unknown market is permissive", () => {
  assert.equal(isPhoneValidForMarket("+14694695534", "ZZ"), true);
});

test("isPhoneValidForMarket - HK 3-digit code", () => {
  assert.equal(isPhoneValidForMarket("+85291234567", "HK"), true);
  assert.equal(isPhoneValidForMarket("+5511966208929", "HK"), false);
});

// ── normalizePhoneForMarket ────────────────────────────────────────────────

test("normalizePhoneForMarket - valid BR phone passes through", () => {
  assert.equal(normalizePhoneForMarket("+5511966208929", "BR"), "+5511966208929");
  assert.equal(normalizePhoneForMarket("11966208929", "BR"), "+5511966208929");
});

test("normalizePhoneForMarket - US phone in BR market returns empty", () => {
  assert.equal(normalizePhoneForMarket("+14694695534", "BR"), "");
});

test("normalizePhoneForMarket - no market passes through", () => {
  assert.equal(normalizePhoneForMarket("+14694695534", null), "+14694695534");
});

test("normalizePhoneForMarket - empty/null input returns empty", () => {
  assert.equal(normalizePhoneForMarket(null, "BR"), "");
  assert.equal(normalizePhoneForMarket("", "BR"), "");
});
