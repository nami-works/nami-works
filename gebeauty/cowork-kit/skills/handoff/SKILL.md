---
name: handoff
description: "Cria um documento de passagem de bastão (handoff) do trabalho feito no Cowork: objetivo, o que foi feito, decisões e o porquê, pendências, próximos passos e onde estão os arquivos. Use para passar uma tarefa a um colega ou para você mesmo retomar depois. Pedidos como 'faz o handoff disso', 'documenta onde paramos', 'passa essa tarefa pra Fulano'. Salva na pasta compartilhada e nunca envia nada para fora."
---

# handoff — passagem de bastão do trabalho (GE Beauty)

You capture the current work so a colleague (or the same person later) can pick it
up without re-asking. You read the current Cowork conversation and the relevant
files in the shared workspace, then write a clean handoff document. You **only
write a file** — you never email, message, or notify anyone.

## O que capturar

Reconstrua, a partir da conversa atual e dos arquivos relevantes na pasta de
trabalho, as seguintes seções (em português, claras e específicas):

1. **Objetivo** — o que essa tarefa estava tentando resolver, em 1-2 linhas.
2. **O que foi feito** — itens concretos, específicos o bastante para o próximo não
   precisar reler tudo. Cite arquivos pelo nome quando fizer sentido.
3. **Decisões tomadas (e o porquê)** — as escolhas que seriam questionadas de novo
   se ninguém registrasse o motivo. Inclua a razão, não só a decisão.
4. **Pendências** — o que ficou aberto ou pela metade. Seja específico sobre o que falta.
5. **Próximos passos** — em ordem de prioridade. Se há dono claro, diga quem.
6. **Bloqueios** — o que está travando e o que/quem é preciso para destravar (se houver).
7. **Onde estão os arquivos** — caminhos na pasta compartilhada (entradas, saídas, rascunhos).

Se algo essencial não estiver claro na conversa, faça **uma** pergunta focada à
pessoa antes de escrever, em vez de inventar.

## Como escrever

- Escreva o documento na pasta `handoffs/` do espaço de trabalho compartilhado
  (crie a pasta se não existir).
- Nome do arquivo: `handoff-<tema-curto>-<AAAA-MM-DD>.md` (tema em kebab-case).
- Use títulos `##` por seção, listas curtas, frases diretas. Dá para ler em segundos.
- Sem travessão (—). Português idiomático.

## Depois de salvar

Mostre à pessoa um resumo de 3-4 linhas (objetivo + principais pendências +
próximo passo) e diga o caminho do arquivo. Não envie, não notifique, não
compartilhe por nenhum canal — quem repassa o handoff é a pessoa.

## Modelo

```markdown
# Handoff — <tema> — <AAAA-MM-DD>

## Objetivo
...

## O que foi feito
- ...

## Decisões tomadas (e o porquê)
- <decisão> — porque <motivo>

## Pendências
- ...

## Próximos passos
1. <passo> (dono: <quem>, se houver)

## Bloqueios
- <bloqueio> — precisa de <o quê / quem>   (ou: "nenhum")

## Onde estão os arquivos
- entrada: <caminho>
- saída/rascunho: <caminho>
```
