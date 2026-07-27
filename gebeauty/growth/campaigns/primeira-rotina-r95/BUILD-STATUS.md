# Meta build status — primeira-rotina-r95

**Date:** 2026-07-25 · **Account:** GE_Beauty `606199920079315` (BRL) · **Builder:** /growth-hacker
**Authorization:** Lucas confirmed R$95 checkout passing + authorized the PAUSED build (zero spend).

## STATUS: BUILT — FULL Group A hook test, ALL PAUSED, zero spend.

Nothing is ACTIVE. Every campaign/ad-set/ad was created PAUSED. Campaign is ABO with no campaign
budget; each ad set carries R$30/day but cannot spend while paused. Launch is one status flip per
object, Lucas's call only.

### Campaign
- `120250791335430228` — `primeira-rotina-r95 | TESTE | ABO` — OUTCOME_SALES, AUCTION, ABO, PAUSED.

### 10 ad sets (Group A) + their ads — all PAUSED
Each ad set: ABO **R$30/day**, optimization **OFFSITE_CONVERSIONS → ADD_TO_CART** (pixel `958727274605304`),
destination WEBSITE, targeting **BR + Advantage+ Audience (broad)**, **marketing_goal NEW_CUSTOMER_ACQUISITION**,
placements **Facebook Feed + Instagram Feed** (4:5-native on both, no auto-crop into Stories/Reels). Each ad:
single-image 4:5, page `106114707866572`, CTA SHOP_NOW, coupon-baked destination + per-hook UTMs, and the
**final copy (v3)**: pays only for the shampoo R$95; máscara + 3rd item + frete por nossa conta; "válido apenas
para quem nunca comprou na marca"; no "lavagem"; final descriptions + #2 headline "pague só pelo shampoo, leve
os três". Ad IDs below are the **v3 (final)** ads; the v1 and v2 ads were deleted after replacement.

| Hook | Ad set ID | Ad ID (v3, live copy) |
|---|---|---|
| rotina | 120250791657440228 | 120250792314970228 |
| presente | 120250791660730228 | 120250792342450228 |
| loyalty | 120250791661180228 | 120250792345390228 |
| ritual-menos100 | 120250791661690228 | 120250792352530228 |
| completo-menos100 | 120250791662490228 | 120250792356580228 |
| experiencia-menos100 | 120250791662950228 | 120250792358240228 |
| capilar-menos100 | 120250791663500228 | 120250792361790228 |
| completo-95 | 120250791664360228 | 120250792363960228 |
| experiencia-95 | 120250791665010228 | 120250792367780228 |
| capilar-95 | 120250791665550228 | 120250792371930228 |

Deleted (superseded): v1 ads 120250791659650228/…668880228/…669510228/…670030228/…670950228/…671570228/
…671820228/…672190228/…673180228/…673920228; v2 ads 120250792115790228/…118770228/…121670228/…124820228/
…127680228/…128870228/…131060228/…134570228/…136090228/…137690228.

Total daily budget if launched: **R$300/day** (10 × R$30). 7-day wave ≈ R$2,100.

### Creatives hosting
The 10 4:5 PNGs were hosted on Shopify Files (public cdn.shopify.com URLs) and passed to Meta via the
ad creative's top-level `image_url` (the `ads_creative_upload_image` tool is not yet rolled out for this
account — see below). Transient Shopify file IDs (delete after Meta finishes ingesting, if desired):
`gid://shopify/MediaImage/4403452{7527232,7756608,7854912,8051520,8280896,8706880,8969024,9034560,9558848,9657152}`.

### Destination URL (verified pattern, coupon baked in)
`https://www.gebeauty.com.br/discount/PRIMEIRA-ROTINA_DO7HTHDO5C?redirect=%2Fpages%2Flp-n4ga7384b3y3%3Futm_source%3Dmeta%26utm_medium%3Dpaid%26utm_campaign%3Dprimeira-rotina-r95%26utm_content%3D<slug>%26utm_term%3Dadvantage-broad`
302 → applies the code → 200 on the LP with UTMs intact (verified live earlier this session).

## Notes / genuine API limitations encountered
- **`ads_creative_upload_image` is NOT rolled out** for account `606199920079315` (real API error:
  "This tool is new and is being gradually rolled out across ad accounts"). Worked around by passing the
  public CDN `image_url` at the ad creative's top level — accepted, all 10 ads created cleanly.
- **`ads_get_ig_accounts` AND `ads_get_ig_media` are NOT rolled out** for this account, and
  `ads_get_creatives` does not expose `instagram_actor_id`/`instagram_user_id`/`object_story_spec`
  (rejected: "Unsupported field(s)") — so the IG business-account ID could NOT be read via any enabled
  tool. **IG delivery was still added**: the 10 ad sets now target **Facebook Feed + Instagram Feed**
  (updated via `ads_update_entity`), and IG uses the page-linked IG account of page `106114707866572`
  automatically — confirmed viable because GE's existing live ads on that same page carry
  `effective_instagram_media_id` (they deliver on IG). Explicit `instagram_user_id` on the creative was
  not settable (unreadable ID + creatives immutable), but is not required for IG delivery here.
- **4-ratio placement asset customization** genuinely not in the MCP (`ads_create_creative` has no
  `asset_feed_spec`). Per the resolved plan we used the 4:5 as the single feed-native creative and pinned
  FB feed placement to respect the crop rule. 9:16 Reels/Stories = a second-ad or scale-phase refinement,
  not blocking (assets already exist at `creatives/meta/9x16_*`).

## Group B (audience probe) — NOT built (optional, deferred)
The 2 interest-set ad sets are optional per the build spec ("build if clean"). They require real interest
IDs via `ads_targeting_search`; deferred to keep the core hook test clean. Add later if desired (control
hook = rotina, R$20/day each).

## v4 copy (length fix) + ad preview URLs — 2026-07-25
v4 ads (final copy) replaced v3. Shared primary on all 10, shared description "o resto é por nossa conta",
#6/#7 headlines trimmed to clear ~40 chars. Preview URLs per hook (open in browser; PAUSED, no spend):

| Hook (v4 ad ID) | FB Desktop Feed | FB Mobile Feed | Instagram Feed |
|---|---|---|---|
| rotina (120250792492610228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQIJYIxSgWpebmmWYXG-tM2fvxNlFp3TzHL346lb1g5VARVjD6dlgpUqyRJmRKWlFipkalXoE7pE_MjqZRpXf8ck-cPArx22hfS9zcZMMwgwm7LE5cKihB_E0KPmpyc4SEyyQ41v7ZBeyXwqpnt5AGLlqXj8UvwmDlXBU4ij6SJAzTBczES9Z8gIu2gW_-3ooKWb93MVGOoNzWWt6wYGFlwKxH3IPjF9NIke4YLCuQLwnQ&t=AQKsyk6EgStTe4QZARI | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJ6VtLGCGvuSvSJX3qU4oi4aLfXBiY5EQIdohzdDFxV6nLpWduzQXFkdYtBNPParDz_7A2TJxnZ73YQ6RG6sNXYg3ZnN6-WygP8slL3OITHkCo8RAo2j8EWcupzPB1cHbI9n6HTVQA4bt5FIC_SS2PnhNQsb6Z-Ja-L8NA3DYAfwAydksbTTuhVduyq6LMl56lO8eW3nFsV5HnsvKhEhfwreK_AMLw0kGd5DEoUbZH8QQ&t=AQLA8VC_QUEqez1g92w | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJklZf55wFzbmu81GbU5_Yxua99WN65i9C5iI0KwZpWp2vrDJzhWxbqACeH0Z_YkAn5ZBHA4zQADoSX2aYmqagDcLUrLWjGo0Kcy11gsJKeSCPe56RbsopJCK_ImS_mzw0lPYXQaVbRLwsas9APfAPxLP0gDe6cfkGMB1qZh_gFAcorqp59FqHSLQ5BtwawvhLjEdv9rNaFgxLRZWocmVEwINrlanM_Bqr0qVmItFd-UQ&t=AQJTKhoJI7yJqC9bNMs |
| presente (120250792492990228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQLELVOHiHDFgxSFvZ3Ievq0XYZ5Vs4TlwotapK8Aoie3JaryzifKb-YRZDwzNREnqI8mpusrYebYsCx1QMNG34QGWMuIR5kENFK5a1kRw7MSXDoHc1ONhzVsOcZktPpHKAH8sdY6IIUwiDX5qtkEKoGTckNdUtP93_1uOsc3jJNCx7G9rGLoMD_awSZY7iPImogcTylQSSXBFZekzOqarDZgt7ZZeQFEQUL84pc5Wd_kg&t=AQI6h3tlEJEmbo5ttak | https://business.facebook.com/ads/api/preview_iframe.php?d=AQL-PrNi-tbYFcahI4Nr5rj3gHEoLQRGQL6gKeneRJSeVOGZR-tthpmvMAkDQBu52NKOWVrhcmp806WtPvQFKm4R4tQdPiGLGNTnknF7IwTUCH0cr1U6gweUs8aCcmBh6JtB0bB6Tb_XHYL_gXjlcQGCQjcuAfvrspileyCGOaCsIX91nwbVqbJFIOtvd3y6K6a-pE6Lf5-DU1dmJRGLF8wswDk369Mw7VpGj09IkNIxBg&t=AQLHvQ5VNWBiiqxt4nw | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJsnP9UBCcxDOBZiA_oqflPAlH4Igm66WTiBmdcXamYTcxcjBUcw0Ay43UAifR7KKyHXW84NhxTucNNNCAC0KAEpPtIWQOZs9HrRhzI8cT2OU7MT-9l7n6kSRtj1PfKoljtBlUTvgDZAKhCX7qxD40T9Jm1P3i_fpS91Td04KPM8nJqjrkJEQRGTnwxMYaEqKmTdsxWSrDdc__RwC1_dT6aCzjFgBZzW-FmXvHjDwzbnw&t=AQKa9g3-b-0nyrVDrbY |
| loyalty (120250792493110228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQKGs6DbdXFAP7D00X9dn2DXtpc4Alud2LMYsimBJgl34UyW_cmwNkdD4VCteSwPGewIAFfBMnjp_rMvn4t1B4AZdJ0dT1zigIvTeCqZt593SCtCUFOIcUjT6jaQxnfUqnenFONjISOnNs4Ia10ky6uNjhqJRHWjJgb8CAhuaBIcw0cpDYPHH8xVAkx_Sx4RQ9s_ApI42M0MsqFZe9AyWzf04NTWRmub-fbaNMc3awpMyw&t=AQKltClHZItorlum2rk | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJdAkg-H6j8NEwgxib8eEoZz9tFMVbv70OStzTgwj7T5l-0PrLUTc0cw84G5Pn3FJsFzBvXx1vOoB4mNQNEqe5lZ0QChnjFhxFnqxKDZKX1Js3Oh8Dj_LbEOb037NG7dln9p8Uc9c_ylK0e1Ab-nFV0p0CUHPF7FvzLwaHe2604_FGdmcmB-ped7-qLaiwukhp9NCZDOR99ZevNZZJClVlmaa_UqlJyOJieJIRDpTOHmQ&t=AQLMEzhr4sAwKce-SEU | https://business.facebook.com/ads/api/preview_iframe.php?d=AQIbPr1PiX4Wna9SHjrJoJUU2z1Y0bdp1XoazopNX1wKqSO1fhkZ7_K5REYm-UryloLy02I91X01Rr1-YV5SxOiNrGnQlXzKw9VldZp_VTRNbGhIfCZBM0DneClVq7H9MQm50cs9cCK-kAT9d_THqFKNXlXqVhxItcFolY6PxW78EMxQ10Hl9Dj7NSH-YGMgConaUxr4q1aUp8RP4F_auvSubL7rmRHOg5GOSYknnx_lUQ&t=AQIygsTCQSr2DpGQkUw |
| ritual-menos100 (120250792493290228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQLhBmxEyLikOtItH0mBpz61_5_Mf8dYfnJQGvhH8W07BHL0w3LMZHin8QzbCtb33db6wRWFCetRXsmtwz4VzUdiZCxZzOh31kfU0KE3saJzMWejzRjE1RlUhNJo0eOzhFBymHHTJtgxUtDBkhuxGwgImNaPYil98Y8xkDR82uq5HCsvXMJPIG3WGqMxBrCp-zifAl5ynnSNbPDl4z4G8iDZjJDzHotC9xl8pjH5HZ9QIw&t=AQIu6Q36P1gqT5qBmMk | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJXqZsVMcP7q1m5dEynT8Q3LKmd5MZIQo3Hox95JRS6RiYo9Nm3G3WloVgtNsHelANKJQVGifZzZxJSox-48Za6Mh6BEsvJ7kH5CVPNfgd43_NirpKKs7HTdS0c7x5eI1h09OLRT9dNKZ7qxavG3Qb0z9zYYeR-hZ6s5Ryc9NFo9E_f7_9OUzPDIFvUAKZa7KIXGsu9L5OmxEGtO1NaiDFtZ05qL8O3fgUvfvqTtUxJag&t=AQJ0-ZaKKXprZT9-c5I | https://business.facebook.com/ads/api/preview_iframe.php?d=AQLWPDBwvBMfiS7rHpAFQ4D3nUU5LIBtIFFOyrfeY_zogC5n6V1En-P3Dn4V0McVHpEr-cOwDb_t8AuksXxHATGYp06Rsf6_fImGhSaM3JU_LUjYPyi72O7Th1toRT3vDO83I-BeWint7d70Pbo0UldJf-9uUnR1zAW3fh39OvzUcIyy0jB29qKXEyGM38oWastkQflHUXDuA7ZFKDbPl5Y5Pttlc092uGbP73X_fL2VLw&t=AQKQRzLwSeWjf3Hivn4 |
| completo-menos100 (120250792493760228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJJ62rs7BkbzYQpnOV4ocBXAchh61XzoRpnwox9MZBmX0_fP4YU8r--RTeG7YqMODJsF0ZexXgnIS6me1duvbrYJ-MMpDU2--fsjP9jr3yoag6PwjVXjq5DF1JcHX-YViEzYxEB6vnjG46-SvI_vWVpywu_2BQKBeFhlI15Ko9XdWXgYu1cgp4hCLTw8WpbBXcV2Kxj5LGnVpG54OnIq45H05oNhUufWNx9HVgZkpSx2Q&t=AQL0MfdcuPBZNrUxFdk | https://business.facebook.com/ads/api/preview_iframe.php?d=AQKnmpeChVaa3r-Jlk-WPxfxNOrI1oH-1-_wJY4Z34-XwvccrJXtI9njL_ezQchxwuA5L7fXPFozZdsySDnbI0X4ClUvqSQdK5DuaaMMACex-raumYaDQWBEkk8FMyShK7m2W0Mxf139b3QlPLk8j4EkyS0c3X5KQaIkjPHu5dYL1QcE3i7AVXuBhqMwPa8fA8Po7L5IvPgYR-Vz44jC-olST2Od9ThkwsTNfijc8OElUA&t=AQIGpCjSCqT4shZKpBU | https://business.facebook.com/ads/api/preview_iframe.php?d=AQLqPn3ao6tmRCpjWQaECV9NJTVCpJiLOwJFLVa0u0G14X9mztqcGNYknNWHu00x5lwW9UbetpkIssb5_WHOG2QZKq5w5vs0XBPybiIzMEmDmANpmpleps6b3IUo3XLhV6sCuhmi8G3QEG1FjTfoO9Wg5a0uEBm9zX1X92vZ9bYMhA2Nmtd2LBEQXp7zdy_L_oY25HFiplDOLMmJJX72HmGqxYYLGCVvSRYe28dJJJ78nw&t=AQLH5yR60bZT9yal0kk |
| experiencia-menos100 (120250792494030228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQIxXIfE59odHEwXD-lVPqvFhOk6RpeqyCA6ds3dhu7bCj-Hi4gR6mTbhgmdpg1q50l9hLoK6qoBDKDP2e07gJlQ4nuEeCdCLHYsOEL-YAQn2S6_YcJ-jvidG86OobnGZGxEKc0gI92d8ElV7Pj0pbbkvoVuKwPgOati7uvRfZzjd0NP8mv5Cq3i0yx9yJ6rKnkV5FSDfvYvDA0S_RUg3haPBSWbkOwDN1x7OzinsyS9EQ&t=AQJBlIemT4W3bJ5gbsY | https://business.facebook.com/ads/api/preview_iframe.php?d=AQKXIOtPnfwHZzrTfXXwDBmcrHYH_kUJdVRvjdShBLcPwKWlR31Pm1x6_hfmNCyKz896rlTC-oicdNcoPfgoUItnxaHw3IAy-70dB65GXWwzMc2g-DrDdrOKpRiXJczJBGkX7LypUScPoeJTuYz_mJ9sytXe9RNWa7LmjpKs0C8XRMLlG11vDhaZOuhHjVpN8C8DC75s9vwxcApCmj--qhb6siJqQE5i0k1fDf2Qc52P5Q&t=AQLhbxbfUA-h9r0MIY4 | https://business.facebook.com/ads/api/preview_iframe.php?d=AQI5Hgbmpk_D0m0tJLiu5buhZ3wBVW65yNiAKRIo2C7ZEXQeUO_wHsxlmJUa-lpIQ5PMcx0bSIt4EEIPbqhFzZjzOYtfzFc8g8SWf_JnxPerM6F--iZGvhnntpXkEIDOUG1Qsl_PrcLnnOQ8lGp2vPiFKG_aFopFq5EkN3wBpB4t_Di0mP0yQEwCgc-R4CMeMQ_YY0gKG77LN4KYUutqyWkL1jcYhMT_SNMCBIui_cIW5g&t=AQKHWZ2nV87WPovcrlA |
| capilar-menos100 (120250792494510228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJ6iLp9y0NOINKhrgodDTn9kGAL5gwD8mU-J3bAW1eJHtzXTPSnceK-pPH3O-v_fCOc7wtAxA24bLBV02hfv0uauG_JkQqh9ofbrWFGKhxN3tHngRmaLhrzjvo64v4iBhOBv94VxkvNoYdC_CDpur1yAF2lNmux4YojLbMr4Q_2WmCx6pEvOGHiZMUz61Mpym9R7dK1t9h9Wi4KQylReMLB_Xnv9_PzBbgLVOT3Zr4e9A&t=AQJIQpEw6HqcXGRAJcY | https://business.facebook.com/ads/api/preview_iframe.php?d=AQIQmyDcFo6p6me7ncC1JPxXV7gglMBEfLUByPiCoc1811pyRVbS2w2Ka00LMJlTxt9SMAob13OMBTOYf-Sxzt9FTMHLwja6Vpe1fff-tz9tGjqEpyvCiK0yfv7Elu1w7KMO_tX6NY9Uzdsbb3XntnfXvWMMgb4PPD8iGMcCzc4Sbxz3iiUsAFMI2nZobmzi8GsxuWPGNrh0fyO37tbjFdJdEijAiop4BLV5INX9cER7KA&t=AQLL18oEJtPtddv8_lQ | https://business.facebook.com/ads/api/preview_iframe.php?d=AQI5Hgbmpk... [see IG col] |
| completo-95 (120250792494970228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQIeEYJkRygaY3SeeOHj9ObRjE28ijHE_DSjf-aV7CW8xnz4F5r8N0PJMlb35GbcVs5HonYZzvOBsi4Gj2sRvnDBIBFpIkWsT_EVkP6U-Z8noFEAz3lVeftYE3D9f0_lD5PwxElraiRV0SIp2bOXYERdixciYOFW3_idXIe0kkSK5CrGN-5I9iiMGLqpmsNappbue8THpWGZzTYIUYNi6BRvjXvb0EuQSF83RS7tdnUmKQ&t=AQKznNWcH9tAMqyyKt0 | https://business.facebook.com/ads/api/preview_iframe.php?d=AQKkAQUpPmxFNTWpYTs1oeqOby4NUGHaAFmN-0PiZnF0COG36rIzbFc6VTwuZFJAEF2wF7EUszpm_aI_jvDTzhOyTs_7-Il62XuQeILhQKItC8x2kjcPbGrsJ7T6Tt2TTE-z7dQ4ihDz05rqevGyCvRLwUSOwy2u7q83ZkEk4UoSDeBPUPBH31itFpmiK2G3Y1HnXX8gJvD4T8uYM4egmhS1EDNgZl7G3nEXVeCVk5bNRg&t=AQJamG6Ldqz6FLM9mck | https://business.facebook.com/ads/api/preview_iframe.php?d=AQL_nOsTjgkr1rHJCara8uou2whMkExFNrWhnryPsaXRXtZzyJJ9XCJ6reJKqJo4vgU0nzcHVbHiqiN5KMIOJl0O8sj3ghYEjEh9qpDXTlZINnx_Fh_p6o_ApSdcdyV3j2FSESt4js2Hqib0Qx3oeobfP6h2h37NOnK7Qj5ur7nLGvGoAX766FyfhWf4Nl2D2fiP_wQavWVv4H-FxIFiACgZ70k_CoVumYDsF5ikx9oGJQ&t=AQK-0mcdXHhiatFFSzg |
| experiencia-95 (120250792495560228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQIvKMW-TwKi2h9h7zNAm3EqSwh5ccOc9-KX_FOF9DrgzbgzXWCaRkZz67xGTpKb4uml2q2NqUK3IXrK6UN61hXZJ5-veMhGvIRDit9LKEwZ1ZI4Qt-BZTCyFEomf92PPvxNKJosrxRCyoDlxJAqJ-RlGtnR4kUJLg8DxCkCV42YP2Szp5Mp52Sqaxew4W3-UcpLWPkqPi_Zr5Qq5fnvF_wJK3g1N7Qyk48G3XnjAqnWLQ&t=AQIwgE1L3vHZxy3YuTA | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJ3h_-ByHiqekso2_lIOUUgVZead4TGz7DwAFrZYNj71Y9SGaYtldhfGRynUgrZyMt-YXd8b8ZokmBqIolxTrAXK3_FtsaiYX0AF2IIA64FJGmw2WbBdrCUUPexWVE48mnUf6vZjVGNYQlKGwU7JljUlJi50GjQk0yfM8t4lDXhgjMG2bcX1mXIm3ZcRUaGFzSBqzM0PsajdYx73s4ybmn2Udnz_fbB8uRRiCkYLRev9Q&t=AQKnJRiZPqoqbIMkFz4 | https://business.facebook.com/ads/api/preview_iframe.php?d=AQILU33ze9ixd5lKXVHI1MW95uzY32jsCb1-ZB8qNOUvzM3A9rPwfIAIEkdWtCK6SL3LoA2uncdMbbodvDjbkjzuLnhM0Hz5IlHqMiBOzt-0on-XZaMl4TqFfcrDbwwLhT_PhntoCeLP0-2dzaWQ_i2Bg72xuukyUz_LI_EI-hYzVqHkbUFdE3kUQgd0RVvIG_OQTLeoB8BYZM9mHUyvlMWMf0UEDLBSQkqUUwLUqKsDuQ&t=AQJNT5zfXkmnsisu2XY |
| capilar-95 (120250792495840228) | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJB0CBeejhCcuXsf8NbCkDqDoHqA8-BxVVnMEWwiyl9yuyck6RlS86dneU5Cgv0sKM9toKmK_KJD-lyIfWQISiHLyEBCDZZ4wLH1H4I2y_kdN6BFdRLkZ-iUR0UaI6pc18HWhd47my0OAA1HprA57oM0tWs4tJm205NR54sYc29bzPKI8C7bGShzEPjWt0Ibuwob8hFN-QHs4MX_U4zr1ObXKw3VOrXbjNYSrQgxLbUvw&t=AQKYu6puqzlFqniOFqQ | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJiSnjgG22VJR0BnNkhaWTiCnSUw4LDxje_BFZlrl3S0QFGfCXQzZYdSLBfuGc1UzPPXnCIl7pBFhF1nfgNqEOX8UlvfKEpo0UeIFCfHmwdsgOQw_mOstH2CwBqtI5_ZKQZLMUNcCyegAn6Uqc2i4JjpPgFpO8AfAsvvpmy462bOVkPQwYT1BZidh6Rb4XUIlC6rnfUrUIgvg_h94MRcNI3wRjayY7h9AxdJC6sHcF06Q&t=AQLFULGN4ezZ7mKqgQU | https://business.facebook.com/ads/api/preview_iframe.php?d=AQJjiGr4R_hc1-p5RVVtiQg9JXzU79N1V9Pc_LIn_Tnj-ullPltP-xpZWKYV8CBbw0muMabqk21VJCroP3DYB6aywVrh2Si-o18niRN9azOxMpAUErjMneu_ybGhhv3J3BkLoT31vbUcAJUM7wRgZC6D6lp1c4LPQyLcDrs0Irp5yuORNMe15kDoeZtLMW2TlMgKlEs26NFouHxgR7gF9GBQLltwDHPlW0dN1qxEHyPw8Q&t=AQIDFAoTahxlY_Z7sMQ |

(capilar-menos100 IG preview URL: d=AQL_R1n_UhsawVv1fX2lxltreet-bqBGnx6c_PZjj53PW-H4dFmTYl9KHNkPPg70C8dHzeYVy0z79IE6Zo00cMqPd0oGnQ69ZojuSiavNRvozzjYHEDdyI4XmWiWi5-ZyZa0OrC3bkID8RAD_XKtHSZ584-blaKD04vUqgi5cI9ngjv3krZPGAy1GWVib5YPAfD49oVQtnm-ojImONLL2amDXIg5dGXHFpTCQKMqB7RpQQ&t=AQKemZxKqvjrg5QbIik)

**QA note:** the preview tool's static thumbnail rendered only the GE Beauty page avatar, not the full ad — a thumbnail artifact. The live iframe `preview_url` renders the full creative + copy; open each URL to validate. All ads remain PAUSED.

## Pre-launch checklist (before any status flip to ACTIVE)
1. [ ] Pixel + CAPI ADD_TO_CART firing/deduping verified in Events Manager (the optimization event).
2. [ ] QA the ad previews per ad (image renders 4:5 in FB Feed AND IG Feed; link 302s to LP with code applied + UTMs).
3. [ ] Confirm daily budget R$300 total (10×R$30) and 7-day wave with Lucas.
4. [ ] IG delivers via page-linked IG (page 106114707866572). Optional: attach the explicit GE IG account in Ads Manager for the IG handle to show as the brand.
5. [ ] Promote/kill thresholds (manifest §7) agreed in writing.
6. [ ] Scale gate depends on ga_econ cohort-payback read (manifest §8).

Launch = flip campaign + ad sets + ads to ACTIVE. Nothing goes ACTIVE without Lucas's explicit go.

## v5 — CREATIVE IMAGE FIX (2026-07-25, CGO main session)
Defect: v4 ads (and earlier) had the WRONG image attached — image_hash e9ac11... = "untitled_105" 3000x2020 (a GE logo), NOT the 4:5 product plate. Root cause: the campaign creatives folder was renamed to gebeauty/imagery/primeira-rotina/creatives/meta/, so the earlier upload grabbed a fallback file.
Fix: re-hosted the 10 correct 4:5 plates on Shopify CDN (verified 1080x1350), created 10 v5 creatives via image_url = those CDN URLs, verified EVERY v5 image reads 1080x1350, confirmed the rotina preview renders the real plate, created 10 v5 ads (PAUSED), then DELETED the 10 v4 ads. Each ad set now holds exactly one correct v5 ad.
v5 ad IDs (all PAUSED): rotina 120250794788830228 · presente 120250794807350228 · loyalty 120250794808150228 · ritual-menos100 120250794808600228 · completo-menos100 120250794808880228 · experiencia-menos100 120250794809750228 · capilar-menos100 120250794810530228 · completo-95 120250794811110228 · experiencia-95 120250794811770228 · capilar-95 120250794812350228
Plate CDN URLs: scratchpad/_plate_urls.json. Everything PAUSED, zero spend. Launch = Lucas's flip.

## LAUNCHED (2026-07-25) — Lucas approved ("Approved! You can post")
Campaign 120250791335430228 + 10 ad sets + 10 v5 ads ALL set ACTIVE. Live, delivering, spending ~R$300/day (7-day test wave ~R$2,100). FB Feed + IG Feed, ABO, ADD_TO_CART, NEW_CUSTOMER_ACQUISITION.
Guardrails: isolated cohort (bundle GIDs 10212940448064/120384) — judged on day-75 2nd-purchase read (success >=35% reorder by d75 / kill <=25%), NOT first-order ROAS. Don't touch during learning; rank hooks on leading indicators (CTR/CPC/cost-per-ATC); SCALE (CBO) gated on cohort payback. Measurement wiring (per-hook order-attribute) still on backlog (pending-fixes.md).
