import drive, { type drive_v3 } from "@googleapis/drive";
import { GoogleAuth } from "google-auth-library";
import { getSecret } from "../secrets/ssm.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
};

export type GoogleDriveClient = {
  listFolderContents(folderId: string): Promise<DriveFile[]>;
  downloadFile(fileId: string): Promise<Buffer>;
};

type CacheEntry = { client: GoogleDriveClient; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export type GoogleDriveClientArgs = {
  ssmPrefix: string;
};

export async function getGoogleDriveClient(
  args: GoogleDriveClientArgs,
): Promise<GoogleDriveClient> {
  const key = args.ssmPrefix;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.client;

  const credsJson = await getSecret(
    `${args.ssmPrefix}/google_drive/service_account_json`,
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(credsJson);
  } catch {
    throw new Error(
      "google_drive/service_account_json in SSM is not valid JSON.",
    );
  }

  const auth = new GoogleAuth({
    credentials: parsed,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const sdk = drive.drive({ version: "v3", auth });

  const client: GoogleDriveClient = {
    async listFolderContents(folderId: string): Promise<DriveFile[]> {
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        // Drive list query: files whose parent IS this folder, not in trash.
        // includeItemsFromAllDrives + supportsAllDrives are required to see
        // shared-drive folders (gebeauty's "Drives compartilhados" is one).
        const params: drive_v3.Params$Resource$Files$List = {
          q: `'${folderId}' in parents and trashed = false`,
          fields:
            "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
          pageSize: 100,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          corpora: "allDrives",
          ...(pageToken ? { pageToken } : {}),
        };
        const res = await sdk.files.list(params);
        for (const f of res.data.files ?? []) {
          if (!f.id || !f.name) continue;
          out.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType ?? "application/octet-stream",
            size: f.size ? Number(f.size) : 0,
            modifiedTime: f.modifiedTime ?? "",
          });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },

    async downloadFile(fileId: string): Promise<Buffer> {
      const res = await sdk.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      );
      // Per @googleapis types, response.data is typed broadly; with
      // responseType: "arraybuffer" it's an ArrayBuffer at runtime.
      const data = res.data as unknown;
      if (data instanceof ArrayBuffer) {
        return Buffer.from(data);
      }
      if (Buffer.isBuffer(data)) return data;
      if (data instanceof Uint8Array) return Buffer.from(data);
      throw new Error(
        `Unexpected response type from Drive download: ${typeof data}`,
      );
    },
  };

  cache.set(key, { client, expiresAt: now + DEFAULT_TTL_MS });
  return client;
}

export function __clearGoogleDriveClientCacheForTesting(): void {
  cache.clear();
}
