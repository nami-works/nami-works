# Brand registry

Known brands and where each manifest lives. A skill enumerating brands reads this; a skill resolving a single brand in Cowork uses folder-local discovery (see `SCHEMA.md`).

| Slug | Name | Model | Manifest | Notes |
|---|---|---|---|---|
| `gebeauty` | GE Beauty | dtc-purchase | `gebeauty/brand-context.md` | Primary tenant. Shopify + Omie. Module A economics. In the monorepo (git). |
| `nami` | NAMI Works | lead-gen | `nami/brand-context.md` | B2B AI-services. No store, no ERP-backed RFM. Connected folder is NOT git. |

Contract/schema: `brands/SCHEMA.md` · Shared defaults: `brands/shared-defaults.md` · Confrontation matrix: `brands/skill-confrontation.md` · Migration checklist: `brands/migration-checklist.md`.
