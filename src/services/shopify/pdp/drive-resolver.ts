import type { GoogleDriveClient } from "../../../clients/google-drive.js";
import type { ImageSlotRole } from "./types.js";

/**
 * Match files in a Google Drive folder to PDP image roles.
 *
 * Phase A produces just the mapping — the staged upload to Shopify happens in
 * Phase C (image-uploader service). This tool exists so operators can stage
 * a Drive folder once, confirm the role mapping is correct, then hand the
 * resolved mapping into the create tool without re-listing Drive.
 *
 * Filename convention (recommended for autoMatch):
 *   hero_*.{jpg,png}          → hero
 *   magazine_*                → magazine
 *   raw_bottle_* / bottle_*   → raw_bottle
 *   application_*             → application
 *   ingredients_*             → ingredients
 *   antes_depois_* / before_after_*  → antes_depois_combined
 *   social_proof_* / review_*        → social_proof
 *
 * Explicit `mapping` (role → exact filename) always wins over autoMatch.
 */

export type ResolvableImageSlot = Exclude<ImageSlotRole, "unknown">;

const ROLE_PREFIXES: ReadonlyArray<[ResolvableImageSlot, readonly string[]]> = [
  ["hero", ["hero_", "hero-"]],
  ["magazine", ["magazine_", "magazine-", "press_", "press-", "elle_", "elle-"]],
  ["raw_bottle", ["raw_bottle_", "raw_bottle-", "bottle_", "bottle-"]],
  ["application", ["application_", "application-", "modo_de_uso_", "modo-de-uso-"]],
  ["ingredients", ["ingredients_", "ingredients-", "ingredientes_", "formula_"]],
  ["antes_depois_combined", ["antes_depois_", "antes-depois-", "before_after_", "before-after-"]],
  ["social_proof", ["social_proof_", "social-proof-", "review_", "review-", "ugc_"]],
];

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

export type DriveResolution = {
  driveFolderId: string;
  /** Files matched to a slot role. */
  matched: Array<{
    role: ResolvableImageSlot;
    driveFileId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    matchedBy: "explicit" | "prefix";
  }>;
  /** Image files that didn't match any role (operator must map or ignore). */
  unmatched: Array<{
    driveFileId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  /** Slot roles with no file assigned. */
  missingRoles: ResolvableImageSlot[];
  /** Non-image files in the folder, ignored. */
  ignored: Array<{ driveFileId: string; filename: string; mimeType: string }>;
};

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
}

function isImageExt(filename: string): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function matchByPrefix(filename: string): ResolvableImageSlot | null {
  const lower = filename.toLowerCase();
  for (const [role, prefixes] of ROLE_PREFIXES) {
    if (prefixes.some((p) => lower.startsWith(p))) return role;
  }
  return null;
}

export async function resolveDriveImages(args: {
  drive: GoogleDriveClient;
  driveFolderId: string;
  /** role → exact filename. Wins over autoMatch. */
  explicitMapping?: Partial<Record<ResolvableImageSlot, string>>;
  /** When true, applies prefix-based matching to unmapped files. Default true. */
  autoMatch?: boolean;
  /** Which roles are required. Default: hero, raw_bottle, application. */
  requiredRoles?: ResolvableImageSlot[];
}): Promise<DriveResolution> {
  const autoMatch = args.autoMatch ?? true;
  const requiredRoles = args.requiredRoles ?? ["hero", "raw_bottle", "application"];

  const files = await args.drive.listFolderContents(args.driveFolderId);

  const matched: DriveResolution["matched"] = [];
  const unmatched: DriveResolution["unmatched"] = [];
  const ignored: DriveResolution["ignored"] = [];
  const assignedRoles = new Set<ResolvableImageSlot>();

  // First pass: explicit mapping.
  const explicitFilenames = new Set<string>();
  if (args.explicitMapping) {
    for (const [roleStr, filename] of Object.entries(args.explicitMapping)) {
      if (!filename) continue;
      const role = roleStr as ResolvableImageSlot;
      const file = files.find((f) => f.name === filename);
      if (!file) continue;
      explicitFilenames.add(filename);
      matched.push({
        role,
        driveFileId: file.id,
        filename: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        matchedBy: "explicit",
      });
      assignedRoles.add(role);
    }
  }

  // Second pass: prefix-based autoMatch on remaining files.
  for (const file of files) {
    if (explicitFilenames.has(file.name)) continue;
    if (!isImageMime(file.mimeType) && !isImageExt(file.name)) {
      ignored.push({
        driveFileId: file.id,
        filename: file.name,
        mimeType: file.mimeType,
      });
      continue;
    }
    if (!autoMatch) {
      unmatched.push({
        driveFileId: file.id,
        filename: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.size,
      });
      continue;
    }
    const role = matchByPrefix(file.name);
    if (role && !assignedRoles.has(role)) {
      matched.push({
        role,
        driveFileId: file.id,
        filename: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        matchedBy: "prefix",
      });
      assignedRoles.add(role);
    } else {
      unmatched.push({
        driveFileId: file.id,
        filename: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.size,
      });
    }
  }

  const missingRoles = requiredRoles.filter((r) => !assignedRoles.has(r));

  return {
    driveFolderId: args.driveFolderId,
    matched,
    unmatched,
    missingRoles,
    ignored,
  };
}
