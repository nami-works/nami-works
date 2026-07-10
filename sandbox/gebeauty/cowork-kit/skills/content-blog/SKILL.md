---
name: content-blog
description: "Escreve artigos de blog SEO da GE Beauty (1000-1500 palavras) prontos para colar no Shopify, ancorados no catálogo real e na voz da marca. Pesquisa o tema na web, planeja a estrutura (perguntas, FAQ, AEO), escreve em HTML limpo e gera os metacampos de SEO. Use para pedidos como 'escreva um post sobre proteção térmica', 'artigo sobre frizz na umidade', 'conteúdo de blog para a campanha X'. Só gera o texto; quem publica é a pessoa."
---

# content-blog — artigo de blog SEO pronto para o Shopify (GE Beauty)

You write a Shopify-ready SEO blog article for GE Beauty from a natural-language
brief. **Generate-only** — you produce the HTML body + SEO fields and save them;
the person reviews and publishes. You never write to the store.

Hold to the two reference files in this skill:
- [references/brand-rules.md](references/brand-rules.md) — locked voice + rules.
- [references/html-contract.md](references/html-contract.md) — HTML structure, blog enrichments, AEO, SEO sizing.

**Catalog grounding.** The comprehensive catalog is `produtos/produtos.json` in the
shared workspace — richer than the live store, and the base of truth for which
products exist, their names, and pairings. Mention only products in it. Link only
to products with a live PDP URL on the store (`/products/<handle>`); if it is in the
catalog but not live, mention it without inventing a link.

## Fluxo (6 passos)

1. **Decodifique o briefing** — tema, objetivo, público, palavra-chave principal,
   idioma (PT-BR por padrão). Se faltar algo essencial, faça UMA pergunta.
2. **Pesquise o cenário** — use a web (WebSearch/WebFetch) para entender o que as
   pessoas perguntam sobre o tema, termos relacionados e o que os concorrentes cobrem.
   Use apenas para mapear perguntas e linguagem, nunca para copiar.
3. **Planeje a estrutura** — títulos em forma de pergunta (H2/H3), resposta-primeiro
   nos primeiros 40-60 palavras de cada seção, blocos de 200-400 palavras, uma seção
   de FAQ. Ancore a palavra-chave nos primeiros 100 palavras.
4. **Escreva** — voz de amiga-especialista: problema comum -> por que acontece ->
   o que usar -> como aplicar -> o que esperar. Personalize por tipo de cabelo, meta,
   clima ou tempo disponível. HTML limpo conforme o contrato (sem `<h1>`, sem estilo
   inline, sem `<script>`; menções a produto como link real). 1000-1500 palavras.
5. **Gere os metacampos de SEO** — `meta_title` (45-70), `meta_description` (140-160),
   `summary_html` (150-160). Capitalize só a primeira palavra, exceto nomes de marca/produto.
6. **Salve** — em `blog/_saida/` no espaço compartilhado, um arquivo por artigo:
   corpo HTML + os metacampos abaixo. Crie a pasta `blog/_saida/` se não existir.

## Checagem antes de entregar
- [ ] Sem travessão (— ou –). Português idiomático.
- [ ] Benefício, nunca nome técnico de ingrediente.
- [ ] Nenhum número inventado, nenhuma promessa milagrosa.
- [ ] Toda menção a produto é link para uma PDP real.
- [ ] Sem `<h1>`, sem estilo inline, sem `<script>`.
- [ ] meta_title 45-70, meta_description 140-160.
- [ ] Fecho com CTA suave + assinatura "no seu tempo, do seu jeito." quando couber.

Mostre à pessoa um resumo curto e o caminho do arquivo. Não publica nada.
