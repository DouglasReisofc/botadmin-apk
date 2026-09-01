# BotAdmin Web Panel

Cliente React exclusivo para navegadores web. Este diretório faz parte do mesmo projeto BotAdmin e usa as mesmas APIs, sessão, regras e banco do Next/Flutter.

- Next (`../app`, `../lib`) continua sendo a fonte do backend e da aplicação oficial; a landing pública é espelhada no cliente React para que a homologação local não saia do `localhost`.
- Flutter (`../flutter_panel`) continua sendo o cliente Android e Windows.
- React (`.`) substitui somente a interface do dashboard web após homologação.

`npm run build` grava o bundle em `../public/dashboard/react`. O servidor Vite desta pasta já é exclusivamente React; não é necessário usar `?react=1` ou `?flutter=1`. A produção só deve usar React como padrão após aprovação, definindo `BOTADMIN_USER_WEB_CLIENT=react`. O app nativo Android/Windows continua usando Flutter.

Em um clone limpo, instale as dependências da raiz e também as deste painel (`npm ci` e `npm --prefix web_panel ci`) antes de executar o build.

Para homologar diretamente no Vite, abra `http://localhost:5173/` para a landing ou `http://localhost:5173/dashboard/user?section=conversations` para o painel. Se não houver cookie local, o próprio painel exibe uma tela de acesso local e autentica pela API proxied; ele não redireciona o dashboard para `botadmin.shop`. As rotas públicas (`/comandos`, `/tutorials`, `/grupos-oficiais` e páginas institucionais) permanecem no mesmo origin durante a homologação.
