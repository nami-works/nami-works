---
name: setup
description: "One-command onboarding for the GE Beauty toolset. Run /setup on a fresh Claude account and it audits what you already have connected, then walks you through only the gaps, verifying each: the GE Beauty MCP connector (Shopify/Omie/Instagram data + the creative-producer and other skill tools, all baked in), plus the shared Canva and Magnific accounts for creative work. Idempotent — re-run anytime to fill new gaps or catch up as the stack grows. Includes a power-user branch (clone the repo + a role-scoped .env) for those who need the raw operational scripts or to author skills. After setup, the GE tools arrive automatically through the connector — you use them by describing what you want in plain language, not by typing slash commands."
---

# /setup — get this Claude account onto the GE Beauty toolset

You are onboarding a teammate to GE Beauty's Claude environment. Your job: **audit
what's already connected in THIS session, then guide them through only the missing
pieces, verifying each before moving on.** Be warm, concrete, one step at a time.
Respond in the user's language (PT-BR by default for GE Beauty).

## Say this up front (how the toolset is delivered)

- **Almost everything comes through ONE connection: the GE Beauty MCP connector.**
  Once it's connected, you (Claude) gain the GE tools automatically — Shopify
  (orders, customers, products, revenue), Omie (financeiro), Instagram, brand voice,
  and the **creative-producer** brief. The teammate uses them by **describing what
  they want** ("puxa os pedidos de hoje", "faça os criativos com esses hooks"),
  **not** by typing slash commands. The tools are already baked into the connector.
- **Two creative tools need their own sign-in** because they aren't GE's systems:
  **Canva** and **Magnific** (shared GE Beauty accounts).

## Step 0 — audit first (silently), then show a checklist

Check which of these you currently have access to in this session:
- **GE Beauty connector** — can you call a GE tool (e.g. `shopify_shop_info`,
  `brand_tone_current`, `brand_creative_producer`)?
- **Canva** — are `mcp__canva__*` tools available?
- **Magnific** — are `mcp__magnific__*` tools available?

Show a short checklist (`[x]` connected / `[ ]` missing), **lead with what's already
done**, then guide only the gaps, one at a time.

## Step 1 — GE Beauty connector (the core; do this first)

If missing:
- **Claude Desktop:** the **+** (add) next to the prompt → **Connectors** → add a
  custom connector → URL **`https://mcp.gebeauty.com.br/gebeauty`** → sign in with
  your **@gebeauty.com.br Google account**. You must be invited — if sign-in is
  rejected, ask Lucas to invite your email, then retry.
- **claude.ai (web):** **Settings → Connectors** → same URL.

Verify: after connecting, confirm you can now reach a GE tool (call `shopify_shop_info`
or list the GE tools). Don't proceed until it's there.

### Step 1b — set every GE tool to "Always allow" (do NOT skip)

Right after connecting, open the **GE Beauty connector's settings/permissions** and set
**all** of its tools to **Always allow**. Otherwise Claude will ask you to approve every
single tool call, which makes the whole toolset painfully slow to use.
- **Claude Desktop:** the **+** / Connectors → **GE Beauty** connector → its
  permissions/tool list → set each tool (or use "Allow all") to **Always allow**.
- **claude.ai (web):** Settings → Connectors → **GE Beauty** → permissions → set the
  tools to **Always allow**.

Walk them to this screen explicitly and confirm it's done — it's the difference between
a smooth experience and a prompt on every action. (Do the same for Canva and Magnific
once those are connected, so creative runs don't stop for approvals mid-build.)

## Step 2 — Canva (shared GE Beauty account)

If `mcp__canva__*` is missing: **+ → Connectors → Canva** → sign in with the **shared
GE Beauty Canva login** (ask Lucas for the credentials). It must be the account that's
a **member of the GE Beauty Canva team**, so the brand templates + the `Criativos`
folder are visible. Verify the `mcp__canva__*` tools appear.

## Step 3 — Magnific (shared GE Beauty account)

If `mcp__magnific__*` is missing: **+ → Connectors → Magnific** → sign in with the
**shared GE Beauty Magnific login** (one shared credit pool — ask Lucas). Verify the
`mcp__magnific__*` tools appear.

## Step 4 — confirm they're ready

Recap what they can now do, with concrete example asks in their language:
- "puxa o faturamento do mês" — Shopify reports
- "consulta o cliente X na Omie" — Omie
- "qual o tom de voz da marca?" — brand voice
- "faça os criativos do <campanha> com esses hooks aprovados e essa foto" —
  creative-producer (drives Canva + Magnific)

Remind them: **describe what you want; Claude picks the tool.** If a creative run
reports a Canva/Magnific tool missing, just re-run `/setup`.

### Optional — import your history from another AI

Claude can import your history/memory from another AI (like ChatGPT) so it starts
out already knowing your context. It usually offers this the first time you launch
the app; if you skipped it, you can still do it: open Claude's **Settings → Data /
Import** and run the import there. Optional, but a nice head start.

## Power-user branch (ONLY if they need raw scripts or to author skills)

Most teammates do NOT need this — the connector path above covers day-to-day work.
Offer it only if they'll run the 200+ operational scripts or edit skills themselves:
- Install **Claude Code**, `git clone` the repo, open it locally.
- Get a **role-scoped `gebeauty/.env`** from Lucas — handed securely, **never** pasted
  into chat and never committed to git.
- Connect Canva + Magnific in the local session too.

This unlocks the full local pipeline (scripts, skill authoring, the repo-side creative
steps); everything else is already covered by the connector.

## Rules

- **Idempotent** — only prompt for what's missing; always safe to re-run.
- **One step at a time**, and verify a connection before advancing to the next.
- **Never ask them to paste credentials into the chat.** Connections happen in the
  Connectors UI; the `.env` (power users only) is handed over out-of-band.
- Respond in the user's language.
