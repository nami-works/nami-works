# NAMI Works — landing page flow, v1 (structure, pre-mockup)

**Brand:** `nami` · **`economics.model`:** lead-gen · **Gate:** cost per qualified lead vs close rate and services LTV · **Currency:** BRL
**Design profile:** `brand-tokens` (static Astro + CSS custom properties, NOT Polaris) · **Language:** PT-BR
**Status:** flow + wireframe for approval. Visual mockup comes after you sign off on this. Copy here is **directional** — finished copy is the next pass.

Built from a clean sheet. The existing LP structure and its texts were disregarded per instruction.

Sources of truth: `nami/brand-context.md` (manifest) · `nami/voice-tone.md` (voice, Lucas-edited, final) · `nami/brand-foundation.md` (pillars) · `nami/site/BRAND.md` (visual) · `brands/shared-defaults.md` (inherited rules)

---

## 1. Frame (the job)

| | |
|---|---|
| **Goal** | Turn a stranger or a warm referral into a **qualified diagnóstico lead**, and capture the not-yet-ready into a newsletter list. |
| **Decision it informs** | Whether the page can carry acquisition traffic once client-sourcing starts, and which of the two service lines actually pulls demand. |
| **Success metric** | Qualified diagnóstico intakes per week, and cost per qualified lead once spend starts. Secondary: newsletter opt-ins from non-converters. |
| **Kill metric** | Visitors reach the intake and abandon it, or intakes arrive unqualified (wrong company size, no systems to operate, shopping for a chat tool). That means the page argued the wrong thing, not that traffic was bad. |

**Traffic assumption (from your answer, "we'll start surfacing clients soon"):** warm today (LinkedIn, referral), but the page is built **cold-capable** — it makes the whole argument from zero so it doesn't need rebuilding when outbound and paid start. That's the more expensive structure, and it's the right call given what's coming.

## 2. Gates

**Economics gate — lead-gen substitute.** `economics.engine` is `null`: there is no Module A and no net-margin-per-order model, so this job is **not** measured against a profit floor and **not** against a DTC CAC ceiling. The gate is cost per qualified lead vs close rate and services LTV.

> **Blocking gap:** `economics.test_budget` is `null` — no lead-cost target exists yet. The page can be designed and shipped, but **nobody can say whether the funnel clears its gate until you set a target lead cost with a close-rate assumption.** Needed before any spend. Escalated, not guessed.

**Brand gate — passes, with one condition.** The mechanic is a productized offer with a paid first step (diagnóstico), consistent with `brand.positioning` and `voice.cta_default`. No discount mechanic, so no positioning risk there. Condition: **no hard pricing anywhere on the page** ("orçamento fechado, definido depois do intake"), per `voice.banned`.

**Newsletter gate — FLAGGED, do not build the capture yet.** See §6. `channels.send_engine`, `channels.klaviyo` and `channels.sms` are all `null`. Collecting emails with no way to send to them, and no consent copy, is a promise the brand can't keep.

---

## 3. The flow

Rationale first, then the wireframe. **One unified message, then self-select** — the visitor is never asked to pick a service line before they understand the single promise.

| # | Section | Job it does | Why it sits here |
|---|---|---|---|
| 1 | **Hero** | One promise + the tagline + primary CTA | Cold visitor must grasp the category in ~5s. Tagline carries the whole POV. |
| 2 | **Proof strip** | Three light credibility marks | Cold traffic needs a reason to keep reading *before* the long argument. Anonymized. |
| 3 | **A dor** | Name the exact frustration, operator to operator | Voice principle 1. Earns the right to sell. Uses the Claude-can't-build-the-proposal pain. |
| 4 | **O recorte** | chatters → tweakers → operadores | Proprietary framing. Sorts the world and puts NAMI at the valuable end. Reframes the visitor's self-image. |
| 5 | **O que a gente faz** | Operating, not chatting: inside your systems | Pillar 1. The category definition. |
| 6 | **Self-select fork** | Two service lines, equal weight, same CTA | The split happens *here*, after the shared promise. Both paths converge on one CTA. |
| 7 | **Prova de verdade** | The three real proof points, in depth | Pillar 4. This is the persuasion engine. Anonymized per `voice.proof_rule`. |
| 8 | **Os dois lados** | We train your people, not just the machine | Pillar 2, the differentiator nobody else claims. Also pre-empts "will this replace my team?" |
| 9 | **Como começa** | The diagnóstico as step 1 | De-risks a paid first step by showing exactly what they get. |
| 10 | **Dúvidas** | Supervision, autonomy/lock-in, price, data | Kills the four objections that block a B2B lead. |
| 11 | **CTA block** | The intake | Single conversion action. |
| 12 | **Soft exit** | Newsletter for the not-ready | Catches the 90%+ who won't convert today. **Gated — see §6.** |

### Wireframe

```
┌──────────────────────────────────────────────────────────┐
│ [mark] NAMI Works              método  serviços  contato │  nav, mark ≥24px
├──────────────────────────────────────────────────────────┤
│                                                          │
│  KICKER (11px caps)                                      │
│  H1 — one promise, pain-adjacent                         │  1 HERO
│  Sub — the tagline does the heavy lifting                │
│  [ Pedir diagnóstico ]   ver como funciona ↓             │  primary + soft scroll
│                                                          │
├──────────────────────────────────────────────────────────┤
│  · operações reais no Brasil  · 8 dígitos (anon)  · ...  │  2 PROOF STRIP
├──────────────────────────────────────────────────────────┤
│  H2 — a dor                                              │
│  ┌────────────────────────────────────────────────────┐  │  3 A DOR
│  │ "gerou a política no chat, mas na hora de montar   │  │  operator-to-operator
│  │  a proposta ele não consegue"                      │  │
│  └────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────┤
│  H2 — tem dois tipos de gente usando IA hoje             │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐                 │  4 O RECORTE
│  │chatters │ → │tweakers │ → │operadores│ ← você quer    │  the proprietary cut
│  └─────────┘   └─────────┘   └─────────┘    estar aqui   │
├──────────────────────────────────────────────────────────┤
│  H2 — a gente coloca a IA para operar                    │  5 O QUE FAZEMOS
│  short prose + 3 concrete verbs, no adjectives           │
├──────────────────────────────────────────────────────────┤
│  H2 — por onde você quer começar                         │
│  ┌──────────────────────┐  ┌──────────────────────┐      │  6 SELF-SELECT
│  │ Gestão empresarial   │  │ Operação de e-comm   │      │  equal weight
│  │ what it is, for whom │  │ what it is, for whom │      │
│  │ → mesmo diagnóstico  │  │ → mesmo diagnóstico  │      │  converge, one CTA
│  └──────────────────────┘  └──────────────────────┘      │
├──────────────────────────────────────────────────────────┤
│  H2 — o que já está rodando                              │
│  ① PDP consonante em todo o catálogo                     │  7 PROVA
│  ② Instagram pelos bastidores, não por print             │  three real points
│  ③ proposta dentro do ERP, na política de cada cliente   │  anonymized
├──────────────────────────────────────────────────────────┤
│  H2 — a máquina e as pessoas                             │  8 OS DOIS LADOS
│  we train your team; you keep the capability             │  pillar 2 + anti-lock-in
├──────────────────────────────────────────────────────────┤
│  H2 — como começa                                        │
│  ①intake → ②diagnóstico escrito → ③plano → ④operação     │  9 COMO COMEÇA
│  (supervisionado em todas as etapas)                     │  supervision visible
├──────────────────────────────────────────────────────────┤
│  H2 — dúvidas                                            │  10 DÚVIDAS
│  supervisão? · dependência? · preço? · dados?            │
├──────────────────────────────────────────────────────────┤
│  H2 — pedir diagnóstico                                  │  11 CTA
│  [ form: nome · empresa · sistemas · área · contato ]    │  the one conversion
│  "orçamento fechado, definido depois do intake"          │  no hard pricing
├──────────────────────────────────────────────────────────┤
│  ainda não é o momento? [ newsletter ]                   │  12 SOFT EXIT (gated)
├──────────────────────────────────────────────────────────┤
│  footer                                                  │
└──────────────────────────────────────────────────────────┘
```

### Copy direction per section (not final copy)

Finished copy is the next pass, run through `voice-tone.md`'s 6-point checklist. Direction only:

- **Hero:** pain-adjacent H1, then the tagline as sub. Do **not** open with "a NAMI é…" (voice principle 1 violation). Candidate direction: name what the visitor already tried and where it stopped, then the promise.
- **A dor:** use the operator's real sequence, not a generic "AI is hard". The strongest raw material is already approved in `voice-tone.md`: *"Você usou o Claude para gerar sua política comercial, mas na hora de montar a proposta, ele não consegue."*
- **O recorte:** adapt the approved social line: *"Tem dois tipos de pessoas usando IA hoje…"* Ends by placing the reader, not by bragging.
- **Prova:** each point = system + action + outcome, no adjectives. Never name the 8-figure brand.
- **Os dois lados:** lead on the customer's growing capability (voice principle 4: transferência de conhecimento e autonomia). Frame as *you keep this*, not *we're generous*.
- **Dúvidas:** answer supervision with "com gente no loop"; answer price with the intake framing; answer dependency with autonomy.
- **Everywhere:** sentence case except the 11px kicker, no travessão, no invented numbers, no claim that the AI runs unattended, no named individual.

### Message match (for when paid starts)

`channels.meta` is `null`, so there is no live ad to match against yet. Both registered hooks in `creative-hooks.md` map cleanly onto **§3 A dor** (HOOK-002, the monkey breaking tech in frustration) and **§1 Hero** (HOOK-001, the feed pattern interrupt). When a hook goes live, its promise must appear in the hero within the first viewport, in the same words. Noted so the page doesn't have to be re-cut later.

---

## 4. State matrix — diagnóstico intake (§11)

Per `design-engineer` Phase 3.5. Every state, including the ones that "obviously" do nothing.

| State | Submit button | Field errors | Helper text | Notes |
|---|---|---|---|---|
| Idle, empty | **visible, disabled** | hidden | visible | Submit **is** the page's purpose, so it stays visible with a reason — the narrow legitimate case for disable over hide. |
| Partially filled, required missing | visible, disabled | hidden until blur | visible | Don't error on keystroke; error on blur or submit attempt. |
| Invalid entry (bad email/phone) | visible, disabled | **visible on the field** | visible | Reason shown inline, not only on the button. |
| All required valid | **visible, enabled** | hidden | visible | |
| Submitting | visible, disabled, loading | hidden | hidden | Prevent double-submit. |
| **Disqualified** (screening answer fails) | **hidden** | hidden | **visible: honest redirect** | Hide submit entirely, per hide-don't-disable: there is no action to take here. Replace with the newsletter offer and a plain reason. Never a dead end, never an error. |
| Success | hidden | hidden | hidden | Replace the form with confirmation + what happens next and when. |
| Server error | visible, enabled | hidden | error banner above form | Never blame the user; preserve everything they typed. |

### 4.1 Qualification: FILTER HARDER (decided 2026-08-01)

The kill metric is unqualified intakes, so the form is built to **screen out, not to maximise submissions**. Fewer, better intakes; the screened-out go to the newsletter instead of into your calendar.

**Pre-frame above the form.** State who this is for and who it isn't, before they invest effort. Someone still testing prompts in a chat window should recognise themselves and take the newsletter instead. Saying "this may not be for you yet" costs a few leads and buys back your time.

**Qualifying fields (all required):**

| Field | Why it screens | Disqualifying answer |
|---|---|---|
| Quais sistemas a operação roda hoje | The core filter. NAMI operates *inside* systems; no systems means nothing to operate. | "Nenhum / só planilhas e chat" |
| O que já tentaram com IA | Separates chatters from tweakers/operadores, and sizes the gap. | "Ainda não testamos nada" (soft flag, not hard fail) |
| Área de interesse | Routes to gestão vs e-commerce, and confirms §6 self-select worked. | — |
| Tamanho da operação / time | Sizes whether a services engagement is viable. | Below whatever floor you set (**needs your number**) |
| Contato + empresa | Reachability. | — |

**Deliberate friction.** Do not pre-fill, do not reduce to email-only, do not add social sign-in. The effort *is* the filter. A visitor who won't answer five questions won't sit through a diagnóstico intake.

**Routing.** A disqualifying answer does not throw an error and does not hard-block. It swaps the submit path for an honest redirect to the newsletter: the page says plainly that a diagnóstico wouldn't pay off for them yet, and offers the list instead. Never let someone submit an intake you'll have to reject by email.

**Trade-off, stated plainly.** Volume drops and form abandonment rises, on purpose. Watch abandonment *at the systems question specifically* — if qualified operators are bailing there, the question is worded wrong, not the filter set too tight.

**Open number:** the minimum operation size that makes an engagement viable. That's a money/viability call, so it's yours. Until you set it, that row screens softly (flag for triage) rather than disqualifying.

## 5. State matrix — newsletter soft exit (§12)

| State | Submit | Consent checkbox | Notes |
|---|---|---|---|
| Idle | visible, disabled | **visible, required** | LGPD: explicit opt-in, and say what they'll receive and how often. |
| Valid email, consent unchecked | visible, disabled | visible, unchecked | Disabled with the reason stated. |
| Valid + consent | visible, enabled | visible, checked | |
| Submitting | disabled, loading | visible | |
| Success | hidden | hidden | Confirm, and set the expectation ("quando tiver algo que vale, a gente escreve"). |
| Error | enabled | visible | Preserve input. |

---

## 6. Open items and manifest gaps

~~**Blocking the newsletter (§12).**~~ **RESOLVED 2026-08-01 — send engine chosen: Brevo.** See §7 for the integration spec. §12 is **un-gated for design**; it stays un-buildable until the Brevo account is provisioned (`send_engine_status: chosen-not-provisioned`). The wall rule stands: no third-party widget, the Lambda remains the only form action.

**Blocking spend measurement.** `economics.test_budget: null` — set a target lead cost and a close-rate assumption with me before any spend, or the gate is unmeasurable.

~~**Needs a decision before the mockup.** Intake qualification depth.~~ **DECIDED: filter harder** (§4.1). One number still owed: the minimum viable operation size.

**Filter-harder raises the stakes on the newsletter.** Screened-out visitors are now routed *to* the list, so §12 stops being a nice-to-have and becomes the catch basin for everyone the filter rejects. If §12 doesn't ship, disqualified visitors hit a dead end and the goodwill is lost. This makes resolving the send-engine gap more urgent, not less.

**Possible send path just appeared — verify ownership before using it.** A Klaviyo MCP is now connected to this session but **unauthorized**, and the NAMI manifest declares `channels.klaviyo: null`. Do not assume that account belongs to NAMI: it may be GE Beauty's, and using another brand's send infrastructure would be exactly the cross-brand contamination the manifest forbids. Before it can count as NAMI's send path, confirm whose account it is, authorize it, and update `channels.klaviyo` and `channels.send_engine` in the manifest. Until then the newsletter stays gated.

**Not blocking, worth noting.** `workspace.knowledge: null` — NAMI has nowhere to accumulate findings, so conversion learnings from this page will live in files like this one rather than a knowledge base. `channels.gsc: null` — no Search Console, so organic performance isn't observable yet.

## 7. Newsletter integration spec — Brevo (§12)

**Decision:** Brevo free tier, pattern A (server-side API). Chosen over EmailOctopus for headroom and a future lifecycle path; over Kit/beehiiv because those cost either API access or brand control. The site wall rule is preserved, so no loosening was needed.

**Why it fits:** free tier carries 100k contacts and 300 emails/day (far beyond a screened-out B2B list), the v3 Contacts API and double opt-in are both included on free, and the interface is available in PT-BR.

### Flow

```
§12 form (nami/site, Astro)
      │  POST (email + consent checkbox + consent wording version)
      ▼
Lambda Function URL            ← already exists for the diagnóstico intake
      │  server-side, API key in env, never in the browser
      ▼
Brevo v3 double-opt-in endpoint
      │
      ▼
Brevo sends the confirmation email (PT-BR, NAMI voice)
      │  subscriber confirms
      ▼
Contact lands on the list, consent timestamped
```

### Build notes

- **Endpoint:** Brevo's double-opt-in confirmation endpoint (`POST /v3/contacts/doubleOptinConfirmation`), not the plain create-contact call — DOI is what produces LGPD-grade consent evidence. Verify the exact payload fields against Brevo's live docs at build time; treat the shape here as intent, not gospel.
- **Auth:** `api-key` header, value from Lambda env. Never client-side.
- **Requires before coding:** a Brevo account, an API key, a target list ID, a DOI email template, and a redirect URL for post-confirmation.
- **Confirmation email and redirect are brand surfaces** — both get PT-BR copy in NAMI voice, run through the `voice-tone.md` checklist. Don't ship Brevo's defaults.
- **Reuse, don't duplicate:** the diagnóstico intake already posts to a Lambda. Add a newsletter route/handler rather than standing up a second pattern.

### Consent record (LGPD)

Store, per subscriber: email, timestamp, IP, the **exact consent wording shown** and its version, the source page, and the DOI confirmation timestamp. Brevo retains its own record; keep the wording version on your side, since Brevo won't know which revision of the copy someone agreed to.

**Separate consents, hard rule.** A diagnóstico submission is **not** newsletter consent. LGPD requires consent that is free, informed, specific and unambiguous. Never auto-subscribe an intake submitter. If you want to offer both on one form, it's a second, unticked, independently-worded checkbox. Also honour data subject requests within 15 days.

## 8. Next step

You approve or redline this flow. Then, per the plan-first rule, I build the **visual HTML mockup** on `brand-tokens` (real Geist, the palette from `global.css`, the mascot per the two-mark rule) and, in the same pass or after, the finished PT-BR copy run through the voice checklist. Production build in `nami/site` comes only after the mockup is signed off.
