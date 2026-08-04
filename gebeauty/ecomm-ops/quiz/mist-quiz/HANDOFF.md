# Handoff — montar o quiz "Qual Body & Hair Mist é a sua?" no Octane

**Para:** quem vai finalizar o setup no Octane
**De:** time GE Beauty
**O que é:** um novo quiz que recomenda 1 das 4 brumas (Melon Mood, Santal Skin, Rose Ritual, Pear Fresh) com base na personalidade da pessoa, mais uma sugestão de layering. Mesmo motor do quiz capilar atual (AI Quiz / CORE-1).

**Método:** você vai **duplicar o quiz capilar que já está no ar** e trocar o conteúdo. Assim a gente reaproveita todo o layout, fontes, cores, CSS e tela de carregamento que já estão prontos, sem montar nada do zero.

> **O que já foi feito (não precisa mexer):** a base de conhecimento das 4 brumas já foi
> publicada no Shopify (metaobjetos `custom.ai_readiness`, ativos e ligados aos produtos). O
> conteúdo já foi conferido contra as descrições oficiais das PDPs. Você só monta o quiz no Octane.

Tudo o que você precisa colar está **neste documento**, nos blocos marcados como `COLE ISTO`. Cada bloco também existe como **arquivo separado** dentro desta pasta (na subpasta `octane-paste/`) — se preferir, abra o arquivo e copie de lá, evita qualquer erro de formatação ao copiar do meio do texto.

---

## O que tem nesta pasta
| Arquivo | Para que serve |
|---|---|
| **`HANDOFF.md`** | **Este guia. Comece por aqui e siga na ordem.** |
| `octane-paste/questions.md` | As 6 perguntas + opções (fonte para a Parte 3) |
| `octane-paste/smart-property_bruma-resultado.txt` | Texto do resultado, para colar no campo Instruction (Parte 4) |
| `octane-paste/smart-products_bruma.txt` | Instrução de recomendação do produto (Parte 5) |
| `octane-paste/results-copy.md` | Textos fixos da página de resultado (Parte 5) |
| `mapping.md` | Tabela de referência: qual resposta leva a qual bruma (o "porquê") |
| `BUILD-GUIDE.md`, `ai-readiness-mists.json` | Material técnico, **já aplicado no Shopify pela equipe. Você não precisa abrir.** |

---

## Antes de começar
- Acesse o Octane AI: **app.octaneai.com**, conta **GE Beauty** (`abyasnknwj7yxqbu`).
- O quiz que vamos duplicar é **o quiz capilar que está ATIVO hoje** (o que aparece publicado / com mais respostas). ID de referência: `i8z8npJNxmAkzfHw`.
- Reserve ~40 min. Não publique até passar pelo QA (Parte 6).

---

## Parte 1 — Duplicar o quiz atual
1. No dashboard do Octane, vá em **Quizzes**.
2. No quiz capilar ativo, clique nos **três pontinhos (…) → Duplicate**.
3. O Octane cria uma cópia com todo o layout e design. É nela que você trabalha daqui pra frente. **Não edite o quiz original.**

## Parte 2 — Renomear
1. Abra a cópia → **Settings** (ou o nome no topo do editor).
2. Renomeie para: **`mist_[AAMMDD]_qual-bruma`** (ex.: `mist_260716_qual-bruma`).

---

## Parte 3 — Trocar as perguntas
O quiz capilar tem **7 perguntas**. O quiz de bruma tem **6**. Você vai **editar as 6 primeiras** e **apagar a 7ª**.

Para cada pergunta: abra a página no **Build**, troque o título e as opções pelos textos abaixo, e mantenha a **ordem exata das opções** (isso é o que faz a recomendação funcionar). Se a página tiver um campo de "variável" / "variable ref", ajuste conforme indicado.

> **Regra de ouro:** em todas as perguntas, a **opção 1 = Melon, opção 2 = Santal, opção 3 = Rose, opção 4 = Pear**. Nunca troque a ordem.
>
> Arquivo com as 6 perguntas: **`octane-paste/questions.md`**.

### Pergunta 1 — Estação  (variável: `estacao`)
`COLE ISTO`
- **Título:** Escolha uma estação para viver o ano inteiro
- Verão
- Outono
- Inverno
- Primavera

### Pergunta 2 — Momento do dia  (variável: `momento`)
`COLE ISTO`
- **Título:** Qual é o seu momento favorito do dia?
- Um almoço ao ar livre
- Um jantar especial
- Um brunch de domingo
- Um café da manhã sem pressa

### Pergunta 3 — Destino  (variável: `destino`)
`COLE ISTO`
- **Título:** O destino dos seus sonhos agora é...
- Grécia
- Nova Iorque
- Paris
- Indonésia

### Pergunta 4 — Situação  (variável: `situacao`)
`COLE ISTO`
- **Título:** Onde te encontram no fim de semana?
- Na praia ou numa festa com os amigos
- Em drinks, um museu ou um evento de networking
- Entre arte, décor e uma viagem
- Num aniversário ou picnic ao ar livre

### Pergunta 5 — Personalidade  (variável: `palavra`)
`COLE ISTO`
- **Título:** A palavra que mais combina com você é...
- Viva e curiosa
- Marcante e poderosa
- Delicada e inspiradora
- Vibrante e ousada

### Pergunta 6 — Aroma  (variável: `aroma`)
`COLE ISTO`
- **Título:** O aroma que te conquista de primeira?
- Frutado e fresco, tipo melão suculento
- Amadeirado e quente, tipo sândalo
- Floral, tipo um buquê de rosas
- Verde e leve, tipo pêra com lírio

### Pergunta 7 do quiz capilar → **APAGAR**
Delete a 7ª página de pergunta que veio na cópia.

> As páginas de **opt-in (e-mail/telefone)** e a **tela de carregamento** ("calculando...") que vieram na cópia podem ficar como estão. Se quiser, troque o texto da tela de carregamento para: *"misturando as notas perfeitas para você..."*

---

## Parte 4 — Trocar o texto do resultado (Smart Property)
A cópia tem uma Smart Property chamada **DIAGNOSTICO-CAPILAR**. Vamos reaproveitá-la.

1. Vá em **Smart Properties**, abra essa Smart Property.
2. (Opcional) renomeie para **BRUMA-RESULTADO**.
3. Apague o texto do campo **Instruction** e **cole no lugar** o bloco abaixo.
4. No campo **Fallback**, cole a última linha do bloco (a que começa com "Sua Body & Hair Mist é a Melon Mood").

`COLE ISTO` (campo Instruction) — mesmo conteúdo do arquivo **`octane-paste/smart-property_bruma-resultado.txt`**:
```
Você recomenda UMA Body & Hair Mist GE Beauty (entre Melon Mood, Santal Skin, Rose Ritual e Pear Fresh) com base nas respostas de personalidade do quiz. Gere um texto curto, caloroso e aspiracional que revela a bruma escolhida e explica por que ela combina com a pessoa.

## Como escolher a bruma
Cada resposta é um voto. Some os votos e escolha a bruma mais votada, usando o mapa abaixo:

- (Question: estacao): Verão→Melon Mood · Outono→Santal Skin · Inverno→Rose Ritual · Primavera→Pear Fresh
- (Question: momento): almoço→Melon Mood · jantar→Santal Skin · brunch→Rose Ritual · café da manhã→Pear Fresh
- (Question: destino): Grécia→Melon Mood · Nova Iorque→Santal Skin · Paris→Rose Ritual · Indonésia→Pear Fresh
- (Question: situacao): praia/festa→Melon Mood · drinks/museu→Santal Skin · arte/décor→Rose Ritual · aniversário/picnic→Pear Fresh
- (Question: palavra): viva e curiosa→Melon Mood · marcante e poderosa→Santal Skin · delicada e inspiradora→Rose Ritual · vibrante e ousada→Pear Fresh
- (Question: aroma): melão→Melon Mood · sândalo→Santal Skin · rosas→Rose Ritual · pêra→Pear Fresh

Em caso de empate, prefira nesta ordem: (1) a resposta de aroma, (2) a resposta de palavra, (3) a resposta de estação.

## Perfil de cada bruma (use para escrever o texto)
- Melon Mood — melão, peônia e white musk. Cativante e extrovertida; sensação de presença e conforto.
- Santal Skin — sândalo, patchouli e cardamomo. Marcante e sofisticada; sensação de poder e magnetismo.
- Rose Ritual — rosas, lichia e frutas vermelhas. Feminina e delicada; sensação de leveza e plenitude.
- Pear Fresh — pêra, lírio e musk. Vibrante e autêntica; sensação de energia e autenticidade.

## Benefício de cabelo e corpo (IGUAL para as quatro brumas — claim oficial da loja)
Perfuma o corpo e o cabelo, realça o brilho dos fios sem pesar e deixa a pele hidratada e macia.
NÃO atribua benefícios capilares diferentes por fragrância (nada de "reconstrução", "detox", "scalp", "styling"): a diferença entre as brumas é só o perfume/personalidade, o cuidado é o mesmo.

## Estrutura do texto (2 a 3 frases)
1. Abrir revelando a bruma: "Sua Body & Hair Mist é a [Nome]."
2. Conectar as respostas ao perfil: uma frase que amarra a personalidade da pessoa às hero words e à sensação da bruma.
3. Fechar com a promessa dupla perfume + cabelo usando o benefício oficial acima.

## Regras de escrita
- Tom: caloroso, aspiracional, direto ao ponto. Fale com "você".
- Sem travessão. Sem hashtags. Sem emojis.
- Nunca invente notas, ingredientes ou benefícios fora da lista acima.
- 45 a 70 palavras.

## Fallback (cole também no campo Fallback)
Sua Body & Hair Mist é a Melon Mood, a assinatura da casa: melão, peônia e white musk para uma sensação de presença e conforto, que perfuma o corpo e o cabelo, realça o brilho sem pesar e deixa a pele hidratada e macia.
```

---

## Parte 5 — Arrumar a página de resultado
Na cópia, a página de resultado tem VÁRIOS blocos do quiz capilar (limpeza, tratamento, finalização, boosters, kits...). O quiz de bruma é mais enxuto. Faça assim:

### 5.1 — Apagar o que não serve
Delete os grupos de **Smart Products** do capilar: **1. limpeza, 2. tratamento, 3. finalização, 4. boosters**. Delete também os blocos de **kits/rotina completa** que falem de rotina capilar.

### 5.2 — Manter e ajustar
- **Título / bloco que mostra o resultado:** mantenha o bloco HTML que renderiza a Smart Property. Ele já mostra o texto que você configurou na Parte 4.
- **Um bloco de Smart Products** (reaproveite um dos que sobraram, ou crie um novo): no campo **Instructions for AI**, cole o bloco abaixo. Se der, limite os produtos desse bloco à coleção/tag das brumas.

`COLE ISTO` (Smart Products → Instructions for AI) — mesmo conteúdo do arquivo **`octane-paste/smart-products_bruma.txt`**:
```
Recomende EXATAMENTE UMA Body & Hair Mist GE Beauty como resultado do quiz, escolhendo entre: Melon Mood, Santal Skin, Rose Ritual e Pear Fresh. Recomende também UMA segunda bruma como sugestão de layering.

## Como escolher a bruma principal
Some os votos das respostas usando o mapa:
- &estacao: Verão→Melon Mood · Outono→Santal Skin · Inverno→Rose Ritual · Primavera→Pear Fresh
- &momento: almoço→Melon Mood · jantar→Santal Skin · brunch→Rose Ritual · café da manhã→Pear Fresh
- &destino: Grécia→Melon Mood · Nova Iorque→Santal Skin · Paris→Rose Ritual · Indonésia→Pear Fresh
- &situacao: praia/festa→Melon Mood · drinks/museu→Santal Skin · arte/décor→Rose Ritual · aniversário/picnic→Pear Fresh
- &palavra: viva e curiosa→Melon Mood · marcante e poderosa→Santal Skin · delicada e inspiradora→Rose Ritual · vibrante e ousada→Pear Fresh
- &aroma: melão→Melon Mood · sândalo→Santal Skin · rosas→Rose Ritual · pêra→Pear Fresh

Bruma mais votada vence. Empate: prefira &aroma, depois &palavra, depois &estacao.

## Layering (segunda bruma)
Sugira UMA parceira, sempre a partir dos pares oficiais:
- Melon Mood → Pear Fresh ou Santal Skin
- Santal Skin → Pear Fresh ou Melon Mood
- Rose Ritual → Santal Skin ou Melon Mood
- Pear Fresh → Melon Mood ou Rose Ritual

## Regras
- Recomende apenas produtos cujo título contém "Body & Hair Mist" (as 4 brumas). Nunca recomende outro produto da linha capilar.
- A bruma principal aparece primeiro; a parceira de layering em segundo.
- Não recomende a versão travel size nem o mini como resultado principal.
- Baseie a descrição no conteúdo de AI Readiness de cada bruma (perfil olfativo e sensação). O benefício de cabelo e corpo é o mesmo para todas (perfuma, realça o brilho sem pesar, pele hidratada e macia). Não invente notas nem benefícios diferentes por fragrância.
```

### 5.3 — Textos fixos (blocos de Texto/Botão)
Ajuste os textos fixos que sobraram na página (também em **`octane-paste/results-copy.md`**):
- Título da página: **Descobrimos a sua Body & Hair Mist**
- Cabeçalho antes do produto: **sua fragrância, do corpo aos fios**
- Cabeçalho de layering: **combine e crie a sua assinatura**
- Subtítulo de layering: **duas brumas, um perfume só seu. use a sua favorita e a parceira que sugerimos para uma camada de aroma exclusiva.**
- Cabeçalho do botão: **leve a sua agora**
- Botão (Add to Cart): **adicionar minha bruma**

---

## Parte 6 — QA antes de publicar (obrigatório)
Use o **Preview** do Octane. Responda escolhendo **sempre a mesma coluna** nas 6 perguntas e confira o resultado:

| Responder tudo na coluna | Tem que recomendar |
|---|---|
| 1 (verão / almoço / Grécia / praia / viva / melão) | **Melon Mood** |
| 2 (outono / jantar / Nova Iorque / drinks / marcante / sândalo) | **Santal Skin** |
| 3 (inverno / brunch / Paris / arte / delicada / rosas) | **Rose Ritual** |
| 4 (primavera / café / Indonésia / picnic / vibrante / pêra) | **Pear Fresh** |

Depois faça 2 ou 3 testes com respostas misturadas e confira:
- o desempate faz sentido (aroma > palavra > estação);
- a segunda bruma (layering) é sempre uma das parcerias oficiais;
- **nunca** aparece um produto que não seja bruma;
- o texto não promete benefício capilar diferente por fragrância.

---

## Parte 7 — Publicar
1. Se o QA passou, **publique** a cópia no Octane.
2. **Avise o Lucas** antes de colocar no site: a decisão de onde o quiz vai aparecer (botão no menu, página, ou substituir algo) é dele, e o encaixe no tema é feito pela equipe técnica. Não altere o quiz capilar que já está no ar.

---

## Anexo — de onde vem cada resposta (gabarito)
| Pergunta | Opção 1 → Melon | Opção 2 → Santal | Opção 3 → Rose | Opção 4 → Pear |
|---|---|---|---|---|
| Estação | Verão | Outono | Inverno | Primavera |
| Momento | Almoço ao ar livre | Jantar especial | Brunch de domingo | Café da manhã |
| Destino | Grécia | Nova Iorque | Paris | Indonésia |
| Situação | Praia/festa | Drinks/museu/networking | Arte/décor/viagem | Aniversário/picnic |
| Palavra | Viva e curiosa | Marcante e poderosa | Delicada e inspiradora | Vibrante e ousada |
| Aroma | Melão | Sândalo | Rosas | Pêra |

As 4 brumas (para referência): Melon Mood (frasco creme), Santal Skin (laranja), Rose Ritual (rosa), Pear Fresh (verde). Todas perfumam corpo e cabelo, realçam o brilho sem pesar e deixam a pele hidratada e macia; o que muda é só a fragrância e a personalidade.
