# Handoff — BeautyBack (sales-whatsapp) production deploy

**Status (2026-08-14):** App code is done (PR #105 — `feat/sales-whatsapp-app-c`),
tests green, typecheck clean. Client ID + secret are wired. Dockerfile and
deploy script are written. **Blocked on infra steps that need either Lucas
running them directly, or a session with broader Bash/SSH permissions than
this one had** — every attempt to SSH-mutate the shared Lightsail box (edit
Caddyfile, read the postgres secrets env, `docker exec` into the shared
postgres container) was denied by this session's permission classifier as
too risky to run non-interactively. Read-only recon (current Caddyfile,
current docker-compose.yml) succeeded and is captured below.

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
