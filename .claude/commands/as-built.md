---
description: Reverse-sync a mockup in inputs/mockups/ to reflect what was actually shipped in production code. Closes the drift between locked-in design and as-built React.
argument-hint: "[feature slug | mockup path | --pick | --from-wrapup <slug>]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, AskUserQuestion, TodoWrite
---

You are running `/as-built` — the post-implementation mockup reconciler.

The mockup-first workflow in `CLAUDE.md` produces a `inputs/mockups/<feature>-vN.html` that locks in the visual language *before* React is touched. After the React ships, the implementation often drifts past the mockup (small label tweaks, layout adjustments, pattern adoptions discovered while building, follow-up iterations). The mockup then goes stale and the next session can no longer trust it as a design record. This skill closes that gap by **rewriting the mockup to match the as-built production code**, in place, so it remains the canonical visual record for the feature.

This is one-way: **code → mockup**. Never edit React from inside this skill. If you find production bugs while reading, flag them in the final report; do not fix.

Match the user's language (English in → English out; Portuguese in → Portuguese out).

---

## Argument parsing

- **No arg** → Phase 1 picks a candidate from `inputs/mockups/INDEX.md` (oldest `Last updated` whose implementing route has commits newer than that date wins). Confirm the pick before proceeding.
- **`--pick`** → Same as no arg, but list 3–5 candidates and let the user choose via `AskUserQuestion`.
- **A feature slug** (e.g. `local-delivery-backlog`) → resolve to the matching `inputs/mockups/<slug>-v*.html` file (prefer `-final` suffix when present).
- **A mockup path** (`inputs/mockups/foo.html`) → use directly.
- **`--from-wrapup <slug>`** → read pre-resolved context from `.claude/.as-built-handoff-<slug>.json` (written by `/wrap-up` Phase 5.1). **Skips Phase 1 entirely** — git verification, INDEX row resolution, and route discovery are already done. This is the token-efficient path when chaining after `/wrap-up`.

If the resolved file does not exist, abort with the closest matches from `Glob inputs/mockups/*.html`. If `--from-wrapup` is passed but no handoff file exists, fall back to standalone Phase 1 with the slug as the seed.

---

## Phase 1 — Resolve target & read both sides

**Fast path — `--from-wrapup <slug>` was passed:**

1. Read `.claude/.as-built-handoff-<slug>.json`. It already contains: `mockup_path`, `implements_paths[]`, `index_row_bucket`, `index_last_updated`, `latest_route_commit`, `deploy_rev`, `merged_pr`. Trust those values — `/wrap-up` just resolved them.
2. Skip the git verification (`/wrap-up` already confirmed `main` state and that the implementation has shipped) and skip the INDEX row lookup.
3. Jump directly to step 4 (read both sides).
4. After Phase 6 commit, delete the handoff file (`.claude/.as-built-handoff-<slug>.json`) — it's a single-use token.

**Standalone path — no handoff file:**

1. **Resolve mockup file** per argument-parsing above.
2. **Find the implementing files** by reading the corresponding row in `inputs/mockups/INDEX.md`. The "Implements (route / component)" column lists the canonical paths. If the row is missing, ask the user which route(s) implement the feature — never guess from filename.
3. **Verify it has actually shipped on `main`.** This skill is for landed work, not in-flight branches.
   ```bash
   git log -1 --format='%h %ai %s' main -- <implementing-route>
   git status --short
   ```
   If the implementing route only exists on a feature branch, abort: "the mockup-first workflow is still running for this feature; come back after merge." If the working tree is dirty on `main`, ask before proceeding (per `CLAUDE.md` stale-`main` rule — never silently inherit other sessions' work).

**Both paths converge here:**

4. **Read in parallel:**
   - The mockup HTML (full file)
   - Each implementing `.tsx` route
   - Each sibling `styles.module.css` (route-level CSS module per `CLAUDE.md`)
   - Any new components the route imports that didn't exist when the mockup was authored

Cache:
- `MOCKUP_PATH`, `MOCKUP_LAST_UPDATED` (from INDEX.md row, or file mtime if not registered)
- `IMPL_PATHS[]` (every file the row points to)
- `IMPL_LAST_TOUCHED` (most recent commit on any of the implementing files)
- `INDEX_ROW_BUCKET` ("Final mockups" / "Pre-rule iteration" / unregistered)

If `IMPL_LAST_TOUCHED` ≤ `MOCKUP_LAST_UPDATED` and the mockup is registered as Final, the mockup is presumptively in sync. Confirm with the user whether to run anyway (sometimes the mockup is wrong even before drift).

---

## Phase 2 — Build the delta list

For each visual / interaction surface, compare mockup vs. production. Walk the surfaces in this order so the punch-list reads top-down through the page:

1. **Page chrome** — title, subtitle, primary/secondary header actions, breadcrumbs, back-action.
2. **Layout** — column count, aside placement, mobile stacking order, full-width vs. `inlineSize="base"`.
3. **Filter / control rows** — order of controls, labels, external-vs-internal label pattern, any controls added/removed.
4. **Sections / cards** — count, order, headings, collapsibility, chevron pattern.
5. **Tables / lists** — column order, headers, sort affordances, row actions, currency format, sort-arrow adhesion.
6. **Charts** — bar variants, axis ticks, gridlines, goal markers, legend, tooltip rows + order, color tokens, mobile breakpoints.
7. **Modals** — trigger, title, body structure, footer button order (Cancel left, primary right, destructive bottom-left or top-right per pattern).
8. **Buttons** — labels (verb + noun), variants, tones, loading/disabled states, placement.
9. **Status indicators** — badges, banners, color semantics (green/yellow/orange/red/blue per CLAUDE.md).
10. **Copy** — exact strings on visible labels. Check both `en` and `pt-BR` locale files if the route reads from `app/i18n/locales/`.
11. **Spacing / tokens** — any color or spacing values inlined in production CSS that differ from mockup CSS.
12. **Mobile** — `≤768px` breakpoint behaviors that ship vs. mockup.

For each surface, classify each delta as:

- `[ADDED]` — production has it, mockup doesn't → mockup must gain it.
- `[REMOVED]` — mockup has it, production doesn't → mockup must lose it.
- `[CHANGED]` — both have it but different (color, label, position, count) → mockup must match production.
- `[INTENTIONAL-MOCKUP-ONLY]` — annotation panels (Notes, legends explaining the design, before/after callouts) that exist for documentation purposes and should be **kept or rewritten**, not deleted.

Skip in this skill (not part of as-built reconciliation):
- Comments inside React/CSS.
- Internal class-name renames if they don't change the rendered output.
- Backend / loader / action logic with no visual effect.

---

## Phase 3 — Present the punch-list

One message, plain prose. For each delta, include:
- Surface (e.g. "Filter row", "Route card actions").
- Classification tag.
- One-line description of what shipped vs. what the mockup shows.
- Proposed mockup edit (one or two sentences — not the full HTML).

End with a count: `N deltas to apply · M intentional-mockup-only panels to preserve · K open questions`.

If you hit ambiguity (e.g. "the route renders a new badge but I can't tell what tone it should be in the mockup"), surface it as an **open question** with `AskUserQuestion`. Cap at 3 questions; batch the rest.

**Wait for user approval** before editing. Do not auto-apply.

---

## Phase 4 — Edit the mockup in place

When approved, apply all approved deltas to the mockup file with `Edit` calls. Rules:

1. **Edit the existing file in place.** Do not create `-v2.html`, `-as-built.html`, etc. — the mockup IS the as-built record now. (CLAUDE.md "Design Validation" rule: in-session iterations edit the original; this is the same principle.)
2. **Strip iteration-history clutter.** A final mockup shows the locked-in production target only. Remove:
   - "Open questions" panels
   - "Before / After" columns or strikethrough callouts
   - "REMOVED" / "NEW" pills, highlight rings, and other diff annotations from the iteration phase
   - Any commented-out HTML left over from earlier rounds
3. **Rewrite the "Notes" panel.** The Notes panel must remain — but reframe it from *"changes proposed in this mockup"* to *"why the shipped UI looks the way it does"*. One short bulleted list explaining the locked-in decisions a future reader needs to know (e.g. "Goal marker is dotted, not solid, because Shopify reserves solid horizontal lines for measurement; dotted = reference / target.").
4. **Match production tokens exactly.** Copy hex values from the production CSS module, not from memory. If the production CSS uses a CSS variable, the mockup can keep its local `--token` variable but the final value must match.
5. **Match production copy exactly.** When the route renders an i18n key, read the resolved English string from `app/i18n/locales/en.*` and use that verbatim in the mockup. Do not paraphrase.
6. **Mobile section.** If the mockup has a `≤768px` block, update it to match the production media queries. If the mockup has none and production ships responsive behavior, ADD a mobile preview section using the standard 375px-wide framing already used in other final mockups.
7. **Title bar of the mockup.** Update the `<h1>` and intro line to read as the as-built record (e.g. "As-built: Local Delivery — backlog tweaks · shipped 2026-05-05 (PR #15, rev 11)"). The intro should name the implementing route(s) so a future reader can jump to the source quickly.

After edits, re-read the mockup once and sanity-check: does it visually describe what production shows today, with no leftover "TODO" / "consider" / "should we" prose? If yes, proceed.

---

## Phase 5 — Update `inputs/mockups/INDEX.md`

The INDEX is the discovery layer. Reconcile the row for this mockup:

- **Last updated** → today's date (read from system context, format `YYYY-MM-DD`).
- **Implements** → confirm the route paths still resolve (some may have been renamed since the mockup was registered). Update the markdown links if so.
- **Notes** → rewrite to reflect as-built status. Drop any "STALE — superseded by..." marker if the supersession was just rolled into the same file by this skill.
- **Bucket promotion** → if the row currently lives under "Pre-rule iteration mockups" and the implementation has shipped, move the row up into the "Final mockups (locked-in visual language)" table. Promote the filename if it lacks a `-final` suffix? **Do not rename the file** unless the user explicitly asks — file renames break git blame for the iteration history. The bucket move alone is enough.

If the mockup has no row in INDEX.md (untracked legacy file), add one. Pick the right bucket: Final if implementation is shipped, Pre-rule iteration otherwise.

---

## Phase 6 — Commit

Per `CLAUDE.md` branch-per-task rule, mockup + INDEX edits qualify as docs and may go directly to `main`. But: confirm with the user before pushing. Some authors prefer a chore branch even for docs.

Default flow (single confirm):

```bash
git status --short
git add inputs/mockups/<file>.html inputs/mockups/INDEX.md
git diff --cached --stat
```

Show the diff stat. Ask: *"Commit + push to `main`, or hold for a chore branch?"*

On approve:
```bash
git commit -m "$(cat <<'EOF'
docs(mockups): as-built sync for <feature>

Reconcile inputs/mockups/<file>.html with shipped implementation
in <route(s)>. Notes panel rewritten as as-built record. INDEX
row promoted to Final / updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

If the user opts for a chore branch instead:
```bash
git checkout -b chore/as-built-<feature-slug>
# commit, push, open PR
```

---

## Phase 7 — Final report

One short message. Format:

```
# /as-built — <feature>

Mockup: inputs/mockups/<file>.html
Implements: <route(s)>

Reconciled deltas:
- [ADDED] <one-liner>
- [CHANGED] <one-liner>
- [REMOVED] <one-liner>
...

INDEX.md: <bucket move | row updated | row added>
Commit: <sha> "<msg>"

Production-side issues flagged for follow-up (NOT fixed):
- <one-liner per issue>

The mockup now reflects shipped reality.
```

If no production-side issues were flagged, drop that section entirely.

---

## Hard rules

1. **One-way sync only — code → mockup.** Never edit a `.tsx` / `.css` / `.ts` file from inside this skill, no matter how tempting. Production-side issues get flagged in the final report, not fixed.
2. **Edit the mockup in place.** Do not spawn `-v2.html`, `-as-built.html`, `-final-final.html`. The single file IS the as-built record.
3. **Final mockups show production only.** No iteration cruft, no "Open questions", no Before/After diff panels, no REMOVED pills. The Notes panel stays but is rewritten as an as-built rationale.
4. **Match production exactly.** Copy hex values, copy strings, and class structures from the actual `.tsx` and `.css` files — do not reconstruct from memory or from CLAUDE.md's UI Tokens table (which itself can drift).
5. **Verify shipped status.** Abort if the implementing route hasn't landed on `main`. Drift can only be measured against shipped reality.
6. **Don't rename the file.** Filename stability preserves git blame for the iteration history. Bucket promotion in INDEX.md is the only "promotion" allowed.
7. **Don't run lint / typecheck / tests.** This skill changes only the mockup HTML and the INDEX. There is nothing to verify with code-quality gates.
8. **Ask before committing.** Default is direct-to-`main` for docs, but confirm — some sessions prefer chore branches.
9. **Match the user's language** in every text response (intro, punch-list, questions, final report).

---

## When to skip / abort

- The mockup file doesn't exist and no close match in `inputs/mockups/`.
- The implementing route is on a feature branch, not yet on `main`.
- The INDEX row marks the mockup `STALE — superseded by ...` and points to a *different* mockup file. The successor mockup is the canonical record; abort and tell the user to run `/as-built` against the successor instead.
- The user asks for "fresh mockup, different direction" — that's a new mockup, not an as-built sync. Hand off to `/design-engineer`.

In any of these cases, exit with one line explaining why and stop.

---

## Reference: where the rules come from

- `CLAUDE.md` → "Design Validation (mockup-first)" — the workflow this skill closes the loop on.
- `CLAUDE.md` → "UI Patterns" — the conventions the as-built mockup must reflect.
- `inputs/mockups/INDEX.md` — the discovery layer this skill keeps current.
- `inputs/mockups/_template.html` — the structural skeleton; final mockups should still resemble it (intro, card wrappers, Notes panel) even after the as-built sync.
