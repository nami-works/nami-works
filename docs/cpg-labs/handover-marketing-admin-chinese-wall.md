# Handover — marketing/admin chinese wall (live infra, code split owed)

**For:** the next Claude Code session picking up the marketing/admin split cleanup
**Status:** infrastructure + DNS cutover done and live; source-code half of the cutover sits on unmerged feature branches; admin still ships the dead marketing routes; `terraform apply` against current `main` is unsafe.

---

## What's going on

The public site (`cpg-labs.io` + `www.cpg-labs.io`) was migrated from the embedded admin's ALB to a dedicated S3 + CloudFront stack in three phases. The infra cutover is complete; the code cutover is not.

| Layer | Reality |
|---|---|
| AWS S3 bucket `cpg-labs-site` | live (10+ static files dated 2026-05-02 01:03 UTC) |
| CloudFront `EY3YD0QMZOHJA` (`d1cuwnxki4q9wr.cloudfront.net`) | live |
| DNS at GoDaddy | `www.cpg-labs.io` CNAME → CloudFront; apex 301 → www |
| `https://www.cpg-labs.io/` | ✅ 200 from CloudFront (correct) |
| `https://omnify.cpg-labs.io/about` (and `/pricing`, `/contact`, `/privacy`, `/terms`, `/security`) | ❌ also 200 from the admin ECS app — the `_site.*.tsx` routes are still on `main` and still shipped in the running Docker image |
| Admin marketing routes on `main` | `app/routes/_site.tsx` + 6 `_site.<page>.tsx` files + `app/routes/_index/` directory + `app/routes/screencast.tsx` + `app/routes/preview.tsx` + `app/components/site-layout/` + `app/components/cpglabs-layout/` + `app/utils/host.server.ts` + `app/styles/site-theme.css` |
| `site/` source (Astro project that builds the live S3 content) | **untracked** in the working tree; real source committed on `feat/marketing-admin-split` (unmerged) |
| ALB listener rules for `www.cpg-labs.io` | terraform state still has `aws_lb_listener_rule.site_root` + `aws_lb_listener_rule.site_www_redirect` + `aws_lb_listener_certificate.site` (Phase 3 retirement is on `2d45fb0` on `feat/optimizer-iteration-loop`, unmerged) |
| Drift reconciliation: `lifecycle { ignore_changes = [task_definition] }` on both `aws_ecs_service.app` resources, `module.omnify` removed from `apps.tf`, `availability_zone_rebalancing = "ENABLED"` on legacy service, `enable_drift_alarms = false` in `terraform.tfvars` | on `feat/marketing-admin-split`, **NOT on main** |

---

## The two footguns this leaves on the floor

1. **`terraform apply` against current `main` is unsafe.** A plan would show `aws_ecs_service.app` (legacy omnify) wanting to roll task-def from current production rev down to whatever rev was in state at last apply (could be many revs behind). Same for `module.full.aws_ecs_service.app` (CPG Labs full at `app.cpg-labs.io`). The `lifecycle { ignore_changes = [task_definition] }` blocks are on `feat/marketing-admin-split` and need to land before any future `terraform apply`. **Do NOT casually `terraform apply` on current `main`.**

2. **Any admin redeploy ships dead marketing routes.** Routes work but duplicate the CloudFront content. If a user discovers `omnify.cpg-labs.io/pricing`, they see the admin-served version, which may not match `www.cpg-labs.io/pricing`. Also drags ~30 dead route files into the bundle for no reason. Not user-visible-broken today, but a real footgun if either side updates copy independently.

---

## Branches in flight

### `origin/feat/marketing-admin-split` — 4 commits

This is the branch whose merge is most overdue.

- `54cb3cf` — **Phase 1**: bootstraps `site/` Astro project (9 pages ported from `app/routes/_index/cpglabs-corporate.tsx` + `_site.*.tsx` + `screencast.tsx` + `preview.tsx`); ESLint cross-import ban (admin can't import from `site/`); CI dep-allowlist guard at `scripts/check-site-deps.ts`; CLAUDE.md `## Public Site (cpg-labs.io)` section.
- `25da08d` — **Phase 2 source**: `infra/terraform/site.tf` (S3 + CloudFront + OAC + bucket policy + security headers, reuses existing ACM cert `588d00ef-263b-4ea8-9e9f-17684dc49fc3`); `scripts/deploy-site.ps1`; `site/src/pages/404.astro`.
- `e47e4ba` — **drift reconciliation** (the safety-critical commit): adds `lifecycle { ignore_changes = [task_definition] }` to both `aws_ecs_service.app` resources; sets `availability_zone_rebalancing = "ENABLED"` on legacy to match production; removes `module "omnify"` from `apps.tf` (with a comment block explaining why module-based consolidation doesn't fit omnify — name divergence makes it a destructive migration); updates `drift-alarms.tf` defaults to drop retired `omnify-gebeauty-*` references.
- `697c9cc` — `scripts/deploy-site.ps1` ASCII-only fix (PowerShell 5.1 codepage parser, em-dashes and box-drawing characters break parsing).

Once this merges, the drift footgun closes, `site/` source lives on `main`, and CI gates protect the wall.

### `origin/feat/optimizer-iteration-loop` — 1 commit

`2d45fb0` "docs(optimizer): land iteration blueprint + day-zero issue drafts" — **bundles two unrelated changes** because of a parallel-session checkout-stomp during Phase 3:

(a) Optimizer iteration blueprint at `docs/optimizer-iteration-blueprint.md` (~668 lines).
(b) Phase 3 admin marketing route deletions:
- Delete `app/routes/_index/` (entire dir)
- Delete `app/routes/_site.tsx` + 6 `_site.<page>.tsx` files + their CSS module siblings
- Delete `app/routes/screencast.tsx` + `app/routes/preview.tsx` + their CSS dirs
- Delete `app/components/site-layout/` + `app/components/cpglabs-layout/`
- Delete `app/utils/host.server.ts`
- Delete `app/styles/site-theme.css`
- Modify `app/root.tsx` to drop `import "./styles/site-theme.css"` and the inline localStorage theme bootstrap script
- Modify `infra/terraform/alb.tf` to remove `aws_lb_listener_certificate.site` + `aws_lb_listener_rule.site_root` + `aws_lb_listener_rule.site_www_redirect`

**Splitting this commit is owed.** The optimizer doc and the Phase 3 deletions are independent; bundling them means reverting either reverts both.

### `origin/feat/marketing-admin-split` covers Phases 1 + 2; `2d45fb0` covers Phase 3. Together they're the complete cutover.

---

## Recommended sequence (cheapest-first, conservative)

### Step 1 — merge `feat/marketing-admin-split` to `main`

```bash
gh pr create --base main --head feat/marketing-admin-split \
  --title "feat: marketing-admin chinese wall, Phases 1+2 (site/ source, S3+CloudFront terraform, drift reconciliation)"
# review PR; squash-merge
```

**Effect:** drift footgun closes (lifecycle ignore lands), `site/` source lives on `main`, CI guards active. **Zero behavior change to production** — admin still ships marketing routes (those go in step 2), AWS infra was already created at `terraform apply` time during the original Phase 2 (state already has the resources).

**Verify before merge:**
- The `e47e4ba` commit's diff for `infra/terraform/ecs.tf` and `infra/terraform/modules/shopify-app/main.tf` still has `lifecycle { ignore_changes = [task_definition] }` on the `aws_ecs_service.app` blocks. If those lines are gone (parallel session reverted or rebased away), DO NOT merge until they're back.
- `terraform.tfvars` is gitignored (line 39 of `.gitignore`: `infra/terraform/terraform.tfvars`). The `enable_drift_alarms = false` override is local-only; doesn't propagate via the merge. New session running terraform later needs to verify their local tfvars has the same setting (otherwise `terraform plan` will want to create the drift-monitoring Lambda/alarms whose source code at `infra/terraform/drift-check-lambda/` still doesn't exist).
- Working tree currently has `site/` (the Astro build artifact dir from the prior session) untracked. After merge, `site/` becomes tracked-on-main and the local untracked tree gets superseded by the committed version. Local `node_modules`, `dist`, etc. follow `site/.gitignore` rules.

### Step 2 — split `2d45fb0` and merge the admin-route-deletion half

Two viable approaches. Pick whichever feels less error-prone.

**Option A (cherry-pick):**
```bash
git checkout main
git pull
git checkout -b chore/admin-marketing-route-removal
git cherry-pick -n 2d45fb0
git restore --staged docs/optimizer-iteration-blueprint.md
git checkout -- docs/optimizer-iteration-blueprint.md
git commit -m "chore(admin): remove dead marketing routes now served from CloudFront

Phase 3 of marketing-admin chinese wall. Phases 1+2 landed in <merge-sha>.
Marketing surface now lives at site/ → S3 → CloudFront; admin routes were
duplicates."
gh pr create --base main --title "chore(admin): remove dead marketing routes (Phase 3)"
```

**Option B (re-do):** branch from `main`, delete the files manually using the list above, modify `root.tsx` and `alb.tf`. Smaller cognitive load if cherry-pick gets messy. Same end state.

**Verify before this PR merges:**
- `npm run build` succeeds. The deleted routes were not imported anywhere else; the prior session ran `npm run typecheck` clean, but state may have drifted.
- `app/root.tsx` no longer imports the deleted `app/styles/site-theme.css`.
- `s-app-nav` items in `app/utils/app-identity.server.ts` don't reference any deleted route. None of the deleted routes were ever in `s-app-nav`, so this should be a no-op, but verify.

### Step 3 — admin deploy

`scripts/deploy.ps1 -App full` (and `-App omnify` separately if its image needs rolling). Actual command depends on which app is being redeployed; both run on the same shared admin codebase.

**Effect:** `omnify.cpg-labs.io/about` (and other deleted routes) start returning 404. `www.cpg-labs.io/about` continues serving from CloudFront unchanged.

### Step 4 — `terraform apply` to retire ALB rules

Plan should now be clean (drift reconciliation merged in step 1, route-deletion merged in step 2). The only changes terraform wants to make are deleting the three ALB resources `aws_lb_listener_rule.site_root` + `aws_lb_listener_rule.site_www_redirect` + `aws_lb_listener_certificate.site`.

```bash
cd infra/terraform
terraform plan
# verify: 0 to add, 0 to change, 3 to destroy (only the 3 ALB resources)
terraform apply
```

### Step 5 — verify the wall is actually closed

```bash
curl -I https://omnify.cpg-labs.io/about         # expect 404
curl -I https://omnify.cpg-labs.io/pricing       # expect 404
curl -I https://omnify.cpg-labs.io/privacy       # expect 404
curl -I https://www.cpg-labs.io/                 # expect 200 from CloudFront
curl -I https://www.cpg-labs.io/about            # expect 200 from CloudFront
curl -sLo /dev/null -w "%{http_code} %{url_effective}\n" https://cpg-labs.io/
# expect: 200 https://www.cpg-labs.io/  (apex still 301-forwards to www → CloudFront)
```

ALB listener rules in AWS console should no longer list any rule for `www.cpg-labs.io` or `cpg-labs.io`.

---

## Done when

- `omnify.cpg-labs.io/about` (and the other deleted routes) return 404.
- `www.cpg-labs.io/about` returns 200 from CloudFront.
- `terraform plan` against `main` is clean (zero drift, ready for routine applies).
- `feat/marketing-admin-split` and the split-out Phase-3-deletions PR are merged.
- The orphaned branches (`feat/marketing-admin-split`, `feat/optimizer-iteration-loop`'s deletion half) are deleted from origin.
- `2d45fb0` on `feat/optimizer-iteration-loop` either gets the deletions stripped out (leaving just the optimizer docs) OR the whole branch is left for the optimizer track to handle separately — coordinate with whoever owns optimizer work.

---

## What NOT to do

- **Don't `terraform apply` against current `main` without first merging `feat/marketing-admin-split`.** The lifecycle-ignore rules are on that branch; without them, apply silently rolls running ECS services back to stale task-def revisions. This is the single biggest landmine.
- **Don't delete the admin marketing routes from `main` directly without first merging `feat/marketing-admin-split`.** Otherwise `omnify.cpg-labs.io/about` 404s while there's no replacement on `main`'s view (the actual replacement is live, but the source isn't on `main` yet — leaves the repo in a confusing state that violates CLAUDE.md's "production and main must stay in sync" rule).
- **Don't merge `2d45fb0` whole.** The optimizer iteration blueprint and the marketing route deletions are different concerns; merging them together makes either future revert dangerous to the other.
- **Don't re-run `terraform apply` for `site.tf` resources.** S3 bucket, CloudFront distribution, OAC, bucket policy, response headers policy — all created during the original Phase 2 apply on 2026-05-02. They're in terraform state. Merging `feat/marketing-admin-split` doesn't try to re-create them; it just brings the source into alignment with what's already in state.

---

## Reference for the original incidents this work fixes

The chinese wall existed because admin and the marketing site shared the same React Router root (`app/root.tsx`), which painted body-bg via `app/styles/site-theme.css`. That global rule leaked into the embedded Shopify admin chrome. Two band-aids accumulated before the structural fix:

1. `:has(s-app-nav) body { background: transparent }` override in `site-theme.css` (commit `6707fe4`, 2026-05-01).
2. Wrapping `<div slot="aside">` in `{!isFullscreen ? ... : null}` in `app.local-delivery.tsx` because the aside content visually bled through the now-transparent overlay (commit `c649953`, same day).

Both band-aids dissolve once Phase 3 lands: `app/root.tsx` no longer imports `site-theme.css`, no global body-bg rule exists, no `:has` override needed, no aside-bleed possible. The body-bg incident is the canonical example of why admin and site sharing a runtime was wrong.

Full original post-mortem context lived in `docs/decisions/2026-05-02-worktree-isolation.md` — that file was deleted along with the chat-room/worktree experiment revert. The incident summary above is sufficient for executing this handover; if you want the deeper post-mortem, it's recoverable from PR #9's diff at `git show 12af99e:docs/decisions/2026-05-02-worktree-isolation.md`.

---

## First-action checklist for the new session

1. Read this file end-to-end.
2. Confirm with Lucas that `feat/marketing-admin-split` is OK to merge (no review notes outstanding from his end).
3. Verify the safety-critical lines are still in `e47e4ba`:
   ```bash
   git show e47e4ba:infra/terraform/ecs.tf | grep -A 2 "lifecycle"
   git show e47e4ba:infra/terraform/modules/shopify-app/main.tf | grep -A 2 "lifecycle"
   ```
   Both should show `ignore_changes = [task_definition]` on the `aws_ecs_service.app` resource.
4. Open the PR for `feat/marketing-admin-split`, squash-merge.
5. Yield to Lucas before step 2 (admin route deletion). The full sequence shouldn't be one autopilot run; let him verify the AWS state after step 1 before proceeding.
