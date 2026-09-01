# Migracao do painel BotAdmin para Flutter

Este clone foi criado para migrar o painel autenticado sem mexer no BotAdmin em producao em `/root/botadmin-local`.

## Estrutura

- `/root/botadmin-clone`: copia isolada do projeto atual.
- `/root/botadmin-clone/flutter_panel`: novo app Flutter para o painel autenticado.
- Next.js continua no clone para paginas publicas, SEO, rotas de API e fluxos que ainda nao foram migrados.

## Direcao da arquitetura

O painel autenticado deve migrar por verticais, usando as APIs atuais do BotAdmin como backend. A parte publica continua em Next.js para preservar SEO, pagina inicial, login publico, checkout e conteudo indexavel.

Primeira vertical criada:

- Login usando `/api/auth/login`.
- Restauracao de sessao usando `/api/auth/session`.
- Leitura de instancias via `/api/bot-instances`.
- Listagem inicial de grupos e conversas.
- Tela de chat com envio de texto, anexo de midia/documento e mencao fantasma para todos.
- Renderizacao inicial de midias no historico, com preview para imagens.
- Tela Flutter de ativacoes por grupo usando `/api/bot-groups/:groupId/settings`.
- Controle de boas-vindas e saida com texto, midia por URL/caminho, sticker e foto de perfil do participante.
- Configuracao de links permitidos, palavras proibidas, limite de infracoes e abertura/fechamento automatico.

## Como rodar o Flutter localmente

```bash
cd /root/botadmin-clone/flutter_panel
/opt/flutter/bin/flutter run -d chrome
```

## Como gerar build web

```bash
cd /root/botadmin-clone/flutter_panel
/opt/flutter/bin/flutter build web --base-href /dashboard/user/
```

O build sai em:

```text
/root/botadmin-clone/flutter_panel/build/web
```

## Como rodar integrado ao Next local

No clone, o Flutter e publicado dentro do proprio Next em `/public/dashboard/user`.
Assim, o login normal do site continua em Next e o usuario comum entra direto no painel Flutter pela rota `/dashboard/user`, usando o mesmo host das APIs `/api`, sem depender de `botadmin.shop`.

```bash
cd /root/botadmin-clone
npm run flutter:publish:web
npm run dev:flutter-local
```

URL local:

```text
http://localhost:4310/sign-in
http://localhost:4310/dashboard/user
```

`BOTADMIN_DISABLE_BACKGROUND_JOBS=1` mantem o preview local sem dispatchers de campanhas, horarios e rotinas automaticas concorrendo com o BotAdmin original.

## Validacao atual

```bash
/opt/flutter/bin/dart format lib test
/opt/flutter/bin/flutter analyze
/opt/flutter/bin/flutter test
/opt/flutter/bin/flutter build web --base-href /dashboard/user/
/opt/flutter/bin/flutter build apk --debug --dart-define=BOTADMIN_API_BASE_URL=http://SEU_IP_LOCAL:4310
```

## Proximos modulos

1. Conversas em tempo real via `/api/whatsapp-realtime/events`.
2. Upload direto de midias de boas-vindas/saida pelo Flutter, alem do campo URL/caminho ja disponivel.
3. Botoes interativos, respostas rapidas, acoes da conversa e leitura de status.
4. Assinatura por perfil, renovacao unica do perfil e compra separada de storage.
5. Area admin com gestao de usuarios, planos, instancias e auditoria.
6. Empacotamento Android/iOS nativo a partir do mesmo painel Flutter.

## Integracao gradual sugerida

Enquanto a paridade nao estiver completa, mantenha o painel Next atual ativo. Quando uma vertical Flutter estiver madura, publique o build Flutter em uma rota separada, por exemplo `/app` ou `/painel-v2`, via Nginx ou pelo proprio Next no clone. Depois de validar uso real, a rota principal do painel pode apontar para Flutter.
