import crypto from "crypto";

type KeyMaterial = {
  version: number;
  key: Buffer;
};

type EncryptedPayload = {
  v: number;
  iv: string;
  tag: string;
  ct: string;
};

const parseKey = (raw: string, source: string): Buffer => {
  const trimmed = raw.trim();
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${source} must be base64 for a 32-byte key (AES-256-GCM).`,
    );
  }
  return key;
};

const readKeyRing = (): { current: KeyMaterial; all: Map<number, Buffer> } => {
  const currentRaw = process.env.APP_ENCRYPTION_KEY?.trim();
  const versionRaw = process.env.APP_ENCRYPTION_KEY_VERSION?.trim() ?? "1";
  const currentVersion = Number(versionRaw);
  if (!currentRaw || !Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error(
      "Add APP_ENCRYPTION_KEY to your environment (base64-encoded 32-byte key for AES-256-GCM) to enable credential storage. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\". See README for setup.",
    );
  }

  const all = new Map<number, Buffer>();
  all.set(currentVersion, parseKey(currentRaw, "APP_ENCRYPTION_KEY"));

  const previous = process.env.APP_PREVIOUS_ENCRYPTION_KEYS?.trim();
  if (previous) {
    previous
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const [versionPart, keyPart] = pair.split(":");
        const version = Number(versionPart?.trim());
        if (!Number.isInteger(version) || version < 1 || !keyPart) {
          throw new Error(
            "APP_PREVIOUS_ENCRYPTION_KEYS must use format 'version:base64,version:base64'.",
          );
        }
        if (!all.has(version)) {
          all.set(version, parseKey(keyPart, `APP_PREVIOUS_ENCRYPTION_KEYS:${version}`));
        }
      });
  }

  return {
    current: {
      version: currentVersion,
      key: all.get(currentVersion)!,
    },
    all,
  };
};

export const assertEncryptionConfigured = () => {
  readKeyRing();
};

export const assertLalamoveEncryptionConfigured = () => {
  const flag = process.env.LALAMOVE_PER_SHOP_CREDENTIALS === "true";
  if (flag) {
    readKeyRing();
  }
};

export const encryptSecret = (value: string): { ciphertext: string; keyVersion: number } => {
  const { current } = readKeyRing();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", current.key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    v: current.version,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
  return {
    ciphertext: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    keyVersion: current.version,
  };
};

export const decryptSecret = (ciphertext: string): string => {
  const parsed = JSON.parse(
    Buffer.from(ciphertext, "base64").toString("utf8"),
  ) as EncryptedPayload;
  const { all } = readKeyRing();
  const key = all.get(parsed.v);
  if (!key) {
    throw new Error("Unable to decrypt value with current key ring.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(parsed.ct, "base64")),
    decipher.final(),
  ]);
  return clear.toString("utf8");
};
