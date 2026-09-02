# Paridade do painel administrativo React ↔ Flutter

Esta lista é mantida junto da versão React isolada. Cada item aponta para a
mesma operação do painel Flutter/Next em produção e deve continuar usando as
rotas `/api/admin`, sem duplicar regras de negócio no navegador.

## Inventário de paridade implementado no React

- [x] Painel: métricas de usuários, servidores, suporte e vendas, com atalhos.
- [x] Suporte: lista e conversa já existentes, com navegação interna preservada.
- [x] Usuários: busca, filtros, criação, edição, plano, impersonação e limpeza.
- [x] Perfis/instâncias: criação, busca/filtros (conectado, desconectado, ativo e vencido), conexão, pareamento com retorno do QR/código, ações, sincronização de webhooks, limpeza de sessões desconectadas e botões nativos globais.
- [x] Servidores: criação, edição, ativação, limites, migração de instâncias e exclusão protegida.
- [x] BotInterage IA: provedor, modelo, chave protegida e permissões.
- [x] BotInterage TTS: endpoint, token protegido, voz padrão, vozes/previews e permissões.
- [x] Mega downloader: credenciais, contas externas e renovação de sessão.
- [x] Grupos do bot: busca paginada, detalhes, permissões, boas-vindas, IA e remoção.
- [x] Campanhas: histórico administrativo conectado à API e estados vazios tratados.
- [x] Planos: criação, edição, ativação, limites, todos os recursos por plano e configuração completa do período de teste (duração, modal, passos e mídias).
- [x] Parceiros: master, revendedor e suporte; permissões, créditos, comissão,
  entrada no painel do parceiro e regras financeiras isoladas (custos por plano,
  Pix/manual, proxy e repasse para subordinados).
- [x] Pagamentos: Mercado Pago, PoloPag, checkout, split, webhooks, histórico e
  revelação de credenciais mediante senha administrativa.
- [x] Afiliados: provedores, OAuth, cookies e credenciais por plataforma.
- [x] Site: identidade visual, SEO, Open Graph e link do grupo oficial.
- [x] Firebase: push, projeto, app e credenciais protegidas.
- [x] Aplicativo: versão, version code, notas, APK e keystore assinado.
- [x] Notificações: cobrança, SMTP, teste, modelos, bloqueio por vencimento e broadcast.
- [x] Links úteis: links, banners/GIFs, upload, ordem, edição e exclusão.
- [x] Tutoriais: cadastro, edição, mídia, slug e exclusão.

## Regras de integração

- A navegação desktop usa uma barra de módulos e uma lista contextual, como no
  Flutter; no mobile os mesmos módulos ficam no drawer, sem overflow horizontal.
- Todas as telas possuem loading, estado vazio, feedback de erro e retry por
  atualização. A API repete somente leituras transitórias 502/503/504.
- Operações destrutivas pedem confirmação; tokens, senhas e chaves nunca são
  renderizados no estado inicial.
- Formulários multipart são enviados como `FormData`; endpoints JSON recebem
  `JSON.stringify`, incluindo broadcast de notificações.
- A rota React local nunca redireciona para `botadmin.shop`; a produção continua
  sendo servida pelo aplicativo oficial até uma publicação explícita.

## Pendências de homologação (não são telas faltantes)

- Executar cada operação de escrita com uma sessão administrativa real e validar
  os efeitos no banco/worker de produção antes do deploy (a validação local usa
  contratos mockados e não substitui esta homologação).
- Validar no ADB o APK que consome o mesmo backend; o build React não substitui
  essa validação nativa.
