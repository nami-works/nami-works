# Lightsail Migration Runbook — Option A

Move the CPG Labs admin app off AWS ECS Fargate + RDS onto a single Amazon Lightsail instance + managed Lightsail Postgres, plus Cloudflare Pages for the marketing site. Total monthly cost ~$35, down from ~$80–150 today.

This is **planning, not yet executed.** Read end-to-end before starting — some sections (DNS cutover, deploy script rewrite) can only happen after earlier steps land.

---

## Why this shape

- **One Lightsail instance** runs both Shopify apps (`app.cpg-labs.io` and `omnify.cpg-labs.io`) as Docker containers, behind Caddy for HTTPS. Same container image, two env-var sets, two ports.
- **One Lightsail managed Postgres** replaces RDS. Same engine, automated backups included, fixed monthly price.
- **Cloudflare Pages** serves the static marketing site (`cpg-labs.io`) — free, fast, replaces S3 + CloudFront.
- **Linux crontab** replaces the five EventBridge schedules. Simpler, no API destinations, no IAM roles.
- **Secrets via env file on the instance** (or read from SSM if you'd rather keep the existing store). No code change to the app.

What goes away: ECS task definitions, ALB, NAT gateway, EventBridge rules, ECR (you'll push to Docker Hub or Lightsail Container Service, but Option A uses a plain instance so this just means `docker pull` from any registry).

What stays the same: the [`Dockerfile`](Dockerfile) at repo root runs unchanged. The build pipeline (`npm run build` → `npm run setup` → `npm run start`) is identical. The two Shopify TOMLs (`shopify.app.cpg-labs.toml`, `shopify.app.omnify.toml`) stay as-is.

---

## 1. Provisioning

### Lightsail instance

- **Region:** `us-east-1` (same as current RDS — keeps DB import in-region, low latency).
- **Plan:** `medium_2_0` — 4 GB RAM, 2 vCPUs, 80 GB SSD, $20/mo. Headroom for both app containers + Caddy + cron jobs + occasional Prisma migrations.
- **OS:** Ubuntu 22.04 LTS (matches the `node:20-alpine` runtime well enough; we run Node inside Docker so the host OS just needs Docker).
- **Static IP:** allocate one and attach it to the instance immediately — DNS cutover needs a stable IP. Lightsail static IPs are free while attached.

```bash
aws lightsail create-instances \
  --instance-names cpg-labs-prod \
  --availability-zone us-east-1a \
  --blueprint-id ubuntu_22_04 \
  --bundle-id medium_2_0 \
  --region us-east-1

aws lightsail allocate-static-ip --static-ip-name cpg-labs-ip --region us-east-1
aws lightsail attach-static-ip --static-ip-name cpg-labs-ip --instance-name cpg-labs-prod --region us-east-1
```

Once running, SSH in and install Docker + Caddy:

```bash
# On the Lightsail box
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo apt install -y caddy postgresql-client-15
```

Log out and back in so the docker group takes effect.

### Lightsail managed Postgres

- **Region:** same as instance (`us-east-1`).
- **Plan:** `micro_2_0` — 1 GB RAM, 40 GB disk, $15/mo. Daily automated backups, 7-day retention.
- **Engine:** PostgreSQL 15 (match current RDS version — check with `aws rds describe-db-instances` first and bump if RDS is already on 16).

```bash
aws lightsail create-relational-database \
  --relational-database-name cpg-labs-db \
  --relational-database-blueprint-id postgres_15 \
  --relational-database-bundle-id micro_2_0 \
  --master-database-name cpglabs \
  --master-username cpglabs_admin \
  --master-user-password "<generate-strong-password>" \
  --availability-zone us-east-1a \
  --region us-east-1
```

After provisioning, make it accessible from the Lightsail instance (peered automatically in same region — no manual VPC setup needed) and from your laptop temporarily for the import:

```bash
aws lightsail update-relational-database \
  --relational-database-name cpg-labs-db \
  --publicly-accessible \
  --region us-east-1
```

Grab the endpoint: `aws lightsail get-relational-database --relational-database-name cpg-labs-db --region us-east-1 --query "relationalDatabase.masterEndpoint"`. This is your new `DATABASE_URL`.

**Toggle `publicly-accessible` back off after the import is verified.** Long-term the app reaches the DB over the Lightsail private network.

---

## 2. DB migration

The repo has 35 migrations under `prisma/migrations/`. They apply automatically on container start via the Dockerfile CMD `npm run docker-start` → `npm run setup` (`prisma generate && prisma migrate deploy`). You do **not** need to replay them by hand; you just need the data.

### Dump from RDS

From your laptop, with `DATABASE_URL` pointing at current RDS:

```bash
pg_dump \
  --host=<rds-endpoint>.us-east-1.rds.amazonaws.com \
  --username=<rds-user> \
  --no-owner --no-acl \
  --format=custom \
  --file=cpg-labs.dump \
  <rds-dbname>
```

Expect 5–15 minutes depending on `RetailOrder` + `RetailCustomer` row counts (per CLAUDE.md these are the big tables).

### Restore into Lightsail Postgres

```bash
pg_restore \
  --host=<lightsail-endpoint>.us-east-1.rds.amazonaws.com \
  --username=cpglabs_admin \
  --dbname=cpglabs \
  --no-owner --no-acl \
  --jobs=4 \
  cpg-labs.dump
```

### Verify

```bash
psql -h <lightsail-endpoint> -U cpglabs_admin cpglabs -c "\dt"
psql -h <lightsail-endpoint> -U cpglabs_admin cpglabs -c "SELECT COUNT(*) FROM \"Session\";"
psql -h <lightsail-endpoint> -U cpglabs_admin cpglabs -c "SELECT COUNT(*) FROM \"RetailOrder\";"
```

Counts should match RDS. If `RetailOrder` is huge enough to blow past 40 GB once you add growth headroom, jump the Postgres plan to `small_2_0` ($30/mo, 2 GB RAM / 80 GB disk) before cutover.

Note: when the app container starts for the first time pointing at the new DB, `prisma migrate deploy` will run and find every migration already applied (because `pg_dump` carried over the `_prisma_migrations` table). It's a no-op on a fresh restore.

---

## 3. Docker Compose for both apps

Both Shopify apps build from the same [`Dockerfile`](Dockerfile) at the repo root. The difference between them is entirely in env vars, per [`scripts/apps.psd1`](scripts/apps.psd1). On Lightsail this becomes one `docker-compose.yml` with two services.

Create `/srv/cpg-labs/docker-compose.yml` on the instance:

```yaml
services:
  full:
    image: ghcr.io/<your-org>/cpg-labs:latest   # or Docker Hub / Lightsail Container Registry
    container_name: cpg-labs-full
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - /etc/cpg-labs/full.env
    environment:
      APP_IDENTITY: cpg-labs
      SHOPIFY_APP_URL: https://app.cpg-labs.io
      PORT: "3000"
    networks: [cpg]

  omnify:
    image: ghcr.io/<your-org>/cpg-labs:latest   # same image, different config
    container_name: cpg-labs-omnify
    restart: unless-stopped
    ports:
      - "3001:3000"
    env_file:
      - /etc/cpg-labs/omnify.env
    environment:
      APP_IDENTITY: omnify
      SHOPIFY_APP_URL: https://omnify.cpg-labs.io
      PORT: "3000"
    networks: [cpg]

networks:
  cpg:
    driver: bridge
```

Both containers listen on port 3000 inside their own network namespace; the host maps them to 3000 (full) and 3001 (omnify). Caddy in front routes by hostname.

The `Dockerfile` already builds with optional `BASE_PATH` — leave it unset for both. The split-brain subpath setup is gone on this architecture; both apps live at root path on their own subdomain.

### One-time: pull the image

The current build is in ECR. Two paths:

- **Easier:** push a copy to GitHub Container Registry (`ghcr.io`) from your laptop after each `docker build`. Free for public repos, fine for private with a PAT.
- **AWS-native:** keep using ECR and `aws ecr get-login-password | docker login` on the Lightsail box (the IAM role attached to the instance gets `ecr:GetAuthorizationToken` + `ecr:BatchGetImage`).

Either way, the deploy is `docker compose pull && docker compose up -d` — see section 8.

---

## 4. Caddy reverse proxy

Caddy auto-issues Let's Encrypt certs for both subdomains. The config file is `/etc/caddy/Caddyfile`:

```caddy
app.cpg-labs.io {
    reverse_proxy localhost:3000
    encode gzip zstd

    # Drop trailing slashes for cleaner URLs (Shopify embedded admin doesn't care)
    @hasTrailing path_regexp trailing (.+)/$
    redir @hasTrailing /{re.trailing.1} 301
}

omnify.cpg-labs.io {
    reverse_proxy localhost:3001
    encode gzip zstd
}
```

Reload Caddy: `sudo systemctl reload caddy`. Certs provision within 30 seconds once DNS points at the box — see section 7 for the order of operations.

Caddy logs to `/var/log/caddy/access.log` by default. Tail with `sudo journalctl -u caddy -f` for live debugging.

---

## 5. Crontab — replacing the 5 EventBridge schedules

The five EventBridge cron rules in [`infra/terraform/`](infra/terraform/) become five `crontab` lines on the Lightsail box. They all call the app over **localhost** (no Caddy hop, no public exposure) and pass the same `X-Cron-Secret` header the app already verifies.

Set the secret as an env var Cron can read:

```bash
sudo tee /etc/cpg-labs/cron.env > /dev/null <<'EOF'
CRON_SECRET=<paste-the-existing-CRON_SECRET-from-SSM>
EOF
sudo chmod 600 /etc/cpg-labs/cron.env
```

Edit root's crontab (`sudo crontab -e`):

```cron
# Load the secret for every job below
SHELL=/bin/bash
BASH_ENV=/etc/cpg-labs/cron.env

# Auto-delivery — assign + dispatch (every 5 minutes)
# Source: infra/terraform/delivery-cron.tf
*/5 * * * * curl -fsS -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/auto-delivery >> /var/log/cpg-labs/cron.log 2>&1

# Lalamove watchdog — stuck-order retry (every 5 minutes)
# Source: infra/terraform/delivery-cron.tf
*/5 * * * * curl -fsS -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/lalamove-watchdog >> /var/log/cpg-labs/cron.log 2>&1

# Affiliates ranking refresh (hourly at :30)
# Source: infra/terraform/affiliates-cron.tf
30 * * * * curl -fsS -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/affiliates-ranking >> /var/log/cpg-labs/cron.log 2>&1

# Retail goals refresh (hourly at :00)
# Source: infra/terraform/retail-goals-cron.tf
0 * * * * curl -fsS -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/retail-goals >> /var/log/cpg-labs/cron.log 2>&1

# Shop ingest sync (hourly at :15)
# Source: infra/terraform/shop-ingest-cron.tf
15 * * * * curl -fsS -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/shop-ingest >> /var/log/cpg-labs/cron.log 2>&1
```

Create the log directory once: `sudo mkdir -p /var/log/cpg-labs && sudo chmod 755 /var/log/cpg-labs`.

**Note on which app gets cron traffic:** all five hit port 3000 (the `full` app at `app.cpg-labs.io`). That matches the current architecture — the `omnify` app is the merchant-facing focused build and doesn't run delivery/affiliate/retail pipelines. If a future cron is omnify-specific, point it at `localhost:3001` instead.

**Log rotation:** add `/etc/logrotate.d/cpg-labs`:

```
/var/log/cpg-labs/cron.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
}
```

---

## 6. Secrets migration

You have two options. Pick one.

### Option 6A — Plain env file on the instance (simplest)

Pull the current SSM values once, drop them in `/etc/cpg-labs/full.env` and `/etc/cpg-labs/omnify.env`. Docker Compose `env_file` loads them at container start.

```bash
# From your laptop, with AWS creds
aws ssm get-parameters-by-path --path /omnify/ --recursive --with-decryption --region us-east-1 \
  --query "Parameters[*].[Name,Value]" --output text > omnify-secrets.txt

# Manually filter into full.env (for cpg-labs) and omnify.env (for omnify)
# Strip the /omnify/ prefix, one KEY=VALUE per line.
```

Then on the Lightsail box:

```bash
sudo mkdir -p /etc/cpg-labs
sudo install -m 600 full.env /etc/cpg-labs/full.env
sudo install -m 600 omnify.env /etc/cpg-labs/omnify.env
```

What goes in each:

- **`full.env`** — `DATABASE_URL` (new Lightsail Postgres), `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (cpg-labs values), `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID`, `CRON_SECRET`, `LALAMOVE_API_KEY`, `LALAMOVE_API_SECRET`, `ENCRYPTION_KEY`, plus any other `/omnify/*` parameters the app reads.
- **`omnify.env`** — same set but with the omnify Shopify credentials.

Tradeoff: secrets live on disk. The instance is in your AWS account behind SSH key auth, so the exposure is contained — but rotation means `sudo nano` + restart, not a one-command SSM update.

### Option 6B — Keep SSM, read at container start (more like today)

Attach an IAM role to the Lightsail instance with `ssm:GetParameter` permission scoped to `/omnify/*`. Add a tiny entrypoint script that fetches secrets and exports them before `npm run docker-start`. This keeps the rotation flow you have today.

Lightsail instances support IAM roles via the `attach-instance-iam-role` flow. It's slightly fiddlier than ECS task-role injection but it works. Use this option if SSM rotation matters more than simplicity.

Recommendation: **start with 6A** because it's the fastest path to a working migration. Move to 6B later if rotation cadence becomes painful.

---

## 7. DNS cutover

Order of operations matters here. Don't flip DNS until the Lightsail box answers cleanly.

### Pre-cutover validation (on the Lightsail box, before DNS change)

Add temporary `/etc/hosts` entries on your laptop pointing the two domains at the Lightsail IP, then load both apps in a browser:

```
# On your laptop, /etc/hosts (Windows: C:\Windows\System32\drivers\etc\hosts)
<lightsail-static-ip>  app.cpg-labs.io
<lightsail-static-ip>  omnify.cpg-labs.io
```

Caddy can't issue real Let's Encrypt certs until DNS actually points at the box, so for this validation step use a self-signed cert or test with `--insecure`. Hit each app, verify the health endpoint, check that the embedded admin loads. Remove the hosts entries.

### Real cutover

**DNS for `cpg-labs.io` is managed at GoDaddy**, not Route 53 — this was the runbook's biggest factual error on the original 2026-05-11 cutover attempt. The only Route 53 hosted zone in the AWS account is `nami.works`. Authoritative nameservers for `cpg-labs.io` are `ns29.domaincontrol.com` and `ns30.domaincontrol.com` (GoDaddy).

Currently `app.cpg-labs.io` and `omnify.cpg-labs.io` resolve via GoDaddy CNAME records pointing at the ALB (`omnify-alb-2060949013.us-east-1.elb.amazonaws.com`). Change them to A records pointing at the Lightsail static IP.

**At GoDaddy** (`dcc.godaddy.com/domains` → `cpg-labs.io` → DNS Management):

1. Find the two CNAME records:
   - `app` → `omnify-alb-2060949013.us-east-1.elb.amazonaws.com`
   - `omnify` → `omnify-alb-2060949013.us-east-1.elb.amazonaws.com`
2. Edit each — change Type from `CNAME` to `A`, change Value from the ALB hostname to the Lightsail static IP.
3. Set TTL to the smallest available value (600s on most plans, custom 60s on some). Lower TTL = faster rollback if needed.

GoDaddy's UI may show "modify" instead of separate "delete + add" — modify in place. If the CNAMEs are locked by a Domain Connect integration (Office 365 / Forwarding / etc.), disconnect the integration first, then modify.

**Note on auth:** GoDaddy uses SMS-based MFA by default for DNS changes. If SMS delivery fails (common in some regions), switch to an authenticator app via `account.godaddy.com/security` before attempting the change. Resolving MFA blocked the 2026-05-11 cutover for ~2 hours.

Within ~60 seconds of saving, public resolvers will start returning the new IP. Once DNS resolves to Lightsail, Caddy will request real Let's Encrypt certs on first connection (~30s for both subdomains). Watch `sudo journalctl -u caddy -f` for `certificate obtained successfully` lines.

### Marketing site (`cpg-labs.io`)

The marketing site moved to S3 + CloudFront earlier (the broader split documented in CLAUDE.md "Public Site" section). If migrating to Cloudflare Pages becomes preferred later: connect the repo, set build command `cd site && npm install && npm run build`, output directory `site/dist`, custom domain `cpg-labs.io`. Cloudflare handles certs + CDN automatically. Free. Then at GoDaddy change the `cpg-labs.io` apex record to point at Cloudflare's nameservers (full delegation) — or keep GoDaddy and use a CNAME to the Cloudflare Pages hostname.

---

## 8. `scripts/deploy.ps1` strategy

The current [`scripts/deploy.ps1`](scripts/deploy.ps1) orchestrates: build image → push to ECR → update ECS task definition → force new deployment → wait for health check. Most of that goes away. The new flow is:

1. Build image locally (`docker build -t cpg-labs:latest .`)
2. Push to your registry (`docker push ghcr.io/<org>/cpg-labs:latest`)
3. SSH into the Lightsail box
4. `docker compose pull && docker compose up -d`
5. Hit the health URL to confirm

Rough sketch — replace the ECS sections, keep the build + tag + health-check helpers from `_deploy-common.psm1`:

```powershell
param(
  [Parameter(Mandatory=$true)][ValidateSet('full','omnify','both')]
  [string]$App
)

Import-Module "$PSScriptRoot/_deploy-common.psm1"

$Registry = "ghcr.io/<org>/cpg-labs"
$Tag      = "$(Get-Date -Format yyyyMMdd)-$(git rev-parse --short HEAD)"
$Host     = "ubuntu@<lightsail-static-ip>"
$KeyPath  = "$env:USERPROFILE\.ssh\cpg-labs.pem"

Assert-CleanWorkingTree
Invoke-DockerBuild  -Image $Registry -Tag $Tag
Invoke-DockerPush   -Image $Registry -Tag $Tag

# Pull-and-restart on the box (one or both services)
$ComposeServices = switch ($App) {
  'both'   { '' }              # empty = all services
  default  { $App }            # 'full' or 'omnify'
}

ssh -i $KeyPath $Host @"
  cd /srv/cpg-labs
  docker compose pull $ComposeServices
  docker compose up -d --no-deps $ComposeServices
"@

# Health check (re-use existing helper from _deploy-common.psm1)
$HealthUrl = switch ($App) {
  'full'   { 'https://app.cpg-labs.io/health' }
  'omnify' { 'https://omnify.cpg-labs.io/health' }
  'both'   { 'https://app.cpg-labs.io/health','https://omnify.cpg-labs.io/health' }
}
Assert-HealthOk -Urls $HealthUrl
```

What stays from the current script: `Assert-CleanWorkingTree`, the `apps.psd1` lookup pattern, the `Assert-HealthOk` polling helper. What goes: the `aws ecs update-service`, the task-definition rewrite, the ECR login dance.

Lightsail Containers (the other Lightsail product) would replace the SSH+compose hop with `aws lightsail create-container-service-deployment` — cleaner but $7–40/mo more per service. Option A keeps the instance + SSH.

---

## 9. Rollback plan

The migration is reversible at every step until you decommission RDS.

| Step | How to roll back |
|---|---|
| Lightsail box not responding | Flip GoDaddy A records back to the ALB CNAME (`omnify-alb-2060949013.us-east-1.elb.amazonaws.com`). ALB + ECS are still running. TTL 60 means under a minute. |
| New Postgres has wrong data | Re-import from the dump. Or flip `DATABASE_URL` in the env file back to the RDS endpoint and restart containers — RDS is still up. |
| Caddy cert issue | Restore the hosts file workaround temporarily, debug, fix. Or roll DNS back to ALB. |
| Cron firing twice (Lightsail + EventBridge) | Disable EventBridge rules (`enable_delivery_cron = false`, `enable_affiliates_cron = false`, etc. in `terraform.tfvars`, `terraform apply`). Cheaper: disable directly with `aws events disable-rule`. |
| Want to abandon entirely | Lightsail resources delete with no charge after the hour they're deleted in. Cost of a failed attempt: ~$1. |

**Keep RDS + ECS running for 7 days after cutover.** They're the rollback target. Decommission only after a full week of clean traffic on Lightsail (cron logs healthy, no error spikes, Shopify webhooks still landing). The CLAUDE.md "production and main must stay in sync" rule still applies — don't tear down ECS until the new infra is the truth.

---

## 10. Timeline + cost

### Effort

| Phase | Time | What |
|---|---|---|
| Provisioning | 30 min | Create instance, static IP, Postgres, install Docker + Caddy |
| DB migration | 1 hour | pg_dump + pg_restore + verify counts |
| Docker Compose + secrets | 1 hour | Write compose file, populate env files, first `docker compose up` |
| Caddy config | 30 min | Caddyfile, reload, verify localhost reverse proxy works |
| Crontab | 30 min | Five lines, log dir, logrotate |
| Pre-cutover validation | 1 hour | /etc/hosts trick, hit both apps, run a manual cron, place a test order |
| DNS cutover | 15 min | GoDaddy A record swap (CNAME → A pointing at Lightsail IP), watch Caddy obtain certs |
| Cloudflare Pages site | 30 min | Connect repo, point cpg-labs.io |
| `deploy.ps1` rewrite | 2 hours | New flow, keep `_deploy-common.psm1` helpers |
| Monitor + bake | 7 days | Watch logs, verify cron hits, watch RDS for residual traffic |

**Total focused work: 1–2 days.** The 7-day bake is calendar time, not work time.

### Monthly cost

| Item | Today (AWS) | After (Lightsail) |
|---|---|---|
| Compute (ECS Fargate, 2 services) | $40–80 | $20 (1× Medium instance) |
| Postgres (RDS db.t4g.micro or similar) | $15–30 | $15 (Lightsail Postgres Micro) |
| Load balancer (ALB) | $18 | $0 (Caddy on the box) |
| NAT Gateway | $32+ | $0 |
| EventBridge + CloudWatch + ECR | $5–10 | $0 (registry: GHCR free, logs: journalctl) |
| Marketing site (S3 + CloudFront) | $1–5 | $0 (Cloudflare Pages free) |
| **Total** | **~$110–155** | **~$35** |

**Savings: ~$75–120/month, or 65–80%.**

### What you give up

- **Self-managed OS patches.** You run `apt upgrade` monthly instead of letting AWS auto-patch managed nodes.
- **Auto-scaling.** Lightsail instance is a fixed box. If you outgrow Medium, you bump to Large ($40/mo, 8 GB) or split apps across two boxes. Likely a year away.
- **Multi-AZ failover.** Lightsail managed Postgres has backups but no synchronous replica. Acceptable for a Shopify admin app where ~5 min of downtime to restore from backup is survivable; not acceptable for a payments processor.
- **CloudWatch dashboards** for ECS/ALB. Replace with `journalctl`, `docker compose logs`, and the existing `aws logs tail` patterns won't apply. Logging strategy needs a once-over.

If any of those tradeoffs is a hard no, the next step up is Fly.io (managed scaling) or staying on ECS but rightsizing.

---

## Open questions before executing

These are the decisions you'll want to make before kicking off. Each has a sensible default — listed first — but worth a deliberate call:

1. **Registry:** GHCR (default, free, public-or-private with PAT) vs ECR (keep current) vs Lightsail Container Registry. GHCR is the least friction.
2. **Secrets:** Option 6A env-file (default, simpler) vs 6B SSM-via-IAM (more rotation-friendly).
3. **`PORT` env var:** the Dockerfile EXPOSEs 3000 and `npm run start` reads `PORT` from env. Confirm `app/server.mjs` or wherever the listen call lives honors `PORT`. If not, both containers must run on 3000 internally and the host port mapping is the only differentiator (already the case in the compose snippet above).
4. **`docs/data-sync-architecture.md`** — re-read before cutover. Some webhook-driven syncs may have ECS-specific assumptions (task-replacement survivability is a known concern per CLAUDE.md "Background sync processes must survive container restarts" rule). Lightsail's `restart: unless-stopped` covers most of it, but worth a deliberate audit.
5. **Cloudflare Pages vs keeping S3+CloudFront:** Pages is simpler and free; S3+CloudFront is what `scripts/deploy.ps1 -App site` already targets (per CLAUDE.md). If you want to keep one less moving piece, leave the site on S3 — it's cheap (~$1–5/mo) and the wall between admin and site is already clean.

---

## Reference paths

- Build: [`Dockerfile`](Dockerfile)
- App manifest: [`scripts/apps.psd1`](scripts/apps.psd1)
- Current deploy: [`scripts/deploy.ps1`](scripts/deploy.ps1), [`scripts/_deploy-common.psm1`](scripts/_deploy-common.psm1)
- Cron definitions to replace:
  - [`infra/terraform/delivery-cron.tf`](infra/terraform/delivery-cron.tf) (auto-delivery + lalamove-watchdog)
  - [`infra/terraform/affiliates-cron.tf`](infra/terraform/affiliates-cron.tf)
  - [`infra/terraform/retail-goals-cron.tf`](infra/terraform/retail-goals-cron.tf)
  - [`infra/terraform/shop-ingest-cron.tf`](infra/terraform/shop-ingest-cron.tf)
- Public site: [`site/`](site/) — moves to Cloudflare Pages
- Migrations applied automatically on container start via `npm run setup` (`prisma migrate deploy`), per Dockerfile CMD `npm run docker-start`
