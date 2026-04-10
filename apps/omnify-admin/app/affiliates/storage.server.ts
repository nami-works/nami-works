/**
 * Affiliates — Storage layer
 *
 * CRUD for affiliate profiles, sync meta, and BixGrow CSV import.
 * Pattern follows retail-footprint/analytics-queries.server.ts.
 */
import prisma from "../db.server";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AffiliateProfile = {
  id: string;
  shop: string;
  code: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  affiliateName: string;
  instagram: string | null;
  tiktok: string | null;
  city: string | null;
  state: string | null;
  program: string | null;
  referralCode: string | null;
  commissionPct: number;
  tier: string;
  status: string;
  paymentMethod: string | null;
  paymentInfo: string | null;
  bixgrowCreatedAt: string | null;
  lastLogin: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AffiliateSyncMeta = {
  status: "idle" | "running" | "failed";
  errorMessage: string | null;
  phase: string | null;
  progressCount: number | null;
  startedAt: string | null;
  lastSyncedAt: string | null;
  totalOrders: number | null;
  totalAffiliateOrders: number | null;
};

export type BixGrowImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
};

// ─── CSV Parsing Helper ─────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── Profiles ───────────────────────────────────────────────────────────────

export async function readAffiliateProfiles(
  shop: string,
): Promise<AffiliateProfile[]> {
  const rows = await prisma.affiliateProfile.findMany({
    where: { shop },
    orderBy: { affiliateName: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    shop: r.shop,
    code: r.code,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    affiliateName: r.affiliateName,
    instagram: r.instagram,
    tiktok: r.tiktok,
    city: r.city,
    state: r.state,
    program: r.program,
    referralCode: r.referralCode,
    commissionPct: r.commissionPct,
    tier: r.tier,
    status: r.status,
    paymentMethod: r.paymentMethod,
    paymentInfo: r.paymentInfo,
    bixgrowCreatedAt: r.bixgrowCreatedAt?.toISOString() ?? null,
    lastLogin: r.lastLogin?.toISOString() ?? null,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function upsertAffiliateProfile(
  shop: string,
  data: {
    code: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    affiliateName: string;
    instagram?: string | null;
    tiktok?: string | null;
    city?: string | null;
    state?: string | null;
    program?: string | null;
    referralCode?: string | null;
    commissionPct?: number;
    tier?: string;
    status?: string;
    paymentMethod?: string | null;
    paymentInfo?: string | null;
    bixgrowCreatedAt?: Date | null;
    lastLogin?: Date | null;
    notes?: string | null;
  },
): Promise<void> {
  const updateData: Record<string, unknown> = {
    email: data.email ?? null,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    affiliateName: data.affiliateName,
    instagram: data.instagram ?? null,
    tiktok: data.tiktok ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    program: data.program ?? null,
    referralCode: data.referralCode ?? null,
    paymentMethod: data.paymentMethod ?? null,
    paymentInfo: data.paymentInfo ?? null,
  };
  if (data.commissionPct != null) updateData.commissionPct = data.commissionPct;
  if (data.tier != null) updateData.tier = data.tier;
  if (data.status != null) updateData.status = data.status;
  if (data.bixgrowCreatedAt !== undefined) updateData.bixgrowCreatedAt = data.bixgrowCreatedAt;
  if (data.lastLogin !== undefined) updateData.lastLogin = data.lastLogin;
  if (data.notes !== undefined) updateData.notes = data.notes;

  await prisma.affiliateProfile.upsert({
    where: { shop_code: { shop, code: data.code } },
    create: {
      shop,
      code: data.code,
      ...updateData,
    } as any,
    update: updateData,
  });
}

export async function deleteAffiliateProfile(
  shop: string,
  profileId: string,
): Promise<void> {
  await prisma.affiliateProfile.delete({
    where: { id: profileId },
  });
  console.info(`[affiliates] deleteProfile OK shop=${shop} id=${profileId}`);
}

// ─── BixGrow CSV Import ─────────────────────────────────────────────────────

export async function importBixGrowCsv(
  shop: string,
  csvText: string,
): Promise<BixGrowImportResult> {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { imported: 0, skipped: 0, errors: ["CSV has no data rows"] };
  }

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map((h) => h.replace(/^"|"$/g, "").trim());

  const colIdx = (name: string) => {
    const idx = headers.findIndex(
      (h) => h.toLowerCase() === name.toLowerCase(),
    );
    return idx;
  };

  const iEmail = colIdx("Email");
  const iFirstName = colIdx("First Name");
  const iLastName = colIdx("Last Name");
  const iCity = colIdx("City");
  const iState = colIdx("State");
  const iInstagram = colIdx("Instagram");
  const iTiktok = colIdx("Tiktok");
  const iProgram = colIdx("Program");
  const iReferralCode = colIdx("Referral code");
  const iPaymentMethod = colIdx("Payment Method");
  const iPaymentInfo = colIdx("Payment Info");
  const iCoupons = colIdx("Coupons");
  const iStatus = colIdx("Status");
  const iDateCreated = colIdx("Date created");
  const iLastLogin = colIdx("Last login");

  if (iCoupons < 0) {
    return { imported: 0, skipped: 0, errors: ["Missing 'Coupons' column in CSV"] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const values: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const coupon = fields[iCoupons]?.trim() ?? "";
    if (!coupon) {
      skipped++;
      continue;
    }

    const esc = (v: string | undefined | null) => {
      if (!v || !v.trim()) return "NULL";
      return `'${v.trim().replace(/'/g, "''")}'`;
    };

    const firstName = fields[iFirstName]?.trim() ?? "";
    const lastName = fields[iLastName]?.trim() ?? "";
    const affiliateName = [firstName, lastName].filter(Boolean).join(" ") || coupon;
    const status = (fields[iStatus]?.trim() ?? "").toLowerCase() === "approved" ? "active" : (fields[iStatus]?.trim().toLowerCase() || "active");

    const parseDateField = (val: string | undefined): string => {
      if (!val?.trim()) return "NULL";
      const d = new Date(val.trim());
      return isNaN(d.getTime()) ? "NULL" : `'${d.toISOString()}'::timestamp`;
    };

    const shopEsc = shop.replace(/'/g, "''");
    const codeEsc = coupon.replace(/'/g, "''");
    // Generate a stable ID per row — raw SQL INSERT does not trigger Prisma @default(cuid()).
    // Use a prefix + base36 timestamp + random suffix to match cuid-like format.
    const rowId = `aff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${i}`;

    values.push(
      `('${rowId}', '${shopEsc}', '${codeEsc}', ${esc(fields[iEmail])}, ${esc(firstName)}, ${esc(lastName)}, '${affiliateName.replace(/'/g, "''")}', ${esc(fields[iInstagram])}, ${esc(fields[iTiktok])}, ${esc(fields[iCity])}, ${esc(fields[iState])}, ${esc(fields[iProgram])}, ${esc(fields[iReferralCode])}, '${status.replace(/'/g, "''")}', ${esc(fields[iPaymentMethod])}, ${esc(fields[iPaymentInfo])}, ${parseDateField(fields[iDateCreated])}, ${parseDateField(fields[iLastLogin])}, NOW(), NOW())`,
    );
    imported++;
  }

  if (values.length > 0) {
    // Batch in chunks of 500
    const BATCH_SIZE = 500;
    for (let start = 0; start < values.length; start += BATCH_SIZE) {
      const batch = values.slice(start, start + BATCH_SIZE);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AffiliateProfile" ("id", "shop", "code", "email", "firstName", "lastName", "affiliateName", "instagram", "tiktok", "city", "state", "program", "referralCode", "status", "paymentMethod", "paymentInfo", "bixgrowCreatedAt", "lastLogin", "createdAt", "updatedAt")
        VALUES ${batch.join(",\n")}
        ON CONFLICT ("shop", "code") DO UPDATE SET
          "email" = EXCLUDED."email",
          "firstName" = EXCLUDED."firstName",
          "lastName" = EXCLUDED."lastName",
          "affiliateName" = EXCLUDED."affiliateName",
          "instagram" = EXCLUDED."instagram",
          "tiktok" = EXCLUDED."tiktok",
          "city" = EXCLUDED."city",
          "state" = EXCLUDED."state",
          "program" = EXCLUDED."program",
          "referralCode" = EXCLUDED."referralCode",
          "status" = EXCLUDED."status",
          "paymentMethod" = EXCLUDED."paymentMethod",
          "paymentInfo" = EXCLUDED."paymentInfo",
          "bixgrowCreatedAt" = EXCLUDED."bixgrowCreatedAt",
          "lastLogin" = EXCLUDED."lastLogin",
          "updatedAt" = NOW()
      `);
    }
  }

  console.info(`[affiliates] importBixGrowCsv OK shop=${shop} imported=${imported} skipped=${skipped}`);
  return { imported, skipped, errors };
}

// ─── Sync Meta ──────────────────────────────────────────────────────────────

export async function readAffiliateSyncMeta(
  shop: string,
): Promise<AffiliateSyncMeta> {
  const row = await prisma.affiliateSyncMeta.findUnique({ where: { shop } });
  if (!row) {
    return {
      status: "idle",
      errorMessage: null,
      phase: null,
      progressCount: null,
      startedAt: null,
      lastSyncedAt: null,
      totalOrders: null,
      totalAffiliateOrders: null,
    };
  }
  return {
    status: row.status as AffiliateSyncMeta["status"],
    errorMessage: row.errorMessage ?? null,
    phase: row.phase ?? null,
    progressCount: row.progressCount ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    totalOrders: row.totalOrders ?? null,
    totalAffiliateOrders: row.totalAffiliateOrders ?? null,
  };
}

export async function writeAffiliateSyncMeta(
  shop: string,
  status: "idle" | "running" | "failed",
  opts?: {
    errorMessage?: string | null;
    phase?: string | null;
    progressCount?: number | null;
    totalOrders?: number;
    totalAffiliateOrders?: number;
  },
): Promise<void> {
  const data: Record<string, unknown> = {
    status,
    errorMessage: opts?.errorMessage ?? null,
  };
  if (status === "running") {
    data.startedAt = new Date();
    data.phase = opts?.phase ?? null;
    data.progressCount = opts?.progressCount ?? null;
  }
  if (status === "idle") {
    data.phase = null;
    data.progressCount = null;
    data.lastSyncedAt = new Date();
    if (opts?.totalOrders != null) data.totalOrders = opts.totalOrders;
    if (opts?.totalAffiliateOrders != null) data.totalAffiliateOrders = opts.totalAffiliateOrders;
  }
  if (status === "failed") {
    data.phase = null;
    data.progressCount = null;
  }

  await prisma.affiliateSyncMeta.upsert({
    where: { shop },
    create: { shop, ...data } as any,
    update: data,
  });
}

export async function writeAffiliateSyncProgress(
  shop: string,
  phase: string,
  count: number,
): Promise<void> {
  await prisma.affiliateSyncMeta.upsert({
    where: { shop },
    create: { shop, status: "running", phase, progressCount: count } as any,
    update: { phase, progressCount: count },
  });
}
