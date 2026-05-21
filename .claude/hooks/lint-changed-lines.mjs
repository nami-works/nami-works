#!/usr/bin/env node
//
// lint-changed-lines.mjs — runs ESLint on the given files but reports only
// errors on lines that were actually added in the staged commit. Pre-existing
// baseline errors on untouched lines are not gated.
//
// This is what the pre-commit hook's contract claims: "the gate enforces
// that NEW code is clean while the pre-existing debt gets cleaned up
// deliberately, not as a side effect of every commit." Calling `eslint <files>`
// directly does not honor that — it lints whole files. This helper does.
//
// Usage:
//   node lint-changed-lines.mjs <file1> [file2] ...
//
// Exit codes:
//   0 — no errors on changed lines
//   1 — at least one error on a changed line (commit blocked)
//   2 — usage / runtime error
//
// Diff source: `git diff HEAD --unified=0 -- <file>`. This covers both staged
// and unstaged tracked changes against HEAD. The hook upstream already
// filters to files that will be in the commit, so this matches "what's
// actually changing in this commit".

import { execFileSync } from "node:child_process";
import { ESLint } from "eslint";

const files = process.argv.slice(2);
if (files.length === 0) process.exit(0);

function addedLineSetForFile(file) {
  let diff = "";
  try {
    diff = execFileSync(
      "git",
      ["diff", "HEAD", "--unified=0", "--no-color", "--", file],
      { encoding: "utf8" },
    );
  } catch {
    return null; // file unknown to git or no HEAD — fall back to full lint
  }
  const added = new Set();
  for (const line of diff.split(/\r?\n/)) {
    // Hunk header: `@@ -a,b +c,d @@` — c..(c+d-1) are the added/changed lines
    // in the new file. When d is omitted it defaults to 1.
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const count = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    if (count === 0) continue; // pure deletion hunk
    for (let i = 0; i < count; i += 1) added.add(start + i);
  }
  return added;
}

const eslint = new ESLint();
const results = await eslint.lintFiles(files);

const filtered = [];
let totalErrors = 0;

for (const result of results) {
  const added = addedLineSetForFile(result.filePath);
  // If we couldn't read the diff (untracked / no HEAD), keep all messages —
  // safer to over-report than miss real errors on a brand-new file.
  const messages = added === null
    ? result.messages
    : result.messages.filter((msg) => added.has(msg.line));
  if (messages.length === 0) continue;

  const errorCount = messages.filter((m) => m.severity === 2).length;
  const warningCount = messages.filter((m) => m.severity === 1).length;
  totalErrors += errorCount;

  filtered.push({
    ...result,
    messages,
    errorCount,
    warningCount,
    fixableErrorCount: messages.filter((m) => m.severity === 2 && m.fix).length,
    fixableWarningCount: messages.filter((m) => m.severity === 1 && m.fix).length,
  });
}

if (filtered.length === 0) {
  process.exit(0);
}

const formatter = await eslint.loadFormatter("stylish");
const output = await formatter.format(filtered);
process.stderr.write(output);
process.stderr.write(
  `\n  Reported only errors on lines added/modified in this commit. ` +
    `Pre-existing backlog on unchanged lines is not gated.\n`,
);

process.exit(totalErrors > 0 ? 1 : 0);
