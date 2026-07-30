# Session Handoff — 2026-07-30

**Target surface:** Claude Cowork — written self-contained (no repo memory / CLAUDE.md auto-load assumed). If a Claude Code session picks this up, memory `project_gebeauty_legal_review.md` also covers it.

**Scope:** the **financing contracts** (Ghia receivables-discount + Blog R$450k mútuo) and the legal-review system that frames them. Sibling handoff `docs/handoff-legal-retail-contracts.md` (other sessions) covers retail/real-estate contracts — do not overwrite it. Multiple sessions write into `gebeauty/legal/`; touch only the files named here.

## What was done
- **Legal-review "operating system" is live in the repo:** one playbook per contract TYPE at `.claude/skills/legal-review/references/` (`_index`, `receivables-financing`, `real-estate`, `vendor-saas`, `lending`; `b2b-channel` came from another session). Per-deal records at `gebeauty/legal/deals/`. In-flight tracker at `gebeauty/legal/pending.md`.
- **Four contracts reviewed**, records written: Ghia (`2026-06_ghia-desconto-duplicatas.md`), Blog mútuo (`2026-06_blog-mutuo-450k.md`), Regus (`2026-06_regus-riosul-sublocacao.md`), Gorgias (`2026-06_gorgias-helpdesk.md`).
- **Ghia negotiation advanced** through v1 contrato → v2 term sheet → 3-Jul proposal (0/4 asks) → **24-Jul proposal (2.5/4 asks)** (live state below).
- **Two drafts prepared, NEITHER sent:** (a) positive-tone PT email to Ghia to define the recompra due date (full text below); (b) a Gmail draft to Finotti (cc Camila, Giulia) on the Blog mútuo, saved on the "Antecipação recebíveis GE Beauty vs. Blog" thread.

## Key decisions
- **Legal-review design (Lucas's calls):** playbook-per-type = the unit of memory; a per-deal record for EVERY contract; repo-only visibility; AI-first review with **manual** escalation to the lawyer (no auto-tier, no dollar threshold, no standing register).
- **Locked lessons** (also in `receivables-financing.md`): *diff the CONTRACT, not the term sheet*; *a counterparty can deflect contract-level redlines by sending an earlier-stage mandate/proposal + a break fee.*
- **Ghia posture:** Lucas accepts the full recourse (`coobrigação`) and Camila's personal guarantee. The negotiation is ONLY the recompra clause (the 4 redlines).

## What's pending — the live state that must not be lost

### Ghia — 4 recompra redlines, status after the newest version
Newest file: `G:\Drives compartilhados\GEB_Financeiro\Cash & Funding\Ghia\2026.06.30_TS_v01.docx` — **misleading filename: the document is dated 24 July 2026** and is the latest. It is a *Proposta/mandato + Anexo I*, NOT the cessão contract.

| # | Ask (on the recompra) | Status |
|---|---|---|
| 1 | Triggers = origin-of-credit defects only (drop force majeure) | ❌ **OPEN** — no recompra-trigger clause in the proposal; force majeure still appears only as Ghia's mandate-exit right |
| 2 | 7-day cure after formal notice | ⚠️ **PARTIAL** — "Substituição de Inadimplente" is now "7 dias corridos após 20 dias de atraso", but the *recompra* due date is undefined (see below) |
| 3 | Penalty capped at 2%, objective | ✅ **DONE** — recompra formula fixes the penalty at m = 2% (no more discretionary "up to 10%") |
| 4 | Objective repurchase-price formula | ✅ **DONE** — explicit formula added to Anexo I |

**The one open ask right now:** the formula relies on a `Data de Exigibilidade da Recompra` (the repurchase due date) that is **never defined** — both `n` and `N` in the formula hang off it, so an undefined date lets the amount float and re-opens fund discretion. Fix = define it as **"7 dias corridos após notificação formal", placed in Anexo I** (Anexo I prevails and binds the future cessão contract). This is the concrete resolution of ask #2.

**Also still unfavorable (unchanged, were never the 4 asks):** the 2.5% `Comissão de Resilição` (break fee on the R$500k Volume), broad indemnification, Ghia's one-sided involuntary resilição, the mandate being irrevogável + título executivo + 6-mo auto-renew + marketing-use consent. Rate is still 2%/mo.

**Do NOT apply the "De Acordo"** until the cessão contract reflects ask #1 and the recompra due date; signing the mandate commits GE (irrevocably, as a title, with the break fee) before those land.

**DRAFTED, NOT SENT — positive-tone email to Ghia (send after Lucas approves):**
```
Subject: Re: Proposta – Antecipação de Recebíveis (Desconto de Duplicatas)

Oi, [nome]! Tudo bem?

Obrigado pela nova versão. Ficou ótima, em especial a inclusão da fórmula
objetiva para o cálculo do valor de recompra, com a multa e os juros já
definidos. Isso resolve bem os pontos que tínhamos levantado.

Só notamos um detalhe que parece ter passado batido: a fórmula usa a "Data
de Exigibilidade da Recompra" como referência (tanto para o n quanto para o
N), mas essa data não está definida em nenhum ponto do documento. Ou seja,
ficou faltando dizer em quantos dias, após a notificação, a recompra passa a
ser exigível.

Para fechar esse ponto, sugerimos incluir no Anexo I uma linha definindo que
a recompra será exigível em 7 dias corridos contados da notificação formal.
Assim a fórmula fica completa e o prazo fica alinhado com o próprio prazo de
substituição (7 dias corridos) que já consta no Anexo.

Com esse ajuste, seguimos tranquilos de nossa parte. Conseguem incluir e reenviar?

Obrigado!
Abs,
Lucas
```

**Stale record flag:** `gebeauty/legal/deals/2026-06_ghia-desconto-duplicatas.md` is current only through **Round 2 (3 Jul)**. The 24-Jul developments (formula added → #3 and #4 done; recompra due date still open) are NOT yet written into it → **update the record** as a first housekeeping step.

### Blog — R$450k mútuo (Garotas Estúpidas → GE)
- Gmail **draft** to `lucasfdfinotti@gmail.com` (cc `camila@gebeauty.com.br`, `giulia.bin@garotasestupidas.com`), saved on the "Antecipação recebíveis GE Beauty vs. Blog" thread, **NOT sent.** Asks to soften: bullet maturity (align to B4A 30/60/90), 10% multa → 2%, broad cross-default, free assignment (require GE consent), clarify "1,3% líquidos" (ao mês? who bears IOF/IRRF), and the "Cédula de Crédito Bancário" mislabel. Decision pending: send / revise / keep private to Finotti.
- **Obligation:** R$450k **bullet due 10/08/2026**. Repay early from B4A cash (prepayment is free) or roll with Camila; late = 10% multa (~R$45k) + mora. In `gebeauty/legal/pending.md`.

### Regus — Torre Rio Sul sublocação (exit in progress)
- Exiting in favor of Iguatemi depósito G4D10 (R$1,500/mo). Notice is **tiered** (month-to-month 1mo / 3-mo term 2mo / >3mo 3mo), **must be filed via the Regus online account/app** (email doesn't count), and **runs to month-end**. **EXACT TERM UNCONFIRMED** — check the Regus online account for the end date; fee history (3,159→4,179) hints at a 3-mo term → ~2 months' notice. **Don't cancel before G4D10 is signed.** Distinct from the RioSul Shopping *kiosk* aditivo (Iguatemi) — different contract.

### Gorgias — helpdesk SaaS (signed)
- Executed. US$1,680/yr, quarterly Net-30, term to **14 Jun 2027**. Renewal decision before then. USD-billed → real cost includes BR remittance taxes + IOF.

## Modified files
- `docs/handoff-legal-financing.md` — this handoff (the only new artifact). **complete.**
- The legal deal records + playbooks + `gebeauty/legal/pending.md` are already **tracked/committed** in the repo (no pending edits from this session except the Ghia Round-3 update noted above). **complete**, except that one record update.
- `gebeauty/legal/deals/2026-07_studio-plural-as-built.md` shows untracked — that belongs to **another session; leave it.**

## Current state / how to verify
- Read `gebeauty/legal/pending.md` + `gebeauty/legal/deals/2026-06_*.md` for the deal records; `.claude/skills/legal-review/references/_index.md` for how the system works.
- **Source contracts live in Google Drive, not the repo** (`G:\Drives compartilhados\GEB_Financeiro\Cash & Funding\Ghia\` and `\Blog\`). **Cowork cannot reach the G: drive** — work from the deal records + the inlined state above, or ask Lucas to attach the docx.

## Recommended next steps (priority order)
1. On Lucas's OK, **send the drafted Ghia email** (recompra due date), then **update the Ghia deal record** with Round 3.
2. Resolve the **Blog Finotti draft** (send / revise / make private).
3. **Confirm the Regus term** (online account) to compute the exact notice date before cancelling.

## Context the next session needs (self-contained)
- **Working agreement:** CTO/CEO contract — you are CTO (git/tooling mechanics = silent calls); Lucas is CEO (product/brand/money/strategy escalate). End substantive sessions with a "Calls made silently" note.
- **HARD rules the drafts depend on:** NO em dashes in customer-facing copy · PT must be idiomatic (no English calques) · email drafts are PLAIN TEXT · **NEVER auto-send — save as a draft and let Lucas send** · list existing drafts before creating a new one.
- **Ghia entities:** Ghia Capital (originadora) + Ghia Asset (gestora) + Ghia Crédito Corporativo FIDC (o Fundo / buyer). Camila Coutinho Valença is the personal guarantor (`devedor solidário`) — in the *cessão contract*, not in the current proposal. The Ghia contact who ships versions: **Luiz (luiz@ghiaasset.com.br)**.
- **The recompra formula (24-Jul Anexo I):** `VR = VC + M + J`; `VC = VA × (1 + i)^(n/360)`; `M = VC × 0,02`; `J = VC × (0,01 × N/30)`. VA = what the Fund paid for the receivable; `i` = annual discount rate (**confirm 24% nominal vs ~26.82% effective of 2%/mo**); `n` = acquisition → due date; `N` = due date → actual payment. The undefined `Data de Exigibilidade da Recompra` is the open gap.
- **Filenames are misleading in the Ghia folder:** `2026.07.03_TS_v01.docx` is dated 3 Jul; `2026.06.30_TS_v01.docx` is dated **24 Jul (newest)**. Both are Proposta + Anexo I, not the cessão contract.
- **Multi-session convergence is real:** other sessions actively add to `gebeauty/legal/`. Coordinate, don't clobber; stage files by explicit path, never `git add .`.
