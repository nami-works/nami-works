import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertEncryptionConfigured,
  decryptSecret,
  encryptSecret,
} from "./encryption.js";

function newKey(): string {
  return randomBytes(32).toString("base64");
}

const KEY_V1 = newKey();
const KEY_V2 = newKey();

describe("encryption module", () => {
  const originalEnv = {
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
    APP_ENCRYPTION_KEY_VERSION: process.env.APP_ENCRYPTION_KEY_VERSION,
    APP_PREVIOUS_ENCRYPTION_KEYS: process.env.APP_PREVIOUS_ENCRYPTION_KEYS,
  };

  beforeEach(() => {
    delete process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_ENCRYPTION_KEY_VERSION;
    delete process.env.APP_PREVIOUS_ENCRYPTION_KEYS;
  });

  afterEach(() => {
    if (originalEnv.APP_ENCRYPTION_KEY !== undefined) {
      process.env.APP_ENCRYPTION_KEY = originalEnv.APP_ENCRYPTION_KEY;
    } else {
      delete process.env.APP_ENCRYPTION_KEY;
    }
    if (originalEnv.APP_ENCRYPTION_KEY_VERSION !== undefined) {
      process.env.APP_ENCRYPTION_KEY_VERSION =
        originalEnv.APP_ENCRYPTION_KEY_VERSION;
    } else {
      delete process.env.APP_ENCRYPTION_KEY_VERSION;
    }
    if (originalEnv.APP_PREVIOUS_ENCRYPTION_KEYS !== undefined) {
      process.env.APP_PREVIOUS_ENCRYPTION_KEYS =
        originalEnv.APP_PREVIOUS_ENCRYPTION_KEYS;
    } else {
      delete process.env.APP_PREVIOUS_ENCRYPTION_KEYS;
    }
  });

  describe("roundtrip", () => {
    it("encrypts and decrypts a UTF-8 secret losslessly", () => {
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";

      const plaintext = "klaviyo-token-abc123!@#$%^&*";
      const { ciphertext, keyVersion } = encryptSecret(plaintext);

      expect(keyVersion).toBe(1);
      expect(ciphertext).not.toContain(plaintext);
      expect(decryptSecret(ciphertext)).toBe(plaintext);
    });

    it("handles JSON payloads with embedded special chars", () => {
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";

      const payload = JSON.stringify({
        apiKey: "mc_us10_xx-yy/zz==",
        boardIds: ["1234567890", "9876543210"],
        filters: [{ column: "status", op: "is_one_of", values: ["Pub'd"] }],
      });
      const { ciphertext } = encryptSecret(payload);

      expect(decryptSecret(ciphertext)).toBe(payload);
    });

    it("handles long values without truncation", () => {
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";

      const plaintext = "x".repeat(8000);
      const { ciphertext } = encryptSecret(plaintext);

      expect(decryptSecret(ciphertext)).toBe(plaintext);
    });

    it("produces different ciphertexts for the same plaintext (random IV)", () => {
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";

      const plaintext = "deterministic-input";
      const a = encryptSecret(plaintext).ciphertext;
      const b = encryptSecret(plaintext).ciphertext;

      expect(a).not.toBe(b);
      expect(decryptSecret(a)).toBe(plaintext);
      expect(decryptSecret(b)).toBe(plaintext);
    });
  });

  describe("key rotation", () => {
    it("decrypts a v1 ciphertext after rotating to v2 (with v1 in previous keys)", () => {
      // Encrypt under v1
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";
      const { ciphertext: oldCiphertext } = encryptSecret("rotated-secret");

      // Rotate: v2 active, v1 still in keyring for decrypt-only
      process.env.APP_ENCRYPTION_KEY = KEY_V2;
      process.env.APP_ENCRYPTION_KEY_VERSION = "2";
      process.env.APP_PREVIOUS_ENCRYPTION_KEYS = `1:${KEY_V1}`;

      expect(decryptSecret(oldCiphertext)).toBe("rotated-secret");

      // New writes go to v2
      const { ciphertext: newCiphertext, keyVersion } = encryptSecret("fresh");
      expect(keyVersion).toBe(2);
      expect(decryptSecret(newCiphertext)).toBe("fresh");
    });

    it("cannot decrypt v1 ciphertext if v1 isn't in the previous-keys list", () => {
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";
      const { ciphertext } = encryptSecret("orphan-secret");

      // Rotate without including v1 — simulates an operator misconfig
      process.env.APP_ENCRYPTION_KEY = KEY_V2;
      process.env.APP_ENCRYPTION_KEY_VERSION = "2";

      expect(() => decryptSecret(ciphertext)).toThrow(
        /Unable to decrypt value with current key ring/,
      );
    });
  });

  describe("config validation", () => {
    it("throws on missing APP_ENCRYPTION_KEY", () => {
      expect(() => assertEncryptionConfigured()).toThrow(
        /APP_ENCRYPTION_KEY/,
      );
      expect(() => encryptSecret("anything")).toThrow(/APP_ENCRYPTION_KEY/);
    });

    it("throws when APP_ENCRYPTION_KEY isn't 32 bytes after base64-decode", () => {
      process.env.APP_ENCRYPTION_KEY = Buffer.from("too-short").toString(
        "base64",
      );
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";

      expect(() => assertEncryptionConfigured()).toThrow(/32-byte key/);
    });

    it("throws when APP_PREVIOUS_ENCRYPTION_KEYS is malformed", () => {
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      process.env.APP_ENCRYPTION_KEY_VERSION = "1";
      process.env.APP_PREVIOUS_ENCRYPTION_KEYS = "this-isn't-a-pair";

      expect(() => assertEncryptionConfigured()).toThrow(
        /version:base64/,
      );
    });

    it("treats APP_ENCRYPTION_KEY_VERSION as 1 when unset", () => {
      process.env.APP_ENCRYPTION_KEY = KEY_V1;
      // Deliberately leave APP_ENCRYPTION_KEY_VERSION unset

      const { keyVersion } = encryptSecret("default-version");
      expect(keyVersion).toBe(1);
    });
  });
});
