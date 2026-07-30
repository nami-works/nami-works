# Handoff Log — pending session pickups

<!-- ══════════════════════════════════════════════════════════════════════
     INITIAL PROMPT / PROTOCOL — applies to every item in this file.
     Read this before acting on any handoff below.
     ══════════════════════════════════════════════════════════════════════ -->

This file is the live queue of session handoffs waiting to be picked up. Each block below is a self-contained pickup prompt for ONE work item, titled by its session name (e.g. `discount-watchdog`).

**Surface tag.** Each block is tagged **Surface: Claude Cowork** or **Surface: Claude Code**, per the surface-aware handoff skill. They operate differently and it matters here:

- **Cowork** runs in an ephemeral cloud sandbox on a *connected folder*, does **not** auto-load this repo's Claude memory, and uses a POSIX shell. Cowork blocks are written to stand alone — don't go hunting for memory files.
- **Code** runs locally with full git, auto-loaded memory + CLAUDE.md, Windows PowerShell, and the local `gebeauty/.env`. Blocks that need Windows tooling, local secrets, live-store writes, or memory are tagged Code.

**Standing rule — self-pruning log.** When Lucas asks you to tackle a specific item from this log — whether he pastes that item's block or just names it and points you at this file — you must, as part of the same task:

1. Do the item's own steps (read its handoff, confirm state, etc.).
2. **Remove that item's entire block from this file (`docs/_handoff-log.md`) and save it** — at pickup, in the same step where you delete the item's handoff file. Delete ONLY the block you were handed; never touch any other item's block.
3. Land the removal so `origin/main` reflects only what is still pending: on **Code**, commit + push together with the handoff-file deletion; on **Cowork**, `git rm` + commit if you have push access, otherwise flag it and a Code session will land it.

That way an item disappears from this log the moment a session takes it on, and whatever remains here is exactly the still-pending work.

---

# email

**Surface: Claude Code.** The email-copilot workflow is memory-resident — label snapshots, per-recipient reply styles, decision rules, and the orgs registry all live under `~/.claude/.../memory/`, which Cowork can't reach. Run this on Code.

A prior session of yours wrote a handoff document for the work I want to continue. Read it, internalize it, then **delete the handoff file from disk** (it's ephemeral — git history preserves it if anyone ever needs it back).

Handoff file: `docs/handoff-email-copilot.md`

Steps:
1. `git fetch; git pull` on main so the handoff file is present locally.
2. Read the full handoff.
3. Confirm back to me, in 5 bullets or less, what state production is in and what you understand the next step to be.
4. Delete the handoff file (`rm docs/handoff-email-copilot.md`).
5. Wait for my direction before doing anything else.

↳ **Log upkeep (do this at pickup, same step as deleting the handoff file):** delete this entire `email` block from `docs/_handoff-log.md` and commit, so the log lists only pending items.

---

# discount-watchdog

**Surface: Claude Cowork.** Caveat: any step that writes to the live GE store runs through local `gebeauty/.env` scripts — do those where the creds resolve (confirm the `.env` is present in the connected folder first, or hand the write-step to a Code session).

A prior session wrote a handoff document for the work I want to continue. It's written to stand alone — you will NOT have this repo's Claude memory auto-loaded, so treat the file as your complete context; don't go looking for memory files.

Handoff file: `docs/handoff-gebeauty-discount-ops.md`, in the connected folder. If it isn't there yet, run `git pull` first (it's on origin/main).

Steps:
1. Read the full handoff.
2. Confirm back to me, in 5 bullets or less, what state the store/watchdog are in and what you understand the next steps to be.
3. Wait for my direction before doing anything else.

When we're done with it, remove the file with `git rm docs/handoff-gebeauty-discount-ops.md` and commit the removal — it's ephemeral, git history preserves it. If you don't have git push access in this Cowork session, leave it and tell me; a Claude Code session will clean it up.

↳ **Log upkeep (at pickup):** delete this entire `discount-watchdog` block from `docs/_handoff-log.md` (land the removal per the deletion note above).

---

# r&d_reviews

**Surface: Claude Cowork.** (If you need to pull fresh Loox review data, that's a local `gebeauty/.env` script — run that part on Code; the analysis and writeup are fine on Cowork.)

A prior session wrote a handoff document for the work I want to continue. It's written to stand alone — you will NOT have Claude memory auto-loaded, so treat the file as your complete context; don't go looking for memory files.

Handoff file: `docs/handoff-antifrizz-rd.md`, in the connected folder. If it isn't there yet, run `git pull` first (it's on origin/main).

Steps:
1. Read the full handoff.
2. Confirm back to me, in 5 bullets or less, what state the work is in (what's committed) and what you understand the next step to be.
3. Wait for my direction before doing anything else — do not auto-start work.

When we're done with it, remove the file with `git rm docs/handoff-antifrizz-rd.md` and commit the removal. If you don't have git push access in this Cowork session, leave it and tell me; a Claude Code session will clean it up.

↳ **Log upkeep (at pickup):** delete this entire `r&d_reviews` block from `docs/_handoff-log.md` (land the removal per the deletion note above).

---

# gebeauty-stack

**Surface: Claude Cowork.** The open threads (Canva per-user team seats + `/setup` update, finishing Alicia's onboarding) are coordination/docs — Cowork-fine. Note: a connector redeploy would be a Code task (local git + deploy).

Read `docs/handoff-team-toolset-enablement.md` first — the full handoff from the prior session on GE Beauty team toolset enablement. It's in the connected folder (run `git pull` if it isn't there yet), and it's self-contained; don't rely on Claude memory. Absorb it, then confirm back to me in a few bullets: current production state, what's live vs pending, and the immediate next step. Don't start any work until I direct you.

Context in one line: we settled the capability-placement model (org skills = setup + creative-producer for the team; connector = GE data/actions only; repo = dev/repo-integrated skills), the connector is live at connector-20260721-noskilltool, and Alicia is provisioned but blocked on installing Git. The two open threads are the Canva shared-account instability (move to per-user team seats + update /setup) and finishing Alicia's onboarding.

↳ **Log upkeep (at pickup):** delete this entire `gebeauty-stack` block from `docs/_handoff-log.md` and land the removal.

---

# theme-fixes

**Surface: Claude Code.** This pipeline is Windows/local-bound — `convert` (the Windows disk tool) + PyMuPDF, `gebeauty/.env` creds, live-theme writes (theme 181379236160), and the `skill_iconographer.md` memory that auto-loads only on Code. Cowork can't run it. Keep on Code.

`git fetch; git pull` on main first, then read `docs/handoff-iconographer-pipeline.md` — it's the full, self-contained handoff.

Context in one paragraph: We built /iconographer ("Otto"), a production website-icon generator for GE Beauty, spun off from /illustrator. It has a deterministic engine (.claude/skills/iconographer/scripts/iconkit.py: family shell + rounded primitive kit + motif normalizer + a 7-check auto-QA scorer calibrated on the real family). We ran a 4-process experiment and locked the pipeline: library-extract → kit → stock, with AI-autotrace dropped (it solidifies line art). All 18 ICONS FINAIS.ai brand icons are ingested into gebeauty/imagery/website-icons/ as icon-<name>.svg + currentColor pairs (scored 98–100), plus 4 kit drafts in drafts/. Standard = filled-outline, viewBox 0 0 51 51, GE red #DF3630. Two artifacts published (inventory + methodology, linked in the doc). One live change already shipped: Máscara Mayday slide moved to hero position 1.

Everything is committed to origin/main (no branch to check out). Memory skill_iconographer.md loads at session start.

Next up (held for this session): the 3 travel-size LP benefit icons — extract Sem sulfatos from the library for "livre de sulfatos", and author the two missing ones ("limpa sem ressecar", "use todos os dias") in filled-outline. Store deploy is gated (needs Lucas's go). Confirm with me before any live-store write.

Environment gotchas (in the doc): .ai files are PDF-compatible → use PyMuPDF (no poppler/Ghostscript); convert on Windows is the disk tool, not ImageMagick; .env from C:\claude\gebeauty\.env; live theme 181379236160.

↳ **Log upkeep (at pickup):** delete this entire `theme-fixes` block from `docs/_handoff-log.md` and commit the removal.

---

# landing-pages

**Surface: Claude Cowork.** Caveat: building and iterating the LPs is Cowork-fine, but applying to the live GE theme/store (Asset API, metafield binding) runs through local `gebeauty/.env` — do the apply where the creds resolve (or confirm the `.env` is synced into the connected folder), otherwise hand the live-store step to a Code session.

## lp_single-product

A prior session wrote a handoff document for the work I want to continue. It stands alone — you will NOT have Claude memory auto-loaded; treat the file as your complete context.

Handoff file: `docs/handoff-primer-liso-lp.md`, in the connected folder. If it isn't there yet, run `git pull` first (it's on origin/main).

Steps:
1. Read the full handoff.
2. Confirm back to me, in 5 bullets or less, what state production is in and what you understand the next step to be.
3. Wait for my direction before doing anything else.

When done, `git rm docs/handoff-primer-liso-lp.md` and commit the removal; no push access on Cowork → leave it and tell me.

## lp-builder_101

A prior session wrote a handoff document for the GE Beauty landing-page / paid-conversion work I want to continue. It stands alone — you will NOT have Claude memory auto-loaded; treat the file as your complete context.

Handoff file: `docs/handoff-landing-page-conversion.md`, in the connected folder. If it isn't there yet, run `git pull` first (it was pushed to origin/main at bf5b6fe).

Steps:
1. Read the full handoff.
2. Confirm back to me, in 5 bullets or less: what state the LPs + the PDP-vs-LP A/B are in, and what you understand the next step to be.
3. Wait for my direction before doing anything else — do not auto-start work.

When done, `git rm docs/handoff-landing-page-conversion.md` and commit the removal; no push access on Cowork → leave it and tell me.

## lp_multi-products

A prior session wrote a handoff document for the GE Beauty landing-page work I want to continue. It stands alone — you will NOT have Claude memory auto-loaded; treat the file as your complete context.

Handoff file: `docs/handoff-multi-product-lp.md`, in the connected folder. If it isn't there yet, run `git pull` (or `git checkout origin/main -- docs/handoff-multi-product-lp.md` to bring just that file without switching branches).

Steps:
1. Read the full handoff.
2. Confirm back to me, in 5 bullets or less, what state the boosters + travel-size LPs are in and what the next step is.
3. Wait for my direction before doing anything else.

When done, `git rm docs/handoff-multi-product-lp.md` and commit the removal; no push access on Cowork → leave it and tell me.
