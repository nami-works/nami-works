import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "./security/encryption.server";

export type LalamoveRuntimeCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type LalamoveCredentialStatus = {
  configured: boolean;
  lastValidatedAt: string | null;
};

const MAX_SECRET_LEN = 512;
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SECRET_PATTERN = /^[A-Za-z0-9._:\/+=-]+$/;

const parse = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const validateCredentialInput = (apiKeyRaw: unknown, apiSecretRaw: unknown) => {
  const apiKey = parse(apiKeyRaw);
  const apiSecret = parse(apiSecretRaw);
  if (!apiKey || !apiSecret) {
    return { ok: false as const, error: "API key and secret are required." };
  }
  if (apiKey.length > MAX_SECRET_LEN || apiSecret.length > MAX_SECRET_LEN) {
    return { ok: false as const, error: "Credential value is too long." };
  }
  if (!KEY_PATTERN.test(apiKey) || !SECRET_PATTERN.test(apiSecret)) {
    return { ok: false as const, error: "Credential format is invalid." };
  }
  return { ok: true as const, apiKey, apiSecret };
};

export const saveShopCredentials = async (
  shop: string,
  apiKey: string,
  apiSecret: string,
) => {
  const keyEncrypted = encryptSecret(apiKey);
  const secretEncrypted = encryptSecret(apiSecret);
  const keyVersion = Math.max(keyEncrypted.keyVersion, secretEncrypted.keyVersion);
  await prisma.lalamoveShopCredential.upsert({
    where: { shop },
    update: {
      apiKeyCiphertext: keyEncrypted.ciphertext,
      apiSecretCiphertext: secretEncrypted.ciphertext,
      keyVersion,
    },
    create: {
      shop,
      apiKeyCiphertext: keyEncrypted.ciphertext,
      apiSecretCiphertext: secretEncrypted.ciphertext,
      keyVersion,
    },
  });
};

export const getShopCredentials = async (
  shop: string,
): Promise<LalamoveRuntimeCredentials | null> => {
  const row = await prisma.lalamoveShopCredential.findUnique({
    where: { shop },
  });
  if (!row) return null;
  return {
    apiKey: decryptSecret(row.apiKeyCiphertext),
    apiSecret: decryptSecret(row.apiSecretCiphertext),
  };
};

export const deleteShopCredentials = async (shop: string) => {
  await prisma.lalamoveShopCredential.deleteMany({ where: { shop } });
};

export const hasShopCredentials = async (shop: string) => {
  const row = await prisma.lalamoveShopCredential.findUnique({
    where: { shop },
    select: { id: true, lastValidatedAt: true },
  });
  const status: LalamoveCredentialStatus = {
    configured: Boolean(row),
    lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
  };
  return status;
};

export const markCredentialsValidated = async (shop: string) => {
  await prisma.lalamoveShopCredential.updateMany({
    where: { shop },
    data: { lastValidatedAt: new Date() },
  });
};

const getEnvCredentials = (): LalamoveRuntimeCredentials | null => {
  const apiKey = process.env.LALAMOVE_API_KEY?.trim();
  const apiSecret = process.env.LALAMOVE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
};

export const getRuntimeCredentialsForShop = async (
  shop: string,
): Promise<LalamoveRuntimeCredentials | null> => {
  // Prefer per-shop credentials from DB when available (persistent across sessions)
  const fromDb = await getShopCredentials(shop);
  if (fromDb) return fromDb;
  // Fallback to env vars when no per-shop credentials are saved
  return getEnvCredentials();
};

export const redactSecret = (value: string | null | undefined) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 6) return "******";
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
};

/**
 * Returns API key display mask: *********** + last 4 chars (e.g. ***********k79a).
 * Used for Providers tab "if configured" display.
 */
export const getApiKeyDisplayMask = async (
  shop: string,
): Promise<string> => {
  const creds = await getShopCredentials(shop);
  if (!creds?.apiKey?.trim()) return "";
  const key = creds.apiKey.trim();
  if (key.length <= 4) return "******";
  return "***********" + key.slice(-4);
};
