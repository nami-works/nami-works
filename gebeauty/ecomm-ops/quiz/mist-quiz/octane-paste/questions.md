# Octane — Question pages (paste into Build tab)

> 6 question pages. All single-select. Copy each page title + options into Octane
> (Build → add Question page). Keep answer order identical across questions so the
> column position always maps to the same mist (col 1 = Melon, 2 = Santal, 3 = Rose, 4 = Pear).
> This ordering is what the AI instruction relies on for aggregation.
>
> After creating each page, name its variable exactly as in **Variable ref** — the Smart
> Property / Smart Products instructions reference these with `&Question` / `@Answer`.

Suggested quiz name in Octane: `mist_YY.MM.DD_qual-bruma` (mirror the hair quiz naming).

---

## Page 1 — Estação
**Título:** Escolha uma estação para viver o ano inteiro
**Variable ref:** `estacao`
- Verão
- Outono
- Inverno
- Primavera

## Page 2 — Momento do dia
**Título:** Qual é o seu momento favorito do dia?
**Variable ref:** `momento`
- Um almoço ao ar livre
- Um jantar especial
- Um brunch de domingo
- Um café da manhã sem pressa

## Page 3 — Destino
**Título:** O destino dos seus sonhos agora é...
**Variable ref:** `destino`
- Grécia
- Nova Iorque
- Paris
- Indonésia

## Page 4 — Situação
**Título:** Onde te encontram no fim de semana?
**Variable ref:** `situacao`
- Na praia ou numa festa com os amigos
- Em drinks, um museu ou um evento de networking
- Entre arte, décor e uma viagem
- Num aniversário ou picnic ao ar livre

## Page 5 — Personalidade
**Título:** A palavra que mais combina com você é...
**Variable ref:** `palavra`
- Viva e curiosa
- Marcante e poderosa
- Delicada e inspiradora
- Vibrante e ousada

## Page 6 — Aroma (sinal direto, também o critério de desempate)
**Título:** O aroma que te conquista de primeira?
**Variable ref:** `aroma`
- Frutado e fresco, tipo melão suculento
- Amadeirado e quente, tipo sândalo
- Floral, tipo um buquê de rosas
- Verde e leve, tipo pêra com lírio

---

## Other pages (mirror the hair quiz)
| Page | Type | Position |
|---|---|---|
| Opt-in (Email/SMS) | Opt-in | Before results |
| Telefone | Opt-in / Question | Before results |
| Cálculo de resultados | Explainer Screen | Before results (loading/transition) |

## Answer → mist map (for QA — do NOT paste, this is the answer key)
| Page | Opção 1 → Melon | Opção 2 → Santal | Opção 3 → Rose | Opção 4 → Pear |
|---|---|---|---|---|
| Estação | Verão | Outono | Inverno | Primavera |
| Momento | Almoço | Jantar | Brunch | Café da manhã |
| Destino | Grécia | Nova Iorque | Paris | Indonésia |
| Situação | Praia/festa | Drinks/museu | Arte/décor | Aniversário/picnic |
| Palavra | Viva e curiosa | Marcante e poderosa | Delicada e inspiradora | Vibrante e ousada |
| Aroma | Melão | Sândalo | Rosas | Pêra |
