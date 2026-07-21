# Onboarding invitation — new GE Beauty Claude user

The message to send a new teammate once you've (1) invited their email to the GE Beauty
Claude org and (2) invited that same email on the GE Beauty MCP connector. It's the
"type `/setup`" nudge — everything else the `/setup` skill handles.

Connector-first model: teammates do **not** clone the repo. `C:\claude` (Windows) /
`~/claude` (Mac) is just an empty working folder for the Claude Code session; the whole
toolset arrives through the GE Beauty connector.

Replace `[nome]`. Portuguese is the default (GE team); an English version can be added
when needed.

---

## Windows (PT-BR)

> Oi, [nome]! Segue o passo a passo pra instalar o Claude e começar a usar no dia a dia.
>
> **1.** Acesse **claude.ai** e faça login com o e-mail do convite (seu **@gebeauty.com.br**), usando o **login com o Google**. Se pedir pra criar conta, use esse mesmo e-mail.
> **2.** Na primeira vez, o Claude pode oferecer pra **importar seu histórico de outra IA** (tipo ChatGPT). Pode aceitar: ajuda ele a já te conhecer.
> **3.** Baixe o **Claude para Desktop**: https://claude.com/download (Windows ou Mac).
> **4.** No app, abra a aba **Code** e comece uma **sessão nova local**.
> **5.** Ele vai pedir pra selecionar uma pasta. **Crie uma pasta vazia chamada `claude` na raiz do disco C:** (ou seja, `C:\claude`) e selecione ela.
> **6.** Com a sessão aberta, digite: **`/setup`**
> **7.** O próprio Claude te guia pra conectar as ferramentas da GE Beauty, o Canva e o Magnific, e deixar tudo pronto. Leva uns minutos.
>
> Depois disso, é só pedir o que precisar em português normal, tipo *"faça os criativos com esses hooks"*, que ele escolhe a ferramenta certa. Qualquer coisa, me chama!

---

## Mac (PT-BR)

> Oi, [nome]! Segue o passo a passo pra instalar o Claude e começar a usar no dia a dia.
>
> **1.** Acesse **claude.ai** e faça login com o e-mail do convite (seu **@gebeauty.com.br**), usando o **login com o Google**. Se pedir pra criar conta, use esse mesmo e-mail.
> **2.** Na primeira vez, o Claude pode oferecer pra **importar seu histórico de outra IA** (tipo ChatGPT). Pode aceitar: ajuda ele a já te conhecer.
> **3.** Baixe o **Claude para Desktop**: https://claude.com/download
> **4.** No app, abra a aba **Code** e comece uma **sessão nova local**.
> **5.** Ele vai pedir pra selecionar uma pasta. **Crie uma pasta vazia chamada `claude` na sua pasta de usuário (Home)** — ou seja, `~/claude` — e selecione ela.
> **6.** Com a sessão aberta, digite: **`/setup`**
> **7.** O próprio Claude te guia pra conectar as ferramentas da GE Beauty, o Canva e o Magnific, e deixar tudo pronto. Leva uns minutos.
>
> Depois disso, é só pedir o que precisar em português normal, tipo *"faça os criativos com esses hooks"*, que ele escolhe a ferramenta certa. Qualquer coisa, me chama!

---

## Prerequisites (admin, before sending)

- Invite the teammate's email to the **GE Beauty Claude org** (so `/setup` and org
  skills appear on their account).
- Invite that same email on the **GE Beauty MCP connector** (so their Google login is
  accepted at Step 1 / Step 7).
- Have the **shared Canva** and **shared Magnific** GE Beauty logins ready to hand over
  when `/setup` reaches those steps.

## Caveats

- **Mac has no `C:\`** — the Mac version uses `~/claude` (a `claude` folder in Home).
- **Creating a folder at the `C:\` root can require admin** on locked-down corporate
  Windows. On a normal personal machine it's fine; if IT policy blocks it, fall back to
  `C:\Users\<user>\claude`.
- **Download URL** — confirm `https://claude.com/download` resolves to the desktop app
  download before a wide send.
