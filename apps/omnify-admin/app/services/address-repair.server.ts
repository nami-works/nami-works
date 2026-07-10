/**
 * Address-repair patterns for Brazilian PT-BR Shopify shipping addresses.
 *
 * TypeScript port of `gebeauty/scripts/address_repair.py`.
 * Implements the four §6.7 patterns from LOCAL-DELIVERY-PLAYBOOK.md as pure
 * functions. Used by the local-delivery pipeline to autofix orders BEFORE
 * tagging them with `ld_confirm-address` for human review.
 *
 * The four patterns (precedence order: P1 → P4 → P2 → P3, most-specific first):
 *   p1: trailing pure-number duplicate
 *       e.g. "Av Itaberaba, 1515, Ap82 B, ⁠82" → drop trailing "82"
 *   p4: apt-prefix-before-street-number
 *       e.g. "Rua da Passagem ap 805, ⁠114" → "Rua da Passagem, 114"
 *   p2: apt-indicator + matching number in address2
 *       e.g. "Avenida X, 611, Bl2apt1602" + a2 has "1602"
 *   p3: building-number-by-elimination (medium confidence)
 *       exactly 2 numbers in a1, one duplicated in a2 → that's the apartment
 *
 * Pure functions — no Shopify writes happen here. The caller applies via
 * orderUpdate + addTags. See `applyAddressRepairOrTag` for the integration
 * helper that wires the repair decision into the existing flag-and-tag flow.
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { addTags } from "./lalamove-sync.server";
import { LD_ADDRESS_CONFIRM_TAG, LD_NUMBER_CONFIRM_TAG } from "./lalamove-tags";

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

export type RepairPattern = "p1" | "p2" | "p3" | "p4";
export type RepairConfidence = "high" | "medium";
export type RepairFailureReason = "duplicated-number-ambiguous" | "no-pattern-matched";

export type AddressRepairResult =
  | {
      ok: true;
      corrected: { address1: string; address2: string };
      pattern: RepairPattern;
      confidence: RepairConfidence;
      explanation: string;
    }
  | {
      ok: false;
      reason: RepairFailureReason;
      explanation: string;
    };

// ──────────────────────────────────────────────────────────────────────
// Constants — must stay in lockstep with address_repair.py
// ──────────────────────────────────────────────────────────────────────

const APT_PREFIX_WORDS = ["ap", "apt", "apto", "bl", "bloco", "casa", "sala", "conjunto", "conj"];
const APT_PREFIX_PATTERN = "(?:Ap\\.?|Apt\\.?|Apto\\.?|Bl\\.?|Bloco|Casa|Sala|Conjunto|Conj\\.?)";

const EXPAND_INDICATOR: Record<string, string> = {
  ap: "Apto",
  apt: "Apto",
  apto: "Apto",
  bl: "Bloco",
  bloco: "Bloco",
  casa: "Casa",
  sala: "Sala",
  conjunto: "Conjunto",
  conj: "Conjunto",
};

// ──────────────────────────────────────────────────────────────────────
// Helpers (mirror Python `_segments`, `_digit_groups`, etc.)
// ──────────────────────────────────────────────────────────────────────

function segments(s: string): string[] {
  return (s ?? "")
    .split(",")
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);
}

function digitGroups(s: string): string[] {
  if (!s) return [];
  return s.match(/\d+/g) ?? [];
}

function isPureNumber(s: string): boolean {
  // Digits, possibly followed by an optional letter suffix (e.g. "174 B").
  return /^\d+\s*[A-Za-z]?$/.test((s ?? "").trim());
}

function hasAptIndicator(seg: string): boolean {
  return new RegExp(APT_PREFIX_PATTERN + "\\s*\\d", "i").test(seg);
}

function normalizeIndicator(prefix: string): string {
  const key = prefix.toLowerCase().replace(/\.+$/g, "").trim();
  return EXPAND_INDICATOR[key] ?? prefix;
}

function extractAptComponents(seg: string): Array<[string, string]> {
  const re = new RegExp("(" + APT_PREFIX_PATTERN + ")\\.?\\s*(\\d+)", "gi");
  const out: Array<[string, string]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) {
    out.push([m[1], m[2]]);
  }
  return out;
}

/**
 * Strip zero-width unicode (Word Joiner U+2060, Zero Width Space U+200B,
 * ZWNJ U+200C, ZWJ U+200D) that Shopify embeds in Brazilian addresses.
 * These are invisible but break digit-string matching since trim() doesn't
 * remove them.
 */
// U+2060 Word Joiner, U+200B Zero Width Space, U+200C ZWNJ, U+200D ZWJ.
// Built via String.fromCharCode to avoid embedding irregular whitespace
// directly in the source (eslint no-irregular-whitespace).
const ZERO_WIDTH_RE = new RegExp(
  "[" +
    String.fromCharCode(0x2060) +
    String.fromCharCode(0x200b) +
    String.fromCharCode(0x200c) +
    String.fromCharCode(0x200d) +
    "]",
  "g",
);
function stripZeroWidth(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(ZERO_WIDTH_RE, "");
}

function failure(reason: RepairFailureReason, explanation: string): AddressRepairResult {
  return { ok: false, reason, explanation };
}

// ──────────────────────────────────────────────────────────────────────
// Pattern functions (exported for direct testing)
// ──────────────────────────────────────────────────────────────────────

/**
 * §6.7 Pattern 1 — trailing pure-number duplicate of another number in a1.
 * a1 = "Av Itaberaba, 1515, Ap82 B, ⁠82" → drop trailing "82".
 * Trigger: ≥3 segments AND last segment is pure number AND that number
 * appears in another a1 segment (Shopify auto-appended duplicate).
 */
export function tryPattern1(a1: string, a2: string): AddressRepairResult | null {
  const segs = segments(a1);
  if (segs.length < 3) return null;
  if (!isPureNumber(segs[segs.length - 1])) return null;

  const lastDigits = digitGroups(segs[segs.length - 1]);
  if (lastDigits.length === 0) return null;

  const n = lastDigits[0];
  const head = segs.slice(0, -1).join(", ");
  if (!digitGroups(head).includes(n)) return null;

  return {
    ok: true,
    corrected: { address1: segs.slice(0, -1).join(", "), address2: a2 },
    pattern: "p1",
    confidence: "high",
    explanation: `Pattern 1: dropped trailing duplicate '${n}' (already present in apt segment of address1)`,
  };
}

/**
 * §6.7 Pattern 4 — apt-prefix-before-street-number.
 * a1 = "Rua da Passagem ap 805, ⁠114" → "Rua da Passagem, 114"
 * a2 = "Ed Shangrila, ⁠Botafogo"     → "Ed Shangrila, ap 805, Botafogo"
 * Trigger: apt-prefix word in a non-final segment with a number, AND last
 * segment is a different pure number (street number).
 */
export function tryPattern4(a1: string, a2: string): AddressRepairResult | null {
  const segs = segments(a1);
  if (segs.length < 2) return null;
  if (!isPureNumber(segs[segs.length - 1])) return null;

  const headText = segs.slice(0, -1).join(", ");
  const aptPrefixUnion = APT_PREFIX_WORDS.join("|");
  const m = new RegExp(`\\b(${aptPrefixUnion})\\.?\\s*(\\d+)\\b`, "i").exec(headText);
  if (!m) return null;

  const aptPrefix = m[1];
  const aptNum = m[2];
  const streetNum = segs[segs.length - 1].trim();
  const streetDigits = digitGroups(streetNum);
  if (streetDigits.length === 0 || streetDigits[0] === aptNum) return null;

  // Strip "<prefix> <num>" from head, collapse whitespace + leading/trailing commas.
  let strippedHead = headText.replace(
    new RegExp(`\\s*\\b(${aptPrefixUnion})\\.?\\s*\\d+\\b\\s*`, "gi"),
    " ",
  );
  strippedHead = strippedHead.replace(/\s+/g, " ").trim();
  strippedHead = strippedHead.replace(/^[,\s]+|[,\s]+$/g, "");

  const fixedA1 = strippedHead ? `${strippedHead}, ${streetNum}` : streetNum;

  // Migrate apt to a2 IF the apt number isn't already there. Insert between
  // a2's first segment (often building name) and the rest.
  let fixedA2: string;
  if (digitGroups(a2).includes(aptNum)) {
    fixedA2 = a2;
  } else {
    const aptText = `${aptPrefix} ${aptNum}`;
    const a2Segs = segments(a2);
    if (a2Segs.length >= 2) {
      fixedA2 = `${a2Segs[0]}, ${aptText}, ${a2Segs.slice(1).join(", ")}`;
    } else if (a2Segs.length === 1) {
      fixedA2 = `${a2Segs[0]}, ${aptText}`;
    } else {
      fixedA2 = aptText;
    }
  }

  return {
    ok: true,
    corrected: { address1: fixedA1, address2: fixedA2 },
    pattern: "p4",
    confidence: "high",
    explanation: `Pattern 4: stripped apt prefix '${aptPrefix} ${aptNum}' from address1; building number is '${streetNum}'`,
  };
}

/**
 * §6.7 Pattern 2 — apt-indicator + matching number in a2.
 * a1 = "Avenida Aquarela do Brasil, 611, Bl2apt1602" + a2 = "Apt 1602, Sao Conrado"
 * → a1 = "Avenida Aquarela do Brasil, 611" + a2 = "Bloco 2 Apt 1602, Sao Conrado"
 * Trigger: a non-first a1 segment has apt indicator + a number that's also in a2.
 */
export function tryPattern2(a1: string, a2: string): AddressRepairResult | null {
  const segs = segments(a1);
  if (segs.length < 2) return null;

  const a2Digits = new Set(digitGroups(a2));
  for (let i = 1; i < segs.length; i += 1) {
    const seg = segs[i];
    if (!hasAptIndicator(seg)) continue;
    const segDigits = digitGroups(seg);
    if (!segDigits.some((d) => a2Digits.has(d))) continue;

    // Match: strip this apt segment from a1.
    // Edge case (#79823, 2026-05-09): when a building number and an apt
    // indicator are jammed in the same comma-segment with no separator
    // (e.g. "2399 Casa 52"), naively dropping the segment loses the
    // legitimate building number. Detect a leading "<digits><whitespace>"
    // before the apt-indicator and preserve those digits as a replacement
    // segment. Indicator-prefixed forms ("Bl2apt1602") have no leading bare
    // digits and fall through to the original drop behavior.
    const buildingPrefixMatch = seg.match(
      new RegExp(`^(\\d+(?:\\s*[A-Za-z])?)\\s+(?=${APT_PREFIX_PATTERN})`, "i"),
    );
    const replacementSeg = buildingPrefixMatch ? [buildingPrefixMatch[1].trim()] : [];
    const fixedA1 = [
      ...segs.slice(0, i),
      ...replacementSeg,
      ...segs.slice(i + 1),
    ].join(", ");

    // Migrate apt-components NOT already in a2 (with expanded indicator).
    const aptComponents = extractAptComponents(seg);
    const newComponents: string[] = [];
    for (const [indicator, num] of aptComponents) {
      if (!a2Digits.has(num)) {
        newComponents.push(`${normalizeIndicator(indicator)} ${num}`);
      }
    }

    let fixedA2: string;
    if (newComponents.length > 0) {
      // Find the a2 segment containing the matching number; prepend new
      // components to it (so we end up with "Bloco 2 Apt 1602, ..." not
      // "Bloco 2, Apt 1602, ...").
      const a2Segs = segments(a2);
      let targetIdx: number | null = null;
      for (let j = 0; j < a2Segs.length; j += 1) {
        const a2SegDigits = digitGroups(a2Segs[j]);
        if (segDigits.some((d) => a2Digits.has(d) && a2SegDigits.includes(d))) {
          targetIdx = j;
          break;
        }
      }
      if (targetIdx !== null) {
        a2Segs[targetIdx] = `${newComponents.join(" ")} ${a2Segs[targetIdx]}`;
        fixedA2 = a2Segs.join(", ");
      } else {
        fixedA2 = [newComponents.join(" "), ...a2Segs].join(", ");
      }
    } else {
      fixedA2 = a2;
    }

    // Sanity check: if the input had digits but the corrected a1 has none,
    // we just stripped all building info (either through a not-yet-detected
    // jammed shape, or because the user wrote the apt as the only "number").
    // Bail out and let the caller fall through to tagging — silently auto-
    // fixing a numberless street is worse than flagging for human review.
    if (digitGroups(a1).length > 0 && digitGroups(fixedA1).length === 0) {
      return null;
    }

    return {
      ok: true,
      corrected: { address1: fixedA1, address2: fixedA2 },
      pattern: "p2",
      confidence: "high",
      explanation: `Pattern 2: stripped apt segment '${seg}' from address1; migrated missing components to address2`,
    };
  }

  return null;
}

/**
 * §6.7 Pattern 3 — building-number-by-elimination (MEDIUM confidence).
 * a1 = "Rua Engenheiro Jorge Oliva, 174 B, ⁠333" + a2 = "174 B, Vila Mascote"
 * → a1 = "Rua Engenheiro Jorge Oliva, 333" + a2 = "Apto 174 B, Vila Mascote"
 * Rule: number in BOTH a1 and a2 = apartment; number unique to a1 = building.
 * Apply only when exactly 2 numbers in a1 AND one is duplicated in a2.
 */
export function tryPattern3(a1: string, a2: string): AddressRepairResult | null {
  const a1Groups = digitGroups(a1);
  const a2Groups = new Set(digitGroups(a2));
  if (a1Groups.length !== 2 || a2Groups.size === 0) return null;

  const dups = a1Groups.filter((n) => a2Groups.has(n));
  const uniqueInA1 = a1Groups.filter((n) => !a2Groups.has(n));
  if (dups.length !== 1 || uniqueInA1.length !== 1) return null;

  const aptNum = dups[0];
  const buildingNum = uniqueInA1[0];

  const segs = segments(a1);
  let aptSegIdx: number | null = null;
  for (let i = 0; i < segs.length; i += 1) {
    const segDigits = digitGroups(segs[i]);
    if (segDigits.includes(aptNum) && !segDigits.includes(buildingNum)) {
      aptSegIdx = i;
      break;
    }
  }
  if (aptSegIdx === null) return null;

  const fixedA1 = [...segs.slice(0, aptSegIdx), ...segs.slice(aptSegIdx + 1)].join(", ");

  // Prepend "Apto" to the matching a2 segment if it doesn't already have an apt indicator.
  const a2Segs = segments(a2);
  let targetIdx: number | null = null;
  for (let j = 0; j < a2Segs.length; j += 1) {
    if (digitGroups(a2Segs[j]).includes(aptNum)) {
      targetIdx = j;
      break;
    }
  }

  let fixedA2: string;
  if (targetIdx !== null) {
    const a2Seg = a2Segs[targetIdx];
    const aptIndicatorAtStart = new RegExp("^\\s*" + APT_PREFIX_PATTERN + "\\b", "i");
    if (!aptIndicatorAtStart.test(a2Seg)) {
      a2Segs[targetIdx] = `Apto ${a2Seg}`;
    }
    fixedA2 = a2Segs.join(", ");
  } else {
    fixedA2 = a2;
  }

  return {
    ok: true,
    corrected: { address1: fixedA1, address2: fixedA2 },
    pattern: "p3",
    confidence: "medium",
    explanation: `Pattern 3 (by elimination): '${aptNum}' duplicated in address1+address2 → apartment; '${buildingNum}' unique to address1 → building number`,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Public entry: repairBrazilianAddress
// ──────────────────────────────────────────────────────────────────────

/**
 * Try the four §6.7 deterministic patterns to repair a Brazilian shipping
 * address. Returns ok:true with the corrected fields when a pattern fires;
 * otherwise returns the failure reason.
 *
 * "duplicated-number-ambiguous" = same number appears in both a1 and a2 with
 * no disambiguating context (e.g. "Rua Forte William, 11" + "11 Matizes").
 * Caller should tag with ld_number-confirm.
 *
 * "no-pattern-matched" = address has no recognizable issue from these four
 * patterns. Caller should tag with ld_confirm-address (existing default).
 */
export function repairBrazilianAddress(
  address1: string | null,
  address2: string | null,
): AddressRepairResult {
  const a1 = stripZeroWidth(address1).trim();
  const a2 = stripZeroWidth(address2).trim();

  if (!a1) {
    return failure("no-pattern-matched", "empty address1");
  }

  // Try patterns in documented precedence order: P1 → P4 → P2 → P3.
  const p1 = tryPattern1(a1, a2);
  if (p1) return p1;

  const p4 = tryPattern4(a1, a2);
  if (p4) return p4;

  const p2 = tryPattern2(a1, a2);
  if (p2) return p2;

  const p3 = tryPattern3(a1, a2);
  if (p3) return p3;

  // Ambiguity check: a single shared number between a1 and a2 with no apt
  // indicator anywhere is the "duplicated-number-ambiguous" signal — we know
  // there's a duplicate but cannot disambiguate which number is street vs apt.
  // (The four patterns above would have fired if there were a usable cue.)
  const a1Digits = digitGroups(a1);
  const a2Digits = new Set(digitGroups(a2));
  if (a1Digits.length >= 1 && a2Digits.size >= 1) {
    const shared = a1Digits.filter((n) => a2Digits.has(n));
    const hasAnyAptIndicator =
      new RegExp(APT_PREFIX_PATTERN, "i").test(a1) ||
      new RegExp(APT_PREFIX_PATTERN, "i").test(a2);
    if (shared.length >= 1 && !hasAnyAptIndicator) {
      return failure(
        "duplicated-number-ambiguous",
        `Number '${shared[0]}' appears in both address1 and address2 with no apt indicator to disambiguate.`,
      );
    }
  }

  return failure("no-pattern-matched", "no §6.7 pattern matched");
}

// ──────────────────────────────────────────────────────────────────────
// Integration helper: applyAddressRepairOrTag
// ──────────────────────────────────────────────────────────────────────

export type AddressRepairOutcome =
  | { outcome: "auto-fixed"; pattern: RepairPattern; confidence: RepairConfidence }
  | { outcome: "tagged-number" }
  | { outcome: "tagged-address" };

type OrderUpdateUserError = { field?: string[] | null; message: string };
type SafeOrderUpdateResult =
  | { ok: true }
  | { ok: false; userErrors: OrderUpdateUserError[] };

/**
 * Wrapper around `orderUpdate` that surfaces `userErrors` as a real failure
 * (vs. silently succeeding when Shopify rejects the input). Without this
 * check, a paid-order address constraint or a Markets-locale validation
 * rejection would leave the order in its original state with no review tag,
 * because the GraphQL call itself "succeeded" — observed on order #79823
 * (2026-05-09) when Pattern 2's pre-fix output produced an `address1` with
 * no street number.
 */
async function safeOrderUpdate(
  admin: AdminApiContext,
  shop: string,
  orderId: string,
  input: Record<string, unknown>,
  context: string,
): Promise<SafeOrderUpdateResult> {
  try {
    const response = await admin.graphql(
      `#graphql
        mutation AddressRepairOrderUpdate($input: OrderInput!) {
          orderUpdate(input: $input) { userErrors { field message } }
        }`,
      { variables: { input: { id: orderId, ...input } } },
    );
    const json = (await response.json()) as {
      data?: { orderUpdate?: { userErrors?: OrderUpdateUserError[] } };
    };
    const userErrors = json?.data?.orderUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.error(
        `[address-repair] ${context} userErrors shop=${shop} orderId=${orderId} errors=${JSON.stringify(userErrors)}`,
      );
      return { ok: false, userErrors };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[address-repair] ${context} HTTP_ERROR shop=${shop} orderId=${orderId}`, err);
    return {
      ok: false,
      userErrors: [{ message: err instanceof Error ? err.message : String(err) }],
    };
  }
}

/**
 * Decision tree applied at every legacy `addTags(.., LD_ADDRESS_CONFIRM_TAG)`
 * call site. Runs the deterministic repair first; falls back to tagging.
 *
 * - pattern matches AND Shopify accepts orderUpdate  → "auto-fixed", no tag
 * - pattern matches BUT Shopify rejects orderUpdate  → "tagged-address" so
 *   the order doesn't go silently unrouted (was a real bug pre-2026-05-09)
 * - duplicated-number-ambiguous  → tag ld_number-confirm
 * - no pattern matches           → tag ld_address-confirm (existing default)
 *
 * `noteFallback` is used only on the tag branches — it becomes the order note
 * so the merchant sees why we paused delivery in Shopify admin.
 */
export async function applyAddressRepairOrTag(params: {
  admin: AdminApiContext;
  shop: string;
  order: { id: string; address1: string | null; address2: string | null };
  noteFallback: string;
}): Promise<AddressRepairOutcome> {
  const { admin, shop, order, noteFallback } = params;
  const repair = repairBrazilianAddress(order.address1, order.address2);

  if (repair.ok) {
    const shippingAddress: { address1: string; address2?: string } = {
      address1: repair.corrected.address1,
    };
    // Only include address2 when non-empty (Shopify retains existing value
    // if field omitted; passing literal "" can leave a stale empty string).
    const a2 = repair.corrected.address2.trim();
    if (a2.length > 0) {
      shippingAddress.address2 = a2;
    }
    const updateResult = await safeOrderUpdate(
      admin,
      shop,
      order.id,
      {
        shippingAddress,
        // Clear any prior "needs review" note attached by an earlier run.
        note: "",
      },
      "AUTO-FIX",
    );
    if (updateResult.ok) {
      console.info(
        `[address-repair] AUTO-FIX shop=${shop} orderId=${order.id} pattern=${repair.pattern} confidence=${repair.confidence}`,
      );
      return { outcome: "auto-fixed", pattern: repair.pattern, confidence: repair.confidence };
    }
    // Repair was found but Shopify rejected the update. Fall through to
    // tag with ld_address-confirm so the order doesn't go silently unrouted.
    try {
      await addTags(admin, order.id, [LD_ADDRESS_CONFIRM_TAG]);
      await safeOrderUpdate(admin, shop, order.id, { note: noteFallback }, "TAG-AFTER-REJECT");
    } catch (tagErr) {
      console.error(`[address-repair] FAILED fallback addTags shop=${shop} orderId=${order.id}`, tagErr);
    }
    console.info(
      `[address-repair] AUTO-FIX-REJECTED shop=${shop} orderId=${order.id} pattern=${repair.pattern} → tagged-address`,
    );
    return { outcome: "tagged-address" };
  }

  if (repair.reason === "duplicated-number-ambiguous") {
    try {
      await addTags(admin, order.id, [LD_NUMBER_CONFIRM_TAG]);
      await safeOrderUpdate(admin, shop, order.id, { note: noteFallback }, "TAG-NUMBER");
      console.info(`[address-repair] TAG-NUMBER shop=${shop} orderId=${order.id}`);
    } catch (err) {
      console.error(`[address-repair] FAILED tag-number shop=${shop} orderId=${order.id}`, err);
    }
    return { outcome: "tagged-number" };
  }

  // no-pattern-matched → existing default
  try {
    await addTags(admin, order.id, [LD_ADDRESS_CONFIRM_TAG]);
    await safeOrderUpdate(admin, shop, order.id, { note: noteFallback }, "TAG-ADDRESS");
    console.info(`[address-repair] TAG-ADDRESS shop=${shop} orderId=${order.id}`);
  } catch (err) {
    console.error(`[address-repair] FAILED tag-address shop=${shop} orderId=${order.id}`, err);
  }
  return { outcome: "tagged-address" };
}
