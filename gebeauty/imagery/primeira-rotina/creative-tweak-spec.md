# Wash-Routine Offer — Creative Tweak Spec (paid media + rescue)

**Status:** PLANNING / spec only. No assets generated, nothing published. This is the
drop-in recipe so the creative matrix can be built the moment Lucas locks the offer.

**Owner:** /creative-producer (CGO still-ad producer). Briefed by /growth-hacker, reports
to /growth-office. Hook COPY is authored by /content-director or Lucas — this doc specs
the SLOTS and angles, not final words.

**Campaign slug:** `wash-routine-offer`
**Initiative:** [[gebeauty-acquisition-rescue]] (offers locked 2026-07-22).

---

## 0. The offer this creative serves (locked facts — do not re-derive)

- **Value-add, customer choice of the free gift.** Buy Shampoo **GEB 001** + Máscara
  Condicionadora **GEB 002** (full size) → get a free third, customer picks:
  **Leave-in TRAVEL (GEB 011)** OR **Shampoo a seco FULL (GEB 008)**.
- Same offer for **acquisition** (paid media → LP) and **rescue** (email).
- **Frame as GIVING a free product / a routine, not a % markdown.** Premium, no clearance.
- **Hero visual = the WASH DUO (full-size shampoo + máscara) + the free third item.**
- **Price / min-bundle value / exact CTA are PLACEHOLDER slots** — Lucas decides the number.
  The creative leaves room; nothing hardcoded.
- **Dedicated ad set: hooks STATE THE ACTUAL OFFER up front** (buy full-size Shampoo +
  Máscara, get a free third — the wash routine). There is NO free-mini hook to bridge
  from. The ad hook and the LP hero must communicate the same offer (ad↔LP message match,
  §2f). The travel-size promo is retired, not a bridge source.

---

## 1. AUDIT — existing `travel-size-promo` assets

Folder: `gebeauty/imagery/travel-size-promo/`. Shipped 2026-07-11: 28 assets = 7 hooks ×
4 Meta formats, plus the live 5-format `ganhe-miniatura` set. Canva master family =
**META_CACHOS2**; per-hook design IDs logged in `.claude/initiatives/gebeauty-paid-media-scale.md`.

### 1a. What is REUSABLE AS-IS
| Asset | Path | Reuse |
|---|---|---|
| **Canva master template** META_CACHOS2 (4:5 / 1.91:1 / 1:1 / 9:16) | Canva (IDs in paid-media-scale initiative) | ✅ Clone-and-swap seed. Brand font, logo clear zones, type scale all proven. This is the backbone — do NOT rebuild. |
| **Layout system** (vertical = product bottom / copy top; horizontal = product left / copy right) | all shipped assets | ✅ House rule already baked into the master. Keep. |
| **Design tokens** | `gebeauty/design-system/foundations.html` | ✅ GE Red `#DF3630`, Italian Plate No1. Unchanged. |
| **Background / podium studio scene** (high-key near-white, white podium blocks) | `expanded/*` | ✅ Reusable as the *stage* — but the products on it must change (see 1c). Extract bg + podiums, recomposite full-size tubes. |
| **Leave-in TRAVEL plate** | `product-heroes/hero_leave-in.png` | ✅ This IS gift-option A (GEB 011 travel). Real, pixel-true, ratio-square. Reuse directly as the gift element. |

### 1b. What needs RE-COPY only (same look, new words — the cheap path)
Every finished creative carries the OLD offer copy ("Ganhe uma miniatura GE Beauty" /
"VOCÊ PAGA SÓ O FRETE" / "MINIATURA GE BEAUTY GRÁTIS, PAGUE SÓ O FRETE"). The *typography
treatment, headline size bands, and support-hug* are correct and reusable, but the WORDS
are the wrong offer and must all be re-authored (new angles in §2). So: clone the master,
`replace_text` — never reuse a shipped PNG. Retire the words, keep the machine.

The 7 tested hooks map to the new angles as follows (some angles survive the pivot):
| Old hook (travel-size) | New-offer fate |
|---|---|
| hook1 "Ganhe uma miniatura" | Re-cast as the **free-gift** angle (gift = the third product, not a mini) |
| hook2 "Experimente antes de comprar" | Survives → **try/experimente** angle, now "experimente a rotina" |
| hook3 "confia" / hook4 "primeiro" / hook6 "conhece" | Candidate raw material for the **loyalty / "quem experimenta volta"** angle |
| hook5 "descubra o cheiro" | Fragrance angle — secondary, keep in reserve |
| hook7 "No seu tempo, do seu jeito e sem pagar" | Tagline anchor survives; drop "sem pagar" (wrong — offer is buy-2, not free) |

### 1c. What needs a NEW HERO PLATE (the real work)
**The current hero is three TRAVEL-SIZE miniatures** (shampoo 60ml travel, máscara 50ml
travel, leave-in 50ml travel) on podiums. The new offer's PAID pair is **FULL-SIZE 001 +
002** — visually different tubes (larger, full-size labels/proportions). The miniature
trio cannot represent the paid wash duo. **New hero plate required** — see §3.
- `product-heroes/hero_shampoo.png` = travel 60ml → NOT the full-size 001. Do not reuse as the paid item.
- `product-heroes/hero_mascara.png` = travel 50ml → NOT the full-size 002. Do not reuse as the paid item.
- **No Shampoo a seco (008) plate exists anywhere in this campaign** → must source (gift-option B).

### 1d. What to RETIRE
- All finished creatives under `creatives/` (`matrix/`, `hooks-4x5/`, the 5 live
  `ganhe-miniatura` files): **wrong offer, wrong products.** Do not port pixels. They stay
  as the archived travel-size campaign; the new campaign gets its own folder.
- The miniature-trio composition (`expanded/*_hybrid*`, `*_zoomout*`) as a HERO — retire
  for this offer (keep only the bg/podium stage per 1a).
- Copy "pague só o frete" / "miniatura grátis" — retired; the mini is now the gift, and the
  paid pair is full price.

---

## 2. TWEAK / ASSET SPEC

### 2a. Message hierarchy per format (what reads first → last)
Lead with the ROUTINE + the GIFT, never a number. House layout rule is hard.

- **Vertical (4:5, 9:16, and treat 1:1 the same):** product cluster BOTTOM, copy stack TOP.
  1. **Headline** (top, largest) — the angle hook (routine / gift / loyalty).
  2. **Support** (hugs headline) — the mechanic in plain words: "compre shampoo + máscara,
     escolha seu presente." + the **[GIFT-CHOICE CALLOUT slot]**.
  3. **[OFFER-VALUE slot]** — a small line for whatever Lucas locks (e.g. min bundle),
     styled subordinate. Leave the box even if it renders empty at first.
  4. **[CTA slot]** — button/label near bottom edge, clear of the product cluster.
  5. `ge` logo top corner (untouched clear zone).
- **Horizontal (1.91:1):** product LEFT, copy RIGHT. Same 1→5 order stacked on the right.

### 2b. Hook ANGLES to test (COPY authored by /content-director or Lucas — slots only here)
Dedicated ad set: **every hook STATES THE OFFER up front** (buy full-size Shampoo + Máscara,
get a free third). There is NO bridge angle — nothing to bridge from. Spec **3 launch
angles** (a 4th optional, below); each becomes one claim across the whole format set. All
must obey brand voice (no em dashes, ingredient-as-proof, idiomatic PT, tagline "no seu
tempo, do seu jeito.", real products, no invented numbers), lead with gift/routine, never
% off, and make the paid pair + free gift legible in the hook itself.

1. **Rotina / wash-routine** (premise-led, the strategic core). Angle: the wash trio is the
   routine that transforms; buying the duo starts it, the third completes it. States the
   offer as "monte sua rotina de lavagem" (final words = content-director).
2. **Presente / buy-the-duo-gift-included** (recast of old hook1). Angle: buy shampoo +
   máscara, the third product is our gift — gift, not discount. States both halves of the
   offer directly. e.g. "leve os dois, o terceiro é por nossa conta."
3. **Loyalty / "quem experimenta, volta"** (from hooks 3/4/6). Angle: who starts the routine
   stays; social-proof/conviction register — but still names the offer (duo + free third) so
   the hook stands alone without the LP.
4. **(Optional 4th) Escolha / customer-choice** — states the offer AND foregrounds the pick:
   buy the duo, choose your free gift (leave-in ou shampoo a seco). Offer-stating, not a
   bridge. Build if a 4th cell is wanted.

Reserve (not in the launch set, keep for iteration): fragrance ("descubra o cheiro"),
tagline-only ("no seu tempo, do seu jeito"). NOT reserved: any free-mini / "pague só o
frete" framing — that promo is retired and must not appear.

### 2c. Claims × formats matrix (build grid)
3 launch angles × 4 Meta formats = **12 Meta assets** (16 if the optional 4th "escolha"
angle is built); + the same × Google PMAX. Launch recommendation: build the 3 offer-stating
angles × 4 Meta first (12), add the optional 4th and Google PMAX on go.

| Angle \ Format | 4:5 | 1.91:1 | 1:1 | 9:16 |
|---|---|---|---|---|
| 1. Rotina | ☐ | ☐ | ☐ | ☐ |
| 2. Presente | ☐ | ☐ | ☐ | ☐ |
| 3. Loyalty | ☐ | ☐ | ☐ | ☐ |
| 4. Escolha (optional) | ☐ | ☐ | ☐ | ☐ |

Same grid duplicated for Google PMAX (own design, own pages — hard filing rule: one Canva
design per CLAIM per PLATFORM, every size as a page).

### 2d. Platform placement list + per-ratio safe-zone / QA (hard Meta rule)
Single-image ads serve ALL placements and get cropped — spec a per-placement safe zone and
QA every ratio. Product/copy must never invade the `ge` logo or the products.

| Platform | Format | Px (verify pre-flight) | Placement(s) | Safe-zone note |
|---|---|---|---|---|
| Meta | 4:5 | 1080×1350 | Feed (FB/IG) | Keep copy in top ~40%; bottom UI chrome on IG feed can clip ~120px. |
| Meta | 1.91:1 | 1200×628 | Feed / right-column / audience network | Copy RIGHT half; keep clear of far-left product. |
| Meta | 1:1 | 1080×1080 | Feed / Explore | Full product visible (no cropped tube bases — rebuild plate, don't bottom-crop). |
| Meta | 9:16 | 1080×1920 | Stories / Reels | **Top ~15% and bottom ~20% clear** (Stories UI + Reels caption bar). Headline line 1 ≤ ~13 chars to clear top-corner logo. |
| Google | PMAX 4:5 | 960×1200 | PMAX/Discovery | as Meta 4:5 |
| Google | PMAX 1.91:1 | 1200×628 | PMAX landscape | as Meta 1.91:1 |
| Google | PMAX 1:1 | 1200×1200 | PMAX square | full product |
| Google | PMAX 9:16 | 1080×1920 | PMAX vertical | as Meta 9:16 |
| Web (optional) | 3:1 banner | per LP | LP hero — **coordinate with `lp` agent** | site surface, not a Meta placement. Build only if asked. |

Where a single asset must serve multiple crops, plan `asset_feed_spec` / per-placement
uploads so no headline sits under a caption bar or over the logo. QA every placement crop,
not just the master.

### 2e. Explicit PLACEHOLDER slots (leave room, do not hardcode)
1. **[OFFER-VALUE slot]** — min bundle / price framing Lucas locks. Subordinate line.
2. **[CTA slot]** — button/label copy (e.g. "monte sua rotina" / "escolher meu presente"),
   final words TBD.
3. **[GIFT-CHOICE callout slot]** — the "você escolhe: leave-in ou shampoo a seco" line.
   Needed because the offer is customer-choice; the hero art also carries it (§3).

### 2f. Ad↔LP message match (hard requirement — dedicated ad set)
The hooks state the actual offer, so the ad and the destination LP hero MUST communicate the
SAME thing: the paid pair (full-size Shampoo + Máscara) + the free third gift, up front, no
free-mini framing. The scent/routine claim, the gift-choice callout, and the CTA verb should
read consistently ad → LP so the click doesn't land on a mismatched promise (message match is
a conversion lever and a /growth-hacker QA gate). Coordinate the LP hero with the `lp` agent:
same hero visual family (full duo + gift), same offer statement, same CTA language. Flag any
divergence before launch.

---

## 3. HERO-PLATE PLAN (spec only — product NEVER re-rendered)

**Sourcing order (per pipeline):** brand library / official Shopify PDP full-size product
photography FIRST → deterministic PIL recanvas for composition/ratio → Magnific Nano Banana
reference zoom-out ONLY to extend BACKGROUND for wide ratios. `images_expand` is BANNED on
product shots (it deletes the product). Product, labels, podium = untouched pixels always.

### Plates needed
| Plate | Contents | Source | Notes |
|---|---|---|---|
| **P0 — stage** | high-key near-white bg + white podium blocks, no products | extract from `travel-size-promo/expanded/*` | Reused stage; products composited on top. |
| **P1 — primary hero (choice)** | FULL-SIZE 001 + 002 grouped as the paid duo, PLUS both gift options (011 travel + 008 full) shown as "pick one" | full-size PDP shots of 001/002/008 + existing `hero_leave-in.png` for 011 | Visualizes customer-choice directly; pairs with angle 4 + the gift-choice callout. |
| **P2 — gift variant A** | duo (001+002 full) + Leave-in TRAVEL 011 as the single gift | 001/002 full PDP + `hero_leave-in.png` | For gift-specific / cleaner compositions. |
| **P3 — gift variant B** | duo (001+002 full) + Shampoo a seco FULL 008 as the single gift | 001/002/008 full PDP | **008 plate does not exist yet — must source the full-size 008 shot.** |
| **P4 — per-ratio derivations** | P1–P3 recanvassed to 4:5 / 1.91:1 / 1:1 / 9:16 | PIL recanvas; Magnific zoom-out for bg extension only | 1:1 must show full product (rebuild, don't bottom-crop). |

### Composition rules
- Duo (paid) reads as the pair; gift reads as the add-on (slightly set back / smaller / a
  subtle "+ presente" grouping) so the buy-2-get-1 logic is legible without a number.
- Match the existing podium studio look so the campaign feels continuous with the brand's
  paid library (visual continuity only — the offer is stated fresh, not bridged from the mini).
- Full-size vs travel: the duo tubes are full-size; if a gift is the travel leave-in, the
  size contrast (big duo, small gift) actually helps signal "the little one is the bonus."

### Explicitly do NOT
- Do NOT reuse the travel miniatures as the paid duo (wrong product size).
- Do NOT regenerate any tube/label. Composite real product cutouts onto P0.
- Do NOT `images_expand` a product plate. Background extension = Nano Banana reference
  zoom-out (product masked back in) or PIL edge-replicate on uniform bg.

---

## 4. "READY TO EXECUTE ONCE LOCKED" checklist

When Lucas locks offer value + CTA + confirms gift-choice presentation, run in order:

1. **Ingest inputs.** Confirm final approved hook copy for the 3 offer-stating angles (+
   optional 4th) from /content-director or Lucas + the locked [OFFER-VALUE], [CTA],
   [GIFT-CHOICE] strings. Every hook must state the offer (duo + free third), not bridge
   from the mini. If any hook is not approved → STOP, do not invent.
2. **Pre-flight dimensions.** Verify Meta + Google PMAX target px against the platform ratio
   list AND a real historical asset in the account (don't trust a written spec). §2d.
3. **Source full-size product shots** 001, 002, 008 (full) from Shopify PDP / brand library;
   reuse `hero_leave-in.png` for 011. Confirm all are ratio-usable and pixel-true.
4. **Build P0 stage + composite** P1 (choice), P2 (gift A), P3 (gift B); derive the 4 ratios
   each (P4). Deterministic PIL first; Magnific zoom-out only for bg extension. Save to
   `gebeauty/imagery/wash-routine-offer/expanded/`.
5. **Ingest plates into Canva** via transient Shopify Files (stagedUploadsCreate → fileCreate
   → poll READY → upload-asset-from-url → fileDelete). Creds from `gebeauty/.env`.
6. **Clone META_CACHOS2 master** → perfect ONE design across all 4 pages (plate, type scale,
   box widths, logo, colors), lock the type scale, `commit`. This is the frozen seed. Then
   `copy-design` per angle, `replace_text` headline + support + slots only.
7. **Fit + hug** at the set's common type scale; re-hug support on every resize; hard-break
   long hooks instead of shrinking. Keep copy clear of logo + products.
8. **Export per page `export_quality:"pro"` (explicit) → download** to
   `gebeauty/imagery/wash-routine-offer/creatives/<platform>/<size>_<angle-slug>.png`
   (e.g. `creatives/meta/4x5_rotina.png`). Checkpoint per angle; update MANIFEST.md.
9. **QA gate every asset** (all three checks + full text inventory + pro-export verify +
   every placement crop). Any fail → fix + re-export.
10. **Open the platform-sorted folder** for the operator (Start-Process). Maintain
    `creatives/MANIFEST.md` (design IDs, URLs, QA status, scratch IDs to delete).
11. **Hand off to /growth-hacker** for ad-set load (creative done, NOT launched). Log the
    winning angles into the CGO winner library; feed the media agency.

**Output tree:**
```
gebeauty/imagery/wash-routine-offer/
  creative-tweak-spec.md          (this file)
  expanded/                       (P0–P4 plates)
  creatives/
    meta/    <size>_<angle>.png   (12: 3 offer-stating angles × 4 formats; 16 with optional 4th)
    google/  <size>_<angle>.png   (same, on go)
    MANIFEST.md
```

---

## Open questions for Lucas (blocking final build, not this spec)

1. **Gift-choice on the creative:** one primary hero showing BOTH gift options ("você
   escolhe") — P1 — or lead with gift-agnostic art + let the LP/checkout carry the choice?
   (Affects whether we build P1 or lean on P2/P3.)
2. **Offer-value framing:** what goes in the [OFFER-VALUE] slot — nothing (pure gift
   framing), a min-bundle line, or the pair price? Drives whether that slot renders.
3. **CTA words** for the [CTA] slot.
4. **008 full-size plate:** OK to pull the official full-size Shampoo a Seco PDP shot as the
   source for gift-variant B? (No plate exists today.)
5. **Rescue vs acquisition art:** same creative for both, or does the rescue email want a
   lighter/email-native crop (coordinate with /crm-director)?
6. Launch scope: the 3 offer-stating angles × Meta only first (12), Google PMAX on a second
   pass? (default recommendation). Add the optional 4th "escolha" angle at launch, or hold?
