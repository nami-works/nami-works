## 1. Identity

- Name: Lucas
- Based in São Paulo, Brazil.
- Communicates primarily in Brazilian Portuguese; works across voice dictation, structured
  frameworks, and iterative dialogue.
- Has an interest in exploring new neighborhoods and cultural spaces in São Paulo on weekends.
- Background in real estate management before transitioning to a founding-team operator role.
- Long-standing interest in structured analytical frameworks — Essentialism for task
  prioritization, Naval Ravikant's specific knowledge framework — and consistently applies
  them to business decisions.
- Role preference is orchestration — delegating, structuring decisions, and defining briefs
  rather than executing directly.

---

## 2. Career

- COO of GE Beauty, a digitally native Brazilian beauty brand in the masstige segment built
  around a founder-influencer who dominates social media.
- Founder of NAMI Works, the parent company that owns the tech infrastructure serving
  GE Beauty (and future CPG brands). Lucas wears both hats simultaneously.

---

## 3. Team

**GE Beauty side:**
- Camila — Founder, the brand's creator and creative center. All brand voice flows from her.
- Raphael — Operations / Logistics
- Eleonora — Marketing manager, owns offline retail mandate
- Cecilia — Affiliate and UGC program
- Giulia — Financial analysis
- Marina — Strategy / analytics / support

**NAMI Works side:** Lucas is the sole operator. All tech decisions are his to make
autonomously; Lucas owns product, brand, strategy, and financial decisions.

---

## 4. Tools Available in This Claude Session

### 4a. The NAMI Works MCP Connector (`mcp.nami.works`)

A custom MCP server that exposes GE Beauty's business tools directly inside Claude Desktop /
claude.ai. The GE Beauty team talks to Claude; Claude calls the tools; tools hit Shopify,
Omie, and other systems. The team never touches a CLI or an API token.

**To connect:** add connector URL `https://mcp.nami.works/gebeauty` in claude.ai → OAuth →
paste the shared tenant bearer once. One shared bearer, not per-user accounts.

**Shopify tools:**
- `list_todays_orders` — today's orders with status and shipping info
- `find_order` — look up a specific order by number or customer
- `find_customer` — look up customer profile and order history
- `apply_price_tag` — tag products for campaign pricing
- `update_product_price` — two-step confirm before writing prices (always confirm before executing)
- `create_discount_code` — single-code discount (not multi-code sets)
- `revenue_by_location` — compare store revenue across physical locations

**Instagram tools (PARTIALLY BLOCKED):**
- `recent_posts`, `top_posts`, `search_captions` — read-only, available
- `draft_caption`, `voice_card_current`, `refresh_ingest` — **BLOCKED until Instagram
  account is linked in the NAMI connector admin**

### 4b. The Omnify Shopify App (`app.cpg-labs.io`)

A Shopify embedded app built for GE Beauty. Key features relevant to Claude.ai conversations:

- **Local Delivery:** Automated daily SP deliveries via Lalamove. Orders routed, dispatched,
  and tracked in-app — does not create Shopify fulfillments.
- **Storytelling (AI blog generator):** 5-stage iterative content engine. Brand voice inferred
  from tone sources (Shopify blogs, Meta IG/FB, Monday.com, manual uploads). Ships SEO briefs
  → full drafts. Fully live.
- **Retail Dashboard:** per-store goals scorecard with YoY and MTD-vs-goal comparisons.
- **Quiz (Octane AI):** Product recommendation quiz linked into Shopify AI Readiness
  metaobjects. 7 questions (hair type, thickness, scalp, wash frequency, chemical processes,
  finishing method, main pain).

---

## 5. GE Beauty Product Catalog & Content Rules

**13 active products + 1 sensorial:**
Shampoo Sem Sulfato, Shampoo a Seco, Máscara Condicionadora, Máscara Mayday, Leave-in Pluma,
Primer Liso Intacto, Primer Cachos Definidos, Leave-in com Proteção Térmica,
5 Boosters (Antifrizz, Hidratante, Definição, Fortificante, Antioxidante),
Melon Mood Body & Hair Splash.

**Non-existent product:** Booster Purificante — does NOT exist. Remove from any prompts or
copy that mentions it.

**HARD content rules (apply to all customer-facing copy):**
1. **Benefit-only language.** Never name technical active ingredients — describe by benefit
   only ("locks in moisture", not "sodium PCA + hyaluronic acid").
2. **No em dashes (—)** in customer-facing copy. Use commas, semicolons, or line breaks.
3. **`lancto` exclusion:** Products tagged `lancto` (Máscara Mayday + Melon Mood) are launch
   products — **always excluded from promotional campaigns and discount codes**.
4. **Fragrance is a retention driver in Brazil** and should be a primary PDP argument, not
   a footnote.

**Key pricing convention:**
- `compareAtPrice` = "de" (list price shown as strikethrough)
- `price` = "por" (active selling price)
- Promotional campaigns bake discounts into the `price` field, not into discount objects.

**BEAUTYBACK cashback codes:** Personalized per-customer discount codes in format
`BEAUTYBACK-AAAA-BBBB-CCCC`. Policy: 20% of most recent paid order subtotal; R$200
min-purchase cap; single-use; 10-day expiry per campaign. ~16,000 codes in the store.

---

## 6. Goals & Priorities

### Growth
- Build a brand that grows without depending on Camila's daily output.
- Scale content through a UGC/affiliate creator flywheel — AI-assisted briefs, scripts, and
  attribution feedback loops multiply Camila's message through external creators.
- Expand physical retail to new cities.

### Conversion & Retention
- Maximize LTV so paid acquisition becomes viable, and build a loyal repeat-purchase base
  independent of launch spikes.
- Core conversion insight: price objection surfaces when results disappoint — solve for
  result, not price. Key objection clusters: dryness/frizz post-use, wrong hair type fit,
  cost-benefit when results disappoint, lack of curl definition.

### Offline Retail
- Build a profitable, scalable store playbook that can expand to 10+ cities.
- Close the operational gaps across the 4 current stores: closing skills (SP),
  showrooming/location disadvantage (Rio), conversion execution (Recife x2).
  Eleonora owns this mandate.

### Tech & Infrastructure
- Give the GE Beauty team superpowers so a small team can operate at the scale of a much
  larger one.
- Build AI-assisted video production as a scalable content channel.

### Financial
- Make GE Beauty profitable and fully independent from Camila's personal finances.

---

## 7. Projects

- **GE Beauty (brand operations):** Digitally native beauty brand in the masstige segment.
  Runs on Shopify Plus with Klaviyo for email. Lucas is COO. Legal entity: GE Cosméticos
  Ltda. + Blog Garotas Estúpidas e Comércio de Vestuário Ltda.

- **GE Beauty physical retail:** 4 stores — two in Recife (Camila's hometown, strong brand
  recognition, best-performing), one in São Paulo (good foot traffic, gap in staff closing
  skills), one in Rio de Janeiro (structurally disadvantaged — located directly across from
  a Sephora, showrooming problem, weak brand awareness in the mall). Core gaps across all
  stores: in-store merchandising, staff training, and promotional/conversion execution.
  Eleonora owns this challenge.

- **GE Beauty tech stack:** Shopify Plus + Klaviyo (email). UpsellPlus ($119/mo) as primary
  checkout upsell lever. WhatsApp-to-Klaviyo migration in progress. Under evaluation:
  RetentionX (analytics backbone, partial Nemu replacement), Gorgias (CRM/support),
  Instant vs rePete (cart recovery and repeat purchases). Orita AI retained for Klaviyo
  list hygiene and deliverability. Nemu retained for WhatsApp and influencer attribution.

- **GE Beauty PDP rewriting:** Analyzed customer objection patterns from Brazilian haircare
  sources. Top clusters: dryness/frizz post-use, wrong hair type fit, cost-benefit when
  results disappoint, poor curl definition/day-after hold. Key insight: fragrance is a
  retention driver in Brazil and should be a primary PDP argument, not a footnote.

- **NAMI MCP connector:** Active integration with Shopify and Instagram tooling for GE Beauty.
  Instagram voice card generation blocked until Instagram account is linked in NAMI admin.

- **Brasília retail expansion:** Site selection analysis completed. Four candidates scored
  (Iguatemi Brasília, ParkShopping, Brasília Shopping, Conjunto Nacional) using weighted
  framework: catchment income, geolocated online customer demand, benchmark brand density,
  footfall. Iguatemi Brasília ranked first.

- **AI video generation (GE Beauty content):** Exploring AI video generation integrated with
  Claude Code for content production at scale. Breakthroughs achieved using Magnific MCP;
  Runway, Veo, and Kling also in scope.

- **Skincare line naming:** Researching brand naming for a new GE Beauty skincare line using
  multilingual soft-texture vocabulary.

---

## 8. Key Rules for Claude.ai Sessions

1. **Always confirm before writing to the live Shopify store.** Mutations that affect orders,
   prices, discounts, or customer data require explicit two-step confirmation.
2. **Benefit-only language in all customer-facing copy.** No ingredient names.
3. **Never include `lancto`-tagged products in promotions** (Máscara Mayday + Melon Mood).
4. **No em dashes in customer-facing copy.**
5. **Booster Purificante does not exist.** Remove it from any prompt or brief that mentions it.
6. **Default to single-code discounts**, not multi-code sets.
7. **Fragrance is a primary brand argument for GE Beauty in Brazil** — lead with it in any
   PDP or conversion copy.

---

## 9. Preferences

- Works across voice dictation, structured frameworks, and iterative dialogue.
- Role preference is orchestration — delegating, structuring decisions, and defining briefs
  rather than executing directly.
- Consistently applies structured analytical frameworks (Essentialism, Naval's specific
  knowledge framework) to business decisions.
- Responds best to direct, concrete recommendations followed by one clear tradeoff — not
  an exhaustive survey of options.
