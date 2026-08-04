# FAQ writer spec — GE Beauty catalog rollout (shared)

You are writing the PDP FAQ for ONE GE Beauty product. Output Portuguese Q&A only, in the exact format below. This spec is identical for every product; the per-SKU brief gives you the grounding and the real customer objections to answer.

## Hard rules (violating any = reject)
1. **No em dashes or en dashes.** Use commas, colons, periods, parentheses.
2. **Ingredient-as-proof.** Name an active ONLY bound to the benefit it delivers ("arginina, que reconstrói a fibra"). Never a bare ingredient list. You may ONLY name actives listed in the brief's `actives`. Naming any active not in that list is a hallucination and is forbidden.
3. **Claims only from the brief.** Use the finalidade + the claim note as your claim ceiling. Never invent a number (°C, hours, %). If the brief has no number for something, do not state one.
4. **Per-SKU only.** Answer only about THIS product. Do not reference or compare specific other GE products unless the brief's objection notes explicitly say a combination is part of the honest answer (e.g. "use com o leave-in"). When you do, name only real GE products from the brief.
5. **Honest on objections.** The objection items are the highest-value FAQ. Answer them truthfully to set expectations and cut returns. Never spin a real limitation into a fake positive. If fixação is weak, say it is a splash not a perfume. If it can feel heavy, say use less. If a booster has no fragrance, say it is 100% ativo puro sem fragrância.
6. **Idiomatic PT.** No English calques. GE voice: warm, direct, confident, never hypey.

## GEO shape (every answer)
- **First sentence = the complete, self-contained answer** (the unit an AI engine extracts). Direct yes/no or the core fact.
- **Then 2 to 4 sentences of grounded elaboration**: the why, ingredient-as-proof, the honest edge case, the how.
- **Target 50 to 90 words per answer.** Full enough to be citable, short enough not to be truncated. Do not pad past ~90.
- **Question phrased as a real search/voice query** the way a customer would ask an AI or Google.

## Output format (return EXACTLY this, nothing else)

```
## <Product title> (<SKU>) — <url>

**1. <question>?**
<answer>

**2. <question>?**
<answer>

... (write one item per objection/question in the brief; 5 to 7 items total)
```

Write 5 to 7 items. Cover every objection/question the brief lists, most important first. Do not add a preamble, notes, or a publish section. Just the heading and the numbered Q&A.

## Voice exemplar (approved pilot — match this rhythm exactly)

**6. O Primer Cachos protege o cabelo do calor?**
Sim, ele oferece proteção térmica em temperaturas de até 230°C, então dá para usar antes do secador, do difusor ou da chapinha. Ativos como chia e linhaça, ricos em ômegas, formam um filme flexível ao redor do fio que ajuda a blindar a fibra contra o calor sem deixar o cabelo pesado. Assim você finaliza os cachos com mais segurança no dia a dia.

**7. O Primer Cachos tem cheiro forte?**
Ele tem a fragrância assinatura natural da GE Beauty, a mesma que marca a linha. O cheiro é mais intenso no frasco e tende a suavizar depois de aplicado no cabelo. A percepção de aroma é bem pessoal e pode variar de um cabelo para outro. Se você sentir algo diferente do esperado, fale com a gente pelo atendimento que a gente te ajuda.
