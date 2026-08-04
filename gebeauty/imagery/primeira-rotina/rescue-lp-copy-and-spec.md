# Rescue LP — "Oi, Sumida" — copy + build spec (para aprovação)

> **Status: DRAFT-for-approval.** Nada publicado, nada enviado, nenhuma escrita na loja.
> Irmã da LP de aquisição `lp-n4ga7384b3y3` (template `lp-acquisition`). Mesma oferta e mesmo
> mecanismo R$95; **público e enquadramento diferentes** (win-back de cliente que já comprou 1x).
> Mockup visual: `rescue-lp-preview.html` (e-mail Klaviyo → LP, lado a lado).

## Público-alvo (a diferença que define tudo)
Clientes que compraram **exatamente uma vez** e **nunca levaram um hero** (001 shampoo / 002 máscara /
008 shampoo a seco) — a cohort de resgate do estudo (`docs/retention-hero-products-study.md`): 19.206
compradores únicos, ~17.130 após recência. Concentrados nos anti-heroes (primer cachos 101, booster
definição 021, melon mist 024). Enquadramento = **reencontro/saudade**, NÃO "primeira compra".

## A oferta (idêntica à aquisição — travada)
Leve **shampoo sem sulfato** (001, pago R$95) + **máscara condicionadora** (002, grátis), tamanho cheio,
e escolha o **terceiro item de presente**: **leave-in com proteção térmica travel** (011, vale R$47)
**ou** **shampoo a seco** full (008, vale R$69). **Os três por R$95 + frete grátis.** Riscado ("de") =
**R$190** (a dupla full-size), não a soma dos três (evita leitura de queima).

---

## COPY (por seção)

**HERO**
- eyebrow: `que saudade, sumida`
- h1: `bora retomar sua rotina por` **R$95**`?` (R$95 em vermelho GE)
- sub: `faz tempo que seu estoquinho não renova. leva o shampoo, a máscara vem junto e você ainda escolhe um terceiro item de presente. o ritual completo, montado de uma vez.`
- CTA: `quero agora` · sub `e escolher meu presente` (**casa com o CTA do e-mail**)
- chips: `vegano` · `sem sulfato` · `cruelty-free`

**MECHANIC BANNER (Lucas-locked, igual à aquisição)**
- `compre shampoo e ganhe máscara` / `+ leave-in mini ou shampoo a seco` / `os três por R$95 · frete grátis`

**WELCOME BACK (nova, exclusiva do rescue)**
- h2: `você já provou. agora vem o que vira hábito.`
- lead: `a rotina de lavagem completa é o que a gente mais vê a cliente adotar de vez. essa oferta é pra colocar ela no seu dia a dia, sem peso no bolso.`

**COMO FUNCIONA** — 3 passos (igual à aquisição): leve o shampoo / escolha o presente / receba em casa.

**ESCOLHA SEU PRESENTE** — chooser: Leave-in com Proteção Térmica (mini, vale R$47) · Shampoo a Seco (vale R$69).

**POR QUE ESSA ROTINA** — 3 cards (shampoo sem sulfato / máscara condicionadora / finalização à escolha).

**SOCIAL PROOF** — Loox real (ligar antes de publicar; sem número inventado).

**CLOSE**
- h2: `sua rotina te espera` · lead `a base da sua rotina, o presente por nossa conta.`
- price: `os três por R$95 · frete grátis` · CTA `quero agora` · sig `no seu tempo, do seu jeito.`

### Message-match e-mail ↔ LP (a "conexão clara" pedida)
| E-mail "Oi, Sumida" | Eco na LP |
|---|---|
| "Oi, Sumida!" / "amizade sincera" | eyebrow `que saudade, sumida` + tom de reencontro |
| "Faz tempo que você não renova seu estoquinho" | sub do hero repete `faz tempo que seu estoquinho não renova` |
| "O ritual completo por apenas R$95 + Frete Grátis" | hero h1 + banner + close, R$95 e frete grátis em todos |
| CTA "quero agora" | CTA do hero e do close = `quero agora` (verbatim) |

---

## BUILD SPEC (executar só após aprovação — envolve escrita na loja, gated no Lucas)

**1. Página** — duplicar a página de aquisição → nova página rescue, mesmo template `lp-acquisition`.
Handle unlisted (slug obscuro, sem link de nav), publicada. Copy rescue via page-metafields; se hero/eyebrow/
welcome estiverem hardcoded no template, adicionar binding por page-metafield (1 edit) ou um bloco condicional
gated por metafield `rescue_mode` (bool) — espelha o padrão `gift_mode`. Owner: design-engineer/integrations.

**2. Cupom rescue (separado — decisão Lucas 2a)** — nova família `RESGATE95` (checar colisão em
`discounts.out.json`). **NÃO pode ser new-customer-gated** (o público JÁ comprou 1x); once-per-customer;
combina com o free-ship Function. Aplicado via URL no CTA do e-mail (padrão `/discount/<code>?redirect=...`).

**3. Mecânica R$95 — VERIFICAR (crítico):** a aquisição zera para R$95 via Function de carrinho + free-ship
Function sobre os bundle products A `10212940448064` / B `10212940120384`. **Confirmar que essas Functions
NÃO são new-customer-gated** e disparam para cliente existente nos mesmos bundle GIDs. Se forem, criar caminho
rescue. A LP rescue aponta para os **mesmos variant GIDs** (leave-in `52863869157696` / seco `52863869190464`),
então se a Function keyar nos bundles, o R$95 vale automaticamente. Owner: integrations-engineer.

**4. Cohort / tags (isolamento de medição, guardrail 6):** order-tag `cohort-wash-rotina-rsg`, customer-tag
`wash-rotina-rsg` (tagsAdd, nunca sobrescrever). Excluído dos KPIs blended; julgado em 2ª-compra, não margem
de 1º pedido — mesma barra da aquisição (sucesso ≥35% recompra em d75 / kill ≤25%). Separa rescue de aquisição
na leitura.

**5. Wiring do e-mail (Klaviyo) — a conexão técnica:**
```
https://www.gebeauty.com.br/discount/RESGATE95?redirect=%2Fpages%2F<rescue-slug>%3Futm_source%3Dklaviyo%26utm_medium%3Demail%26utm_campaign%3Dwash-rotina-rsg%26utm_content%3Doi-sumida
```
UTMs percent-encoded DENTRO do redirect (senão o Shopify os perde no 302). `utm_campaign` contém `rsg` → o JS
da LP já carimba `offer_arm=rescue` no atributo de carrinho (verificado no preview). Bloco de produtos navegados
+ popup Klaviyo = **fase posterior** (Lucas: "adicionamos depois").

**6. Return hook:** já coberto pelas estratégias de upsell existentes (Lucas) — **não** construir na LP.

---

## FLAGS PARA O LUCAS
1. **"Leave-In Clássico" (e-mail) × Leave-in com Proteção Térmica travel (011, oferta real).** A LP usa o SKU
   real (011, o mini de proteção térmica). Ou alinhamos a palavra no e-mail ("Leave-in mini"), ou você confirma
   que o presente deveria ser um "Leave-In Clássico" full-size diferente — o que mudaria a economia da oferta.
2. **Seção "welcome back"** é a única peça de copy nova vs. a LP de aquisição — confirmar o texto.
3. **Reuso do template `lp-acquisition`** vs. fork dedicado: recomendo reuso (page-metafields + `rescue_mode`),
   zero fragmentação. Confirmar antes do build.
