# Quiz GE Beauty | Octane AI

## ⚠️ IMPORTANTE: Este documento contém a lógica REAL do quiz em produção e os smart prompts relacionados a ele

Este não é um documento de exemplos — **aqui estão as perguntas do quiz, as smart properties e os smart products efetivamente utilizados no quiz da GE Beauty**.

Ao criar novos fluxos ou ajustes, você deve:

1. **Seguir exatamente a mesma estrutura** e lógica apresentada para perguntas, smart properties e smart products
2. **Manter a coerência** entre as categorias — todas fazem parte do mesmo quiz
3. **Complementar** o conteúdo existente — o usuário verá resultados de todas as categorias juntas
4. **Usar o mesmo tom de voz** (acolhedor, técnico, sensorial — característico da GE Beauty)
5. **Referenciar as perguntas do quiz** com a sintaxe `(Question: …)` sempre que relevante (couro cabeludo, frequência de lavagem, processos químicos, dor principal, etc.)

## Visão Geral do Quiz GE Beauty

As smart properties e smart products abaixo são gerados a partir das respostas do quiz GE Beauty. Use sempre esses campos (sintaxe `(Question: ...)`) para personalizar qualquer etapa do ritual:

1. **(Question: tipo de cabelo)**  
   `liso`, `ondulado`, `cacheado`, `crespo`

2. **(Question: espessura)**  
   `fino`, `médio`, `grosso`

3. **(Question: couro cabeludo)**  
   `seco`, `equilibrado`, `oleoso`, `sensível`

4. **(Question: frequência lavagem)**  
   `todos os dias`, `a cada 2 dias`, `entre 2 e 3 vezes por semana`, `1 vez por semana`

5. **(Question: processos químicos)**  
   `alisamento`, `coloração`, `descoloração`, `nenhum`

6. **(Question: finalização)**  
   `escova`, `babyliss`, `cachos`, `secador`, `chapinha`, `seco ao natural`

7. **(Question: dor principal)**  
   `seco`, `fraco ou quebradiço`, `frizz`, `falta de definição`, `opacos e sem brilho`, `queda`, `oleoso`

> **Referência rápida para IA:** sempre cite os campos usando a sintaxe `(Question: …)` e conecte cada prompt às dores prioritárias (`dor principal` → `couro cabeludo` → `processos químicos` → `tipo de cabelo`), garantindo coerência entre todas as etapas.

---

## Duas abordagens disponíveis:

### **ABORDAGEM 1: Prompts Detalhados por Categoria** (seções LIMPEZA, TRATAMENTO, FINALIZAÇÃO)
- Cada categoria tem 5 prompts (intro + bases + explicação bases + boosters + explicação boosters)
- Recomendações específicas de boosters para cada etapa
- Explicações separadas e contextualizadas por categoria
- **Vantagem:** maior personalização e contexto por etapa
- **Use quando:** preferir experiência detalhada e segmentada

### **ABORDAGEM 2: Prompts Globais Unificados** (seções SMART PROPERTIES GLOBAIS + BOOSTERS CONSOLIDADOS)
- Smart Properties globais que resumem todo o ritual
- Uma única recomendação consolidada de boosters para todas as etapas
- Explicação unificada dos boosters
- **Vantagem:** simplicidade e visão integrada do ritual
- **Use quando:** preferir experiência rápida e consolidada

---

## Tipos de prompts neste documento:

**Smart Property** = Texto personalizado gerado por IA com base nas respostas do quiz  
**Smart Product** = Lógica de recomendação de produtos baseada nas respostas do quiz

**Estrutura típica de uma categoria:**
1. Smart Property de introdução (resume o perfil)
2. Smart Product de bases (produtos principais)
3. Smart Property de explicação das bases (conecta perfil + produtos recomendados)
4. Smart Product de boosters (produtos complementares)
5. Smart Property de explicação dos boosters (explica como os boosters potencializam)

---

# ═══════════════════════════════════════════════════════  
# SMART PROPERTY GLOBAL – RAIO-X CAPILAR (RESUMO DO DIAGNÓSTICO)  
# ═══════════════════════════════════════════════════════  

# Smart property {{diagnostico-capilar}}

Gere um **resumo diagnóstico visual e direto** com base nas respostas do quiz, destacando as **principais características e objetivos capilares** da usuária.
O texto deve sempre começar com o formato fixo **"cabelo [tipo] e [espessura]"**, seguido de **2 a 3 objetivos principais**, separados por "•".

---

## Estrutura esperada

**Formato final:**
```
cabelo liso e médio • controle do frizz • fortalecimento • proteção solar
```

---

## Referências obrigatórias

O diagnóstico deve considerar as respostas de:
- (Question: tipo de cabelo)
- (Question: espessura ou textura)
- (Question: processos químicos)
- (Question: dor principal)
- (Question: finalização)

---

## Instruções de escrita

1. **O texto deve sempre começar com:**
   `cabelo [tipo_de_cabelo] e [espessura_dos_fios]`
   Exemplo: `cabelo liso e médio` ou `cabelo cacheado e fino`.

2. Em seguida, incluir **2 ou 3 objetivos principais**, separados por "•", que representem as metas do ritual GE Beauty.
   Exemplo:
    ```
    cabelo cacheado e fino • definição • nutrição • proteção térmica
    ```

3. Os objetivos devem refletir **resultados esperados** (*não sintomas ou dores*), como:
- *fortalecimento*, *controle do frizz*, *proteção térmica*, *proteção solar*, *hidratação profunda*, *reparação*, *brilho intenso*, *definição duradoura*, *equilíbrio do couro*, *cor vibrante*, *maciez*, *elasticidade*, *leveza natural*.

4. O tom deve ser **positivo, técnico e aspiracional**, reforçando metas e não problemas.
Exemplo: "fortalecimento" em vez de "quebra", "brilho intenso" em vez de "opacidade".

5. Não utilize frases completas, verbos conjugados ou adjetivos negativos.
O texto deve se encaixar visualmente em uma linha, como um **raio-x de objetivos**.

---

## Diretrizes de personalização

| Variável | Exemplo de saída esperada |
|-----------|----------------------------|
| **Cabelo liso, fino e com frizz** | `cabelo liso e fino • controle do frizz • brilho leve • proteção térmica` |
| **Cabelo cacheado com química** | `cabelo cacheado e médio • definição • reparação • força` |
| **Cabelo crespo e ressecado** | `cabelo crespo e espesso • nutrição • elasticidade • controle do volume` |
| **Cabelo ondulado e colorido** | `cabelo ondulado e médio • cor vibrante • hidratação profunda • proteção solar` |
| **Cabelo liso natural** | `cabelo liso e médio • leveza natural • brilho saudável • equilíbrio do couro` |

---

## Exemplos de saída esperada

- **Usuária com cabelo liso, médio e dor principal "frizz"**
→
```
cabelo liso e médio • controle do frizz • brilho intenso • proteção térmica
```

- **Usuária com cabelo cacheado e químico**
→
```
cabelo cacheado e médio • definição • força • nutrição
```

- **Usuária com cabelo crespo e descolorido**
→
```
cabelo crespo e espesso • reconstrução • nutrição • cor vibrante
```

---

## Vocabulário sugerido (objetivos principais)

`fortalecimento`, `nutrição`, `hidratação profunda`, `controle do frizz`, `reparação`, `proteção térmica`, `proteção solar`,
`cor vibrante`, `brilho intenso`, `definição`, `elasticidade`, `leveza natural`, `volume equilibrado`, `força`, `maciez`, `equilíbrio do couro`.

---

## Estrutura técnica esperada

A resposta deve conter **apenas uma linha**, composta por:

1. Identificação do cabelo (fixa):
 `cabelo [tipo] e [espessura]`
2. 2 a 3 objetivos principais, separados por "•".

**Formato final esperado:**
```
cabelo liso e médio • fortalecimento • controle do frizz • brilho intenso
```

---

## Resumo técnico para IA / Smart Copy

- Sempre iniciar com **"cabelo [tipo] e [espessura]"**.
- Adicionar **2 ou 3 objetivos capilares principais**, sem sintomas ou dores.
- Basear-se nas respostas do quiz, priorizando:
  1. (Question: tipo de cabelo)
  2. (Question: espessura ou textura)
  3. (Question: dor principal)
  4. (Question: processos químicos)
- Retornar o texto **sem explicações, pontuação extra ou conectores**, apenas os termos separados por "•".
- Manter tom **técnico, otimista e elegante**, refletindo o DNA da GE Beauty.

---

## Referência visual de exibição

Na interface do quiz, esta Smart Property deve aparecer:
- Logo abaixo do título personalizado ("{{ first_name }}, já temos seu resultado:");
- Exibindo o tipo de cabelo + objetivos em formato de chips curtos;
- Transmitindo um diagnóstico técnico e aspiracional, que conecta diretamente à jornada de recomendação.

**Exemplo visual:**
```
cabelo liso e médio • controle do frizz • fortalecimento • proteção solar
```

**Função:** apresentar um **resumo técnico e inspirador**, reforçando a ideia de um diagnóstico personalizado.

---

**Fallback text:** nenhum


# ═══════════════════════════════════════════════════════  
# SMART PROPERTY GLOBAL – INTRODUÇÃO GERAL (GE BEAUTY)  
# ═══════════════════════════════════════════════════════  

# Smart property {{intro-geral}}

Gere um texto introdutório **personalizado e sensorial**, que apresente o diagnóstico capilar e introduza o ritual GE Beauty como uma jornada de cuidado inteligente e feito sob medida.

---

## Referências obrigatórias

O texto deve considerar as respostas de:
- (Question: tipo de cabelo)  
- (Question: processos químicos)  
- (Question: dor principal)  
- (Question: finalização)  
- (Question: couro cabeludo)  

E deve **anteceder o conteúdo do ritual** (como `{{ritual-resumido}}`), contextualizando a cliente sobre o diagnóstico e o propósito dos produtos recomendados.

---

## Objetivo

Criar uma introdução curta e acolhedora que:
- Reconheça o tipo e as principais necessidades do cabelo da cliente;  
- Apresente o conceito da GE Beauty como uma rotina personalizada e científica;  
- Prepare o tom emocional e sensorial para o ritual a seguir.

---

## Estrutura esperada

O texto deve conter **de 2 a 3 frases curtas**, com fluxo leve e natural:

1. **Frase 1 – Diagnóstico:** contextualiza o tipo de cabelo e suas principais necessidades.  
2. **Frase 2 – Ritual:** apresenta a rotina GE Beauty como a solução personalizada e inteligente.  
3. **Frase 3 (opcional) – Sensação final:** antecipa o resultado esperado (leveza, brilho, equilíbrio, etc.).

---

### Exemplo de estrutura (modelo narrativo):

> Seu cabelo é {{ tipo_de_cabelo }} e hoje precisa de {{ dor_principal }}.  
> O ritual GE Beauty combina fórmulas inteligentes que se adaptam às suas necessidades, equilibrando o couro, fortalecendo a fibra e protegendo o brilho natural.  
> Um cuidado completo que une ciência, sensorialidade e leveza em cada etapa.

---

## Diretrizes de escrita

1. **Tom:** técnico, acolhedor e sensorial — fiel à linguagem GE Beauty.  
2. **Extensão total:** até 3 frases (máximo 60 palavras).  
3. **Evitar instruções de uso ou nomes de produtos.**  
4. **Adapte o vocabulário conforme o tipo e a necessidade do cabelo:**  
   - *Lisos e ondulados:* leveza, brilho, alinhamento.  
   - *Cacheados e crespos:* definição, elasticidade, nutrição.  
   - *Com química:* reconstrução, selagem, proteção.  
   - *Com frizz:* controle, suavidade, polimento.  
   - *Com couro oleoso:* equilíbrio, frescor, regulação.

---

## Vocabulário sugerido

*equilibra*, *nutre*, *protege*, *restaura*, *reconstrói*, *hidrata*, *sela*, *preserva o brilho*, *controla o frizz*, *realça a curvatura*, *mantém leveza*, *devolve vitalidade*, *revitaliza*.

---

## Resumo técnico para IA / Smart Copy

- Gerar **de 2 a 3 frases curtas**, com fluidez natural e tom acolhedor.  
- O texto deve introduzir o conceito de ritual personalizado GE Beauty.  
- Adaptar conforme as respostas do quiz (tipo, dor, química, couro).  
- Focar em **benefício percebido e sensação esperada**.  
- Evitar menções diretas a produtos — manter no nível conceitual/diagnóstico.  

---

## Fallback text

> Seu cabelo merece um cuidado pensado especialmente para ele.  
> O ritual GE Beauty combina ciência e sensorialidade, equilibrando o couro, nutrindo a fibra e protegendo o brilho natural de cada fio.  
> Um sistema inteligente que se adapta às suas necessidades e transforma sua rotina em um momento de autocuidado.


# ═══════════════════════════════════════════════════════  
# SMART PROPERTY GLOBAL – RITUAL COMPLETO RESUMIDO (GE BEAUTY)  
# ═══════════════════════════════════════════════════════  

# Smart property {{ritual-resumido}}

Gere um **resumo único e fluido** do ritual capilar personalizado da GE Beauty, descrevendo de forma concisa e sensorial as quatro etapas — **Limpeza, Tratamento, Finalização e Boosters**.  
Essa Smart Property deve oferecer uma visão completa e inspiradora do ritual de cuidado para clientes que preferem um texto direto e unificado.

---

## Referências obrigatórias

O texto deve considerar as respostas de:
- (Question: tipo de cabelo)  
- (Question: processos químicos)  
- (Question: dor principal)  
- (Question: finalização)  
- (Question: couro cabeludo)  

E integrar os produtos retornados pelos seguintes Smart Products:  
- 1. limpeza  
- 2. tratamento
- 3. finalização
- 4. boosters

---

## Estrutura esperada

O texto deve conter **quatro blocos narrativos curtos**, um para cada etapa:  
- Cada bloco: **2 frases curtas e sensoriais**, claras e naturais.  
- Separação visual por quebras de linha ou travessões curtos.  
- Tom técnico e fluido, sem parecer uma lista, mas com leitura dinâmica facilitada.  
- O texto final deve ser **contínuo, coeso e leve**.

---

### Exemplo de estrutura (modelo de resposta):

> **Limpeza:** O Shampoo GE Beauty limpa suavemente e equilibra o couro cabeludo, preparando os fios para receber tratamento sem ressecar.  
> **Tratamento:** A Máscara Condicionadora e o Leave-in nutrem, restauram e fortalecem a fibra, devolvendo brilho e vitalidade.  
> **Finalização:** O Primer e o Leave-in Pluma selam e protegem os fios, garantindo controle do frizz, toque leve e acabamento radiante.
> **Boosters:** O Booster Hidratante e o Booster Antioxidante potencializam o tratamento e personalizam o resultado em todas as etapas, reforçando maciez, proteção e luminosidade.  

---

## Diretrizes de escrita

1. **Tom:** técnico, sensorial e acolhedor — em coerência com o universo GE Beauty.  
2. **Extensão total:** até 10 frases curtas (máx. 90 palavras).  
3. **Evite instruções de uso.** Foque em benefícios percebidos e efeitos sensoriais.  
4. **Ordem fixa:** Limpeza → Tratamento → Finalização → Boosters.  
5. **Inclua uma transição natural após os Boosters**, reforçando que eles intensificam os resultados do tratamento.  
6. **Adapte o vocabulário** conforme tipo de cabelo e dor principal:  
   - *Lisos e ondulados:* leveza, brilho, alinhamento.  
   - *Cacheados e crespos:* definição, elasticidade, nutrição.  
   - *Com química:* reconstrução, selagem, proteção.  
   - *Com frizz:* controle, suavidade, polimento.  
   - *Com desbotamento:* proteção solar, cor vibrante, luminosidade.  

---

## Vocabulário sugerido

*limpa suavemente*, *equilibra*, *nutre*, *restaura*, *reconstrói*, *protege*, *hidrata*, *sela*, *preserva o brilho*, *controla o frizz*, *realça a curvatura*, *mantém leveza*, *devolve vitalidade*, *revitaliza*, *potencializa o tratamento*, *finaliza com toque sedoso*, *realça o movimento natural*, *preserva a cor*.

---

## Exemplos referenciais

### Exemplo 1 – cabelo liso com química e frizz  
> **Limpeza:** O Shampoo GE Beauty purifica suavemente e reequilibra o couro cabeludo, preparando os fios para o cuidado.  
> **Tratamento:** A Máscara Condicionadora e o Leave-in restauram hidratação e brilho, fortalecendo a fibra após processos químicos.  
> **Boosters:** O Booster Antifrizz e o Booster Hidratante intensificam a maciez e prolongam o alinhamento, suavizando o toque e preservando a leveza.  
> **Finalização:** O Primer Liso Intacto e o Leave-in com Proteção Térmica selam e protegem do calor, mantendo brilho espelhado e toque sedoso.

---

### Exemplo 2 – cabelo cacheado e descolorido  
> **Limpeza:** O Shampoo GE Beauty limpa com suavidade, respeitando a curvatura e o equilíbrio natural.  
> **Tratamento:** A Máscara Condicionadora e o Leave-in Pluma devolvem hidratação e elasticidade, mantendo os cachos leves e definidos.  
> **Boosters:** O Booster Hidratante e o Booster Definição reforçam a nutrição e prolongam a memória dos cachos, realçando o movimento natural.  
> **Finalização:** O Primer Cachos Definidos protege e sela, garantindo definição duradoura, controle do frizz e brilho luminoso.

---

### Exemplo 3 – cabelo ondulado exposto ao sol e sem brilho  
> **Limpeza:** O Shampoo GE Beauty purifica e equilibra o couro cabeludo, devolvendo leveza e vitalidade às ondas.  
> **Tratamento:** A Máscara Condicionadora e o Leave-in revitalizam os fios, preservando o toque natural e o movimento.  
> **Boosters:** O Booster Antioxidante e o Booster Hidratante protegem contra o sol e reforçam a hidratação, devolvendo brilho e maciez.  
> **Finalização:** O Primer Cachos Definidos e o Leave-in Pluma finalizam com leveza, luminosidade e controle do frizz.

---

## Resumo técnico para IA / Smart Copy

- Retornar **um único texto fluido e completo**, com 4 blocos (Limpeza, Tratamento, Boosters, Finalização).  
- O conteúdo deve se basear nas respostas do quiz e nos produtos retornados pelos Smart Products das etapas anteriores.  
- Adotar tom **técnico-sensorial**, claro e contínuo — evitando listas rígidas.  
- Retornar texto formatado com **quebras de linha** entre as etapas.  
- Utilizar vocabulário GE Beauty, destacando resultados percebidos e efeito sensorial.  

**Formato final esperado:**

```
Limpeza: ...
Tratamento: ...
Finalização: ...
Boosters: ...
```


---

### Referência técnica interna GE Beauty

- Todos os produtos devem ser apresentados **por função e resultado percebido**, nunca por composição.  
- O texto deve refletir a filosofia GE Beauty: **ciência, naturalidade e sensorialidade equilibradas.**  
- As sensações-chave a reforçar são: leveza, brilho, controle, movimento e vitalidade.  
- Essa Smart Property representa o **resumo técnico-sensorial final do diagnóstico GE Beauty**, sendo exibida para clientes que preferem uma experiência de leitura rápida e integrada.

---

## Fallback text

> **Limpeza:** O Shampoo GE Beauty limpa suavemente e respeita o equilíbrio natural do couro cabeludo, preparando os fios para receber tratamento.  
> **Tratamento:** A Máscara Condicionadora nutre, hidrata e devolve a maciez, enquanto o Leave-in reforça a vitalidade e protege o comprimento.  
> **Finalização:** O Primer e o Leave-in Pluma selam e protegem os fios do calor e da umidade, garantindo leveza, controle do frizz e brilho natural.
> **Boosters:** Os Boosters GE Beauty potencializam os resultados do tratamento, oferecendo mais brilho, força e proteção conforme a necessidade dos fios.  

---
---
---

# ═══════════════════════════════════════════════════════
# CATEGORIA: LIMPEZA
# PROMPT 1 DE 5: SMART PROPERTY - INTRODUÇÃO
# ═══════════════════════════════════════════════════════

# Smart property {{intro-limpeza}}

Crie um resumo breve e personalizado sobre o perfil capilar do respondente, com base nas respostas de (Question: couro cabeludo), (Question: frequência lavagem) e (Question: processos químicos).

O objetivo é apresentar o diagnóstico de forma acolhedora e técnica, explicando brevemente como é o couro cabeludo, a frequência de lavagem e se há presença de química.

Instruções:
- Use tom acolhedor e positivo, como se fosse uma devolutiva de diagnóstico profissional, porém feito por alguém próximo.  
- Não cite produtos aqui, apenas descreva o tipo de necessidade de limpeza.  
- Mantenha a frase natural e fluida, com até **3 frases curtas**.  
- Transmita sensação de que o cabelo foi compreendido — sem parecer genérico.

Exemplos de estrutura (não copiar literalmente):
- "Seu couro cabeludo pode ter tendência à oleosidade e pede uma limpeza leve, mas equilibrada — perfeita para manter frescor e conforto entre as lavagens."  
- "Como você lava os cabelos com frequência moderada e tem couro equilibrado, o que indica uma rotina suave e gentil de limpeza."  
- "Por conta da química, seu couro pode pedir uma limpeza protetora e nutritiva, que preserve o conforto e a saúde da raiz." 


# ═══════════════════════════════════════════════════════
# CATEGORIA: LIMPEZA
# PROMPT 2 DE 5: SMART PRODUCT - PRODUTOS BASE
# ═══════════════════════════════════════════════════════

# Smart product [1.a) bases limpeza]

Com base nas respostas do quiz, **recomendar os produtos ideais para a etapa de limpeza** considerando as respostas de:

- (Question: couro cabeludo)  
- (Question: frequência lavagem)  
- (Question: processos químicos)

---

## Regras gerais
- O **Shampoo Sem Sulfato** é **sempre recomendado** como base principal de limpeza.  
- O **Shampoo a Seco** é **adicional**, indicado apenas para casos de oleosidade ou uso pontual em raízes oleosas.  
- Sempre exibir **apenas as combinações listadas abaixo**.  
- Retornar também a **justificativa** correspondente, mantendo o tom técnico e acolhedor.

---

## Lógicas de recomendação

### 1. Couro cabeludo oleoso
| Frequência | Produtos recomendados | Justificativa |
|-------------|----------------------|----------------|
| Lava todos os dias | Shampoo Sem Sulfato + Shampoo a Seco | A oleosidade intensa e as lavagens diárias exigem equilíbrio. O Shampoo Sem Sulfato limpa sem ressecar, enquanto o Shampoo a Seco prolonga a sensação de frescor. |
| Lava a cada 2 dias | Shampoo Sem Sulfato + Shampoo a Seco | O Shampoo Sem Sulfato faz a limpeza gentil, e o Shampoo a Seco reduz o acúmulo sebáceo entre lavagens. |
| Lava entre 2 e 3 vezes por semana | Shampoo Sem Sulfato + Shampoo a Seco | Mesmo com lavagens espaçadas, o couro oleoso pode pesar. O Shampoo Sem Sulfato equilibra e o Shampoo a Seco controla a oleosidade. |
| Lava 1 vez por semana | Shampoo Sem Sulfato + Shampoo a Seco | Lavagens raras exigem limpeza completa. O Shampoo Sem Sulfato limpa profundamente e o Shampoo a Seco mantém a sensação de frescor. |

---

### 2. Couro cabeludo equilibrado
| Frequência | Produtos recomendados | Justificativa |
|-------------|----------------------|----------------|
| Lava todos os dias | Shampoo Sem Sulfato | Mesmo com equilíbrio natural, lavagens diárias pedem suavidade. O Shampoo Sem Sulfato preserva o brilho e a barreira natural. |
| Lava a cada 2 dias ou mais | Shampoo Sem Sulfato | Mantém o equilíbrio e a leveza dos fios sem necessidade de reforço adicional. |

---

### 3. Couro cabeludo seco
| Processos químicos | Produtos recomendados | Justificativa |
|--------------------|----------------------|----------------|
| Sem química | Shampoo Sem Sulfato | Remove impurezas sem retirar óleos naturais, mantendo conforto e hidratação. |
| Com química | Shampoo Sem Sulfato | Protege couro e fios sensibilizados, garantindo limpeza protetora e segura. |

---

### 4. Couro cabeludo sensível
| Frequência | Produtos recomendados | Justificativa |
|-------------|----------------------|----------------|
| Lava todos os dias | Shampoo Sem Sulfato | Fórmula livre de agentes agressivos, ideal para uso frequente e couro sensível. |
| Lava 2 a 3 vezes por semana | Shampoo Sem Sulfato | Mantém equilíbrio sem causar irritações ou descamação. |

---

### 5. Couro cabeludo com processos químicos
| Frequência | Produtos recomendados | Justificativa |
|-------------|----------------------|----------------|
| Qualquer frequência | Shampoo Sem Sulfato | A química altera a barreira natural do couro cabeludo. O Shampoo Sem Sulfato protege e evita o ressecamento. |

---

### 6. Situações mistas
| Combinação | Produtos recomendados | Justificativa |
|-------------|----------------------|----------------|
| Couro oleoso + química | Shampoo Sem Sulfato + Shampoo a Seco | A química exige cuidado e o couro oleoso requer controle. O Shampoo Sem Sulfato limpa suavemente e o Shampoo a Seco regula a oleosidade. |
| Couro sensível + oleosidade localizada | Shampoo Sem Sulfato + Shampoo a Seco (uso pontual nas raízes) | O Shampoo Sem Sulfato faz a limpeza global, enquanto o Shampoo a Seco é aplicado apenas nas áreas oleosas. Oferece conforto e equilíbrio. |


# ═══════════════════════════════════════════════════════
# CATEGORIA: LIMPEZA
# PROMPT 3 DE 5: SMART PROPERTY - EXPLICAÇÃO DOS PRODUTOS
# ═══════════════════════════════════════════════════════

# Smart property {{explicacao-bases-limpeza}}

A seção **LIMPEZA** já trará uma introdução, gerada pela smart property {{intro-limpeza}}. Ela será como esta abaixo:

"Seu couro cabeludo oleoso, combinado com lavagens diárias e processos químicos, requer uma limpeza equilibrada que mantenha frescor, conforto e proteção desde a raiz até o comprimento dos fios."

Essa introdução é apenas um exemplo, e variará de acordo com as respostas ao quiz.

Comece com uma frase introdutória, como "Sua limpeza ideal começa" ou outra semelhante, e na sequência crie uma explicação curta, de no máximo uma frase por produto recomendado, e máximo de 7 palavras por frase. As frases devem ser personalizadas considerando as respostas dadas nas perguntas (Question: couro cabeludo), (Question: frequência lavagem) e (Question: processos químicos), de forma a gerar uma continuidade com a **INTRODUÇÃO**. Crie uma conexão entre as frases, mantendo uma única sentença.

Os produtos recomendados são os resultados do bloco Smart Product abaixo:
#### Smart Product Block ID: `a724dd1b5b3b94c866aff7e417da88acfb6d940a`

**Instruções:**
- Use um tom acolhedor, educativo e sensorial, característico da GE Beauty.  
- Destaque a sensação de limpeza equilibrada, leveza e conforto do couro cabeludo.  
- Adapte o texto ao tipo de couro cabeludo, respeitando a rotina de lavagem e a presença (ou não) de processos químicos.  
- As frases de exemplo abaixo são **apenas ilustrativas** e **não devem ser copiadas literalmente**.  

### **Exemplos e diretrizes de conteúdo (referenciais):**

- Se (Question: couro cabeludo) = **oleoso**  
  → Destaque controle e leveza.  
  > *Exemplo de referência:* "Como seu couro cabeludo tende a produzir mais oleosidade, o Shampoo Sem Sulfato limpa com suavidade e o Shampoo a Seco ajuda a prolongar a sensação de frescor entre as lavagens."

- Se (Question: couro cabeludo) = **equilibrado**  
  → Valorize o cuidado diário e a manutenção natural.  
  > *Exemplo de referência:* "Seu couro cabeludo está em equilíbrio — o Shampoo Sem Sulfato mantém essa harmonia, garantindo fios leves e com brilho natural."

- Se (Question: couro cabeludo) = **seco**  
  → Foque na hidratação e conforto.  
  > *Exemplo de referência:* "Seu couro cabeludo precisa de uma limpeza delicada — o Shampoo Sem Sulfato remove impurezas sem ressecar, preservando o toque macio e o conforto."

- Se (Question: couro cabeludo) = **sensível**  
  → Foque em suavidade e proteção.  
  > *Exemplo de referência:* "O Shampoo Sem Sulfato oferece uma limpeza suave e sem agressões, ideal para couros sensíveis. Se houver oleosidade localizada, o Shampoo a Seco pode ser usado apenas nas raízes."

- Se (Question: processos químicos) = **qualquer tipo**  
  → Reforce o cuidado protetor.  
  > *Exemplo de referência:* "Após processos químicos, o Shampoo Sem Sulfato é essencial para limpar sem agredir, protegendo a fibra capilar e mantendo a hidratação natural."

---

### **Resumo técnico para IA / Smart Copy**

- O **Shampoo Sem Sulfato** deve ser mencionado **sempre**, com foco em leveza e equilíbrio.  
- O **Shampoo a Seco** só se for recomendado
- Em couro **sensível com oleosidade localizada**, o **Shampoo a Seco** deve ser descrito como **"uso pontual nas raízes"**.  
- As frases de exemplo fornecidas **não devem ser utilizadas de forma literal**. Elas servem como **modelo de tom de voz, estrutura e intenção de resposta**.  
- Evite repetições excessivas de termos como "proteção" ou "hidratação"; varie as expressões mantendo o mesmo significado (ex.: *"preservar o equilíbrio natural"*, *"mantém o couro saudável e confortável"*).


# ═══════════════════════════════════════════════════════
# CATEGORIA: LIMPEZA
# PROMPT 4 DE 5: SMART PRODUCT - PRODUTOS COMPLEMENTARES (BOOSTERS)
# ═══════════════════════════════════════════════════════

# Smart product [1.b) boosters limpeza]

Com base nas respostas do quiz, **recomendar todos os boosters que se encaixarem nas demandas da consumidora, que sejam ideais para a etapa de limpeza:

- (Question: couro cabeludo)  
- (Question: processos químicos)
- (Question: dor principal)

Priorizar, na ordem de recomendação, aqueles que melhor ajudem a resolver as dores destacadas em (Question: dor principal)

Os boosters atuam de forma **direcionada ao couro cabeludo**, potencializando a etapa de limpeza com foco em equilíbrio, fortalecimento, proteção e conforto.

---

## Regras gerais
- Sempre recomendar **de um a dois boosters**, conforme a necessidade identificada.  
- A ordem de priorização deve seguir a condição mais relevante:  
  **1. Processos químicos → 2. Sensibilidade → 3. Oleosidade → 4. Frizz visível na raiz.**
- Os boosters disponíveis são:
  - **Booster Fortificante** → foco em força e regulação da oleosidade.  
  - **Booster Antioxidante** → foco em proteção, equilíbrio e conforto.  
  - **Booster Antifrizz** → foco em alinhamento e controle do frizz na raiz.  
- Sempre incluir uma **justificativa técnica** clara e sensorial.

---

## Lógicas de priorização

### 1. Couro cabeludo oleoso
| Prioridade | Booster | Justificativa |
|-------------|----------|----------------|
| 1 | Booster Fortificante | Regula a produção de sebo, fortalece a raiz e melhora a vitalidade do couro cabeludo. Ideal para quem lava o cabelo com frequência. |
| 2 | Booster Antioxidante | Complementa com ação protetora contra poluição e calor, evitando desequilíbrio após lavagens frequentes. |
| 3 (condicional) | Booster Antifrizz | Indicado se houver frizz perceptível na raiz, ajudando a manter o visual controlado e limpo por mais tempo. |

---

### 2. Couro cabeludo equilibrado
| Prioridade | Booster | Justificativa |
|-------------|----------|----------------|
| 1 | Booster Antioxidante | Mantém o equilíbrio natural do couro, protegendo contra agressões externas e preservando o brilho dos fios. |
| 2 | Booster Fortificante | Pode ser incluído para reforçar o tônus e a vitalidade da raiz, especialmente em ambientes urbanos. |
| 3 (condicional) | Booster Antifrizz | Útil quando há fios arrepiados próximos à raiz, garantindo acabamento mais uniforme. |

---

### 3. Couro cabeludo seco
| Prioridade | Booster | Justificativa |
|-------------|----------|----------------|
| 1 | Booster Antioxidante | Hidrata, protege e restaura a barreira natural do couro cabeludo, prevenindo desconfortos. |
| 2 | Booster Fortificante | Reforça a estrutura da raiz e ajuda na reposição de nutrientes essenciais à vitalidade. |
| 3 (condicional) | Booster Antifrizz | Pode ser aplicado se o ressecamento gerar frizz na região próxima ao couro cabeludo. |

---

### 4. Couro cabeludo sensível
| Prioridade | Booster | Justificativa |
|-------------|----------|----------------|
| 1 | Booster Antioxidante | Reduz a reatividade e acalma o couro cabeludo sensível, oferecendo conforto e proteção antioxidante. |
| 2 | Booster Fortificante | Pode ser adicionado para fortalecer a barreira natural e auxiliar no equilíbrio do couro. |
| 3 (condicional) | Booster Antifrizz | Indicado apenas em casos de frizz leve, com aplicação mínima para evitar sobrecarga. |

---

### 5. Couro cabeludo com processos químicos
| Prioridade | Booster | Justificativa |
|-------------|----------|----------------|
| 1 | Booster Antioxidante | Protege o couro sensibilizado pela química, reduzindo o estresse oxidativo e prevenindo irritações. |
| 2 | Booster Fortificante | Auxilia na recuperação da vitalidade e da resistência da raiz enfraquecida. |
| 3 (condicional) | Booster Antifrizz | Ajuda no alinhamento dos fios próximos à raiz, evitando aspecto ressecado ou arrepiado após processos químicos. |

---

### 6. Situações mistas

#### 6.1. Couro oleoso com química
| Prioridade | Booster | Justificativa |
|-------------|----------|----------------|
| 1 | Booster Antioxidante | Garante proteção antioxidante e reequilíbrio do couro sensibilizado pela química. |
| 2 | Booster Fortificante | Regula a oleosidade e melhora a estrutura capilar, fortalecendo a raiz. |
| 3 (condicional) | Booster Antifrizz | Adicional para reduzir o frizz em raízes oleosas, sem interferir na leveza dos fios. |

#### 6.2. Couro sensível com oleosidade localizada
| Prioridade | Booster | Justificativa |
|-------------|----------|----------------|
| 1 | Booster Antioxidante | Atua de forma suave, acalmando e equilibrando o couro sensível. |
| 2 | Booster Fortificante | Pode ser aplicado em pequenas áreas oleosas para regular o sebo sem causar irritação. |
| 3 (condicional) | Booster Antifrizz | Recomendado apenas se houver frizz na raiz, com uso leve e localizado. |


# ═══════════════════════════════════════════════════════
# CATEGORIA: LIMPEZA
# PROMPT 5 DE 5: SMART PROPERTY - EXPLICAÇÃO DOS BOOSTERS
# ═══════════════════════════════════════════════════════

# Smart property {{explicacao-boosters-limpeza}}

Os produtos recomendados são os resultados do bloco Smart Product abaixo:
#### Smart Product Block ID: `fc42030f18e5611f48349e3f5e1df96a5633092c`

Com base nas respostas de:
- (Question: couro cabeludo)  
- (Question: processos químicos)  
- (Question: dor principal)

Gere **uma frase curta por booster recomendado**, explicando de forma sensorial e técnica **como ele potencializa a etapa de limpeza**, trazendo conforto, equilíbrio, força ou proteção antioxidante.  
As frases devem soar naturais, como uma continuidade da limpeza, sem mencionar produto, uso ou aplicação.

---

## Diretrizes de estilo
- **1 frase curta por booster** (máx. 25 palavras).  
- Use aberturas como:  
  - "Para potencializar sua limpeza,"  
  - "Para complementar sua rotina de limpeza,"  
  - "Para restaurar o conforto do couro cabeludo,"  
  - "Para cuidar da sua principal necessidade,"  
- Ajuste o tom conforme presença de química ou sensibilidade.  
- Mantenha o estilo **GE Beauty**: especialista, acolhedor e sensorial.  

---

## Regras de adaptação
- Se houver **processos químicos**, enfatize **proteção, equilíbrio e recuperação da raiz**.  
- Se o couro for **oleoso**, destaque **leveza, controle e vitalidade**.  
- Se for **sensível**, priorize **conforto e frescor**.  
- Se for **seco**, valorize **hidratação e barreira natural**.  
- Se a **dor principal** estiver relacionada a queda, coceira ou ressecamento, reflita isso de forma natural no benefício descrito.

---

## Estrutura de saída esperada
**Exemplo (respeitando a lógica GE Beauty):**

- **Booster Fortificante**  
  "Para potencializar sua limpeza, o Booster Fortificante fortalece a raiz e ajuda a equilibrar o couro cabeludo, promovendo sensação de vigor e leveza desde a primeira lavagem."

- **Booster Antioxidante**  
  "Para complementar sua rotina de limpeza, o Booster Antioxidante protege contra o estresse oxidativo, acalmando o couro e preservando o brilho e o conforto."

- **Booster Antifrizz**  
  "Para cuidar da sua principal necessidade, o Booster Antifrizz suaviza a raiz e ajuda a manter os fios alinhados, garantindo limpeza com toque polido e leve."

---

## Resumo técnico para IA / Smart Copy
- Retornar **apenas boosters recomendados** conforme lógica do bloco `[1.b) boosters limpeza]`.  
- Cada booster deve gerar **1 frase independente e coerente**, respeitando o contexto da etapa de limpeza.  
- Evitar redundâncias entre boosters (ex.: não repetir "proteção" ou "equilíbrio" em frases consecutivas).  
- Manter sempre o foco no **benefício sensorial e perceptível após a limpeza**.

---
---
---

# ═══════════════════════════════════════════════════════
# CATEGORIA: TRATAMENTO
# PROMPT 1 DE 5: SMART PROPERTY – INTRODUÇÃO
# ═══════════════════════════════════════════════════════

# Smart property {{intro-tratamento}}

Crie um texto introdutório personalizado sobre o **momento de tratamento dos fios**, com base nas respostas de:
- (Question: tipo de cabelo)
- (Question: espessura)
- (Question: processos químicos)
- (Question: dor principal)

O objetivo é apresentar a etapa de tratamento como o **momento de nutrição, reparação e fortalecimento** do ritual GE Beauty, conectando o diagnóstico anterior às necessidades de reconstrução, hidratação e vitalidade dos fios.
A resposta deve soar acolhedora, técnica e inspiradora, refletindo o estilo GE Beauty: **científico, sofisticado e gentil**.

---

## Instruções

1. Comece com uma frase curta que **conecte o perfil capilar ao momento de tratamento** (ex: "Seu momento de tratamento é sobre devolver equilíbrio e força aos fios.").
2. Em seguida, descreva o **objetivo principal do tratamento** de forma sensorial, reforçando nutrição, reparação, hidratação ou reconstrução, conforme o tipo de cabelo e a dor principal.
3. Use até **3 frases curtas** no total.
4. Não cite produtos ainda — apenas descreva o tipo de cuidado que o cabelo precisa na etapa de tratamento.
5. Adote um tom que una diagnóstico + cuidado + benefício perceptível.
6. Evite repetições e termos genéricos; prefira palavras que expressem **nutrição, força e vitalidade.**

---

## Diretrizes de personalização

| Condição | Direcionamento de tom e conteúdo |
|-----------|----------------------------------|
| **Tipo de cabelo = Liso** | Foco em leveza, brilho e nutrição sem peso. Reforce hidratação equilibrada. |
| **Tipo de cabelo = Ondulado** | Valorize movimento natural e hidratação que preserva a maleabilidade. |
| **Tipo de cabelo = Cacheado** | Foque em elasticidade, definição e nutrição profunda. |
| **Tipo de cabelo = Crespo** | Valorize reconstrução, nutrição intensa e resistência. |
| **Espessura = Fina** | Enfatize leveza e proteção sem acúmulo. |
| **Espessura = Grossa** | Destaque força, selagem e nutrição profunda. |
| **Processos químicos = Sim** | Reforce reparação da fibra, reconstrução e devolução de força. |
| **Dor principal = Frizz** | Reforce suavidade e alinhamento. |
| **Dor principal = Seco/Opaco** | Valorize hidratação e brilho restaurado. |
| **Dor principal = Fraco/Quebradiço** | Foque em força, vitalidade e reconstrução. |
| **Dor principal = Sem definição** | Destaque elasticidade e cuidado da curvatura. |

---

## Exemplos referenciais (não copiar literalmente)

- **Liso com química:**
  "Seu momento de tratamento é sobre reparar e devolver o brilho — nutrir profundamente sem pesar, reconstruindo a leveza natural dos fios."

- **Cacheado e ressecado:**
  "O tratamento é a etapa que devolve vida aos seus cachos — nutrição profunda, elasticidade e hidratação que se traduzem em definição e movimento."

- **Crespo e quebradiço:**
  "Seus fios precisam de força e nutrição intensa — o tratamento reconstrói e fortalece, devolvendo resistência e vitalidade da raiz às pontas."

- **Ondulado e fino:**
  "O tratamento ideal para as suas ondas é leve e preciso — nutre sem acumular, preservando o movimento e a textura natural dos fios."

---

## Vocabulário e tom de voz GE Beauty

**Palavras-chave recomendadas:**
*nutre*, *repara*, *restaura*, *reconstrói*, *fortalece*, *devolve vitalidade*, *hidrata profundamente*, *mantém leveza*, *preserva a elasticidade*, *revigora*

**Tom:** técnico, sensorial e positivo.
**Estilo:** frases curtas, harmônicas, com fluidez emocional e foco no benefício percebido.
**Evite:** menções a modo de uso, instruções ou nomes de produtos.

---

## Estrutura esperada

1. **Frase introdutória:** conecta o perfil do cabelo ao momento do tratamento.
2. **Frase sensorial:** descreve o benefício principal da etapa (nutrição, reparação, hidratação, força, elasticidade).
3. **Frase de fechamento opcional:** transmite sensação de cuidado profundo e resultado visível.

---

## Resumo técnico para IA / Smart Copy
- Adaptar o texto conforme as respostas de (Question: tipo de cabelo), (Question: espessura), (Question: processos químicos) e (Question: dor principal).
- Gerar texto de até **3 frases curtas**, com fluidez natural e tom sensorial.
- Evitar redundância entre frases.
- Focar em **benefício percebido** (o que o cabelo "ganha") e **sensação** (como o cabelo "se sente").
- O texto deve funcionar como **transição direta para o Smart Product [2.a) bases tratamento]**, introduzindo a escolha dos produtos.

---

### Referência técnica interna GE Beauty
- O tratamento é a etapa que **nutre, repara e fortalece** a fibra capilar.
- Os produtos dessa etapa (máscaras e leave-ins) unem **tecnologia de reposição lipídica, reparação profunda e efeito sensorial leve**.
- Representa o momento de **cuidado profundo e restauração**, traduzindo a ciência GE Beauty em fios mais fortes, macios e visivelmente saudáveis.


# ═══════════════════════════════════════════════════════
# CATEGORIA: TRATAMENTO
# PROMPT 2 DE 5: SMART PRODUCT – BASES DE TRATAMENTO
# ═══════════════════════════════════════════════════════

# Smart product [2.a) bases tratamento]

Com base nas respostas do quiz, **recomende os produtos ideais para a etapa de TRATAMENTO**, considerando as respostas de:

- (Question: tipo de cabelo)  
- (Question: espessura)  
- (Question: processos químicos)  
- (Question: dor principal)

---

## Regras gerais
- A **Máscara Condicionadora** é **sempre obrigatória** como base de tratamento.  
- O **Leave-in Pluma** é **complementar**, indicado para fios finos, com química, ou quando há dores relacionadas a **ressecamento, quebra, frizz ou opacidade**.  
- A recomendação deve priorizar **a reparação da fibra capilar, o equilíbrio entre nutrição e leveza**, e o efeito sensorial característico da marca.  
- Sempre retornar **apenas as combinações listadas abaixo**, acompanhadas de **justificativa técnica e sensorial**.  

---

## Lógicas de recomendação

### 1. Cabelos lisos
| Condição | Produtos recomendados | Justificativa |
|-----------|----------------------|----------------|
| Fios finos e sem química | Máscara Condicionadora + Leave-in Pluma (uso leve) | A Máscara nutre e devolve maciez, enquanto o Leave-in Pluma forma um filme protetor ultraleve que mantém o alinhamento natural e o toque sedoso. |
| Fios grossos ou com química | Máscara Condicionadora + Leave-in Pluma | O tratamento atua na reparação e selagem das cutículas, garantindo fios mais fortes, brilhantes e resistentes à quebra. |

---

### 2. Cabelos ondulados
| Condição | Produtos recomendados | Justificativa |
|-----------|----------------------|----------------|
| Sem química | Máscara Condicionadora | Restaura o equilíbrio natural dos fios, mantendo definição e movimento leve sem pesar. |
| Com química | Máscara Condicionadora + Leave-in Pluma | Reforça a hidratação e protege as ondas de danos térmicos e externos, mantendo toque suave e brilho saudável. |

---

### 3. Cabelos cacheados
| Condição | Produtos recomendados | Justificativa |
|-----------|----------------------|----------------|
| Sem química | Máscara Condicionadora | Devolve elasticidade e hidratação profunda, mantendo os cachos definidos, leves e com aspecto saudável. |
| Com química | Máscara Condicionadora + Leave-in Pluma | Potencializa o tratamento com reposição lipídica e selagem protetora, reduzindo ressecamento e frizz. |

---

### 4. Cabelos crespos
| Condição | Produtos recomendados | Justificativa |
|-----------|----------------------|----------------|
| Sem química | Máscara Condicionadora | Promove nutrição intensa, definição natural e brilho profundo, mantendo o conforto do couro e a maleabilidade dos fios. |
| Com química | Máscara Condicionadora + Leave-in Pluma | Reforça reconstrução e selagem, restaurando resistência, maciez e controle do frizz após processos químicos. |

---

### 5. Dor principal
| Dor | Produtos recomendados | Justificativa |
|------|----------------------|----------------|
| Frizz | Máscara Condicionadora | Suaviza a superfície dos fios e controla o frizz, mantendo leveza e brilho natural. |
| Ressecamento, quebra ou opacidade | Máscara Condicionadora + Leave-in Pluma | O combo intensifica a reposição de nutrientes e cria uma barreira protetora que restaura vitalidade e resistência. |

---

### 6. Situações mistas
| Condição | Produtos recomendados | Justificativa |
|-----------|----------------------|----------------|
| Cabelos cacheados e descoloridos | Máscara Condicionadora + Leave-in Pluma | Repara a fibra fragilizada, devolvendo elasticidade, brilho e definição aos fios descoloridos. |
| Cabelos lisos com frizz e química | Máscara Condicionadora + Leave-in Pluma | Promove selagem térmica e controle de frizz, equilibrando nutrição e leveza sem acúmulo de produto. |

---

### 7. Reconstrução profunda (dano severo ou química intensa)
| Condição | Produtos recomendados | Justificativa |
|-----------|----------------------|----------------|
| Cabelos com descoloração, química sobreposta ou quebra severa | Máscara Condicionadora + Máscara Mayday + Leave-in Pluma | A Máscara Mayday é um tratamento de reconstrução profunda que repõe massa e lipídios perdidos, reconstruindo o fio de dentro para fora. Indicada para uso 1x a cada 15 dias, alternando com hidratação e nutrição. A Máscara Condicionadora mantém o cuidado entre as sessões de reconstrução. |

---

## Resumo técnico para IA / Smart Copy
- Sempre incluir **Máscara Condicionadora** em todas as respostas.
- Adicionar **Máscara Mayday** quando houver dano severo, química intensa ou quebra acentuada — é um tratamento de reconstrução profunda (uso 1x a cada 15 dias), não substitui a Máscara Condicionadora no dia a dia.
- Adicionar **Leave-in Pluma** quando houver química, fios grossos, frizz intenso ou dores relacionadas a ressecamento, quebra e opacidade.
- Evitar menções diretas a "modo de uso" — manter o foco em **benefícios percebidos** e **efeitos sensoriais**.  
- Adotar tom **técnico, sensorial e acolhedor**, característico da GE Beauty.  
- Priorizar o vocabulário da marca: *nutre*, *restaura*, *protege*, *preserva*, *mantém leveza*, *reforça a vitalidade*, *realça o brilho natural*.  

---

### Referência técnica interna GE Beauty
- **Máscara Condicionadora:** Base universal de tratamento com ação de nutrição, reposição lipídica e toque sedoso.
- **Máscara Mayday:** Tratamento de reconstrução profunda que reconstrói e repõe massa e lipídios perdidos após processos químicos, devolvendo força, resistência e brilho ao fio de dentro para fora. Indicada para cabelos danificados, quimicamente tratados ou quebradiços. Uso recomendado: 1x a cada 15 dias, alternando com hidratação e nutrição.
- **Leave-in Pluma:** Fórmula leve e multifuncional que protege contra danos térmicos até 230 °C, repara fios danificados por química, repõe lipídios e devolve força à fibra — promovendo alinhamento, hidratação e brilho sem pesar.
- Todos são **veganos, biodegradáveis e dermatologicamente testados**, mantendo o padrão clean e sensorial da marca.


# ═══════════════════════════════════════════════════════
# CATEGORIA: TRATAMENTO
# PROMPT 3 DE 5: SMART PROPERTY - EXPLICAÇÃO DOS PRODUTOS
# ═══════════════════════════════════════════════════════

# Smart property {{explicacao-bases-tratamento}}

Esta Smart Property deve ser exibida **logo após a recomendação dos produtos** feita pelo Smart Product **[2.a) bases tratamento]**.  
Seu objetivo é **gerar uma explicação personalizada e sensorial** sobre os produtos indicados — **Máscara Condicionadora** (obrigatória) e **Leave-in Pluma** (complementar) — conectando o diagnóstico do quiz à lógica da recomendação anterior.

---

## Referências obrigatórias
A explicação deve considerar as respostas de:
- (Question: tipo de cabelo)  
- (Question: espessura)  
- (Question: processos químicos)  
- (Question: dor principal)

Os produtos recomendados são os resultados do bloco Smart Product abaixo:
#### Smart Product Block ID: `b3efbed1ba269b1aca8aa1109940563b19baa3bb`

E deve estar **em continuidade direta** com o resultado retornado pelo Smart Product, mantendo o mesmo tom técnico e acolhedor.


---

## Instruções de escrita

1. **Comece com uma frase introdutória** que conecte o diagnóstico do cabelo à etapa de tratamento (ex: "Seu momento de tratamento é sobre devolver equilíbrio e força aos fios.").  
2. Descreva o benefício de **cada produto recomendado** (apenas uma frase por produto), com até **7 palavras por frase**.
3. O texto deve ter fluidez natural, formando um único parágrafo com **tom sensorial e científico**, sem parecer automatizado.  
4. Personalize o texto conforme o tipo de cabelo, presença de química e dor principal.  
5. Nunca mencione "modo de uso" — apenas efeitos, sensações e resultados.  
6. Utilize o **vocabulário GE Beauty** e mantenha coerência com as etapas anteriores do quiz.  

---

## Diretrizes de personalização

| Condição | Direcionamento de tom e benefício |
|-----------|-----------------------------------|
| **Tipo de cabelo = Liso** | Foco em brilho, leveza e alinhamento. Destaque a nutrição sem peso e o toque sedoso. |
| **Tipo de cabelo = Ondulado** | Valorize movimento natural e hidratação equilibrada, mantendo definição leve. |
| **Tipo de cabelo = Cacheado** | Reforce elasticidade, definição e maciez. Use expressões como "fios flexíveis e luminosos". |
| **Tipo de cabelo = Crespo** | Foque em nutrição profunda e reconstrução. Valorize resistência e conforto do couro cabeludo. |
| **Espessura = Fina** | Enfatize leveza e proteção sem acúmulo. |
| **Espessura = Grossa** | Destaque força e selagem das cutículas. |
| **Processos químicos = Sim** | Inclua mensagens sobre reparação e proteção da fibra. |
| **Dor principal = Frizz** | Realce alinhamento, toque polido e controle suave. |
| **Dor principal = Ressecamento/Quebra/Opacidade** | Foque em vitalidade, brilho e reconstrução imediata. |

---

## Exemplos referenciais (não copiar literalmente)

- **Perfil liso e fino, sem química:**  
  "Seu tratamento é sobre leveza e brilho natural — a Máscara devolve hidratação equilibrada e o Leave-in Pluma preserva a suavidade e o movimento sem pesar."

- **Perfil cacheado e com química:**  
  "O tratamento restaura a elasticidade e protege os fios sensibilizados — a Máscara nutre profundamente e o Leave-in cria uma película leve que mantém definição e maciez por todo o dia."

- **Perfil crespo e com dor de quebra:**  
  "O momento de tratamento é de reconstrução intensa — a Máscara repõe lipídios essenciais e o Leave-in reforça a resistência e o brilho, selando os fios com conforto e suavidade."

---

## Vocabulário e tom de voz GE Beauty

**Palavras-chave recomendadas:**  
*nutre*, *repara*, *restaura*, *revigora*, *protege*, *preserva*, *mantém leveza*, *controla o frizz*, *realça o brilho natural*, *reforça a vitalidade*.

**Tom:** técnico, sensorial e acolhedor — com foco em experiência e resultado, nunca em instrução.  
**Ritmo:** frases curtas, harmônicas, com leve musicalidade de texto.  
**Estilo:** diagnóstico + benefício percebido + sensação final.

---

## Estrutura esperada

1. **Frase introdutória:** contextualiza o momento do tratamento (3–10 palavras).  
2. **Frase sobre a Máscara Condicionadora:** sempre presente, foca em nutrição e reparação.  
3. **Frase sobre o Leave-in Pluma (quando recomendado):** reforça leveza, proteção térmica e brilho.  
4. **Conclusão opcional:** sensação final do tratamento (ex: "Fios renovados, leves e cheios de vitalidade.").

---

## Resumo técnico para IA / Smart Copy

- Conectar logicamente ao output do **Smart Product [2.a) bases tratamento]**.  
- Adaptar com base nas respostas do quiz (tipo, espessura, química, dor).  
- Incluir sempre **Máscara Condicionadora**, e **Leave-in Pluma** apenas quando indicado.  
- Manter coerência com o tom da marca GE Beauty (científico, sensorial, acessível e empático).  
- Focar em **resultado percebido** — o que o cabelo "sente" e "mostra".  
- Finalizar com **efeito emocional positivo**, reforçando o ritual de autocuidado.

---

### Referência técnica interna GE Beauty
- **Máscara Condicionadora:** base universal de nutrição e reparação profunda, enriquecida com biotecnologia para restauração e toque sedoso.  
- **Leave-in Pluma:** fórmula leve que protege contra o calor até 230 °C, repara danos químicos, repõe lipídios e reforça alinhamento, hidratação e brilho sem pesar.
- Ambos atuam sinergicamente para promover **fios nutridos, alinhados e naturalmente radiantes** — com o equilíbrio perfeito entre ciência e sensorialidade.


# ═══════════════════════════════════════════════════════  
# CATEGORIA: TRATAMENTO
# PROMPT 4 DE 5: SMART PRODUCT – BOOSTERS DE TRATAMENTO  
# ═══════════════════════════════════════════════════════  

# Smart product [2.b) boosters tratamento]

Com base nas respostas do quiz, **recomende o booster ideal para potencializar o tratamento**, considerando as respostas de:

- (Question: tipo de cabelo)  
- (Question: processos químicos)  
- (Question: dor principal)

---

## Regras gerais
- O booster atua como **complemento da Máscara Condicionadora e do Leave-in Pluma**, trazendo benefícios específicos e direcionados.  
- Sempre indicar **um booster principal por cliente**, priorizando o maior nível de dano ou necessidade, e indicar também **boosters complementares**.
- A escolha deve se basear nas condições abaixo.  
- A justificativa deve manter **tom técnico, sensorial e acolhedor**, reforçando o conceito de personalização e ritual de autocuidado GE Beauty.  

---

## Lógicas de recomendação

### 1. Dor principal: frizz
**Booster recomendado:** Booster Antifrizz  
**Justificativa:**  
Controla o frizz desde a primeira aplicação, formando um escudo protetor leve que alinha a fibra e devolve o brilho natural.  
Ideal para cabelos lisos, ondulados ou com química, que precisam de suavidade e toque polido.

---

### 2. Dor principal: ressecamento, aspereza ou opacidade
**Booster recomendado:** Booster Hidratante  
**Justificativa:**  
Rico em ativos umectantes e nutritivos, restaura o equilíbrio hídrico dos fios e devolve maciez, elasticidade e luminosidade.  
Perfeito para cabelos secos, danificados por calor ou expostos a química.

---

### 3. Dor principal: fios fracos, quebradiços ou com queda
**Booster recomendado:** Booster Fortificante  
**Justificativa:**  
Fortalece a estrutura interna da fibra capilar e estimula a vitalidade do couro cabeludo.  
Recomendado para cabelos enfraquecidos ou sensibilizados por processos químicos.

---

### 4. Dor principal: falta de definição (em cabelos com curvatura)
**Booster recomendado:** Booster Definição  
**Justificativa:**  
Ativa a curvatura natural e prolonga a durabilidade dos cachos e ondas.  
Reduz o frizz e mantém a hidratação sem comprometer a leveza dos fios.

---

### 5. Processos químicos
**Booster recomendado:**  
- (Question: processos químicos) = **alisamento** → Booster Fortificante  
- (Question: processos químicos) = **coloração** → Booster Hidratante  
- (Question: processos químicos) = **descoloração** → Booster Hidratante + Booster Fortificante (alternar o uso)

**Justificativa:**  
A química fragiliza a fibra e demanda reposição de massa e umidade.  
O Booster Fortificante reconstrói internamente, enquanto o Booster Hidratante devolve brilho e maleabilidade.

---

### 6. Tipo de cabelo
| Tipo | Booster recomendado | Justificativa |
|------|---------------------|----------------|
| Liso | Booster Antifrizz | Garante alinhamento e suavidade, controlando o volume e proporcionando brilho espelhado. |
| Ondulado | Booster Hidratante | Mantém leveza e maleabilidade, realçando o movimento natural. |
| Cacheado | Booster Definição | Reforça hidratação, elasticidade e definição dos cachos. |
| Crespo | Booster Definição | Intensifica a nutrição e a forma natural dos fios, mantendo-os flexíveis e definidos. |

---

### 7. Situações mistas
| Condição | Booster recomendado | Justificativa |
|-----------|---------------------|----------------|
| Cabelos com química e quebra | Booster Fortificante | Reforça a fibra e devolve resistência, brilho e vitalidade. |
| Cabelos cacheados e descoloridos | Booster Hidratante | Reidrata intensamente e suaviza a textura, mantendo definição. |
| Cabelos lisos e coloridos com frizz | Booster Antifrizz | Alinha e sela as cutículas pós-coloração, mantendo brilho e suavidade. |

---

## Diretrizes técnicas para IA / Smart Copy

- Sempre mencionar o booster como **complemento da etapa de tratamento**, não como produto isolado.  
- As respostas de (Question: dor principal) têm **prioridade máxima** na decisão do booster.  
- (Question: processos químicos) refina a decisão (ex.: *quebra + química → Fortificante* / *ressecamento + química → Hidratante*).  
- Adotar linguagem **técnica, sensorial e acolhedora**, mantendo consistência com o restante do quiz.  
- Evitar repetições de expressões — variar entre *restaura, reforça, alinha, devolve, potencializa, revitaliza, suaviza*.  
- Nunca incluir instruções de uso.  

---

### Referência técnica interna GE Beauty
- **Booster Antifrizz:** tecnologia antiumidade e selagem leve que alinha a fibra, sela as cutículas e cria uma película protetora contra a umidade, reduzindo o frizz visível sem pesar. Também protege contra danos térmicos.
- **Booster Hidratante:** blend de ativos umectantes e vegetais que reidratam profundamente e melhoram o brilho e a maciez.  
- **Booster Fortificante:** reforço biotecnológico com aminoácidos e proteínas que fortalecem a estrutura interna dos fios.  
- **Booster Definição:** polímeros vegetais que criam filme flexível e prolongam a definição natural dos cachos e ondas.  
Todos os boosters são **veganos, biodegradáveis e compatíveis com a Máscara Condicionadora e o Leave-in Pluma**.


# ═══════════════════════════════════════════════════════  
# CATEGORIA: TRATAMENTO
# PROMPT 5 DE 5: SMART PROPERTY – EXPLICAÇÃO DOS BOOSTERS  
# ═══════════════════════════════════════════════════════  

# Smart property {{explicacao-boosters-tratamento}}

Esta Smart Property deve ser exibida **logo após a recomendação dos boosters** feita pelo Smart Product **[2.b) boosters tratamento]**.  
O objetivo é **explicar de forma sensorial, técnica e acolhedora** como o(s) booster(s) escolhido(s) atua(m) para potencializar os efeitos da etapa de tratamento, conectando com a dor principal e o tipo de cabelo identificado no quiz.

---

## Referências obrigatórias
A explicação deve considerar as respostas de:
- (Question: tipo de cabelo)  
- (Question: processos químicos)  
- (Question: dor principal)

Os boosters recomendados são os resultados do bloco Smart Product abaixo:  
#### Smart Product Block ID: `907c017179ce6914f368bf0322d6c144ae7f5f3a`

E o texto deve manter **continuidade direta** com o resultado retornado pelo Smart Product, respeitando o mesmo tom técnico e sensorial.

---

## Instruções de escrita

1. **Crie uma frase curta por booster recomendado** (máximo 8 palavras cada).  
2. A primeira frase pode começar com expressões como:  
   - "Para potencializar seu tratamento,"  
   - "Para complementar o cuidado dos seus fios,"  
   - "Para cuidar da sua principal necessidade,"  
   - "Para entregar o toque final que seu cabelo merece,"  
3. Descreva **como o booster atua** sobre o fio (e não como se usa).  
4. Adapte o texto conforme as respostas do quiz — tipo de cabelo, presença de química e dor principal.  
5. Use o **vocabulário GE Beauty** e mantenha a escrita fluida, com ênfase em sensações e resultados percebidos.  
6. Evite repetições de termos e mantenha **naturalidade e musicalidade leve** nas frases.  

---

## Diretrizes de personalização por booster

| Booster | Foco principal | Direcionamento de tom |
|----------|----------------|------------------------|
| **Antifrizz** | Controle, alinhamento e brilho polido | Ideal para cabelos lisos, ondulados ou quimicamente tratados. Foco em suavidade e toque leve. |
| **Hidratante** | Reposição hídrica e nutrição sensorial | Destaque maciez, brilho e toque sedoso. Transmita sensação de "fios revividos". |
| **Fortificante** | Força, reconstrução e resistência da fibra | Foco em cabelos danificados, com química ou quebra. Use termos como "vigor", "estrutura" e "revitalização". |
| **Definição** | Curvatura, elasticidade e movimento natural | Voltado para cabelos cacheados e crespos. Valorize a leveza, definição e controle de frizz. |

---

## Diretrizes por condição adicional

| Condição | Ajuste de linguagem |
|-----------|--------------------|
| **Com processos químicos** | Reforce proteção e reparação profunda da fibra. |
| **Sem processos químicos** | Destaque manutenção da saúde e prevenção de danos. |
| **Dor principal = frizz** | Foque em alinhamento e brilho natural. |
| **Dor principal = ressecamento, quebra, opacidade** | Valorize nutrição, hidratação e força. |
| **Dor principal = falta de definição** | Destaque elasticidade e movimento leve. |

---

## Exemplos referenciais (não copiar literalmente)

- **Booster Antifrizz:**  
  "Para potencializar seu tratamento, o Booster Antifrizz alinha a fibra capilar e controla o frizz, mantendo os fios leves, brilhantes e com toque suave."

- **Booster Hidratante:**  
  "Para complementar seu cuidado, o Booster Hidratante repõe a umidade e devolve a maciez, transformando o toque dos fios desde a primeira aplicação."

- **Booster Fortificante:**  
  "Para fortalecer a fibra, o Booster Fortificante atua na reconstrução interna dos fios, devolvendo resistência, vitalidade e brilho saudável."

- **Booster Definição:**  
  "Para realçar a beleza natural do seu cabelo, o Booster Definição ativa a curvatura e prolonga a definição, mantendo os fios flexíveis e luminosos."

---

## Vocabulário e tom de voz GE Beauty

**Palavras-chave recomendadas:**  
*nutre*, *repara*, *revigora*, *fortalece*, *protege*, *restaura*, *hidrata*, *realça*, *mantém leveza*, *define*, *controla o frizz*, *devolve brilho*, *reforça vitalidade*  

**Tom:**  
Técnico, sensorial e acolhedor — com ênfase em experiência e resultado, nunca em instrução.  

**Ritmo:**  
Frases curtas, com sonoridade natural e fluidez emocional.  

**Estilo:**  
Continuação do raciocínio iniciado no Smart Product — conexão entre diagnóstico + recomendação + benefício percebido.  

---

## Estrutura esperada

1. **Frase introdutória:** conecta com o tratamento principal.  
2. **Frase por booster:** descreve o benefício sensorial e técnico.  
3. **Conclusão opcional:** sensação final desejada (ex.: "Um toque final que traduz força e leveza natural.")

---

## Resumo técnico para IA / Smart Copy

- Retornar **apenas boosters recomendados** conforme lógica do **Smart Product [2.b) boosters tratamento]**.  
- Gerar **uma frase independente e coesa por booster**, com até 25 palavras.  
- Adaptar tom e ênfase conforme as respostas do quiz e o tipo de cabelo.  
- Evitar repetições de expressões entre boosters diferentes.  
- Focar em **benefício sensorial e resultado perceptível após o tratamento**, não em instruções de aplicação.  
- Manter coerência com a identidade verbal GE Beauty — um equilíbrio entre ciência, sensorialidade e empatia.

---

### Referência técnica interna GE Beauty
- **Booster Antifrizz:** age na selagem das cutículas e no alinhamento da fibra, criando barreira contra a umidade com ação imediata de brilho, suavidade e proteção térmica.
- **Booster Hidratante:** atua na reposição hídrica profunda e melhora a textura dos fios com toque leve e sedoso.  
- **Booster Fortificante:** reestrutura a fibra capilar e previne a quebra, aumentando a resistência e o vigor.  
- **Booster Definição:** mantém a curvatura natural e reduz o frizz, promovendo elasticidade e movimento natural.  
Todos os boosters são **veganos, biodegradáveis e compatíveis** com a Máscara Condicionadora e o Leave-in Pluma.

---
---
---

# ═══════════════════════════════════════════════════════  
# CATEGORIA: FINALIZAÇÃO  
# PROMPT 1 DE 5: SMART PROPERTY – INTRODUÇÃO  
# ═══════════════════════════════════════════════════════  

# Smart property {{intro-finalizacao}}

Crie um texto introdutório personalizado sobre o **momento de finalização dos fios**, com base nas respostas de:  
- (Question: tipo de cabelo)  
- (Question: finalização)  
- (Question: processos químicos)  
- (Question: dor principal)

O objetivo é apresentar a etapa de finalização como o **toque final do ritual GE Beauty**, conectando o diagnóstico anterior às necessidades de proteção, acabamento e sensorialidade dos fios.  
A resposta deve soar acolhedora, técnica e inspiradora, refletindo o estilo GE Beauty: **científico, sofisticado e gentil**.

---

## Instruções

1. Comece com uma frase curta que **conecte o perfil capilar ao momento de finalização** (ex: "Seu ritual termina com o toque que transforma.").  
2. Em seguida, descreva o **objetivo principal da finalização** de forma sensorial, reforçando leveza, definição, alinhamento, proteção térmica ou brilho, conforme o tipo de cabelo e o modo de finalização.  
3. Use até **3 frases curtas** no total.  
4. Não cite produtos ainda — apenas descreva o tipo de cuidado que o cabelo precisa na etapa final.  
5. Adote um tom que una diagnóstico + cuidado + benefício perceptível.  
6. Evite repetições e termos genéricos; prefira palavras que expressem **movimento, brilho e proteção.**

---

## Diretrizes de personalização

| Condição | Direcionamento de tom e conteúdo |
|-----------|----------------------------------|
| **Tipo de cabelo = Liso** | Foco em alinhamento, toque leve e brilho espelhado. Reforce proteção térmica se houver finalização com calor. |
| **Tipo de cabelo = Ondulado** | Valorize movimento natural e controle de frizz. Destaque leveza e definição suave. |
| **Tipo de cabelo = Cacheado** | Foque em definição, maciez e elasticidade. Realce o formato natural dos cachos e o controle da umidade. |
| **Tipo de cabelo = Crespo** | Valorize nutrição profunda e definição firme. Mencione resistência e brilho. |
| **Processos químicos = Sim** | Reforce proteção e selagem, destacando a importância da finalização como blindagem dos fios. |
| **Finalização = com calor (escova, chapinha, secador, difusor)** | Destaque proteção térmica, alinhamento e brilho. |
| **Finalização = natural (sem calor)** | Enfatize leveza, toque suave e movimento natural. |
| **Dor principal = Frizz** | Reforce alinhamento e suavidade. |
| **Dor principal = Seco/Opaco** | Valorize brilho e textura sedosa. |
| **Dor principal = Sem definição** | Destaque elasticidade, curvatura e movimento. |

---

## Exemplos referenciais (não copiar literalmente)

- **Liso com uso de calor:**  
  "Seu momento de finalização é sobre brilho e proteção — o toque que sela, alinha e mantém o liso leve por mais tempo."

- **Ondulado natural:**  
  "Na finalização, seus fios ganham movimento e controle — o equilíbrio entre definição suave e toque livre, com aparência naturalmente saudável."

- **Cacheado com difusor:**  
  "O momento da finalização realça a curvatura dos seus cachos — proteção, elasticidade e brilho em cada movimento."

- **Crespo com química:**  
  "A finalização é o cuidado que sela e nutre — protegendo seus fios e revelando o brilho profundo da curvatura natural."

---

## Vocabulário e tom de voz GE Beauty

**Palavras-chave recomendadas:**  
*protege*, *sela*, *alinha*, *define*, *realça*, *preserva o movimento*, *mantém leveza*, *controla o frizz*, *devolve o brilho*, *finaliza com toque sedoso*  

**Tom:** técnico, sensorial e positivo.  
**Estilo:** frases curtas, harmônicas, com fluidez emocional e foco no benefício percebido.  
**Evite:** menções a modo de uso, instruções ou nomes de produtos.

---

## Estrutura esperada

1. **Frase introdutória:** conecta o perfil do cabelo ao momento da finalização.  
2. **Frase sensorial:** descreve o benefício principal da etapa (proteção, alinhamento, definição, brilho, leveza).  
3. **Frase de fechamento opcional:** transmite sensação de cuidado completo e resultado visível.  

Exemplo de estrutura:  
> "Seu momento de finalização é o toque que transforma — protegendo, selando e realçando o brilho natural dos fios."  

---

## Resumo técnico para IA / Smart Copy
- Adaptar o texto conforme as respostas de (Question: tipo de cabelo), (Question: finalização), (Question: processos químicos) e (Question: dor principal).  
- Gerar texto de até **3 frases curtas**, com fluidez natural e tom sensorial.  
- Evitar redundância entre frases.  
- Focar em **benefício percebido** (o que o cabelo "ganha") e **sensação** (como o cabelo "se sente").  
- O texto deve funcionar como **transição direta para o Smart Product [3.a) bases finalizacao]**, introduzindo a escolha dos produtos.

---

### Referência técnica interna GE Beauty
- A finalização é a etapa que **blinda, protege e aperfeiçoa** o resultado do tratamento.  
- Os produtos dessa etapa (primers e leave-ins) unem **tecnologia de selagem, proteção térmica e efeito sensorial leve**.  
- Representa o momento de **autoexpressão e cuidado visível**, traduzindo a performance científica da GE Beauty em resultados perceptíveis ao toque e ao olhar.


# ═══════════════════════════════════════════════════════  
# CATEGORIA: FINALIZAÇÃO  
# PROMPT 2 DE 5: SMART PRODUCT – BASES DE FINALIZAÇÃO  
# ═══════════════════════════════════════════════════════  

# Smart product [3.a) bases finalizacao]

Com base nas respostas do quiz, **recomende os produtos ideais para a etapa de FINALIZAÇÃO**, considerando as respostas de:

- (Question: tipo de cabelo)  
- (Question: finalização)  
- (Question: processos químicos)  
- (Question: dor principal)

---

## Regras gerais
- A etapa de finalização é o **último passo do ritual GE Beauty**, responsável por **proteger, alinhar e realçar o resultado do tratamento**.  
- Os produtos disponíveis nesta etapa são:  
  - **Primer Liso Intacto**  
  - **Primer Cachos Definidos**  
  - **Leave-in com Proteção Térmica**  
  - **Leave-in Pluma**  
- Sempre recomendar **apenas um ou dois produtos**, conforme o tipo de cabelo e o modo de finalização.  
- Os **primers** são ideais para finalizações com calor ou modelagem; os **leave-ins** para cuidados diários, sem enxágue e com textura leve.  

---

## Lógicas de recomendação

### 1. Cabelos lisos
| Finalização | Produtos recomendados | Justificativa |
|--------------|----------------------|----------------|
| Com calor (escova, chapinha, secador) | Primer Liso Intacto + Leave-in com Proteção Térmica | O combo protege contra o calor e garante alinhamento e brilho espelhado, mantendo leveza e movimento natural. |
| Natural (sem calor) | Leave-in Pluma | Proporciona leveza e suavidade ao toque, mantendo o liso polido e sem frizz. |

---

### 2. Cabelos ondulados
| Finalização | Produtos recomendados | Justificativa |
|--------------|----------------------|----------------|
| Natural | Primer Cachos Definidos | Mantém ondas definidas e maleáveis, com brilho e controle de frizz. |
| Com difusor ou babyliss | Primer Cachos Definidos + Leave-in com Proteção Térmica | Protege do calor e reforça definição e movimento natural, sem pesar. |
| Alisamento com calor (escova, chapinha) | Primer Liso Intacto + Leave-in com Proteção Térmica | Garante selagem e alinhamento sem rigidez, preservando o toque sedoso. |

---

### 3. Cabelos cacheados
| Finalização | Produtos recomendados | Justificativa |
|--------------|----------------------|----------------|
| Natural | Primer Cachos Definidos | Define e hidrata os cachos, mantendo elasticidade e brilho natural. |
| Com difusor | Primer Cachos Definidos + Leave-in com Proteção Térmica | Potencializa a definição e protege do calor, mantendo o toque suave e controle de frizz. |

---

### 4. Cabelos crespos
| Finalização | Produtos recomendados | Justificativa |
|--------------|----------------------|----------------|
| Natural | Primer Cachos Definidos | Nutre profundamente e reforça a forma natural, com maciez e resistência. |
| Com difusor | Primer Cachos Definidos + Leave-in com Proteção Térmica | Reforça a definição e a proteção térmica, mantendo leveza e brilho natural. |

---

### 5. Processos químicos
| Tipo de cabelo | Produtos recomendados | Justificativa |
|----------------|----------------------|----------------|
| Lisos com química | Primer Liso Intacto + Leave-in com Proteção Térmica | Protege contra danos térmicos e reforça a selagem das cutículas, garantindo brilho e resistência. |
| Cacheados ou crespos com química | Primer Cachos Definidos + Leave-in Pluma | Combina proteção leve e hidratação equilibrada, mantendo definição e vitalidade. |
| Ondulados com química | Primer Cachos Definidos + Leave-in com Proteção Térmica | Garante brilho e maleabilidade, preservando o formato natural mesmo após a química. |

---

### 6. Dor principal
| Dor | Produtos recomendados | Justificativa |
|------|----------------------|----------------|
| Frizz (em lisos ou ondulados) | Primer Liso Intacto + Leave-in Pluma | Alinha e suaviza o fio, controlando o frizz com toque leve e brilho natural. |
| Frizz (em cacheados ou crespos) | Primer Cachos Definidos + Leave-in Pluma | Reduz o frizz sem pesar, mantendo definição e hidratação equilibrada. |
| Seco, opaco ou sem definição | Primer Cachos Definidos + Leave-in com Proteção Térmica | Devolve brilho, maciez e movimento com proteção e controle sensorial. |

---

### 7. Situações mistas
| Condição | Produtos recomendados | Justificativa |
|-----------|----------------------|----------------|
| Cabelos ondulados e descoloridos | Primer Cachos Definidos + Leave-in com Proteção Térmica | Recupera vitalidade e elasticidade, mantendo movimento leve e brilho natural. |
| Cabelos lisos com frizz e química | Primer Liso Intacto + Leave-in com Proteção Térmica | Controla o frizz e sela as cutículas, promovendo toque sedoso e brilho intenso. |
| Cabelos cacheados e quebradiços | Primer Cachos Definidos + Leave-in Pluma | Fortalece e define os cachos, mantendo a maciez e a flexibilidade. |

---

## Diretrizes gerais de configuração
- (Question: finalização) tem prioridade sobre (Question: tipo de cabelo).  
  Exemplo: cabelo ondulado que faz escova → **Primer Liso Intacto + Leave-in com Proteção Térmica**.  
- (Question: processos químicos) ajusta o tom e reforça a recomendação de **produtos com proteção térmica e selagem**.  
- (Question: dor principal) refina o foco do benefício sensorial (brilho, controle, leveza, definição).  
- Sempre indicar o primer como **último passo da rotina GE Beauty**, representando o acabamento perfeito e a proteção final.  
- A linguagem deve manter **coerência técnica e sensorial**, transmitindo cuidado, proteção e personalização.

---

## Resumo técnico para IA / Smart Copy
- Sempre incluir **ao menos um produto de finalização** (primer ou leave-in).  
- Quando houver uso de calor, incluir **Leave-in com Proteção Térmica**.  
- Adaptar combinações com base em tipo de cabelo, finalização e dor principal.  
- Usar tom técnico e acolhedor, com foco em **benefício percebido e resultado sensorial**.  
- Priorizar o vocabulário GE Beauty: *protege*, *alisa*, *define*, *sela*, *preserva o brilho*, *mantém leveza*, *realça movimento*.  

---

### Referência técnica interna GE Beauty
- **Primer Liso Intacto:** cria filme protetor que sela cutículas, reduz frizz e garante alinhamento duradouro, com efeito umbrella contra umidade, brilho intenso com realce da cor e reposição lipídica inteligente.
- **Primer Cachos Definidos:** mantém a curvatura natural por até 24h, hidrata, nutre com ômegas e protege os fios com efeito umbrella contra umidade e proteção térmica durante a aplicação.
- **Leave-in com Proteção Térmica:** leve e multifuncional, protege contra danos térmicos até 230 °C, mantém brilho, maciez e hidratação dos fios.
- **Leave-in Pluma:** textura ultraleve que reforça hidratação, disciplina o frizz e preserva o movimento natural dos fios.  
Todos são **veganos, biodegradáveis e compatíveis entre si**, completando o ritual sensorial de finalização GE Beauty.


# ═══════════════════════════════════════════════════════  
# CATEGORIA: FINALIZAÇÃO  
# PROMPT 3 DE 5: SMART PROPERTY – EXPLICAÇÃO DAS BASES DE FINALIZAÇÃO  
# ═══════════════════════════════════════════════════════  

# Smart property {{explicacao-bases-finalizacao}}

Esta Smart Property deve ser exibida **logo após a recomendação dos produtos** feita pelo Smart Product **[3.a) bases finalizacao]**.  
O objetivo é **explicar de forma sensorial, técnica e personalizada** como os produtos recomendados atuam na etapa de finalização — o toque final do ritual GE Beauty.  
A explicação deve dar continuidade natural à introdução e ao diagnóstico, conectando o tipo de cabelo, a forma de finalização e as principais necessidades do fio.

---

## Referências obrigatórias
A explicação deve considerar as respostas de:
- (Question: tipo de cabelo)  
- (Question: finalização)  
- (Question: processos químicos)  
- (Question: dor principal)

Os produtos recomendados são os resultados do bloco Smart Product abaixo:  
#### Smart Product Block ID: `d990f5975ab0ca73c140b8a6db99b5208432de25`

E o texto deve manter **continuidade direta** com o resultado retornado pelo Smart Product, com o mesmo tom técnico e sensorial característico da GE Beauty.

---

## Instruções de escrita

1. **Comece com uma frase curta introdutória**, conectando o perfil capilar ao momento da finalização (ex: "Na etapa final, seus fios ganham o acabamento ideal para o seu tipo de beleza.").  
2. Em seguida, **crie uma frase curta para cada produto recomendado** (máximo 7 palavras por produto).  
3. As frases devem fluir naturalmente, formando um único parágrafo coeso e sensorial.  
4. Adapte o texto conforme o tipo de cabelo, presença de química e modo de finalização (com ou sem calor).  
5. Evite instruções de uso — mantenha o foco em benefícios e sensações: brilho, alinhamento, leveza, proteção, definição, maciez.  
6. Utilize o **vocabulário GE Beauty** com variações elegantes e técnicas, evitando repetições.  

---

## Diretrizes de personalização

| Condição | Direcionamento de tom e benefício |
|-----------|-----------------------------------|
| **Tipo de cabelo = Liso** | Foco em alinhamento e brilho espelhado. Reforce toque sedoso e movimento natural. |
| **Tipo de cabelo = Ondulado** | Valorize definição leve e controle de frizz, sem rigidez. |
| **Tipo de cabelo = Cacheado** | Destaque definição, elasticidade e controle da umidade. |
| **Tipo de cabelo = Crespo** | Foque em nutrição, selagem e brilho intenso. |
| **Processos químicos = Sim** | Reforce proteção térmica, reconstrução e selagem. |
| **Finalização = com calor (secador, chapinha, difusor)** | Destaque escudo térmico, alinhamento e durabilidade do penteado. |
| **Finalização = natural (sem calor)** | Valorize leveza, fluidez e toque natural. |
| **Dor principal = Frizz** | Ressalte controle e alinhamento duradouro. |
| **Dor principal = Seco, opaco ou quebradiço** | Enfatize hidratação e brilho restaurado. |
| **Dor principal = Falta de definição** | Foque em elasticidade, curvatura e movimento natural. |

---

## Exemplos referenciais (não copiar literalmente)

- **Liso com calor (escova):**  
  "Na etapa final, o Primer Liso Intacto sela e protege, enquanto o Leave-in com Proteção Térmica garante brilho espelhado e movimento leve."  

- **Ondulado natural:**  
  "A finalização traz o toque perfeito: o Primer Cachos Definidos realça as ondas e o Leave-in Pluma mantém leveza e controle de frizz com suavidade."  

- **Cacheado com difusor:**  
  "O Primer Cachos Definidos ativa a curvatura e o Leave-in com Proteção Térmica preserva hidratação e brilho durante o uso de calor."  

- **Crespo com química:**  
  "Na finalização, o Primer Cachos Definidos nutre e protege a forma natural, enquanto o Leave-in Pluma garante toque macio e brilho intenso."  

---

## Vocabulário e tom de voz GE Beauty

**Palavras-chave recomendadas:**  
*protege*, *sela*, *mantém leveza*, *define*, *realça*, *preserva brilho*, *reduz frizz*, *reforça vitalidade*, *garante movimento*, *hidrata profundamente*, *deixa toque sedoso*  

**Tom:** técnico, sensorial e acolhedor — com fluidez natural e foco em resultado perceptível.  
**Ritmo:** frases curtas e harmônicas, com musicalidade leve e naturalidade emocional.  
**Estilo:** diagnóstico + benefício percebido + sensação final.  

---

## Estrutura esperada

1. **Frase introdutória:** conecta o momento da finalização ao perfil do cabelo.  
2. **Frase por produto recomendado:** descreve sensorialmente o benefício principal.  
3. **Conclusão opcional:** transmite sensação de resultado final (ex: "O toque perfeito para fios leves, protegidos e radiantes.").  

---

## Resumo técnico para IA / Smart Copy
- Conectar logicamente ao output do **Smart Product [3.a) bases finalizacao]**.  
- Adaptar o conteúdo às respostas de (Question: tipo de cabelo), (Question: finalização), (Question: processos químicos) e (Question: dor principal).  
- Incluir uma frase por produto recomendado (Primer Liso Intacto, Primer Cachos Definidos, Leave-in com Proteção Térmica, Leave-in Pluma).  
- Manter foco em benefícios sensoriais e técnicos: brilho, proteção, controle, definição, movimento.  
- Evitar instruções de uso, ênfase em experiência e resultado.  
- Garantir coerência com o tom de voz da marca GE Beauty — técnico, sensorial e sofisticado.  

---

### Referência técnica interna GE Beauty
- **Primer Liso Intacto:** cria película protetora que sela as cutículas, reduz o frizz, realça o brilho e a cor, e garante alinhamento duradouro com reposição lipídica e efeito umbrella contra umidade.
- **Primer Cachos Definidos:** ativa e define a curvatura natural por até 24h, mantendo os fios hidratados, flexíveis e protegidos da umidade.
- **Leave-in com Proteção Térmica:** protege contra danos térmicos até 230 °C, reduz danos e reforça o brilho natural.  
- **Leave-in Pluma:** textura leve e fluida que disciplina o frizz, hidrata e mantém o movimento natural dos fios.  
Todos os produtos são **veganos, biodegradáveis e compatíveis entre si**, representando o acabamento perfeito do ritual GE Beauty.


# ═══════════════════════════════════════════════════════  
# CATEGORIA: FINALIZAÇÃO  
# PROMPT 4 DE 5: SMART PRODUCT – BOOSTERS DE FINALIZAÇÃO  
# ═══════════════════════════════════════════════════════  

# Smart product [3.b) boosters finalizacao]

Com base nas respostas do quiz, **recomende os boosters ideais para potencializar a etapa de FINALIZAÇÃO**, considerando as respostas de:

- (Question: tipo de cabelo)  
- (Question: finalização)  
- (Question: processos químicos)  
- (Question: dor principal)

---

## Regras gerais
- Os **boosters de finalização** intensificam e personalizam o acabamento dos fios, potencializando brilho, controle, definição, nutrição ou proteção.  
- Sempre recomendar **um booster principal** e **até dois boosters complementares**, considerando o produto base indicado no Smart Product (Question: 3.a) bases finalizacao). 
- A decisão deve priorizar **(Question: dor principal)** e **(Question: processos químicos)**, ajustando conforme o **tipo de cabelo** e o **modo de finalização**.  
- O tom deve permanecer **técnico, sensorial e acolhedor**, reforçando o conceito de cuidado avançado e personalizado da GE Beauty.  

---

## Lógicas de recomendação

### 1. Dor principal: frizz
**Booster recomendado:** Booster Antifrizz  
**Justificativa:**  
Forma um escudo protetor que bloqueia o frizz e o arrepiado, mantendo alinhamento e brilho uniforme por mais tempo.  
Ideal para quem busca acabamento suave e polido, com efeito antiumidade.  

---

### 2. Dor principal: fios secos, ásperos ou opacos
**Booster recomendado:** Booster Hidratante  
**Justificativa:**  
Repõe água e lipídios essenciais, devolvendo maciez e luminosidade.  
Perfeito para cabelos sensibilizados, ressecados por calor ou química, deixando o toque sedoso e o visual saudável.  

---

### 3. Dor principal: falta de definição
**Booster recomendado:** Booster Definição  
**Justificativa:**  
Ativa e prolonga a curvatura natural de ondas e cachos, preservando a elasticidade e o movimento natural.  
Controla o frizz sem rigidez, mantendo forma e leveza ao longo do dia.  

---

### 4. Dor principal: desbotamento, opacidade ou exposição solar
**Booster recomendado:** Booster Antioxidante  
**Justificativa:**  
Cria uma barreira protetora contra o sol, poluição e calor, preservando a cor e o brilho.  
Evita o desbotamento e protege o cabelo de agressões ambientais, sendo ideal para fios coloridos ou expostos ao sol com frequência.  

---

### 5. Processos químicos
**Booster recomendado:**  
- (Question: processos químicos) = **coloração ou descoloração** → Booster Antioxidante  
- (Question: processos químicos) = **alisamento ou progressiva** → Booster Hidratante  

**Justificativa:**  
Cabelos com química exigem selagem e proteção:  
O Booster Antioxidante blinda a cor e previne o desbotamento, enquanto o Booster Hidratante recupera brilho e maciez pós-química.  

---

### 6. Tipo de cabelo

| Tipo de cabelo | Booster recomendado | Justificativa |
|----------------|---------------------|----------------|
| **Liso** | Booster Antifrizz | Mantém o acabamento polido, sela as cutículas e prolonga o efeito liso com brilho espelhado. |
| **Ondulado** | Booster Hidratante | Garante leveza e suavidade, realçando o movimento natural das ondas sem frizz. |
| **Cacheado** | Booster Definição | Intensifica a curvatura, controla o frizz e mantém cachos flexíveis e hidratados. |
| **Crespo** | Booster Definição | Reforça nutrição e definição, promovendo brilho intenso e controle de volume. |

---

### 7. Finalização

| Tipo de finalização | Booster recomendado | Justificativa |
|----------------------|---------------------|----------------|
| **Com calor (secador, chapinha, babyliss, difusor)** | Booster Antifrizz ou Booster Hidratante | O Antifrizz prolonga o alinhamento térmico e o Hidratante previne ressecamento e opacidade. |
| **Natural (sem calor)** | Booster Definição ou Booster Antioxidante | O Definição ativa a forma natural e o Antioxidante protege contra o sol, mantendo brilho e vitalidade. |
| **Exposição solar ou ambiente externo** | Booster Antioxidante | Protege contra raios UV e oxidação, ideal para uso diário em climas quentes ou atividades ao ar livre. |

---

### 8. Situações mistas

| Condição | Booster recomendado | Justificativa |
|-----------|---------------------|----------------|
| **Cabelos lisos e coloridos** | Booster Antioxidante | Evita desbotamento e mantém a cor vibrante por mais tempo, com brilho saudável e toque leve. |
| **Cabelos cacheados e descoloridos** | Booster Hidratante | Reidrata profundamente, preservando a definição e a elasticidade natural da fibra. |
| **Cabelos crespos com frizz e exposição solar** | Booster Antioxidante | Protege dos raios UV e controla o frizz, realçando o brilho natural da curvatura. |
| **Ondulados com escova frequente** | Booster Antifrizz | Mantém o alinhamento e a maciez mesmo após repetidas finalizações com calor. |
| **Cabelos finos e ressecados** | Booster Hidratante | Traz nutrição leve e toque sedoso, sem pesar o comprimento. |

---

## Diretrizes gerais de configuração

- **Prioridade das variáveis:**  
  1. (Question: dor principal)  
  2. (Question: processos químicos)  
  3. (Question: tipo de cabelo)  
  4. (Question: finalização)  

- **Regras de combinação:**  
  - O booster deve **complementar** o produto base (Primer ou Leave-in) indicado no bloco (Question: 3.a) bases finalizacao).  
  - **Nunca** recomendar boosters isoladamente.  
  - Quando o cabelo for colorido, descolorido ou exposto ao sol com frequência → **priorizar Booster Antioxidante**.  
  - Em casos de frizz intenso → **priorizar Booster Antifrizz**.  
  - Quando houver ressecamento, porosidade ou química → **priorizar Booster Hidratante**.  
  - Em cabelos com curvatura (ondulados, cacheados e crespos) → **priorizar Booster Definição**, exceto quando a dor principal for desbotamento ou frizz.  

---

## Resumo técnico para IA / Smart Copy

- Retornar **apenas um booster recomendado**, conforme a lógica acima.  
- O booster deve sempre se integrar ao produto base da etapa de finalização.  
- Adotar linguagem **sensorial, técnica e inspiradora**, com foco em brilho, controle, definição e proteção.  
- Destacar resultados visíveis: toque leve, brilho, proteção solar, alinhamento e movimento natural.  
- Evitar repetições de termos — variar entre *realça*, *mantém*, *protege*, *preserva*, *hidrata*, *controla*.  
- Manter coerência com o tom de voz GE Beauty: **científico, acolhedor e sofisticado**.  

---

### Referência técnica interna GE Beauty
- **Booster Antifrizz:** tecnologia antiumidade e selagem leve que alinha a fibra, reduz o arrepiado e garante controle duradouro.  
- **Booster Hidratante:** blend de ativos umectantes e vegetais que devolvem maciez, elasticidade e brilho natural, sem pesar.  
- **Booster Definição:** polímeros vegetais que reforçam a curvatura natural, mantêm a definição e o movimento por mais tempo.
- **Booster Antioxidante:** protege contra o sol, poluição e oxidação, prevenindo desbotamento e mantendo a cor vibrante.
Todos os boosters são **veganos, biodegradáveis e compatíveis com primers e leave-ins GE Beauty**, completando o acabamento final do ritual de beleza e proteção diária.


# ═══════════════════════════════════════════════════════  
# CATEGORIA: FINALIZAÇÃO  
# PROMPT 5 DE 5: SMART PROPERTY – EXPLICAÇÃO DOS BOOSTERS DE FINALIZAÇÃO  
# ═══════════════════════════════════════════════════════  

# Smart property {{explicacao-boosters-finalizacao}}

Esta Smart Property deve ser exibida **logo após a recomendação dos boosters** feita pelo Smart Product **[3.b) boosters finalizacao]**.  
O objetivo é **gerar uma explicação sensorial, técnica e personalizada** sobre como os boosters recomendados potencializam o resultado da finalização — o toque final do ritual GE Beauty.  
A explicação deve fluir naturalmente, complementando o texto da **explicacao-bases-finalizacao**, reforçando o papel de aperfeiçoamento e proteção do acabamento capilar.

---

## Referências obrigatórias
A explicação deve considerar as respostas de:
- (Question: tipo de cabelo)  
- (Question: finalização)  
- (Question: processos químicos)  
- (Question: dor principal)

Os boosters recomendados são os resultados do bloco Smart Product abaixo:  
#### Smart Product Block ID: `d44b22e4f35980e9acb874fbd16d4271d4670a27`

---

## Instruções de escrita

1. **Crie uma frase curta por booster recomendado**, com no máximo **8 palavras cada**.  
2. A primeira frase deve conectar-se de forma natural à finalização (ex: "Para potencializar seu acabamento," ou "Para proteger e realçar o resultado da sua finalização,").  
3. Cada frase deve descrever o **benefício principal e sensorial** do booster, sem citar modo de uso.  
4. Adapte o texto conforme o tipo de cabelo, o modo de finalização e a dor principal.  
5. Utilize o **vocabulário técnico e sensorial da GE Beauty**, mantendo harmonia e fluidez textual.  
6. Evite redundâncias e mantenha leveza e musicalidade no texto.  

---

## Diretrizes de personalização por booster

| Booster | Foco principal | Direcionamento de tom |
|----------|----------------|------------------------|
| **Antifrizz** | Controle, selagem e brilho polido | Ideal para lisos, ondulados e cabelos com calor. Transmitir leveza, suavidade e controle elegante. |
| **Hidratante** | Nutrição, brilho e toque sedoso | Foco em ressecamento, química e calor. Tom de maciez e vitalidade. |
| **Definição** | Curvatura, elasticidade e controle | Para cachos e crespos. Valorizar forma natural, movimento e memória de definição. |
| **Antioxidante** | Proteção solar, brilho e preservação da cor | Indicado para cabelos coloridos, descoloridos ou expostos ao sol. Enfatizar proteção, luminosidade e blindagem contra oxidação. |

---

## Diretrizes adicionais por condição

| Condição | Ajuste de linguagem |
|-----------|--------------------|
| **Finalização com calor** | Ressalte proteção térmica e durabilidade do acabamento. |
| **Finalização natural** | Valorize leveza e aparência naturalmente saudável. |
| **Processos químicos** | Enfatize recuperação, brilho e proteção da cor. |
| **Dor principal = frizz** | Destacar controle e selagem imediata. |
| **Dor principal = seco ou áspero** | Ressaltar nutrição e toque aveludado. |
| **Dor principal = desbotamento** | Valorizar proteção solar e preservação da cor. |

---

## Exemplos referenciais (não copiar literalmente)

- **Booster Antifrizz:**  
  "Para potencializar seu acabamento, o Booster Antifrizz alinha a fibra e bloqueia o frizz, mantendo brilho polido e leveza mesmo em dias úmidos."

- **Booster Hidratante:**  
  "Para intensificar a maciez, o Booster Hidratante repõe a hidratação e devolve o toque sedoso, deixando os fios radiantes e maleáveis por mais tempo."

- **Booster Definição:**  
  "Para realçar sua curvatura natural, o Booster Definição ativa o formato dos cachos e prolonga a definição, mantendo movimento e elasticidade."

- **Booster Antioxidante:**  
  "Para proteger seu acabamento, o Booster Antioxidante forma um escudo contra o sol e a poluição, preservando a cor e o brilho natural dos fios."

---

## Vocabulário e tom de voz GE Beauty

**Palavras-chave recomendadas:**  
*protege*, *preserva*, *mantém leveza*, *hidrata*, *define*, *realça*, *blinda*, *sela*, *revigora*, *reforça vitalidade*, *controla o frizz*, *devolve brilho*, *potencializa o resultado*, *preserva a cor*  

**Tom:** técnico, sensorial e elegante — sempre com foco em resultado visível e sensação ao toque.  
**Estilo:** frases curtas, harmônicas e positivas; linguagem fluida e conectada ao momento final do ritual.  
**Evite:** instruções de aplicação ou termos genéricos (ex.: "hidratação profunda" sem contexto).

---

## Estrutura esperada

1. **Frase introdutória (opcional):** conecta com o resultado da finalização ("Para potencializar seu acabamento,").  
2. **Frase por booster:** descreve o benefício técnico e sensorial (1 frase por booster).  
3. **Conclusão opcional:** transmite a sensação final desejada (ex.: "O toque perfeito de brilho, proteção e leveza que completa seu ritual.").  

---

## Resumo técnico para IA / Smart Copy

- Retornar **uma frase independente e coesa por booster recomendado**, conforme resultado do **Smart Product [3.b) boosters finalizacao]**.  
- O texto deve funcionar como **continuação natural da explicação das bases de finalização**.  
- Manter coerência com o tom de voz da GE Beauty — técnico, acolhedor e sofisticado.  
- Destacar benefícios sensoriais e perceptíveis: brilho, controle, proteção, definição, toque sedoso.  
- Evitar repetições de termos ou estrutura de frase entre boosters diferentes.  
- Focar na percepção do resultado e na experiência sensorial final dos fios.  

---

### Referência técnica interna GE Beauty
- **Booster Antifrizz:** com tecnologia antiumidade e selagem inteligente, mantém fios alinhados e com brilho espelhado por mais tempo.  
- **Booster Hidratante:** devolve água e nutrição com óleos vegetais leves, suavizando o toque e restaurando o brilho.  
- **Booster Definição:** polímeros vegetais que prolongam a memória de curvatura e o movimento dos fios.  
- **Booster Antioxidante:** protege contra oxidação, desbotamento e agressões solares, preservando a cor e o brilho natural.  
Todos os boosters são **veganos, biodegradáveis e compatíveis com primers e leave-ins GE Beauty**, completando o ritual de brilho, proteção e performance inteligente.

---
---
---

# ═══════════════════════════════════════════════════════  
# ABORDAGEM ALTERNATIVA: BOOSTERS CONSOLIDADOS
# ═══════════════════════════════════════════════════════  

**Nota:** Esta seção apresenta uma abordagem alternativa de recomendação de boosters - **um único Smart Product consolidado** que recomenda boosters para todas as etapas, ao invés de boosters separados por categoria (limpeza, tratamento, finalização).

Use esta abordagem quando preferir:
- Uma recomendação unificada de boosters
- Simplicidade na apresentação ao cliente
- Foco nas principais necessidades globais do cabelo

---

# ═══════════════════════════════════════════════════════  
# CATEGORIA: BOOSTERS  
# PROMPT 1 DE 2: SMART PRODUCT – BOOSTERS GERAIS (CONSOLIDADO)  
# ═══════════════════════════════════════════════════════  

# Smart product [4. boosters]

Com base nas respostas do quiz, **recomende os boosters ideais para potencializar o ritual completo de cuidados capilares**, considerando as respostas de:

- (Question: tipo de cabelo)  
- (Question: processos químicos)  
- (Question: dor principal)  
- (Question: finalização)  
- (Question: couro cabeludo)  

---

## Regras gerais

- Os **boosters GE Beauty** são fórmulas inteligentes que **potencializam resultados específicos** em qualquer etapa do ritual — limpeza, tratamento ou finalização.  
- Sempre recomendar **de 1 a 3 boosters**, com base nas combinações de tipo de cabelo, dor principal e presença de química.  
- O tom deve ser **técnico, acolhedor e sensorial**, transmitindo personalização e sofisticação.  
- Cada booster deve vir acompanhado de uma **justificativa curta e clara**, enfatizando o efeito percebido (brilho, controle, proteção, nutrição, definição etc.).  

---

## Lógicas de recomendação

### 1. Dor principal

| Dor principal | Booster recomendado | Justificativa |
|----------------|---------------------|----------------|
| **Frizz** | Booster Antifrizz | Forma uma camada protetora que controla o arrepiado e mantém o alinhamento dos fios por mais tempo, sem pesar. |
| **Ressecamento, aspereza ou opacidade** | Booster Hidratante | Repõe água e lipídios essenciais, devolvendo brilho, maciez e toque sedoso. |
| **Falta de definição (ondas, cachos ou crespos)** | Booster Definição | Ativa e prolonga a curvatura natural dos fios, preservando movimento e elasticidade. |
| **Quebra ou fragilidade** | Booster Fortificante | Fortalece a estrutura interna da fibra, aumentando resistência e vitalidade desde a raiz até as pontas. |
| **Desbotamento, exposição solar ou opacidade da cor** | Booster Antioxidante | Protege contra oxidação, sol e poluição, preservando a cor e o brilho natural dos fios. |
| **Couro cabeludo oleoso ou com desconforto** | Booster Purificante | Equilibra a oleosidade e purifica o couro cabeludo sem ressecar, prolongando a sensação de limpeza. |

---

### 2. Processos químicos

| Processo | Booster recomendado | Justificativa |
|-----------|---------------------|----------------|
| **Coloração ou descoloração** | Booster Antioxidante + Booster Hidratante | Protege a cor, previne o desbotamento e devolve a hidratação essencial. |
| **Alisamento ou progressiva** | Booster Hidratante + Booster Antifrizz | Garante selagem, controle e brilho espelhado, mantendo a leveza do liso. |
| **Química intensa ou sobreposição de processos** | Booster Fortificante + Booster Antioxidante | Reforça a estrutura interna e protege contra danos externos. |

---

### 3. Tipo de cabelo

| Tipo de cabelo | Booster recomendado | Justificativa |
|----------------|---------------------|----------------|
| **Liso** | Booster Antifrizz | Controla o frizz e mantém o acabamento polido, ideal para uso diário e finalizações com calor. |
| **Ondulado** | Booster Hidratante | Preserva leveza e movimento natural, mantendo ondas flexíveis e luminosas. |
| **Cacheado** | Booster Definição + Booster Hidratante | Realça e mantém a forma dos cachos com maciez e hidratação prolongada. |
| **Crespo** | Booster Definição + Booster Fortificante | Reforça a nutrição e a elasticidade, mantendo fios resistentes e definidos. |

---

### 4. Couro cabeludo e finalização

| Condição | Booster recomendado | Justificativa |
|-----------|---------------------|----------------|
| **Couro cabeludo oleoso ou sensibilizado** | Booster Purificante | Regula a oleosidade e acalma a pele, equilibrando o couro cabeludo. |
| **Finalização com calor (escova, chapinha, difusor)** | Booster Antifrizz ou Booster Hidratante | O Antifrizz protege da umidade e o Hidratante previne ressecamento e perda de brilho. |
| **Finalização natural (sem calor)** | Booster Definição ou Booster Antioxidante | O Definição realça a forma natural e o Antioxidante protege da exposição solar e poluição. |

---

### 5. Situações mistas

| Condição | Booster recomendado | Justificativa |
|-----------|---------------------|----------------|
| **Cabelos cacheados e descoloridos** | Booster Hidratante + Booster Definição | Reforça nutrição e brilho, preservando definição e elasticidade. |
| **Cabelos lisos e coloridos** | Booster Antioxidante + Booster Antifrizz | Protege a cor e o brilho, mantendo o liso alinhado e suave. |
| **Cabelos crespos e com química** | Booster Fortificante + Booster Definição | Fortalece e reativa a curvatura, com nutrição intensa e controle de volume. |
| **Cabelos com couro oleoso e pontas secas** | Booster Purificante + Booster Hidratante | Equilibra a limpeza e devolve maciez, mantendo conforto e leveza. |

---

## Diretrizes gerais de configuração

- Sempre recomendar **de 1 a 3 boosters** (1 principal + até 2 complementares).  
- (Question: dor principal) tem **prioridade máxima**;  
  (Question: processos químicos) e (Question: tipo de cabelo) refinam a recomendação.  
- (Question: finalização) ajusta o tom e reforça o booster com proteção térmica ou solar.  
- O texto deve **focar no benefício técnico e sensorial**, evitando menções a modo de uso.  
- Evitar repetições — variar os verbos (*protege, repara, hidrata, controla, ilumina, preserva*).  
- Tom sempre **técnico, confiante e acolhedor**, refletindo o posicionamento premium da GE Beauty.  

---

### Referência técnica interna GE Beauty

- **Booster Antifrizz:** tecnologia antiumidade que reduz o arrepiado e mantém o alinhamento por até 48h.  
- **Booster Hidratante:** nutre e devolve maciez imediata, com brilho leve e duradouro.  
- **Booster Definição:** ativa e mantém a curvatura natural, garantindo elasticidade e forma.  
- **Booster Fortificante:** reconstrói a fibra, aumentando resistência e reduzindo quebra.  
- **Booster Antioxidante:** protege contra sol, poluição e desbotamento, preservando a cor e o brilho.  
- **Booster Purificante:** regula oleosidade, acalma o couro cabeludo e prolonga a sensação de frescor.  

Todos são **veganos, biodegradáveis e compatíveis entre si**, permitindo personalização inteligente conforme as necessidades de cada cabelo.


# ═══════════════════════════════════════════════════════  
# CATEGORIA: BOOSTERS  
# PROMPT 2 DE 2: SMART PROPERTY – EXPLICAÇÃO DOS BOOSTERS GERAIS  
# ═══════════════════════════════════════════════════════  

# Smart property {{explicacao-boosters}}

Crie um texto curto, sensorial e técnico que explique de forma integrada o papel dos boosters recomendados pelo Smart Product [4.boosters].  
O objetivo é apresentar os boosters como a camada final de personalização do ritual GE Beauty — fórmulas inteligentes que se adaptam às necessidades específicas de cada cabelo.

---

## Referências obrigatórias

O texto deve considerar as respostas de:
- (Question: tipo de cabelo)  
- (Question: processos químicos)  
- (Question: dor principal)
- (Question: finalização)  
- (Question: couro cabeludo)  

E deve se basear **nos boosters retornados pelo Smart Product [4.boosters]**.

---

## Estrutura esperada

1. **Frase introdutória (1 linha):** contextualiza os boosters como o toque final ou a personalização do ritual.  
2. **Frase por booster (1 linha cada):** descreve brevemente o benefício técnico e sensorial de cada um, com foco no resultado percebido.  
3. **Conclusão opcional:** conecta o uso dos boosters ao resultado global do cabelo (brilho, controle, vitalidade, leveza, etc.).

---

### Exemplo de estrutura (modelo narrativo)

> Para potencializar seu ritual GE Beauty, os boosters atuam de forma personalizada sobre as principais necessidades do seu cabelo.  
> O **Booster Hidratante** devolve maciez e brilho, mantendo o toque leve e sedoso.  
> O **Booster Antioxidante** protege da oxidação e preserva a cor vibrante dos fios.  
> O **Booster Antifrizz** sela e controla o arrepiado, garantindo acabamento suave e polido.  
> Juntos, criam uma rotina inteligente que preserva equilíbrio, vitalidade e beleza natural.

---

## Diretrizes de escrita

- **Tom:** técnico, sensorial e sofisticado — em linha com o estilo GE Beauty.  
- **Extensão total:** até 100 palavras (máx. 5 frases curtas).  
- **Evite modo de uso ou ordem de aplicação.**  
- **Foque em benefícios percebidos:** brilho, leveza, força, controle, movimento, proteção.  
- Adapte conforme o tipo de cabelo e a dor principal:  
  - *Lisos e ondulados:* leveza, alinhamento, brilho.  
  - *Cacheados e crespos:* definição, nutrição, controle.  
  - *Com química:* reconstrução, força, proteção da cor.  
  - *Com frizz:* suavidade e selagem.  
  - *Com couro oleoso:* purificação e equilíbrio.  
- A narrativa deve soar natural e consultiva, nunca técnica demais.  

---

## Vocabulário sugerido

*potencializa*, *equilibra*, *revitaliza*, *protege*, *sela*, *mantém leveza*, *controla o frizz*, *realça a curvatura*, *preserva o brilho*, *fortalece*, *purifica*, *hidrata*, *blinda contra o calor e o sol*, *realça o toque sedoso*.

---

## Exemplos referenciais

### Exemplo 1 – cabelo liso com química e frizz
> Para completar o seu ritual, os boosters agem de forma direcionada para equilibrar, proteger e realçar os fios.  
> O **Booster Antifrizz** controla o arrepiado e prolonga o efeito liso, mantendo o brilho espelhado.  
> O **Booster Hidratante** repõe a umidade e restaura a maciez após a química.  
> O **Booster Antioxidante** preserva a cor e protege do calor e da poluição.  
> O resultado é um cabelo visivelmente mais alinhado, leve e radiante.

---

### Exemplo 2 – cabelo cacheado e descolorido
> Os boosters complementam seu ritual, nutrindo e definindo os fios na medida certa.  
> O **Booster Hidratante** devolve água e brilho, suavizando o toque.  
> O **Booster Definição** reforça a curvatura natural e mantém o movimento leve.  
> O **Booster Antioxidante** protege da oxidação e do sol, preservando a vitalidade da cor.  
> Um tratamento completo que mantém seus cachos nutridos, definidos e cheios de vida.

---

### Exemplo 3 – couro cabeludo oleoso e pontas secas
> Seus boosters equilibram o couro e reparam as pontas para restaurar o conforto e a leveza dos fios.  
> O **Booster Purificante** regula a oleosidade e prolonga a sensação de limpeza.  
> O **Booster Hidratante** devolve maciez e brilho, nutrindo o comprimento sem pesar.  
> Um cuidado inteligente que harmoniza o couro e o toque, mantendo frescor e vitalidade ao longo do dia.

---

## Resumo técnico para IA / Smart Copy

- Gerar de **2 a 4 frases**, sempre iniciando com uma introdução breve e fluida.  
- Cada booster recomendado deve ser mencionado com nome e benefício principal.  
- O texto deve soar como explicação natural e personalizada, não como lista técnica.  
- Evitar repetições; usar sinônimos para *hidrata, protege, nutre, realça, controla*.  
- Encerrar com uma frase que reforce o resultado global do ritual.  

**Formato esperado:**
```
Frase 1: introdução contextual
Frases 2–4: boosters e benefícios
Frase final: resultado percebido
```

---

### Referência técnica interna GE Beauty

- **Booster Antifrizz:** tecnologia antiumidade que reduz o arrepiado e mantém o alinhamento por até 48h.  
- **Booster Hidratante:** nutre e devolve maciez imediata, com brilho leve e duradouro.  
- **Booster Definição:** ativa e mantém a curvatura natural, garantindo elasticidade e forma.  
- **Booster Fortificante:** reconstrói a fibra, aumentando resistência e reduzindo quebra.  
- **Booster Antioxidante:** protege contra sol, poluição e desbotamento, preservando a cor e o brilho.  
- **Booster Purificante:** regula oleosidade, acalma o couro cabeludo e prolonga a sensação de frescor.  

Todos são **veganos, biodegradáveis e compatíveis entre si**, permitindo um tratamento modular, inteligente e feito sob medida.

---

## Fallback text

Os boosters GE Beauty são o toque final do seu ritual: fórmulas inteligentes que potencializam cada etapa do cuidado.  
Eles equilibram, nutrem e protegem, atuando de forma precisa nas principais necessidades do cabelo — do couro ao comprimento.  
Com ação combinada de hidratação, controle e brilho, transformam o tratamento diário em um cuidado completo, leve e visivelmente eficaz.  
Um sistema inteligente que entende o seu cabelo e eleva o resultado de cada produto.

---
---
---

# INSTRUÇÕES PARA CRIAR NOVAS CATEGORIAS

## Como usar estes prompts como base

Este documento contém:

**SMART PROPERTIES GLOBAIS (3):**
- `{{diagnostico-capilar}}` - Raio-X Capilar (tags visuais no topo) ✅
- `{{intro-geral}}` - Introdução Geral do Ritual ✅
- `{{ritual-resumido}}` - Resumo Completo do Ritual em 4 blocos ✅

**CATEGORIAS COM PROMPTS DETALHADOS POR ETAPA (3):**
- **LIMPEZA** (5 prompts completos - categoria completa) ✅
- **TRATAMENTO** (5 prompts completos - categoria completa) ✅
- **FINALIZAÇÃO** (5 prompts completos - categoria completa) ✅

**ABORDAGEM ALTERNATIVA - BOOSTERS CONSOLIDADOS (2 prompts):**
- Smart Product: Boosters Gerais `[4. boosters]` ✅
- Smart Property: Explicação dos Boosters `{{explicacao-boosters}}` ✅

**Total: 21 prompts de produção**

Ao criar uma nova categoria ou completar categorias existentes, siga este processo:

### 1. Identifique a categoria
- Qual a etapa do cabelo você está trabalhando? (Limpeza, Hidratação, Tratamento, Finalização, etc.)
- Quais produtos desta categoria existem no catálogo GE Beauty?
- Quais perguntas do quiz são relevantes para esta categoria?

### 2. Crie os 5 prompts na mesma ordem

**PROMPT 1 - Smart Property: Introdução**
- Cria um resumo personalizado do perfil para AQUELA categoria específica
- Usa as mesmas perguntas do quiz (couro cabeludo, processos químicos, etc.) mas com foco no contexto da categoria
- Exemplo: para Hidratação, falar sobre nível de ressecamento, porosidade, etc.

**PROMPT 2 - Smart Product: Produtos Base**
- Lista os produtos principais daquela categoria
- Cria tabelas de recomendação baseadas nas condições do cabelo
- Sempre inclui justificativa técnica e acolhedora
- Segue a mesma estrutura de "Regras gerais" + "Lógicas de recomendação"

**PROMPT 3 - Smart Property: Explicação das Bases**
- Conecta a introdução (Prompt 1) com os produtos recomendados (Prompt 2)
- Explica POR QUE aqueles produtos foram escolhidos
- Mantém o tom GE Beauty (acolhedor, técnico, sensorial)
- Referencia o Block ID do Smart Product anterior

**PROMPT 4 - Smart Product: Boosters/Complementares**
- Produtos adicionais opcionais daquela categoria
- Usa lógica de priorização (1, 2, 3 condicional)
- Considera a "dor principal" do usuário para priorizar
- Máximo de 1-2 produtos recomendados

**PROMPT 5 - Smart Property: Explicação dos Boosters**
- Gera uma frase curta por booster recomendado
- Explica como cada booster potencializa a etapa da categoria
- Usa aberturas específicas ("Para potencializar...", "Para complementar...")
- Adapta o tom conforme características do perfil (oleoso, seco, sensível, etc.)
- Foco no benefício sensorial e perceptível

### 3. Mantenha a coerência com outras categorias

**IMPORTANTE:** Todas as categorias fazem parte do mesmo quiz. O usuário verá os resultados de todas juntas. Por isso:

- Use as mesmas perguntas do quiz em todas as categorias
- Mantenha o mesmo tom de voz
- As categorias devem se complementar, não contradizer
- Se a categoria Limpeza fala sobre "couro oleoso", a Hidratação deve respeitar isso também

### 4. Estrutura de nomenclatura

Siga o padrão:
- **Smart Property:** `{{nome-categoria}}`
- **Smart Product:** `[número.letra) tipo categoria]`

Exemplos completos:
- **Limpeza:** 
  - `{{intro-limpeza}}` 
  - `[1.a) bases limpeza]` 
  - `{{explicacao-bases-limpeza}}`
  - `[1.b) boosters limpeza]`
  - `{{explicacao-boosters-limpeza}}`
  
- **Tratamento:** 
  - `{{intro-tratamento}}`
  - `[2.a) bases tratamento]`
  - `{{explicacao-bases-tratamento}}`
  - `[2.b) boosters tratamento]`
  - `{{explicacao-boosters-tratamento}}`
  
- **Finalização:** 
  - `{{intro-finalizacao}}`
  - `[3.a) bases finalizacao]`
  - `{{explicacao-bases-finalizacao}}`
  - `[3.b) boosters finalizacao]`
  - `{{explicacao-boosters-finalizacao}}`

### 5. Checklist antes de finalizar novos prompts

- [ ] Segui a estrutura dos 5 prompts (Intro → Base → Explicação Bases → Boosters → Explicação Boosters)?
- [ ] Usei as perguntas corretas do quiz com a notação `(Question: nome)`?
- [ ] Criei tabelas de recomendação para os Smart Products?
- [ ] Inclui justificativas técnicas em todas as recomendações?
- [ ] Mantive o tom de voz GE Beauty (acolhedor, técnico, sensorial)?
- [ ] Os prompts complementam (não contradizem) as outras categorias?
- [ ] Usei a nomenclatura correta para variáveis e Block IDs?
- [ ] Adicionei avisos de "não copiar literalmente" nos exemplos?




