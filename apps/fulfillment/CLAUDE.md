# apps/fulfillment — Rota Local

Multi-client 3PL operator. Customer-facing brand: **Rota Local**. Internal: NAMI Works Fulfillment.

## What this app does

1. Receives NFe XMLs from merchant ERPs (per-tenant push endpoint).
2. Normalizes each NFe into the canonical `FulfillmentOrder` model.
3. Builds romaneios (packing lists) for warehouse pickers.
4. PWA scanner reads DANFE barcode/QR → marks `PICKED` → emits webhook to merchant.
5. Pools cross-merchant orders → calls LD's `/api/control/optimize` to cluster into routes.
6. Calls LD's `/api/control/dispatch` per route → Lalamove (and later, broker carriers).

## Stack

Node 20 · TypeScript strict · Fastify 5 · Prisma (custom output `@prisma/client-fulfillment`) · Pino · Zod. Same as `apps/connector`.

Port: **3001** (connector is 3000).
Prisma schema: `prisma/fulfillment/schema.prisma`, client emitted to `node_modules/@prisma/client-fulfillment` (NOT the default `@prisma/client` — that's omnify's, and NOT `@prisma/client-connector` — that's connector's).
Database: separate logical Postgres `nami_works_fulfillment` on the shared RDS instance, via `DATABASE_URL_FULFILLMENT`.

## Tenant isolation

- Every request carries a tenant slug as URL path param (`POST /v1/:tenant/orders`).
- Bearer-token auth: constant-time compare against `FulfillmentTenant.bearerTokenHash`. Rota Local maintains its own tenant table — cross-DB join with connector's `IntegrationTenant` is intentionally impossible (separate DBs, separate clients).
- `status !== 'active'` → 401. Billing kill switch.
- Tools and handlers MUST NOT access state outside their tenant's scope.

## LD coupling (v0)

This app does NOT directly call Lalamove or run a clustering algorithm. It calls LD's bearer-auth gateway at `apps/omnify-admin/app/routes/api.control.$intent.tsx`:

| Intent | When called |
|---|---|
| `POST /api/control/optimize` | After a wave of orders is `PICKED` and pooled |
| `POST /api/control/quote` | After optimize, to surface route costs |
| `POST /api/control/render-routes` | Before dispatch (§6.2 always-on visual check) |
| `POST /api/control/dispatch` | Operator-triggered per route |
| `GET  /api/control/state` | Dashboard polling |

V1 extracts LD's routing core into a shared package. V0 stays loopback HTTP.

## Why we don't consume `packages/shared-*`

The monorepo's `shared-*` packages were extracted from the omnify Shopify-admin stack:

- `shared-auth` — Shopify OAuth + session storage. Rota Local uses bearer auth (merchant ERPs, not Shopify Admin).
- `shared-webhooks` — Shopify GDPR compliance receivers (CUSTOMERS_REDACT, etc.). Rota Local SENDS outbound HMAC-signed webhooks to merchants — opposite direction, different semantics.
- `shared-db` — generic Prisma singleton wrapper, but imports the default `@prisma/client` (omnify's). Rota Local uses `@prisma/client-fulfillment` and has its own singleton at `src/db/prisma.ts`.
- `shared-encryption`, `shared-google-routes`, `shared-i18n`, `shared-ui` — Shopify-app or frontend-specific.

This is intentional: Rota Local is a standalone Node service, not part of the Shopify admin family. Don't add `@cpg-labs/shared-*` dependencies.

## Code conventions (inherits root + nami-works rules)

- Zod for every request body schema.
- Pino prefix `[rota-local:<tenant>]` for tenant-scoped logs. Include `requestId`, `chaveAcesso`, `durationMs`, `status` on order operations.
- Never log full NFe item lists — counts only. Item-level fields (`codigo`, `descricao`, `quantidade`) aren't PII, but the log volume is unhelpful. The PII rule below covers the actual privacy concerns.
- Prisma imports: `import { PrismaClient } from "@prisma/client-fulfillment"` — NEVER `from "@prisma/client"` (omnify) or `from "@prisma/client-connector"` (connector).
- Write endpoints (anything that mutates carrier state, sends a webhook, or changes order status) follow a two-step confirm pattern (port from `apps/connector/src/lib/confirm.ts` when the first write endpoint lands).
- Per-tenant config lives in DB + SSM at `/nami-works/fulfillment/tenants/<slug>/*`.
- Secrets (bearer tokens, HMAC keys, carrier credentials) NEVER sit in the DB plaintext. The schema carries SSM SecureString paths (e.g. `ldControlTokenSsmKey`, `webhookSecretSsmKey`); the plaintext value is resolved per request and discarded.
- PII fields on `FulfillmentOrder` (`destCpfCnpj`, `destNome`, `destEmail`, `destTelefone`, `destEndereco`, `entregaEndereco`) are marked in the schema with a banner. They MUST NOT appear in Pino log payloads, error messages, or webhook event-replay logs. Reference orders by `chaveAcesso` / `merchantOrderRef` only.

## Anti-spoofing

NFe push endpoint MUST verify the XML's `<emit><CNPJ>` matches the tenant's configured CNPJ. Mismatch → 409. Without this check, any tenant could push another merchant's NFe.

## Ingestion gates (NFe → routable order)

After parsing, ALL of these must hold before an order enters the pool:

1. `<protNFe><infProt><cStat>` == 100 (autorizada). Anything else (101 cancelada, 110 denegada, 301/302 rejected) → store as `RECEIVED` but never advance to `PICKING`.
2. `<ide><tpNF>` == 1 (saida). `tpNF == 0` = inbound return; skip routing entirely.
3. `<ide><finNFe>` == 1 (normal). Values 2/3/4 (complementar / ajuste / devolução) skip routing.
4. `<emit><CNPJ>` == tenant.cnpj (anti-spoofing).

## XML → schema mapping (canonical)

| XML path | Schema field |
|---|---|
| `infNFe/@Id` (strip "NFe" prefix) | `chaveAcesso` |
| `ide/nNF` | `nfeNumero` |
| `ide/serie` | `nfeSerie` |
| `ide/dhEmi` | `emissaoAt` |
| `ide/tpNF` | `tpNF` |
| `ide/finNFe` | `finNFe` |
| `emit/CNPJ` | `emitCnpj` |
| `emit/xNome` | `emitRazaoSocial` |
| `emit/xFant` | `emitNomeFantasia` |
| `emit/enderEmit` | `emitEndereco` (JSON) |
| `dest/CPF` OR `dest/CNPJ` OR `dest/idEstrangeiro` | `destCpfCnpj` |
| `dest/xNome` | `destNome` |
| `dest/email` | `destEmail` |
| `dest/enderDest/fone` | `destTelefone` |
| `dest/enderDest` | `destEndereco` (JSON) |
| `entrega` (when present) | `entregaEndereco` (JSON) |
| `transp/modFrete` | `modFrete` |
| `transp/transporta/CNPJ` | `transpCnpj` |
| `transp/transporta/xNome` | `transpRazaoSocial` |
| `transp/vol/pesoB` | `pesoBrutoKg` |
| `transp/vol/pesoL` | `pesoLiquidoKg` |
| `transp/vol/qVol` | `volumes` |
| `total/ICMSTot/vProd` | `totalProdutos` |
| `total/ICMSTot/vDesc` | `totalDesconto` |
| `total/ICMSTot/vFrete` | `totalFrete` |
| `total/ICMSTot/vNF` | `totalNFe` |
| `protNFe/infProt/cStat` | `sefazStatus` |
| `protNFe/infProt/nProt` | `sefazProtocolo` |
| `compra/xPed` | `merchantOrderRef` (Shopify order name without `#`) |
| Per-item: `det[nItem]/prod/cProd` | `FulfillmentOrderItem.codigo` |
| Per-item: `det/prod/cEAN` | `FulfillmentOrderItem.ean` |
| Per-item: `det/prod/xProd` | `descricao` |
| Per-item: `det/prod/qCom` | `quantidade` |
| Per-item: `det/prod/uCom` | `unidade` |
| Per-item: `det/prod/vUnCom` | `valorUnitario` |
| Per-item: `det/prod/vProd` | `valorTotal` |
| Per-item: `det/prod/vDesc` | `valorDesconto` |

Sample NFe lives at `sandbox/gebeauty/fulfillment/sample-nfe.xml` (chave `35260...124810`, 2026-05-20, R$142.80).

## NFe ingestion mode

V1: **merchant pushes XML** to `POST /v1/:tenant/orders` (content-type `application/xml`). No A1 cert, no SEFAZ DF-e poll. Idempotent on `chaveAcesso`.

V2 (later): Focus NFe adapter for merchants who can't push from their ERP. Same canonical model, different ingress.

## Memory

- [[project_rota_local]] — venture context, locked architecture decisions
- [[project_gebeauty_tenant]] — pilot merchant
- [[feedback_route_maps_blocker]] — §6.2 visual check is mandatory before dispatch
- [[reference_shopify_br_cpf]] — CPF/CNPJ surface notes (relevant for `dest.cpfCnpj`)
