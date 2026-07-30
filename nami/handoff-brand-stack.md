# Session Handoff — 2026-07-30 — NAMI brand stack

Companion to `nami/handoff-nami-site-launch.md` (the infra/launch session's handoff, written minutes before this one from the same shared checkout) — read that one first for the full collision story, the AWS infra state, and the priority-1 item (uncommitted Terraform). **This file covers only the brand-identity work in depth**, which that file mentions but doesn't detail.

Written for continuation in **Claude Cowork**, per Lucas's request — same `nami/` custom location.

## What was done

- **Sourced and produced the brand mark.** Lucas supplied a rough hand-sketch (ballpoint/marker on paper, photographed) of a monkey-in-goggles mascot. Redrew it via Magnific into clean production line art in three passes:
  1. Vector redraw (crisp uniform strokes, no paper texture) — first attempt baked the drawing's negative space (paper-white gaps between fur strands, eye whites, etc.) into **opaque white fill shapes** instead of true transparency. Looked fine on a white card, broke completely on a dark background (rendered as a solid filled blob — this was a real bug, not a rendering glitch).
  2. Fix: derived a genuinely transparent version by stripping the flat white background paths from the vector trace, then generating color variants (black, forest-teal `#1f5c4e`, and a lighter dark-mode teal `#4fa88f` matching the site's existing dark-theme accent) by direct color substitution on the same clean asset — keeps all three pixel-consistent.
  3. Separately generated a **simplified bold favicon glyph** — the detailed mark is illegible below ~24px (verified by rendering at true 16px/32px pixel size, side by side). A distinct, much-simplified bolder version exists specifically for favicon/tiny-icon contexts. **Don't reuse the detailed mark at favicon size** — this is the single most likely thing a future session gets wrong by assuming "just resize the logo."
  - Brand meaning captured (not encoded in code, worth remembering): monkey = primate = "natural," goggles = augmentation/sophistication = "artificial" — loosely literalizes NAMI's name, "Natural + Artificial Merged Intelligence." Lucas confirmed this is a loose association, not a locked brand-story requiring exact retelling.
- **Wired the mark into the actual site** (`apps/nami-site`): real favicon (`public/favicon.png`, replacing the placeholder inline "N"-monogram SVG data URI), nav logo swapped to the real mark with a light/dark theme swap via CSS (`Nav.astro`). Hit and fixed a real Astro scoped-styles bug: the CSS scope hash was incorrectly attached to the ancestor `[data-theme="dark"]` selector, breaking the swap — needed `:global()`, same pattern already used in `ThemeToggle.astro`. Worth knowing if any future nav/theme CSS work hits the same silent-failure pattern.
- **Self-hosted Geist typography**: single variable-font woff2 (covers weights 400–700 in one file — confirmed by inspecting Google Fonts' own served CSS, all four weight buckets resolved to the identical file), downloaded once and served locally instead of loading from Google Fonts at runtime. Kept `-apple-system, BlinkMacSystemFont` first in the font stack so Mac/iOS visitors still get real SF Pro; Geist is the closest free match for everyone else. Chosen over Inter (the prior placeholder) per Lucas's "Apple-like, clean, sophisticated, modern" brief — both were mocked up side by side before deciding.
- **Palette kept as-is** (the "quiet operator, not SaaS-hype" placeholder — warm off-white `#faf8f4` / ink `#1c1b19` / forest-teal `#1f5c4e`). Lucas explicitly chose to react to the placeholder rather than start over.
- **Tone resolution**: the mascot is more playful/characterful than the "quiet operator" copy register. Lucas's explicit call (offered as an option, not assumed): **the mark carries the personality; type/palette/copy stay restrained around it.** Don't let the mascot's energy justify loosening the voice rules already documented in `apps/nami-site/CLAUDE.md`.
- **Resolved the cross-session collision** (see the other handoff for their side) by committing this session's WIP to a new branch (`wip/nami-site-brand-stack`) and moving into a dedicated worktree at `C:/Users/Lucas Guimarães/dev/worktrees/nami-works-brand-stack`, later adopted into native Claude Code tracking via `EnterWorktree`.
- **Shipped [PR #75](https://github.com/nami-works/nami-works/pull/75)**: `wip/nami-site-brand-stack` → `main`. Open, mergeable, no CI configured on this repo. Contains the full nami-site scaffold (it had never been committed anywhere before this session) plus all brand-stack work. The infra/launch session independently confirmed this PR's file list is complete except for `infra/nami-site/terraform/` (their work, not this thread's).

## Key decisions

- **Brand mark is a mascot, not a wordmark-only or abstract-symbol identity** — deliberately more playful than the placeholder's "quiet operator" positioning (Lucas's call, made via an explicit multiple-choice question, not assumed).
- **Two distinct mark assets, not one asset at two sizes** (detailed mark vs. favicon glyph — see above). Documented in `apps/nami-site/CLAUDE.md`.
- **Geist over Inter, self-hosted rather than CDN-loaded.**
- **PR targets `main`, not `feat/nami-site-launch`** — the latter is a dead branch (local-only to `C:\claude`, never pushed, zero unique commits of its own).
- **This repo's worktree convention (`~/dev/worktrees/<slug>/`, standing/manual) currently diverges from Claude Code's own native `EnterWorktree` convention** (`.claude/worktrees/`, session-scoped, defaults to branching fresh off `origin/<default-branch>` rather than local HEAD). Not reconciled — just worked around by adopting the manually-created worktree into native tracking. Worth a deliberate decision later.

## What's pending

- **PR #75 needs review/merge** — see the other handoff, nothing brand-stack-specific is blocking it.
- **Voice/tone guide formalization** — flagged as pending in the *original* (now-deleted) brand-stack handoff from the prior session, still not done. The site's copy already follows an established register (documented in `apps/nami-site/CLAUDE.md`), but there's no standalone voice doc yet.
- **The deferred copy/CRO audit** (`/growth-hacker` `lp-audit` mode, skip its ad-message-match subagent — no ad campaign exists) — explicitly held out of scope for this thread, still applies.

## Modified files

**Complete, committed, pushed (PR #75) — see that PR for the full file list.** Brand-specific highlights: `apps/nami-site/public/brand/*.png` (mark + favicon glyph, both colorways), `apps/nami-site/public/fonts/geist-variable.woff2`, `apps/nami-site/public/favicon.png`, `apps/nami-site/src/components/Nav.astro`, `apps/nami-site/src/layouts/BaseLayout.astro`, `apps/nami-site/src/styles/global.css`, `apps/nami-site/CLAUDE.md`.

## Current state

- PR: https://github.com/nami-works/nami-works/pull/75 — open, mergeable, targets `main`.
- Local worktree (this session's): `C:/Users/Lucas Guimarães/dev/worktrees/nami-works-brand-stack`, branch `wip/nami-site-brand-stack`, fully pushed, clean.
- To verify locally: `npm --prefix apps/nami-site run dev` → check favicon in the browser tab, nav mark in both light/dark theme, and that body text renders in Geist (`document.fonts` should report a "Geist" entry with `status: "loaded"`).
- `npm --prefix apps/nami-site run check` → 0 errors. `npm --prefix apps/nami-site run build` → 11 pages.

## Recommended next steps

1. Read `nami/handoff-nami-site-launch.md` first — it has the priority-1 item (uncommitted Terraform) and the full deploy/infra state.
2. Merge PR #75.
3. Voice/tone guide and the copy/CRO audit are the two concretely-named next pieces of brand-stack work specifically.

## Context the next session needs

- **This handoff is being read from a different environment (Claude Cowork) than where the work happened** (Claude Code CLI, this monorepo). Clone/pull `wip/nami-site-brand-stack`, or wait for PR #75 to merge to `main`, rather than assuming any local checkout's state is current — multiple checkouts were involved tonight and at least one (`C:\claude`) had its working tree partially altered by an unrelated process late in the session (see the other handoff's "Context" section — no data was actually lost, everything real is in PR #75, but don't trust an untracked directory's mere presence as proof its contents are intact).
- **The pre-commit hook that blocks inherited-branch commits is intentionally un-bypassable from the agent side** (see the header comment in `.claude/hooks/pre-commit-gates.sh`) — if a future session hits this same block resuming further nami-site work, the fix is a new branch name, not an env var or `--no-verify`.
- **Two-mark-assets rule** (detailed mark vs. favicon glyph) is the single most likely branding mistake a future session would make — documented in `apps/nami-site/CLAUDE.md`, read that before touching branding again.
- **`apps/omnify-site` is still the sibling app to mirror for Astro/S3/CloudFront conventions.**
