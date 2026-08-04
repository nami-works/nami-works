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

**Surface: Claude Cowork.** The machinery that used to pin this to Code (label snapshots, SENT-diff learning, lifecycle promotion, per-recipient style files, org registry) is retired, and the `/email-copilot` skill has been trimmed to a self-contained operating core — classify-inbox + intent-label + draft-via-Gmail-MCP + triage/execute gate, no local memory needed. Runs the same on Cowork or Code.

A prior session wrote a handoff document for the work I want to continue. It's written to stand alone — you will NOT have this repo's Claude memory auto-loaded, so treat the file as your complete context; don't go looking for memory files.

Handoff file: `docs/handoff-email-copilot.md`, in the connected folder. If it isn't there yet, run `git pull` first (it's on origin/main).

Steps:
1. Read the full handoff.
2. Confirm back to me, in 5 bullets or less, what state production is in and what you understand the next step to be.
3. Wait for my direction before doing anything else.

When we're done with it, remove the file with `git rm docs/handoff-email-copilot.md` and commit the removal — it's ephemeral, git history preserves it. If you don't have git push access in this Cowork session, leave it and tell me; a Claude Code session will clean it up.

↳ **Log upkeep (at pickup):** delete this entire `email` block from `docs/_handoff-log.md` (land the removal per the deletion note above).

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