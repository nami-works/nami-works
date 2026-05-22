import type { ParsedNFe } from "./parser.js";

export type GateOk = { ok: true };
export type GateRejection = {
  ok: false;
  code:
    | "SEFAZ_NOT_AUTHORIZED"
    | "NOT_OUTBOUND"
    | "NOT_NORMAL_OPERATION"
    | "CNPJ_MISMATCH";
  reason: string;
};
export type GateResult = GateOk | GateRejection;

// The 4 ingestion gates defined in apps/fulfillment/CLAUDE.md. ALL must pass
// before an order leaves the RECEIVED state and enters the routing pool.
export function runIngestionGates(
  nfe: ParsedNFe,
  tenantCnpj: string,
): GateResult {
  // Gate 1: SEFAZ authorization (cStat == 100). Anything else means the NFe
  // is cancelled, denied, or rejected — we never advance it past RECEIVED.
  if (nfe.sefazStatus !== 100) {
    return {
      ok: false,
      code: "SEFAZ_NOT_AUTHORIZED",
      reason: `cStat=${nfe.sefazStatus}; only cStat=100 (autorizada) is routable`,
    };
  }

  // Gate 2: outbound shipment (tpNF == 1). tpNF=0 means entrada/return — the
  // merchant is RECEIVING goods, not shipping them; nothing to route.
  if (nfe.tpNF !== 1) {
    return {
      ok: false,
      code: "NOT_OUTBOUND",
      reason: `tpNF=${nfe.tpNF}; only tpNF=1 (saida) is routable`,
    };
  }

  // Gate 3: normal operation (finNFe == 1). 2=complementar, 3=ajuste,
  // 4=devolução — none of these are first-time outbound shipments.
  if (nfe.finNFe !== 1) {
    return {
      ok: false,
      code: "NOT_NORMAL_OPERATION",
      reason: `finNFe=${nfe.finNFe}; only finNFe=1 (normal) is routable`,
    };
  }

  // Gate 4: anti-spoofing — the NFe's emit.CNPJ must match the tenant the
  // request authenticated as. Without this check, a tenant could push another
  // merchant's NFe and pollute the cross-tenant routing pool.
  if (nfe.emitCnpj !== tenantCnpj) {
    return {
      ok: false,
      code: "CNPJ_MISMATCH",
      reason: `NFe emit CNPJ does not match tenant`,
    };
  }

  return { ok: true };
}
