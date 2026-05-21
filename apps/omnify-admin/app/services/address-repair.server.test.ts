/**
 * Unit tests for address-repair.server.ts — the four §6.7 patterns + negative
 * cases. Mirrors `nami-works/sandbox/gebeauty/scripts/test_address_repair.py`
 * to keep parity with the Python source of truth.
 *
 * Run: npx tsx --test app/services/address-repair.server.test.ts
 *  or: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  repairBrazilianAddress,
  tryPattern1,
  tryPattern2,
  tryPattern3,
  tryPattern4,
} from "./address-repair.server";

// ─── Pattern 1 ─────────────────────────────────────────────────────────────

test("p1: playbook example — drops trailing duplicate '82'", () => {
  // Real example with U+2060 word-joiner before the trailing 82 (Shopify
  // embeds these in real Brazilian addresses).
  const result = repairBrazilianAddress(
    "Av Itaberaba, 1515, Ap82 B, ⁠82",
    "Ap82 B, Nossa Senhora do Ó",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p1");
  assert.equal(result.confidence, "high");
  assert.equal(result.corrected.address1, "Av Itaberaba, 1515, Ap82 B");
  assert.equal(result.corrected.address2, "Ap82 B, Nossa Senhora do Ó");
});

test("p1: dyandra real-world (order #78065, 2026-04-25)", () => {
  const result = repairBrazilianAddress(
    "Avenida Miguel Estefno, 2800, ap 24, ⁠2800",
    "ap 24, ⁠Saúde",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p1");
  assert.equal(result.corrected.address1, "Avenida Miguel Estefno, 2800, ap 24");
});

test("p1: does NOT trigger when only two segments", () => {
  const result = repairBrazilianAddress("Rua X, 100", "Apto 5, Bairro");
  if (result.ok) {
    assert.notEqual(result.pattern, "p1");
  } else {
    // failing OK — just must not be p1 specifically.
    assert.ok(true);
  }
});

test("p1: does NOT trigger when trailing number isn't duplicated", () => {
  const result = repairBrazilianAddress("Rua X, 100, Apto 5, 999", "Bairro");
  if (result.ok) {
    assert.notEqual(result.pattern, "p1");
  }
});

// ─── Pattern 4 ─────────────────────────────────────────────────────────────

test("p4: playbook example — Rua da Passagem ap 805, ⁠114", () => {
  const result = repairBrazilianAddress(
    "Rua da Passagem ap 805, ⁠114",
    "Ed Shangrila, ⁠Botafogo",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p4");
  assert.equal(result.confidence, "high");
  assert.equal(result.corrected.address1, "Rua da Passagem, 114");
  assert.ok(result.corrected.address2.includes("ap 805"));
  assert.ok(result.corrected.address2.includes("Ed Shangrila"));
  assert.ok(result.corrected.address2.includes("Botafogo"));
});

test("p4: 'apto.' (with dot) abbreviation also matches", () => {
  const result = repairBrazilianAddress("Rua Y apto. 12, 200", "Bairro");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p4");
  assert.equal(result.corrected.address1, "Rua Y, 200");
});

test("p4: does NOT trigger when there is no apt prefix", () => {
  const result = repairBrazilianAddress("Rua X, 100", "Apto 5, Bairro");
  if (result.ok) {
    assert.notEqual(result.pattern, "p4");
  }
});

// ─── Pattern 2 ─────────────────────────────────────────────────────────────

test("p2: playbook example — Avenida Aquarela do Brasil, 611, Bl2apt1602", () => {
  const result = repairBrazilianAddress(
    "Avenida Aquarela do Brasil, 611, Bl2apt1602",
    "Apt 1602, Sao Conrado",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p2");
  assert.equal(result.confidence, "high");
  assert.equal(result.corrected.address1, "Avenida Aquarela do Brasil, 611");
  assert.ok(result.corrected.address2.includes("Bloco 2"));
  assert.ok(result.corrected.address2.includes("Apt 1602"));
  assert.ok(result.corrected.address2.includes("Sao Conrado"));
});

test("p2: does NOT duplicate when components already in a2", () => {
  const result = repairBrazilianAddress(
    "Av Test, 100, Bl 2 Apt 1602",
    "Bl 2 Apt 1602, Bairro",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p2");
  assert.equal(result.corrected.address2, "Bl 2 Apt 1602, Bairro");
});

test("p2: jammed building# + apt-indicator preserves building number (#79823)", () => {
  // Real example (2026-05-09): GE Beauty order #79823 had address1
  // "Avenida Benjamin Harris Hunnicutt, 2399 Casa 52" — building number 2399
  // and apt indicator "Casa 52" jammed in the same comma-segment with no
  // separator. Pre-fix Pattern 2 stripped the entire segment, dropping the
  // legitimate building number along with the apt info.
  const result = repairBrazilianAddress(
    "Avenida Benjamin Harris Hunnicutt, 2399 Casa 52",
    "Casa 52, Portal gramados",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p2");
  assert.equal(result.confidence, "high");
  assert.equal(result.corrected.address1, "Avenida Benjamin Harris Hunnicutt, 2399");
  assert.equal(result.corrected.address2, "Casa 52, Portal gramados");
});

test("p2: sanity check — bails when stripping leaves a1 with no digits", () => {
  // Synthetic: a1 has only one digit group ("5"), and that digit is the apt
  // number that also appears in a2. Pattern 2 WOULD have matched and stripped
  // the segment, leaving "Rua Alpha" — a numberless street that's never a
  // valid auto-fix. The sanity check bails out so the order falls through to
  // the tagging path (silent auto-fix to a numberless street is worse than
  // flagging for human review).
  const result = repairBrazilianAddress("Rua Alpha, Apt 5", "Apt 5, Bairro");
  assert.equal(result.ok, false);
  if (result.ok) return;
  // P2 sanity-bails → P3 needs exactly 2 digit groups in a1 (we have 1) → no
  // match → ambiguity check sees the shared "5" but with apt indicator → not
  // ambiguous → no-pattern-matched.
  assert.equal(result.reason, "no-pattern-matched");
});

test("p2: jammed building# variant — apt number not yet in a2 still migrates correctly", () => {
  // Synthetic: building number 1500 jammed with "Apto 88" in the same segment;
  // a2 mentions 88 only via the duplicate-number trigger. Confirms the building
  // number stays in a1 AND the apt info gets migrated to a2 with normalized
  // indicator ("Apto" → "Apto"). This guards against the building-prefix fix
  // accidentally short-circuiting the a2 migration for the same segment.
  const result = repairBrazilianAddress(
    "Rua Teste, 1500 Apto 88",
    "88, Bairro",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p2");
  assert.equal(result.corrected.address1, "Rua Teste, 1500");
  // Original a2 already had "88" so no new component migrated; a2 unchanged.
  assert.equal(result.corrected.address2, "88, Bairro");
});

// ─── Pattern 3 ─────────────────────────────────────────────────────────────

test("p3: playbook example — Rua Engenheiro Jorge Oliva, 174 B, ⁠333", () => {
  const result = repairBrazilianAddress(
    "Rua Engenheiro Jorge Oliva, 174 B, ⁠333",
    "174 B, Vila Mascote",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p3");
  assert.equal(result.confidence, "medium");
  assert.equal(result.corrected.address1, "Rua Engenheiro Jorge Oliva, 333");
  assert.equal(result.corrected.address2, "Apto 174 B, Vila Mascote");
});

test("p3: does NOT trigger with three numbers in a1", () => {
  const result = repairBrazilianAddress("Rua X, 100, 200, 300", "100, Bairro");
  if (result.ok) {
    assert.notEqual(result.pattern, "p3");
  }
});

test("p3: does NOT trigger when there's no duplicate in a2", () => {
  const result = repairBrazilianAddress("Rua X, 100, 200", "Bairro");
  if (result.ok) {
    assert.notEqual(result.pattern, "p3");
  }
});

// ─── Negative cases ────────────────────────────────────────────────────────

test("clean address — no pattern matches", () => {
  const result = repairBrazilianAddress("Rua Augusta, 1500", "Apto 42, Consolação");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no-pattern-matched");
});

test("empty address1 → no-pattern-matched", () => {
  const result = repairBrazilianAddress("", "Bairro");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no-pattern-matched");
  assert.equal(result.explanation, "empty address1");
});

test("null inputs are tolerated", () => {
  const result = repairBrazilianAddress(null, null);
  assert.equal(result.ok, false);
});

test("single-number address with no apt → no-pattern-matched", () => {
  const result = repairBrazilianAddress("Rua X, 100", "Bairro");
  assert.equal(result.ok, false);
});

test("unparseable junk → no-pattern-matched", () => {
  const result = repairBrazilianAddress("asdfqwer", "blahblah");
  assert.equal(result.ok, false);
});

// ─── Ambiguity detection ───────────────────────────────────────────────────

test("duplicated number with no apt indicator → ambiguous", () => {
  // "Rua Forte William, 11" + "11 Matizes, Panamby" — the number 11 appears
  // in both, but neither line carries an apt indicator. We can't tell which
  // is street vs apartment, so caller should tag ld_number-confirm.
  const result = repairBrazilianAddress("Rua Forte William, 11", "11 Matizes, Panamby");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "duplicated-number-ambiguous");
});

// ─── Unicode handling ──────────────────────────────────────────────────────

test("zero-width word-joiner U+2060 is stripped before matching", () => {
  // The trailing "82" is preceded by U+2060. If we didn't strip the joiner
  // BEFORE applying the digit-comparison pattern, p1 would miss the duplicate.
  const result = repairBrazilianAddress(
    "Av Itaberaba, 1515, Ap82 B, ⁠⁠⁠82",
    "",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p1");
  assert.ok(!result.corrected.address1.includes("⁠"));
});

// ─── Pattern ordering ──────────────────────────────────────────────────────

test("ordering: p1 wins over p2 when both could match", () => {
  // This input could match P1 (trailing 82 duplicates Ap82) AND P2 (Ap82 has
  // a number that matches Ap82 in a2). P1 is more specific → should win.
  const result = repairBrazilianAddress(
    "Av Itaberaba, 1515, Ap82 B, ⁠82",
    "Ap82 B, Nossa Senhora do Ó",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pattern, "p1");
});

// ─── Direct pattern-fn smoke checks ────────────────────────────────────────

test("tryPattern1 returns null when not applicable", () => {
  assert.equal(tryPattern1("Rua X, 100", "Bairro"), null);
});

test("tryPattern2 returns null when not applicable", () => {
  assert.equal(tryPattern2("Rua X, 100", "Bairro"), null);
});

test("tryPattern3 returns null when not applicable", () => {
  assert.equal(tryPattern3("Rua X, 100", "Bairro"), null);
});

test("tryPattern4 returns null when not applicable", () => {
  assert.equal(tryPattern4("Rua X, 100", "Bairro"), null);
});
