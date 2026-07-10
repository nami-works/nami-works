# Omie B2B client codes (codigo_cliente_omie) per company

Resolved 2026-07-02 via ListarClientes (razao_social / cnpj_cpf filter) across all
six GE Omie companies. **The código is per-company** — to query a customer's
orders/financials in a given company, use that company's código.

Use with the connector tools:
- `omie_consultar_financeiro(empresa="Matriz", codigoCliente=<code>)`
- `omie_listar_pedidos(desde=…, ate=…, empresa="Matriz", codigoCliente=<code>)`
- Or look up fresh: `omie_consultar_cliente(cnpj="…", empresa="Matriz")` (fixed 2026-07-02).

## UAU BOX — UAUBOX S.A. · CNPJ 28.917.082/0001-52 (single entity)

| Empresa | codigo_cliente_omie |
|---|---|
| Matriz | 6757341993 |
| Shopping Recife | 2037077035 |
| Shops Jardins | 5153354952 |
| Rio Sul | 5611533123 |
| Rio Mar Recife | 9359520049 |
| Extrema | 11493424013 |

## B4A — B4A SERVICOS DE TECNOLOGIA E COMERCIO S.A. · CNPJ 13.475.001/0001-34 (holding)

| Empresa | codigo_cliente_omie |
|---|---|
| Matriz | 6741776573 |

Branch 13.475.001/0002-15 (ex-Glambox) exists too — resolve on demand with
`omie_consultar_cliente(cnpj="13475001000215", empresa="Matriz")`.

## Amazon — AMAZON SERVICOS DE VAREJO DO BRASIL LTDA (root 15.436.940)

Multiple billing branches; per memory, Amazon switched 0003-67 (Dec2025–Mar2026)
→ 0012-58 (Apr2026+). Matriz códigos:

| CNPJ branch | Matriz codigo | Note |
|---|---|---|
| 15.436.940/0012-58 | 6800644256 | current billing (Apr 2026+) |
| 15.436.940/0003-67 | 6776575612 | prior billing |
| 15.436.940/0001-03 | 6665975317 | Amazon.com.br (test-only) |

(Other companies also carry these three branches — re-run the sweep or use
`omie_consultar_cliente` per company if needed. Ignore the "…Amazonas" personal
CPFs and Samsung Amazônia — false-positive name matches.)

## Moustache Beams — MOUSTACHE BEAMS LTDA (root 30.998.254)

**Multi-branch** (~20 filiais: 0008, 0012, 0014, 0018, 0024, 0035, 0043, 0050,
0052, 0055, 0059, 0065, 0071, 0077, 0083, 0100, 0103, 0137, 0139, 0141). Each has
its own código in each company. Resolve the specific branch on demand with
`omie_consultar_cliente(cnpj="30998254XXXXYY", empresa=…)`. Matriz examples:
0141-61 = 6762369335, 0139-47 = 6762362180, 0035-50 = 6762360098.
