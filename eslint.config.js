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
    files: ["**/lambda/**/*.mjs", "**/lambda/**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        Buffer: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
      },
    },
  },
  {
    // Each app's own production server entrypoint (apps/*/server.mjs) --
    // plain Node.js, run directly by `node server.mjs`, not bundled. Same
    // gap as the lambda pattern above; added 2026-08-13 when sales-whatsapp's
    // server.mjs hit this at the changed-lines pre-commit gate. Every
    // existing apps/*/server.mjs (e.g. omnify-admin's) would hit the same
    // gate the next time it's touched -- this isn't new-app-specific.
    files: ["apps/*/server.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    // Static browser-served JS (no bundler, served as-is by fastify-static)
    // -- needs DOM globals the base config above doesn't provide.
    files: ["**/public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        alert: "readonly",
        console: "readonly",
      },
    },
  },
];
