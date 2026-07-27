# Frete grátis por região — tabela Unilog B2C

**Data:** 2026-07-22 · **Base:** 28.701 pedidos da Loja Online (BR), últimos 12 meses, receita líquida de mercadoria R$ 5,61 mi · **Fonte de frete:** contrato Unilog assinado 19/mai/2026 (Anexo II.I, tabela B2C, origem Serra/ES) · **Match CEP→zona GEOCOM:** 99,98% exato (14.929 faixas de CEP).

## Recomendação

Substituir o frete grátis único de **R$299 nacional** por uma **ladeira de 5 faixas regionais**:

| Região | Estados | Frete grátis a partir de |
|---|---|---|
| **Sudeste** | ES · MG · RJ · SP | **R$ 199** |
| **Centro-Oeste** | DF · GO · MT · MS | **R$ 279** |
| **Sul** | PR · RS · SC | **R$ 319** |
| **Nordeste** | AL · BA · CE · MA · PB · PE · PI · RN · SE | **R$ 399** |
| **Norte** | AC · AP · AM · PA · RO · RR · TO | **R$ 649** |

**Abaixo do limiar:** o cliente paga o frete exato da tabela Unilog (pass-through puro — operação neutra para a GE). **Acima:** frete grátis, GE absorve.

## Lógica

O único jeito de o frete grátis machucar a margem é quando a GE absorve o frete. Então só se concede grátis quando o pedido é grande o suficiente para o frete ser uma fatia pequena e **fixa** do valor:

> **Limiar(região) = frete médio da região ÷ k**

- **SE travado em R$199** (âncora — 66% das vendas), o que implica k = 11,7%.
- **k = 10% nas demais regiões** (escolha do Lucas no sweep).
- Resultado: cada pedido com frete grátis, em qualquer região, carrega ≈ 10-12% de frete → **a margem após frete fica nivelada no país todo**. Região barata (SE, frete médio R$23) ganha grátis num AOV baixo; região cara (N, frete médio R$66) só num pedido grande.

## Números

| Indicador | Valor |
|---|---|
| k médio ponderado (por vendas) | **11,1%** |
| Pedidos com frete grátis | **30%** (vs 18% no R$299 fixo) |
| **Impacto no lucro** (frete absorvido + 5% devoluções ÷ receita) | **5,0%** |
| Custo Unilog bruto — teto se tudo fosse grátis | 13,9% (14,6% c/ devoluções) |

**Por que R$199 no SE aumenta o grátis mas o impacto total continua baixo:** o SE é barato de servir (frete R$23), então liberar grátis lá custa pouco por pedido. O ganho grande é **parar de sangrar no Norte/Nordeste**, onde o R$299 fixo hoje dá grátis com frete arrastando 20-30% do pedido.

## O que isso corrige

1. **Injustiça regional do R$299 fixo:** hoje um pedido grátis no SE arrasta ~8% de frete (poderia ser mais barato) e no Norte ~22% (sangra margem). A ladeira nivela isso.
2. **Subsídio escondido abaixo do limiar:** hoje a GE cobra em média R$17 de frete quando cobra, mas o custo real é R$27 — subsidia ~R$10/pedido. O pass-through puro elimina isso.

## Sensibilidade (k das demais regiões, SE sempre R$199)

| k demais | CO | S | NE | N | k médio pond. | % grátis | Impacto |
|---|---|---|---|---|---|---|---|
| 8% | 349 | 399 | 499 | 699 | 10,5% | 28% | 4,5% |
| **10% (travado)** | **279** | **319** | **399** | **649** | **11,1%** | **30%** | **5,0%** |
| 12% | 229 | 269 | 329 | 549 | 11,8% | 33% | 5,6% |
| 15% | 199 | 219 | 269 | 449 | 12,7% | 37% | 6,3% |

Como o SE domina e está travado, ajustar as demais regiões mexe pouco no P&L total (4,5%→6,3% em todo o range) — é essencialmente uma decisão de **alcance vs margem no Norte/Nordeste**, não de custo da empresa.

## Premissas travadas

- Métrica = frete pago à Unilog nos pedidos com frete grátis (absorvido) ÷ receita de mercadoria; abaixo do limiar é net-zero (pass-through).
- Devolução: +5% do frete de ida, linha separada (não embutida no limiar).
- Imposto (ISS+PIS/COFINS 14,25%) tratado como já embutido na tarifa — **confirmar contra uma NF real da Unilog**.
- Peso real do pedido (Shopify); cubagem 167 kg/m³ não aplicada por pedido (sem dimensões) — risco de subcusteio em caixas leves/volumosas, ver ressalva.
- Modelo estático (sem elasticidade de AOV). Baixar limiar tende a subir AOV e converter mais — não projetado.
- Canal: só Loja Online BR. Exclui B2B, Amazon/Rappi/BLZ, POS/IGLU.

## Ressalvas

- **Cubagem:** custeado no peso real. Se as caixas forem leves e volumosas, a Unilog cobra pelo peso cubado (maior) — o custo real pode ser um pouco acima do modelado. Vale medir as dimensões das caixas padrão e revalidar.
- **Prazos Norte:** entregas de até 40 dias úteis em capitais/interior distantes do Norte. O limiar alto (R$649) já desincentiva, mas vale comunicar prazo por região.
- **Não publicado:** isto é recomendação. A alteração nas delivery profiles / desconto de frete grátis do Shopify é um passo separado, sob aprovação.

## Baseline transportadora atual (Sélia) e decisão de aplicação

Comparação com o custo real atual (Sélia Fullcommerce, origem Extrema/MG, Correios + transportadoras) — 8.627 embarques, Mar–Jun 2026, R$176k de frete sobre R$1,89 mi de NF (~R$472k/mês, mesma escala da base Shopify):

| | Sélia (hoje) | Unilog (proposta) |
|---|---|---|
| Frete ÷ receita (bruto) | **9,3%** | **13,9%** |
| Frete médio/embarque | R$20,43 | R$27,19 |
| SE / CO / S / NE / N | 7,7% / 7,6% / 7,6% / 9,9% / 10,9% | 12,2% / 13,9% / 16,7% / 18,3% / 28,6% |

**Decisão (Lucas):** usar a **mesma ladeira** (calibrada Unilog) — sem ladeira interina para Sélia. Aplicar já é **seguro em margem**: como o custo Sélia é ~4,6 pts mais barato, os limiares calibrados em Unilog super-protegem a margem no período interino e passam a valer exatamente no cutover (~1 mês). O que não fazer: manter o R$299 fixo, que super-subsidia o Norte sob qualquer transportadora.

**Bandeira estratégica (money call, para o Lucas):** no frete B2C de encomenda leve, a **Unilog é ~R$20k/mês (~R$250k/ano) mais cara** que a Sélia — pior no S/NE/N (origem ES perde para Extrema+Correios). A troca precisa se justificar por **armazenagem / serviço / capacidade**, não por frete. Confirmar antes do cutover.

## Artefatos

- `frete-freeship-thresholds.xlsx` — modelo (Recomendação · Premissas editáveis · Por UF · Sweep).
- `threshold-mockup.html` — visual da ladeira para revisão.
- Motor: `gebeauty/scripts/_unilog_freight.py` (tabela + CEP→zona) · `_freight_final.py` (modelo travado).
