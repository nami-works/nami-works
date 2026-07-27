# GE Beauty website icons — registry

Production storefront icons produced by `/iconographer` (Otto).

Two families live here:

- **Institutional SVG family** (`_reference/`) — the four locked institutional marks
  (fórmulas limpas / não testado em animais / vegano / 100% reciclável), consumed via the
  `icones` metaobject set. Standard: `.claude/skills/iconographer/references/icon-standard.md`.
- **Benefit-icon family (`icon-150-*.png`)** — the transparent single-color GE-red line
  marks used in PDP/LP "benefícios em destaque" rows. Rendered via product metafield
  `custom.imagem_beneficio_em_destaque_1..3` (file_reference → MediaImage). This is a PNG
  family (red line art centered inside a thin GE-red circle ring, `#DF3630`, transparent).
  New members are authored to match the live `icon-150-*` geometry (ring r≈72/150 canvas,
  ~2.2% stroke weight) via `_make_benefit_icons_150.py` (PIL, 4x supersample → 512px PNG).

## Benefit icons — primeira-rotina LP (2026-07-25)

Produced for the primeira-rotina bundle LP benefit callouts. Reuse-first: only
`protege do calor` had an existing on-standard match; the other four were newly authored.

| Concept (label) | File | Shopify MediaImage GID | New / Reused |
|---|---|---|---|
| protege do calor | icon-150-protecao-termica.png (existing) | gid://shopify/MediaImage/41609342583104 | Reused |
| ritual completo | icon-150-ritual-completo.png | gid://shopify/MediaImage/44035754819904 | New |
| cabe na sua bolsa | icon-150-cabe-na-bolsa.png | gid://shopify/MediaImage/44035754885440 | New |
| frescor que dura | icon-150-frescor-que-dura.png | gid://shopify/MediaImage/44035754918208 | New |
| mais dias de raiz leve | icon-150-mais-dias-raiz-leve.png | gid://shopify/MediaImage/44035754983744 | New |

### Regenerated 2026-07-25 — nutrição profunda (AI-slip replacement)

Lucas flagged the reused `icon-150-nutricao` (jar + leaf) as a bad AI-generated icon.
Authored a fresh replacement deterministically in PIL (`_make_nutricao_profunda_150.py`).
The old `icon-150-nutricao` was left untouched (may be used elsewhere store-wide).

| Concept (label) | File | Shopify MediaImage GID | New / Reused |
|---|---|---|---|
| nutrição profunda | icon-150-nutricao-profunda.png | gid://shopify/MediaImage/44035979903296 | New (replaces slip) |

Metaphor: a nourishing droplet beside a wavy hair strand (deep nourishment / hydration).

### Superseded 2026-07-25 — Lucas picked simpler marks from the icon-system artifact

Lucas reviewed the icon-system artifact and preferred a pure single drop (over the
droplet+strand) for nutrição profunda, and a two-leaf sprout for raiz leve por mais tempo.
NOTE: the artifact labeled the sprout "já na biblioteca", but no two-leaf sprout exists —
the library "Sem sulfatos" file (43873569964352) is a single slashed leaf. The sprout was
authored fresh here (`_make_drop_sprout_150.py`).

| Concept (label) | File | Shopify MediaImage GID | New / Reused |
|---|---|---|---|
| nutrição profunda (pure drop, supersedes droplet+strand) | icon-150-nutricao-profunda-drop.png | gid://shopify/MediaImage/44036132569408 | New |
| raiz leve por mais tempo (two-leaf sprout) | icon-150-raiz-leve-sprout.png | gid://shopify/MediaImage/44036132700480 | New |

### Superseded 2026-07-25 — ritual completo → infinity

Lucas replaced the 3-numbered-circles ritual-completo mark (44035754819904) with a clean
infinity loop (routine as a continuous loop). Slot 1 on both bundles.

| Concept (label) | File | Shopify MediaImage GID | New / Reused |
|---|---|---|---|
| ritual completo (infinity, supersedes 3-circles) | icon-150-ritual-completo-infinito.png | gid://shopify/MediaImage/44036167795008 | New |

### Refined 2026-07-25 — rounder infinity + new hourglass

- ritual completo: rounder infinity (two circular loops + gentle X crossing, arc-based —
  Gerono figure-eight was too pinched). Supersedes 44036167795008. Slot 1 both bundles.
- efeito duradouro: hourglass = the infinity rotated 90° (vertical figure-eight, concave
  waist) + falling sand grains.

| Concept (label) | File | Shopify MediaImage GID | New / Reused |
|---|---|---|---|
| ritual completo (rounder infinity) | icon-150-ritual-completo-infinito-round.png | gid://shopify/MediaImage/44036244439360 | New |
| efeito duradouro (hourglass) | icon-150-efeito-duradouro.png | gid://shopify/MediaImage/44036244570432 | New |

### Refined 2026-07-25 — infinity inner-knot softened

ritual completo: softened the inner X crossing. The crossover connectors now leave/enter
the loop arcs tangentially (bezier handle length L=64), so the middle reads as a smooth,
gently-angled transition instead of a hard point. Outer lobes unchanged. Supersedes
44036244439360. Slot 1 both bundles.

| Concept (label) | File | Shopify MediaImage GID | New / Reused |
|---|---|---|---|
| ritual completo (soft-crossing infinity) | icon-150-ritual-completo-infinito-round-v2.png | gid://shopify/MediaImage/44036309647680 | New |

### Course-corrected 2026-07-25 — TRUE crossover, softened angle

v2 (round-v2) went too far and became two circles kissing (lost the crossover). Rebuilt as
a real figure-eight: each loop is drawn as a "C" (inner arc left out so loop edges stay off
center), and the central X is formed by two tangential bezier connectors that ACTUALLY
CROSS/overlap. The tangential curvature softens the crossing angle so it reads as a smooth
woven ∞ rather than a sharp pinch. Supersedes 44036309647680. Slot 1 both bundles.

| Concept (label) | File | Shopify MediaImage GID | New / Reused |
|---|---|---|---|
| ritual completo (true soft crossover) | icon-150-ritual-completo-infinito-cross.png | gid://shopify/MediaImage/44036353524032 | New |

### Options set 2026-07-25 — 3 crossover-angle variants for Lucas to pick

All true-crossover figure-eights (real overlap, soft angle), each a distinct geometry.
Generator: `_make_infinity_options_150.py`. Lucas picks; then swap slot 1 both bundles.

| Variant | File | Shopify MediaImage GID | Angle / geometry |
|---|---|---|---|
| A steep | icon-150-ritual-completo-infinito-steep.png | gid://shopify/MediaImage/44036402577728 | loops close, steep near-vertical crossing |
| B open | icon-150-ritual-completo-infinito-open.png | gid://shopify/MediaImage/44036402610496 | loops apart, broad flat/open crossover (horizontal ∞) |
| C oval | icon-150-ritual-completo-infinito-oval.png | gid://shopify/MediaImage/44036402643264 | lean oval loops, elongated long figure-eight |

Metaphors: ritual completo = 3 numbered circles in a 1→2→3 flow (numeral-as-mark);
cabe na sua bolsa = mini bottle beside a necessaire/pouch; frescor que dura = breeze
waves passing a wavy hair strand + sparkle; mais dias de raiz leve = calendar + light leaf.

Not wired to any `icones` metaobject (benefit icons render via the product metafield, not
the institutional icon section). design-engineer owns setting the product metafields.
