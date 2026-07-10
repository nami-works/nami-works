---
name: b2b-proposta
description: "Generates a client-facing GE Beauty B2B proposal from the Excel simulator (PROPOSTA EM CONSTRUÇÃO). Two modes: full (branded HTML with logo + product images, print to PDF via browser) and lite (direct reportlab PDF, no images). Always reads live data from the Dashboard simulator — Lucas must fill prices in the simulator first. Asks client name and mode before generating."
argument-hint: "[client name]  — e.g. /b2b-proposta \"UAU Box\""
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell, AskUserQuestion
---

# /b2b-proposta

Generates a GE Beauty B2B wholesale proposal from the Excel simulator and the `_b2b_proposta.py` script.

## Steps

### 1. Read simulator data first

Before asking anything, read the Excel file to see if the simulator is filled:

```python
# Quick check — confirm rows 55–69 have SKU+price data
# Excel: G:/Drives compartilhados/GEB_Comercial/Boxes/GEB_B2B_Box_Dashboard.xlsx
# Sheet: Dashboard, cols B=SKU C=Produto E=Volume F=PrecoUnit H=Retail
```

If every row in B55:B69 is empty or all PrecoUnit values are zero, **stop** and tell Lucas:

> "O simulador (PROPOSTA EM CONSTRUÇÃO) está vazio. Preencha o Dashboard nas linhas 55–69 com SKU, volume e preço atacado antes de gerar a proposta."

Do not proceed past this step until at least one valid row exists.

### 2. Identify client

- If Lucas passed a client name as the skill argument, use it as `--client-name`.
- Otherwise, ask via AskUserQuestion:
  > "Nome do cliente para a proposta? (ex: UAUBOX S.A.)"

Ask a second optional field:
  > "Nome de exibição curto? (ex: UAU Box — deixe em branco para usar o nome completo)"

### 3. Ask mode

AskUserQuestion with two options:

> Qual modo de geração?
>
> **full** — HTML com logo GE Beauty + fotos dos produtos. Abre no navegador, Ctrl+P → PDF. Requer internet + API Shopify.
>
> **lite** — PDF direto via reportlab, sem imagens, sem internet. Ideal para iterações rápidas.

### 4. Ask conditions (if not already specified)

Use **two** AskUserQuestion calls (AskUserQuestion supports max 4 questions per call, but these two fields have no safe default and must always be confirmed — batch them together in one call):

**Call 1 — fields with no safe default (always ask):**

| Campo | Opções sugeridas |
|---|---|
| Prazo de pagamento | A combinar / 30 dias / 60 dias / 90 dias |
| Disponibilidade | A combinar / Pronta entrega / Sob encomenda |

Both require Lucas's explicit confirmation for each proposal — never assume.

**Call 2 (optional, only if Lucas wants to override defaults):**

| Campo | Default assumido silenciosamente |
|---|---|
| Frete | CIF para São Paulo |
| Validade da cotação | 7 dias |

Skip call 2 and use the defaults above unless Lucas has already indicated otherwise.

### 5. Run the generator

**Filing rule by file format — applies regardless of mode:**
- `.html` → local only (`sandbox/gebeauty/`), never Drive
- `.pdf` → local + Drive copy (pass `--drive-folder`)

Before any PDF run, resolve the Drive deal folder:

```
G:\Drives compartilhados\GEB_Comercial\
  Boxes\<Partner>\<NNN_mon-YY>\    ← e.g. "Uau Box\002_jul-26"
  Marketplaces\<Partner>\
  Perfumarias\<Partner>\
  Parceiros\<Partner>\
```

```powershell
C:/Python314/python.exe sandbox/gebeauty/scripts/_b2b_proposta.py `
  --mode full `          # or lite
  --client-name "UAUBOX S.A." `
  --client-display "UAU Box" `
  --payment "30 dias" `
  --frete "CIF para São Paulo" `
  --disponibilidade "Pronta entrega" `
  --validade "7 dias" `
  --drive-folder "G:/Drives compartilhados/GEB_Comercial/Boxes/Uau Box/002_jul-26"
```

Omit `--drive-folder` for HTML output (silently ignored for non-PDF anyway). Omit `--out` to auto-derive the filename (`B2B_Proposta_<ClientSlug>_<YYYYMMDD>.<ext>` in `sandbox/gebeauty/`).

### 6. Report result

**For `full` mode (HTML):**

> Proposal written: `sandbox/gebeauty/B2B_Proposta_UAUBox_20260702.html`
>
> ```powershell
> Start-Process "c:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\B2B_Proposta_UAUBox_20260702.html"
> ```
> In browser: **Ctrl+P → A4 Landscape → Minimum margins → Save as PDF**

**For `lite` mode (PDF):**

> Proposal written locally + Drive copy: `G:\...\Uau Box\002_jul-26\B2B_Proposta_UAUBox_20260702.pdf`
>
> ```powershell
> Start-Process "c:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\B2B_Proposta_UAUBox_20260702.pdf"
> ```

### 7. Do NOT open the file automatically

Never call `Start-Process` yourself. Always present it as a code block for Lucas to copy and run.

## Notes

- **Data source**: The script reads from the Excel simulator, not from any hardcoded list. If prices changed in the Excel, re-run the skill.
- **Retail column**: column H in the simulator is the retail (varejo) price. The script derives Desc. s/Tabela as `round((retail - preco_atacado) / retail * 100)%`.
- **Images in full mode**: Fetches product images via Shopify GraphQL (`productByHandle`) using `SHOPIFY_ADMIN_ACCESS_TOKEN` from `sandbox/gebeauty/.env`. If the token is missing, the table still renders — just without thumbnails.
- **Lite mode dependencies**: requires `reportlab`. If missing: `C:/Python314/python.exe -m pip install reportlab`.
- **Full mode dependencies**: requires `openpyxl` and `Pillow`. If missing: `C:/Python314/python.exe -m pip install openpyxl Pillow`.
