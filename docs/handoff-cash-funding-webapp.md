# Session Handoff — 2026-08-05

**Target surface:** Claude Code — building/deploying a web app on the user's **AWS Lightsail** (their own server + DB). Written self-contained: this is a **greenfield app**, so do not rely on any existing repo memory/CLAUDE.md for the domain — everything you need is inlined below. Source of truth for the domain also lives in the `cash-funding` Claude project doc `claude/invoice-discounting-register.md` and the spreadsheet `Simulador_Antecipacao_GE.xlsx` (built this session).

> ⚠️ This handoff was produced in a Cowork sandbox with **no git access**. It is NOT on `origin`. The user will place this file at `docs/handoff-cash-funding-webapp.md` in the Lightsail app repo (or you create the repo). Nothing was committed for you.

---

## Goal

Build an interactive **invoice-discounting simulator** (antecipação de recebíveis) for GE Beauty's cash & funding operation, hosted on the user's **Lightsail** instance. It replaces an Excel model that outgrew the spreadsheet. Legal entity: **GE COSMÉTICOS LTDA**, CNPJ base 34.987.157. Language of the UI: **pt-BR**. Currency **BRL**.

The one capability that justifies the app (and that the spreadsheet does worst): an **allocation engine** — decide which receivable installments to discount, when, and with which funder, enforcing tenor + per-sacado cap + line ceilings, and showing net proceeds and line utilization live.

---

## Domain model (inline — this is the whole spec)

### Entities
- **Funder** — a bank or FIDC that buys/discounts receivables. Params below.
- **Delivery (Entrega)** — a negotiated product delivery to a customer. Fields: cliente, produto, qtd, preço unit., total (=qtd×preço), nº parcelas, first-installment offset (days), interval (days), **payment calendar** ("Corrido" | "Terça 3-25"), delivery date, status.
- **Installment (Parcela)** — one of a delivery's N payments. value = total/N. Has a computed **due date** (from delivery + calendar rule), plus interactive **discount date** and **funder**, and computed **net value**.
- **Operation (drawdown)** — an executed discount (one or more installments sold to a funder on a date).

### Funder params
| Funder | Type | Taxa a.m. | IOF diário | IOF fixo | Tenor máx | Teto | Per-sacado cap | Recourse | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Itaú** | Bank | 1,72% | 0,0082%/dia | 0,38% | **210 d** | R$ 650.000 *(dictated, unverified)* | — | com recurso | CET ref 30,13% a.a. Tarifas seen: TAC R$260/op + R$4,50/título |
| **Ghia** | FIDC | 2,00% | **0 (assumed)** | **0 (assumed)** | **120 d** | R$ 500.000 | **R$ 250.000** | com recurso (coobrigação) | 24% a.a. nom / 26,82% efet. IOF + tarifas + CET **UNCONFIRMED** → cost is an estimate. Not yet active (R$0 used). |

Ghia is a FIDC structure: Ghia Crédito Corporativo FIDC (CNPJ 51.498.070/0001-52, cessionário) · Ghia Gestão de Recursos ("Ghia Asset", 35.070.686/0001-71, gestora) · Ghia Capital (14.662.218/0001-16, originadora). Make funder params **editable in the app** (they will change once Ghia is confirmed).

### Deliveries data (seed the DB with these)

**UAUBox** — sacado UAUBOX LTDA, CNPJ 28.917.082/0001-52 (Grupo UAU). Calendar **Corrido**. Terms: 1ª parcela 30 dias após NF-e, intervalo 30 dias.

| Produto | Qtd | Preço un. | Total | Parcelas | Data entrega | Status |
|---|--:|--:|--:|--:|---|---|
| Shampoo a Seco (Março) | 17.000 | R$ 17,19 | R$ 292.230,00 | 4 | 2026-02-15 | Received |
| Booster Hidratante (Maio) | 17.000 | R$ 18,29 | R$ 310.930,00 | 4 | 2026-04-15 | Mostly received |
| Booster Definição (Novembro, **revisado**) | 26.500 | R$ 21,83 | R$ 578.495,00 | 5 | 2026-10-15 | 4 originais faturadas; still to issue R$ 207.385 |

UAUBox total (revised): **R$ 1.181.655,00**. Booster Definição was originally 17.000 un / R$ 371.110 (4× 92.777,50); increased to 26.500 un / R$ 578.495 (5× 115.699) per email 31/07, confirmed by Raquel (Grupo UAU) 03/08 — aditivo pending but **not** a prerequisite to discount. "Still to issue" = 4× increment R$ 22.921,50 + 5ª parcela R$ 115.699 = **R$ 207.385**.

**B4A** — sacado B4A SERVIÇOS DE TECNOLOGIA E COMÉRCIO S.A., CNPJ 13.475.001/0001-34. Parceria "B4A Connect" signed 28/07/2026. Calendar **Terça 3-25**. 4 parcelas each. **The receivable = "ajuda de custo"** (what B4A pays GE), NOT the PDV/varejo.

| Produto | Qtd | Ajuda custo un. | Total | Parcelas | Entrega (month) |
|---|--:|--:|--:|--:|---|
| Shampoo sem sulfato 60ml | 15.000 | R$ 7,00 | R$ 105.000 | 4 | 08/2026 |
| Máscara condicionadora 50ml | 15.000 | R$ 7,00 | R$ 105.000 | 4 | 08/2026 |
| Leave-in c/ proteção térmica 150ml | 15.000 | R$ 12,00 | R$ 180.000 | 4 | 10/2026 |
| Shampoo a seco 150ml | 15.000 | R$ 14,00 | R$ 210.000 | 4 | 11/2026 |
| Booster Antifrizz 15ml | 20.000 | R$ 12,00 | R$ 240.000 | 4 | 12/2026 |

B4A total: **R$ 840.000,00**. Reference only (not receivable): TOTAL MERCADO R$ 5.300.000 (PDV). NF data: IE 373.292.635.112, IM 36557, natureza "bonificação/doação/brinde", CD Av. Caio Cotrim 400, Itapevi/SP.

**Executed operation already on the books:** Op nº **1359525753** — Itaú, 2026-07-16, face R$ 185.555,00 (UAUBox Booster Definição nov+dez installments at the OLD R$ 92.777,50 each), cost R$ 17.467,30 (juros 14.627,92 + tarifas 264,50 + IOF 2.574,88), net **R$ 168.087,70**, final due 2026-12-15.

---

## Business rules (implement exactly — verified this session)

### Due-date calculation
- **Corrido:** `due(n) = delivery + first_offset + (n-1)*interval`. With 30/30 that's `delivery + 30n`.
- **Terça 3-25 (chained Tuesday snapping):**
  - `nominal(1) = delivery + first_offset`; `nominal(n) = due(n-1) + interval` (chain off the previous **snapped** due date, not the nominal).
  - Snap `nominal` → `due`: let `T0` = first Tuesday on/after `nominal`. If `day(T0) > 25` → `due` = first Tuesday of the **next** month whose day ≥ 3. Else if `day(T0) < 3` → `due = T0 + 7`. Else `due = T0`.
  - Tuesday = weekday Tuesday; valid pay window = day-of-month **3..25 inclusive**.
- Reference algorithm (verified in Python, reproduce in the app's language):
```python
def next_valid_tuesday(x):           # x = date
    d = x
    while d.weekday() != 1:          # Mon=0 .. Tue=1
        d += timedelta(days=1)
    while not (3 <= d.day <= 25):
        if d.day < 3:
            d += timedelta(days=7)
        else:                        # > 25 → first Tuesday of next month
            d = first_of_next_month(d)
            while d.weekday() != 1:
                d += timedelta(days=1)
    return d
```

### Net-value (cost of discounting) per installment
Given funder F, discount date `DD`, due date `VD`, face `V`:
- `dias = VD - DD` (must be ≥ 0)
- `juros = V * (taxa_am/30) * dias`
- `iof   = V * (iof_dia * dias + iof_fix)`
- `custo = juros + iof + tarifa`
- `liquido = V - custo`
- **Tenor check:** flag if `dias > funder.tenor_max` (EXCEDE) or `dias < 0` (desc>venc).

Sanity check the formula against op 1359525753: two Itaú titles at ~122 and ~152 days reproduce total cost R$ 17.467,30 → net R$ 168.087,70. (Itaú's real op used its own tarifa/IOF; treat the per-installment formula as the model, tarifa as a param.)

### Allocation engine (the core feature)
Inputs: set of open installments (with due dates, face, sacado), funder params, already-used per funder, a **cutoff date** (optional; user has been applying a "≤ Dez/26" rule), and an objective.
Constraints to enforce:
- `dias(installment, discount_date) ≤ funder.tenor_max`
- Σ face routed to Ghia **per sacado** ≤ R$ 250.000
- Σ face routed to a funder ≤ `teto − já_usado`
Outputs: per-installment funder assignment (or none), total face discounted, total net, total cost, and **per-funder utilization** (used vs ceiling). Provide both a manual toggle mode and a **suggested allocation** (e.g., prefer lower all-in cost subject to constraints — note Ghia is cheaper on rate and likely IOF-free but tenor-capped at 120d and sacado-capped; Itaú carries IOF but 210d tenor and bigger line).

---

## Architecture (confirmed with user)
- **Real hosted app + database**, deployed on the user's **AWS Lightsail** instance (they own the box). Not a static/local tool.
- **Multi-user, team-facing** (cash & funding + finance). Add lightweight **auth** (even a simple login) since it's hosted and shared — this is the single source of truth, so protect writes.
- **Data ingestion is auto-pull from Omie (ERP) + Shopify** — NOT primarily manual entry. See "Data ingestion" below. Keep manual create/edit as a fallback and for funder params.

### Build approach (not prescriptive — user owns the box)
- Full-stack app: backend (Node/Express or Python/FastAPI) + **Postgres** (multi-user + integrations → go Postgres, not SQLite). Front-end lightweight — "functional, nothing fancy" per the user.
- Data model: `funders`, `deliveries`, `installments` (generated from deliveries; regenerate on delivery edit), `operations`, plus ingestion staging tables and a `users` table. Keep due-date + net-cost logic **server-side** so the spreadsheet's formula bugs can't recur.
- Seed with the data above (or backfill it via the first Omie/Shopify pull, then reconcile). Everything the user marked interactive stays editable: delivery date, discount date, funder, and all funder params.
- Deploy target is their Lightsail instance — confirm OS, existing stack, reverse proxy (nginx?), TLS, and subdomain before deploying.

### Data ingestion — auto-pull (major requirement; phase it)
- **Sources:** **Omie** (ERP — clientes, pedidos, financeiro/contas-a-receber) and **Shopify** (Admin API). GE Beauty already has an integrations layer for both (Omie JSON-RPC; Shopify Admin GraphQL) — **reuse existing credentials, adapters, and patterns rather than building from scratch.** This is squarely an **integrations-engineer** job (there is a house `integrations-engineer` skill/agent covering exactly Omie + Shopify + credential lifecycle).
- The receivables that feed this simulator (B2B deliveries to UAUBox/B4A) most likely live in **Omie contas-a-receber / pedidos**, not Shopify (Shopify is the D2C storefront). Confirm where the B2B delivery + installment data actually originates before wiring — do not assume.
- **Phasing (strongly recommended):** Phase 1 = app + allocation engine on seeded/manual data (ship this first, it's the value). Phase 2 = Omie/Shopify auto-pull mapping into `deliveries`/`installments` with a reconciliation step (matched vs manual). Don't let the integration block the core tool.
- Mapping caution: the B4A receivable is the **ajuda de custo**, not the PDV, and UAUBox's Booster Definição has a revised PO not yet formalized as an aditivo — auto-pull must not silently overwrite these hand-reconciled facts. Stage + reconcile, don't blind-upsert.

## What's pending / open items (carry forward — all flagged to the user)
- **Itaú R$ 70k reconciliation gap:** dictated line usage R$ 255.555 vs R$ 185.555 in the one logged op. Unexplained — likely an undocumented drawdown. Model `operations` so this can be reconciled.
- **Ghia costs unconfirmed:** IOF (assumed 0 as FIDC true-sale), tarifas (not quantified), CET (not disclosed). Cost output for Ghia is an ESTIMATE until confirmed. Also confirm annual-rate basis and whether a personal guarantor (Camila Coutinho Valença) applies.
- **B4A delivery day-of-month assumed:** Anexo A gives only the month (08/08/10/11/12 2026). Simulator used day 05 as placeholder. Make delivery date a real input; get actual dates.
- **Itaú teto R$ 650.000 dictated, unverified.**
- **Dez/26 cutoff** is a user planning rule, not contractual — make it a toggle/param, not hardcoded.
- UAUBox past campaigns marked "received" from due dates, not confirmed settlements.
- **Ingestion source-of-truth unconfirmed:** verify whether B2B delivery/installment data lives in Omie (likely) vs Shopify before building the pull. Confirm existing GE integration credentials/patterns are reusable.

## Verification / acceptance
- Recreate the B4A agenda: 5 deliveries × 4x with Terça 3-25 must sum to R$ 840.000 and reproduce the monthly stream (Set 52.5k, Out 52.5k, Nov 97.5k, Dez 150k, Jan 157.5k, Fev 157.5k, Mar 112.5k, Abr 60k) when delivered on the assumed days.
- UAUBox Booster Definição (Corrido, 5×115.699 from 2026-10-15) → due 14/11, 14/12, 13/01, 12/02, 14/03.
- Net-cost formula reconciles op 1359525753 to R$ 168.087,70.
- Allocation engine refuses to route >R$250k of one sacado to Ghia, or any installment whose tenor exceeds the funder limit.

## Reference artifacts
- `claude/invoice-discounting-register.md` — narrative register (funders, deliveries, exposure, open items) in the `cash-funding` Claude project.
- `Simulador_Antecipacao_GE.xlsx` — the working spreadsheet model with the exact formulas (Corrido + Terça snapping + net calc). Ask the user for it; mirror its logic, improve the allocation UX.
