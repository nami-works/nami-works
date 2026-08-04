# Sephora CADASTROS — gap punch list (2026-07-14)

Fonte: `sephora_cadastro.csv` (26 linhas: 24 produtos + 2 acessórios), regenerado do catálogo
vivo (`products.json` + descrições/imagens da loja Shopify). Todos os campos **internos e de
fato conhecido já estão preenchidos**. O que resta é o que depende de terceiros — dividido por
dono abaixo. Preencher e reprocessar com `python sephora_mapper.py`.

## Reconciliação de catálogo feita nesta rodada
- Linha Mist **renumerada** (mesmos EANs): 025→**032** (Rose Ritual), 026→**033** (Pear Fresh),
  027→**031** (Santal Skin). CSV antigo (22/jun) estava desatualizado.
- **GEB 111 (Charm Bag Leave-in Mini) saiu do catálogo** (`products.json`) → removido do set.
  **Confirmar com Lucas** se é descontinuado ou só ausente do JSON.
- **GEB 122/123/124 (Shampoo/Condicionador/Leave-in Reconstrutor Mayday) ainda NÃO estão
  publicados na loja** (só a Máscara Mayday GEB 121 está ativa). Sem imagem nem descrição.
  **Confirmar se entram na oferta Sephora agora ou ficam de fora até irem ao ar.**

## Preenchido automaticamente nesta rodada
Descrição do item (loja, ancorada — anti-alucinação), Link Imagem, Volumetria, Nome SAP EN,
Validade Anvisa (3 anos p/ todos), Ponto de Inflamação (N/A p/ não-inflamáveis).

---

## Dono: **Raphael / regulatório** — Anvisa Processo (19 SKUs)
Conhecidos hoje só p/ GEB 003, 008, 010, 013, 022. Faltam:
`GEB 001, 002, 011, 019, 020, 021, 023, 024, 029, 031, 032, 033, 101, 102, 120, 121, 122, 123, 124`

## Dono: **Lucas** — preço de venda B2B (9 SKUs sem preço)
Linha Mist e Mayday nunca tiveram preço B2B. Precisa de **sell-in + sugerido de venda** para:
`GEB 024, 029, 031, 032, 033` (Mist) e `GEB 121, 122, 123, 124` (Mayday).
> Decisão pendente: usar a base de **35% de margem** do cadastro B2B (como os 15 SKUs de
> haircare) como oferta de abertura Sephora, ou definir termo diferente? Ver initiative.

## Dono: **Contador / fiscal** — tributário (todas as linhas)
- `Aliq ICMS %` — interestadual ES→SP (destaque; ~12% com 1,1% efetivo via COMPETE-ES).
- `Custo C/ IPI` + `Custo Total` — derivam do IPI%. Se IPI = 0% (premissa atual), ambos = Custo
  S/ IPI; o mapper passa a calcular automático assim que o IPI for confirmado.
- `Ponto de Inflamação` — só falta **GEB 008** (aerossol, ONU 1950); pegar da FISPQ.
- Rever flag de NCM: **GEB 008** está como 3305.10.00; formato aerossol sugere 3305.90.00.

## Dono: **Comprador Sephora** — setup comercial (preenchido após contato/vendor)
`Canal`, `Nro Lojas`, `Vendor`, `SAP Code (Sephora)`, `Status Compra`, `Markup` — atribuídos
pela Sephora no onboarding do fornecedor. Não bloqueiam o envio inicial do cadastro.

## Dono: **Lucas / marketing** — go-to-market
- `Data Lancamento Retail` / `Data Lancamento Dotcom` — definir no plano de entrada.
- `Foco Ativacao` — quais SKUs recebem investimento de sell-out.
- `Volumetria` faltando p/ minis/escovas sem volume no nome: `GEB 029, 122, 123, 124, 7671, 7685GE`.

---

## Como reprocessar
```
python gebeauty/sephora/sephora_mapper.py            # gera CSV + relatório de gaps
python gebeauty/sephora/sephora_mapper.py --dry-run  # só relatório
```
Preços novos → editar `B2B_PRICES` no mapper. Anvisa → editar `ANVISA`.
Imagens/descrições → `python gebeauty/sephora/fetch_enrich.py` re-puxa da loja.
