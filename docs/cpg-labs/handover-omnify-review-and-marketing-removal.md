# Session Handover — 2026-04-22

**Campaign:** Ship a new Omnify version for Shopify App Store review + fully remove the public marketing site (`www.cpg-labs.io` + `cpg-labs.io`) in the same pass.

## What was done (this session, and the preceding week)

**AWS split-brain remediation — Phases 0/1/2 live, subagent output committed, paused at Phase 3.**

- **Phase 0 (read-only):** Verified TG state. `omnify-tg` and `omnify-gebeauty-tg` each had one target in `cpg-labs` (canonical) + one in `omnify-cluster` (stale). ALB was round-robining across two code versions — the root cause of every intermittent `/full/full/`, 401, raw-HTML, and "second refresh works" symptom this week.
- **Phase 1 (live, reversible):** Deregistered `172.31.30.98` from `omnify-tg` and `172.31.0.233` from `omnify-gebeauty-tg`. ALB now serves 100% of traffic from `cpg-labs` pods. Stop the split-brain.
- **Phase 2 (live, reversible):** Scaled `omnify-cluster/omnify-service` and `omnify-cluster/omnify-gebeauty-service` to `desiredCount=0`. Old tasks drained. `Assert-NoSplitBrain` now passes live as independent confirmation.
- **5 parallel subagents produced `scripts/` + `infra/terraform/` + `docs/` scaffolding for Phases 3c/6/7** — committed as `cbb66c0`. Not yet applied; waits for Phase 4+ sequencing.
- **v19 of CPG Labs full shipped** (rev 248, image `claude-control-v19`, commit `b318270`). Removed the `${basePath}` prefix on `<s-link>` after CloudWatch proved App Bridge prepends `application_url`'s path itself — v17 was right, v18 reintroduced the bug under a different disguise. See [CLAUDE.md](../CLAUDE.md) → "Subpath (BASE_PATH)".
- **Legacy deploy scripts (`deploy-cpg-labs.ps1`, `deploy-omnify.ps1`) gained pre-flight guards** (commit `5824de6`): `Assert-CleanWorkingTree` (blocks `Docker COPY .` silent-shipping of uncommitted work — bit us twice this week) and `Assert-NoSplitBrain` (refuses deploy if any non-canonical cluster has running tasks).

## Key decisions

1. **Pause the AWS split-brain remediation at Phase 3 until Shopify App Review clears.** Any infra change during review risks the reviewer hitting a broken state → rejection → 1–2 week setback. The split-brain is already *contained* by Phases 1+2; it's safe to sit for weeks. Resume Phase 4+ after the review result.
2. **Shopify App Bridge prepends `application_url`'s path component to absolute `<s-link>` hrefs.** Verified via CloudWatch `GET /full/__manifest?paths=%2Ffull%2Ffull%2F...` on v18. Single definitive rule in [CLAUDE.md](../CLAUDE.md) — Subpath section. CI guard at [scripts/check-no-basepath-in-nav-links.ts](../scripts/check-no-basepath-in-nav-links.ts) enforces.
3. **Marketing site removal scope is narrower than it looks.** The audit (in session conversation; key findings summarized in `## Context the next session needs`) surfaced that 6 shared files (nav, footer, theme, pricing, policies) are used by BOTH marketing and the embedded Omnify product. Only `cpglabs-layout/` + `cpglabs-home.tsx` + a few pure `_site.*` marketing routes are truly exclusive. **Do NOT delete `_site.privacy.tsx`, `_site.terms.tsx`, `_site.security.tsx`, or `_site.pricing.tsx`** — those stay on Omnify and satisfy Shopify App Review requirements. Same for `site-theme.css` (globally imported by `app/root.tsx`).
4. **Observation window remains open.** Phase 4 (destructive cleanup of `omnify-cluster`) is gated on 2–7 days of clean CloudWatch metrics on `omnify.cpg-labs.io/full/*` and `www.cpg-labs.io`. That window PROBABLY overlaps with the app review; if so, Phase 4 waits until both green-lights.

## What's pending

### Immediate (this handover's focus)

1. **Pre-submission Shopify App Review audit of Omnify.** Run `/shopify-submission` in `compliance-audit` mode BEFORE deploying. Surfaces missing compliance webhooks, banned phrases, scope-discipline issues.
2. **OAuth redirect URL mismatch** — `shopify.app.omnify.toml` has `redirect_urls = [ "https://omnify.cpg-labs.io/api/auth" ]` but `app/shopify.server.ts` sets `authPathPrefix: "/auth"`. Session-token auth works today (existing installs); fresh OAuth installs from reviewers will break. **Verify with a dev-shop install before submission.** Likely fix: change the toml to match `/auth`, then `shopify app deploy --config shopify.app.omnify.toml`.
3. **Add compliance webhooks to `shopify.app.omnify.toml`** — it currently lacks `customers/data_request`, `customers/redact`, `shop/redact`. The CPG Labs full toml has them; Omnify toml doesn't. Mandatory for Shopify App Store.
4. **Marketing-site removal** — see file inventory below. Deletion + infra changes + Shopify listing updates.
5. **Deploy the new Omnify build** via `./scripts/deploy-omnify.ps1 -Tag "omnify-<date>-<sha>"`. Pre-flight guards run first.
6. **Submit via Shopify Partner Dashboard** using the `/shopify-submission` skill's `submission-prep` output.

### Frozen (do NOT touch until review result is in)

- Phase 4 — delete `omnify-cluster` services + cluster + stale task-def families
- Phase 5 — Terraform state reconciliation + `name_prefix` flip `omnify` → `cpg-labs`
- Phase 6 — `terraform apply apps.tf`, DNS/ACM for `app.cpg-labs.io`, move CPG Labs full to dedicated hostname (kills BASE_PATH forever)
- Phase 7 — cut over to `scripts/deploy.ps1`, archive legacy scripts
- Phase 8 — migrate `terraform.tfstate` to S3 backend

These are blocked by the "pause during review" decision above. **Resume only after review clears.**

### Pre-existing backlog (unrelated to this session)

- Uncommitted working-tree changes: `app/routes/api.control.$intent.tsx`, `app/routes/app.local-delivery.tsx`, `app/utils/app-identity.server.ts`, i18n files, Local Delivery mobile route (untracked). **These are NOT part of the review submission — they're in-flight feature work. Decide whether to stash before deploying or commit and include.**

## Modified files (this session)

### Code — complete, committed
- `app/routes/app.tsx` — `<s-link href={item.href}>` (v19 form, no basePath prefix). Inline holographic signature text with safety timeout.
- `app/root.tsx` — global `:where(s-*):not(:defined) { visibility: hidden }` rule.
- `scripts/check-no-basepath-in-nav-links.ts` — CI guard, forbids basePath on any nav tag.
- `CLAUDE.md` → Subpath (BASE_PATH) section — unified rule with CloudWatch proof + regression timeline.
- `scripts/deploy-cpg-labs.ps1`, `scripts/deploy-omnify.ps1` — pre-flight guards injected.
- `scripts/_cluster.psm1`, `scripts/_deploy-common.psm1` — module implementations.
- `inputs/mockups/loading-overlay-message-v1.html` — reference artifact for the overlay.

### Code — scaffolding, committed but NOT applied
- `infra/terraform/apps.tf` — unified module blocks (omnify + full + storytelling). Expected `terraform plan` conflict with existing `ecs.tf` + `gebeauty.tf` until Phase 6's `state mv`. Do NOT `terraform apply` without the state-reconciliation sequence in the plan file.
- `infra/terraform/modules/shopify-app/{main,variables}.tf` — `additional_domains` variable added for marketing-on-Omnify piggyback.
- `infra/terraform/drift-alarms.tf` + `drift-check-lambda/` — three CloudWatch alarms. Gated behind `var.enable_drift_alarms`.
- `infra/terraform/providers.tf` — added `archive` provider.
- `scripts/deploy.ps1` + `scripts/apps.psd1` + `scripts/new-app.ps1` + `scripts/archive/README.md` — consolidated deploy script. Fails until Phase 6c's service rename.

### Docs — complete, committed
- `docs/aws-topology.md` — canonical topology + split-brain history.
- `docs/deploy-runbook.md` — seven deploy scenarios.
- `docs/adding-a-new-app.md` — three-tier onboarding decision tree.

### Pre-existing uncommitted changes (not touched this session, not to be included in review submission unless user explicitly wants)
- `app/routes/api.control.$intent.tsx`, `app/routes/app.local-delivery.tsx` (+782 lines), `app/utils/app-identity.server.ts`, i18n files. These are the Local Delivery mobile + Claude Control refinements.

## Current state (how to verify)

**Production:** CPG Labs full at `omnify.cpg-labs.io/full/*` serving image `claude-control-v19` (task-def `omnify-gebeauty-task:248`). Omnify focused app at `omnify.cpg-labs.io/*` + `www.cpg-labs.io` (marketing) serving image `omnify-app:v9` (task-def `omnify-task:38`).

**ECS:**
- `cpg-labs` cluster has 3 services: `omnify-gebeauty-service`, `omnify-service`, `nami-works-gateway` — all `rolloutState=COMPLETED`.
- `omnify-cluster` still exists but services at `desiredCount=0` (drained). Service definitions preserved for quick rollback.

**Sanity check commands:**
```bash
aws ecs describe-services --cluster cpg-labs --services omnify-gebeauty-service omnify-service --region us-east-1 --query "services[].{name:serviceName,taskDef:taskDefinition,running:runningCount}"

aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:477780048372:targetgroup/omnify-tg/5960ead268e4864c --region us-east-1 --query "TargetHealthDescriptions[].{ip:Target.Id,state:TargetHealth.State}"

aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:477780048372:targetgroup/omnify-gebeauty-tg/dc1496da5df89eba --region us-east-1 --query "TargetHealthDescriptions[].{ip:Target.Id,state:TargetHealth.State}"

curl -i https://omnify.cpg-labs.io/full/health   # expect 200
curl -i https://omnify.cpg-labs.io/health        # expect 200
```

**Expected:** each TG has exactly one healthy target. Every task-def revision is the latest.

## Recommended next steps (priority order)

1. **Compliance audit:** `/shopify-submission` → `compliance-audit` mode. Surfaces missing compliance webhooks, scope violations, banned phrases in in-app copy. Surfaces code changes needed BEFORE the submission image is built.
2. **Fix OAuth redirect mismatch** in `shopify.app.omnify.toml` + verify with dev-shop install. Without this, the reviewer's install fails at OAuth step → instant rejection.
3. **Add compliance webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) to `shopify.app.omnify.toml`. Push via `shopify app deploy --config shopify.app.omnify.toml`.
4. **Marketing-site goes dark — codebase stays, production stops serving it.** User clarification 2026-04-22: do not delete any `_site.*` routes, components, styles, or home files. The site was intended for a different purpose and will be repurposed later. Only the LIVE serving stops.
   - **Step A: update Shopify Partner Dashboard listings** for BOTH Omnify and CPG Labs full — change Privacy Policy URL and ToS URL from `https://www.cpg-labs.io/...` to `https://omnify.cpg-labs.io/...` explicitly. These routes (`_site.privacy.tsx`, `_site.terms.tsx`, `_site.security.tsx`) already resolve on the Omnify service at `omnify.cpg-labs.io/{privacy,terms,security}` via the same `_site.tsx` parent layout. Must be updated BEFORE Step C so reviewers don't hit dead links.
   - **Step B: verify** `curl -i https://omnify.cpg-labs.io/privacy` → 200 (and `/terms`, `/security`). Confirms the policy pages still serve from the Omnify hostname.
   - **Step C: remove the two ALB listener rules** for `www.cpg-labs.io` + `cpg-labs.io` apex redirect. **Do NOT run `terraform apply` at the repo root** — the staged `apps.tf` intentionally conflicts with `ecs.tf`/`gebeauty.tf` and would try to destroy the live services. Two options, pick (a):
     - **(a) Recommended: AWS CLI direct delete.** Accept Terraform state drift (documented in Phase 5 follow-up):
       ```powershell
       $listenerArn = aws elbv2 describe-listeners --load-balancer-arn $(aws elbv2 describe-load-balancers --names omnify-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text) --query 'Listeners[?Port==`443`].ListenerArn' --output text
       aws elbv2 describe-rules --listener-arn $listenerArn --query "Rules[?Priority=='2' || Priority=='3'].{priority:Priority,arn:RuleArn,conditions:Conditions[0].HostHeaderConfig.Values}" --output json
       # Verify the two rules are the cpg-labs.io redirect (priority 2) and www.cpg-labs.io forward (priority 3); abort if anything else
       aws elbv2 delete-rule --rule-arn <priority-2-arn>
       aws elbv2 delete-rule --rule-arn <priority-3-arn>
       ```
     - **(b) Targeted terraform apply.** Not recommended today — `terraform plan` will surface the apps.tf conflict alongside, and the user has to manually sift.
   - **Step D: remove DNS records** in GoDaddy: delete the A/CNAME for `cpg-labs.io` apex + `www.cpg-labs.io`. Once removed, those hostnames return NXDOMAIN — the clearest "offline" signal.
   - **Step E (optional, non-urgent):** delete the ACM certificate for `cpg-labs.io` + `www.cpg-labs.io` via AWS console. Zero cost to leave it; remove only for inventory hygiene.
   - **Do NOT touch codebase.** `app/routes/_site.*`, `app/routes/_index/cpglabs-home.tsx`, `app/components/cpglabs-layout/`, `app/utils/host.server.ts`, `app/styles/site-theme.css` all stay. The host-aware dispatch in `resolveSiteVariant()` will simply never fire once the hostnames stop reaching the app.
   - **Drift note for Phase 5:** `infra/terraform/alb.tf` lines 41–89 (`site_www_redirect` + `site_root` rules) will still be declared in Terraform source after Step C(a), but the live AWS state no longer has them. `terraform plan` during Phase 5 reconciliation will show the rules as "needs to be created". Resolve by `terraform state rm aws_lb_listener_rule.site_www_redirect aws_lb_listener_rule.site_root` then deleting the resource blocks from `alb.tf` as part of the Phase 5 reconciliation pass.
5. **Deploy the new Omnify build:**
   ```powershell
   git status  # must be clean
   $gitSha = (git rev-parse --short HEAD).Trim()
   ./scripts/deploy-omnify.ps1 -Tag "omnify-$(Get-Date -Format yyyyMMdd)-$gitSha"
   ```
   Pre-flight guards will block if tree is dirty or split-brain detected. Verify smoke test `https://omnify.cpg-labs.io/health` → 200. Install on a fresh dev shop and walk through the full merchant journey (install → OAuth → first render → key feature path → uninstall).
6. **Run `/shopify-submission` → `submission-prep`.** Produces reviewer test package, listing copy, screenshot shot-list, deep-links, test credentials. Output to `inputs/shopify-submission/omnify-2026-04-22/`.
7. **Submit via Partner Dashboard.**
8. **Freeze all non-review infra changes until verdict.** Wait.
9. **After verdict:**
   - **Approved →** resume the remediation plan at Phase 4 (see plan file).
   - **Rejected →** `/shopify-submission` → `rejection-response` mode. Fix, redeploy, resubmit. Still freeze Phase 4+.

## Context the next session needs

### The plan
- **Primary reference:** `C:/Users/Lucas Guimarães/.claude/plans/i-think-my-latest-eventual-sutton.md` — approved 9-phase AWS split-brain remediation + consolidation plan. Includes hostname → app map, team structure (main session sequential + 5 subagents parallel), per-phase verification, known deferred conflicts.
- **Also read:** `inputs/aws-account-audit.md` (the audit that triggered the whole remediation).

### Why the `<s-link>` saga kept flipping
`facd79e` added `basePath` prefix (wrong, masked by secrets bug) → v17 removed (correct, masked by split-brain) → v18 re-added (wrong, visible once secrets+split-brain cleared) → v19 removed definitively (correct, CloudWatch proof). The cause was that *independent* bugs (stale SSM secret mapping in the deploy script, stale pod in the drained cluster) each made the "right" fix appear broken. CLAUDE.md → Subpath now has the unified rule with the evidence inline. Any new session thinking "maybe we should add basePath to `<s-link>`" should read that section first.

### Marketing site — codebase stays, only production serving stops

**User directive 2026-04-22:** do NOT delete any marketing code. The site was intended for a different purpose and may be repurposed later. The entire `_site.*` subtree, `app/routes/_index/cpglabs-home.tsx`, `app/components/cpglabs-layout/`, `app/utils/host.server.ts`, `app/styles/site-theme.css`, `docs/handover-cpglabs-website.md`, `infra/terraform/DEPLOY-CPGLABS-SITE.md` — all stay.

**What changes (infra + external, no code):**
- **AWS:** delete the two ALB listener rules (priority 2 apex-redirect + priority 3 www forward) via AWS CLI. Commands in the "Recommended next steps → Step 4" section above.
- **DNS:** delete the `cpg-labs.io` and `www.cpg-labs.io` records in GoDaddy. Result: NXDOMAIN.
- **Shopify Partner Dashboard:** update Privacy Policy URL + ToS URL on both app listings from `www.cpg-labs.io/...` to `omnify.cpg-labs.io/...` (those routes work today — `_site.privacy.tsx` resolves on the Omnify service too).
- **ACM:** optional cleanup — the cert for `cpg-labs.io` and `www.cpg-labs.io` can stay (zero cost). Delete for inventory hygiene if desired.

**Terraform state drift note:** `infra/terraform/alb.tf` still declares the two rules after the AWS-CLI delete, so `terraform plan` will want to recreate them. Handle during Phase 5 reconciliation: `terraform state rm aws_lb_listener_rule.site_www_redirect aws_lb_listener_rule.site_root`, then delete the resource blocks + `var.site_certificate_arn` from `alb.tf` + `variables.tf`. Do NOT do this during the app-review freeze — the `terraform apply` surface is contaminated by the staged apps.tf conflict.

**Net effect:** `www.cpg-labs.io` and `cpg-labs.io` go offline (NXDOMAIN). `omnify.cpg-labs.io`, `app.cpg-labs.io` (post-Phase-6), and `storytelling.cpg-labs.io` unaffected. Codebase untouched — the `_site.*` routes continue to serve at `omnify.cpg-labs.io/{privacy,terms,security,pricing}`.

### Shopify App Review gotchas (CLAUDE.md skill: `/shopify-submission`)
- Listing text has per-field character limits (e.g. 100-char app name). The skill enforces these.
- "Banned phrases" list — Shopify rejects apps with superlative claims ("the best", "fastest"), competitor name-drops, etc. Skill lints.
- Reviewer test package MUST include a screencast showing the complete merchant journey on a fresh dev shop. Skill generates the script.
- Mandatory webhooks: `compliance_topics = [ "customers/data_request", "customers/redact", "shop/redact" ]` — failure is an auto-reject.
- Session-token auth + App Bridge integration — already wired in this codebase, reviewer checks it anyway.
- Billing API — only if paid app. Omnify's current state: free or billing-unset; confirm via `shopify.app.omnify.toml`.

### Two Shopify app configs coexist
- `shopify.app.toml` → CPG Labs full (custom app, installed on GE Beauty only). Client ID `58ada92e...`. Pushed via `shopify app deploy --config shopify.app.toml`.
- `shopify.app.omnify.toml` → Omnify focused (public app, the one we're submitting for review). Client ID `68903b97...`. Pushed via `shopify app deploy --config shopify.app.omnify.toml`.
- **Do NOT cross the streams.** Pushing Omnify scope changes under the CPG Labs config rebuilds the GE Beauty custom app.

### Legacy deploy scripts have guards now
Both `deploy-cpg-labs.ps1` and `deploy-omnify.ps1` import `scripts/_deploy-common.psm1` and run `Assert-CleanWorkingTree` + `Assert-NoSplitBrain -Region $Region` before the Docker build. This means:
- **You cannot deploy with a dirty working tree.** Commit or stash first.
- **You cannot accidentally scale `omnify-cluster` back up and deploy.** Guard refuses.
- If `_deploy-common.psm1` is missing (rebase, older branch), the scripts emit a warning and continue — no hard dependency.

### New deploy pipeline staged but NOT active
`scripts/deploy.ps1` + `scripts/apps.psd1` + `scripts/new-app.ps1` exist in the tree. **They reference service names that don't exist yet** (`cpg-labs-full-service`, `cpg-labs-omnify-service`). Running them today fails. They activate in Phase 6c when `terraform state mv` renames the live services. Keep using `deploy-cpg-labs.ps1` / `deploy-omnify.ps1` for now.

### NAMI Works is out of scope
Separate product, separate repo (`Desktop/nami-works/`), separate hostname (`mcp.nami.works`). Per the audit, confirmed isolated from this cleanup. Don't touch.
