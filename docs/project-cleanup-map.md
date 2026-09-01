# Mapa de organizacao do projeto

Data da revisao: 2026-05-12.

Este documento registra a organizacao atual do BotAdmin depois da limpeza estrutural. O objetivo e manter o repositorio com nomes oficiais, rotas ativas e integrações documentadas.

## Removido

Itens de inventario, backup ou referencia antiga sem import ativo no app atual:

- `lib/bot-commands/cases.ts`
- `lib/bot-commands/missing-cases.txt`
- `lib/bot-commands/cases.ts.bak_codex_20260308`
- `lib/bot-events/message-handler.ts.bak_codex_20260308`
- `lib/integrations/apis/funcoes/express-apis.js`
- fluxo antigo de importacao administrativa

Tambem foram removidos do `lib/command-tutorials.ts` os metadados internos e tokens de categoria dos comandos sem vinculo direto com o bot em producao.

## Estrutura oficial

Integrações CJS usadas por rotas atuais, handler do bot ou wrappers TypeScript ficam em:

- `lib/integrations/apis/funcoes/api.js`
- `lib/integrations/apis/funcoes/savepin.js`
- `lib/integrations/apis/funcoes/instagram2.js`
- `lib/integrations/apis/funcoes/attp.js`
- `lib/integrations/apis/funcoes/removebg-client.js`
- `lib/integrations/apis/funcoes/removebg.js`
- `lib/integrations/apis/funcoes/removebg2.js`
- `lib/integrations/apis/funcoes/telegraph-helper.js`
- `lib/integrations/apis/funcoes/meli-token.js`
- `lib/integrations/apis/funcoes/spotify-downloader.js`
- `lib/integrations/apis/funcoes/xvideos.js`

Campanhas reaproveitadas de anuncios de grupo ficam centralizadas em `lib/group-ad-campaigns.ts`.

## Catalogo publico

Comandos publicos seguem vindo apenas de:

- `resources/default-command-aliases.ts`
- `EXTRA_RUNTIME_COMMANDS` em `lib/command-tutorials.ts`
- tutoriais sobrescritos/cadastrados no painel quando existir slug equivalente

## Validacao

- Nenhum comando sem vinculo direto e gerado no catalogo publico.
- Nenhum comando sem vinculo direto sobrou em `COMMAND_FACTS`.
- Nenhum comando sem vinculo direto sobrou em `SOCIAL_ACTION_SUMMARIES`.
- Nenhum comando sem vinculo direto sobrou nos regex de categorias.
