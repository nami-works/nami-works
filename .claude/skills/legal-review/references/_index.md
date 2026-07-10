# Legal-review — playbook index + operating loop

GE Beauty's AI-first contract review. One **playbook per contract type** is the unit of
memory: it loads before an analysis and is updated after, so context compounds across
contracts instead of starting cold each time.

## The loop (run this for every contract)

1. **Identify the type** from the table below (confirm with Lucas if ambiguous).
2. **Read that type's playbook first** — checklist + locked lessons + prior deals.
3. **Ground in the live document** (read the actual contract, never assume clause text).
4. **Run the review**, produce the memo (summary, key terms, red flags, recommendation).
5. **Update state:**
   - Add/refresh a per-deal record in `sandbox/gebeauty/legal/deals/` (one per contract — Lucas wants a record for every contract).
   - Add the deal to the playbook's "Deals seen" log.
   - Append any *new* reusable rule to the playbook's "Locked lessons."
   - If the deal is in flight, add/refresh `sandbox/gebeauty/legal/pending.md`.

Escalation to an outside lawyer is **Lucas's manual call** — no auto-tiering. Flag what a
lawyer should see; he decides.

## Type taxonomy

| Type | Playbook | Covers | Seeded |
|---|---|---|---|
| Receivables financing | `receivables-financing.md` | antecipação / desconto de duplicatas, cessão de crédito (FIDC, factoring), with/without recourse | ✅ Ghia |
| Lending / mútuo | `lending.md` | loans GE takes/gives — mútuo, CCB, intercompany (BLOG↔GE), bank lines | ✅ BLOG R$450k |
| Real estate | `real-estate.md` | locação / sublocação comercial, coworking (Regus/IWG), mall kiosks, storage/depósitos | ✅ Regus |
| Vendor / SaaS | `vendor-saas.md` | tool subscriptions, order forms, ToS/MSA, DPA | ✅ Gorgias |
| B2B / channel | `b2b-channel.md` | distribution, retail-channel, marketplace, consignação | ⬜ on first contract |
| Employment / contractor | `employment-contractor.md` | CLT, PJ, NDA, image rights, distrato | ⬜ on first contract |
| IP / trademark / fiscal | `ip-trademark-fiscal.md` | brand/trademark (INPI), IP assignment, tax-sensitive clauses | ⬜ on first contract |

Unseeded playbooks are created the first time a contract of that type arrives — no empty stubs.

## Where state lives

- **Playbooks (the brain):** here, with the skill (version-controlled).
- **Per-deal records:** `sandbox/gebeauty/legal/deals/<YYYY-MM>_<slug>.md`.
- **In-flight items:** `sandbox/gebeauty/legal/pending.md`.
- **Session memory pointer:** `project_gebeauty_legal_review.md` (auto-loads via MEMORY.md so a fresh session knows to come read these).
- **Source contracts:** stay in Google Drive where the team keeps them.
