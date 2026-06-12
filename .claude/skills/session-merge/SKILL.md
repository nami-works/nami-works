---
name: session-merge
description: Decide which of two overlapping Claude Code sessions to keep when their work needs to merge. The two sessions negotiate via the canonical chat file inputs/chat-room.md until they converge on a winner ("home") and what folds in ("feed"), apply a fact-check pass, then surface the decision for the human to confirm BEFORE any session closes. On summon, stale prior content in the chat file is erased unless it matches the current sessions. Use when you have two live sessions whose work overlaps and you must pick one to maintain. Decision + merge-plan only — never executes the merge or closes a session on its own.
argument-hint: "[optional: counterpart session name]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, AskUserQuestion
---

# Session-Merge — pick which session survives

Two Claude Code sessions have been working on overlapping things and only one should stay alive going forward. This skill runs a **structured negotiation between the two sessions** over a shared markdown file, converges on a decision using an explicit checklist, fact-checks it, and hands the final call to the human.

**Hard boundaries (locked by the human who commissioned this skill):**
- **Decision + merge plan only.** Reach the decision and write a concrete merge/handover plan. Do **NOT** execute the merge (no column adds, no migrations) and do **NOT** close any session.
- **Human confirms before any close.** Sessions negotiate to a recommendation autonomously, then stop and surface it. The losing session closes only after the human says so.
- **Read fresh before every write.** The chat file is edited by two sessions concurrently; always Read it immediately before Edit (concurrent edits will reject a stale write — re-Read and retry).
- **Never edit the other session's messages.** Append only. If their content is wrong, post a correction message — don't rewrite theirs.

## The canonical chat file

**The chat always happens in one fixed file: `inputs/chat-room.md`.** There is no per-decision file and no path argument — both sessions read and write this same path. Because it is reused across decisions, it must be **reset at the start of each new merge** (see the freshness gate in step 0). Structure:

```
# Chat room

## Session: <session-name> — <one-line focus>
### What this session built
### Artifacts / tools / scaffolding   (paths — what persists without the session)
### What this session does NOT have

## Discussion
**<from> → <to> — msg N** *(YYYY-MM-DD)*
<message>

## ✅ Conclusion
**Session to keep: <name>**
**Rationale:** ...
**Folds in (feed):** ...
**Merge plan:** 1. ... 2. ...
**Awaiting <human> confirm before <loser> closes.**
```

## Flow

### 0 — Orient + freshness gate
1. **Identify the participants.** This session's name + one-line focus — *what the human briefed this session to do*. The counterpart is named in arg 1 (or per what the human described). If you don't know your own session name, ask the human once (per global work-order convention) — don't invent one.
2. **Read the canonical file `inputs/chat-room.md`.**
3. **Freshness gate — reset stale content.** The file is reused across every merge, so before writing anything, decide whether its current content belongs to *this* decision:
   - **Empty / absent** → seed fresh (you're the initiator).
   - **Matches the current merge** — a `## Session:` block already describes one/both participants and the work the human briefed → keep it, continue (you're the responder or resuming).
   - **Stale / unrelated** — it holds a *different* pair of sessions, a *different* topic, or an already-finished `## ✅ Conclusion` from a past merge that doesn't match what the human described to either current session → **erase the file back to the clean template and seed fresh.** Leftover content from a previous decision must never bleed into a new one.
   - **Ambiguous** — can't tell if it's the live current negotiation or stale → **ask the human before erasing.** A reset is destructive and the counterpart session may be mid-flight; never wipe on a guess.

   Reset = overwrite the whole file with this clean template, then post your summary under it:
   ```
   # Chat room
   ```
4. **Detect your role** (after the gate): **Initiator** if the file is now empty/just-seeded by you; **Responder** if the counterpart's summary or a message to you is already present *for this merge*.

### 1 — Post your session summary
Write your `## Session:` block. Be ruthless about the distinction that drives the decision:
- **What persists without this session** (committed code, files, memory, external artifacts) vs. **what only lives in this session's context.**
- List artifact **paths**, not prose. The reviewer needs to know what survives if this session closes today.

### 2 — Negotiate to a recommendation
Post a message in `## Discussion` with your position, applying the checklist (below). Then **poll the chat file for the counterpart's reply on a 2-minute timeout**:

```bash
# run_in_background: true — never foreground-sleep (harness blocks it)
f="inputs/chat-room.md"; base=$(wc -l < "$f"); end=$((SECONDS+120))
while [ $SECONDS -lt $end ]; do
  cur=$(wc -l < "$f")
  if [ "$cur" -gt "$base" ]; then echo "REPLY (lines $base->$cur)"; exit 0; fi
  sleep 3
done
echo "TIMEOUT"
```

On reply → Read fresh, respond. Repeat until a decision is reached.
On **timeout** → post one nudge, re-poll once. After **2 consecutive timeouts**, stop and tell the human the counterpart session isn't responding (it may not be running) — offer to decide solo from the summaries on file or to wait.

Keep messages short and convergent: state a recommendation with reasons, not an open survey. The goal is the fewest round-trips to a defensible decision.

### 3 — Apply the decision checklist
Score each session on these dimensions. The first three carry the most weight.

| # | Dimension | Question | Leans toward keeping |
|---|---|---|---|
| 1 | **External / durable state** | Does it own live state outside the repo (a SaaS board, deployed service, external account) that can't be regenerated from code? | the session that owns it |
| 2 | **Human-facing surface** | Is its output something a person reads/operates directly (board, dashboard, doc) vs. internal tooling? | the human-facing one |
| 3 | **Cost to recreate** | If this output vanished, how hard to rebuild? Hand-curated external artifact = expensive; committed scripts/data = cheap. | the expensive-to-recreate one |
| 4 | **Persistence w/o session** | Are the outputs already committed (code, files, memory) so they survive with the session closed? | (if yes → that session is *safe to close* as a feed) |
| 5 | **Additive vs redundant** | Do the sessions do different things (combine) or the same thing (pick one)? | — (sets the merge shape) |
| 6 | **Data / spec integrity** | Were any numbers, labels, IDs, or claims mixed up across the two sessions? | (mandatory gate — see step 4) |
| 7 | **Audit / context** | Does one session hold negotiation history or live context that'd be lost on close? | the context-holder |
| 8 | **Ownership / continuity** | Will the survivor actually be able to reach the inherited artifacts (scripts, memory, creds, access)? | (verify before recommending close) |

**Decision logic:**
- **Redundant** → keep the more complete/correct session; the other is archived (nothing to fold).
- **Additive** → the session owning the most-expensive-to-recreate, human-facing, external artifact becomes the **HOME**. The other folds in as a **FEED**: its value is its committed outputs, which the home session inherits.
- A session is **safe to close** only when *all* its value is persisted (committed code / files / memory) and reachable by the survivor. If not, that value must be committed first (flag it; don't close).

Core heuristic in one line: **keep the artifact you can't regenerate; fold in the one you can.**

### 4 — Fact-check pass (mandatory before Conclusion)
Before writing the Conclusion, cross-check the two summaries for mixed-up facts — the failure this skill exists to catch (e.g. one session labeling customer A's revenue as customer B's, or claiming a number maps to a record that doesn't exist). For every figure/ID/name one session attributes to the other's domain, verify it's correct and that the target record actually exists. Post any correction as its own message. **Do not let a wrong mapping reach the merge plan.**

### 5 — Write the Conclusion + merge plan
Append the `## ✅ Conclusion` block: winner (home), what folds in (feed), and a **concrete, numbered merge plan** (exact steps/columns/files — enough that execution is mechanical later). End with the explicit gate line: *"Awaiting `<human>` confirm before `<loser>` closes."*

### 6 — Surface to the human, then stop
Report to the human: the decision, the one-line rationale, the merge plan, and **any unresolved item** (e.g. a correction the counterpart never acknowledged, or value not yet committed). Do **not** close any session. Wait for the human's confirm/veto.

## Output to the human (template)

```
Decision: keep <session> ("home"); <other> folds in as a feed, then closes.
Why: <one line — the deciding dimension(s)>.
Merge plan: <numbered steps>.
Needs your eye: <corrections / uncommitted value / counterpart non-response>.
Confirm to proceed with closing <loser>?
```

## Notes & gotchas
- Windows PowerShell 5.1: no `&&`/`||`; use the Bash tool for the poll loop (POSIX). Never foreground-`sleep` (harness blocks chained sleeps) — use `run_in_background` with an `until`/`while` loop, or Monitor.
- Re-baseline the poll's line count after each of your own writes, or you'll instantly "detect" your own message.
- If the counterpart proposes the same outcome you would, just confirm and converge — don't manufacture disagreement.
- This skill decides; it does not build. Handing the merge plan to the surviving session for execution is a separate, human-initiated step.
