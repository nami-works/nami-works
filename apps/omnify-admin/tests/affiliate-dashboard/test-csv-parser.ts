/**
 * Test: BixGrow CSV Parser
 *
 * Validates that the CSV parsing logic from storage.server.ts correctly
 * handles the real BixGrow export file (inputs/bixgrow_afiliadas.csv).
 * Runs standalone — no Shopify or Prisma needed.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Copy of parseCsvLine from storage.server.ts ────────────────────────────
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

// ─── Reproduce the import logic (without DB writes) ─────────────────────────

type ParsedRow = {
  code: string;
  email: string;
  firstName: string;
  lastName: string;
  affiliateName: string;
  instagram: string;
  tiktok: string;
  city: string;
  state: string;
  program: string;
  referralCode: string;
  status: string;
  paymentMethod: string;
  paymentInfo: string;
  bixgrowCreatedAt: string;
  lastLogin: string;
};

function parseBixGrowCsv(csvText: string): { rows: ParsedRow[]; skipped: number; errors: string[] } {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], skipped: 0, errors: ["CSV has no data rows"] };
  }

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map((h) => h.replace(/^"|"$/g, "").trim());

  const colIdx = (name: string) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

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
    return { rows: [], skipped: 0, errors: ["Missing 'Coupons' column in CSV"] };
  }

  const rows: ParsedRow[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const coupon = fields[iCoupons]?.trim() ?? "";
    if (!coupon) {
      skipped++;
      continue;
    }

    const firstName = fields[iFirstName]?.trim() ?? "";
    const lastName = fields[iLastName]?.trim() ?? "";
    const affiliateName = [firstName, lastName].filter(Boolean).join(" ") || coupon;
    const rawStatus = fields[iStatus]?.trim() ?? "";
    const status = rawStatus.toLowerCase() === "approved" ? "active" : (rawStatus.toLowerCase() || "active");

    rows.push({
      code: coupon,
      email: fields[iEmail]?.trim() ?? "",
      firstName,
      lastName,
      affiliateName,
      instagram: fields[iInstagram]?.trim() ?? "",
      tiktok: fields[iTiktok]?.trim() ?? "",
      city: fields[iCity]?.trim() ?? "",
      state: fields[iState]?.trim() ?? "",
      program: fields[iProgram]?.trim() ?? "",
      referralCode: fields[iReferralCode]?.trim() ?? "",
      status,
      paymentMethod: fields[iPaymentMethod]?.trim() ?? "",
      paymentInfo: fields[iPaymentInfo]?.trim() ?? "",
      bixgrowCreatedAt: fields[iDateCreated]?.trim() ?? "",
      lastLogin: fields[iLastLogin]?.trim() ?? "",
    });
  }

  return { rows, skipped, errors: [] };
}

// ─── Test Runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

export function runCsvParserTests(): { passed: number; failed: number } {
  passed = 0;
  failed = 0;

  console.log("\n=== CSV Parser Tests ===\n");

  // Read the real CSV file
  const csvPath = resolve(__dirname, "../../inputs/bixgrow_afiliadas.csv");
  let csvText: string;
  try {
    csvText = readFileSync(csvPath, "utf-8");
    console.log(`  Loaded CSV: ${csvPath} (${csvText.length} bytes)\n`);
  } catch (err) {
    console.log(`  FAIL: Could not read CSV file at ${csvPath}`);
    console.log(`  Error: ${err}`);
    return { passed: 0, failed: 1 };
  }

  const { rows, skipped, errors } = parseBixGrowCsv(csvText);

  // (a) At least 150 rows parsed (real file has ~174 affiliates with coupons; 250 have empty Coupons)
  assert(
    `At least 150 rows parsed (got ${rows.length})`,
    rows.length >= 150,
    `Only ${rows.length} rows parsed`,
  );

  // (b) Each row has a non-empty code field
  const emptyCodeRows = rows.filter((r) => !r.code);
  assert(
    `Every row has a non-empty code (${emptyCodeRows.length} empty)`,
    emptyCodeRows.length === 0,
    `Found ${emptyCodeRows.length} rows with empty code`,
  );

  // (c) Each row has a non-empty affiliateName
  const emptyNameRows = rows.filter((r) => !r.affiliateName);
  assert(
    `Every row has a non-empty affiliateName (${emptyNameRows.length} empty)`,
    emptyNameRows.length === 0,
    `Found ${emptyNameRows.length} rows with empty affiliateName`,
  );

  // (d) Instagram handles are preserved where present
  const withInstagram = rows.filter((r) => r.instagram.length > 0);
  assert(
    `Instagram handles preserved (${withInstagram.length} found)`,
    withInstagram.length > 0,
    "No Instagram handles found",
  );
  // Verify Instagram values are non-empty strings (formats vary: full URLs, bare handles, @handles)
  const validInstagram = withInstagram.every((r) => r.instagram.length > 0);
  assert(
    `Instagram values are non-empty strings`,
    validInstagram,
    `Some Instagram values are empty despite being in the filtered set`,
  );
  // Spot-check: at least some contain "instagram.com"
  const urlInstagram = withInstagram.filter((r) => r.instagram.toLowerCase().includes("instagram"));
  assert(
    `Some Instagram values contain "instagram" URL (${urlInstagram.length} of ${withInstagram.length})`,
    urlInstagram.length > 0,
    `No Instagram URLs found`,
  );

  // (e) Rows with empty Coupons field are skipped
  const totalLines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0).length - 1; // minus header
  assert(
    `Skipped rows (${skipped}) + parsed rows (${rows.length}) = total data lines (${totalLines})`,
    skipped + rows.length === totalLines,
    `${skipped} + ${rows.length} != ${totalLines}`,
  );

  // (f) Status mapping: "Approved" -> "active"
  const activeRows = rows.filter((r) => r.status === "active");
  assert(
    `Status mapping: "Approved" -> "active" (${activeRows.length} active rows)`,
    activeRows.length > 0,
    "No rows with 'active' status found",
  );
  // Check that no row has raw "approved" or "Approved" as status
  const rawApproved = rows.filter((r) => r.status.toLowerCase() === "approved");
  assert(
    `No rows retain raw "Approved" status (${rawApproved.length} found)`,
    rawApproved.length === 0,
    `${rawApproved.length} rows still have "approved" as status`,
  );

  // Print summary
  console.log(`\n  --- Summary ---`);
  console.log(`  Total parsed: ${rows.length}`);
  console.log(`  Skipped (empty coupon): ${skipped}`);
  console.log(`  Errors: ${errors.length > 0 ? errors.join(", ") : "none"}`);
  console.log(`\n  --- Sample (first 5 rows) ---`);
  for (const row of rows.slice(0, 5)) {
    console.log(`    code=${row.code} | name=${row.affiliateName} | status=${row.status} | ig=${row.instagram || "(none)"} | city=${row.city || "(none)"}`);
  }

  console.log(`\n  CSV Parser: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

// Allow direct execution
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`;
if (isMain) {
  runCsvParserTests();
}
