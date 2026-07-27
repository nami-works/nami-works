# Learning log — reactivation campaign

The append-only signal store that turns each send into training data for the eventual
automated campaign. **One line per customer per send** in `sends.jsonl`, features frozen
at send time, outcomes filled in later. Lives in the gitignored sandbox (PII stays local).

## Files
| File | Role |
|---|---|
| `sends.jsonl` | append-only; 1 record per (customer × send), SEND **and** HOLD | 
| `readout-<date>.md` | per-band SEND-vs-HOLD lift, written by `measure_reactivation.py` |

Producers: `../snapshot_send.py` writes `sends.jsonl`; `../measure_reactivation.py` writes readouts.

## Per-customer record schema (`sends.jsonl`)
Captured **at send** (frozen — never recomputed):

- **Keys:** `customer_gid`, `email`, `first_name`, `phone`
- **Assignment:** `campaign`, `wave`, `sent_at`, `arm` (SEND|HOLD), `channel`, `touch`
- **Recency:** `recency_days`, `recency_band` (60-90 / 91-120 / 121-180 / 181-270 / 271-365 / 366+), `last_order_date`
- **Frequency:** `order_count`, `is_repeat`, `has_repeat_product`
- **Monetary:** `lifetime_spend`, `avg_order_value`, `last_order_subtotal`
- **Tenure/breadth:** `first_order_date`, `tenure_days`, `distinct_products`, `products_owned[]`
- **Product context:** `anchor_product`, `primary_category`
- **Offer:** `credit_amount` (0 for HOLD), `credit_pct`, `capped_at_ceiling`, `expires_at`, `expiry_days`

Filled **later** by `measure_reactivation.py` (or left as the aggregate readout):
- `reactivated`, `redeemed`, `days_to_order`, `order_value`

## Why HOLD is logged too
Incremental lift is a **cohort** metric, not per-customer. HOLD rows carry the same frozen
features with `credit_amount=0` so the readout can compute, per band, SEND reactivation rate
minus HOLD rate = the causal signal. Never drop the HOLD rows.

## The loop
```
snapshot_send.py   → freezes signal (sends.jsonl)   [send day, once]
issue_reactivation.py --apply → issues SEND credit  [send day]
   … wait …
measure_reactivation.py → readout-<date>.md         [+3d, +7d/expiry]
   → best band × credit × channel feeds the next wave / the auto-campaign
```

Each wave appends to the same `sends.jsonl`, so across waves it becomes a labelled dataset
(features → reactivated/redeemed/value) — the training set for an automated targeting rule.

## Engagement fields (best-effort)
Email opens: not available (transactional + Apple MPP). Email clicks: session-level via UTM in
GA4, not cleanly per-customer. WhatsApp (touch 2, Zoko): delivered/read/clicked per-recipient —
backfill into the log from the Zoko API when the WhatsApp reminder runs.
