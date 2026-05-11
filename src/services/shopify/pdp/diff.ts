import {
  EXPECTED_PRODUCT_METAFIELD_SLOTS,
  type PDPTemplate,
} from "./types.js";

/**
 * Diff two PDPTemplates: a "reference" (gold-standard hero) vs a "candidate"
 * (any product being audited). Per-slot report of presence and shape.
 *
 * Phase A diff is structural — does each slot exist on the candidate that
 * exists on the reference, and does it carry the same `type`? Value-level
 * semantic diff (e.g. "the FAQ has 5 questions in reference, 2 in candidate")
 * is Phase B's job once the candidate-shape validator lands.
 */

export type SlotDiffStatus =
  | "ok" // both have it
  | "missing_in_candidate" // reference has, candidate doesn't
  | "extra_in_candidate" // candidate has, reference doesn't
  | "type_mismatch" // both have but different metafield type
  | "neither"; // expected slot, neither has

export type SlotDiff = {
  slot: string;
  status: SlotDiffStatus;
  referenceType?: string;
  candidateType?: string;
  notes?: string;
};

export type PDPDiff = {
  referenceProductGid: string;
  candidateProductGid: string;

  /** Structural slot diff for all expected metafield slots. */
  slots: SlotDiff[];

  /** Coarse-grained presence summary. */
  summary: {
    okCount: number;
    missingInCandidate: string[];
    extraInCandidate: string[];
    typeMismatches: string[];
  };

  /** Core scalar comparison (informational — not a pass/fail). */
  coreCompare: {
    titleMatch: boolean;
    handleMatch: boolean;
    productTypeMatch: boolean;
    statusMatch: boolean;
    tagsMissingInCandidate: string[];
    tagsExtraInCandidate: string[];
  };

  /** Media coverage — which role slots the candidate is missing. */
  mediaCompare: {
    referenceRoles: string[];
    candidateRoles: string[];
    rolesMissingInCandidate: string[];
  };

  /** Embedded metaobject completeness. */
  embeddedCompare: {
    descricaoLongaPresent: { reference: boolean; candidate: boolean };
    antesDepoisPresent: { reference: boolean; candidate: boolean };
    aiReadinessPresent: { reference: boolean; candidate: boolean };
    faqCount: { reference: number; candidate: number };
  };
};

export function diffPDPTemplates(
  reference: PDPTemplate,
  candidate: PDPTemplate,
): PDPDiff {
  const slots: SlotDiff[] = [];

  for (const slot of EXPECTED_PRODUCT_METAFIELD_SLOTS) {
    const r = reference.metafields[slot];
    const c = candidate.metafields[slot];
    const refPresent = r?.state === "present";
    const candPresent = c?.state === "present";

    if (refPresent && candPresent) {
      const rType = r.type;
      const cType = c.type;
      const status: SlotDiffStatus = rType === cType ? "ok" : "type_mismatch";
      slots.push({
        slot,
        status,
        referenceType: rType,
        candidateType: cType,
        ...(status === "type_mismatch"
          ? { notes: `reference type=${rType}, candidate type=${cType}` }
          : {}),
      });
    } else if (refPresent && !candPresent) {
      slots.push({
        slot,
        status: "missing_in_candidate",
        referenceType: r.type,
      });
    } else if (!refPresent && candPresent) {
      slots.push({
        slot,
        status: "extra_in_candidate",
        candidateType: c.type,
      });
    } else {
      slots.push({ slot, status: "neither" });
    }
  }

  const okCount = slots.filter((s) => s.status === "ok").length;
  const missingInCandidate = slots
    .filter((s) => s.status === "missing_in_candidate")
    .map((s) => s.slot);
  const extraInCandidate = slots
    .filter((s) => s.status === "extra_in_candidate")
    .map((s) => s.slot);
  const typeMismatches = slots
    .filter((s) => s.status === "type_mismatch")
    .map((s) => s.slot);

  const refTags = new Set(reference.core.tags);
  const candTags = new Set(candidate.core.tags);

  const refMediaRoles = collectMediaRoles(reference);
  const candMediaRoles = collectMediaRoles(candidate);

  return {
    referenceProductGid: reference.productGid,
    candidateProductGid: candidate.productGid,
    slots,
    summary: {
      okCount,
      missingInCandidate,
      extraInCandidate,
      typeMismatches,
    },
    coreCompare: {
      titleMatch: reference.core.title === candidate.core.title,
      handleMatch: reference.core.handle === candidate.core.handle,
      productTypeMatch: reference.core.productType === candidate.core.productType,
      statusMatch: reference.core.status === candidate.core.status,
      tagsMissingInCandidate: [...refTags].filter((t) => !candTags.has(t)).sort(),
      tagsExtraInCandidate: [...candTags].filter((t) => !refTags.has(t)).sort(),
    },
    mediaCompare: {
      referenceRoles: [...refMediaRoles].sort(),
      candidateRoles: [...candMediaRoles].sort(),
      rolesMissingInCandidate: [...refMediaRoles]
        .filter((r) => !candMediaRoles.has(r))
        .sort(),
    },
    embeddedCompare: {
      descricaoLongaPresent: {
        reference: !!reference.embedded.descricao_longa,
        candidate: !!candidate.embedded.descricao_longa,
      },
      antesDepoisPresent: {
        reference: !!reference.embedded.antes_e_depois,
        candidate: !!candidate.embedded.antes_e_depois,
      },
      aiReadinessPresent: {
        reference: !!reference.embedded.ai_readiness,
        candidate: !!candidate.embedded.ai_readiness,
      },
      faqCount: {
        reference: reference.embedded.item_faq.length,
        candidate: candidate.embedded.item_faq.length,
      },
    },
  };
}

function collectMediaRoles(t: PDPTemplate): Set<string> {
  const out = new Set<string>();
  for (const m of t.media) {
    if (m.inferredSlot !== "unknown") out.add(m.inferredSlot);
  }
  return out;
}
