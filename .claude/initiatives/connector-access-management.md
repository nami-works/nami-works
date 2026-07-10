---
id: connector-access-management
name: Connector access management — roles, Google login, owner console
owner: cto
status: in-progress
priority: normal
created: 2026-07-02
target: null
current_phase: 6-console-ui
next_blocker: Roles gating + Google login BUILT, TESTED, DEPLOYED live, and merged to main (connector-20260702-google). Remaining: (1) port the validated owner-console mockup to a real owner-gated web UI (cto); (2) seed operator principals as Lucas invites people (needs names+emails); (3) propose-then-approve Omie gate (future). Lucas can test Google login now (his owner principal's email lucas@gebeauty.com.br will match).
next_owner: cto
stakeholders:
  - GE Beauty (owner: Lucas; operators onboarded later)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

Lucas wants an owner-only environment to manage who can access what across the
connector's tool surface, invite people, and have them log in with Google —
built on the per-user principals + roles shipped in [[connector-team-enablement]]
(PR #31). Governance + attribution + least-privilege for the GE team, his eyes only.

## Decisions locked (2026-07-02, via /challenge)

- **Scope = connector tool surface only.** Manage access to the 5 tool verticals
  (Shopify, Omie, Instagram, brand/voz, affiliates) surfaced through the connector.
  NOT the external systems' native user management (Shopify staff, Omie logins) —
  explicitly out of scope.
- **Model = named roles → tool bundles**, with a **read vs read+write split per
  system**. Owner defines/edits roles; assigns one to each person.
- **Console = owner-gated web console on the connector** (paste owner bearer /
  Google → session). Single source of truth (connector owns the principal data).
- **Login = Google, invited-emails-only (any domain).** Owner invites an email →
  person logs in with Google → verified email must match an invited principal.
  **Google is primary; the per-person/owner bearer stays as break-glass.**
- **Google OAuth credentials = Lucas provides a new Google Cloud OAuth client.**
  I build the code + mockups; wire live when he supplies id/secret + I register
  the redirect URI.

## Status

- [x] 1. Owner-console **mockup** built — `inputs/mockups/connector-roles-console-v1.html`
  (login + Pessoas + Convidar + Detalhe + Papéis + Auditoria + state matrices;
  GE brand, embedded Italian Plate + holo tile). Generator: `scratchpad/gen_roles_console.py`.
- [ ] 2. **Lucas validates the mockup** + answers the open questions — owner: lucas
- [ ] 3. Roles **data model** — `Role` (key/label/isSystem/isOwner + grants JSON per
  system: none|read|readwrite) + principal→role link + invite/Google fields
  (googleSub, status invited/active, invitedAt). Migration + seed default bundles.
  DEFERRED until phase 2 resolves the structural questions (see risk).
- [ ] 4. **Gating enforcement** — a central tool catalog (tool → {system, write}) +
  registry filters each tool by the principal's role grants (vertical + read/write).
  Coverage test. Extends the current owner/operator + requiredRole gate.
- [ ] 5. **Google login + invites** — OIDC integration (config-gated on
  GOOGLE_CLIENT_ID/SECRET, inert until provided); consent page gets an
  "Entrar com Google" button; invite = create principal status=invited.
- [ ] 6. **Owner console UI** (production) — port the validated mockup to a
  connector-served owner-gated route. Only after phase 2 sign-off.
- [ ] 7. Deploy + onboard operators (needs names/emails).

## Resolved (2026-07-02, all via AskUserQuestion)

1. **Shopify SPLIT into sub-areas** — first-class systems: Pedidos/fulfillment,
   Produtos & preços, Descontos & campanhas, Clientes, Relatórios/análises. Plus
   Omie, Instagram, Voz da marca, Afiliados = **9 systems** in the access matrix.
2. **Editable/custom roles** (console role-editor), not a fixed set.
3. **Multiple stackable roles per person** ⇒ many-to-many (principal↔role);
   access = union of the person's roles' grants.
4. Keep **both** `desativar` (reversible) and `remover` (delete).
5. **Immediate** revocation — connector re-resolves the principal live each
   request, so disable blocks the next call mid-session.
6. **Any-domain** invites (external collaborators OK; invited-email allowlist).
7. **Seed roles (4, editable): Admin (owner/protected), Operações/Logística,
   Financeiro, Marketing.** Starting bundles (Lucas tweaks in console):
   - Admin — all systems R/W + admin tools.
   - Operações/Logística — Pedidos R/W, Clientes R, Omie R, Relatórios R.
   - Financeiro — Omie R/W, Relatórios R, Pedidos R, Descontos R.
   - Marketing — Descontos R/W, Produtos & preços R/W, Voz R/W, Instagram R/W,
     Afiliados R/W, Relatórios R.

## Notes

- 2026-07-02 (FIRST OPERATORS ONBOARDED + role-scoping verified live) — invited 3
  principals with roles: financeiro@gebeauty.com.br (Financeiro),
  raphael.martins@gebeauty.com.br (Operações/Logística), eleonora.stefani@gebeauty.com.br
  (Marketing). All status=active, googleSub=pending (binds on first Google login).
  **Verified end-to-end**: operator token for Raphael returns 37 of the owner's 73
  tools (only omie R + shopify orders/customers/reports + nami_feedback; no
  products/discounts/instagram/brand/loox) — role gating is correct & live. No
  invite CLI/console yet (provisioned via a one-off prisma script). Caveat: Google
  login needs each email to be a real Google account; financeiro@ may be a shared
  mailbox (swap to a personal email if login fails). Revoke = set principal
  status/remove assignment (re-resolved live each request).

- 2026-07-02 (connect-polish SHIPPED) — post-connect fixes from Lucas's live test,
  deployed as `connector-20260702-inter` (PRs #35 + #36): holo PNG now served at
  `/favicon.ico` (claude.ai reads the connector tile from the favicon, not the PNG
  serverInfo icon); Google four-color "G" chip on the "Entrar com Google" button;
  "Usar chave de acesso" bearer block removed from the consent page (break-glass
  POST handler kept); Inter variable webfont embedded so Windows/Android render
  Inter while Apple keeps SF. Tool grouping (fix a) resolved as NOT server-doable:
  claude.ai shows one connector's tools as a flat "Other tools" list, MCP has no
  group field (SEP-993 namespaces not in spec) — decision: leave flat + rely on
  `system_action` name prefixes; per-vertical connector split deferred.
- 2026-07-02 (Google login SHIPPED) — `oauth/google.ts` (start+callback, full
  id_token verification via Google JWKS + audience/issuer/nonce/email_verified),
  signed google-state carrying MCP params, consent page now leads with "Entrar
  com Google" (bearer → break-glass `<details>`). Schema: googleSub + invitedAt +
  nullable bearer + unique (tenantId, contactEmail). Invited-emails-only: verified
  email must match an active principal; googleSub bound on first login. Deployed
  `connector-20260702-google`, migration applied, merged main (PR #33). Google
  client `ge-beauty-mcp-oauth`, creds in box env. Lucas's owner principal email is
  lucas@gebeauty.com.br → Google login with that account works immediately. Merge
  permission added to settings.local.json (autoMode.allow) so `gh pr merge` works.
- 2026-07-02 (gating SHIPPED) — Full roles backend built + tested + deployed live
  (`connector-20260702-roles`): `access.ts` (effective access = union of role
  grants; canUseTool: owner→all, write needs readwrite, alwaysAvailable→all,
  catalog-miss fails closed) → tenant-auth loads roles into TenantContext →
  registry gates every tool via `tool-catalog.ts`. 145 tests pass. Migration
  applied + 4 roles seeded on the box (admin/operacoes/financeiro/marketing).
  Coarse `role=owner` still = owner (Lucas unaffected; inert until operators get
  roles). Consent page (holo + Apple font) also live. All on PR #32 —
  **needs Lucas to merge** (auto-merge classifier-blocked). Also: shortcut-nudge
  org instruction drafted at `docs/claude-org-shortcut-nudge.md` (claude.ai
  Teams/Enterprise; depends on porting Claude Code skills → claude.ai Skills first).
- 2026-07-02 (build progress) — Model fully locked + validated. Committed on
  `feat/connector-consent-and-roles` (PR #32): roles data model (AccessRole +
  many-to-many PrincipalRoleAssignment + ConnectorSystem/AccessLevel enums) +
  migration + `tool-catalog.ts` (87 tools classified → {system, write}; 12 writes).
  Console mockup refreshed to the locked model (Apple font, 4 roles, 9-system
  matrix, multi-role union). Two final design Qs resolved: **co-admins allowed**
  (Admin grantable to >1 person, console warns); **Relatórios keeps R/W toggle**
  (uniform UI; harmless — no report tool writes). Typography direction: Apple/system
  font EVERYWHERE (consent page done; broader Omnify/public-site re-font = separate
  follow-up). NEXT: gating enforcement (tenant-auth effective-access = union of a
  principal's role grants; registry filters each tool via tool-catalog) + tests,
  then Google/invite (needs creds), then console prod UI (after visual validation),
  then deploy (Docker). Catalog uncertains to sanity-check later: issue_store_credit
  (→customers vs discounts), apply_price_tag (→products vs discounts),
  replace_files_from_drive_folder (→products), product_sales_rank (→products vs reports).
- 2026-07-02 — Deliberately DEFERRED the backend (phases 3-5) until Lucas validates
  the mockup: open questions #1 (Shopify split) and #3 (one vs many roles) change
  the schema/taxonomy, so building enforcement first risks rework. Mockup-first
  discipline (his own ask: "build the mockup for me to validate"). The
  model-agnostic parts (consent page) shipped; the rest has a ready plan above.
- 2026-07-02 — Branded **consent page** (unrelated but adjacent) shipped as **PR #32**
  (holo v2, PT-BR, zero NAMI Works). Deploy pending Docker. This also produced the
  reusable "Entrar com Google" login card style (in the console mockup) for phase 5.

## Done means

- Owner opens the console (Google login), sees everyone + their access, invites a
  person by email, assigns a role, and that person logs in with Google and can only
  use the tools their role grants (read vs write enforced) — with an audit trail.
- Revoking a person cuts their access per the chosen policy.
