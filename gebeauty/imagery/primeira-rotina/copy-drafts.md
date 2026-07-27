# Oferta rotina de lavagem — copy DRAFT (para aprovação)

> **Status: DRAFT-for-approval.** Nada publicado, nada enviado. Autoria de copy apenas.
> Ancorado no catálogo ao vivo (`gebeauty/.env`) em 2026-07-23.
>
> **A oferta (travada):** leve **shampoo sem sulfato** (001) + **máscara condicionadora** (002),
> tamanho cheio, por **R$95 + frete grátis**, e escolha um terceiro item de presente:
> **leave-in com proteção térmica travel** (011, vale R$47) **ou** **shampoo a seco** tamanho cheio (008, vale R$69).
> Espinha estratégica: leva a pessoa para a **rotina de lavagem** (shampoo + máscara + shampoo a seco),
> que é o que gera recompra.
>
> **Produtos e preços reais (catálogo ao vivo):**
> | Item | Nome no site | Preço cheio |
> |---|---|---|
> | 001 (pago) | shampoo sem sulfato | R$95 |
> | 002 (pago) | máscara condicionadora | R$95 |
> | 011 (presente A) | travel size \| leave-in com proteção térmica | R$47 |
> | 008 (presente B) | shampoo a seco | R$69 |

---

## Nota sobre o preço baixo x tom premium (leia antes)

R$95 pela dupla de dois best-sellers full-size (R$190 no cheio) **mais** um terceiro grátis é, na
matemática, um desconto agressivo. O risco é a peça soar liquidação/queima de estoque e corroer o
posicionamento. Como a copy resolve isso, sem tocar no preço:

1. **Nunca cito % OFF, "desconto", "liquidação", "queima" ou "última chance".** O gatilho é *montar a
   rotina* + *o presente*, não o corte de preço.
2. **Lidero pelo presente e pelo valor em R$ do presente**, não pelo desconto. "Você ganha", não "você economiza X%".
3. **Ancoro o "de" nos dois essenciais (R$190), não na soma dos três.** Se o riscado fosse a soma dos três
   (R$237 / R$259), o olho lê "por um terço do preço" = fire sale. Ancorando na dupla, a leitura é
   "a dupla por R$95, e um presente por cima" = valor agregado. **Recomendação de token:** `{{DE_PRICE}}` = **R$190**.
4. **R$95 é enquadrado como o preço de *começar uma rotina*, um ponto de partida inteligente**, não como
   saldo. "Monte a base", "comece no seu tempo", "a rotina que vira hábito".
5. **A escolha do presente reforça autonomia (premium), não escassez.** "Você escolhe" > "corra que acaba".

O único número de corte que aparece é o riscado `de R$190`, e ele serve de âncora de valor, não de chamada de desconto.

---

# DELIVERABLE A — Hooks de anúncio pago (3 ângulos)

Regra de plate: **horizontais = produtos à esquerda / copy à direita; verticais = produtos embaixo / copy no topo.**
Cada headline vem em 2 variantes: **curta** (formatos apertados / zonas de recorte estreitas) e **longa**
(quando há respiro). O anúncio **declara a oferta** para que o hook se sustente sozinho; o hero da LP repete a oferta.

## Ângulo 1 — rotina (montar/completar a rotina de lavagem)

**Headline curta:** monte sua rotina de lavagem por R$95
**Headline longa:** sua rotina de lavagem começa aqui: shampoo + máscara por R$95
**Support (subtexto):** leve shampoo + máscara e escolha o terceiro de presente. frete grátis.

## Ângulo 2 — presente (leve a dupla, o terceiro é presente)

**Headline curta:** leve a dupla, o terceiro é presente
**Headline longa:** compre shampoo + máscara e ganhe o terceiro de presente
**Support (subtexto):** por R$95, com frete grátis. o presente é você quem escolhe.

## Ângulo 3 — loyalty ("quem experimenta, volta", mas ainda nomeia a oferta)

**Headline curta:** quem experimenta, volta. comece por R$95
**Headline longa:** quem experimenta a rotina, volta. shampoo + máscara por R$95
**Support (subtexto):** com o terceiro item de presente e frete grátis. comece no seu tempo.

> Todas as headlines cabem em zona de recorte estreita (curta = 5 a 7 palavras). O support fica
> em 10 a 13 palavras, para uma linha na faixa de copy do plate. Todas nomeiam a oferta (dupla +
> terceiro presente + R$95 + frete grátis) de forma que o hook se sustente sozinho.

---

# DELIVERABLE B — Copy da landing page

Preenche cada seção de `lp-offer-mockup.html`. Ordem = ordem da página.

## HERO
- **eyebrow:** monte sua rotina de lavagem
- **h1:** shampoo + máscara por R$95, e o terceiro é o nosso <em>presente</em>.
  *(o `<span class="em">` cai em "presente" — vermelho GE no destaque)*
- **subhead:** a dupla que limpa e nutre de verdade, e você ainda escolhe o presente: leave-in travel ou shampoo a seco. tudo com frete grátis.
- **priceblock · linha do presente (gift):** seu presente à escolha, e ele sai de graça
- **priceblock · linha de pagamento (pay):** você leva os três por `{{PRICE=R$95}}` `de {{DE_PRICE=R$190}}`
- **priceblock · fine:** shampoo + máscara em tamanho cheio, presente à sua escolha, frete grátis
- **CTA (botão):** quero montar minha rotina — *sub:* e escolher meu presente
- **stars/chips:** `{{RATING}}` e `{{N_REVIEWS}}` = dado real do Loox (não inventar; puxar do produto). Chips: vegano · sem sulfato · cruelty-free.

## COMO FUNCIONA (3 passos)
- **h2:** como funciona
- **lead:** três passos, sem cupom para decorar.
- **passo 1 — leve a dupla:** shampoo + máscara condicionadora, tamanho cheio, a base da sua lavagem.
- **passo 2 — escolha o presente:** leave-in travel ou shampoo a seco, o que combina com o seu momento.
- **passo 3 — receba em casa:** o presente entra grátis na sacola, com frete grátis, sem precisar de código.

## ESCOLHA SEU PRESENTE (gift chooser)
- **h2:** escolha seu presente
- **lead:** os dois entram de graça. escolha o que faz mais sentido pra você.
- **Card A — leave-in travel (011):**
  - tag: travel size
  - h3: Leave-in com Proteção Térmica
  - desc: proteção térmica até 230°C antes do secador ou da chapinha, no tamanho que vai na bolsa.
  - val: vale `{{GIFT_VALUE_LEAVEIN=R$47}}` · grátis
- **Card B — shampoo a seco (008):**
  - tag: tamanho cheio
  - h3: Shampoo a Seco
  - desc: biotina, pantenol e algas vermelhas controlam a oleosidade e dão grip entre as lavagens.
  - val: vale `{{GIFT_VALUE_SECO=R$69}}` · grátis
- **linha "picked" (load padrão):** escolha um presente acima para continuar
- **linha "picked" (A):** seu presente: <b>Leave-in com Proteção Térmica (travel)</b>
- **linha "picked" (B):** seu presente: <b>Shampoo a Seco</b>
- **CTA do seletor (desabilitado):** escolha seu presente — *sub:* os três, por `{{PRICE=R$95}}`
- **CTA do seletor (habilitado):** adicionar à sacola — *sub:* os três, por `{{PRICE=R$95}}`

## POR QUE ESSA ROTINA (ingrediente como prova)
- **h2:** por que essa rotina
- **lead:** limpar, nutrir e finalizar. o trio que a gente mais vê virar hábito.
- **card 1 (passo 1 — shampoo sem sulfato):** limpa de verdade sem ressecar, respeitando a fibra e a cor. o começo de toda lavagem.
- **card 2 (passo 2 — máscara condicionadora):** repõe maciez e alinha o fio, o cabelo desembaraça e fica leve na hora.
- **card 3 (seu presente — finalização à sua escolha):** leave-in que protege do calor até 230°C, ou shampoo a seco com biotina e pantenol que estica a lavagem. você decide o ritmo.

## FECHAMENTO (close)
- **h2:** comece no seu tempo
- **lead:** a dupla da lavagem, o presente por nossa conta.
- **priceblock · gift line:** presente incluso, à sua escolha
- **priceblock · pay line:** os três por `{{PRICE=R$95}}`
- **CTA:** quero montar minha rotina
- **sig (assinatura):** no seu tempo, do seu jeito.

---

## Pareamento hook de anúncio ↔ hero da LP (message match)

A LP tem **um** hero canônico (ângulo rotina + presente, que é a espinha da oferta). Todos os três hooks
chegam nele sem quebra de leitura, porque o hero repete os três elementos da oferta (dupla + terceiro presente
+ R$95 + frete grátis).

| Ângulo do anúncio | Headline do anúncio (curta) | Hero da LP (o que "casa") |
|---|---|---|
| **rotina** | monte sua rotina de lavagem por R$95 | eyebrow "monte sua rotina de lavagem" + h1 "shampoo + máscara por R$95" — *casamento verbatim do eyebrow* |
| **presente** | leve a dupla, o terceiro é presente | h1 "...e o terceiro é o nosso presente" + linha "seu presente à escolha, e sai de graça" |
| **loyalty** | quem experimenta, volta. comece por R$95 | mesmo hero; o "comece por R$95" casa com o CTA "quero montar minha rotina" e a assinatura "comece no seu tempo" |

Se Lucas quiser hero dedicado por ângulo (3 variantes de LP), dá para trocar só o `eyebrow` + `h1`
por ângulo mantendo o resto da página; hoje a recomendação é hero único (rotina+presente) para
simplificar o teste e não fragmentar o tráfego.

---

## Tokens recomendados (resumo para quem for preencher a LP)

| Token | Valor recomendado | Racional |
|---|---|---|
| `{{PRICE}}` | R$95 | preço da oferta (travado) |
| `{{DE_PRICE}}` | R$190 | riscado = dupla full-size (95+95); âncora nos essenciais, não na soma dos três (evita leitura de fire sale) |
| `{{GIFT_VALUE_LEAVEIN}}` | R$47 | preço real do leave-in travel (011) |
| `{{GIFT_VALUE_SECO}}` | R$69 | preço real do shampoo a seco (008) |
| `{{GIFT_VALUE}}` (genérico, hero/close) | "de R$47 a R$69" ou o valor do presente escolhido | os dois presentes têm valores diferentes; usar faixa no hero neutro, ou o valor exato após a escolha |
| `{{RATING}}` / `{{N_REVIEWS}}` | dado real do Loox | não inventar; puxar do produto (shampoo e máscara são best-sellers) |

## Conformidade com regras travadas de marca
- Sem travessões. PT-BR idiomático, sem calque de inglês.
- Ingrediente como prova só onde verificável: leave-in 230°C; shampoo a seco (biotina/pantenol/algas
  vermelhas). Shampoo sem sulfato e máscara ficam em nível de benefício (nenhum ativo inventado).
- Tagline "no seu tempo, do seu jeito." usada uma vez, como assinatura no fechamento.
- Só produtos reais do catálogo ao vivo. Nenhum número/claim inventado.
- Tom valor-agregado / premium: lidera com rotina + presente + "R$95 com frete grátis"; zero linguagem de desconto.
