# Booster Antifrizz (GEB 022) — Feedback de Produto para P&D: FÓRMULA + EMBALAGEM

**Objetivo:** feedback por produto, separando o que é **fórmula** e o que é **embalagem**, com ângulos acionáveis para o P&D.
**Fonte:** corpus completo do Loox, via API (`gebeauty/scripts/loox_reviews.py`), puxado em 2026-07-23. Fonte única de reviews — não existe mais export CSV.
**Amostra:** 97 avaliações do Booster Antifrizz. Distribuição: 33×5★ · 10×4★ · 15×3★ · 12×2★ · **27×1★**. **54 de 97 (56%) são ≤3★** — o produto com pior percepção do catálogo.

> **A tese central em uma frase:** o Booster Antifrizz tem uma **fórmula amada** presa dentro de um **formato de embalagem incompatível**. Uma única causa mecânica — a fórmula é viscosa demais para um conta-gotas — gera quase todas as reclamações de embalagem **e** boa parte das de eficácia e de "vem pouco / caro" (o cliente não consegue extrair a dose que o produto precisa). Resolver a interface fórmula×embalagem é a maior alavanca isolada do produto.

**O que NÃO mexer (força comprovada):** a **fragrância** é elogio recorrente ("cheiro maravilhoso/inconfundível") e o acabamento quando aplicado puro/no seco é amado ("melhor finalizador que existe", "tira o frizz na hora, cabelo leve e brilhoso", "não deixa resíduo nas mãos"). As falhas de eficácia são condicionais (tipo de cabelo / dose), não universais.

---

# PARTE 1 — EMBALAGEM

## P1. Conta-gotas incompatível com a viscosidade (CRÍTICO)
**Sintoma:** o produto é denso demais para a pipeta — não suga, entope, "trava no conta-gotas", cliente tira a tampa e bate o frasco na mão para sair. É de longe a reclamação #1 do produto e aparece até em avaliações 4-5★ que amam a fórmula. Cascateia em (a) eficácia ("depois de tanto esforço, saiu uma gota, não vi diferença") e (b) "propaganda enganosa" (impossível reproduzir as "5 gotinhas" dos vídeos).
**Clientes já propõem a solução:** bisnaga ou válvula/pump.
**Ângulo para P&D/Embalagem:**
- Trocar o conta-gotas por formato compatível com produto viscoso: **bisnaga com bico**, **pump/válvula** ou airless. (Ambos sugeridos espontaneamente pelas clientes.)
- Definir spec de viscosidade-alvo e **validar o par fórmula↔dispensador com teste de dose real** — a promessa de "5 gotas de cada lado" tem que ser reproduzível na mão do cliente.
- A GE já respondeu publicamente que "está testando uma nova embalagem" — este documento dimensiona e prioriza essa troca.

**Verbatims:**
- 2★ Maria: *"gostei da fórmula, funcionou super bem… mas a embalagem é péssima, a consistência é bem mais grossa que os demais boosters, o pump do conta-gotas é ruim pra pegar o produto, acho que seria melhor uma embalagem **bisnaga**."*
- 2★ Rayana: *"Ele definitivamente não era pra ser em formato de booster… usa a pipeta e não vem produto, sai pelos lados, tem que bater e passar na mão. Era para ser um produto em **bisnaga ou com válvula**."*
- 1★ Alexandra: *"muito denso… acabo tirando a tampinha e batendo na mão. O produto é bom mas deveria estar em outra embalagem."*
- 1★ Themisa: *"tão espesso que não entra no conta gotas e você fica batendo no tubo."*
- 3★ Barbara: *"O pump é péssimo, sai pouquíssimo produto… Precisam melhorar a embalagem urgente!"*

## P2. Nível de enchimento inconsistente
**Sintoma:** frascos que chegam "faltando um dedo", "não veio cheio" — num frasco que já é pequeno. Alimenta a percepção de "propaganda enganosa" e de baixo valor.
**Ângulo:** QA de **fill level** na linha de envase (o "faltando um dedo" recorrente sugere enchimento inconsistente ou headspace mal calibrado para a viscosidade).
**Verbatims:** 1★ Mírian: *"Veio faltando 1 dedo de produto! Não veio cheio como deveria."* · 1★ Daniela: *"vem faltando 1 dedo no frasco que já é pequeno."*

## P3. Qualidade/ergonomia do frasco
**Sintoma:** plástico percebido como ruim; frasco escorregadio de segurar com a mão cheia de creme.
**Ângulo:** material/textura do frasco com pegada antiderrapante (secundário; provavelmente resolvido junto com a troca de formato em P1).
**Verbatim:** 1★ Carolina: *"o frasco é bem ruim de usar, já que estamos com a mão de creme e fica escorregadio… plástico péssimo."*

---

# PARTE 2 — FÓRMULA

## F1. Viscosidade alta demais — a propriedade-raiz (decisão de P&D)
**Sintoma:** a consistência densa/"seca" é citada como fora do padrão dos outros boosters; uma cliente chega a perguntar se é a consistência correta. É uma propriedade **de fórmula** que quebra a embalagem (P1) e prejudica a dosagem.
**Ângulo para P&D — decisão de bifurcação:**
- **Caminho A:** manter a fórmula rica e trocar a embalagem (P1). Preserva o que os fãs amam.
- **Caminho B:** reduzir a viscosidade para caber num conta-gotas.
Recomendação: **Caminho A** — a fórmula, quando sai, é elogiada; o problema é entregá-la. Não afinar às custas da performance.
**Verbatims:** 2★ Denise: *"bastante denso, parece um pouco seco, quase não pinga… Esta é a consistência certa para este produto?"* · 3★ 000130: *"é muito denso pra tá em um conta gotas."*

## F2. Lacuna de eficácia em cabelo ondulado/cacheado + dependência de dose
**Sintoma:** "não reduz o frizz / não vi diferença", concentrado em **cabelo ondulado e cacheado**. Sinal importante: várias clientes dizem que **"umas gotinhas não bastam"** — este produto precisa de **mais volume** que os outros boosters para funcionar (o que a embalagem impede de entregar). Quando a dose é alcançada (uso puro, ~5 gotas após o leave-in), o efeito aparece e agrada.
**Ângulo para P&D:**
- Validar performance anti-frizz por **curvatura** (ondulado 2x, cacheado 3x) na dose real de uso.
- Rever a **dose recomendada** e a comunicação: se o produto precisa de mais que "2 gotinhas", o rótulo/vídeo precisa refletir isso (e a embalagem precisa entregar esse volume — liga em P1).
- Avaliar se há espaço para **aumentar a potência** anti-frizz para reduzir a dose necessária.
**Verbatims:**
- 2★ Rayana: *"não acho que umas gotinhas dele bastam, não para um cabelo ondulado. Você precisa de mais produto, diferente dos outros boosters."*
- 2★ Thamires (cacheado): *"testei no condicionador, no leave-in e sozinho na dose recomendada e não vi diferença."*
- 4★ Fabiola: *"Usei puro e umas cinco gotas depois do leave-in para realmente tirar todo o frizz. Ficou legal, durou quase o dia todo."* (mostra que com dose suficiente, funciona)
- 1★ Maria Carolina (cacheado): *"não entregou a promessa… não percebi diferença."*

## F3. Acabamento negativo em parte dos usos: duro / áspero / opaco / pesado
**Sintoma:** minoria, mas real — o fio fica duro, áspero, opaco ou pesado. Provável correlação com **superdosagem** (o cliente bate o frasco e sai um excesso de uma vez, justamente por causa de P1).
**Ângulo para P&D:** verificar o acabamento em dose alta (film/óleo em excesso → cast duro/opaco); avaliar emoliente/veículo que perdoe superdosagem. Reavaliar após corrigir a dispensação (a superdosagem some quando a dose vira controlável).
**Verbatims:** 1★ Valeria: *"Tira frizz mas deixa duro."* · 1★ Vivian: *"deixou meu cabelo muito áspero."* · 2★ Carolina: *"O cabelo fica opaco."* · 2★ #gebeautie: *"Ficou pesado e deixou muito embaraçado."*

## F4. Estabilidade da fórmula (separa / "empedra")
**Sintoma:** produto que chega "empedrado" dentro do conta-gotas ou que exige agitação vigorosa antes de usar (a própria resposta padrão da GE orienta "agite bem, esvazie o conta-gotas"). Indica **separação de fases / instabilidade de emulsão**.
**Ângulo para P&D:** revisar estabilidade da emulsão (sistema emulsionante/suspensão) para eliminar a necessidade de agitar e o risco de empedramento — hoje é contornado por instrução manual ao cliente, o que não escala.
**Verbatim:** 1★ Carolina: *"tem uma parte do produto 'empedrada' dentro do conta gotas, que não me deixa puxar o produto."*

## F5. Preservar (NÃO reformular)
- **Fragrância** — elogio recorrente e transversal ("cheiro maravilhoso", "inconfundível", "o plus"). Manter.
- **Acabamento no uso puro/seco** — quando entregue, é descrito como "o melhor finalizador", "magia pura", leve e brilhoso, sem resíduo nas mãos. O núcleo sensorial está certo; o problema é a entrega.

---

## Nota de valor (fronteira P&D + Marketing)
"Vem pouquíssimo" e "caro pelo que promete" aparecem bastante, mas são **efeito composto**: (a) desperdício causado pela embalagem (P1), (b) o produto precisar de mais dose que os outros boosters (F2), e (c) enchimento inconsistente (P2). Resolvendo P1/P2/F2, a percepção de valor sobe sem mexer no preço. Fãs pedem inclusive um **tamanho maior** (decisão de portfólio).

## Fora de escopo de P&D (registrado para não confundir)
Aparecem nas mesmas avaliações, mas são de outras áreas: atraso de entrega/greve dos Correios (Logística), atendimento evasivo (CS), e "vídeos diferentes do real" (Marketing — que é sintoma de P1: enquanto a embalagem não entrega as "5 gotinhas", o vídeo não é reproduzível).

---

*Método: pull do Loox via `gebeauty/scripts/loox_reviews.py` (corpus 1-5★). Verbatims transcritos literalmente das 97 avaliações do produto. Reclamações classificadas por leitura + marcação; a viscosidade aparece tanto em Embalagem (P1) quanto em Fórmula (F1) de propósito — é a interface entre as duas.*
