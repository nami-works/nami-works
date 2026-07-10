# Session Handover — 2026-06-17

**Type:** advisory / tax-structuring consultation (no code changes). **Destination:** Claude web session.
**Caveat baked into everything below:** this is a structured recommendation, NOT formal tax advice. A contador must validate the numbers before Lucas commits anything in writing with his partner.

## What was done
- Worked through how Lucas should receive his personal commission on a one-off wholesale deal, in the most tax-efficient legal way (Brazil).
- Gathered all decision-relevant facts through three rounds of Q&A (see "Facts established").
- Reached a firm, unambiguous verdict: **commission-invoice route via Lucas's PJ** (not profit distribution).
- Produced the economic rationale, the net-to-Lucas numbers, the key optimization lever (fator-R), an execution checklist, and the list of items the contador must confirm.

## The deal
- Wholesale: **20,000 units**, price **R$15/un** → **R$300,000 revenue**; cost **R$11/un** → **R$220,000 cost**; gross profit **R$4/un** → **R$80,000 total**.
- Personal agreement between Lucas and his partner (on top of equity): **60% of gross profit = R$48,000 to Lucas**, **40% = R$32,000 to the company**.

## Facts established (the inputs the verdict depends on)
- Selling company is on **Lucro Real**.
- Lucas is a **formal sócio** (on the contrato social).
- Lucas has an **active PJ** (own CNPJ), on **Simples Nacional**, whose **CNAE covers** comissão / representação comercial / intermediação.
- Lucas **genuinely brokered** this deal (real intermediation — substance exists to support a commission).
- Deal is **one-off**.
- Company is **currently not profitable** → pays no IRPJ/CSLL.
- **Even with this R$80k deal, the company stays in tax loss for 2026** (no taxable profit this year).
- Company carries **large accumulated ACCOUNTING losses (prejuízos acumulados)**.
- Company will **turn profitable within 1–2 years**.
- Lucas's equity is **< 60%**, but the **contrato social allows disproportionate distribution**.

## Key decisions (the verdict + why)
1. **Route: Lucas's PJ issues a commission/representação-comercial invoice to the company for R$48k.** This is the answer.
2. **Profit distribution (lucros) is OFF the table — not worse, illegal here.** Tax-free lucros require accounting profit *after* absorbing accumulated losses. The accumulated accounting deficit exceeds the R$80k deal profit, so there is **nothing distributable**; paying R$48k as lucros would be *lucros fictícios* (CC Art. 1.009 → personal liability for the sócios). The disproportionate-distribution clause doesn't help because there's no distributable base.
3. **The R$48k deduction is NOT wasted, even in a loss year.** It grows the company's **prejuízo fiscal by R$48k**. Because the company will be profitable soon, that carryforward is a real future asset worth up to **~R$16.3k** (34% × 48k) of future IRPJ/CSLL shield. Prejuízo fiscal **never expires** in Brazil; the 30%-of-profit-per-year offset cap ("trava dos 30%") is a timing limit, not a loss. So the small Simples cost now is more than recovered later — commission is the efficient outcome, not a fallback.
4. **Why commission beats the (hypothetical) distribution on total value:** commission = ~R$40.5–45.1k to Lucas now + ~R$16.3k future company asset (Lucas owns part via equity); a flat tax-free distribution would have been R$48k and created no future asset — and it's blocked anyway.

## Net to Lucas (R$48k commission, Simples, bottom faixa)
- **Anexo III (6%):** ~R$2,880 tax → **net ~R$45,120**
- **Anexo V (15.5%):** ~R$7,440 tax → **net ~R$40,560**
- **Key lever — fator-R:** Anexo III vs V hinges on *folha 12m ÷ receita 12m ≥ 28%*. A pró-labore adjustment in the invoicing month can secure Anexo III → ~**R$4,560 saved** on this single invoice. This is the single biggest knob on Lucas's side.

## Execution checklist (the recommended structure)
1. **Contrato de representação/intermediação** between the company and Lucas's PJ for this deal (the 16% rate), dated at/before the sale. Keep evidence Lucas sourced/negotiated the customer — substance is the defense, especially a fat commission booked in a loss-making company.
2. PJ issues **NFS-e for R$48k** with the correct código de serviço (representação/agenciamento) when the sale closes.
3. Company books **despesa dedutível de comissões sobre vendas** → prejuízo fiscal grows R$48k. Contador checks whether it also yields a **PIS/COFINS credit** on the Lucro Real non-cumulative regime.
4. PJ pays **DAS** on the R$48k in the competência.
5. PJ distributes the net to Lucas as **lucros isentos** — PJ must keep **escrituração contábil completa**, or the tax-free portion is capped at ~32% of revenue (~R$15.4k) and the rest is taxed as PF.

## What's pending
- **Offered, not yet delivered:** at the end of the session Claude offered to draft (a) the **contrato de representação comercial** and (b) the **NFS-e service description**. Lucas ran /handover instead of answering, so these drafts are the natural next deliverable if he wants them.
- **Contador confirmations (must happen before execution):**
  - fator-R for the invoicing month (the R$45.1k vs R$40.6k swing).
  - R$48k properly registered as prejuízo fiscal in the **LALUR** so the future shield is real.
  - **escrituração contábil completa** on the PJ so the full net distributes tax-free.
  - PIS/COFINS credit eligibility on the commission.

## Modified files
- **None from this session.** The working tree shows `.mcp.json`, `inputs/chat-room.md`, `sandbox/gebeauty/CLAUDE.md` modified, but those pre-date this session and are unrelated to the tax discussion — do not attribute them here.

## Current state
- No code, no deploy, nothing to test. The "state" is the decision itself, captured above.
- This handover file is a **local record only**. Because the next session is on Claude web (no filesystem access), it can't read or delete this file — use the paste block instead. Lucas can delete `docs/handover-commission-tax-strategy.md` himself when done. **Consider NOT committing it** — it contains personal financial details and the repo is shared.

## Recommended next steps (for the web session)
1. If Lucas wants them: draft the **contrato de representação comercial** (16% on this specific deal, arm's-length, dated at/before sale, with a scope clause describing the brokering Lucas performed) and the **NFS-e service description**.
2. Otherwise: answer follow-ups on the structure, or help Lucas brief his contador (a short bullet list the contador can confirm/reject).

## Context the next session needs
- **Jurisdiction is Brazil**; all reasoning uses BR tax concepts (Lucro Real, Simples Nacional anexos, fator-R, prejuízo fiscal/LALUR, trava dos 30%, lucros isentos, escrituração contábil, CC Art. 1.009).
- **The verdict already accounts for the loss position.** Don't "reconsider distribution" — it's legally blocked by the accumulated accounting losses. Earlier in the session, before the loss facts were known, distribution looked viable; that branch is dead.
- **The 16% commission rate is at the high end** for representação and is being booked in a loss-making company — both invite scrutiny. The defense is genuine intermediation substance + contract + correct CNAE. Keep documentation tight.
- **Do not auto-send anything or treat this as executed.** It's a recommendation pending contador sign-off and Lucas's go-ahead with his partner.
- **Tone with Lucas:** decisive, numbers-first, flag-the-caveat-once. He's COO-level financially literate (bilingual PT/EN); he wrote in English this session.
