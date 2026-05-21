# Omnify — Resubmission cover note (2026-05-17)

For Partner Dashboard → Omnify app → resubmit flow. Paste into the "Notes for the reviewer" / re-review-request field.

---

## English (primary)

Thank you for the detailed feedback and the screencast on rejection 2.1.1.

We confirmed and fixed the root cause. The embedded app was loading with the wrong app's API credentials on the focused-Omnify container (`omnify.cpg-labs.io`). Shopify's id_tokens were being signed with the correct Omnify client (`68903b97…a3e9a`), but the container env had a stale `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` pair from a previous internal app. App Bridge initialized with the mismatched API key, Polaris web components never became defined in the iframe, and the page body rendered blank exactly as your screencast showed.

What we changed:
1. Swapped `/etc/cpg-labs/omnify.env` on production to the credentials matching client_id `68903b9706c70055a4410acce22a3e9a` (the Omnify app in the Partner Dashboard).
2. Rotated the Omnify client secret in the Partner Dashboard and revoked the previous one so Shopify only signs id_tokens with the new secret.
3. Force-recreated the production container so the new env values were loaded (a plain `docker restart` does not re-read `env_file`).
4. Verified end-to-end on a fresh test store install on `ge-beauty-test.myshopify.com`: home page renders, sub-nav appears under "Apps > Omnify", the app responds to navigation cleanly.
5. Removed the Affiliates surface from the focused-Omnify app so the listing scope matches what we want to launch (delivery + retail analytics).

For your re-review:
- Test store: please use any clean development store. The app installs cleanly and renders the home page (setup guide + jump cards + footer) on a fresh install.
- All five mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`, `app/scopes_update`, `app/uninstalled`) are declared in `shopify.app.omnify.toml` and respond 200 on valid HMAC, 401 on invalid HMAC.
- App Bridge is loaded from the official Shopify CDN (`https://cdn.shopify.com/shopifycloud/app-bridge.js`) via `<AppProvider embedded apiKey={apiKey}>`.
- The app uses Shopify session tokens exclusively (no third-party cookies, no localStorage for auth) and the Shopify Admin GraphQL API only (no REST).

We're happy to provide any additional information or a fresh screencast if helpful.

---

## Português (mesmo conteúdo, caso útil)

Obrigado pelo feedback detalhado e pelo screencast da rejeição 2.1.1.

Confirmamos e corrigimos a causa raiz. O app embedded carregava com as credenciais de API de outro app no container do Omnify focado (`omnify.cpg-labs.io`). Os id_tokens da Shopify eram assinados com o client correto do Omnify (`68903b97…a3e9a`), mas o env do container tinha um par `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` antigo de um app interno anterior. O App Bridge inicializava com a API key incorreta, os componentes web Polaris nunca eram definidos no iframe, e o corpo da página renderizava em branco exatamente como mostrado no seu screencast.

O que mudamos:
1. Substituímos `/etc/cpg-labs/omnify.env` em produção pelas credenciais correspondentes ao client_id `68903b9706c70055a4410acce22a3e9a`.
2. Rotacionamos o client secret do Omnify no Partner Dashboard e revogamos o anterior.
3. Recriamos o container de produção para carregar os novos valores de env.
4. Verificamos ponta-a-ponta em uma instalação fresh no test store `ge-beauty-test.myshopify.com`.
5. Removemos a superfície de Afiliados do app Omnify focado para alinhar o escopo do listing com o lançamento planejado (delivery + retail analytics).

Para a re-revisão:
- Test store: qualquer development store funciona. O app instala limpo e renderiza a home (guia de setup + cards + footer) em uma instalação fresh.
- Todos os cinco webhooks obrigatórios estão declarados em `shopify.app.omnify.toml`.
- App Bridge é carregado do CDN oficial da Shopify.
- O app usa apenas session tokens da Shopify e a Admin GraphQL API.

Disponíveis para qualquer informação adicional ou um novo screencast se útil.
