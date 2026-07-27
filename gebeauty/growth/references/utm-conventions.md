# GE Beauty — UTM / link-tagging conventions (Nemu-aligned)

The standing playbook for building **any** tracked link that lands on the store. Source of
truth for how paid, organic, influencer, and affiliate links must be tagged so Nemu (the
measurement cockpit — see `knowledge.md` › Measurement stack) attributes them correctly.

Distilled from Nemu's onboarding docs (`https://docs.nemu.com.br/pages/onboarding/configuracao-utms`,
read 2026-07-27) and applied to GE's channels. `/growth-office`, `/growth-hacker`, and
`/crm-director` should consult this before publishing a link with tracking on it.

---

## How Nemu reads a link (the mental model)

Nemu attributes each order from the URL params on the click that led to it, with a **priority**:

1. **`nemu_*` params win.** `nemu_source`, `nemu_campaign`, `nemu_adset`, `nemu_content`,
   `nemu_term` are Nemu's own fields, used exclusively for campaign/adset/ad performance.
   When present they drive attribution.
2. **`utm_*` is the fallback.** If no `nemu_*` params are on the URL, Nemu falls back to the
   standard UTMs (`utm_source`/`utm_medium`/`utm_campaign`/`utm_content`/`utm_term`).

Practical consequence: paid channels should carry **both** (Nemu template + UTMs, so GA4/Shopify
also see clean UTMs); organic/influencer links carry **UTMs only** (Nemu falls back to them).

Standard UTM roles (Nemu's own table):

| Param | Role |
|---|---|
| `utm_source` | where the traffic comes from (google, facebook, instagram, …) |
| `utm_medium` | **type** of traffic — `cpc` = paid, `organic` = unpaid. This is the load-bearing paid/organic flag. |
| `utm_campaign` | the specific campaign |
| `utm_term` | keyword (paid search) / ad-set slot in Nemu's Meta template |
| `utm_content` | differentiates ads/links pointing at the same URL |

---

## The golden rules

1. **`utm_medium` is the paid/organic switch.** Paid = `cpc`. Organic = `organic`. Never let a
   paid tag ride an organic link or vice-versa — that is the #1 misattribution cause (see the
   case study below).
2. **The pipe `|` is Nemu's `name|id` separator, not junk.** Nemu's paid templates encode
   `{{campaign.name}}|{{campaign.id}}` etc. so a human-readable name and its stable id travel
   together. `|` is *expected* in paid URLs.
3. **Never put a `|` (or other special chars) *inside* a campaign/ad-set/ad NAME** in Ads
   Manager. A `|` inside the name breaks Nemu's `name|id` split. (This is the one thing Nemu's
   docs explicitly warn against: *"Evite caracteres especiais (ex.: `|`) nos nomes das campanhas."*)
4. **Never build a link by copy-pasting a destination URL out of Meta/Google Ads Manager.** That
   field renders the dynamic macros already substituted (real campaign id, ad-set name, etc.).
   Reusing it anywhere else (a bio link, a WhatsApp blast, an email) stamps that traffic as if it
   were a paid ad click. Always start from the clean storefront URL and add the right template.
5. **Paid links carry `nemu_*` + `utm_*`; organic/influencer links carry `utm_*` only.**
6. **No spaces in influencer names / campaign slugs — use underscores.**

---

## Per-channel templates (verbatim from Nemu, annotated for GE)

### Meta Ads (Facebook / Instagram) — paid
Set once as the account/campaign **URL tracking template**. `{{…}}` macros auto-populate.

```
utm_source=facebook&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium=cpc&utm_content={{ad.name}}|{{ad.id}}&utm_term={{adset.name}}|{{adset.id}}&nemu_source=facebook&nemu_campaign={{campaign.name}}|{{campaign.id}}&nemu_adset={{adset.name}}|{{adset.id}}&nemu_content={{ad.name}}|{{ad.id}}
```

If UTMs already exist upstream, only append the Nemu half:
```
&nemu_source=facebook&nemu_campaign={{campaign.name}}|{{campaign.id}}&nemu_adset={{adset.name}}|{{adset.id}}&nemu_content={{ad.name}}|{{ad.id}}
```

> Note: this template is *why* GE's paid Meta orders legitimately carry `utm_term=<adset name>|<adset id>`
> and a campaign id. That signature is correct **on a paid click**. It is wrong anywhere else.

### Google Ads — paid
Final-URL suffix / tracking template (ValueTrack macros auto-populate). Keep auto-tagging on.
```
{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}_{adgroupid}_{assetgroupid}&utm_content={creative}&utm_term={keyword}&nemu_source=google&nemu_campaign={campaignid}&nemu_adset={adgroupid}_{assetgroupid}&nemu_content={creative}&nemu_term={keyword}
```
(Google templates use `_` to join ids — no pipes.)

### Organic — Instagram bio link, Stories, feed, WhatsApp, TikTok, etc.
`utm_medium` is **always `organic`**. UTMs only, no `nemu_*`, **no paid macros**.
```
https://ge-beauty.com.br/?utm_source=instagram&utm_medium=organic&utm_campaign=<post_ou_slot>
```
Nemu's own examples:
```
?utm_source=instagram&utm_medium=organic&utm_campaign=story_promocao
?utm_source=instagram&utm_medium=organic&utm_campaign=feed_produto
?utm_source=whatsapp&utm_medium=organic&utm_campaign=vendas_equipe
?utm_source=tiktok&utm_medium=organic&utm_campaign=video_tutorial
```
Add `utm_content=<slug>` when one channel has several destinations (e.g. multiple bio-link buttons).

### Influencer
`utm_source=influencer`, medium = the creator's handle, campaign = the push. No spaces (underscores).
```
?utm_source=influencer&utm_medium=joao_silva&utm_campaign=promo_black_friday&utm_content=video
```
(Coupon-based influencer sales are attributed separately in Nemu by code — the ~30 GE affiliate
`{NAME}10` codes — so link-tagging and coupon-tagging are two independent attribution paths.)

---

## Case study — order #89360 UTM contamination (2026-07-27, growth_watchdog)

**What was seen:** an order carrying `utm_source=instagram` + `utm_medium=link-na-bio` (organic)
**together with** `utm_id=120232457907840228` (a real ACTIVE Meta campaign — "[CS] [REGULAR]
[CONVERSAO] [ABO] [MISTO]") and `utm_term=[TOPO] [LOOKALIKE 3% - PURCHASE 180D] [M] [20-55]|120232457908390228`
(a real ACTIVE ad set). Duplicated `utm_utm_*` fields on the same order.

**Root cause (corrected with Nemu's docs):** the Instagram bio-link entry for `linklist_26092025`
was built by pasting a **paid Meta destination URL** — one that correctly carried Nemu's paid Meta
template (`{{adset.name}}|{{adset.id}}`, campaign id) with the macros already rendered — and using
it as the **organic** bio link. So every organic bio-link click got stamped as a paid Meta ad
click. The `|` and the ids are not garbage; they are Nemu's prescribed *paid* signature, sitting on
the wrong (organic) surface. Violates golden rules #1 and #4.

**The fix (replace the `linklist_26092025` bio-link destination with):**
```
https://ge-beauty.com.br/?utm_source=instagram&utm_medium=organic&utm_campaign=linklist_26092025
```
- `utm_medium` → `organic` (was `link-na-bio` — a non-standard medium Nemu doesn't recognize as
  organic; standardize to `organic`).
- **Drop `utm_id`, `utm_term`, and every `nemu_*`/adset/ad macro.** Organic links carry none.
- Optional `utm_content=<button_slug>` if the bio tool has multiple buttons.

This was a **manual fix in the bio-link tool** (Linktree-equivalent) — no connected tool reaches it.
**Done by Lucas 2026-07-27**; new organic bio-link clicks from that entry should no longer carry paid
Meta markers. (Verify later: post-fix orders tagged `utm_medium=link-na-bio`/`organic` should stop
co-occurring with `utm_id`/`utm_term`.)

**Still pending (measurement):** the true contaminated-order count is unknown. The raw scan produced
inflated OR'd figures; the real signature is **co-occurrence** on one order of organic bio-link
markers (`utm_source=instagram` + bio medium) **and** paid Meta markers (`utm_id`/`utm_term` present).
Re-scan Shopify orders (2025-07-28 → now) for that co-occurrence to size revenue exposure. Do not
quote the old 68 / 1,183 / 3,544 / 4,795-order numbers as final.

---

## GE reconciliation checklist (open)

- [x] Fix the live `linklist_26092025` bio-link (above). **Fixed by Lucas 2026-07-27** — leak stopped.
- [ ] Audit every other bio-link / Linktree button for pasted-paid-URL contamination; standardize all
      to `utm_medium=organic`.
- [ ] Run the co-occurrence scan to size the misattribution.
- [ ] Confirm GE's paid Meta + Google accounts actually carry the Nemu templates above (so paid
      attribution is complete, not just organic hygiene).
- [ ] Decide whether `link-na-bio` should be retired as a medium in favor of Nemu's `organic`.
