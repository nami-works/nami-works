---
name: digest
description: "Turn tagged/pointed source material into durable, distilled knowledge in a target knowledge base. Generic knowledge-intake: takes a source (a Gmail label, specific threads, a file, or pasted text), triages it against a signal bar, distills each item with a provenance tag, stages the result for approval (never auto-canonizes), then files the keepers two-tier — a compact entry in the knowledge base plus a linked deep reference for playbook/how-to chunks — and marks the source processed so re-runs don't duplicate. Defaults to the GE Beauty growth knowledge base (gebeauty/growth/knowledge.md + references/), but works for any area: `/digest label:legal --into gebeauty/legal/knowledge.md`. Use when the user says 'digest', 'add this to knowledge', 'process the <tag> emails', or points at material to absorb. Respond in the language the user writes in."
argument-hint: "<source> [--into <knowledge.md path>]   e.g. /digest label:growth   |   /digest --into gebeauty/legal/knowledge.md (paste text)"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, TodoWrite, ToolSearch, WebFetch, mcp__claude_ai_Gmail__search_threads, mcp__claude_ai_Gmail__get_thread, mcp__claude_ai_Gmail__get_message, mcp__claude_ai_Gmail__list_labels, mcp__claude_ai_Gmail__label_thread, mcp__claude_ai_Gmail__create_label
---

# /digest — source material into distilled, durable knowledge

You turn incoming material (mostly tagged emails: ideas, insights, best practices, "how
to do X") into a knowledge base the team actually reads. You **distill, you do not dump**,
and you **never canonize your own reading without approval** — a digest is an
interpretation, and interpretations can be wrong.

## Inputs

- **Source** (what to digest): a Gmail label (`label:growth` — resolve the id via
  `list_labels`), specific thread/message ids, a local file/glob, or text the user pasted.
- **Target knowledge base** (`--into <path>`): the `knowledge.md` to file into.
  **Default: `gebeauty/growth/knowledge.md`** with deep files under `gebeauty/growth/references/`.
  For another area, point at its `knowledge.md`; deep files go in a sibling `references/`.

## Setup

1. Resolve the source and the target. **Read the target `knowledge.md` first** — for the
   house format, the existing entries (dedup), and any section structure.
2. For a Gmail label: `search_threads` with `label:<id>` to list; `get_thread` for bodies.
   Newsletters are big HTML and often overflow into a saved file — extract clean plaintext
   with `python .claude/skills/digest/scripts/extract_email.py <saved-file>` instead of
   reading the raw dump. Read only what you need to judge each item.

## The loop

1. **Triage against the signal bar.** File an item ONLY if it changes a decision, a
   number, or a hypothesis for this area. Everything else: skip, or note in one line. A
   knowledge base is a memory, not a clipping pile — protect its signal.
2. **Distill each keeper.** Capture the claim + a **provenance tag** + the source
   (name + date) + the so-what/action. Provenance tags:
   - `[confirmed]` verified in our data AND agreed · `[measured]` in our data, not yet agreed
   - `[estimate]` platform-attributed or modeled · `[hypothesis]` untested
   - `[best-practice]` an external method/idea to apply · `[external]` an outside benchmark/stat
   Keep external best-practices clearly separate from our own measured data — never let a
   newsletter benchmark read like a GE number.
3. **Strip PII / secrets.** The knowledge base is committed to git. File only the distilled
   insight — no names, contract terms, confidential notes, or credentials. Internal intent
   is fine ("Lucas flagged X as priority, DATE"); confidentiality boilerplate and personal
   data are not.
4. **Route by depth (two-tier):**
   - **Atomic insight** (a metric, a single tactic) → a compact entry in `knowledge.md` only.
   - **Playbook / how-to** (a multi-step method) → a compact entry in `knowledge.md` that
     POINTS to a deep file `references/<slug>.md` holding the full method. Deep files are
     **tight-but-complete**: every step, no filler, no re-created newsletter.
   A `knowledge.md` entry is one scannable block (claim · tag · source · so-what/action ·
   optional `method → references/<slug>.md`), not an essay.
5. **Stage for approval.** Present the proposed entries (+ a short triage of what you
   skipped and why). **Commit nothing yet.** Let the user cut/edit/confirm.
6. **File + commit.** On approval: append compact entries to `knowledge.md`, write any deep
   reference files, and commit to `main` (loose-ops zone). Group into a labeled section if
   the base uses them (e.g. "Best practices & playbooks (external)").
7. **Mark processed (dedup).** So a re-run doesn't re-digest: relabel the source. For Gmail,
   add a `claude/digested` label to each processed thread (`create_label` once if missing,
   then `label_thread`), keeping the topic label. If the user prefers, log processed
   message ids in a small file next to the knowledge base instead. Confirm the choice on
   first run.

## Hard rules

- **Digest, don't dump.** Fewer, sharper entries beat a transcript.
- **Approve before canon.** Never write to the knowledge base before the user okays the batch.
- **Provenance is mandatory.** Every entry says what kind of claim it is and where it came from.
- **PII/secrets never land in a committed file.**
- **Depth goes in linked references, never inline** — keep `knowledge.md` scannable.
- **Triage large sources.** Don't read 50 threads in full; pick the decision-relevant ones,
  consolidate clusters (e.g. "email-flow tactics"), and say what you deferred.

## Output

A staged digest for approval, then (post-approval) the committed entries + deep files + a
one-line note of what was filed, what was skipped, and what was marked processed.
