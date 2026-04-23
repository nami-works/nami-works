# Customer Onboarding — NAMI Works

What we need from you to spin up your NAMI Works tools in claude.ai. Plain language, no jargon. Total operator time on your side: ~30 minutes spread across two days (some waits for OAuth + DNS).

---

## Day 1 — Credentials handoff (~15 min on your side)

### 1. Create a Shopify custom app

In your Shopify admin:

1. **Settings** → **Apps and sales channels** → **Develop apps**.
2. If "Develop apps" is greyed out, click "Allow custom app development" first.
3. **Create an app**. Name it something like `NAMI Works Gateway`.
4. Open **Configuration** → **Admin API integration** → **Configure**.
5. Toggle ON the following scopes (we only ask for the minimum):
   - `read_orders`
   - `read_customers`
   - `read_products` + `write_products`
   - `read_discounts` + `write_discounts`
   - `read_locations`
   - `read_inventory` (only if you want delivery / fulfillment tools)
6. **Save**.
7. Open **API credentials** → **Install app** → **Reveal token**.
8. The Admin API access token starts with `shpat_...`. Copy it.

### 2. (Optional) Omie credentials

If your operations also use Omie ERP and you want NAMI Works to query it (clientes, pedidos, financeiro):

1. In Omie → **Configurações** → **Aplicativos** → **Desenvolvedores**.
2. Generate **app_key** and **app_secret** for a new integration. Label it `NAMI Works`.
3. Copy both values.

### 3. Send credentials to NAMI Works

Use the secure channel agreed in your MSA:
- Preferred: a 1Password or Bitwarden share that expires in 24h.
- Acceptable: PGP-encrypted email.
- NEVER: plain email, Slack DM, WhatsApp.

Send:
- The Shopify access token (`shpat_...`).
- The Omie app_key + app_secret (if applicable).

NAMI Works confirms receipt and stores them in AWS SSM (encrypted at rest, accessible only to the gateway service).

---

## Day 2 — Connect claude.ai (~15 min on your side)

NAMI Works will send you:
- A connector URL: `https://mcp.nami.works/<your-slug>`
- A one-time **bearer token** (long random string).

### 1. Add the custom connector

In claude.ai (Primary Owner only):

1. Top-right avatar → **Settings** → **Connectors** (or "Customize").
2. **Add custom connector**.
3. Fill in:
   - **Name**: `NAMI Works for <Your Brand>` (any label that makes sense to your team)
   - **URL**: paste the URL we sent
   - **Authentication**: leave OAuth Client ID and Secret EMPTY
4. Click **Add**.

### 2. Authorize

Claude.ai will redirect you to a NAMI Works consent page (`mcp.nami.works/oauth/authorize`).

1. Confirm the page shows your tenant slug at the top.
2. Paste the bearer we sent in the "Tenant bearer" field.
3. Click **Authorize**.
4. You're redirected back to claude.ai. The connector now shows as **Connected**.

### 3. Try it

Open a fresh conversation in claude.ai. In the conversation's connector toggle (sidebar), enable `NAMI Works for <Your Brand>`. Ask:

> List today's orders for our store

Claude should call our `shopify_list_todays_orders` tool, reach your Shopify, and render the result.

If it doesn't work:
- The connector might say "Couldn't reach" — usually a typo in the URL or DNS still propagating. Wait 5 min and retry.
- "Unauthorized" — the bearer was pasted wrong. Re-do the consent flow.
- "Auth backend unavailable" — temporary, retry. If persistent, ping NAMI Works support.

---

## What your team gets at launch

You'll see ~20 tools in claude.ai's tool-list, all callable in natural language. Highlights:

- **Find one order or customer** — "show me order #1234" / "look up customer fulano@..."
- **Today's orders** — "list today's orders, only the unfulfilled ones"
- **Revenue analysis** — "what's our YoY revenue for April?" / "daily revenue last week"
- **Footprint** — "top cities by orders this quarter"
- **Promo audits** — "which products are still on sale that shouldn't be?" / "is the BEAUTYBACK campaign consistent?"
- **Discount management** — "list active discount codes" / "preview a 20% markdown for tag SUMMER"
- **Customer lifetime** — "what's the LTV of customer X?"

For the full list with descriptions, see your NAMI Works ops contact or the doc `tool-catalog.md`.

---

## Day-to-day usage

You don't have to remember tool names. Just ask Claude in plain Portuguese (or English). Claude picks the right tool. If multiple steps are needed, Claude composes them.

For **destructive operations** (price changes, discount creation, delivery dispatch), Claude shows you a preview and asks "execute? confirm with `confirm: true`". This is intentional — every write goes through your eyes before reaching the store.

---

## Adding more team members

The connector is **org-level**. Once the Primary Owner adds it, every team member in your claude.ai org sees it automatically. They don't need their own credentials.

To grant a new team member:
1. Invite them to your claude.ai org (your normal Primary Owner workflow).
2. They sign in. The connector is already there.

---

## Removing access

Three options, escalating:

1. **Disable the connector in claude.ai** (org admin) — instant, only affects claude.ai access. Other clients (e.g. Claude Desktop with manual config) still work.
2. **Ask NAMI Works to suspend the tenant** — instant 401 on EVERY request, regardless of client. Reversible.
3. **Ask NAMI Works to disable the tenant** — same effect as suspend, but signals "permanent." Also rotates the bearer so even old test scripts won't work.

If you're rotating credentials internally (e.g. a Shopify Partner left the team), ask NAMI Works to rotate the bearer — it's a 5-minute operation and we send you a new one through the secure channel.

---

## Costs (informational)

The NAMI Works monthly fee covers:
- The gateway hosting (AWS ECS + ALB + RDS, billed to NAMI Works)
- Tool maintenance + new tool requests during the engagement
- Operator-side support (suspending, rotating, troubleshooting)

It does NOT cover:
- Your claude.ai for Teams subscription (paid by you to Anthropic directly)
- Your Shopify or Omie subscriptions (your existing contracts)
- Third-party APIs your tools depend on (Lalamove, Google Maps, etc.) — billed by you

Specific pricing in your MSA.

---

## Questions? Issues?

Contact your NAMI Works ops lead via the channel set up in your MSA. Response time per the SLA in your contract.
