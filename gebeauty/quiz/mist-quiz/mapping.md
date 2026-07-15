# Body & Hair Mist — profiles × scents routing table

> **Source of truth for the mist quiz.** Extracted verbatim from the client briefing deck
> `Briefing_Moodboard.pptx` (slide 2, "Perfil Olfativo") + line-territory from
> `../../content-director/2026-06-29_mist-line-themes.md`. No invented content.
>
> Every quiz answer maps 1:1 to one of the four mists via the columns below. This table is
> what the Octane AI instructions (`octane-paste/`) and the AI-readiness entries
> (`ai-readiness-mists.json`) are grounded in. Edit here first, then regenerate the chunks.

## The four mists

| Signal | **Melon Mood** | **Santal Skin** | **Rose Ritual** | **Pear Fresh** |
|---|---|---|---|---|
| SKU | GEB 024 | GEB 031 | GEB 032 | GEB 033 |
| Handle | `melon-mood-body-hair-mist` | `santal-skin-body-hair-mist` | `rose-ritual-body-hair-mist` | `pear-fresh-body-hair-mist` |
| Product ID | 9946377617728 | 10163564249408 | 10163564183872 | 10163564216640 |
| Frasco (cor) | Creme / off-white | Laranja | Rosa | Verde |
| Família olfativa | frutal fresco | amadeirado / aromático woody | floral, levemente cítrico | fresco e vegetal |
| Ingredientes | Melão, Peônia, White Musk | Sândalo, Patchouli, Cardamomo | Rosas, Lichia, Frutas Vermelhas | Pêra, Lírio, Musk |
| Hero words | cativante e extrovertida | marcante e sofisticada | feminina e delicada | vibrante e autêntica |
| Sensação | presença e conforto | poder e magnetismo | leveza e plenitude | energia e autenticidade |
| Benefício cabelo+corpo (IGUAL p/ todas — claim oficial da PDP) | perfuma, realça o brilho dos fios sem pesar, deixa a pele hidratada e macia | (idem) | (idem) | (idem) |

## Personality dimensions (each row = one quiz question; each cell = the answer that routes to that mist)

| Dimensão | Melon Mood | Santal Skin | Rose Ritual | Pear Fresh |
|---|---|---|---|---|
| **Estação** | verão | outono | inverno | primavera |
| **Hora do dia** | almoço | jantar | brunch | café da manhã |
| **Destino** | Grécia | Nova Iorque | Paris | Indonésia |
| **Situação** | rolê com amigos, praia, festa | networking, museu/galeria, drinks | arte, décor, viagem | aniversário, fim de semana, picnic, música alta |
| **Universo de palavras** | cativante · extrovertida · conectada · viva · curiosa · prática | marcante · sofisticada · elegante · magnética · sedutora · poderosa | feminina · delicada · plena · leve · presente · inspiradora · intuitiva | vibrante · autêntica · dinâmica · criativa · solar · ousada |
| **Aroma (direto)** | frutado e fresco (melão suculento) | amadeirado e quente (sândalo) | floral (buquê de rosas) | verde e leve (pêra com lírio) |

## Layering (6 pares oficiais — para a sugestão de "combina com")

Rose Ritual + Santal Skin · Pear Fresh + Melon Mood · Rose Ritual + Melon Mood ·
Santal Skin + Pear Fresh · Melon Mood + Santal Skin · Pear Fresh + Rose Ritual.

Per-mist suggested partner (pick from the official pairs above):
- **Melon Mood** → Pear Fresh (frescor) ou Santal Skin (contraste quente)
- **Santal Skin** → Pear Fresh (leveza) ou Melon Mood (frescor)
- **Rose Ritual** → Santal Skin (profundidade) ou Melon Mood (conforto)
- **Pear Fresh** → Melon Mood (suculência) ou Rose Ritual (floral)

## Tie-break rule (when a user's answers split across mists)

The AI aggregates the six answers as votes. On a tie, prefer in this order:
1. **Aroma (direto)** — the most explicit scent signal.
2. **Universo de palavras** — the personality anchor.
3. **Estação**.

Ambassadors (from deck slide 1, for UGC reference only, NOT used in quiz logic):
@camilacoutinho, @francesca, @isabela.mac, @renatavanzetto.
