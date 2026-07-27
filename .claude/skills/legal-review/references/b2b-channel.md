# B2B / channel — review playbook

## What this covers
Supply / distribution to channel buyers where **GE is the seller getting paid**: subscription-box
clients (B4A, UauBox), retail channels, marketplaces, consignação. Two sub-cases:
1. **We author** the instrument → use the house standard **`gebeauty/legal/templates/contrato-fornecimento-padrao.md`**
   (rendered `.docx` alongside it). GE = **FORNECEDORA**, buyer = **COMPRADORA**.
2. **They hand us their draft** → review against the red-flags below and pull it toward our standard.

The defining risk of this deal type: **GE places an exclusive/dedicated manufacturing order to fill the
buyer's volume, and often antecipates the receivable at a bank.** So the exposure is (a) the buyer
shrinking/cancelling after we've committed to the factory, and (b) late payment after we've already
discounted the duplicata (recompra cost). The standard is built around neutralizing both.

## Red-flag checklist (when reviewing a buyer's draft)
1. **"Parceria" framing vs real sale.** B4A dressed a purchase as a *parceria comercial* explicitly
   **not a sale** (products as "moeda"), dodging our seller protections and shifting all tax/risk to GE.
   Insist on **compra e venda mercantil** (UauBox got this right).
2. **Buyer can change/cancel quantity.** UauBox's *"quantidade pode ser alterada com antecedência"* is
   the single worst clause for us given exclusive production. Demand **firm, irrevocable orders** +
   cancellation reimbursement (committed inputs + production + finished goods + financing cost).
3. **Payment term length = financing cost.** Box buyers push 30/60/90/120/150-day terms. Every extra
   30 days is real antecipação cost. Either cap it or load the price / pass the financing cost through.
4. **No unilateral postponement, but also no acceleration for us?** UauBox forbade GE from suspending
   deliveries or accelerating on default. Flip it: on default we suspend + accelerate + protest.
5. **Título executivo pointed the wrong way.** B4A made GE's default a título executivo for *them*.
   Ensure contract + Pedido + NF-e/duplicata is a título executivo **for GE**.
6. **Unilateral discount / return on alleged defect.** B4A let the buyer discount/return at will. Our
   position: cure right (replace or credit), lab proof for hidden defects, buyer's storage/handling faults excluded.
7. **Freight + risk.** Box channels expect delivered-to-CD (GE pays freight, risk on delivery) — market
   norm, acceptable. Keep **reserva de domínio** so title stays with GE until paid (risk ≠ title).
8. **Uncapped indemnity / material-use penalties (B4A).** Cap our liability at the Pedido value, exclude
   lucros cessantes.
9. **Foro.** Buyers set their home comarca (B4A→SP, UauBox→Jundiaí). Ours is **São Paulo/SP**.
10. **Facility inspection, min validity (12mo), reverse-logistics (PNRS).** Standard buyer asks; accept
    inspection, keep 12-month min validity as default, PNRS structuring is ours as manufacturer anyway.

## Our standard's protective spine (authoring)
Pedido firme e irrevogável + cancelamento ressarcível (Cl.2) · mora 2%+1%/mo+IPCA (Cl.4.2) · **repasse
de custos financeiros de duplicatas descontadas** (Cl.4.3) · suspensão + vencimento antecipado + título
executivo (Cl.4.4-4.5) · anuência prévia à cessão/antecipação de recebíveis (Cl.5) · **reserva de
domínio** até pagamento (Cl.6) · cura/substituição em vícios, sem desconto unilateral (Cl.8) · teto de
responsabilidade no valor do Pedido (Cl.10) · foro SP (Cl.16). Commercial terms live in **Anexo I**
(term left per-deal by design).

## Locked lessons
- **Prefer the sale framing, not "parceria."** The parceria label mostly serves the buyer's tax/risk
  shifting; as the paid supplier we want an unambiguous compra e venda.
- **"Quantity may change" + exclusive production = uncovered financing exposure.** Never leave order
  quantity unilaterally variable when we manufacture to order. Firm orders are non-negotiable for us.
- **Risk and title are separable** — pass risk on delivery (market-friendly) while retaining title via
  reserva de domínio (CC 521+). Lets us look flexible on logistics without losing the security.
- **Tie the repasse clause to the cessão clause** — the buyer must pre-consent to us discounting the
  receivable for the "you pay the bank's recompra cost if you're late" clause to bite cleanly.

## BR-law anchors
Código Civil arts. 481+ (compra e venda), 521-528 (reserva de domínio), 296 (cessão/coobrigação) ·
CPC art. 784 (título executivo extrajudicial) · CDC · Lei 13.709/2018 (LGPD) · Lei 12.846/2013.

## Deals seen
- **2025-10 — B4A** (signed, client draft). *Parceria comercial*, products-as-currency, all risk+penalty
  on GE, título executivo vs GE, uncapped. Anti-model; catalog of tactics to mirror-flip.
- **2025-11 — UauBox / Scarlet** (signed, client draft). Clean *fornecimento de mercadorias* skeleton but
  buyer-tilted: 30-150d terms, quantity alterável, GE barred from suspending/accelerating, foro Jundiaí.
  Structural base for our standard.
- **2026-07 — GE standard supply minuta authored** from the B4A vs UauBox diff. Template + `.docx` at
  `gebeauty/legal/templates/`. Posture: balanced, supplier-leaning, signable. No per-deal counterparty yet.
