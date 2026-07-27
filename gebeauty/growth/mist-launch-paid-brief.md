# Campanha Body & Hair Mist — especificação de build (Meta, execução interna)

> **Objetivo:** velocidade de vendas do lançamento, na fronteira de eficiência.
> **Escopo:** Meta apenas (Google adiado). **Execução:** interna, construída via API do Meta
> (conta 606199920079315, BRL). **Janela:** ~2 semanas de burst.
> **Verba:** governada por piso de ROAS, não por teto fixo (R$20–40 mil é expectativa de
> referência, não limite).
> **Fragrâncias nesta campanha:** Rose Ritual, Pear Fresh, Santal Skin (Melon Mood fica de fora).
> **Status:** estratégia aprovada. Build travado em duas dependências: (a) criativos novos da GE
> no conjunto de formatos do item 4, (b) mecânica de AOV ativa nas PDPs. Nada é ativado nem gasta
> sem aprovação explícita do Lucas.

---

## 1. O produto

Linha de brumas perfumadas para cabelo e corpo (perfumaria de uso duplo, categoria nova para a
GE). 3 fragrâncias nesta campanha, 200ml, R$129, preço cheio:

| Fragrância | PDP (destino do anúncio) | Notas |
|---|---|---|
| **Rose Ritual** | `/products/rose-ritual-body-hair-mist` | rosas, lichia, frutas vermelhas; realça brilho + hidrata pele |
| **Pear Fresh** | `/products/pear-fresh-body-hair-mist` | pêra, frésia, lírio |
| **Santal Skin** | `/products/santal-skin-body-hair-mist` | sândalo, cardamomo, patchouli (amadeirado) |

Domínio: `gebeauty.com.br`. As 3 estão ativas, publicadas e com estoque (~4.200–4.400 un. cada);
coleção em `/collections/body-hair-mist`. Compra sensorial (cheiro que fica), de impulso/presente/
coleção. As fragrâncias são "moods" colecionáveis, o que puxa para múltiplas unidades por pedido
(central para a economia).

## 2. Guardrail econômico (governa o quanto se pode gastar)

Preço cheio, sem desconto, com piso de 10% de lucro líquido por pedido (não negociável). Um
pedido de 1 unidade a R$129 tem pouquíssima folga de CAC:

| Formato de pedido | Contribuição | Teto de CAC no piso de 10% |
|---|---|---|
| 1 bruma (R$129) | R$63 | ~R$48 |
| 2 brumas (R$258) | R$138 | ~R$110 |
| 1 bruma anexada a carrinho ≥ R$299 | +R$75 marginal | irrelevante (attach) |

A alavanca não é desconto, é **elevar o valor do pedido**: as PDPs comunicam a vantagem de levar
mais fragrâncias + o frete grátis a partir de R$299. Essa mecânica de AOV na PDP é o mecanismo de
margem, não enfeite (dependência de launch).

**Governança por piso de ROAS, não por teto de verba.** Verba setada alta para não restringir; o
freio é o piso de ROAS.
- Lances: aquecer 2–3 dias em volume/cost-cap (categoria nova, o pixel precisa de sinal), depois
  virar para **ROAS mínimo**. Não iniciar frio no piso de ROAS (sufoca a entrega).
- Piso inicial: **3,5–4,0 reportado** (o reportado superestima o real em ~20–40%). Calibrado no
  fim da semana 1 ao ROAS-de-plataforma que dá 10% líquido real no dado da GE.
- Teto diário de segurança bem acima do gasto esperado, só como trava anti-descontrole.
- Governança pela margem real (AOV, unidades/pedido, CAC e ROAS verdadeiros medidos pela GE), não
  só pelo ROAS de plataforma.

> Nota interna: as 3 fragrâncias usam COGS proxy (R$22,75, custo landed do Melon, mesma forma/fill)
> a confirmar. Números da tabela são a leitura corrente sobre esse proxy.

## 3. Estrutura + pareamento formato→posicionamento (o núcleo)

**Consolidar, não fragmentar.** 1 campanha de prospecção consolidada (CBO), 3 fragrâncias como
**criativos**; o algoritmo distribui para a fragrância × público que converte. Não criar 1
campanha por fragrância (fragmenta conversões, trava o aprendizado, infla o próprio CPM). O
casamento fragrância→pessoa é feito no nível do produto pelo algoritmo (camada Advantage+
Catalog/DPA de prospecção com o conjunto das 3 brumas), não pela separação de campanha. + 1
campanha de retargeting (DPA + visitantes/engajadores).

**Pareamento formato→posicionamento (o que deu errado da última vez).** Cada anúncio carrega os
4 formatos e uma regra (`asset_customization_rules`) amarra cada formato aos posicionamentos que
ele pode servir, tornando o corte estruturalmente impossível:

| Formato | Tamanho | Serve SOMENTE |
|---|---|---|
| **9:16** | 1080×1920 | IG Stories, IG Reels, FB Stories, FB Reels, IG Explore Home, Audience Network (vertical) |
| **4:5** | 1080×1350 | IG Feed, FB Feed (feed vertical principal) |
| **1:1** | 1080×1080 | FB Feed (alt), IG Explore grid, Marketplace, Messenger, Search, Shop |
| **1.91:1** | 1200×628 | Coluna direita (desktop), fallback de feed link, Audience Network banner |

Regra dura: nenhum ativo único serve todos os posicionamentos. Posicionamentos Advantage+ podem
ficar ligados **porque** as regras alimentam cada um com o formato certo.

**Otimização (~1 semana com as 3 rodando junto):** ler o breakdown de público por fragrância;
graduar as de público próprio para verba dedicada; manter consolidadas as que puxam o mesmo
público. Não julgar fragrância vencedora numa janela em que elas não rodaram lado a lado.

## 4. Criativo (novo, fornecido pela GE)

- Todos os criativos são **novos, fornecidos pela GE** para as 3 fragrâncias.
- **Requisito de formato (crítico para o pareamento):** por fragrância, no mínimo **9:16
  (1080×1920), 4:5 (1080×1350) e 1:1 (1080×1080)**, de preferência também **1.91:1 (1200×628)**.
  Faltando um formato, o posicionamento correspondente fica sem ativo próprio (fica sem entrega ou
  volta o corte).
- Múltiplas variações de claim por fragrância são bem-vindas (mais superfície de teste).
- Zonas seguras da casa: horizontal → espaço à direita; vertical → espaço no topo; manter copy e
  logo `ge` livres por formato. Voz: ingrediente-como-prova, sem travessão, PT idiomático.

## 5. Segmentação

- Prospecção: ampla / Advantage+ (semente: perfumaria, beleza, cabelo, gifting; lookalike de
  compradores GE se disponível). Geo: Brasil.
- Retargeting: visitantes das PDPs/coleção, engajadores IG/FB, base de clientes GE (attach da
  bruma a quem já compra cabelo).

## 6. Rastreamento (coorte isolado)

- UTM em todos os anúncios: `utm_campaign=mist-launch-2026-07`; `utm_source=meta`, `utm_medium=cpc`;
  `utm_content` = fragrância + claim.
- Prefixo de nomenclatura `MIST-LAUNCH |`.
- Evento de otimização = Purchase; confirmar disparo de pixel/CAPI nas 3 PDPs de bruma.
- Pedidos do coorte marcados no Shopify para a GE separar AOV, unidades/pedido, CAC real e 2ª compra.

## 7. Métricas

- **Sucesso:** velocidade de vendas com valor de pedido saudável (mecânica de múltiplas unidades
  funcionando) e CAC dentro do teto, mantendo a compra lucrativa; identificar fragrância(s) e
  claim(s) vencedores.
- **Kill/reestruturar:** pedido preso em 1 unidade com CAC acima do teto; criativo que não bate o
  teto depois do aprendizado.

## 8. Cronograma (travado na entrega dos criativos)

| Quando | O quê |
|---|---|
| GE entrega os criativos (item 4) | destrava o build |
| Build (via API, tudo PAUSADO) | campanha + ad set + criativos com regras de pareamento + rastreamento |
| QA por posicionamento | preview de cada posicionamento, conferir formato certo, sem corte de headline/logo/produto |
| Aprovação do Lucas | ativar + definir verba |
| Soft-open | abre com a 1ª fragrância entregue (aquece o pixel), demais entram como criativos na mesma campanha |
| D+2 a D+3 pós-abertura | saído do aprendizado, virar para piso de ROAS |
| Fim da semana 1 de veiculação | calibrar o piso de ROAS ao líquido real |
| ~1 semana com as 3 juntas | breakdown de público por fragrância, graduar vencedores |
| Fim das 2 semanas | escalar/cortar/iterar por fragrância e por claim |

## 9. Gates de aprovação

Tudo é construído **PAUSADO**. Apresento os previews por posicionamento + a estrutura; o Lucas
aprova ativação, verba e a virada para o piso de ROAS. Escrita na API e gasto ficam travados na
aprovação explícita, a cada passo.

## 10. Aberto / adiado

- **Google:** adiado (Meta apenas neste lançamento).
- **Mecânica de AOV na PDP:** dependência de launch (cross-sell das outras fragrâncias + progresso
  de frete R$299 + brinde "ganhe uma necessaire"), ativa nas 3 PDPs antes do gasto. Toca a loja →
  aprovação do Lucas.
- **COGS** das 3 fragrâncias no proxy R$22,75 (confirmar).
