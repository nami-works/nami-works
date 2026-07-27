# Session Handoff — 2026-07-27

Session: **legal_contracts**. Authored GE Beauty's **standard supply contract** (minuta padrão de fornecimento), with GE as the paid **supplier**. All deliverables are already **committed + pushed** to `origin/main` (commit `856cf14`). This handoff captures the ephemeral reasoning + open toggles.

## What was done
- **Authored the standard supply contract** as a reusable template (GE = **FORNECEDORA**, buyer = **COMPRADORA**), built by mirror-flipping two client-drafted signed contracts:
  - **B4A** = *parceria comercial* deliberately framed as NOT a sale (products as "moeda"), all risk/penalties on GE, título executivo vs GE. Anti-model.
  - **UauBox** = clean *fornecimento de mercadorias* skeleton but buyer-tilted (30-150d terms, quantity alterável, GE barred from suspending/accelerating, foro Jundiaí). Used as the structural base.
- **Deliverables** (all in `origin/main`):
  - `gebeauty/legal/templates/contrato-fornecimento-padrao.md` — clause source (the brain).
  - `gebeauty/legal/templates/Minuta-Padrao-Fornecimento-GE-Beauty.docx` — rendered contract, Arial / A4 / 3cm-2cm / 1.15, 16 clauses + Anexo I.
  - `.claude/skills/legal-review/references/b2b-channel.md` — seeded the previously-empty B2B/channel playbook (B4A vs UauBox diff + our standard's spine).
  - `.claude/skills/legal-review/references/_index.md` — B2B/channel flipped to ✅ seeded.

## Key decisions
- **Framing = compra e venda mercantil, NOT parceria** — GE is the paid seller, so we want the sale framing (rejects B4A's tax/risk-shifting label).
- **Protective spine (Lucas-approved via AskUserQuestion):** firm irrevocable Pedidos + cancellation reimbursement incl. financing cost (Cl.2); mora 2%+1%/mo+IPCA (Cl.4.2); **repasse dos custos financeiros de duplicatas já descontadas em banco** when buyer pays late (Cl.4.3, Lucas's custom ask); suspend + accelerate + título executivo for GE (Cl.4.4-4.5); buyer pre-consents to GE ceding/antecipating receivables (Cl.5); **reserva de domínio** until full payment (Cl.6); cure/replace on defects, no unilateral discount (Cl.8); liability capped at Pedido value (Cl.10); foro SP (Cl.16).
- **Posture:** balanced, supplier-leaning, **signable** (not a maximalist opening draft).
- **Payment term left to the per-deal Anexo I** by choice — body stays silent on the number; the other mechanisms carry the protection.
- **GE identity = Faria Lima matriz** (from CNPJ ATUALIZADO.pdf); **foro São Paulo/SP**; **GE bears freight to buyer CD, risk transfers on delivery** (market norm), overridable in Anexo I; **FORNECEDORA/COMPRADORA** naming; **pt-BR**, no em dashes.
- **Risk vs title are separable:** risk passes on delivery while title stays with GE via reserva de domínio — intentional, not a contradiction.
- **Rendered the .docx from scratch** (not by cloning the Paula Torres seed) specifically so none of her header/footer branding could leak; footer replaced with a neutral page number. The seed was used only to read the formatting spec.
- **Clause 7.4 softens the delivery-side penalty** (a communicated delay ≠ automatic fine) — this is pro-supplier, the opposite of UauBox's 0.5%/day on GE. Intentional; flagged for Lucas, left in absent objection.

## What's pending
- **4 bracketed toggles** for Lucas to set (then re-render the .docx):
  1. Contract term — indeterminate vs fixed months (Cl.13.1).
  2. Resilição notice — 30 or 60 days (Cl.13.2).
  3. Pedido-change minimum notice — number of days (Cl.2.3).
  4. Party + commercial `[ ]` fields — stay as placeholders until a real counterparty (template by design).
- **No `gebeauty/legal/deals/` record** created — there's no signed counterparty yet. Create one when a partner signs.

## Modified files
- `gebeauty/legal/templates/contrato-fornecimento-padrao.md` — **complete** (committed).
- `gebeauty/legal/templates/Minuta-Padrao-Fornecimento-GE-Beauty.docx` — **complete** (committed).
- `.claude/skills/legal-review/references/b2b-channel.md` — **complete** (committed).
- `.claude/skills/legal-review/references/_index.md` — **complete** (committed).
- `C:\...\scratchpad\build_contract_docx.py` — **cleanup**: one-off render script, in the session scratchpad, not committed. Re-run it to regenerate the .docx after editing the .md.

## Current state
- Everything is on `origin/main` (`git pull` gets it). To eyeball the contract:
  `Start-Process "c:\claude\gebeauty\legal\templates\Minuta-Padrao-Fornecimento-GE-Beauty.docx"`
- To regenerate the .docx after editing the .md source, re-run `build_contract_docx.py` (python-docx 1.2.0; parses the .md → styled .docx). If the scratchpad script is gone, it's trivial to rewrite from the .md.

## Recommended next steps
1. Lucas sets the 4 toggles → edit the `.md` → re-render the `.docx`.
2. When a named partner lands: fill the party block + Anexo I (SKUs/qty/price/term/dates), then it's signature-ready; add a `deals/` record per the legal-review loop.
3. Optional: consider whether the standard should also cover *consignação* (currently pure compra e venda).

## Context the next session needs
- **Persistent brain lives in the playbook**, not this handoff: read `.claude/skills/legal-review/references/b2b-channel.md` (red-flags + locked lessons + deals seen) before any B2B/channel contract work. Memory pointer: `project_gebeauty_legal_review`.
- **Two source contracts** (for reference) are in Google Drive: B4A at `G:\Drives compartilhados\GEB_Comercial\Boxes\B4A\...[assinado].pdf`; UauBox at `G:\...\Boxes\Uau Box\001_nov-25\Contrato GE Beauty - Clicksign.pdf`.
- **Do NOT touch** `docs/handoff-legal-contract-reviews.md` — that's a *different* session's handoff (retail contract reviews). And `gebeauty/legal/pending.md` shows `M` from another session's WIP — not part of this work.
- The `.docx` renderer is markdown-driven: the `.md` is the single source of truth; never hand-edit the `.docx` directly or the two drift.
