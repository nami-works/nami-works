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
2. For a Gmail label: `search_threads` with `label:<id> -label:digested` (this
   EXCLUDES already-digested threads — dedup layer 1); `get_thread` for bodies.
   Newsletters are big HTML and often overflow into a saved file — extract clean plaintext
   with `python .claude/skills/digest/scripts/extract_email.py <saved-file>` instead of
   reading the raw dump. To TRIAGE, read enough to judge; but for any chunk you'll file as
   a deep playbook, read the ENTIRE source (a truncated window silently drops steps — that
   is exactly how a playbook reference ends up thin).

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
4. **Route by depth — proportional to the chunk, NOT one uniform bar:**
   - **Principle / metric / insight** (the idea IS the value; the "how" is short) → a
     compact entry in `knowledge.md` only. Tight.
   - **Executable playbook** (tools, configs, step-by-step, hires, templates) → a compact
     entry that POINTS to a deep file `references/<slug>.md`, written **full and
     buildable**: someone should be able to *build the thing from it without the original*.
     Strip fluff, vendor ads, and jokes; keep 100% of the actionable substance — every
     step, tool, number, threshold, and template. Longer is fine here; **losing the "how"
     is the failure mode, not length.** (A playbook compressed to its thesis is a thin
     reference — the thesis was already memorable; the steps were the point.)
   A `knowledge.md` entry itself is always one scannable block (claim · tag · source ·
   so-what/action · optional `method → references/<slug>.md`), never an essay — the depth
   lives in the linked file.
5. **Stage for approval.** Present the proposed entries (+ a short triage of what you
   skipped and why). **Commit nothing yet.** Let the user cut/edit/confirm.
6. **File + commit.** On approval: append compact entries to `knowledge.md`, write any deep
   reference files, and commit to `main` (loose-ops zone). Group into a labeled section if
   the base uses them (e.g. "Best practices & playbooks (external)"). Every entry carries a
   **source ref** (Gmail thread id, or source name + date, or content hash) — this is the
   dedup key.
7. **Mark processed.** Gmail: add a `digested` label to each processed thread
   (`create_label` once if missing, then `label_thread`), keeping the topic label. Non-Gmail
   sources: append the id/hash to a committed processed-log beside the knowledge base
   (e.g. `<dir>/.digested.jsonl`).

## Preventing double-digestion (three layers)

A single marker is not enough (labels get removed, logs get wiped, runs happen on other
machines). Use all three:

1. **Exclude at the source.** Gmail query always includes `-label:digested`; for
   files/text, skip ids/hashes already in the processed-log. Already-processed items never
   get pulled.
2. **The knowledge base is self-deduping (durable backstop).** Before filing any entry,
   check the target `knowledge.md` (+ `references/`) for its **source ref**; if present,
   skip it. This lives in git, so it survives a lost label / wiped log / different machine.
   This is the layer of truth.
3. **The approval gate.** The staged batch is shown before commit — an obvious repeat is
   caught by eye.

Dedup key by source type: **Gmail** = thread id (+ the label); **newsletter** = source
name + date; **pasted text / file** = content hash. Caveat: a Gmail thread that gets a new
reply after being digested stays excluded (it keeps the label) — fine for one-shot
newsletters; for long evolving threads, re-digest deliberately.

## Hard rules

- **Digest, don't dump.** Fewer, sharper entries beat a transcript.
- **Approve before canon.** Never write to the knowledge base before the user okays the batch.
- **Provenance is mandatory.** Every entry says what kind of claim it is and where it came from.
- **PII/secrets never land in a committed file.**
- **Knowledge stays brand/business-agnostic.** File the general principle/method + external
  examples. Do NOT bake the org's *own current state* into an entry or reference — its
  policies, thresholds, coupon/discount schemes, config, or point-in-time metric values.
  Those go stale and conflict with the live source of truth; they live in the operational
  layer (the store, CLAUDE.md, initiatives, the scorecard) and are *referenced*, not copied.
  A generic "how to apply this" is fine; a hardcoded "we currently run X" is not.
- **Depth goes in linked references, never inline** — keep `knowledge.md` scannable.
- **Triage large sources.** Don't read 50 threads in full; pick the decision-relevant ones,
  consolidate clusters (e.g. "email-flow tactics"), and say what you deferred.

## Output

A staged digest for approval, then (post-approval) the committed entries + deep files + a
one-line note of what was filed, what was skipped, and what was marked processed.
