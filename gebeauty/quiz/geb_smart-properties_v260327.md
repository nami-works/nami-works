# Quiz GE Beauty | Octane AI — v260327

## Changelog

| Versão | Data | Mudanças |
|--------|------|----------|
| v251216 | 2025-12-16 | Versão original com prompts detalhados |
| v260327 | 2026-03-27 | Otimização Octane AI: Smart Products simplificados (tabelas → regras concisas), Smart Properties com fallback text, remoção de "Resumo técnico para IA" e "Referência técnica interna" redundantes, status de produção em cada prompt, ~50% menor |

---

## IMPORTANTE: Este documento contém a lógica REAL do quiz em produção e os smart prompts relacionados a ele

Ao criar novos fluxos ou ajustes:

1. **Seguir exatamente a mesma estrutura** e lógica apresentada
2. **Manter a coerência** entre as categorias — todas fazem parte do mesmo quiz
3. **Complementar** o conteúdo existente
4. **Usar o mesmo tom de voz** (acolhedor, técnico, sensorial — característico da GE Beauty)
5. **Referenciar as perguntas do quiz** com a sintaxe `(Question: …)` sempre que relevante

---

## Visão Geral do Quiz GE Beauty

Smart properties e smart products abaixo são gerados a partir das respostas do quiz. Campos disponíveis:

1. **(Question: tipo de cabelo)** — `liso`, `ondulado`, `cacheado`, `crespo`
2. **(Question: espessura)** — `fino`, `médio`, `grosso`
3. **(Question: couro cabeludo)** — `seco`, `equilibrado`, `oleoso`, `sensível`
4. **(Question: frequência lavagem)** — `todos os dias`, `a cada 2 dias`, `entre 2 e 3 vezes por semana`, `1 vez por semana`
5. **(Question: processos químicos)** — `alisamento`, `coloração`, `descoloração`, `nenhum`
6. **(Question: finalização)** — `escova`, `babyliss`, `cachos`, `secador`, `chapinha`, `seco ao natural`
7. **(Question: dor principal)** — `seco`, `fraco ou quebradiço`, `frizz`, `falta de definição`, `opacos e sem brilho`, `queda`, `oleoso`

---

## Duas abordagens disponíveis

### **ABORDAGEM 1: Prompts Detalhados por Categoria** (LIMPEZA, TRATAMENTO, FINALIZAÇÃO) — ✅ PARCIALMENTE EM PRODUÇÃO
- Cada categoria tem 5 prompts (intro + bases + explicação bases + boosters + explicação boosters)
- Atualmente em produção: apenas os Smart Products de bases ([1.a], [2.a], [3.a])
- Smart Properties e boosters por categoria: ainda não implantados

### **ABORDAGEM 2: Prompts Globais Unificados** (SMART PROPERTIES GLOBAIS + BOOSTERS CONSOLIDADOS) — ✅ PARCIALMENTE EM PRODUÇÃO
- diagnostico-capilar e [4. boosters] em produção
- intro-geral, ritual-resumido e explicacao-boosters: ainda não implantados

---

## Tipos de prompts

**Smart Property** = Texto personalizado gerado por IA com base nas respostas do quiz
**Smart Product** = Lógica de recomendação de produtos baseada nas respostas do quiz

---

# ═══════════════════════════════════════════════════════
# SMART PROPERTY GLOBAL – RAIO-X CAPILAR
# ═══════════════════════════════════════════════════════

# Smart property {{diagnostico-capilar}} — ✅ EM PRODUÇÃO

Gere um **resumo diagnóstico visual e direto** com base nas respostas do quiz, destacando as **principais características e objetivos capilares** da usuária.
O texto deve sempre começar com o formato fixo **"cabelo [tipo] e [espessura]"**, seguido de **2 a 3 objetivos principais**, separados por "•".

---

## Estrutura esperada

```
cabelo [tipo] e [espessura] • objetivo 1 • objetivo 2 • objetivo 3
```

## Referências obrigatórias

- (Question: tipo de cabelo)
- (Question: espessura ou textura)
- (Question: processos químicos)
- (Question: dor principal)
- (Question: finalização)

## Instruções

1. Sempre começar com `cabelo [tipo_de_cabelo] e [espessura_dos_fios]`.
2. Incluir **2 ou 3 objetivos principais** separados por "•", que representem **resultados esperados** (não sintomas).
3. Tom: **positivo, técnico e aspiracional**. Ex: "fortalecimento" em vez de "quebra".
4. Não usar frases completas, verbos conjugados ou adjetivos negativos.
5. O texto deve caber em uma linha — um **raio-x de objetivos**.

## Exemplos

| Perfil | Saída |
|--------|-------|
| Liso, fino, frizz | `cabelo liso e fino • controle do frizz • brilho leve • proteção térmica` |
| Cacheado com química | `cabelo cacheado e médio • definição • reparação • força` |
| Crespo ressecado | `cabelo crespo e espesso • nutrição • elasticidade • controle do volume` |

## Vocabulário de objetivos

`fortalecimento`, `nutrição`, `hidratação profunda`, `controle do frizz`, `reparação`, `proteção térmica`, `proteção solar`, `cor vibrante`, `brilho intenso`, `definição`, `elasticidade`, `leveza natural`, `volume equilibrado`, `força`, `maciez`, `equilíbrio do couro`.

**Fallback text:** cabelo saudável e equilibrado • hidratação • brilho • proteção

---

# ═══════════════════════════════════════════════════════
# SMART PROPERTY GLOBAL – INTRODUÇÃO GERAL
# ═══════════════════════════════════════════════════════

# Smart property {{intro-geral}} — ⏸️ NÃO IMPLANTADO

Gere um texto introdutório **personalizado e sensorial** (2–3 frases, máx. 60 palavras) que apresente o diagnóstico capilar e introduza o ritual GE Beauty.

## Referências: (Question: tipo de cabelo), (Question: processos químicos), (Question: dor principal), (Question: finalização), (Question: couro cabeludo)

## Instruções

1. **Frase 1 — Diagnóstico:** contextualiza tipo de cabelo e necessidades.
2. **Frase 2 — Ritual:** apresenta a rotina GE Beauty como solução personalizada.
3. **Frase 3 (opcional) — Sensação:** antecipa o resultado esperado.

Tom: técnico, acolhedor e sensorial. Evitar nomes de produtos. Adaptar vocabulário:
- Lisos/ondulados: leveza, brilho, alinhamento
- Cacheados/crespos: definição, elasticidade, nutrição
- Com química: reconstrução, selagem, proteção
- Com frizz: controle, suavidade, polimento
- Couro oleoso: equilíbrio, frescor, regulação

## Exemplo

> Seu cabelo é cacheado e hoje precisa de definição e nutrição.
> O ritual GE Beauty combina fórmulas inteligentes que se adaptam às suas necessidades, equilibrando o couro, fortalecendo a fibra e protegendo o brilho natural.

**Fallback text:**
> Seu cabelo merece um cuidado pensado especialmente para ele.
> O ritual GE Beauty combina ciência e sensorialidade, equilibrando o couro, nutrindo a fibra e protegendo o brilho natural de cada fio.
> Um sistema inteligente que se adapta às suas necessidades e transforma sua rotina em um momento de autocuidado.

---

# ═══════════════════════════════════════════════════════
# SMART PROPERTY GLOBAL – RITUAL COMPLETO RESUMIDO
# ═══════════════════════════════════════════════════════

# Smart property {{ritual-resumido}} — ⏸️ NÃO IMPLANTADO

Gere um **resumo único e fluido** do ritual capilar personalizado (Limpeza → Tratamento → Finalização → Boosters), com base nas respostas do quiz e nos produtos retornados pelos Smart Products.

## Referências: (Question: tipo de cabelo), (Question: processos químicos), (Question: dor principal), (Question: finalização), (Question: couro cabeludo)

## Instruções

- 4 blocos narrativos curtos (2 frases cada), um por etapa.
- Tom técnico-sensorial, fluido — não uma lista rígida.
- Máx. 90 palavras total.
- Ordem fixa: Limpeza → Tratamento → Finalização → Boosters.
- Adaptar vocabulário ao tipo de cabelo e dor principal.
- Evitar instruções de uso. Focar em benefícios percebidos e efeito sensorial.

## Exemplo

> **Limpeza:** O Shampoo GE Beauty limpa suavemente e equilibra o couro cabeludo, preparando os fios para receber tratamento.
> **Tratamento:** A Máscara Condicionadora e o Leave-in nutrem, restauram e fortalecem a fibra, devolvendo brilho e vitalidade.
> **Finalização:** O Primer e o Leave-in Pluma selam e protegem os fios, garantindo controle do frizz e toque leve.
> **Boosters:** Os Boosters potencializam o tratamento em todas as etapas, reforçando maciez, proteção e luminosidade.

**Fallback text:**
> **Limpeza:** O Shampoo GE Beauty limpa suavemente e respeita o equilíbrio natural do couro cabeludo.
> **Tratamento:** A Máscara Condicionadora nutre, hidrata e devolve a maciez, enquanto o Leave-in reforça a vitalidade.
> **Finalização:** O Primer e o Leave-in Pluma selam e protegem os fios do calor e da umidade, garantindo leveza e brilho.
> **Boosters:** Os Boosters GE Beauty potencializam cada etapa, oferecendo mais brilho, força e proteção conforme a necessidade dos fios.

---
---
---

# ═══════════════════════════════════════════════════════
# CATEGORIA: LIMPEZA
# ═══════════════════════════════════════════════════════

# Smart property {{intro-limpeza}} — ⏸️ NÃO IMPLANTADO

Crie um resumo breve e personalizado sobre o perfil capilar do respondente, com base em (Question: couro cabeludo), (Question: frequência lavagem) e (Question: processos químicos).

## Instruções

- Tom acolhedor e positivo, como devolutiva de diagnóstico profissional feita por alguém próximo.
- Não citar produtos — apenas descrever o tipo de necessidade de limpeza.
- Máx. **3 frases curtas**. Transmitir sensação de que o cabelo foi compreendido.

## Exemplos (não copiar literalmente)

- "Seu couro cabeludo pode ter tendência à oleosidade e pede uma limpeza leve, mas equilibrada."
- "Como você lava os cabelos com frequência moderada e tem couro equilibrado, uma rotina suave é ideal."
- "Por conta da química, seu couro pode pedir uma limpeza protetora e nutritiva."

**Fallback text:** Seu couro cabeludo merece uma limpeza equilibrada e gentil, que respeite sua natureza e prepare os fios para o cuidado completo.

---

# Smart product [1.a) bases limpeza] — ✅ EM PRODUÇÃO

## Regras de recomendação

**Produtos disponíveis:** Shampoo Sem Sulfato, Shampoo a Seco

**Regras:**
- O **Shampoo Sem Sulfato** é sempre recomendado para todos os perfis — limpa sem ressecar e preserva o equilíbrio natural.
- Adicionar **Shampoo a Seco** quando:
  - (Question: couro cabeludo) = oleoso (qualquer frequência de lavagem)
  - (Question: couro cabeludo) = sensível COM oleosidade localizada (uso pontual nas raízes)
  - Couro oleoso + química (controla oleosidade sem agredir)

**Prioridade de decisão:** couro cabeludo → frequência lavagem → processos químicos

**Tom da justificativa:** técnico e acolhedor, focando em equilíbrio, leveza e conforto.

---

# Smart property {{explicacao-bases-limpeza}} — ⏸️ NÃO IMPLANTADO

Gere uma explicação curta dos produtos recomendados pelo Smart Product [1.a) bases limpeza], personalizada com base em (Question: couro cabeludo), (Question: frequência lavagem) e (Question: processos químicos).

## Instruções

- Comece com uma frase introdutória (ex: "Sua limpeza ideal começa...").
- Uma frase por produto recomendado, máx. 7 palavras por frase.
- As frases devem dar continuidade à {{intro-limpeza}}, formando uma única sentença fluida.
- Tom: acolhedor, educativo e sensorial.
- O **Shampoo Sem Sulfato** é mencionado sempre. O **Shampoo a Seco** só quando recomendado.
- Em couro sensível com oleosidade localizada, descrever Shampoo a Seco como "uso pontual nas raízes".

**Fallback text:** Sua limpeza ideal começa com o Shampoo Sem Sulfato, que limpa suavemente e preserva o equilíbrio natural do seu couro cabeludo.

---

# Smart product [1.b) boosters limpeza] — ⏸️ NÃO IMPLANTADO

## Regras de recomendação

**Produtos disponíveis:** Booster Fortificante, Booster Antioxidante, Booster Antifrizz

Os boosters atuam de forma **direcionada ao couro cabeludo**, potencializando a etapa de limpeza.

**Regras:**
- Recomendar **1 a 2 boosters** conforme necessidade.
- **Booster Fortificante** — priorizar quando: couro oleoso (regula sebo, fortalece raiz), fios fracos/quebradiços.
- **Booster Antioxidante** — priorizar quando: processos químicos (protege couro sensibilizado), couro seco (hidrata e restaura barreira), couro sensível (acalma e equilibra).
- **Booster Antifrizz** — adicionar condicionalmente quando há frizz visível na raiz.

**Prioridade de decisão:** processos químicos → sensibilidade → oleosidade → frizz na raiz

**Tom da justificativa:** técnico e acolhedor, focando em equilíbrio, força e proteção do couro.

---

# Smart property {{explicacao-boosters-limpeza}} — ⏸️ NÃO IMPLANTADO

Gere **uma frase curta por booster recomendado** pelo Smart Product [1.b) boosters limpeza], explicando como ele potencializa a limpeza.

## Instruções

- 1 frase por booster (máx. 25 palavras cada).
- Aberturas sugeridas: "Para potencializar sua limpeza,", "Para complementar sua rotina,".
- Adaptar tom conforme química ou sensibilidade do couro.
- Focar em benefício sensorial pós-limpeza, sem instruções de uso.

**Fallback text:** Para potencializar sua limpeza, os Boosters GE Beauty fortalecem a raiz e protegem o couro cabeludo, promovendo equilíbrio e vitalidade desde a primeira lavagem.

---
---
---

# ═══════════════════════════════════════════════════════
# CATEGORIA: TRATAMENTO
# ═══════════════════════════════════════════════════════

# Smart property {{intro-tratamento}} — ⏸️ NÃO IMPLANTADO

Crie um texto introdutório personalizado sobre o **momento de tratamento dos fios**, com base em (Question: tipo de cabelo), (Question: espessura), (Question: processos químicos) e (Question: dor principal).

## Instruções

- Até **3 frases curtas**. Não citar produtos.
- Frase 1: conecta o perfil ao momento de tratamento.
- Frase 2: descreve o objetivo principal (nutrição, reparação, hidratação, reconstrução).
- Frase 3 (opcional): sensação de cuidado profundo.
- Tom: técnico, sensorial e positivo. Vocabulário: *nutre, repara, restaura, fortalece, devolve vitalidade*.

Adaptar conforme:
- Liso: leveza, brilho, nutrição sem peso
- Ondulado: movimento, hidratação, maleabilidade
- Cacheado: elasticidade, definição, nutrição profunda
- Crespo: reconstrução, nutrição intensa, resistência
- Finos: leveza, sem acúmulo | Grossos: força, selagem
- Com química: reparação da fibra, reconstrução

## Exemplos (não copiar literalmente)

- "Seu momento de tratamento é sobre reparar e devolver o brilho — nutrir sem pesar."
- "O tratamento devolve vida aos seus cachos — nutrição, elasticidade e definição."

**Fallback text:** O momento de tratamento é sobre devolver equilíbrio e vitalidade aos fios — nutrição profunda que restaura, fortalece e revela o brilho natural do seu cabelo.

---

# Smart product [2.a) bases tratamento] — ✅ EM PRODUÇÃO

## Regras de recomendação

**Produtos disponíveis:** Máscara Condicionadora, Leave-in Pluma, Máscara Mayday

**Regras:**
- A **Máscara Condicionadora** é sempre obrigatória — base universal de nutrição e reparação.
- Adicionar **Leave-in Pluma** quando:
  - Fios finos (película protetora ultraleve)
  - Processos químicos (repara e repõe lipídios)
  - Fios grossos (força e selagem)
  - Dor principal = frizz intenso, ressecamento, quebra ou opacidade
- Adicionar **Máscara Mayday** quando:
  - Dano severo: descoloração, química sobreposta ou quebra severa
  - É tratamento de reconstrução profunda (uso 1x a cada 15 dias, alternando com hidratação/nutrição)
  - Não substitui a Máscara Condicionadora no dia a dia

**Prioridade de decisão:** dor principal → processos químicos → tipo de cabelo → espessura

**Tom da justificativa:** técnico e acolhedor, focando em nutrição, reparação e efeito sensorial.

---

# Smart property {{explicacao-bases-tratamento}} — ⏸️ NÃO IMPLANTADO

Gere uma explicação personalizada dos produtos recomendados pelo Smart Product [2.a) bases tratamento], conectando o diagnóstico do quiz à lógica da recomendação.

## Instruções

- Frase introdutória conectando diagnóstico ao tratamento.
- Uma frase por produto (máx. 7 palavras cada).
- Parágrafo único, tom sensorial e científico.
- Personalizar conforme tipo de cabelo, química e dor principal.
- Nunca mencionar "modo de uso" — apenas efeitos e sensações.

## Exemplos (não copiar literalmente)

- "Seu tratamento é sobre leveza e brilho — a Máscara devolve hidratação equilibrada e o Leave-in Pluma preserva a suavidade sem pesar."
- "Reconstrução intensa — a Máscara repõe lipídios e o Leave-in reforça resistência e brilho."

**Fallback text:** O tratamento GE Beauty nutre e repara seus fios — a Máscara Condicionadora devolve maciez e vitalidade, preparando o cabelo para um resultado visível e duradouro.

---

# Smart product [2.b) boosters tratamento] — ⏸️ NÃO IMPLANTADO

## Regras de recomendação

**Produtos disponíveis:** Booster Antifrizz, Booster Hidratante, Booster Fortificante, Booster Definição

Os boosters complementam a Máscara Condicionadora e o Leave-in Pluma com benefícios direcionados.

**Regras:**
- Recomendar **1 booster principal** + complementares se necessário.
- **Booster Antifrizz** — quando (Question: dor principal) = frizz. Ideal para lisos, ondulados ou com química.
- **Booster Hidratante** — quando (Question: dor principal) = ressecamento, aspereza ou opacidade. Também para coloração.
- **Booster Fortificante** — quando (Question: dor principal) = fios fracos, quebradiços ou queda. Também para alisamento e descoloração (alternar com Hidratante).
- **Booster Definição** — quando (Question: dor principal) = falta de definição, em cabelos com curvatura (ondulados, cacheados, crespos).

**Refinamento por química:**
- Alisamento → Fortificante
- Coloração → Hidratante
- Descoloração → Hidratante + Fortificante (alternar)

**Refinamento por tipo de cabelo (quando dor principal não é decisiva):**
- Liso → Antifrizz | Ondulado → Hidratante | Cacheado → Definição | Crespo → Definição

**Prioridade de decisão:** dor principal → processos químicos → tipo de cabelo

---

# Smart property {{explicacao-boosters-tratamento}} — ⏸️ NÃO IMPLANTADO

Gere **uma frase curta por booster recomendado** pelo Smart Product [2.b) boosters tratamento], explicando como potencializa o tratamento.

## Instruções

- 1 frase por booster (máx. 25 palavras cada).
- Aberturas: "Para potencializar seu tratamento,", "Para complementar o cuidado,".
- Adaptar tom conforme tipo de cabelo e dor principal.
- Focar em benefício sensorial e resultado perceptível.

**Fallback text:** Para potencializar seu tratamento, os Boosters GE Beauty atuam na fibra capilar com nutrição e proteção direcionadas, revelando fios mais fortes e luminosos.

---
---
---

# ═══════════════════════════════════════════════════════
# CATEGORIA: FINALIZAÇÃO
# ═══════════════════════════════════════════════════════

# Smart property {{intro-finalizacao}} — ⏸️ NÃO IMPLANTADO

Crie um texto introdutório personalizado sobre o **momento de finalização**, com base em (Question: tipo de cabelo), (Question: finalização), (Question: processos químicos) e (Question: dor principal).

## Instruções

- Até **3 frases curtas**. Não citar produtos.
- Apresentar a finalização como o toque final do ritual — proteção, acabamento e sensorialidade.
- Tom: técnico, sensorial e inspirador. Vocabulário: *protege, sela, alinha, define, realça, preserva o movimento*.

Adaptar conforme:
- Liso: alinhamento, brilho espelhado, proteção térmica (se calor)
- Ondulado: movimento, controle de frizz, leveza
- Cacheado: definição, maciez, elasticidade
- Crespo: nutrição profunda, definição firme, brilho
- Com calor: proteção térmica, alinhamento, durabilidade
- Natural: leveza, toque suave, movimento natural

## Exemplos (não copiar literalmente)

- "Seu ritual termina com o toque que transforma — brilho e proteção para manter o liso leve."
- "Na finalização, seus fios ganham movimento e controle — definição suave e aparência saudável."

**Fallback text:** A etapa de finalização é o toque que sela, protege e realça o resultado de todo o seu ritual — fios com brilho, leveza e movimento natural.

---

# Smart product [3.a) bases finalizacao] — ✅ EM PRODUÇÃO

## Regras de recomendação

**Produtos disponíveis:** Primer Liso Intacto, Primer Cachos Definidos, Leave-in com Proteção Térmica, Leave-in Pluma

**Regras:**
- Recomendar **1 ou 2 produtos**, conforme tipo de cabelo e finalização.
- **Primer Liso Intacto** — para cabelos lisos ou ondulados que fazem finalização com calor (escova, chapinha). Sela cutículas, reduz frizz, alinhamento duradouro.
- **Primer Cachos Definidos** — para ondulados, cacheados e crespos (finalização natural ou com difusor). Define curvatura, hidrata, protege da umidade.
- **Leave-in com Proteção Térmica** — sempre que houver uso de calor (secador, chapinha, babyliss, difusor). Protege até 230°C.
- **Leave-in Pluma** — para finalização natural sem calor, ou como complemento leve (frizz, leveza, disciplina). Também para cacheados/crespos com química.

**Lógica de combinação por tipo + finalização:**
- Liso + calor → Primer Liso Intacto + Leave-in com Proteção Térmica
- Liso + natural → Leave-in Pluma
- Ondulado + natural → Primer Cachos Definidos
- Ondulado + difusor/babyliss → Primer Cachos Definidos + Leave-in com Proteção Térmica
- Ondulado + escova/chapinha → Primer Liso Intacto + Leave-in com Proteção Térmica
- Cacheado + natural → Primer Cachos Definidos
- Cacheado + difusor → Primer Cachos Definidos + Leave-in com Proteção Térmica
- Crespo + natural → Primer Cachos Definidos
- Crespo + difusor → Primer Cachos Definidos + Leave-in com Proteção Térmica

**Refinamento por química:** reforçar produtos com proteção térmica e selagem.

**Refinamento por dor principal:**
- Frizz (lisos/ondulados) → Primer Liso Intacto + Leave-in Pluma
- Frizz (cacheados/crespos) → Primer Cachos Definidos + Leave-in Pluma
- Seco/opaco/sem definição → Primer Cachos Definidos + Leave-in com Proteção Térmica

**Prioridade de decisão:** finalização → tipo de cabelo → processos químicos → dor principal

---

# Smart property {{explicacao-bases-finalizacao}} — ⏸️ NÃO IMPLANTADO

Gere uma explicação personalizada dos produtos recomendados pelo Smart Product [3.a) bases finalizacao].

## Instruções

- Frase introdutória conectando perfil ao momento da finalização.
- Uma frase por produto (máx. 7 palavras cada).
- Parágrafo único, fluido e sensorial.
- Adaptar conforme tipo de cabelo, finalização (com/sem calor), química e dor.
- Focar em benefícios: brilho, alinhamento, leveza, proteção, definição.

## Exemplos (não copiar literalmente)

- "Na etapa final, o Primer Liso Intacto sela e protege, enquanto o Leave-in garante brilho espelhado."
- "O Primer Cachos Definidos ativa a curvatura e o Leave-in preserva hidratação durante o calor."

**Fallback text:** Na etapa final, os produtos GE Beauty selam, protegem e realçam seus fios — o toque perfeito de brilho, leveza e acabamento natural.

---

# Smart product [3.b) boosters finalizacao] — ⏸️ NÃO IMPLANTADO

## Regras de recomendação

**Produtos disponíveis:** Booster Antifrizz, Booster Hidratante, Booster Definição, Booster Antioxidante

Os boosters intensificam e personalizam o acabamento dos fios na etapa de finalização.

**Regras:**
- Recomendar **1 booster principal** + até 1 complementar.
- **Booster Antifrizz** — quando (Question: dor principal) = frizz. Ideal para lisos, ondulados, finalização com calor.
- **Booster Hidratante** — quando (Question: dor principal) = seco, áspero ou opaco. Também para alisamento/progressiva.
- **Booster Definição** — quando (Question: dor principal) = falta de definição. Para ondulados, cacheados, crespos.
- **Booster Antioxidante** — quando (Question: dor principal) = desbotamento ou exposição solar. Para coloração/descoloração. Também para finalização natural ao sol.

**Refinamento por tipo de cabelo:**
- Liso → Antifrizz | Ondulado → Hidratante | Cacheado → Definição | Crespo → Definição

**Prioridade de decisão:** dor principal → processos químicos → tipo de cabelo → finalização

---

# Smart property {{explicacao-boosters-finalizacao}} — ⏸️ NÃO IMPLANTADO

Gere **uma frase curta por booster recomendado** pelo Smart Product [3.b) boosters finalizacao], explicando como potencializa a finalização.

## Instruções

- 1 frase por booster (máx. 8 palavras cada).
- Aberturas: "Para potencializar seu acabamento,", "Para proteger e realçar,".
- Descrever benefício principal e sensorial do booster, sem modo de uso.
- Adaptar conforme tipo de cabelo, finalização e dor principal.

**Fallback text:** Para potencializar seu acabamento, os Boosters GE Beauty protegem, selam e realçam o brilho natural dos fios, completando seu ritual com toque leve e duradouro.

---
---
---

# ═══════════════════════════════════════════════════════
# ABORDAGEM ALTERNATIVA: BOOSTERS CONSOLIDADOS
# ═══════════════════════════════════════════════════════

**Nota:** Abordagem alternativa — um único Smart Product consolida a recomendação de boosters para todas as etapas.

---

# Smart product [4. boosters] — ✅ EM PRODUÇÃO

## Regras de recomendação

**Produtos disponíveis:** Booster Antifrizz, Booster Hidratante, Booster Definição, Booster Fortificante, Booster Antioxidante

**Regras gerais:**
- Recomendar **1 a 3 boosters** (1 principal + até 2 complementares).
- Tom: técnico, acolhedor e sensorial. Justificativa curta enfatizando efeito percebido.

**Por dor principal (prioridade máxima):**
- Frizz → **Booster Antifrizz** (controle, alinhamento, sem pesar)
- Ressecamento/aspereza/opacidade → **Booster Hidratante** (brilho, maciez, toque sedoso)
- Falta de definição → **Booster Definição** (curvatura, elasticidade, movimento)
- Quebra/fragilidade → **Booster Fortificante** (força, resistência, vitalidade)
- Desbotamento/exposição solar → **Booster Antioxidante** (proteção cor, brilho)


**Por processos químicos (refina a decisão):**
- Coloração/descoloração → Antioxidante + Hidratante
- Alisamento/progressiva → Hidratante + Antifrizz
- Química intensa/sobreposição → Fortificante + Antioxidante

**Por tipo de cabelo (quando dor principal não é decisiva):**
- Liso → Antifrizz
- Ondulado → Hidratante
- Cacheado → Definição + Hidratante
- Crespo → Definição + Fortificante

**Por couro cabeludo e finalização:**
- Finalização com calor → Antifrizz ou Hidratante
- Finalização natural → Definição ou Antioxidante

**Prioridade geral:** dor principal → processos químicos → tipo de cabelo → finalização

---

# Smart property {{explicacao-boosters}} — ⏸️ NÃO IMPLANTADO

Crie um texto curto, sensorial e técnico que explique de forma integrada o papel dos boosters recomendados pelo Smart Product [4. boosters].

## Referências: (Question: tipo de cabelo), (Question: processos químicos), (Question: dor principal), (Question: finalização), (Question: couro cabeludo)

## Instruções

- Frase introdutória contextualizando os boosters como personalização do ritual.
- 1 frase por booster com nome e benefício principal.
- Conclusão opcional: resultado global (brilho, controle, vitalidade).
- Máx. 100 palavras / 5 frases curtas.
- Tom: técnico, sensorial e sofisticado. Soar natural, não lista técnica.
- Adaptar vocabulário: lisos (leveza, alinhamento), cacheados (definição, nutrição), com química (reconstrução, proteção), com frizz (suavidade, selagem), couro oleoso (purificação, equilíbrio).

## Exemplo

> Para potencializar seu ritual GE Beauty, os boosters atuam de forma personalizada.
> O **Booster Hidratante** devolve maciez e brilho, com toque leve e sedoso.
> O **Booster Antioxidante** protege da oxidação e preserva a cor vibrante.
> Juntos, criam uma rotina inteligente que preserva equilíbrio e beleza natural.

**Fallback text:**
> Os boosters GE Beauty são o toque final do seu ritual: fórmulas inteligentes que potencializam cada etapa do cuidado.
> Eles equilibram, nutrem e protegem, atuando de forma precisa nas principais necessidades do cabelo — do couro ao comprimento.
> Com ação combinada de hidratação, controle e brilho, transformam o tratamento diário em um cuidado completo, leve e visivelmente eficaz.

---
---
---

# INSTRUÇÕES PARA CRIAR NOVAS CATEGORIAS

## Como usar estes prompts como base

Este documento contém:

**SMART PROPERTIES GLOBAIS (3):**
- `{{diagnostico-capilar}}` — Raio-X Capilar ✅ EM PRODUÇÃO
- `{{intro-geral}}` — Introdução Geral do Ritual ⏸️ NÃO IMPLANTADO
- `{{ritual-resumido}}` — Resumo Completo do Ritual ⏸️ NÃO IMPLANTADO

**CATEGORIAS COM PROMPTS DETALHADOS POR ETAPA (3):**
- **LIMPEZA** (5 prompts): {{intro-limpeza}} ⏸️ | [1.a) bases limpeza] ✅ | {{explicacao-bases-limpeza}} ⏸️ | [1.b) boosters limpeza] ⏸️ | {{explicacao-boosters-limpeza}} ⏸️
- **TRATAMENTO** (5 prompts): {{intro-tratamento}} ⏸️ | [2.a) bases tratamento] ✅ | {{explicacao-bases-tratamento}} ⏸️ | [2.b) boosters tratamento] ⏸️ | {{explicacao-boosters-tratamento}} ⏸️
- **FINALIZAÇÃO** (5 prompts): {{intro-finalizacao}} ⏸️ | [3.a) bases finalizacao] ✅ | {{explicacao-bases-finalizacao}} ⏸️ | [3.b) boosters finalizacao] ⏸️ | {{explicacao-boosters-finalizacao}} ⏸️

**ABORDAGEM ALTERNATIVA — BOOSTERS CONSOLIDADOS (2 prompts):**
- [4. boosters] ✅ EM PRODUÇÃO | {{explicacao-boosters}} ⏸️ NÃO IMPLANTADO

**Total: 21 prompts (5 em produção, 16 não implantados)**

---

## Processo para criar novas categorias

### 1. Identifique a categoria
- Qual etapa? Quais produtos do catálogo? Quais perguntas do quiz são relevantes?

### 2. Crie os 5 prompts na mesma ordem

| # | Tipo | Função |
|---|------|--------|
| 1 | Smart Property: Introdução | Resumo personalizado do perfil para a categoria |
| 2 | Smart Product: Bases | Produtos principais com regras de recomendação |
| 3 | Smart Property: Explicação Bases | Conecta introdução + produtos recomendados |
| 4 | Smart Product: Boosters | Produtos complementares com regras de priorização |
| 5 | Smart Property: Explicação Boosters | Frase curta por booster, benefício sensorial |

### 3. Mantenha a coerência entre categorias

Todas fazem parte do mesmo quiz. O usuário vê os resultados juntos:
- Mesmas perguntas do quiz, mesmo tom de voz
- Categorias se complementam, não contradizem
- Nomenclatura: `{{nome-categoria}}` para Smart Properties, `[número.letra) tipo categoria]` para Smart Products

### 4. Checklist

- [ ] Estrutura dos 5 prompts seguida?
- [ ] Perguntas do quiz com notação `(Question: nome)`?
- [ ] Regras de recomendação claras e concisas nos Smart Products?
- [ ] Tom de voz GE Beauty (acolhedor, técnico, sensorial)?
- [ ] Fallback text em todas as Smart Properties?
- [ ] Status marker (✅ EM PRODUÇÃO / ⏸️ NÃO IMPLANTADO)?
- [ ] Sem nomes de ingredientes ativos — apenas benefícios?
