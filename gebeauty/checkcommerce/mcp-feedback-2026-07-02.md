# Feedback do MCP Check Commerce — sessão de teste 02/07/2026

Loja: **GE Beauty** (handle `ge-beauty`)

Resumo de uma sessão de uso real do MCP: abertura de um chamado de PDP e tentativa de revisar/validar uma história em homologação. O MCP hoje **cria** registros muito bem, mas quase não permite **ler de volta** nem **editar**. Segue o detalhe para mapeamento.

## O que tentei fazer e não consegui

| # | O que tentei | Por que travou |
|---|--------------|----------------|
| 1 | Adicionar uma nota ("os erros de limite geram scroll infinito, prejudicando a UX") ao bug GB-989 já criado | `create_bug` não tem update/edit. Bug é create-only. |
| 2 | Cancelar / retirar um bug criado por engano | Não há `cancel`/`delete`. Refazer geraria duplicata. |
| 3 | Abrir o detalhe da história GB-747 | `get_support_ticket` resolve apenas bugs; `get_evolution_item` apenas evoluções. Uma História retorna "não encontrado" nos dois. Só sobra a linha de título do `get_kanban_status`. |
| 4 | Ler a thread de comentários de qualquer card | Não existe `get_comments`/histórico/atividade para nenhum tipo de registro. |
| 5 | Postar um comentário em um card | O único campo `comment` é write-only em `approve_item`/`reject_item` (transição de homologação), não um "comentar no card X". |

## Como contornei

- A validação dos 8 itens da GB-747 foi feita **manualmente na sessão**, item a item ("foi corrigido? sim / parcial / não"), porque o detalhe do card não é legível pelo MCP.
- Todos os comentários (o adendo na GB-989 e o retorno de validação da GB-747) foram redigidos e entregues em texto para colar **à mão** no Service Desk / Jira.

## Pedidos de feature (ordem de prioridade)

1. `update_bug` (emendar/editar descrição) + `add_comment(key, body)` + `get_comments(key)`. Fecha o ciclo de emendar e ler.
2. `get_card(key)` / `get_story`. Detalhe de histórias (campos, critérios de aceite, anexos).
3. `cancel_bug` / transição para "Cancelado".
4. **Payload estruturado de "mudanças a validar" por card** (exemplo abaixo), para um cliente rodar o loop de validação automaticamente em vez de item a item na mão.

## Funcionou bem nesta sessão

`create_bug` (rápido, retorna a key e sincroniza com o Jira), `get_active_store`, `get_kanban_status`, `list_pending_approvals`, `list_decisions`.

## Exemplo do pedido 4 — JSON de "mudanças a validar"

Ideia: o MCP expõe, por card, um array das mudanças esperadas. O cliente renderiza cada uma como uma pergunta de validação e devolve o veredito por item. Modelado sobre o que validamos hoje na GB-747:

```json
{
  "card": "GB-747",
  "title": "Desenvolvimento ajustes PDP",
  "changes": [
    {
      "id": 1,
      "section": "Barra fixa de topo",
      "spec": "Barra no topo da página, anexada à barra fixa do menu; título do produto -2pt; avaliações (estrelas/nota/nº) -4pt vs. novo título; alinhado à esquerda; aparece no scroll junto com a redução do logo",
      "status": "nao_corrigido"
    },
    {
      "id": 2,
      "section": "Breadcrumb",
      "spec": "Restaurar acima do título; deve viver dentro da barra de topo (item 1), no topo da página",
      "status": "nao_corrigido"
    },
    {
      "id": 3,
      "section": "Descrição",
      "spec": "Fonte da descrição em destaque -1pt; padding entre seções minimizado",
      "status": "corrigido"
    },
    {
      "id": 4,
      "section": "Disponibilidade de retirada",
      "spec": "Mover do bloco 'Buy buttons' para o final do card, abaixo do cálculo de frete",
      "status": "nao_corrigido"
    },
    {
      "id": 5,
      "section": "Ícones transacionais 'Benefícios GE'",
      "spec": "Títulos abaixo dos ícones; com 4 ícones, exibir 3,5 para induzir scroll horizontal",
      "status": "nao_corrigido"
    },
    {
      "id": 6,
      "section": "Barra fixa promocional + preço e CTA",
      "spec": "CTA 'incluir na rotina'; preço remarcado em negrito; preço à extrema direita junto ao CTA; desktop com barra promocional anexada; bordas do botão de compra a mapear",
      "status": "nao_corrigido"
    },
    {
      "id": 7,
      "section": "Ícones institucionais",
      "spec": "Carrossel exibindo 3,5 ícones para induzir scroll horizontal",
      "status": "nao_corrigido"
    },
    {
      "id": 8,
      "section": "Card 'Product information'",
      "spec": "Retirar tabs (o que é/como usar/resultados), ícones institucionais e ingredientes de dentro do card; devolver para fora, em seções próprias de largura total",
      "status": "nao_corrigido"
    }
  ]
}
```

`status` aceitaria `corrigido | parcial | nao_corrigido`. O cliente escreveria de volta os vereditos e um comentário por item, que é exatamente o loop feito à mão nesta sessão.

## Contexto dos registros citados

- **GB-989** (bug criado nesta sessão): "PDP: seções não respeitam o limite de itens e ajustes na seção 'Ingredientes com foto'", prioridade Alta. Falta o adendo do scroll infinito (não foi possível emendar).
- **GB-747** (história em homologação): "Desenvolvimento ajustes PDP". Validação: 7 de 8 itens pendentes; apenas o item 3 (Descrição) entregue.
