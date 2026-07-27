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

## Case study — order #89360 "UTM contamination" (2026-07-27) → FALSE POSITIVE

**VERDICT (2026-07-27, after a full 12-month per-visit scan): FALSE POSITIVE. There was no bio-link
contamination.** The watchdog misread a normal multi-touch journey as a single leaked URL.

**What the watchdog saw:** order #89360 had paid Meta UTMs *and* organic bio-link UTMs associated with
it, and read that as one doubled/leaked URL with `utm_id`/`utm_term` bleeding onto the bio link.

**What the data actually shows (Shopify customer-journey, parsed per visit):** #89360 is a 4-visit
journey where *each visit is correctly tagged on its own* — three paid Meta clicks
(`medium=cpc`, `campaign=…|<id>`, `term=…|<adsetid>`) plus one **clean** organic bio-link click
(`source=instagram, medium=link-na-bio, campaign=linklist_26092025, content=null, term=null`). The
paid markers and the organic markers live on *different visits*, not the same URL. That is ordinary
multi-touch attribution, not contamination.

**The scan (2025-07-28 → 2026-07-27, `scratchpad/utm_scan.py`, per-visit logic):**
- 46,915 orders scanned; 19,888 with journey data.
- **2,634** orders had an organic bio-link touch (R$568k); **1,349** of those *also* had a paid Meta
  touch (R$289k) — i.e. multi-touch. This overlap is what the watchdog inflated into "contamination".
- **0** orders — before *or* after the fix — where a single organic bio-link visit carried a paid
  `utm_term`, a Meta ad-id in `utm_content`, or a Meta campaign-id in `utm_campaign`. The bio-link URL
  was clean the whole time.

**On the "fix":** Lucas standardized the `linklist_26092025` bio link on 2026-07-27. Nothing was
leaking, so it corrected no misattribution — but moving `link-na-bio` → `organic` still aligns with
Nemu's organic convention, so it is a harmless (mildly positive) hygiene change, not a wasted one.

**The REAL finding the scan surfaced — medium sprawl on Instagram traffic (open hygiene debt).**
Instagram-source visits use a chaotic mix of `utm_medium` values: influencer names as mediums
(`Beta W`, `Myra Ruiz`, `fiorella mattheis`, `Jordanna`…), inconsistent casing (`STORIES`, `reels`,
`reels-de-teste`), and paid-ish labels (`paid`, `paid_social`, `cco`, `geb`) alongside the dominant
clean `link-na-bio` (6,237). *This* is what actually muddies organic-vs-influencer-vs-paid attribution
in Nemu — not a leak, but a taxonomy problem. Fixing it means enforcing the per-channel templates above
at the source (bio-link tool, influencer link builder, Stories/Reels swipe-ups).

---

## GE reconciliation checklist

- [x] ~~Fix the live `linklist_26092025` bio-link~~ — **no leak existed** (12-mo scan = 0 contaminated).
      Lucas standardized it to `utm_medium=organic` anyway on 2026-07-27; fine to keep.
- [x] Run the co-occurrence scan — **DONE 2026-07-27, 0 contaminated orders across 46,915.** Case closed.
- [ ] **Real work → fix Instagram `utm_medium` sprawl.** Standardize organic = `organic` (or a single
      agreed `link-na-bio`), influencer = `influencer` + creator handle in the template. Enforce at the
      link-builder source, not per-post.
- [ ] Confirm GE's paid Meta + Google accounts actually carry the Nemu templates above (paid-side
      completeness — separate from the organic-hygiene item).
