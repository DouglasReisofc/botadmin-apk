# StoreBot Dashboard

Projeto full-stack baseado em Next.js com autenticação integrada, landing page institucional e dashboards separados para administradores e usuários. O back-end utiliza rotas API do próprio Next.js com Node.js e MySQL, permitindo iniciar rapidamente sem a necessidade de serviços externos.

## Recursos principais

- ✅ **Landing page** pronta para apresentar o produto e direcionar para login/cadastro.
- 🔐 **Autenticação completa** com registro, login, cookies HttpOnly e hashing de senha com `bcryptjs`.
- 🗂️ **Dashboards separados** para perfis `admin` e `user`, incluindo navegação dinâmica e layout protegido.
- 🛒 **Gestão de catálogo digital** com criação de categorias (nome, preço, SKU, descrição, status e imagem) e produtos vinculados com texto secreto, anexo opcional e limite de revendas.
- 📡 **Webhook individual por usuário** já pronto para a Meta Cloud API, com endpoint dedicado, verify token e histórico de eventos.
- 🗄️ **Integração direta com MySQL** (`mysql2/promise`) usando variáveis de ambiente centralizadas.
- 🍪 **Sessões baseadas em JWT** armazenadas em cookie seguro para controlar acesso.
- 🎨 Base construída sobre componentes Bootstrap 5 já otimizados.

## Requisitos

- Node.js 18+
- Acesso a um banco MySQL (credenciais padrão configuradas em `.env`).

## Configuração do ambiente

Crie um arquivo `.env` na raiz usando os valores do seu ambiente (nunca
versione credenciais reais):

```env
DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_USER=your_database_user
DATABASE_PASSWORD=your_database_password
DATABASE_NAME=your_database_name
JWT_SECRET=replace-with-a-long-random-secret
APP_URL=https://botadmin.shop
PORT=4478
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=replace-before-starting
DEFAULT_ADMIN_NAME=Administrador StoreBot
FIREBASE_PROJECT_ID=storezap-3d056
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=storezap-3d056.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=storezap-3d056
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=storezap-3d056.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=568557890895
NEXT_PUBLIC_FIREBASE_APP_ID=1:568557890895:web:040ae0e2b33010a6fee93a
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-E9SBWGJT9F
NEXT_PUBLIC_FIREBASE_VAPID_KEY=BD_aiT4RdUUgMVLaTXQCnavAUamKS4lz9PhLDDOc-1ZJ754pLZeqgSXTcqpZGoZZtS8y1dvAZF4GyEQExHqWQ8
```

> **Importante:** substitua todos os valores de exemplo, use um `JWT_SECRET`
> forte e mantenha as credenciais em um cofre seguro. Não commite o arquivo
> `.env`.

As variáveis `DEFAULT_ADMIN_*` garantem que um administrador inicial seja provisionado automaticamente. Ajuste-as caso precise de outro e-mail ou senha.

## Instalação e execução

```bash
npm install
npm run dev
```

O servidor local ficará disponível em `http://localhost:4478`, mas `APP_URL` aponta para o domínio público `http://botadmin.shop` para que webhooks, mídias e callbacks utilizem a URL externa correta.

> Para alterar a porta, execute `npm run dev -- -p <porta>` ou ajuste o script em `package.json` conforme necessário. Caso utilize outro domínio público, atualize `APP_URL` no `.env`.

## Estrutura de autenticação

- `app/api/auth/register` – registra usuários e cria sessão automaticamente.
- `app/api/auth/login` – valida credenciais e gera o cookie de sessão.
- `app/api/auth/logout` – remove o cookie de sessão.
- `app/api/auth/session` – retorna o usuário autenticado atual.
- `app/api/webhooks/meta/[webhookId]` – endpoint dinâmico para verificar e receber notificações da Meta Cloud API por usuário.
- `lib/db.ts` – conexão compartilhada com MySQL e criação automática da tabela `users`.
- `lib/auth.ts` – geração e validação de tokens JWT.

O layout em `app/(dashboard)/layout.tsx` garante o redirecionamento automático para `/sign-in` quando não há sessão ativa.

### Perfis de acesso

- O primeiro administrador é criado automaticamente com o e-mail `contactgestorvip@gmail.com` e senha `Dev7766@#$%` (altere no `.env` se necessário).
- O formulário de cadastro cria apenas contas de usuário final; administradores adicionais devem ser configurados diretamente no banco de dados.

## Webhooks da Meta Cloud API

- Cada usuário recebe automaticamente um endpoint único disponível em `/api/webhooks/meta/{id}`.
- O painel do usuário exibe endpoint, verify token, App ID, Business Account ID, Phone Number ID e access token, além do histórico dos últimos eventos recebidos.
- Durante a verificação do webhook na Meta, utilize o verify token fornecido pelo painel e informe o endpoint gerado.

## Scripts úteis

- `npm run dev` – inicia o ambiente de desenvolvimento.
- `npm run build` – gera a versão de produção web (atalho para `npm run build:web`).
- `npm run build:web` – compila apenas a versão web em `.next`.
- `npm run start` – executa o build em modo produção.
- `npm run lint` – executa o linting do projeto.
- `npm run mobile:prepare` – garante o bundle estático mínimo (`dist/mobile`) respeitando `NEXT_PUBLIC_CAP_SERVER_URL`.
- `npm run mobile:android` – sincroniza o Capacitor, gera o APK de release e atualiza o link público de download.
- `npm run cap:init` – adiciona os projetos nativos de Android e iOS (execute apenas na primeira configuração).
- `npm run cap:sync` – recompila a web, prepara `dist/mobile` e sincroniza os assets com as plataformas nativas.
- `npm run cap:android` – sincroniza e abre o projeto Android no Android Studio.
- `npm run cap:ios` – sincroniza e abre o projeto iOS no Xcode.

## Integração com Capacitor

O arquivo `capacitor.config.ts` configura o app móvel `Bot Admin` (ID `com.botadmin.shop`) com saída padrão em `dist/mobile`.

1. Gere os projetos nativos com `npm run cap:init`.
2. Execute `npm run build:web` para compilar a versão web utilizada pelos aplicativos móveis.
3. Rode `npm run mobile:android` sempre que quiser sincronizar o Capacitor, gerar o APK de release e atualizar o link público consumido pelo painel (`data/mobile-artifacts.json`).
4. Utilize `npm run cap:android` ou `npm run cap:ios` caso queira abrir os projetos nativos e gerar builds personalizados (por exemplo, `.aab` ou `.ipa`).

Durante o desenvolvimento é possível configurar `NEXT_PUBLIC_CAP_SERVER_URL` para apontar para uma instância remota do dashboard (`http://<ip>:4478`). Quando esta variável estiver definida o aplicativo móvel utilizará o servidor indicado em vez do bundle estático.

## Firebase Push Notifications

- Configure as variáveis `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` com as credenciais do Firebase Admin (arquivo JSON da conta de serviço). Substitua quebras de linha da chave privada por `\n` ao definir no `.env`.
- Preencha os campos `NEXT_PUBLIC_FIREBASE_*` com o app web criado no Firebase e defina `NEXT_PUBLIC_FIREBASE_VAPID_KEY` para habilitar Web Push.
- O service worker dinâmico (`/firebase-messaging-sw.js`) reutiliza essas variáveis para inicializar o Firebase Messaging.
- O hook `usePushNotifications` registra o token no endpoint `/api/notifications/push/token` e sincroniza tanto navegadores quanto o app nativo (via Capacitor).
- As notificações armazenadas em `push_subscriptions` podem ser disparadas via `/api/notifications/push/send` ou automaticamente sempre que uma notificação interna é criada.
- Após ajustes de credenciais, execute `npx cap sync android` para garantir que o plugin e o `google-services.json` estejam aplicados no projeto nativo.

### Android (som personalizado e TTS em segundo plano)

- Os pushes são enviados como **data messages**, permitindo que o serviço Android dedicado processe os dados mesmo com o app fechado.
- O serviço cria manualmente a notificação, garante o canal `botadmin.realtime`, reproduz o áudio padrão (`storebot_push_sound.mp3`, mantido por compatibilidade) quando presente em `android/app/src/main/res/raw` e dispara o Text-to-Speech com o texto informado na chave `storebot_speak`.
- `npm run mobile:prepare` sincroniza automaticamente os arquivos de áudio de `public/sounds` para `android/app/src/main/res/raw` (criando o alias `storebot_push_sound.mp3` para `general-notification.mp3`), garantindo que os sons personalizados também estejam disponíveis no aplicativo Android.
- Execute `npm run android:wrapper` uma vez para baixar `gradle-wrapper.jar` antes de abrir o projeto nativo. Em seguida use `npm run cap:android` para sincronizar e abrir no Android Studio.
- Dados adicionais devem ser enviados em `data` no `sendPushNotification`, que são encaminhados como extras na `Intent` aberta ao tocar na notificação.

## Licença

O projeto adapta o template original **Dasher UI** disponível sob licença MIT pela Codescandy/Themewagon. As adaptações e integrações adicionais são fornecidas sob a mesma licença.
