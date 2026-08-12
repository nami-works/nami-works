---
id: omie-purchase-orders
name: Omie purchase-order tools (supplier + product lookup, then PO creation)
owner: cto
status: backlog
priority: normal
created: 2026-08-09
target: null
current_phase: 1-supplier-lookup
next_blocker: not started — awaiting go-ahead to begin Phase 1
next_owner: cto
stakeholders:
  - Lucas (approved scope 2026-08-09)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

The connector's Omie tools are currently all read-only (contas a pagar/receber, cliente lookup, listar pedidos). Lucas asked whether the connector can input a PO directly into Omie — it can't yet. This gets built in three phases, ending with a write tool that lets an operator create a real purchase order in Omie via Claude, gated behind two-step confirm like the existing Shopify write-tools.

## API reference

`produtos/pedidocompra/` resource, `IncluirPedCompra` method. Header (`cabecalho_incluir`): `nCodFor` (supplier code, required), `dDtPrevisao`, `cCodIntPed`, `cNumPedido`, `nQtdeParc`, `cCodCateg`, `nCodCC`, `cObs`/`cObsInt`. Line items (`produtos_incluir`, array): `nCodProd` (required), `nQtde`, `nValUnit`, `nDesconto`, tax fields, `cUnidade`, `cNCM`, `codigo_local_estoque`. Returns `nCodPed`. Source: [Criando um Pedido de Compra por API](https://ajuda.omie.com.br/pt-BR/articles/6792662-criando-um-pedido-de-compra-por-api).

## Phases

- [ ] 1. `omie_consultar_fornecedor` (read-only) — name/CNPJ → Omie supplier code per company, mirrors `omie_consultar_cliente`
- [ ] 2. `omie_consultar_produto` (read-only) — name/SKU → Omie product code (`nCodProd`), no existing mapping today
- [ ] 3. `omie_create_purchase_order` (write, two-step confirm) — built and tested only after 1+2 are live and verified against real data
- [ ] 4. Live smoke test — create one real PO end-to-end, confirm in Omie UI
- [ ] 5. Deploy + handoff

## Notes

- 2026-08-09 — Scoped with Lucas. Two real gaps identified before a PO tool is usable: no supplier-code registry (we have one for customers — `gebeauty/omie-b2b-registry.json` — but not suppliers) and no Shopify-SKU→Omie-product-code mapping anywhere in the repo. Both become Phases 1–2.
- 2026-08-09 — Decisions locked: (a) ship phased, not one big PR — lookups first, PO write tool once proven against real data; (b) PO tool scoped to all 6 Omie companies, same `empresa` selection pattern as the existing read tools.

## Done means

- `omie_consultar_fornecedor` and `omie_consultar_produto` live, tested, deployed
- `omie_create_purchase_order` live with two-step confirm (preview → `confirm: true`), tested (unit + live smoke test), deployed
- One real PO created via the tool and confirmed to appear correctly in the Omie UI
- Lucas can ask Claude to create a PO by supplier name + product names/quantities without knowing any Omie internal codes
