# Flywheel — scaffold handover

**Date:** 2026-05-18
**Status:** Code-side scaffold landed on `main`. App is dormant until the user-side steps below are completed. Affiliates continues serving from the CPG Labs full app (displayed as "Omnify" to merchants) in the meantime.

## What landed in this repo

| File | Change |
|---|---|
| [shopify.app.flywheel.toml](../shopify.app.flywheel.toml) | New Shopify CLI config. `client_id = "<PLACEHOLDER>"`, `application_url = "https://flywheel.cpg-labs.io"`, compliance + `app/*` webhooks, minimal `read_products` scope (expand later). |
| [app/utils/app-identity.server.ts](../app/utils/app-identity.server.ts) | `"flywheel"` added to `AppIdentity` union + `APP_DISPLAY_NAMES` (`"Flywheel"`). `IDENTITY_ROUTES.flywheel` registers `app.affiliates` + `api.cron.affiliates-sync` (prefix match catches every `app.affiliates.*` child route). `IDENTITY_NAV.flywheel` shows `/app/affiliates`. |
| [scripts/deploy.ps1](../scripts/deploy.ps1) | New `-App flywheel` (single container) and `-App all` (full + omnify + flywheel) values. Build/push/restart loop is now generic — one image, tagged once per app key. Existing `-App full / omnify / both` calls unchanged. |
| [docs/project-brief.md](./project-brief.md) | "In progress" entry added so planning conversations see the Flywheel umbrella exists. |

Affiliates surface wired under the Flywheel umbrella:
- `app/routes/app.affiliates.tsx` + `app/routes/app.affiliates/*` (onboarding, settings, attribution-queue, profiles-list, profile-detail, css)
- `app/routes/app.affiliates.onboarding.tsx`
- `app/routes/api.cron.affiliates-sync.tsx`

Nothing was moved or renamed — these routes continue to live where they are. The wiring is purely the identity gate in `app-identity.server.ts`.

## What's left — user-side only

Each step below is something Claude can't do from this repo. They can run in any order except where noted.

### 1. Register the Flywheel app in Shopify Partner Dashboard
- Create a new app, set the app URL to `https://flywheel.cpg-labs.io`, set the OAuth callback to `https://flywheel.cpg-labs.io/api/auth`.
- Copy the real `client_id` and replace `<PLACEHOLDER>` in [shopify.app.flywheel.toml](../shopify.app.flywheel.toml).
- Add the corresponding `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` to `/etc/cpg-labs/flywheel.env` on the Lightsail box (step 4 below).

### 2. DNS — point `flywheel.cpg-labs.io` at the Lightsail box
- GoDaddy → cpg-labs.io DNS → add an **A record**: `flywheel` → `54.221.23.142`, TTL 600.
- No Route 53 changes needed (DNS lives at GoDaddy post-2026-05-11 cutover).

### 3. Caddy — add a site block on the Lightsail box
```
ssh -i ~/.ssh/cpg-labs-lightsail.pem ubuntu@54.221.23.142
sudo nano /etc/caddy/Caddyfile
```
Add a block mirroring the existing `omnify.cpg-labs.io` one but pointing to a new port (e.g. 3002 — confirm `app.cpg-labs.io` uses 3000 and `omnify.cpg-labs.io` uses 3001 before picking):
```
flywheel.cpg-labs.io {
    reverse_proxy localhost:3002
    encode gzip
    log {
        output file /var/log/cpg-labs/caddy-flywheel.log
    }
}
```
Then `sudo systemctl reload caddy`. Let's Encrypt will issue the cert on first request.

### 4. Env file — `/etc/cpg-labs/flywheel.env`
Copy `/etc/cpg-labs/omnify.env` as a template, then replace:
- `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` → values from the new Partner Dashboard app (step 1)
- `SHOPIFY_APP_URL=https://flywheel.cpg-labs.io`
- `APP_IDENTITY=flywheel`
- Keep `DATABASE_URL`, `GOOGLE_MAPS_*`, encryption-key vars identical to omnify.env so the shared Postgres + secrets work.

```
sudo cp /etc/cpg-labs/omnify.env /etc/cpg-labs/flywheel.env
sudo nano /etc/cpg-labs/flywheel.env
sudo chmod 600 /etc/cpg-labs/flywheel.env
sudo chown root:root /etc/cpg-labs/flywheel.env
```

**Critical:** the wrong `SHOPIFY_API_KEY` in the env file is the exact root cause of the 2026-05-17 blank-install rejection on Omnify (see `memory/project_omnify_blank_install_root_cause.md`). Verify the key matches the Partner Dashboard's "Client ID" for the Flywheel app, not any other app.

### 5. docker-compose — add a `flywheel` service on the Lightsail box
Edit `/srv/cpg-labs/docker-compose.yml`. Copy the `omnify` service and rename:
```yaml
flywheel:
    image: 477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app:flywheel-PLACEHOLDER
    container_name: cpg-labs-flywheel
    restart: unless-stopped
    env_file: /etc/cpg-labs/flywheel.env
    ports:
      - "3002:3000"   # internal port 3000, host port 3002 — must match the Caddy reverse_proxy target
    volumes:
      - /var/log/cpg-labs:/app/logs
```
The first `deploy.ps1 -App flywheel` run will fail the `sed` step if no `omnify-app:flywheel-*` line exists yet — easiest path is to put a real tag in initially (build one image first via `deploy.ps1 -App all`, then add the compose service pointing at that tag).

### 6. First Flywheel image — build + push + deploy
From your dev machine:
```powershell
# Builds one image, tags it three times (full/omnify/flywheel), pushes all three.
./scripts/deploy.ps1 -App all
```
On first run the box won't have a `flywheel` service yet — the sed will succeed (it's a no-op since the line doesn't exist) and the `docker compose up -d flywheel` call will fail until step 5 is done. Acceptable order:
1. Run `./scripts/deploy.ps1 -App both` (existing behavior, pushes full + omnify, no flywheel).
2. Manually pull the new flywheel image on the box: `sudo docker pull <ecr>/omnify-app:flywheel-<tag>`.
3. Add the `flywheel` service to compose with that exact tag.
4. `sudo docker compose up -d flywheel`.
5. From then on, `./scripts/deploy.ps1 -App all` works end-to-end.

### 7. Register scopes/webhooks on Shopify's side
```bash
shopify app deploy --config shopify.app.flywheel.toml
```
Required once after step 1, then again any time scopes or webhook subscriptions change in the toml.

### 8. Verify
- `curl https://flywheel.cpg-labs.io/health` → 200
- Install the Flywheel app on a dev store, confirm the Affiliates nav item is the only one visible (because `IDENTITY_NAV.flywheel = ["/app/affiliates"]`).
- Confirm the Affiliates dashboard renders and the affiliates cron route is callable.

## After Flywheel is live

The intent is for Flywheel to be the canonical home for Affiliates. Once live:
1. Decide whether Affiliates should be **removed** from the CPG Labs full surface (force merchants to install Flywheel) or **stay** there too (Affiliates available in both — fine because the data layer is shared via the same Postgres).
2. If removing: drop `app.affiliates` from the implicit `cpg-labs` reach — currently `cpg-labs` serves every route. That requires either adding an explicit allow-list for cpg-labs (large refactor) or a per-route opt-out (smaller).
3. Either way, update `docs/project-brief.md` ("Recently shipped" → "Flywheel — Affiliates moved under standalone app") and prune the "In progress" entry.

## Rollback

This scaffold is dormant. To remove it cleanly:
- Revert the commit that introduced these files (single squash commit on `main`).
- No Partner Dashboard, DNS, or Lightsail-box changes are needed since none of the user-side steps above have run yet.
