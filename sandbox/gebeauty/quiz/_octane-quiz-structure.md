# Octane AI — GE Beauty Quiz Structure
> Reference map for updating quiz content inside Octane AI.
> Cross-reference prompts with `geb_smart-properties_v251216.md` for the full prompt text.

---

## 1. Quiz Settings

| Field | Value |
|-------|-------|
| **Quiz Name** | {active}_25.12.16_smart-prompts-v4 |
| **Quiz Engine** | AI Quiz (CORE-1) |
| **Quiz ID** | iqVDfs8iAzxgnlQw |
| **Octane URL** | app.octaneai.com/dashboard/b/abyasnknwj7yxqbu/quiz/iqVDfs8iAzxgnlQw/edit |
| **Published URL** | |
| **Embed Method** | |

---

## 2. Question Pages

> Fill in page titles, answer options, and variable refs from the Octane editor.

| # | Page Title | Question Type | Answer Options | Variable Ref | Maps to |
|---|-----------|---------------|----------------|-------------|---------|
| 1 | | | `liso`, `ondulado`, `cacheado`, `crespo` | | (Question: tipo de cabelo) |
| 2 | | | `fino`, `médio`, `grosso` | | (Question: espessura) |
| 3 | | | `seco`, `equilibrado`, `oleoso`, `sensível` | | (Question: couro cabeludo) |
| 4 | | | `todos os dias`, `a cada 2 dias`, `entre 2 e 3x/semana`, `1x/semana` | | (Question: frequência lavagem) |
| 5 | | | `alisamento`, `coloração`, `descoloração`, `nenhum` | | (Question: processos químicos) |
| 6 | | | `escova`, `babyliss`, `cachos`, `secador`, `chapinha`, `seco ao natural` | | (Question: finalização) |
| 7 | | | `seco`, `fraco ou quebradiço`, `frizz`, `falta de definição`, `opacos e sem brilho`, `queda`, `oleoso` | | (Question: dor principal) |

### Other Pages

| Page | Type | Position | Details |
|------|------|----------|---------|
| | Opt-in (Email/SMS) | | |
| Telefone | Opt-in? / Question? | Before results | Visible in left panel |
| Cálculo de resultados | Explainer Screen | Before results | Loading/transition screen |

---

## 3. Results Page

> Single results page — no conditional logic.

| Results Page | Description |
|-------------|-------------|
| **Página de resultados** | Single page with all blocks below |

---

## 4. Results Page — Block Layout (PRODUCTION)

> This is the exact block order currently live in Octane.
> Status: **LIVE** = active in production, **NOT DEPLOYED** = designed in smart-properties file but not in Octane.

| Pos | Octane Block Name | Block Type | AI-powered? | Status | Prompt source |
|-----|------------------|-----------|-------------|--------|--------------|
| 1 | Title | Text | No | LIVE | — |
| 2 | **diagnóstico** | Smart Property group | Yes | LIVE | — |
| 2a | ↳ HTML Content | HTML block | Yes | LIVE | Renders `{{diagnostico-capilar}}` |
| 2b | ↳ comece sua rotina | Text | No | LIVE | Static header |
| 2c | ↳ comprar rotina completa | Add All to Cart | No | LIVE | CTA button |
| 3 | **1. limpeza** | Smart Products group | Yes | LIVE | — |
| 3a | ↳ HTML Content | HTML block | No | LIVE | Static section header "limpeza" |
| 3b | ↳ Products | Smart Products | Yes | LIVE | `geb_smart-properties_v251216.md` → [1.a) bases limpeza] · 3,720 chars |
| 4 | **2. tratamento** | Smart Products group | Yes | LIVE | — |
| 4a | ↳ HTML Content | HTML block | No | LIVE | Static section header "tratamento" |
| 4b | ↳ Products | Smart Products | Yes | LIVE | `geb_smart-properties_v251216.md` → [2.a) bases tratamento] · 4,710 chars |
| 5 | **3. finalização** | Smart Products group | Yes | LIVE | — |
| 5a | ↳ HTML Content | HTML block | No | LIVE | Static section header "finalização" |
| 5b | ↳ Products | Smart Products | Yes | LIVE | `geb_smart-properties_v251216.md` → [3.a) bases finalizacao] · 6,528 chars |
| 6 | **4. boosters** | Smart Products group | Yes | LIVE | — |
| 6a | ↳ HTML Content | HTML block | No | LIVE | Static section header "boosters" |
| 6b | ↳ Products | Smart Products | Yes | LIVE — **NEEDS FIX** | `geb_smart-properties_v251216.md` → [4. boosters] · 20,289 chars · **BUG:** contains [3.b) boosters finalizacao] duplicated twice after the consolidated prompt. Remove both duplicates — should only contain [4. boosters]. |
| 7 | **comprar rotina completa** | Content group | No | LIVE | — |
| 7a | ↳ comece agora sua rotina | Text | No | LIVE | Static CTA header |
| 7b | ↳ começar rotina completa agora | Button | No | LIVE | Add All to Cart |
| 8 | **kits com preços especiais** | Content group | No | LIVE | — |
| 8a | ↳ monte seu ritual com preço... | Text | No | LIVE | Static header |
| 8b | ↳ kits com descontos e tudo... | Text | No | LIVE | Static subtitle |
| 9 | **Dynamic products** | Dynamic Filtered | No | LIVE | — |
| 9a | ↳ Products | Dynamic products | No | LIVE | Tag: Kits · Max: 5 · Sort: Best selling · Grouped variants |

---

## 5. Smart Properties (PRODUCTION)

> Only 1 Smart Property is configured and live.

| # | Property Name | `{{variable}}` | Status | Prompt source | Fallback? | Rendered in |
|---|-------------|-----------------|--------|--------------|-----------|-------------|
| 1 | DIAGNOSTICO-CAPILAR | `{{diagnostico-capilar}}` | **LIVE** | `geb_smart-properties_v251216.md` → diagnostico-capilar | Yes | diagnóstico → HTML Content |

### Not deployed (designed in smart-properties file)

> These Smart Properties have full prompts written in `geb_smart-properties_v251216.md` but are **not configured in Octane**.
> They were part of a more detailed per-category approach that was simplified for loading time.

| Property | `{{variable}}` | Category | Why not deployed |
|----------|----------------|----------|-----------------|
| Introdução Geral | `{{intro-geral}}` | Global | Simplified approach |
| Ritual Resumido | `{{ritual-resumido}}` | Global | Simplified approach |
| Intro Limpeza | `{{intro-limpeza}}` | Limpeza | Simplified approach |
| Explicação Bases Limpeza | `{{explicacao-bases-limpeza}}` | Limpeza | Simplified approach |
| Explicação Boosters Limpeza | `{{explicacao-boosters-limpeza}}` | Limpeza | Simplified approach |
| Intro Tratamento | `{{intro-tratamento}}` | Tratamento | Simplified approach |
| Explicação Bases Tratamento | `{{explicacao-bases-tratamento}}` | Tratamento | Simplified approach |
| Explicação Boosters Tratamento | `{{explicacao-boosters-tratamento}}` | Tratamento | Simplified approach |
| Intro Finalização | `{{intro-finalizacao}}` | Finalização | Simplified approach |
| Explicação Bases Finalização | `{{explicacao-bases-finalizacao}}` | Finalização | Simplified approach |
| Explicação Boosters Finalização | `{{explicacao-boosters-finalizacao}}` | Finalização | Simplified approach |
| Explicação Boosters (consolidado) | `{{explicacao-boosters}}` | Boosters | Simplified approach |

---

## 6. Smart Products — Production vs Designed

> The smart-properties file defines **two approaches**. Only the simplified one is live.

### Approach in production (simplified)

4 Smart Products blocks — one per ritual step, with boosters consolidated into a single block:

| Block | Octane label | Prompt from file | Chars | Questions used |
|-------|-------------|-----------------|-------|---------------|
| Limpeza bases | 1. limpeza → Products | [1.a) bases limpeza] | 3,720 | couro cabeludo, freq. lavagem, proc. químicos |
| Tratamento bases | 2. tratamento → Products | [2.a) bases tratamento] | 4,710 | tipo cabelo, espessura, proc. químicos, dor principal |
| Finalização bases | 3. finalização → Products | [3.a) bases finalizacao] | 6,528 | tipo cabelo, finalização, proc. químicos, dor principal |
| Boosters (all steps) | 4. boosters → Products | [4. boosters] | 20,289 | tipo cabelo, proc. químicos, dor principal, finalização, couro cabeludo |

### Approach NOT in production (detailed)

Per-category booster blocks that would split the consolidated block into 3:

| Block | Prompt from file | Status |
|-------|-----------------|--------|
| Limpeza boosters | [1.b) boosters limpeza] | NOT DEPLOYED |
| Tratamento boosters | [2.b) boosters tratamento] | NOT DEPLOYED |
| Finalização boosters | [3.b) boosters finalizacao] | NOT DEPLOYED |

---

## 7. Smart Copy Blocks

> No Smart Copy blocks are configured. All AI-generated text uses Smart Properties inside HTML blocks.

---

## 8. Integration Mapping

> Fill in from Octane → Connect tab.

### Custom Properties (quiz answers)

| Property Name | Source | Integration |
|--------------|--------|-------------|
| Octane: Tipo de Cabelo | (Question: tipo de cabelo) | |
| Octane: Espessura | (Question: espessura) | |
| Octane: Couro Cabeludo | (Question: couro cabeludo) | |
| Octane: Frequência Lavagem | (Question: frequência lavagem) | |
| Octane: Processos Químicos | (Question: processos químicos) | |
| Octane: Finalização | (Question: finalização) | |
| Octane: Dor Principal | (Question: dor principal) | |

### Smart Properties sent to integrations

| Property | Sent to Klaviyo? | Used in flows? | Notes |
|----------|-----------------|---------------|-------|
| DIAGNOSTICO-CAPILAR | | | |

---

## 9. Design & Publishing

| Setting | Value |
|---------|-------|
| **Font** | Italian Plate (visible in HTML CSS) |
| **Primary Color** | |
| **Background** | #ECDED9 (visible in HTML CSS) |
| **Button Color** | Red/dark (from screenshots) |
| **Progress Bar Style** | |
| **Custom CSS** | Yes |
| **Embed Method** | |
| **Page URL** | |
| **A/B Test active?** | |

---

## PENDING UPDATES — File → Octane

> These changes exist in `geb_smart-properties_v251216.md` but have NOT been applied in Octane yet.

| # | Block | What to update | Priority |
|---|-------|---------------|----------|
| 1 | **4. boosters → Products** | Remove duplicated [3.b) boosters finalizacao] (pasted twice after consolidated prompt). Should only contain [4. boosters]. | HIGH — bug fix |
| 2 | **2. tratamento → Products** | Replace entire prompt with file version: adds Máscara Mayday reconstruction section, benefit-only Leave-in Pluma reference, removes active ingredient names | HIGH |
| 3 | **3. finalização → Products** | Update Referência técnica: replace active ingredient names (Allinea, Ômega Plus, Wavemax, ThermoShield, Pantenol) with benefit-only descriptions | MEDIUM |
| 4 | **4. boosters → Products** | Update Referência técnica: remove active ingredient names (Wavemax, Vitamina E, Extrato de Romã) from booster descriptions | MEDIUM |
| 5 | **DIAGNOSTICO-CAPILAR** | Already up to date in Octane | DONE |
| 6 | **1. limpeza → Products** | Already up to date in Octane | DONE |

---

## Quick-reference: How to update a prompt

1. **Find the prompt** in `geb_smart-properties_v251216.md` (search by `{{variable-name}}` or `[block label]`)
2. **Edit the prompt text** in `geb_smart-properties_v251216.md` (source of truth)
3. **Copy the updated prompt** into Octane:
   - Smart Properties → Smart Properties tab → Edit → Instruction field
   - Smart Products → Results page → click Products block → right panel "Instructions for AI"
4. **Update fallback text** if the prompt structure changed significantly
5. **Preview** the quiz in Octane to test

### Octane editor path
```
Quiz Editor → Build tab → Results Page → [click block] → right panel config
```

### Key Octane syntax
| Syntax | Where | Purpose |
|--------|-------|---------|
| `{{propertyName}}` | HTML blocks | Render a Smart Property value |
| `&Question Name` | Smart Product prompts | Reference a quiz question |
| `@Answer` | Smart Product / Smart Copy prompts | Reference a specific answer |
| `@[Display](QuestionID)` | Text/Rich Text on pages | Insert a variable (previous answer) |
