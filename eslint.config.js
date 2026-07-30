// Root flat config — minimal bootstrap so the Claude-Code pre-commit hook
// (.claude/hooks/lint-changed-lines.mjs) can lint files in any workspace
// from the repo root.
//
// Uses typescript-eslint's flat presets directly. Mirrors the key
// "@typescript-eslint/no-explicit-any" gate enforced by
// apps/omnify-admin/.eslintrc.cjs so changed-lines lint at root produces
// the same verdict for the rule that matters most for the existing
// lint-backlog policy (no new `any` on changed lines).
//
// Replace this with a full flat-config migration when the legacy
// .eslintrc.cjs files come off.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.react-router/**",
      "**/.cache/**",
      "**/coverage/**",
      "**/public/build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { shopify: "readonly" },
    },
    rules: {
      // Match the rules apps/omnify-admin/.eslintrc.cjs already enforces.
      // Pre-existing violations on unchanged lines are excluded by the
      // changed-lines hook; only NEW violations gate the commit.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
  {
    // Node.js Lambda function source (AWS Lambda runtime, not a browser/bundler
    // context) -- needs Node globals the base config above doesn't provide.
    files: ["infra/**/lambda/**/*.mjs", "infra/**/lambda/**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        Buffer: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
      },
    },
  },
];
