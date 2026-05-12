/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client"],

  // Base config
  extends: ["eslint:recommended"],

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],
      },
    },

    // Polaris-first guards — Phase D of the multi-skill audit. Catches the
    // most common ways non-Polaris-native UI sneaks into production.
    // Scoped to app/routes/**/*.tsx because components/ legitimately uses
    // lower-level primitives. Kept at "warn" — a full sweep on 2026-05-12
    // surfaced ~80 existing violations across the route files (many are
    // legitimate native buttons with structured content that can't render
    // inside <s-button>). Promotion to "error" is deferred until a separate
    // cleanup PR migrates the genuine swaps and adds eslint-disable-next-line
    // justifications on the rest.
    {
      files: ["app/routes/**/*.{tsx,jsx}"],
      rules: {
        "no-restricted-syntax": [
          "warn",
          {
            // Catches raw <button> elements where <s-button> is the
            // canonical Polaris primitive. Many existing route files
            // already use <s-button>; this guards against new regressions
            // (the case Lucas flagged 2026-05-10: custom "link-style"
            // button when <s-link> was the right element).
            selector: "JSXOpeningElement[name.name='button']",
            message:
              "Use <s-button> (Polaris) instead of <button>. If a genuine native button is required (e.g. tab strip inside <PageTabs>), suppress with /* eslint-disable-next-line no-restricted-syntax */ and justify in the comment.",
          },
          {
            // Catches raw <a href=...> in route files. <Link to> is the
            // working React Router primitive inside the embedded Shopify
            // iframe (per CLAUDE.md feedback memory: <a href> + <s-link>
            // both 404 in Outlet child routes); <s-link> is acceptable
            // for non-Outlet flat routes.
            selector:
              "JSXOpeningElement[name.name='a'] > JSXAttribute[name.name='href']",
            message:
              "Use <Link to=...> (react-router) or <s-link href=...> (Polaris) instead of raw <a href>. Plain anchors trigger full reloads inside the embedded Shopify iframe.",
          },
        ],
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
      rules: {
        // Wall: admin (this app/) must never import from the public site (site/).
        // Marketing/admin live in the same repo for context but ship as
        // independent runtimes. See CLAUDE.md "Public Site (cpg-labs.io)".
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["../site/*", "../../site/*", "../../../site/*", "site/*"],
                message:
                  "Admin code (app/) cannot import from site/. The public site is a separate runtime; share via packages/ or duplicate.",
              },
            ],
          },
        ],
      },
    },

    // Node
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
      ],
      env: {
        node: true,
      },
    },
  ],
  globals: {
    shopify: "readonly"
  },
};
