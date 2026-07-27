# RFM segments — GE Beauty (the 11 the store actually runs)

These are **Shopify-native RFM segments** (`rfm_group`), the same groups
`gebeauty/retention-machine/build_disparador_rfm.py` reads and the same ones the
legacy CRM Lab prompt was built around. Use the handles + behavioral definitions
verbatim. Never invent a segment, never reassign a segment's behavior, never guess
membership — if the brief needs live counts, pull `rfm_group` from the store.

## The map

RFM = **R**ecency (how recently they bought) · **F**requency (how often) · **M**onetary
(how much). Each segment is a position on those axes, with a matched emotional lever,
product-mention logic, and CTA shape. "Product mention" tells you *what kind* of product
to surface; the specific product always comes from the **live catalog**, never this doc.

| Handle | Segment | Behavior (R / F / M) | Tone | Emotional lever | Product mention | CTA shape |
|---|---|---|---|---|---|---|
| `00_prospect` | Prospect | No orders yet (no R/F/M) | Welcoming + inspiring | Discovery + trust | Bestsellers + social proof | "Comece sua jornada com a gente." |
| `01_loyal` | Loyal | Not recent, but very strong order + spend history | Respectful + warm | Memory + reconnection | What she already loved | "Seu ritual está te esperando." |
| `02_needs_attention` | Needs Attention | Buys less recently, sometimes, moderate spend | Soft + caring | Time + balance | Easy, low-effort options | "Deixe o cuidado voltar no seu tempo." |
| `03_almost_lost` | Almost Lost | Not recent, fewer orders, lower spend | Light + respectful | Choice + self-time | Low-friction single product | "Quando estiver pronta, a gente está aqui." |
| `04_champion` | Champion | Very recent, many orders, highest spend | Grateful + exclusive | Recognition + belonging | New / preview / first access | "Celebre com a gente, primeiro." |
| `05_at_risk` | At Risk | Not recent, but strong order + spend history | Honest + inviting | Connection + memory | What she used to love | "Adoraríamos te ver de novo." |
| `06_previously_loyal` | Previously Loyal | Not recent, very strong history | Warm + reflective | Journey + identity | New launch + old favorites | "Vamos começar um novo capítulo, juntas." |
| `07_active` | Active | Recent, some orders, moderate spend | Affirming + uplifting | Progress + confidence | Suggested next step | "Vamos ainda mais longe juntas." |
| `08_new` | New | Very recent, few orders, low spend | Friendly + welcoming | Discovery + curiosity | Starter kits, basics | "Seu ritual está só começando." |
| `09_promising` | Promising | Recent, few orders, low spend | Encouraging + close | Potential + intimacy | Light exploration | "Mais um passo na sua história." |
| `10_dormant` | Dormant | Not recent, infrequent, low spend | Minimal + thoughtful | Distance + permission | One gentle suggestion | "Sem pressa. Só cuidado." |

## Adaptation rules

- **One lever per message.** Lead with the segment's emotional lever, not a feature
  list. The product enters as *proof of the lever*, not as the headline.
- **Recency governs urgency.** High-recency segments (`04`, `07`, `08`, `09`) can carry
  a forward "next step" CTA. Low-recency segments (`01`, `05`, `06`, `10`) get
  reconnection first, offer second, and never pressure — `10_dormant` especially is
  permission-based ("sem pressa").
- **Monetary governs exclusivity.** High-M segments (`04`, `01`, `05`, `06`) can be
  offered early access / preview / recognition. Low-M segments get accessible entry
  points, not "exclusive" framing they haven't earned into.
- **Frequency governs the ask.** High-F = deepen the ritual (cross-sell the next step).
  Low-F = reduce friction (one product, one clear reason).
- **Prospect (`00`) is not a customer yet.** No "welcome back", no purchase history
  references, no loyalty language. Discovery + proof only.

## Product-to-segment matching

When you pick the featured product in pass 3, match the segment's "product mention"
column against the **live catalog**:

- Bestsellers / social-proof-heavy → `00`, `08`
- "What she loved" (needs the customer's own history; for a broadcast, use the
  line's hero) → `01`, `05`, `06`
- New launch / preview → `04`, `06`, `07`
- Low-friction single SKU → `02`, `03`, `09`, `10`

Never surface a `lancto` launch product in campaign-discount copy (locked brand rule).

## Where membership comes from

- **Definitions:** this doc (stable).
- **Live membership + counts:** the store's native `rfm_group` customer segments, read
  the same way `build_disparador_rfm.py` reads them. You only need membership when the
  brief asks for volume estimates or a real disparo list — copywriting itself needs
  only the definitions above.
- **Do not** hand-classify customers or approximate a segment from order data yourself;
  the store already computes RFM. Read it, don't recompute it.
