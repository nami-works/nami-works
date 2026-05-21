import { z } from "zod";
import { getGoogleDriveClient } from "../../clients/google-drive.js";
import {
  resolveDriveImages,
  type ResolvableImageSlot,
} from "../../services/shopify/pdp/drive-resolver.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const ROLE_OPTIONS = [
  "hero",
  "magazine",
  "raw_bottle",
  "application",
  "ingredients",
  "antes_depois_combined",
  "social_proof",
] as const;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export async function pdpResolveDriveImagesHandler(
  args: {
    driveFolderId: string;
    explicitMapping?: Record<string, string> | undefined;
    autoMatch?: boolean | undefined;
    requiredRoles?: (typeof ROLE_OPTIONS)[number][] | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const drive = await getGoogleDriveClient({ ssmPrefix: ctx.tenant.ssmPrefix });

  // Narrow user-supplied mapping to valid roles.
  let explicit: Partial<Record<ResolvableImageSlot, string>> | undefined;
  if (args.explicitMapping) {
    explicit = {};
    for (const [k, v] of Object.entries(args.explicitMapping)) {
      if ((ROLE_OPTIONS as readonly string[]).includes(k) && typeof v === "string") {
        explicit[k as ResolvableImageSlot] = v;
      }
    }
  }

  const resolution = await resolveDriveImages({
    drive,
    driveFolderId: args.driveFolderId,
    ...(explicit ? { explicitMapping: explicit } : {}),
    autoMatch: args.autoMatch ?? true,
    ...(args.requiredRoles ? { requiredRoles: args.requiredRoles } : {}),
  });

  const lines: string[] = [];
  lines.push(`Drive folder ${args.driveFolderId} — image resolution`);
  lines.push(``);

  if (resolution.matched.length > 0) {
    lines.push(`Matched (${resolution.matched.length}):`);
    for (const m of resolution.matched) {
      lines.push(
        `  ✓ ${m.role.padEnd(24)} → ${m.filename} (${fmtBytes(m.sizeBytes)}, ${m.mimeType}, via ${m.matchedBy})`,
      );
    }
    lines.push(``);
  }

  if (resolution.missingRoles.length > 0) {
    lines.push(`⚠️  Missing required roles (${resolution.missingRoles.length}):`);
    for (const r of resolution.missingRoles) lines.push(`  - ${r}`);
    lines.push(
      `  → Add files matching the prefix (e.g. "hero_*.jpg") or pass them in explicitMapping.`,
    );
    lines.push(``);
  } else {
    lines.push(`✓ All required roles matched.`);
    lines.push(``);
  }

  if (resolution.unmatched.length > 0) {
    lines.push(`Unmatched image files (${resolution.unmatched.length}):`);
    for (const u of resolution.unmatched) {
      lines.push(`  ? ${u.filename} (${fmtBytes(u.sizeBytes)}, ${u.mimeType})`);
    }
    lines.push(
      `  → Either map explicitly to a role or ignore. Filename prefix conventions: hero_, magazine_, raw_bottle_, application_, ingredients_, antes_depois_, social_proof_.`,
    );
    lines.push(``);
  }

  if (resolution.ignored.length > 0) {
    lines.push(`Non-image files (ignored, ${resolution.ignored.length}):`);
    for (const i of resolution.ignored) lines.push(`  · ${i.filename} (${i.mimeType})`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_pdp_resolve_drive_images",
  description:
    "Lists a Google Drive folder and matches its image files to PDP image slot roles (hero, magazine, raw_bottle, application, ingredients, antes_depois_combined, social_proof). Auto-matches by filename prefix; explicitMapping wins over auto-match. Read-only — does NOT upload anything. Output feeds into the Phase C create tool.",
  inputSchema: {
    driveFolderId: z
      .string()
      .min(1)
      .describe("Google Drive folder ID containing the PDP image set."),
    explicitMapping: z
      .record(z.string())
      .optional()
      .describe("Optional role → filename map, e.g. { hero: 'main.jpg' }. Wins over auto-match."),
    autoMatch: z
      .boolean()
      .optional()
      .describe("If true (default), match by filename prefix for files not in explicitMapping."),
    requiredRoles: z
      .array(z.enum(ROLE_OPTIONS))
      .optional()
      .describe("Roles that must be matched. Default: hero, raw_bottle, application."),
  },
  handler: pdpResolveDriveImagesHandler,
});
