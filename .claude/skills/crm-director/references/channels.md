# Channel + format contract

Each channel has a hard format. Pick the right one; if the brief doesn't say the
channel (and, for WhatsApp, the format), ask via AskUserQuestion before writing.

Common to all channels: no em/en dashes · idiomatic PT · currency as symbols
(`R$`, `US$`) after formatting · real products only · no invented numbers · soft CTA
by default · tagline "no seu tempo, do seu jeito." only where it fits, never forced.

---

## WhatsApp (Zoko) — TWO mutually-exclusive formats

WhatsApp uses **native syntax only**: `*bold*`, `_italic_`, `~strike~`. **No Markdown,
no HTML, no `#`, no `[]()`.** Emojis allowed, sparingly. The copy is often copied into
a URL/broadcast tool downstream, so keep the `*`/`_` markers *visible* in the output.

### Format 1 — Manual / API (sales-rep-led)

Use when a real vendedor sends it 1:1, or an API disparo needs the rep variable.

- Variables: `{nome}` (customer) + `{vendedor}` (sales rep). Both stay as literal
  `{...}` tokens — they're populated downstream.
- Emphasis: `*asterisks*` on impact/benefit/action words (`*transformador*`,
  `*descubra*`, `*essencial*`); `_underscores_` on soft/intimate phrases (`_do seu
  jeito_`, `_seu ritual_`), markers left visible.
- Structure: warm open with `{nome}` + `*{vendedor}*` → segment-lever body → **soft CTA
  in bold** (`*Seu ritual está te esperando.*`).
- Length: **100–160 words.**
- Tone: conversational, one-to-one, human. The rep is present in the message.

Worked example (birthday, champion):
```
Oi, {nome}! *{vendedor}* por aqui! Feliz aniversário! 🎂 Você já é parte *essencial* da nossa história, e este mês é todo seu. Que tal celebrar se presenteando com aquele produto que você *adora* — ou experimentando algo novo? *Celebre com a gente, primeiro.*
```

### Format 2 — Automatic / Institutional (brand-level)

Use for automated / mass / trigger sends in the brand's own voice (Meta, Blip, RD
Station, Zenvia, Zoko templates with buttons).

- Variable: `{first_name}` **only**. NO `{vendedor}`, no rep, no store/location mention.
- Structure:
  1. **Hook** (line 1): emoji + direct benefit, ≤50 chars.
  2. **Benefit/explanation**: emotional, brand-centered.
  3. *(optional)* short motivation line.
  4. **CTA as an action button**: `*[Texto do botão]*`.
- Natural paragraph breaks (no `¶¶` markers).
- Length: **50–80 words.**
- Tone: institutional, inspiring, accessible, warm.

Worked example (birthday, automatic):
```
🎂 *Seu mês chegou, {first_name}!*

Comece esse novo ciclo com _autocuidado_ e cabelo radiante — a GE Beauty preparou um presente pra você 💖

👉 *[Quero meu presente]*
```

**The two never mix.** Manual has a rep + `{nome}`; automatic has a button + `{first_name}`.
If the brief is ambiguous, default question: "manual (vendedor 1:1) ou automático
(institucional, com botão)?"

---

## Email (Klaviyo)

Structure per message:
1. **Subject line** — ≤45 chars, one emotional hook. Always give **A + B** variants.
2. **Preheader** — ≤50 chars (≤30 ideal for mobile). Complements, never repeats, the
   subject. Give **A + B**.
3. **Emotional header** — short, connects before it sells.
4. **Body** — accessible narrative + the single primary benefit. Ingredient-as-proof
   where a claim is made.
5. **Product highlights** — real catalog products, real PDP links, benefit-led.
6. **CTA** — one clear, inviting button. Soft by default.

- Full HTML email is a *designer* deliverable — you produce the **briefing** (`brief`
  mode) or the **copy blocks**, not hand-authored responsive HTML, unless asked.
- Klaviyo personalization tokens use Klaviyo's own syntax
  (`{{ first_name|default:'' }}`) — flag the exact token to the designer/engine rather
  than inventing one.
- Deliverability: no spammy all-caps subjects, no false urgency, honor unsubscribe.

---

## SMS

- **≤160 chars** for a single segment (Brazilian carriers split beyond that; each
  segment costs). State the char count.
- One benefit, one link, one CTA. No formatting syntax (plain text).
- Always include an opt-out affordance where required.
- Reserve for high-value, time-sensitive sends (cart, restock, expiring credit) — SMS
  fatigue is expensive and unforgiving.

---

## Offer mechanics (all channels)

- **Never invent an offer.** Discount / gift / store-credit only if the brief says so.
- If an offer is authorized, state amount + cap + expiry exactly as Lucas specified.
  GE's store-credit model is **BEAUTYBACK** (`gebeauty/retention-machine/` — 20% of
  last order, floors/caps per the cohort config). Reference it; don't reinvent the numbers.
- Expiry dates render `DD/MM` (e.g. "expira 17/07"), matching the engine's format.
- Currency always `R$` with comma decimals (`R$ 85,90`).

---

## Consent + fatigue (LGPD + engine state)

- Broadcast only to marketing-consented, non-opted-out contacts.
- Respect the engine's cooldown: `min_days_between_messages` (default 14) and
  `max_touches_per_customer` (default 3). A message you write must not push a customer
  past those if they're mid-sequence in `retention-machine/state.json`.
- If a proposed send overlaps a live lifecycle stream (A/B/C/D), flag it for Lucas
  rather than shipping a collision.
