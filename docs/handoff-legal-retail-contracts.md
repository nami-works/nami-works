# Handoff — Legal review: GE Beauty retail contracts (→ Cowork)

Context move for the `legal_retail-contracts` thread. Two GE Beauty retail contracts under the legal-review skill (general-counsel role). Persistent state already lives in the skill's files and the deal records; this doc is the ephemeral context wrapper so a Cowork session can pick up cold.

## State of the two contracts

### 1. CJ Fashion / Shopping Cidade Jardim (JHSF) — CLOSED
- Twin contracts (sublocação quiosque Q07E.1 + fornecimento take-rate), reviewed clause-by-clause across V1 → V2 → **V3 (final)**.
- **Lucas accepted V3 as-is (20/07).** Final terms: rent **R$6.500/mo unconditional** (down from R$9.000; V2's R$5.000-conditioned-on-Camila clause 11.13 deleted), exclusivity narrowed to named Iguatemi malls with **no post-term tail**, penalty-free space-relocation exit.
- 3 residual legal red flags **knowingly accepted** as standard JHSF terms: cross-default + contract indissociability (11.6), LGPD (GE stays *operadora*), unilateral compliance / 9.2 rescission not bilateral.
- Record: `gebeauty/legal/deals/2026-07_cj-fashion-cidade-jardim.md` (status ACCEPTED, has `## Outcome`).
- Only open item: if asked, confirm the DocuSign PDF == V3 at signature (no reintroduced Camila clause / wrong rent; both contracts sign together). Otherwise nothing to do.

### 2. Studio Plural — as-built do quiosque (Contrato nº 052/2026) — PENDING, live item
- 4-page architecture services contract (R$3.242) for an **as-built survey** of GE's existing kiosk at Shopping Riomar (Recife): technical drawings + RRT. Real purpose: replicate/adapt the cart to **Plaza Niterói** and future units.
- **Reframe (Lucas's correction, important):** this is an as-built of GE's OWN asset → **no third-party IP to protect**. Not an IP negotiation. The drawings must be freely reusable at other locations. Only fair supplier protection to keep: **changes to the project are out-of-scope and billed separately** (cl. 6.1).
- Drafted a WhatsApp reply to the supplier (arq. Anderson Aragão / Studio Plural) with exactly those two points. **Lucas sent it 27/07.** Awaiting the revised minuta.
- Tracked in `gebeauty/legal/pending.md`.

## What's pending / next step
- **When Studio Plural returns the revised contract:** diff it and confirm (a) cl. **10.4** location-lock is gone (GE can reuse the drawings at Plaza Niterói + future units), and (b) cl. **6.2**'s authorship framing (Lei 9.610/98) + 3× alteration penalty are removed — leaving only cl. 6.1 "alterations = new budget." Then Lucas signs.
- **Deadline watch:** contract has **30-day validity** (signed 24/07 → expires ~23/08). If the supplier is slow, chase so the window doesn't lapse and force a re-do.
- Ball is currently in the supplier's court — nothing to execute until they reply.

## Where the persistent state lives
- **Legal-review skill:** loop + playbooks at `.claude/skills/legal-review/references/` (read `_index.md` first, then the per-type playbook — `real-estate.md` covers mall kiosks and now carries the JHSF lessons: twin indissociable contracts, Quadro Resumo overrides, conditioned-rent trap, LGPD default, CJ Fashion in "Deals seen").
- **Per-deal records:** `gebeauty/legal/deals/<YYYY-MM>_<slug>.md`. In-flight items: `gebeauty/legal/pending.md`. Lucas wants a record for every contract.
- **Source contracts stay on Google Drive**, not in the repo:
  - CJ Fashion: `G:\Drives compartilhados\GEB_Varejo\Gestão\PDVs ativos\CJ Fashion\`
  - Studio Plural: `G:\Drives compartilhados\GEB_Varejo\Gestão\Expansão\_Projeto\Contrato adaptação carrinho\CONTRATO GE BEAUTY- JUL 26.pdf`
- **Gmail thread** (CJ Fashion negotiation): subject "GE Beauty & CJ Fashion: MINUTAS", thread id `19ef64ba8a48bbce`.

## Tooling gotchas for contract diffs (this Windows env)
- Use `python`, NOT `python3` (the latter hits the Windows Store alias, exit 49/127).
- Heredocs with accented chars (ç, ã) via bash fail — **write a `.py` file and run it**, no inline heredocs.
- `pdfplumber` is installed (text extraction); `pdftoppm`/poppler is NOT (text-only, no image render). `jq` is NOT installed — parse JSON with python.
- Diff approach that worked: normalize out repeated page-footer boilerplate ("Esta página é integrante...", "Pasta 25197", lone page numbers) before `difflib.SequenceMatcher`, else the diff is pure noise.

## Git convention note (changed this session)
The repo now follows **Claude default git conventions**: branch off `main` + PR, not direct-to-`main` commits. The old loose-ops "direct main OK in gebeauty/**" pattern is retired for new work. This handoff itself was landed via a branch/PR.
