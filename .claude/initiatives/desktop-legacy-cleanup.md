---
id: desktop-legacy-cleanup
name: Retire Desktop/nami-works legacy checkout
owner: cto
status: shipped
priority: normal
created: 2026-07-15
completed: 2026-07-20
current_phase: 6-done
next_blocker: null
next_owner: null
progress_2026_07_16: gate 3 closed (both auxiliary worktrees removed 2026-07-16)
progress_2026_07_17: gate 2 closed (all 5 handoff work orders done + verified 2026-07-17)
progress_2026_07_20: Desktop/nami-works (6.0 GB) + Desktop/cpg-labs both deleted after audit + migrate. Initiative shipped.
working_agreement: ~/.claude/projects/C--claude/memory/feedback_cto_contract.md
---

## Why

Repo canonical checkout pivoted to `c:\claude\` sometime in 2026-07 (see [[reference_working_directory_pivot]]). Legacy checkout at `c:\Users\Lucas Guimarães\Desktop\nami-works\` is being wound down. Deleting it prematurely risks losing uncommitted work + orphaning worktrees; ignoring it leaves split-brain state that keeps confusing sessions. Retire it deliberately.

## Phases (deletion gates)

- [x] **1. `/c/claude` can push to origin independently** — closed 2026-07-15. Added `origin` remote, pinned gh credential helper locally, verified with two zero-object test pushes.
- [x] **1b. `/c/claude`'s local work backed up to origin** — closed 2026-07-15. Push `backup/c-claude-main-2026-07-15` landed. Then merged origin/main into local, pushed merged main; local and origin now in sync at `070d8c3`.
- [x] **2. Uncommitted work in `Desktop/nami-works` reconciled with `/c/claude`** — closed 2026-07-17. All 5 handoff work orders done + verified. Summary: #2 landing-page-replication grafted Desktop's newer travel-size note into canonical (2026-07-16). #4 catalog-consistency-sweep absorbed Desktop-only report + committed `d49391b` (2026-07-17). #5 retention-machine/correct_keeper.py absorbed with DO-NOT-RE-RUN banner + committed `5fc81c8` (2026-07-17). #3 discount-shipping-audit reconciled by owning session. #1 paid-media-scale grafted two 2026-07-09 notes (strategy spine + MER calibration) + upgraded governing rule + committed `a42a981` (2026-07-17). All commits on origin/main.
- [x] **3. Active worktrees under `~/dev/worktrees/nami-works-*` migrated or removed** — closed 2026-07-16. Both auxiliary worktrees removed. Post-mortem: `connfix` remove got stuck on locked `node_modules`, tracking was unlinked partway, apparent "6 M + 24 ??" state turned out to be CRLF line-ending noise (real M count against a389513 tip was 0). Untracked files inside fully-deleted subdirs are lost but no tracked/committed work at risk (a389513 is on origin). `rota-local-outbox` was truly clean, removed with `--force` + rm -rf on the leftover disk artifacts.
- [ ] **4. Sync mechanism (GitHub → /c/claude) confirmed independent of Desktop** — ⚠️ still unknown mechanism, but less critical now that /c/claude has its own origin.

## Handoff work orders queued (`~/.claude/work-orders/`)

Each targets the session that owns the topic. Lucas re-addresses `to:` field to the actual session name when routing.

1. `2026-07-15-desktop-legacy-paid-media-scale-reconcile.md` — reconcile `.claude/initiatives/gebeauty-paid-media-scale.md` (canonical is larger, ~2 KB newer)
2. `2026-07-15-desktop-legacy-landing-page-replication-reconcile.md` — reconcile `.claude/initiatives/landing-page-replication.md` (**Desktop is larger by 3.7 KB — unique work at risk**)
3. `2026-07-15-desktop-legacy-discount-shipping-audit-reconcile.md` — reconcile `sandbox/gebeauty/inputs/discount_shipping_audit.json` (Desktop 13 KB larger, possibly fresher run)
4. `2026-07-15-desktop-legacy-catalog-consistency-sweep-absorb.md` — absorb Desktop-only `sandbox/gebeauty/catalog-consistency-sweep-2026-07-13.md`
5. `2026-07-15-desktop-legacy-retention-machine-correct-keeper-absorb.md` — absorb Desktop-only `sandbox/gebeauty/retention-machine/correct_keeper.py`

## Safe to lose without handoff

7 `_*`-prefixed one-shot investigation scripts under `sandbox/gebeauty/scripts/` (per [[feedback_two_tier_discipline]]: one-shot investigations are expendable by design). Names for the record: `_online_revenue_mer.py`, `_probe_boosters_banner{,2,3}.py`, `_replace_col_banner_desktop_560.py`, `_sweep_fetch_surfaces.py`, `_sweep_list_imgs.py`.

## Notes / gotchas for next session

- **Do NOT `git push` from `Desktop/nami-works` or its worktrees** — Desktop's `main` is 63 commits behind origin after today's merge. Pushing would fail or force-clobber. Any commit or push from Desktop is a landmine.
- **Do NOT `git pull` from `Desktop/nami-works` root** while it's on `feat/retention-machine-waves` with uncommitted `M` files + untracked `??` files. Would either fail on conflict or eat the WIP.
- **When ready to delete Desktop:** stop it in this order:
  1. Confirm all 5 handoff work orders have `status: done`
  2. `git worktree remove` both auxiliary worktrees (or migrate branches to `/c/claude`)
  3. Snapshot `Desktop/nami-works/` to zip if paranoid (~2 GB with images)
  4. `rm -rf` the directory
- **gh account flip** — earlier this session `gh auth` kept flipping active account to `tecnologia-gebeauty` (which can't see the repo). Lucas logged out that account with `gh auth logout --user tecnologia-gebeauty`. If it comes back, use `gh auth switch --user nami-works && gh auth setup-git`.

## Done means

- All 5 handoff work orders closed (their receiving sessions absorbed or discarded per case)
- Both auxiliary worktrees migrated to `/c/claude` or removed
- `Desktop/nami-works/` deleted with no work lost
- `Desktop/cpg-labs/` (added scope 2026-07-20) — audited + migrated (`docs/manual-shopify-location-flip.md`) + deleted. AWS access key CSV flagged for Console double-check (`AKIAW6PPI7H2J3LVYAF6` not on active user's key list, presumed rotated out).
- Anyone running a new Claude Code session for this repo lands in `/c/claude` and never mentions Desktop again

## cpg-labs cleanup notes (2026-07-20)

Legacy checkout at `c:\Users\Lucas Guimarães\Desktop\cpg-labs\` — separate git repo (`github.com/nami-works/cpg-labs`), last touched 2026-05-25, pre-monorepo-merger.

Audit findings before delete:
- **AWS access key CSV** (`OmnifyCursor_accessKeys.csv`, `AKIAW6PPI7H2J3LVYAF6`) — not on the current `cpg-labs` IAM user's active key list; presumed rotated out. Lucas to verify in AWS Console for full peace of mind.
- **Uncommitted work (8 untracked items)** — audited against `/c/claude`:
  - `docs/manual-shopify-location-flip.md` — MIGRATED to `/c/claude/docs/manual-shopify-location-flip.md` (reusable ops runbook, byte-identical)
  - `docs/video-director-{ip,metafield-map,state-schema}.md` — canonical has current versions at `gebeauty/video-director/docs/`; safe to lose
  - `nami-works/sandbox/` — empty skeleton, safe to lose
  - `inputs/video-prototypes/{primer-cachos-definidos-v1, primers-resistance/bakeoff}/` — May-2026 prototypes superseded by current v8+/v32 evolution; discarded per Lucas's call
  - `scripts/video/{bake_off, fal_wrapper, state}.py` — canonical has matching or evolved versions
- **4 unique .env keys** (`DATABASE_URL`, `LLM_KEY`, `LLM_SECRET`, `SHOPIFY_APP_URL`) — stale from cpg-labs era (decommissioned DB, superseded LLM/Shopify config); accepted as safe to lose
- **Local behind origin by 1 commit** — no work lost; origin repo still accessible at `github.com/nami-works/cpg-labs.git`
