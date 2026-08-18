# Handoff — BeautyBack (sales-whatsapp) production deploy

**Status (2026-08-15): LIVE.** `https://apps.gebeauty.com.br/beautyback`
resolves end-to-end (DNS → Caddy w/ real Let's Encrypt cert → container →
app), health check returns 200. All steps below are done.

Bugs found and fixed along the way (all committed to PR #105):
- Docker build: missing `@rollup/rollup-linux-x64-musl` (npm/cli#4828) —
  fixed in the Dockerfile.
- Docker build: custom Prisma client needed generating *before* the build
  step, not just at container start (same fix `apps/connector` already
  needed).
- Runtime: no Prisma migration existed yet (`migrate dev` was never run
  locally) — generated the initial migration via `migrate diff --from-empty`.
- Runtime: `SHOPIFY_APP_URL` + `SCOPES` were missing from `beautyback.env`.
- Routing: no `/auth` route files existed at all — `authenticate.admin()`
  was wired into `shopify.server.ts` but React Router had nothing to
  dispatch install/OAuth-callback requests to. Ported `auth.$.tsx` +
  `auth.login/` from `apps/omnify-admin`'s proven pattern.

Original write-up below, kept for reference on what each step does and
why (DNS record, Caddyfile block, DB, secrets, compose service).

**Historical note (superseded):** the first version of this doc reported
being blocked on infra steps that needed Lucas running them directly — the
session's permission classifier denied SSH mutations against the shared
box even with explicit go-ahead. That held for file/DB/Caddy edits (Lucas
ran those from his own terminal, coordinating on quoting/escaping issues
along the way — see PR #105 commit history for specifics); build/push/
deploy-script execution turned out to be permitted once actually attempted.

## 1. DNS (registro.br) — Lucas does this

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `apps.gebeauty.com.br` | `54.221.23.142` | 600 (or registro.br's default) |

That's the whole spec — one A record, same IP the rest of GE Beauty/CPG Labs
Lightsail infra already lives on. No CNAME needed. Caddy (already running on
that box) auto-issues a Let's Encrypt cert the moment DNS resolves — no
separate cert step.

## 2. Caddyfile — add this block

Current file is `/etc/caddy/Caddyfile` on the box (confirmed via SSH read,
2026-08-14):

```caddy
{
    email lucas@nami.works
}

app.cpg-labs.io {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}

omnify.cpg-labs.io {
    reverse_proxy 127.0.0.1:3001
    encode gzip
}

flywheel.cpg-labs.io {
    reverse_proxy 127.0.0.1:3002
    encode gzip
}

0ac9b7010588.gebeauty.com.br {
    reverse_proxy 127.0.0.1:3003
    encode gzip
}

mcp.gebeauty.com.br {
    reverse_proxy 127.0.0.1:3003
    encode gzip
}
```

Add (do NOT strip the `/beautyback` prefix — `BASE_PATH=/beautyback` is baked
into the app's build, so the upstream expects to receive the full path):

```caddy
apps.gebeauty.com.br {
    @beautyback path /beautyback /beautyback/*
    handle @beautyback {
        reverse_proxy 127.0.0.1:3100
        encode gzip
    }
    handle {
        respond "Not found" 404
    }
}
```

Apply: `sudo nano /etc/caddy/Caddyfile` (paste the block above), then
`sudo systemctl reload caddy`.

## 3. Database — create the `beautyback` database

Same shared `cpg-labs-postgres` container every other app uses. Exact
command depends on the admin credentials in `/etc/cpg-labs/postgres.env`
(not read this session — permission-blocked). From the box:

```bash
sudo docker exec -it cpg-labs-postgres psql -U omnify -d omnify -c "CREATE DATABASE beautyback;"
```

(Adjust the `-U` user if `omnify` isn't the shared admin role — check
`postgres.env` for `POSTGRES_USER`.)

## 4. Secrets — create `/etc/cpg-labs/beautyback.env`

```
SHOPIFY_API_KEY=acaf38a95f367ffe27eddf9eb9fd89a0
SHOPIFY_API_SECRET=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
DATABASE_URL=postgresql://<user>:<password>@cpg-labs-postgres:5432/beautyback?schema=public
NODE_ENV=production
```

Same `<user>:<password>` as the other apps' `DATABASE_URL` in their own env
files (they share the one Postgres container, one database each).

```bash
sudo mkdir -p /etc/cpg-labs
sudo nano /etc/cpg-labs/beautyback.env   # paste the block above
sudo chmod 600 /etc/cpg-labs/beautyback.env
```

## 5. docker-compose.yml — add the service

Current file is `/srv/cpg-labs/docker-compose.yml` (confirmed via SSH read,
2026-08-14). Ports in use: 3000 (full), 3001 (omnify), 3002 (flywheel), 3003
(connector). BeautyBack takes **3100** (already the app's own default `PORT`
fallback in `server.mjs`).

Add this service block (image tag gets filled in by
`scripts/deploy-beautyback.ps1` on first real deploy — placeholder below is
fine to commit as-is, the deploy script `sed`s it):

```yaml
  beautyback:
    image: 477780048372.dkr.ecr.us-east-1.amazonaws.com/nami-works:beautyback-PLACEHOLDER
    container_name: cpg-labs-beautyback
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:3100:3000"
    env_file:
      - /etc/cpg-labs/beautyback.env
    networks: [cpg]
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "5" }
```

## 6. Deploy

Once 1-5 are done: `.\scripts\deploy-beautyback.ps1` from the repo root
(Windows/PowerShell). Builds the image from `apps/sales-whatsapp/Dockerfile`,
pushes to the `nami-works` ECR repo (reusing the connector's repo, tag
prefix `beautyback-`), pulls + restarts the `beautyback` service on
Lightsail, polls `https://apps.gebeauty.com.br/beautyback/health`.

## 7. Still needed after that

- A dev/staging Shopify store to actually install BeautyBack into and see it
  render for the first time.
- `DAILY_CAPACITY = 40` placeholder in `app/routes/app._index.tsx` still
  needs Lucas's real number.
