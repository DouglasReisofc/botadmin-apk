# Mapa de logicas Typebot para Fluxos BotAdmin

Pesquisa feita em 2026-05-15 na documentacao oficial do Typebot:

- https://docs.typebot.com/llms.txt
- https://docs.typebot.com/editor/blocks/overview
- https://docs.typebot.com/editor/blocks/logic/set-variable
- https://docs.typebot.com/editor/blocks/logic/condition
- https://docs.typebot.com/editor/blocks/integrations/http-request
- https://docs.typebot.com/editor/blocks/inputs/buttons

Prints capturados:

- `docs/typebot-blocks-overview.png`
- `docs/typebot-logic-condition.png`
- `docs/typebot-logic-set-variable.png`
- `docs/typebot-integration-http-request.png`
- `docs/typebot-input-buttons.png`

## Estado atual do BotAdmin

Hoje o schema de fluxos aceita apenas:

- `trigger`
- `text`
- `media`
- `buttons`
- `delay`
- `condition`

A execucao atual cobre envio de texto, midia, botoes, espera curta e condicao simples. Ainda nao existe sessao persistente de conversa para aguardar resposta do usuario, salvar variaveis por contato, fazer request HTTP, pausar por webhook, pular para outro fluxo, retorno de subfluxo, AB test, input real ou historico de resultado.

## Categorias oficiais do Typebot

O Typebot organiza blocos em quatro familias:

- Bubbles: mensagens exibidas ao usuario.
- Inputs: perguntas que param a conversa e aguardam resposta do usuario.
- Logic: operacoes internas de fluxo que nao aparecem para o usuario.
- Integrations: chamadas para servicos externos.

## Bubbles

| Typebot | O que faz | Status no BotAdmin |
| --- | --- | --- |
| Text | Exibe balao de texto com variaveis `{{...}}`. | Parcial. Temos texto simples e template basico. |
| Image | Envia imagem. | Parcial. Temos midia. |
| Video | Envia video. | Parcial. Temos midia. |
| Audio | Envia audio. | Parcial. Temos midia, mas precisa UI dedicada. |
| Embed | Exibe conteudo incorporado no web chat. | Nao prioritario para WhatsApp; pode virar link/card futuramente. |

## Inputs

| Typebot | O que faz | Como adaptar para WhatsApp |
| --- | --- | --- |
| Text input | Aguarda texto livre e salva em variavel. | Criar estado de sessao por contato/grupo e proximo no. |
| Number | Aguarda numero e valida. | Input com validacao numerica e mensagem de erro. |
| Email | Aguarda e valida email. | Regex de email + salvar variavel. |
| Website | Aguarda URL. | Validacao de URL. |
| Date | Aguarda data. | Parser BR/ISO e normalizacao. |
| Time | Aguarda horario. | Parser HH:mm. |
| Phone | Aguarda telefone. | Validacao e normalizacao de telefone. |
| Buttons | Opcoes de resposta, escolha unica/multipla, itens dinamicos e valor interno. | Ja existe parcial; precisa salvar resposta, condicao por item e limite WhatsApp. |
| Picture choice | Escolha por imagens. | Adaptar com lista/midia + botoes ou mensagens sequenciais. |
| Payment | Pagamento. | Integrar com gateway atual de Pix usado pelo BotAdmin. |
| Rating | Nota/avaliacao. | Botoes 1-5 ou 1-10 e salvar variavel. |
| File upload | Receber arquivo do usuario. | Capturar midia recebida no WhatsApp e salvar URL/arquivo em variavel. |
| Cards | Carrossel com imagem, titulo, descricao e botoes. | Adaptar para mensagens sequenciais ou lista; depende do limite da API WhatsApp. |

## Logic

| Typebot | O que faz | Implementacao recomendada |
| --- | --- | --- |
| Set variable | Define variavel por valor custom, expressao, vazio, append, ambiente, data, ID, contato, telefone etc. | Criar node `setVariable` com operacoes `set`, `clear`, `append`, `preset`; persistir por sessao e opcionalmente em resultados. |
| Condition | Divide o fluxo por comparacoes com AND/OR. | Expandir condicao atual para multiplas regras e operadores. |
| Redirect | Redireciona usuario para URL. | Em WhatsApp, enviar botao/link ou mensagem com URL. |
| Script block | Executa JavaScript e pode usar `setVariable`. | Implementar com muito cuidado; ideal iniciar com expressoes seguras e bloquear APIs perigosas. |
| Link to typebot | Entra em outro fluxo e compartilha variaveis. | Implementar como `linkFlow`, chamando outro fluxo do BotAdmin. |
| Wait | Pausa por segundos; tambem pode pausar fluxo. | Ja existe delay simples; ampliar para pausa de sessao. |
| Jump | Pula para bloco especifico. | Implementar node `jump` ou aresta direta com destino. |
| Return | Volta de um pulo/subfluxo temporario. | Exige pilha de execucao na sessao. |
| AB Test | Divide aleatoriamente em caminhos. | Node `abTest` com peso/percentual por saida. |
| Webhook | Pausa ate URL autenticada receber callback externo. | Criar endpoint de callback e salvar `waiting_webhook` na sessao. |

### Operadores de condicao do Typebot

O Typebot lista estes operadores:

- Equal to
- Not equal
- Contains
- Does not contain
- Greater than
- Less than
- Is set
- Is empty
- Starts with
- Ends with
- Matches regex
- Does not match regex

No BotAdmin hoje existem apenas: `equals`, `contains`, `starts_with`, `ends_with`, `is_set`, `is_empty`.

## Integrations

| Typebot | O que faz | Prioridade BotAdmin |
| --- | --- | --- |
| HTTP Request | Chama API externa, envia dados, busca retorno e salva partes da resposta em variaveis. | Alta. Essencial para automacoes tipo n8n. |
| Google Sheets | Le/escreve planilhas. | Media; pode ser substituido inicialmente por HTTP Request. |
| Send email | Dispara email. | Media. |
| Zapier | Aciona Zapier. | Baixa; HTTP Request cobre a maioria. |
| Make.com | Aciona Make. | Baixa; HTTP Request cobre a maioria. |
| Pabbly Connect | Aciona Pabbly. | Baixa; HTTP Request cobre a maioria. |
| Chatwoot | Integra atendimento humano. | Baixa/media. |
| Meta pixel | Evento de conversao. | Baixa no WhatsApp. |
| Google Analytics | Evento de analytics. | Baixa no WhatsApp. |
| OpenAI | Gera resposta com IA. | Alta para evolucao futura. |
| Mistral AI | IA. | Baixa se OpenAI/local for padrao. |
| Anthropic | IA. | Baixa se OpenAI/local for padrao. |
| Dify.AI | IA/agent externo. | Media via HTTP Request. |
| ElevenLabs | Audio/voz. | Media se voltar geracao de audio. |
| NocoDB | Banco/tabela externa. | Baixa/media. |
| PostHog | Analytics. | Baixa. |
| Segment | Analytics. | Baixa. |
| Zendesk | Suporte. | Baixa/media. |
| Blink | Pagamento/crypto conforme integracao. | Baixa sem uso atual. |
| Gmail | Email via Gmail. | Baixa/media. |

## HTTP Request necessario

Campos minimos para o node:

- Metodo: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- URL com variaveis.
- Headers dinamicos.
- Query params dinamicos.
- Body: JSON, texto cru ou form.
- Timeout.
- Modo de erro: parar fluxo, seguir fallback ou salvar erro.
- Mapeamento de resposta:
  - salvar status code.
  - salvar body completo.
  - salvar campo por caminho JSON, ex.: `data.name`.
  - salvar lista.
- Botao de teste no painel com valores ficticios das variaveis.
- Logs por execucao para diagnostico.

## Variaveis e resultados

Modelo recomendado:

- Variaveis de sistema:
  - `usuario`
  - `telefone`
  - `grupo`
  - `grupo_id`
  - `instancia`
  - `mensagem`
  - `args`
  - `comando`
  - `data_atual`
  - `hora_atual`
  - `ambiente` = `whatsapp`
- Variaveis de fluxo:
  - criadas por inputs, HTTP, script e set variable.
- Persistencia:
  - variavel temporaria por sessao.
  - variavel salva em resultado/historico.
  - variavel persistente por usuario no grupo, quando marcada.

## Banco de dados recomendado

Para nao transformar `bot_flows.nodes_json` em um caos, a primeira etapa pode continuar em JSON, mas precisa de tabelas de runtime:

- `bot_flow_sessions`
  - `id`
  - `flow_id`
  - `user_id`
  - `instance_id`
  - `group_id`
  - `chat_id`
  - `participant_id`
  - `status`
  - `current_node_id`
  - `return_stack_json`
  - `variables_json`
  - `last_interaction_at`
  - `expires_at`
- `bot_flow_results`
  - `id`
  - `flow_id`
  - `session_id`
  - `variables_json`
  - `transcript_json`
  - `created_at`
- `bot_flow_logs`
  - `id`
  - `flow_id`
  - `session_id`
  - `node_id`
  - `level`
  - `message`
  - `payload_json`
  - `created_at`
- `bot_flow_webhook_waits`
  - `id`
  - `flow_id`
  - `session_id`
  - `node_id`
  - `token_hash`
  - `expires_at`
  - `consumed_at`

## Ordem profissional de implementacao

1. Sessao de fluxo e variaveis persistentes.
2. Inputs basicos: texto, numero, email, telefone, data, horario e arquivo.
3. Set variable completo sem JavaScript livre inicialmente.
4. Condicao avancada com AND/OR, not, maior/menor e regex.
5. HTTP Request com mapeamento de resposta e logs.
6. Jump, Return e Link Flow.
7. Webhook pausado com endpoint de callback.
8. AB Test com pesos.
9. Blocos de IA/pagamento/cartoes depois que a base estiver estavel.

## Observacao importante para WhatsApp

Nem tudo do Typebot web deve ser copiado literalmente. No BotAdmin, a UI pode parecer Typebot, mas a execucao precisa respeitar as regras reais do WhatsApp e da API local:

- Mensagens com botoes devem usar o formato que ja testamos como funcional.
- Uma mensagem nao deve misturar tipos de botoes que a API nao suporta.
- Inputs precisam pausar o fluxo e aguardar a proxima mensagem do mesmo usuario.
- Midias devem ser arquivo/base64/URL resolvida, nao apenas link visual.
- Fluxos de grupo precisam diferenciar autor, grupo e instancia.
