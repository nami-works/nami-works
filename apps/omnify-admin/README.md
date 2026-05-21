# Shopify App Template - React Router

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using [React Router](https://reactrouter.com/). It was forked from the [Shopify Remix app template](https://github.com/Shopify/shopify-app-template-remix) and converted to React Router.

Rather than cloning this repo, follow the [Quick Start steps](https://github.com/Shopify/shopify-app-template-react-router#quick-start).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-react-router) for more details on the React Router app package.

## Upgrading from Remix

If you have an existing Remix app that you want to upgrade to React Router, please follow the [upgrade guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix). Otherwise, please follow the quick start guide below.

## Quick start

### Prerequisites

Before you begin, you'll need to [download and install the Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) if you haven't already.

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

## Omnify functions

This app ships with three Shopify Admin functions. Each section below combines the original functional spec with the implemented behavior in this repo.

### Goals (`/app/goals`)

**Purpose**
- Track sales performance against launch goals and compare a target product to benchmark products.

**How it works**
- **Launch setup**: Configure target product (or "All products"), launch date, revenue/unit goals for Day 1, Week 1, Month 1, plus benchmarks and segmentation rules.
- **Date range**: Pick a predefined range or custom start/end dates.
- **Data load**: Fetches orders from Shopify Admin API for the date range, normalizes line items, and computes revenue, orders, units, AOV, and daily rollups.
- **Outputs**: KPI summary, launch progress, top products, benchmarks, segment goal performance, and recent orders.
- **Export**: Generates a CSV download from the computed dataset.

**Persistence**
- Stored per shop in Prisma tables:
  - `GoalsConfig` (configuration JSON)
  - `GoalsRun` (cached computed results by shop + date range + config hash)

**Key dependencies**
- Shopify Admin GraphQL API (`orders`, `lineItems`, `currentTotalPriceSet`, `sourceName`, `fulfillmentOrders`)

### Retail expansion (`/app/retail-expansion`)

**Purpose**
- Evaluate potential retail locations by ranking customer proximity and revenue impact within a chosen influence radius.

**How it works**
- **Projects**: Load or create expansion projects. Each project stores a named set of locations.
- **Locations**: Add locations via Google Places Autocomplete or map click; manage them as removable tags.
- **Influence radius + timeframes**: Select the radius and timeframe to determine which analytics are used.
- **Rankings**: Revenue and customer ranking blocks can toggle between table view and a custom chart view.
- **Analytics**: Pulls and caches customer/order geo analytics for ranking and map visualization.

**Persistence**
- When a shop is present, data is stored in the app database (Prisma): `RetailCurrentLocations`, `RetailLocationSet`, `RetailAnalyticsCache`. When shop is omitted (e.g. compliance wipe), fallback JSON files under `storage/retail-expansion` are used.

**Weekly cron (optional)**
- Set `CRON_SECRET` in env. Schedule a job (e.g. every Sunday night) to call `GET /api/cron/retail-analytics` with header `X-Cron-Secret: <CRON_SECRET>`. The endpoint returns the count of shops with retail data. Analytics backfill currently runs when merchants open the Retail expansion page (first load). For a fully automated weekly refresh, implement a worker that loads sessions from the DB and runs the same backfill per shop.

**Key dependencies**
- Google Maps JavaScript API (map display + Places Autocomplete)
- Shopify Admin GraphQL API for orders/customers used in analytics cache

### Local delivery (`/app`)

**Purpose**
- Plan and assign local delivery routes by visualizing orders, selecting deliveries, and tagging orders by route.

**How it works**
- **Filters**: Fulfillment location and map style filters; delivery method filtering uses Shopify fulfillment delivery methods.
- **Map**: Displays fulfillment locations and order delivery coordinates with Advanced Markers.
- **Route assignment**: Select orders and assign them to predefined routes (`ld_rota-01`, `ld_rota-02`, `ld_rota-03`) using Shopify tags.
- **Warnings**: Flags fulfillment mismatches for LOCAL-tagged orders.
- **Precomputed routes**: Optional use of Google Routes API to draw optimized polylines per location.

**Persistence**
- Route assignment persists in Shopify order tags.
- No additional app storage is used for routes.

**Key dependencies**
- Shopify Admin GraphQL API (`orders`, `locations`, `tagsAdd`, `tagsRemove`)
- Google Maps JavaScript API (maps + Advanced Markers)
- Google Routes API (precomputed route polylines)

### Lalamove credential security

- Enable per-shop credentials by setting `LALAMOVE_PER_SHOP_CREDENTIALS=true`.
- **Required for saving credentials:** Configure encryption with:
  - `APP_ENCRYPTION_KEY` (base64, 32-byte key for AES-256-GCM). Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` or `openssl rand -base64 32`
  - `APP_ENCRYPTION_KEY_VERSION` (integer, e.g. `1`)
  - optional `APP_PREVIOUS_ENCRYPTION_KEYS` for key rotation (`version:base64,version:base64`)
- **Production (Terraform):** Add `app_encryption_key = "<generated-key>"` to `infra/terraform/terraform.tfvars`, then run `terraform apply`.
- During rollout, runtime keeps temporary fallback to env credentials (`LALAMOVE_API_KEY` / `LALAMOVE_API_SECRET`) when per-shop credentials are not found.
- Merchant credentials are encrypted at rest in `LalamoveShopCredential`.
- On app uninstall, encrypted credentials are deleted for that shop (`webhooks.app.uninstalled`), supporting data minimization and retention controls.

## Seeding test orders (local delivery)

This project includes a script to generate test orders from
`sample-data/addresses.csv` and mark them as local delivery by using the local
delivery shipping line from `sample-data/local-delivery_order.json`.

### Required environment variables

- `SHOPIFY_STORE_DOMAIN` (example: `nami-works.myshopify.com`)
- `SHOPIFY_ADMIN_ACCESS_TOKEN` (Admin API access token for the dev store)
- `SHOPIFY_API_VERSION` (optional, defaults to `2025-10`)

### Run the seed script

```shell
npm run seed:local-delivery -- --limit=25
```

By default, the script creates one order per CSV row.

Optional flags:
- `--count-per-zip=3` (repeat each zipcode N times instead of per row)
- `--dry-run` (log without creating orders)
- `--verify` (fetch created orders and check for local-delivery markers)

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## Deployment

### Production overview
- Hosting: AWS ECS Fargate behind an ALB
- Database: AWS RDS PostgreSQL
- Secrets: AWS SSM Parameter Store
- Region: `us-east-1`
- App URL: `https://omnify.cpg-labs.io`
- Domain DNS: GoDaddy CNAME -> ALB DNS name

### Production environment variables
Set these in AWS SSM Parameter Store (prefix: `/omnify/`):
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL` (set to `https://omnify.cpg-labs.io`)
- `SCOPES` (`read_customers,read_locations,read_merchant_managed_fulfillment_orders,read_orders`)
- `DATABASE_URL` (RDS Postgres connection string)
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_MAPS_MAP_ID`
- `APP_ENCRYPTION_KEY` (required for Lalamove per-shop credentials; must be stable across deploys)

### Data persistence
- **Production:** Uses RDS PostgreSQL via `DATABASE_URL`. Merchant data (sessions, Lalamove configs, credentials, etc.) persists across app deploys and builds.
- **Local dev:** Uses SQLite (`file:dev.sqlite`). Data is stored locally and is not shared across machines.
- **Required for production:** `DATABASE_URL` and `APP_ENCRYPTION_KEY` must be set. Do not rotate `APP_ENCRYPTION_KEY` without a migration plan, as existing encrypted credentials would become unreadable.

### AWS infrastructure (Terraform)
Terraform lives under `infra/terraform` and provisions:
- ECS cluster + service
- ALB + target group
- RDS PostgreSQL instance
- ECR repository
- IAM roles and SSM parameters
- CloudWatch log group

Run from `infra/terraform`:
```
terraform init
terraform plan
terraform apply
```

### Docker image publish (ECR)
From the repo root:
```
.\scripts\deploy-ecr.ps1 -Region us-east-1 -Repository 477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app -Tag v1
```

Then update `image_tag` in `infra/terraform/terraform.tfvars` and re-apply Terraform.

### DNS
GoDaddy CNAME record:
- Name: `omnify`
- Value: `omnify-alb-2060949013.us-east-1.elb.amazonaws.com`

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                                    |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host it externally. From there, you have a few options:

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run): This tutorial is written specifically for this example repo, and is compatible with the extended steps included in the subsequent [**Build your app**](tutorial) in the **Getting started** docs. It is the most detailed tutorial for taking a React Router-based Shopify app and deploying it to production. It includes configuring permissions and secrets, setting up a production database, and even hosting your apps behind a load balancer across multiple regions.
- [Fly.io](https://fly.io/docs/js/shopify/): Leverages the Fly.io CLI to quickly launch Shopify apps to a single machine.
- [Render](https://render.com/docs/deploy-shopify-app): This tutorial guides you through using Docker to deploy and install apps on a Dev store.
- [Manual deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): This resource provides general guidance on the requirements of deployment including environment variables, secrets, and persistent data.

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

## Gotchas / Troubleshooting

### Local delivery: fulfillmentCreateV2 / "fulfill_and_ship_orders" access denied

If Lalamove sync or "Request driver" fails with:

```
Access denied for fulfillmentCreateV2 field. Required access: write_merchant_managed_fulfillment_orders ...
Also: The user must have fulfill_and_ship_orders permission.
```

1. **App scopes** – The app must request `write_merchant_managed_fulfillment_orders` (see `shopify.app.toml` or `shopify.app.omnify-custom.toml`). After adding or changing scopes, redeploy and have the merchant re-accept the app’s permission request if prompted.
2. **Staff permission** – The logged-in Shopify user must have **Fulfill and ship orders** (Settings → Users and permissions → Staff member → Permissions). Without this, the API will reject fulfillment creation even when the app has the correct scope.

### Database tables don't exist

If you get an error like:

```
The table `main.Session` does not exist in the current database.
```

Create the database for Prisma. Run the `setup` script in `package.json` using `npm`, `yarn` or `pnpm`.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file. This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`). Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead. Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app. This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately cloudflare tunnels wait for the Response stream to finish, then sends one chunk. This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired. If you are consistently getting this error, it could be that the clock on your machine is not in sync with the server. To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

### Unable to require(`C:\...\query_engine-windows.dll.node`).

Unable to require(`C:\...\query_engine-windows.dll.node`).
The Prisma engines do not seem to be compatible with your system.

query_engine-windows.dll.node is not a valid Win32 application.

**Fix:** Set the environment variable:

```shell
PRISMA_CLIENT_ENGINE_TYPE=binary
```

This forces Prisma to use the binary engine mode, which runs the query engine as a separate process and can work via emulation on Windows ARM64.

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
