# sandbox/gebeauty/

Claude Code operational workspace for the GE Beauty tenant.

This directory is where ad-hoc operational work against the GE Beauty Shopify store happens — the R&D lab that feeds new TypeScript MCP tools in `src/tools/`. It is deliberately Python-first, deliberately informal, and deliberately separated from the production TS code.

## Quick start

```bash
# Populate a local .env from /nami-works/tenants/gebeauty/* SSM parameters
npx tsx scripts/ssm-to-env.ts --tenant gebeauty

# Run a read-only script to confirm auth
python sandbox/gebeauty/scripts/retail_revenue_mtd.py
```

Credentials source: SSM (`/nami-works/tenants/gebeauty/*`). Never commit a real `.env`.

## What lives here

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Store access, product catalog, pricing, theme, discount rules — operational context. |
| `field-notes.md` | Lessons learned from manual store operations. Informs both sandbox work and future app features. |
| `scripts/` | Python scripts. R&D surface. 23 scripts at time of import (retail analytics, discount ops, metaobject maintenance, order patching). |
| `actions-unlocked/` | Frontmatter-driven Markdown index of reusable operations ready for MCP-tool promotion. One MD per user-meaningful action (not per API call). |
| `quiz/` | Octane AI quiz content (CORE-1 engine, smart prompts, AI Readiness metaobject definitions). |
| `brandbook/` | Brand guidelines. |
| `cashback/`, `financeiro/`, `google/` | Reference docs (cashback program, financial tracking, Google Business Profile templates). |
| `shipping-journal/` | Daily Local Delivery snapshots (session history). |
| `route-maps/` | Dated route map snapshots (session history). |
| `inputs/` | Input data for scripts (sales CSVs, audit JSON, run logs). |

## Sandbox → MCP-tool promotion pipeline

New operational capabilities graduate from Python sandbox to TypeScript MCP tool through three stages:

1. **Python in `scripts/`** — ad-hoc implementation for a one-off or recurring op. Proves the API pattern, surfaces edge cases.
2. **Entry in `actions-unlocked/`** — once the operation is stable and reusable, write a frontmatter-driven MD describing what it does, when to use it, and the API pattern. See `actions-unlocked/README.md` for the format.
3. **TypeScript tool in `nami-works/src/tools/<domain>/`** — when the capability is broadly useful across sessions, reimplement it as a proper MCP tool with Zod schema, preview→confirm pattern, and tests. At this point the sandbox script can remain as a historical reference or be deleted.

The existing TS tools in `src/tools/shopify/` (find-customer, find-order, list-todays-orders, create-discount-code, apply-price-tag, update-product-price) are the reference for what "promoted" looks like.

## Rules

- **Always confirm before writing to the live store.** Every Shopify API mutation (product updates, metafield changes, discount edits, theme writes) must be explicitly approved by the user before execution.
- **Never hardcode the API token.** Read from `.env`. `.env` is populated from SSM via `scripts/ssm-to-env.ts`.
- **Never commit `.env`.** The repo `.gitignore` already excludes it; confirm before adding new files.
- **Python version:** `C:/Python314/python.exe` (Windows) or system `python3` (other).
- **Bulk writes:** loop with progress logs every 100 items, idempotent (skip already-done), rate-limit aware (cost-based throttle on Shopify GraphQL — check `extensions.cost.throttleStatus.currentlyAvailable`, sleep when below 200).

## Control API bridge

`scripts/cpg_control.py` calls the cpg-labs app's `/api/control/*` bearer-auth endpoints (two-phase route close + legacy mark-delivered). Credentials: `CPG_LABS_CONTROL_URL` and `CPG_LABS_CONTROL_TOKEN` — these are populated into `.env` alongside the Shopify token and currently point at the deployed cpg-labs backend. This cross-repo bridge is expected to outlive this migration.
