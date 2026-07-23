# Catálogo GE Beauty — Mapa de Preocupações de FÓRMULA e EMBALAGEM para P&D

**Objetivo:** consolidar as reclamações e feedbacks de clientes ligados a **fórmula** e **embalagem**, organizados por **ângulo acionável** (o que o P&D pode de fato mexer), para orientar a fila de melhorias de produto.
**Fonte:** corpus completo do Loox, via API (`gebeauty/scripts/loox_reviews.py`), puxado em 2026-07-23. Fonte única de reviews — não existe mais export CSV.
**Amostra:** 2.368 avaliações publicadas. Análise sobre **685 avaliações com sinal negativo** = todas as ≤3★ + as 4-5★ que trazem uma ressalva ("amei, mas…") — é aí que mora o feedback de melhoria.
**Recorte:** só os 14 produtos-herói. Excluídos deste documento: entrega/logística e atendimento (não são P&D — ver §7).

> **Como ler os números.** As contagens vêm de marcação por palavra-chave com filtro de negação (para não contar "não fica oleoso" como reclamação de oleosidade) e servem como **volume direcional**, não censo exato. Todo ângulo abaixo é ancorado em **verbatims verificados** — é neles que o P&D deve confiar, não no número puro. O deep-dive do Booster Antifrizz está em `rd-booster-antifrizz-concerns.md`.

---

## Resumo executivo — os 6 ângulos que valem a fila

**Fórmula**
1. **Peso/oleosidade em cabelo fino** — o tema #1 de fórmula, atravessa 6 produtos (Leave-in Térmico, Pluma, Primer Liso, Booster Hidratante, Primer Cachos, Máscara). Fórmulas ricas demais deixam o fio fino "pesado, lambido, com aspecto sujo".
2. **Efeito "cabelo duro/engomado" (casca de gel)** — Primer Cachos, Booster Definição, Pluma, Primer Liso, Térmico. O fio seca rígido, "aspecto de gel/mousse", "pau duro".
3. **Lacuna de eficácia por tipo de cabelo** — a promessa não bate para curvaturas específicas: Primer Cachos em 2B/2C e Definição em 3B/3C ("não definiu"), Shampoo sem Sulfato em crespo/seco ("virou palha").

**Embalagem**
4. **Antifrizz: conta-gotas × viscosidade** — incompatibilidade já conhecida; pipeta entope, cliente bate o frasco. Maior problema isolado do catálogo (deep-dive à parte).
5. **Pump dos Primers sub-dispensa / falha** — Primer Cachos e Liso: "sai pouco", "tenho que abrir e pegar com o dedo", "veio quebrado".
6. **Fixação/formato do Melon Mood** — cheiro some em minutos e o spray "sai em jatos" (fórmula + atuador).

---

# PARTE 1 — FÓRMULA (ângulos acionáveis)

## F1. Peso e oleosidade em cabelo fino  ·  ~97 menções (direcional) · PRIORIDADE 1
**Sintoma:** o fio fica pesado, "lambido", com aspecto oleoso/sujo, raiz grudada. Correlação forte e explícita com **cabelo fino** — muitas clientes dizem literalmente "no meu cabelo fino pesou".
**Produtos afetados (em ordem de volume):** Leave-in com Proteção Térmica, Booster Hidratante, Leave-in Pluma, Primer Liso Intacto, Primer Cachos, Máscara Condicionadora, Melon Mood (na pele/fio).
**Ângulo para P&D:**
- Revisar a **carga de emolientes/óleos** dos leave-ins e do Booster Hidratante — o Hidratante é descrito repetidamente como "óleo puro" que não absorve.
- Avaliar uma **variante/veículo mais leve** (fluido, spray, sérum leve) para o público de cabelo fino, ou uma dosagem-alvo menor comunicada no rótulo.
- Definir teste-âncora: aplicação em mecha de cabelo fino, medir sensação de peso/oleosidade em 4h e no dia seguinte (day-after).

**Verbatims:**
- Leave-in Térmico · 4★ Thays: *"deixa os fios mais pesados e embaraçados, além de criar um aspecto de cabelo oleoso/sujo."*
- Leave-in Térmico · 1★ Carolina: *"Meu cabelo ficou lambido, oleoso e opaco. Tentei com menos produto, mas não adiantou. Parei de usar."*
- Booster Hidratante · 1★ Thamires: *"parece que estou passando óleo puro no cabelo… pesou muito, uma gotinha só."*
- Booster Hidratante · 1★ Luciana: *"cabelo ficou pesado com aspecto de molhado e engordurado."*
- Leave-in Pluma · 3★ Mariana: *"o cheirinho é uma delícia, mas ficou pesado no meu cabelo que é muito fininho."*
- Primer Liso · 1★ Renata: *"Produto pesado para cabelos finos. Não aguenta a umidade."*

## F2. Efeito "cabelo duro / engomado" (casca de gel)  ·  ~46 menções · PRIORIDADE 1
**Sintoma:** depois de secar, o fio fica rígido, sem movimento, "aspecto de gel/mousse", "espetado", "pau duro". É um problema de **film-former / fixação**, distinto da oleosidade (o fio fica duro, não oleoso).
**Produtos afetados:** Booster Definição, Primer Cachos, Leave-in Pluma, Primer Liso, Leave-in Térmico.
**Ângulo para P&D:**
- Revisar o sistema de **polímeros de fixação** — migrar para hold flexível/"touchable" (reduzir cast rígido), ou reduzir o percentual do fixador atual.
- No Primer Cachos, a percepção "é só um gel numa embalagem bonita" é recorrente — calibrar definição × maciez.
- Teste-âncora: dobrar/amassar a mecha seca e avaliar quebra do cast + resíduo (flaking).

**Verbatims:**
- Booster Definição · 3★ Yasmin: *"senti meu cabelo pesado e duro, com aquele aspecto de 'gel' ou 'mousse'."*
- Booster Definição · 2★ Fernanda: *"ficou muito espetado e duro… nos vídeos ficam com volume e definidos, no meu só ficou duro."*
- Primer Cachos · 1★ Beatriz: *"Deixou o cabelo duro! É só um gel numa embalagem bonita."*
- Leave-in Pluma · 1★ Natalia: *"Meu cabelo ficou um pau duro. Completamente duro. Sensação péssima no toque."*
- Primer Liso · 3★ Carolina: *"deixou meu cabelo duro e opaco. Tentei usar menos, mas não adiantou."*

## F3. Lacuna de eficácia por tipo de cabelo (a promessa não bate)  ·  ~97 menções · PRIORIDADE 2
**Sintoma:** "não funcionou / não vi diferença / não entregou o que promete", quase sempre atrelado a um **tipo de cabelo específico** onde o produto decepciona.
**Padrões nítidos por produto:**
- **Primer Cachos** — falha relatada em **2B/2C** ("não definiu, ficou volumoso") e o Definição em **3B/3C** ("quase não deu efeito").
- **Shampoo sem Sulfato** — em cabelo **crespo/seco** deixa "aspecto de palha/ressecado" (justo o público que o quiz direciona para ele).
- **Booster Antifrizz** — não reduz frizz em cacheado (ver deep-dive; parte é subdosagem por causa da embalagem).
**Ângulo para P&D + Marketing/Quiz:**
- Validar a claim de performance **por curvatura** (2x/3x/4x) e ajustar a comunicação/rótulo ao que a fórmula realmente entrega.
- Sinal de **mis-routing do quiz**: clientes dizem "o site me direcionou para este e não funcionou pro meu tipo". Cruzar com o time do quiz (Octane).
- Onde a lacuna for real (não só expectativa), priorizar reformulação de performance.

**Verbatims:**
- Primer Cachos · 1★ Isabelle: *"tenho cachos 2B e 2C, não ficaram definidos, pelo contrário, ficou volumoso e sem definição."*
- Shampoo sem Sulfato · 1★ Thais: *"o site me direcionou pois indiquei cabelo crespo/seco, mas não funciona pro meu tipo. Ficou ressecado, de palha."*
- Booster Definição · 3★ Taynah: *"quase não deu efeito nos meus cachos (3B e C), além de deixar frizz."*

## F4. Shampoo sem Sulfato: resseca / "palha" + pouca espuma + raiz oleosa no dia seguinte · PRIORIDADE 2
**Sintoma:** cluster próprio e consistente — resseca o comprimento ("palha"), faz **pouca espuma** (fórmula densa), e alguns relatam **raiz oleosa no day-after**. Comporta-se como anti-resíduo ("uso 1x/semana").
**Ângulo para P&D:** rever o **balanço limpeza × hidratação** e o sistema tensoativo (espuma percebida) para o público de cabelo seco/cacheado a que o produto é vendido. Investigar o paradoxo comprimento-ressecado / raiz-oleosa (excesso de clarificação?).
**Verbatims:**
- 1★ Ana: *"Meu cabelo ficou ressecado (parece palha) e a raiz extremamente oleosa na manhã seguinte."*
- 1★ Jamilla: *"muito denso, faz pouca espuma e deixou o cabelo ressecado e embaraçado durante a lavagem."*
- 3★ Mariha: *"é como um anti-resíduo, deixou meu cabelo duro e ressecado com o passar dos dias; serve pra ~1x/semana."*

## F5. Fragrância: dois sinais opostos a resolver · PRIORIDADE 3
**Sinal A — Boosters "sem cheiro":** clientes reclamam da ausência de fragrância nos boosters ("não tem cheiro, sensorial ruim"). É **intencional** (boosters = ativos 100% puros, sem fragrância — confirmado em resposta da própria GE), mas a percepção é negativa.
**Sinal B — Fragrância enjoativa/forte:** no Leave-in Térmico, Shampoo a Seco e Melon Mood alguns acham o cheiro "muito doce, tutti-frutti, enjoativo"; no Booster Definição aparece "cheiro forte de álcool".
**Ângulo para P&D:** (a) avaliar uma **fragrância leve** para os boosters (ou reforçar na comunicação por que não têm); (b) revisar a intensidade/dulçor da assinatura olfativa nos produtos enxaguáveis e no Térmico; (c) investigar a **nota de álcool** percebida no Definição (matéria-prima/veículo).
**Verbatims:**
- Booster Hidratante · 1★ Juliana: *"não tem cheiro de nada, o sensorial é ruim."*
- Leave-in Térmico · 2★ Ana Clara: *"odiei o cheiro… muito doce, 'tutti-frutti', enjoativo."*
- Booster Definição · 2★ Maria Cecília: *"tem um cheiro forte de álcool."*

## F6. Melon Mood: fixação de fragrância fraca + resíduo grudento na pele · PRIORIDADE 2 (produto de lançamento)
**Sintoma:** o cheiro **some em minutos** (maior reclamação de longe) e alguns relatam a **pele/fio grudento ou oleoso** depois da aplicação.
**Ângulo para P&D:** aumentar a **fixação/longevidade** da fragrância (concentração, fixadores) e reduzir o residual grudento na pele. (O "spray sai em jatos" é do atuador — ver P5.)
**Verbatims:**
- 1★ Daniela: *"o cheiro não fixa absolutamente nada, tipo dois minutos sai."*
- 3★ Cecília: *"deixa a pele com aspecto meio grudento, o grande ponto negativo."*
- 1★ Caroline: *"não fixa nada na pele (dura 30 minutos) e me deixa com a pele oleosa."*

## F7. Sinais menores de fórmula (monitorar)
- **Durabilidade do efeito** (some rápido) — Melon Mood, Definição.
- **Resíduo/farelo branco** — pontual (Shampoo sem Sulfato, Antifrizz).
- **Textura/consistência do produto** — "muito líquido/grosso" (Antifrizz denso demais é o caso central; ver embalagem).

---

# PARTE 2 — EMBALAGEM (ângulos acionáveis)

## P1. Booster Antifrizz: conta-gotas incompatível com a viscosidade · PRIORIDADE 1 (crítico)
**Sintoma:** produto denso demais para a pipeta — entope, não suga, chega "empedrado", cliente tira a tampa e bate o frasco na mão. 18+ relatos só neste eixo; é o maior problema isolado do catálogo. Cascateia em "não funciona" (subdosagem) e "propaganda enganosa" (não replica os vídeos). A GE já sinalizou "nova embalagem em teste".
**Ângulo:** trocar o conta-gotas por **formato compatível com produto viscoso** (bisnaga/bico, pump airless ou flip-top de parede flexível); definir spec de viscosidade-alvo e validar o par fórmula↔dispensador com teste de dose real. **Detalhe completo em `rd-booster-antifrizz-concerns.md`.**
**Verbatim:** 1★ Cinthya: *"muito grosso, não sai pelo conta gotas… fica entupindo."*

## P2. Pump dos Primers sub-dispensa e falha · PRIORIDADE 1
**Sintoma:** o pump dos Primers (Cachos e Liso) **sai com pouco produto por acionamento**, obriga a abrir o frasco e pegar com o dedo, e há relatos de **pump que chega quebrado/não funciona**. É creme espesso num pump subdimensionado.
**Ângulo:** rever a **spec do pump** (dose por curso adequada a creme espesso, força de acionamento) e o **controle de qualidade** (índice de falha na chegada). Avaliar bico/aplicador mais prático.
**Verbatims:**
- Primer Liso · 2★ Nathalia: *"O pump da embalagem não funciona. Tive que tirar e pegar com o dedo o creme."*
- Primer Liso · 1★ Julia: *"O pump veio quebrado."*
- Primer Cachos · 2★ Sarah: *"O pump sai pouco produto, preciso abrir a tampa para pegar quantidade suficiente."*

## P3. Ergonomia de aplicação do Primer Cachos (bico/refil) · PRIORIDADE 2
**Sintoma:** o bico/formato é "pouco prático" — com a mão escorregadia de creme, reabrir e reaplicar é difícil; "botão do refil ruim".
**Ângulo:** redesenho do **tip/aplicador** para reaplicação com mão suja de produto (superfície antiderrapante, bico maior).
**Verbatim:** 3★ Mariana: *"esse bico não é nada prático, é pequeno… a mão já está escorregadia."*

## P4. Volume × preço / nível de enchimento · PRIORIDADE 2 (P&D-fill + Marketing)
**Sintoma:** "vem pouco produto", "frasco pequeno", "não veio cheio" — mais forte em Antifrizz e Booster Definição. Parte é **percepção de valor**, parte é **desperdício causado pela embalagem** (P1/P2), parte pode ser **nível de enchimento real**.
**Ângulo:** (a) QA do **fill level** (o "faltando um dedo" sugere enchimento inconsistente); (b) decisão de portfólio sobre **formato maior** (até fãs pedem — "queria um tamanho maior"). Resolver P1/P2 já reduz a percepção de "vem pouco".
**Verbatim:** 2★ Glaucia: *"embalagem muito pequena, pouco produto para o preço pago."*

## P5. Melon Mood: atuador de spray "sai em jatos" · PRIORIDADE 2
**Sintoma:** em vez de névoa, o spray sai em jatos concentrados, o que espirra produto perto da raiz.
**Ângulo:** trocar/spec do **atuador de névoa** (mist fina uniforme).
**Verbatim:** 1★ Susanne: *"O spray sai jatos de produto."*

## P6. Vazamento no transporte (monitorar)
Relato pontual de booster que vazou na mala (vedação/tampa em viagem). Baixo volume; monitorar índice.

---

# PARTE 3 — Matriz por produto (top temas)

| Produto | Fórmula (principais) | Embalagem (principais) |
|---|---|---|
| **Booster Antifrizz** | eficácia/não tira frizz; produto denso demais | **conta-gotas entope (crítico)**; frasco difícil; vem pouco |
| **Leave-in Proteção Térmica** | **peso/oleoso em fino**; eficácia; duro; resseca | vem pouco (menor) |
| **Shampoo sem Sulfato** | **resseca/palha**; oleoso na raiz; pouca espuma | — |
| **Booster Definição** | duro "aspecto gel"; eficácia; cheiro de álcool | vem pouco; conta-gotas |
| **Primer Cachos Definidos** | **eficácia em 2B/2C**; duro; ressecou | **pump sai pouco**; ergonomia do bico |
| **Melon Mood** (lançamento) | **fixação fraca**; grudento na pele; cheiro forte p/ alguns | atuador spray em jatos; vem pouco |
| **Booster Hidratante** | **peso/oleoso "óleo puro"**; sem cheiro | vazou (pontual) |
| **Leave-in Pluma** | **duro**; peso em fino; ressecou pontas | — |
| **Primer Liso Intacto** | duro/opaco; peso em fino; eficácia (umidade) | **pump não funciona/quebrado** |
| **Máscara Condicionadora** | pesado/embaraça em fino (baixo volume) | — |
| **Shampoo a Seco** | não segura oleosidade; cheiro forte; deixa duro | — |
| **Booster Fortificante** | ressecou (baixo); eficácia lenta | — |
| **Booster Antioxidante** | ressecou (baixo volume) | — |
| **Máscara Mayday** (lançamento) | pesado no day-after (1 relato) | — |

---

# PARTE 4 — Sinais de segurança (P&D + regulatório) · monitorar

Baixo volume, mas relevância alta — reação em pele/couro cabeludo:
- **Leave-in Pluma** · 3★ Maria Eduarda: *"algum ingrediente está me dando alergia… muita coceira na cabeça e nariz."*
- **Melon Mood** · 1★ Bianca: *"deu alergia no corpo, bolinhas vermelhas na 2ª vez."*
- **Booster Hidratante** · 3★ Lays: menção a caspa.

**Ângulo:** revisão de alérgenos/fragrância dessas fórmulas; considerar nota de teste de mecha/patch-test na comunicação. Acompanhar frequência a cada refresh deste mapa.

---

## Método e limitações
- Fonte: Loox API (`gebeauty/scripts/loox_reviews.py`), corpus completo 1-5★, 2.368 reviews.
- Set de análise: ≤3★ + 4-5★ com marcador de ressalva (685 reviews). Marcação por palavra-chave com filtro de negação; contagens são **direcionais**, verbatims são **verificados**.
- Handles duplicados (full-size/travel-size/rappi/brinde) agrupados por família de produto.
- Fora de escopo (não-P&D): entrega/atraso, atendimento, mismatch de propaganda (este último é sintoma de P1 enquanto a embalagem não muda).
- Para reproduzir/atualizar: rodar o pull do Loox e reclassificar; script de análise ad-hoc, não versionado.
