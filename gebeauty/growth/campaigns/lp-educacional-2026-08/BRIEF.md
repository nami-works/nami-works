# LP brief, 5 educational posts to paid, campaign `lp-educacional-2026-08`

Resolved: `gebeauty` · model `dtc-purchase` · steering metric **net margin per purchase against the 10% floor after media, plus marginal CAC under the ceiling** · currency BRL.

Owner: `growth-hacker` (brief, message match, CRO, ship call). Build handoff: `product-developer`. Tracking wire-up: `integrations-engineer`. Nothing here is published.

---

## The decision this campaign informs

Can GE acquire a new customer from **educational** top-funnel creative (not product creative) at a CAC under the ceiling, while landing on the routine rather than a single SKU?

## The finding that set the conversion unit

Run `offer_margin_check.py` to reproduce. Absolute cost model from `params.json`, COGS bottom-up from `cost-basis.json`.

| offer | net R$ | contribution | max CAC at floor | net % at R$68 CAC | gate |
|---|---|---|---|---|---|
| rotina com frescor prolongado (001+002+008) | 259.00 | 133.22 | **105.66** | 23.7% | PASS |
| rotina com proteção térmica (001+002+011) | 237.00 | 120.31 | 95.09 | 20.7% | PASS |
| rotina R$259 + booster (hits free shipping) | 334.00 | 160.53 | 127.13 | 27.7% | PASS |
| dupla shampoo + máscara | 190.00 | 90.25 | 70.03 | 11.0% | PASS, thin |
| **shampoo avulso R$95** | 95.00 | 28.32 | **18.21** | -39.3% | **FAIL** |

**A single shampoo cannot absorb a R$68 CAC.** Max sustainable media on that order is R$18.21. Every page therefore converts on the routine, never the single hero. This is the whole reason these are landing pages and not PDP links.

Both routine kits sit under the R$299 free-shipping threshold on purpose: the R$40 gap is a live AOV lever, and closing it with the booster moves the order to 27.7% net. The pages show a progress bar for that gap.

Snapshot caution: CAC ceiling R$68 and repeat baseline 15.8% are `as_of 2026-07` from CGO-TEAM prose, not engine output. Re-derive via `module-a/kpi_sweep.py` before scaling. Separately, `brand-context.md` says repeat baseline 15.8% while `growth/docs/retention-hero-products-study.md` says 14.4% base on a mature-customer sample. Different samples, worth reconciling; neither number is load-bearing for the go/no-go above.

## Message match, ad to page

The headline continues the exact words of the ad. This is the highest-leverage lever on the page.

| # | ad hook | LP h1 | page | offer |
|---|---|---|---|---|
| 1 | 5 passos para o cabelo mais saudável | cabelo saudável não é sorte, é rotina | `rotina-5-passos.html` | rotina R$259 |
| 2 | scalp care é o novo skincare | seu haircare começa na raiz | `couro-cabeludo.html` | rotina R$259 + booster |
| 3 | seu cabelo "acostumou" | **seu cabelo não acostumou. ele acumulou.** | `efeito-build-up.html` | rotina R$259 |
| 4 | por que o cabelo cai tanto no inverno | por que o cabelo cai tanto no inverno? | `queda-inverno.html` | rotina R$259 + booster |
| 5 | não sei qual finalizador escolher | não sei qual finalizador escolher. e agora? | `qual-finalizador.html` | rotina R$237 (leave-in incluído) |

Page 3 is the only headline that reframes instead of repeating, because the ad poses a false belief ("acostumou") and the page's job is to correct it. That reframe is the page's whole mechanism.

Page 5 carries a chooser (tap your hair type, the four finalizadores highlight) because the ad's promise is a decision, not a fact. The routine still sits underneath as the base.

## Page structure, identical across all five

1. announcement bar, free shipping above R$299
2. hero: eyebrow continuing the ad, h1, sub, two CTAs, trust chips, kit image
3. **the answer** the ad promised, delivered immediately as a numbered list. No scroll tax.
4. mechanism, three cards, ingredient-as-proof
5. **offer block**, the conversion unit: three ritual steps with actives, price, CTA, free-shipping progress
6. upsell (booster) where the dor is force or scalp
7. proof, real Instagram comments
8. FAQ, built from real questions asked in those comment threads
9. final CTA plus tagline, sticky mobile buy bar

## Sourcing discipline

Zero invented numbers. Every claim traces to something real:

- prices, actives and product copy: live Shopify catalog read 2026-07-31 (`primeira-rotina` collection, published 2026-07-24)
- actives named only bound to a benefit, per `voice.register`: murumuru, pantenol, óleo de abacate, crambe, H-Vit Plus, chia, trealose, biotina, algas vermelhas
- proof quotes: verbatim comments on the five posts, handles kept
- FAQ: real questions from those threads, including "o shampoo GE pode ser considerado detox?" (page 3) and "vocês têm algum produto para esfoliação do couro cabeludo?" (page 2, answered honestly, that SKU does not exist)
- no ratings, no review counts, no percentage claims anywhere

`build_lps.py` runs a voice gate on every generate: em-dash ban, invented-number patterns, discount language. All five pass.

## Brand gate

No discount appears on any page. The routine is sold at the price of its parts, and the value-add is the structure (three steps that compose) plus free shipping as policy. That satisfies value-add over deep discount with premium positioning intact. A `-20%` kit was modelled and lands at 10.5% net, effectively on the floor: not recommended.

Page 4 carries the dermatologist note from the original post verbatim in spirit. Keep it. Hair loss is a medical topic and the organic post already set that expectation.

## Tracking

Pages forward every incoming `utm_*` and `nemu_*` param onto the store links via JS, so the LP hop does not drop attribution. Per `growth/references/utm-conventions.md`:

- ad links use the Meta template, `utm_medium=cpc`, plus the `nemu_*` half
- never paste a destination URL out of Ads Manager into anything else
- no `|` inside campaign or ad names

Suggested naming: `utm_campaign=lp_educacional_2026_08`, `utm_content=<slug>` matching the page, so page-level performance is readable in Nemu without extra work.

## Test plan

Cell per page in ABO so each hook gets a fair read and the algorithm cannot starve a cell. Graduate only proven hooks to CBO. Do not scale inside learning.

Primary metric: net margin per purchase after media against the 10% floor, verified in Module A, not platform ROAS. Secondary: LP conversion rate and add-to-cart rate per page. Read `growth-analyst` on the margin call.

Kill criterion per cell: marginal CAC above the ceiling with no path back after one creative iteration, or LP conversion so low that the message match is the suspect rather than the offer.

Worth watching: page 5 will likely win on CTR and lose on retention, since finalizadores are the weakest repeat drivers in the catalogue. Judge it on second purchase, not first-order volume.

## Open items before this can go live

- [ ] Lucas approves copy and design
- [ ] decide whether real Instagram handles may appear publicly as proof, or swap to first names
- [ ] `product-developer` ports to Shopify pages or the chosen LP host
- [ ] `integrations-engineer` wires the Nemu template and verifies a test click end to end
- [ ] `design-engineer` accessibility pass, delegate `design:accessibility-review`
- [ ] confirm the R$68 ceiling against current `kpi_sweep.py` output before any spend
- [ ] tag the cohort at creation if any aggressive mechanic is added later, per the cohort-isolation rule

## Files

| file | what |
|---|---|
| `out/*.html` | the five pages, self-contained, mobile-first |
| `content.py` | all copy and offer data, single source of truth |
| `build_lps.py` | generator plus voice gate |
| `offer_margin_check.py` | margin model against the floor |
| `qa_check.py` | asset, link, markup and CSS QA |

Regenerate after any copy edit: `python3 build_lps.py && python3 qa_check.py`
