# Handoff — Migrate B2B Portfolio deck to `b2b.gebeauty.com.br`

**Target surface: Claude Code** — written for Claude Code (local git + memory + CLAUDE.md auto-load). If a different surface picks this up, note that memory/CLAUDE.md won't be auto-loaded and the migration facts here become your only context.

**Surface: Claude Code** (local git + `gebeauty/.env` + AWS creds + `C:/Python314/python.exe` + PowerShell + Shopify Admin API for the retirement step). Auto-loaded memory/CLAUDE.md applies. This doc is self-contained — read top to bottom before touching anything.

**Status:** APPROVED to build. Lucas signed off on the recommended approach on 2026-08-13. DNS decision made: **registro.br**. This is the execution of §7 of the prior handoff (`docs/handoff-b2b-portfolio-pages.md`).

**One-line goal:** Take the two B2B portfolio decks off the Shopify storefront and serve them from a dedicated, self-contained static site at `b2b.gebeauty.com.br` (S3 + CloudFront + ACM), decoupled from the Shopify theme. After this lands, **the subdomain becomes the canonical home of the deck** — all future deck improvements happen here, in the repo, not on Shopify.

---

## 1. Decisions locked by Lucas (do not re-litigate)

- **Host:** AWS **S3 + CloudFront + ACM**, mirroring the existing `apps/omnify-site` / `nami/site` static-site pattern. Reuse that IaC — do not invent a new stack.
- **DNS:** `gebeauty.com.br` is managed at **registro.br**. All records (ACM validation + the CloudFront alias) go in the registro.br DNS panel unless you delegate the subdomain to Route 53 (see §5, option B).
- **Assets:** **self-host everything.** No runtime dependency on the Shopify theme CDN. (Good news — see §3: images are already embedded; only 7 font files remain external.)
- **Access:** not fully public. Add a **light access gate** (CloudFront Function doing HTTP Basic Auth). Single shared credential is fine; these are unlisted sell-in decks, not secrets.
- **Two audiences stay two decks:** commercial (wholesale) + neutral (partners), served as two routes.
- **Canonical home moves here.** After cutover, the editable source lives in the repo and deploys to the subdomain. The Shopify pages + `page.b2b.liquid` template are retired (§7).

---

## 2. Source of truth + version drift — READ FIRST

There is version drift you must reconcile before anything else:

- The repo (`inputs/mockups/gebeauty-b2b-portfolio-v3.html`) is **stale** (v3).
- The **latest** deck is **v6**, which lived at `G:\Meu Drive\Temp\gebeauty-b2b-portfolio-v6.html`.
- A Cowork session (2026-08-13) made further edits on top of v6. **The edited file has been written into your working tree at `inputs/mockups/gebeauty-b2b-portfolio-v6.html`** (untracked `??`). That file is the true current source — it supersedes v3 and the Drive v6. It is expected and yours to commit; do not treat it as another session's WIP.
- If that file is somehow missing, fall back to `G:\Meu Drive\Temp\gebeauty-b2b-portfolio-v6.html` and re-apply the changelog in §2a.

**First action:** promote the current file to the canonical edit target. Commit `inputs/mockups/gebeauty-b2b-portfolio-v6.html` on a fresh branch off `origin/main`, and update `inputs/mockups/INDEX.md` to point at v6 (retire v3/v2/v1 references or mark superseded). From here on, v6 is the file everyone edits.

### 2a. Changelog applied this session (for verification / fallback re-apply)

All in the `#mercado` section unless noted. If you had to fall back to Drive v6, re-apply these:

1. **Headline** → `<h2><span style="color:#fff;text-decoration:underline;text-underline-offset:5px;text-decoration-thickness:2px">Posicionamento forte</span> nas duas principais categorias de beleza.</h2>` (white + underline; the section background is GE red, so red-on-red must be avoided).
2. **Lead copy** rewritten to elaborate the two points (`Cabelo é a categoria mais consolidada` / `Fragrância cresce muito acima do restante`), split into two sentences with a `<br><br>` pause before "Fragrância". No dashes.
3. **Donut pie:** added two `<pattern>` defs (`hatchCab`, `hatchFrag`) and set the Cabelo slice stroke to `url(#hatchCab)` and the Fragrância slice to `url(#hatchFrag)` — hatched fills mark the two categories GE Beauty competes in.
4. **Legend:** `Cabelo` and `Fragrância` labels wrapped in `<u>`; their swatches given matching `repeating-linear-gradient` hatch.
5. **Source line:** `2023–2025` → `de 2023 a 2025`; `aproximada — recorte a confirmar` → `aproximada, com recorte a confirmar`.
6. **Global de-dash pass (audience copy):** every em/en dash in reader-visible copy replaced with natural connectors (period+"São", commas, colons). 8 occurrences across 7 trechos: the Diferencial "Entrada acessível" point, the `#mercado` tier2 body-mist line, the src line (×2), the Mayday `sell` string, the Mayday leave-in `note`, the hero-note "Perfume que vira ritual", and the table UPC fallback (`'—'` → `'a definir'`). Remaining dashes exist ONLY in dev comments + `<title>` (not audience-visible) — leave them or clean at will.

---

## 3. Asset dependency audit (done this session — trust these numbers)

Ran on the current v6. External/runtime dependencies:

- **Images: already fully self-contained.** 28 product/hero/logo shots are embedded as `data:image/webp` base64 in the HTML. **No image decoupling needed.** (Verify: `grep -c "data:image/webp"` ≈ 28; there should be **no** live `cdn.shopify.com` image `src`.)
- **Fonts: the ONLY external dependency.** 7 `@font-face` `src` URLs point at the Shopify theme CDN path `https://www.gebeauty.com.br/cdn/shop/t/34/assets/…`. These break on any theme republish (the `t/34` version bumps). **This is the decoupling work.** The files:
  - `ItalianPlateNo2Expanded-Regular.woff2` (400)
  - `ItalianPlateNo2Expanded-Medium.woff2` (500)
  - `ItalianPlateNo2Expanded-Demibold.woff2` (600)
  - `ItalianPlateNo2Expanded-Bold.woff2` (700)
  - `ItalianPlateNo1Mono-Regular.woff2` (400)
  - `ItalianPlateNo1Mono-Bold.woff2` (700)
  - `ItalianPlateNo2Mono.ttf` (400)
- **One outbound link kept on purpose:** `https://www.instagram.com/camilacoutinho` (founder social). Leave it.

**Font decoupling steps:**
1. Source the 7 files. Most are already staged at `gebeauty/.brand-assets/fonts/_portfolio-canva-set/` (14 files incl. these; validated by magic bytes per the prior handoff). For any not there in `.woff2`, download from the `t/34` URLs currently in the HTML while the theme still serves them.
2. Put them under the new site's asset dir (e.g. `<site>/assets/fonts/`).
3. Rewrite the 7 `@font-face` `src:url('…t/34…')` to relative paths (`url('/assets/fonts/ItalianPlateNo2Expanded-Regular.woff2')`), dropping the `?v=` cache-buster.
4. (Optional, best) inline the woff2 as base64 `data:` in the single `@font-face` block so the deck stays a truly self-contained single file — consistent with how images are already embedded. Trade-off: ~+300–500KB in the HTML vs. one fewer request path. Given images are already inlined, inlining fonts too keeps the "one file, zero external deps" property. Recommend inlining.

---

## 4. Target architecture

Mirror `apps/omnify-site` / `nami/site` (both Astro static → S3 + CloudFront). These decks are plain self-contained HTML, so there's no Astro build needed — it's an upload + invalidate. Read `nami/site/infra` and the `apps/omnify-site` deploy path first and reuse their Terraform/CDK/module conventions rather than hand-rolling.

Components:
- **S3 bucket** (private, e.g. `b2b-gebeauty-site`), OAC-only access from CloudFront. Not a website-endpoint bucket — use CloudFront + OAC.
- **CloudFront distribution:** origin = the bucket via OAC; alternate domain name `b2b.gebeauty.com.br`; ACM cert attached; default root object `index.html`; SPA-style or explicit routing for the two decks (§6); compression on; sensible cache policy (long TTL for `/assets/*`, short/no-cache for the HTML during iteration).
- **ACM cert** for `b2b.gebeauty.com.br`, **issued in `us-east-1`** (CloudFront requirement), DNS-validated.
- **Access gate:** a CloudFront **Function** (viewer-request) doing Basic Auth — compare the `Authorization` header to a base64 `user:pass`; return 401 with `WWW-Authenticate` otherwise. Store the credential in the function (rotate by redeploy) or a CloudFront KeyValueStore. Keep it out of git history if hardcoded — inject at deploy time.

---

## 5. registro.br DNS

`gebeauty.com.br` DNS is at registro.br. Two records are needed (ACM validation, then the alias). Two ways to do it:

**Option A — manage the subdomain directly at registro.br (simplest for one subdomain):**
1. Request the ACM cert (us-east-1). ACM gives you a validation `CNAME` (`_xxxx.b2b.gebeauty.com.br` → `_yyyy.acm-validations.aws`). Add it in the registro.br DNS panel. Wait for ACM to flip to *Issued* (minutes to ~30 min).
2. After the CloudFront distribution is deployed, add a `CNAME`: `b2b` → `dXXXXXXXX.cloudfront.net`. (Subdomain → CNAME is valid; no apex/ALIAS problem since we're not touching the root domain.)
3. Propagation on registro.br is usually quick; verify with `nslookup b2b.gebeauty.com.br` and a cache-busted browser hit.

**Option B — delegate `b2b` to Route 53 (cleaner IaC, if you want records in Terraform):**
1. Create a Route 53 hosted zone for `b2b.gebeauty.com.br`.
2. At registro.br, add `NS` records for `b2b` pointing at the 4 Route 53 nameservers.
3. Manage the ACM validation record + the CloudFront alias (A/AAAA ALIAS) inside the hosted zone via IaC.

Recommend **Option A** unless the omnify/nami infra already standardizes on Route 53 hosted zones — if it does, match it (Option B) for consistency.

---

## 6. Routes — the two decks

The neutral deck is **generated** from the commercial one by `gebeauty/scripts/_b2b_make_neutral.py` (removes the sell sections incl. `mercado`, neutralizes copy, moves price into the card detail — see prior handoff §3). Keep that transform; it now feeds the static site instead of Shopify.

Serve as two paths (Lucas's earlier lean):
- `b2b.gebeauty.com.br/comercial` → the commercial deck (`gebeauty-b2b-portfolio-v6.html`)
- `b2b.gebeauty.com.br/parceiros` → the neutral deck (regenerated)

Decide with Lucas whether the root `/` redirects to `/comercial`, shows a chooser, or 404s. Keep the paths guessable now that there's a Basic Auth gate (the gate replaces the old "unguessable slug" obscurity). Preserve `noindex,nofollow` on both anyway.

---

## 7. Retire the Shopify surface (after the subdomain is verified live)

Only after `b2b.gebeauty.com.br` is confirmed working end-to-end:
1. Unpublish/delete the two Shopify pages: `pf-comercial-k7m3qx9v` (page ID `164822745408`) and `pf-marcas-p4w9zt6b` (page ID `164822778176`).
2. Remove the `templates/page.b2b.liquid` template from the published theme (id `181379236160`, `[Check] - Produção`). It's additive, so removal is clean.
3. Retire the Shopify publisher `gebeauty/scripts/_b2b_publish_pages.py` (delete or clearly mark deprecated). Replace with the new S3 deploy script (§8).
4. Clean up the duplicate hero/logo files in Shopify Files left by repeated publishes (cosmetic).

---

## 8. New publish flow (replaces the Shopify publisher)

Author in the repo → deploy to S3 → invalidate CloudFront. Suggested `gebeauty/scripts/_b2b_deploy_site.py` (resolve `.env` from `gebeauty/.env` per the repo convention):
1. Edit `inputs/mockups/gebeauty-b2b-portfolio-v6.html` (the commercial deck).
2. Run `_b2b_make_neutral.py` to regenerate the neutral deck.
3. Map both to their routes (`/comercial/index.html`, `/parceiros/index.html`), sync `assets/` (fonts if not inlined).
4. `aws s3 sync` to the bucket; `aws cloudfront create-invalidation` for the changed paths.
5. DRY by default; `commit`/`--apply` to actually push (mirror the safety pattern of the old publisher).

Document it in a short runbook so future deck iterations are a one-command deploy.

---

## 9. Files to create / modify

- `inputs/mockups/gebeauty-b2b-portfolio-v6.html` — **commit** (currently untracked). New canonical source.
- `inputs/mockups/INDEX.md` — point at v6; mark v1–v3 superseded.
- New site/infra dir (name to match omnify/nami convention, e.g. `apps/b2b-site/` or `gebeauty/b2b-site/`): the two route HTMLs (or a tiny build that emits them), `assets/fonts/`, the CloudFront Function (Basic Auth), and IaC for bucket + distribution + ACM.
- `gebeauty/scripts/_b2b_deploy_site.py` — new deployer.
- `gebeauty/scripts/_b2b_publish_pages.py` — deprecate/remove after cutover.
- `gebeauty/scripts/_b2b_make_neutral.py` — keep; verify it still runs against v6 (section ids unchanged: `diferencial`, `marca`, `mercado`, `parceria`, `fundadora`, `contato`).
- `.claude/initiatives/gebeauty-b2b-portfolio-pages.md` — advance the phase to "subdomain migration in progress → done".
- Register this handoff in `docs/_handoff-log.md` (pickup block below) and delete `docs/handoff-b2b-portfolio-pages.md` once the migration lands (git history preserves it).

---

## 10. Acceptance criteria (verify before retiring Shopify)

- `https://b2b.gebeauty.com.br/comercial` and `/parceiros` load full-screen, no store chrome, valid TLS (ACM cert, no browser warning).
- **Fonts render as Italian Plate**, not the Assistant fallback — confirm the `@font-face` no longer hits `…/cdn/shop/t/34/…` (DevTools Network shows only same-origin/self-hosted or data: fonts).
- Zero requests to `gebeauty.com.br` / `cdn.shopify.com` from the deck (fully decoupled).
- Basic Auth gate challenges anonymous visitors and passes with the shared credential.
- `noindex,nofollow` present; pages not in storefront predictive search.
- The `#mercado` section matches the §2a changelog (white underlined headline on red, hatched Cabelo+Fragrância slices + underlined legend, no dashes in copy).
- Deploy script round-trips (edit → make_neutral → sync → invalidate → change visible after invalidation).

---

## 11. Open items / risks

- **Founder (Fundadora) section** is hidden in v5/v6 pending Camila Coutinho's quote + portrait (Lucas owns). Still open; not a blocker for migration.
- **Brand reach numbers** in `#mercado` brand-nums were placeholders in earlier versions; v6's mercado section is now the market-positioning layout (pie + two-point copy). Confirm no `[ • ]` placeholders remain before external sharing.
- **Basic Auth credential management** — decide storage (function constant vs KeyValueStore) and rotation. Don't commit the plaintext.
- **Worktree discipline** (CLAUDE.md): branch from freshly-fetched `origin/main`, work in a worktree, don't sweep the untracked v6 into an unrelated commit. The untracked v6 in the working tree is expected (see §2).
- **registro.br propagation / ACM validation lag** — request the cert early so validation completes while you build the distribution.

---

## 12. References

- Prior handoff (the "what/why" of the decks, the neutral transform, fonts, brand tokens): `docs/handoff-b2b-portfolio-pages.md` §3–§7.
- Infra pattern to mirror: `apps/omnify-site` (deploy) and `nami/site/infra` (S3 + CloudFront).
- Brand truth: GE Red `#DF3630`; product-shot bg `#ecede9`; Italian Plate type system (No2 Expanded body/display, No1 Mono buttons/labels, No2 Mono accents).
- Initiative: `.claude/initiatives/gebeauty-b2b-portfolio-pages.md`.
- Live pages being retired: `pf-comercial-k7m3qx9v` (`164822745408`), `pf-marcas-p4w9zt6b` (`164822778176`); theme `181379236160`.

---

### Pickup block for `docs/_handoff-log.md`

```
# b2b-subdomain-migration

**Surface: Claude Code.** Needs local git + AWS creds + `gebeauty/.env` + `C:/Python314/python.exe` + PowerShell (+ Shopify Admin API for the retirement step) and auto-loaded memory/CLAUDE.md.

Migrate the two B2B portfolio decks off the Shopify storefront onto `b2b.gebeauty.com.br` (S3 + CloudFront + ACM, self-hosted assets, Basic Auth gate). DNS at registro.br. Full context: docs/handoff-b2b-subdomain-migration.md. Initiative: .claude/initiatives/gebeauty-b2b-portfolio-pages.md.

Steps:
1. Read the full handoff.
2. Confirm back, in ≤5 bullets: current source (untracked v6 in inputs/mockups), the 4 locked decisions, and the first action (commit v6, then request ACM cert).
3. Wait for Lucas's go before creating AWS resources or DNS records.

When the subdomain is verified live and the Shopify pages are retired, remove docs/handoff-b2b-portfolio-pages.md and docs/handoff-b2b-subdomain-migration.md (git history preserves them).
```
