# Order Seeding Commands

## Primary CSV seeding (resumes with progress)
Uses `storage/seed-progress.json` to skip already-seeded CSV orders.

```
npm run seed:local-delivery -- --csv-dir=sample-data/seed
```

### Optional flags
- `--csv-dir=PATH` CSV directory to load (default: `sample-data/seed`)
- `--csv=PATH` Single CSV file (overrides directory)
- `--max-orders=N` Limit number of CSV orders
- `--dry-run` Parse + print only (no API calls)
- `--verify` Verify seeded order attributes after completion
- `--progress-file=PATH` Override progress file path
- `--reset-progress` Clear progress file before running
- `--keep-local-drafts` Keep `LOCAL` tagged orders as drafts (others completed)

## CSV seeding (ignore progress; seed everything)
Always seeds all CSV orders, regardless of existing progress.

```
node --import tsx scripts/seed-all-orders.ts
```

### Optional flags
- `--csv-dir=PATH` CSV directory to load (default: `sample-data/seed`)
- `--csv=PATH` Single CSV file
- `--max-orders=N` Limit number of CSV orders
- `--dry-run` Parse + print only (no API calls)
- `--verify` Verify seeded order attributes after completion

Note: This script uses a separate progress file at `storage/seed-progress-all.json`
and forces `--reset-progress`.

## Address-based seeding (non-CSV)
Seeds orders from `sample-data/addresses.csv`.

```
npm run seed:local-delivery
```

### Optional flags
- `--limit=N` Limit number of address rows
- `--count-per-zip=N` Create N orders per ZIP code
- `--shipping=local|regular|mixed` Shipping preset selection
- `--complete` Complete draft orders into real orders
- `--debug-routing` Log routing debug info
- `--verify` Verify seeded order attributes
- `--dry-run` Parse + print only (no API calls)

## Environment requirements
- `SHOPIFY_STORE_DOMAIN` (or `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_STORE`)
- `SHOPIFY_ADMIN_ACCESS_TOKEN` (or `SHOPIFY_ADMIN_API_ACCESS_TOKEN`)
- Optional: `SHOPIFY_API_VERSION`, `LOCAL_DELIVERY_RADIUS_KM`

## Cases used so far
- `npm run seed:local-delivery -- --csv-dir=sample-data/seed --max-orders=5 --dry-run`
  Dry-run a small batch to validate parsing and payloads without creating orders.
- `npm run seed:local-delivery -- --csv-dir=sample-data/seed --max-orders=5`
  Seed a 5-order batch to test live creation and API behavior.
- `npm run seed:local-delivery -- --csv-dir=sample-data/seed`
  Full CSV seeding with progress tracking and retry/resume behavior.
- `npm run seed:local-delivery -- --csv-dir=sample-data/seed --keep-local-drafts`
  Leaves `LOCAL` tagged orders as unconfirmed drafts; completes non-LOCAL orders.
- `node --import tsx scripts/seed-all-orders.ts --csv-dir=sample-data/seed`
  Force re-seeding all CSV orders, ignoring existing progress.
- `npm run seed:local-delivery -- --csv-dir=sample-data/seed`
  Seeds CSV orders with LOCAL-tagged orders left as draft; non-LOCAL orders are completed.

---

# Deploy Runbook (GE Beauty subpath)

Use this when deploying `omnify-gebeauty-service` and when URL/routing/deploy issues happen.

## 1) Pre-deploy code checks

Ensure there is no manual basePath prefix in app-internal links:

```powershell
Get-ChildItem -Path app\routes -Recurse -Filter *.tsx | Select-String -Pattern 'href=\{`\$\{basePath\}/app/'
git grep -n 'href={`${basePath}/app/' -- app/routes
```

Expected: no matches.

## 2) Build image with subpath

Always build with `BASE_PATH=/full`:

```powershell
cd "C:\Users\Lucas Guimarães\Desktop\cpg-labs\omnify"
docker build --build-arg BASE_PATH=/full -t omnify-app:full-v3 .
```

## 3) Push to ECR

```powershell
cd "C:\Users\Lucas Guimarães\Desktop\cpg-labs\omnify\infra\terraform"
$ecrUrl = terraform output -raw ecr_repository_url
$ecrHost = ($ecrUrl -split "/")[0]
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ecrHost
docker tag omnify-app:full-v3 "${ecrUrl}:full-v3"
docker push "${ecrUrl}:full-v3"
```

## 4) Deploy on ECS

```powershell
aws ecs update-service --cluster omnify-cluster --service omnify-gebeauty-service --force-new-deployment --region us-east-1
aws ecs wait services-stable --cluster omnify-cluster --services omnify-gebeauty-service --region us-east-1
aws ecs describe-services --cluster omnify-cluster --services omnify-gebeauty-service --region us-east-1 --query "services[0].events[0:12].[createdAt,message]" --output table
```

## 5) Verify running image digest

```powershell
$taskArn = aws ecs list-tasks --cluster omnify-cluster --service-name omnify-gebeauty-service --region us-east-1 --query "taskArns[0]" --output text
aws ecs describe-tasks --cluster omnify-cluster --tasks $taskArn --region us-east-1 --query "tasks[0].containers[0].{Image:image,ImageDigest:imageDigest,StartedAt:startedAt}" --output table
```

## 6) Post-deploy app checks

- Open app in private/incognito window (avoid stale embedded cache).
- Hard refresh inside Shopify Admin app page.
- Verify Retail Expansion opens from sidebar without duplicated subpath.
- Expected path shape: `/full/app/retail-expansion` (not `/full/full/...`).

## Expected internal route links (embedded app)

- Use app-internal paths: `/app/...`
- Do not hardcode Shopify host paths (`/apps/omnify-custom/...`).
- Do not manually prepend `${basePath}` in client nav links when basename handles subpath.

## Fast failure recovery

### A) ECR login fails (400) or push fails (403)

Diagnostics:

```powershell
aws sts get-caller-identity --region us-east-1
aws ecr describe-repositories --region us-east-1 --repository-names omnify-app
$pw = aws ecr get-login-password --region us-east-1
$pw.Length
```

Recovery:

```powershell
docker logout 477780048372.dkr.ecr.us-east-1.amazonaws.com
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 477780048372.dkr.ecr.us-east-1.amazonaws.com
```

If still failing on Windows:
- Restart Docker Desktop.
- Ensure Windows time service is running and synced.
- Re-run login/push.

### B) Deploy succeeds but old behavior remains

- Confirm ECS reached steady state and started new task.
- Confirm task image digest matches pushed digest.
- Clear browser cache or use private window.
- Re-open app from Shopify Admin.

### C) URL duplicates `/full/full/...`

Check for:
- client links using `href={`${basePath}/app/...`}`
- mixed subpath handling (basename + manual prefix)

Fix:
- Keep client links as `/app/...`
- Keep subpath in deploy/runtime config (`BASE_PATH=/full`) and app URL config.

---

# Local Delivery Optimization + Lalamove Ops

## Required environment keys

```powershell
GOOGLE_MAPS_API_KEY=<google_maps_key>
LALAMOVE_API_KEY=<pk_test_or_pk_prod>
LALAMOVE_API_SECRET=<sk_test_or_sk_prod>
LALAMOVE_BASE_URL=https://rest.sandbox.lalamove.com
# Production: https://rest.lalamove.com
LALAMOVE_WEBHOOK_SECRET=<shared_secret_optional>
```

## Rebuild after scope updates

If `shopify.app.toml` scopes changed, redeploy and re-consent the app:

```powershell
npm run deploy
```

Then reinstall/re-open app in Shopify Admin to grant new scopes.

## Test Google route optimization

1. Open Local delivery.
2. Keep unassigned orders with valid coordinates.
3. Click `Optimize fleet`.
4. Verify:
   - route tags are reassigned automatically
   - Assigned routes card count changes
   - fleet summary (routes, km, ETA) is shown

Rollback: reassign manually from `Assign orders to route` if optimize result is not desired.

## Test Lalamove direct dispatch

1. In Assigned routes, click `Request driver`.
2. Confirm quote modal shows quotation id/expiry.
3. Click `Confirm request`.
4. Verify:
   - dispatch row created in DB (`LalamoveDispatchJob`)
   - order mappings created (`LalamoveDispatchOrderMap`)
   - Shopify fulfillment is moved to in-transit lifecycle.

## Webhook verification test

Send a signed payload to `/webhooks/lalamove` (or skip signature check if no secret is configured):

```powershell
curl -X POST "https://<app-host>/webhooks/lalamove" `
  -H "Content-Type: application/json" `
  -H "X-Lalamove-Signature: <hex_hmac>" `
  -d "{\"data\":{\"orderId\":\"<id>\",\"status\":\"ON_GOING\",\"metadata\":{\"shop\":\"<shop>.myshopify.com\"}}}"
```

Expected:
- event row in `LalamoveDispatchEvent`
- mapped Shopify orders updated to out-for-delivery

## Failed delivery recovery checklist

- Confirm webhook/status state is `CANCELED`, `REJECTED`, or `EXPIRED`.
- Verify Shopify order has `Failed delivery` tag.
- Verify fulfillment was canceled and order returned to unfulfilled state.
- Verify failure warning appears in Local delivery above pre-sale/address warnings.