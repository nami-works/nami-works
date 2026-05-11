import { Prisma, type PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import {
  getInstagramClient,
  type IgMedia,
  type InstagramClient,
} from "../../clients/instagram.js";
import { getSecret } from "../../secrets/ssm.js";
import { rootLogger } from "../../lib/logger.js";

/**
 * Read-only Instagram ingest. Pulls a tenant's own media (captions, media
 * URLs, engagement counts) into Postgres.
 *
 * Usage: call `ingestInstagramPosts({ tenantId, prisma })` from a scheduled
 * job (nightly is plenty for gebeauty-scale posting cadence). Incremental
 * mode uses the most-recent `postedAt` we've stored as the `since` cursor;
 * pass `mode: "full"` once on first connect to backfill the 10k-item window.
 *
 * Idempotent: each row is upserted by `(tenantId, igMediaId)`. Re-running
 * the same job updates engagement counts on existing posts.
 *
 * Caveats:
 * - `mediaUrl` and `thumbnailUrl` are signed CDN URLs that **expire**. Treat
 *   anything in the DB older than ~24h as stale; the fix is to download to
 *   our own bucket during ingest, which is the next phase.
 * - Stories are not returned by `/media` (separate `/stories` edge, 24h TTL).
 *   Out of scope for tone-of-voice; revisit if we ever want story copy.
 */

export type IngestArgs = {
  tenantId: string;
  prisma: PrismaClient;
  /** Override the client (tests). */
  client?: InstagramClient;
  /** "incremental" (default) — since the latest stored post. "full" — backfill. */
  mode?: "incremental" | "full";
  /** Cap pages fetched in one run; safety belt. Default 20 pages × 50 = 1k. */
  maxPages?: number;
  logger?: Logger;
};

export type IngestResult = {
  tenantSlug: string;
  igUserId: string;
  username: string | null;
  pagesFetched: number;
  postsInserted: number;
  postsUpdated: number;
  oldestPostedAt: Date | null;
  newestPostedAt: Date | null;
  tokenExpiresInDays: number | null;
};

export async function ingestInstagramPosts(args: IngestArgs): Promise<IngestResult> {
  const { tenantId, prisma } = args;
  const mode = args.mode ?? "incremental";
  const maxPages = args.maxPages ?? 20;

  const tenant = await prisma.integrationTenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { instagramAccount: true },
  });
  const log = (args.logger ?? rootLogger).child({
    tenant: tenant.slug,
    component: "instagram-ingest",
  });

  if (!tenant.instagramAccount) {
    throw new Error(
      `Tenant ${tenant.slug} has no InstagramAccount row. Insert one with the tenant's igUserId before running ingest.`,
    );
  }
  const account = tenant.instagramAccount;

  const client = args.client ?? (await getInstagramClient({ ssmPrefix: tenant.ssmPrefix }));

  const tokenExpiresInDays = await checkTokenExpiry(tenant.ssmPrefix, log);

  let since: number | undefined;
  if (mode === "incremental") {
    const latest = await prisma.instagramPost.findFirst({
      where: { tenantId },
      orderBy: { postedAt: "desc" },
      select: { postedAt: true },
    });
    if (latest) since = Math.floor(latest.postedAt.getTime() / 1000);
  }

  let after: string | undefined;
  let pagesFetched = 0;
  let postsInserted = 0;
  let postsUpdated = 0;
  let oldestPostedAt: Date | null = null;
  let newestPostedAt: Date | null = null;

  while (pagesFetched < maxPages) {
    const page = await client.listMedia({
      igUserId: account.igUserId,
      ...(after ? { after } : {}),
      ...(since ? { since } : {}),
      limit: 50,
    });
    pagesFetched += 1;

    for (const item of page.data) {
      const result = await upsertPost(prisma, tenantId, item);
      if (result === "inserted") postsInserted += 1;
      else postsUpdated += 1;

      const postedAt = new Date(item.timestamp);
      if (!oldestPostedAt || postedAt < oldestPostedAt) oldestPostedAt = postedAt;
      if (!newestPostedAt || postedAt > newestPostedAt) newestPostedAt = postedAt;
    }

    const next = page.paging?.cursors?.after;
    if (!next || page.data.length === 0) break;
    after = next;
  }

  await prisma.instagramAccount.update({
    where: { tenantId },
    data: {
      lastSyncedAt: new Date(),
      ...(after ? { lastCursor: after } : {}),
    },
  });

  log.info(
    {
      pagesFetched,
      postsInserted,
      postsUpdated,
      oldestPostedAt,
      newestPostedAt,
      mode,
    },
    "instagram ingest complete",
  );

  return {
    tenantSlug: tenant.slug,
    igUserId: account.igUserId,
    username: account.username,
    pagesFetched,
    postsInserted,
    postsUpdated,
    oldestPostedAt,
    newestPostedAt,
    tokenExpiresInDays,
  };
}

async function upsertPost(
  prisma: PrismaClient,
  tenantId: string,
  item: IgMedia,
): Promise<"inserted" | "updated"> {
  const existing = await prisma.instagramPost.findUnique({
    where: { tenantId_igMediaId: { tenantId, igMediaId: item.id } },
    select: { id: true },
  });

  const data = {
    mediaType: item.media_type,
    caption: item.caption ?? null,
    permalink: item.permalink ?? null,
    mediaUrl: item.media_url ?? null,
    thumbnailUrl: item.thumbnail_url ?? null,
    postedAt: new Date(item.timestamp),
    likeCount: item.like_count ?? null,
    commentsCount: item.comments_count ?? null,
    children: item.children
      ? (item.children as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    raw: item as unknown as Prisma.InputJsonValue,
    syncedAt: new Date(),
  };

  if (existing) {
    await prisma.instagramPost.update({
      where: { tenantId_igMediaId: { tenantId, igMediaId: item.id } },
      data,
    });
    return "updated";
  }
  await prisma.instagramPost.create({
    data: { tenantId, igMediaId: item.id, ...data },
  });
  return "inserted";
}

/**
 * Reads `${ssmPrefix}/instagram/token_expires_at` (ISO 8601) if present and
 * returns days remaining. Logs a warn at <= 7 days. Best-effort: the secret
 * being missing is not fatal, but ingest should yell when the token's about
 * to die so we can refresh before tenants notice.
 */
async function checkTokenExpiry(
  ssmPrefix: string,
  log: Logger,
): Promise<number | null> {
  try {
    const iso = await getSecret(`${ssmPrefix}/instagram/token_expires_at`);
    const expiresAt = new Date(iso);
    if (Number.isNaN(expiresAt.getTime())) return null;
    const days = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
    if (days <= 7) {
      log.warn({ days, expiresAt }, "instagram long-lived token expiring soon");
    }
    return days;
  } catch {
    return null;
  }
}
