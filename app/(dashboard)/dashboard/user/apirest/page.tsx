import type { Metadata } from "next";

import { getCurrentUser } from "lib/auth";
import { getAdminPaymentMethodSummaries } from "lib/admin-payments";
import { listApiRequestPlans } from "lib/api-request-plans";
import { getOrCreateUserApiKey } from "lib/user-api-keys";
import UserApiRestClient, {
  type ApiEndpointSection,
  type ApiKeySnapshot,
} from "components/apirest/UserApiRestClient";
import DashboardPageTitle from "components/common/DashboardPageTitle";

const resolveBaseUrl = (): string => {
  const candidates = [
    process.env.APP_URL,
    process.env.BASE_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_SITE_URL,
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim().replace(/\/+$/, "");
    }
  }

  return "https://seu-dominio.com";
};

const API_SECTIONS: ApiEndpointSection[] = [
  {
    title: "Downloads de mídias",
    description:
      "Endpoints responsáveis por retornar links temporários para download de mídias a partir das principais plataformas sociais.",
    endpoints: [
      {
        name: "Detecção automática",
        method: "GET",
        path: "/api/download/auto",
        description: "Redireciona automaticamente para o endpoint correto de acordo com a URL fornecida.",
        queryParams: [
          { name: "url", required: true, description: "URL original da mídia." },
        ],
        sampleQuery: { url: "https://www.instagram.com/reel/xxxxxxxxx/" },
      },
      {
        name: "YouTube MP3",
        method: "GET",
        path: "/api/download/ytmp3",
        description: "Retorna os metadados e link de download do áudio em MP3 a partir de um vídeo do YouTube.",
        queryParams: [
          { name: "q", required: true, description: "Link completo ou termo de busca do YouTube." },
        ],
        sampleQuery: { q: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      },
      {
        name: "YouTube MP4",
        method: "GET",
        path: "/api/download/youtube",
        description: "Retorna os metadados e link de download do vídeo MP4 a partir de um link ou termo do YouTube.",
        queryParams: [
          { name: "q", required: true, description: "Link completo ou termo de busca do YouTube." },
        ],
        sampleQuery: { q: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      },
      {
        name: "Facebook",
        method: "GET",
        path: "/api/download/facebook",
        description: "Obtém links de download sem marca d'água para vídeos públicos do Facebook ou Reels.",
        queryParams: [
          { name: "url", required: true, description: "URL do vídeo do Facebook/FB Watch." },
        ],
        sampleQuery: { url: "https://www.facebook.com/watch/?v=123456789" },
      },
      {
        name: "Instagram",
        method: "GET",
        path: "/api/download/instagramv2",
        description: "Extrai mídias (foto, vídeo, carrossel) de posts ou reels públicos do Instagram.",
        queryParams: [
          { name: "url", required: true, description: "URL pública do post/reel." },
        ],
        sampleQuery: { url: "https://www.instagram.com/p/XXXXXXXXX/" },
      },
      {
        name: "Instagram Reels por perfil",
        method: "GET",
        path: "/api/download/instagram-profile-reels",
        description:
          "Lista Reels públicos de um perfil em massa, com paginação, permalink, vídeo, capa, legenda e métricas.",
        queryParams: [
          { name: "username", required: true, description: "Username ou URL pública do perfil." },
          { name: "limit", description: "Quantidade de Reels, entre 1 e 120 (padrão: 24)." },
          { name: "cursor", description: "Cursor retornado pela consulta anterior." },
          { name: "pages", description: "Máximo de páginas consultadas, entre 1 e 10." },
        ],
        sampleQuery: { username: "movie.cutsmax", limit: "24" },
        notes: [
          "Guarde `permalink`/`sourceUrl` como referência estável. URLs diretas de vídeo são temporárias.",
        ],
      },
      {
        name: "TikTok",
        method: "GET",
        path: "/api/download/tiktok",
        description: "Retorna vídeo TikTok em alta qualidade, sem marca d'água, além de miniaturas e áudio.",
        queryParams: [
          { name: "url", required: true, description: "URL do vídeo do TikTok." },
          { name: "debug", description: "Use 1 para incluir informações extras de diagnóstico." },
        ],
        sampleQuery: { url: "https://www.tiktok.com/@user/video/1234567890" },
      },
      {
        name: "Kwai",
        method: "GET",
        path: "/api/download/kwai",
        description: "Faz o download de vídeos públicos do Kwai/Kuaishou.",
        queryParams: [
          { name: "url", required: true, description: "URL do vídeo do Kwai." },
        ],
        sampleQuery: { url: "https://www.kwai.com/br/short-video/1234567890" },
      },
      {
        name: "Douyin",
        method: "GET",
        path: "/api/download/douyin",
        description: "Resolve links públicos do Douyin/Xigua e retorna o MP4 direto.",
        queryParams: [
          { name: "url", required: true, description: "URL do vídeo do Douyin." },
        ],
        sampleQuery: { url: "https://v.douyin.com/OaowH_eGEU0/" },
      },
      {
        name: "Pinterest",
        method: "GET",
        path: "/api/download/pinterest",
        description:
          "Obtém o arquivo original de um pin (vídeo ou imagem) do Pinterest. A versão 2 é alimentada pelo agregador oficial do Bot Admin e já detecta vídeos em alta resolução automaticamente.",
        queryParams: [
          { name: "url", required: true, description: "URL do pin do Pinterest." },
          {
            name: "version",
            description:
              "Opcional. Use v1 para forçar o modo de compatibilidade SavePin. Por padrão, usamos v2.",
          },
        ],
        sampleQuery: { url: "https://www.pinterest.com/pin/1234567890" },
        notes: [
          "Por padrão utilizamos a V2, que entrega vídeo MP4, imagem, thumbnails e metadados completos.",
          "Caso precise do comportamento antigo para compatibilidade, informe ?version=v1.",
        ],
      },
      {
        name: "Freepik",
        method: "GET",
        path: "/api/rest/freepik",
        description: "Gera o download direto para arquivos gratuitos do Freepik.",
        queryParams: [
          { name: "url", required: true, description: "URL pública do recurso no Freepik." },
        ],
        sampleQuery: {
          url: "https://www.freepik.com/free-psd/3d-whatsapp-icon-social-media-post-design-template_418842286.htm",
        },
      },
      {
        name: "Envato Elements",
        method: "GET",
        path: "/api/rest/envato",
        description: "Solicita o downloader dedicado para obter o pacote ZIP de recursos gratuitos do Envato Elements.",
        queryParams: [
          { name: "url", required: true, description: "URL pública do item no Envato Elements." },
        ],
        sampleQuery: {
          url: "https://elements.envato.com/pt-br/confetti-VWQDCZS",
        },
      },
      {
        name: "Global Video",
        method: "GET",
        path: "/api/download/globalvideo",
        description: "Downloader genérico para plataformas suportadas pelo youtube-dl (fallback para links diversos).",
        queryParams: [
          { name: "url", required: true, description: "URL do vídeo." },
        ],
        sampleQuery: { url: "https://www.dailymotion.com/video/xy123" },
      },
      {
        name: "Global Audio",
        method: "GET",
        path: "/api/download/globalaudio",
        description: "Downloader genérico de áudio via youtube-dl para plataformas suportadas.",
        queryParams: [
          { name: "url", required: true, description: "URL da mídia." },
        ],
        sampleQuery: { url: "https://soundcloud.com/user/track" },
      },
      {
        name: "Spotify",
        method: "GET",
        path: "/api/download/spotify",
        description: "Resolve links públicos do Spotify e retorna metadados e prévia da mídia.",
        queryParams: [
          { name: "url", required: true, description: "URL do conteúdo público no Spotify." },
        ],
        sampleQuery: { url: "https://open.spotify.com/track/1234567890" },
      },
      {
        name: "SoundCloud",
        method: "GET",
        path: "/api/rest/soundcloud",
        description: "Baixa faixas públicas do SoundCloud via yt-dlp.",
        queryParams: [
          { name: "url", required: true, description: "URL da música no SoundCloud." },
        ],
        sampleQuery: { url: "https://soundcloud.com/user/dope-track" },
      },
      {
        name: "Bandcamp",
        method: "GET",
        path: "/api/rest/bandcamp",
        description: "Converte álbuns ou faixas do Bandcamp em arquivos MP3 hospedados temporariamente.",
        queryParams: [
          { name: "url", required: true, description: "Link da faixa ou álbum no Bandcamp." },
        ],
        sampleQuery: { url: "https://artist.bandcamp.com/track/example" },
      },
      {
        name: "Mixcloud",
        method: "GET",
        path: "/api/rest/mixcloud",
        description: "Gera o download de programas e sets hospedados no Mixcloud.",
        queryParams: [
          { name: "url", required: true, description: "URL do programa no Mixcloud." },
        ],
        sampleQuery: { url: "https://www.mixcloud.com/show-id/" },
      },
      {
        name: "Twitter Spaces",
        method: "GET",
        path: "/api/rest/twitterspaces",
        description: "Extrai o áudio de transmissões do Twitter / X Spaces.",
        queryParams: [
          { name: "url", required: true, description: "Link completo do Space (twitter.com/i/spaces/...)." },
        ],
        sampleQuery: { url: "https://twitter.com/i/spaces/1234567890" },
      },
      {
        name: "Twitch",
        method: "GET",
        path: "/api/rest/twitch",
        description: "Baixa clips ou VODs públicos do Twitch.",
        queryParams: [
          { name: "url", required: true, description: "URL do clip ou VOD." },
        ],
        sampleQuery: { url: "https://clips.twitch.tv/SomeClipId" },
      },
      {
        name: "Rumble",
        method: "GET",
        path: "/api/rest/rumble",
        description: "Extrai vídeos hospedados no Rumble em MP4.",
        queryParams: [
          { name: "url", required: true, description: "Link completo do vídeo no Rumble." },
        ],
        sampleQuery: { url: "https://rumble.com/v123abc-video.html" },
      },
      {
        name: "Odysee",
        method: "GET",
        path: "/api/rest/odysee",
        description: "Gera downloads para conteúdos do Odysee/LBRY.",
        queryParams: [
          { name: "url", required: true, description: "URL do vídeo no Odysee." },
        ],
        sampleQuery: { url: "https://odysee.com/@channel/video" },
      },
      {
        name: "Dailymotion",
        method: "GET",
        path: "/api/rest/dailymotion",
        description: "Baixa vídeos do Dailymotion em MP4.",
        queryParams: [
          { name: "url", required: true, description: "URL pública do vídeo." },
        ],
        sampleQuery: { url: "https://www.dailymotion.com/video/xyz" },
      },
      {
        name: "MediaFire",
        method: "GET",
        path: "/api/download/mediafire",
        description: "Extrai informações e link direto de arquivos hospedados no MediaFire.",
        queryParams: [
          { name: "url", required: true, description: "URL do arquivo MediaFire." },
        ],
        sampleQuery: { url: "https://www.mediafire.com/file/xxxxxx/file" },
      },
      {
        name: "Mega.nz",
        method: "GET",
        path: "/api/download/mega",
        description: "Gera um link temporário hospedado no Bot Admin para arquivos do Mega.nz.",
        queryParams: [
          { name: "url", required: true, description: "URL completa do arquivo ou pasta do Mega." },
        ],
        sampleQuery: { url: "https://mega.nz/file/XXXXXXXX#YYYYYYYYYYYY" },
      },
    ],
  },
  {
    title: "Ferramentas para WhatsApp",
    description: "Serviços auxiliares que ajudam na curadoria de grupos públicos e contatos.",
    endpoints: [
      {
        name: "Busca de grupos (gruposwhats.app)",
        method: "GET",
        path: "/api/rest/gruposwhats",
        description:
          "Consulta o agregador oficial da plataforma (cookies.botadmin.shop) para retornar grupos públicos do gruposwhats.app com todos os metadados disponíveis.",
        queryParams: [
          { name: "q", required: true, description: "Termo de busca (ex.: \"grupos de vendas\")." },
          {
            name: "maxPages",
            description: "Número máximo de páginas para o agregador percorrer (1 a 5, padrão 3).",
          },
          {
            name: "delayMs",
            description: "Atraso em milissegundos entre cada consulta ao agregador (padrão 600ms).",
          },
          {
            name: "details",
            description: "Envie 0 para receber apenas a listagem principal e acelerar o resultado.",
          },
        ],
        sampleQuery: { q: "promoções", maxPages: "2" },
        notes: [
          "Retorna apenas informações públicas já disponíveis no gruposwhats.app.",
          "Os links coletados pertencem aos respectivos administradores dos grupos.",
          "O endpoint interno `cookies.botadmin.shop/api/gruposwhats/search` é utilizado automaticamente.",
        ],
      },
      {
        name: "Sticker ATTp (fundo WhatsApp)",
        method: "GET",
        path: "/api/ferramentas/attp",
        description:
          "Gera a versão clássica do comando /attp com fundo inspirado no WhatsApp e tipografia destacada em vermelho.",
        queryParams: [
          { name: "text", required: true, description: "Conteúdo que será exibido no sticker (até 200 caracteres)." },
        ],
        notes: [
          "O retorno é uma imagem .webp animada pronta para ser enviada como figurinha.",
          "Utilize `text` ou `q` para informar o conteúdo.",
        ],
        sampleQuery: { text: "BORA SE CADASTRAR" },
      },
      {
        name: "Sticker ATTp 2 (texto branco)",
        method: "GET",
        path: "/api/ferramentas/attp2",
        description:
          "Variante com texto branco e contorno escuro — ideal para frases curtas em destaque.",
        queryParams: [
          { name: "text", required: true, description: "Conteúdo desejado (até 200 caracteres)." },
        ],
        notes: [
          "Entrega um arquivo .webp animado, mantendo o mesmo layout utilizado no bot.",
        ],
        sampleQuery: { text: "Promoção liberada!" },
      },
      {
        name: "Sticker ATTp 3 (fundo branco)",
        method: "GET",
        path: "/api/ferramentas/attp3",
        description:
          "Versão minimalista em fundo branco e tipografia automática, igual ao comando /attp3 no bot.",
        queryParams: [
          { name: "text", required: true, description: "Texto para o sticker (até 200 caracteres)." },
        ],
        notes: [
          "Retorna um sticker .webp animado ou estático, pronto para envio no WhatsApp.",
        ],
        sampleQuery: { text: "Atualize seu cadastro" },
      },
    ],
  },
  {
    title: "Consultas e utilidades",
    description: "Operações auxiliares que retornam metadados ou fazem buscas em serviços suportados.",
    endpoints: [
      {
        name: "YouTube Search",
        method: "GET",
        path: "/api/download/ytsearch",
        description: "Realiza uma busca no YouTube e retorna uma lista padronizada de vídeos.",
        queryParams: [
          { name: "q", required: true, description: "Termo a ser pesquisado." },
          { name: "limit", description: "Quantidade máxima de resultados (até 50)." },
          { name: "engine", description: "Força um mecanismo específico: modern, yt-search ou interno." },
        ],
        sampleQuery: { q: "lofi hip hop" },
      },
      {
        name: "YouTube Play MP3",
        method: "GET",
        path: "/api/play",
        description: "Atalho que resolve um termo/URL e retorna o áudio pronto para download.",
        queryParams: [
          { name: "q", required: true, description: "Termo ou link do YouTube." },
        ],
        sampleQuery: { q: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      },
      {
        name: "YouTube Play MP4",
        method: "GET",
        path: "/api/playv",
        description: "Retorna o link de vídeo MP4 a partir de um termo ou link do YouTube.",
        queryParams: [
          { name: "q", required: true, description: "Termo ou link do YouTube." },
        ],
        sampleQuery: { q: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      },
      {
        name: "Spotify Search",
        method: "GET",
        path: "/api/rest/spotify/search",
        description: "Busca faixas públicas no Spotify e retorna metadados prontos para uso.",
        queryParams: [
          { name: "q", required: true, description: "Título, artista ou trecho da música." },
          { name: "limit", description: "Máximo de resultados (até 20)." },
        ],
        sampleQuery: { q: "die with a smile" },
        notes: [
          "Cada item já traz o caminho `downloadEndpoint` e os parâmetros para reutilizar o downloader nativo.",
        ],
        shortName: "SPOTIFY SEARCH",
      },
      {
        name: "Instagram Stalk",
        method: "GET",
        path: "/api/download/insta-stalk",
        description: "Retorna informações públicas de perfil do Instagram (seguidores, avatar, biografia).",
        queryParams: [
          { name: "user", required: true, description: "Nome de usuário do Instagram." },
        ],
        sampleQuery: { user: "instagram" },
      },
      {
        name: "Threads",
        method: "GET",
        path: "/api/download/threads",
        description: "Obtém mídias públicas da plataforma Threads.",
        queryParams: [
          { name: "url", required: true, description: "URL do conteúdo no Threads." },
        ],
        sampleQuery: { url: "https://www.threads.net/@user/post/1234567890" },
      },
      {
        name: "Frases do Pensador",
        method: "GET",
        path: "/api/rest/frases",
        description:
          "Coleta em tempo real as frases em destaque do Pensador.com para um tema específico (ex.: amor, amizade).",
        queryParams: [
          { name: "tema", description: "Slug ou palavra-chave do tema desejado (padrão: amor)." },
          { name: "page", description: "Número da página (1 a 20)." },
          { name: "limit", description: "Quantidade máxima de resultados (até 50)." },
        ],
        sampleQuery: { tema: "amor" },
      },
      {
        name: "Upload no Telegra.ph",
        method: "GET",
        path: "/api/ferramentas/telegraph",
        description:
          "Faz o download da imagem a partir de um link público (ou página com meta tags) e publica automaticamente no Telegra.ph.",
        queryParams: [
          { name: "link", required: true, description: "URL direta da imagem ou página pública que contenha a mídia." },
        ],
        notes: [
          "Aceita links de páginas HTML e tenta identificar a melhor imagem disponível via meta tags (Open Graph/Twitter) ou <img>.",
          "O retorno inclui tanto a URL final do Telegra.ph quanto a origem original para depuração.",
        ],
        sampleQuery: { link: "https://images.unsplash.com/photo-1503023345310-bd7c1de61c7d" },
      },
      {
        name: "Funções legadas",
        method: "GET",
        path: "/api/rest/run/{nome}",
        description: "Executa uma função específica do legado (mesma assinatura usada dentro do bot).",
        queryParams: [
          { name: "q", description: "Texto ou URL utilizado pela função legada." },
        ],
        notes: [
          "Substitua {nome} pelo identificador disponível no painel antigo (ex.: instaStory, aiText, etc.).",
        ],
        sampleQuery: { q: "valor" },
      },
      {
        name: "Consulta SisReg",
        method: "GET",
        path: "/api/rest/sisreg",
        description:
          "Consulta o status atual de um código do SisReg (Manaus) e retorna a mesma mensagem exibida no portal oficial.",
        queryParams: [
          { name: "code", required: true, description: "Código numérico da solicitação." },
          {
            name: "unit",
            required: true,
            description: "Nome da unidade solicitante. Ex.: USF Prefeito Manoel Henriques Ribeiro.",
          },
        ],
        notes: [
          "Ideal para construir notificações personalizadas no seu sistema.",
        ],
        sampleQuery: { code: "634123065", unit: "USF Prefeito Manoel Henriques Ribeiro" },
      },
      {
        name: "Busca Amazon BR",
        method: "GET",
        path: "/api/pesquisar/amazon",
        description: "Pesquisa produtos na Amazon.com.br e retorna uma lista com ASIN, título, preço, avaliações e status Prime.",
        queryParams: [
          { name: "nome", required: true, description: "Termo pesquisado (ex.: celular xiaomi)." },
          { name: "page", description: "Número da página (opcional, padrão 1)." },
        ],
        notes: [
          "Os links retornados apontam para o domínio oficial (amazon.com.br).",
          "A Amazon pode impor rate limit adicional; se receber mensagem de bloqueio aguarde alguns segundos antes de tentar novamente.",
        ],
        sampleQuery: { nome: "celular xiaomi" },
      },
      {
        name: "Busca Mercado Livre",
        method: "GET",
        path: "/api/pesquisar/mercadolivre",
        description:
          "Consulta o catálogo público do Mercado Livre Brasil (MLB) e retorna informações completas de produtos, incluindo preço, vendedor, frete e fotos.",
        queryParams: [
          { name: "q", description: "Termo de busca (aceita também query, nome, produto, termo ou busca)." },
          { name: "link", description: "Link do produto no Mercado Livre (aceita também link curto meli.la)." },
          { name: "limit", description: "Quantidade máxima de resultados (1 a 50, padrão 20)." },
        ],
        notes: [
          "Se enviar `link`, o endpoint resolve o redirecionamento e consulta o item específico.",
          "Inclui dados de vendedores, formas de envio, variações e atributos quando disponíveis.",
          "Útil para montar vitrines ou comparar preços rapidamente dentro do seu fluxo.",
        ],
        sampleQuery: { q: "panela de pressão", link: "https://meli.la/2sZ6neP" },
      },
    ],
  },
  {
    title: "Conteúdos +18",
    description:
      "Use estes endpoints apenas se o seu projeto permitir a manipulação de conteúdo adulto. O consumo continua sujeito aos mesmos limites de requisições da sua chave.",
    endpoints: [
      {
        name: "Xvideos",
        method: "GET",
        path: "/api/pesquisar/xvideos",
        description:
          "Pesquisa vídeos ou extrai links diretos do Xvideos. Quando `op=search`, retorna lista com título, duração, canal, visualizações e miniatura; com `op=download`, responde com os links MP4/HLS do vídeo informado.",
        queryParams: [
          { name: "nome", required: true, description: "Termo da pesquisa ou URL completa do vídeo." },
          { name: "op", description: "Modo de uso: search (padrão) ou download." },
        ],
        notes: [
          "O endpoint respeita o limite diário da sua chave.",
          "Ao usar `op=download`, informe em `nome` a URL do Xvideos (ex.: https://www.xvideos.com/video... )."
        ],
        sampleQuery: { nome: "mia khalifa", op: "search" },
      },
      {
        name: "Xvideos Download",
        method: "GET",
        path: "/api/download/xvideos",
        description:
          "Recebe o link completo do Xvideos e retorna metadados junto com os URLs MP4/HLS disponibilizados pelo site.",
        queryParams: [
          { name: "url", required: true, description: "URL pública do Xvideos (https://www.xvideos.com/video...)." },
        ],
        notes: [
          "Também aceita o parâmetro `nome` para compatibilidade com integrações antigas.",
          "Os links retornados expiram conforme o CDN do Xvideos, portanto faça o download assim que receber a resposta."
        ],
        sampleQuery: { url: "https://www.xvideos.com/video.hppahma8f01/fucking_exotic_mia_khalifa" },
      },
    ],
  },
  {
    title: "Streaming direto",
    description:
      "Após gerar o ID com os endpoints de YouTube ou Global, utilize estes recursos para servir mídia direto ao cliente.",
    endpoints: [
      {
        name: "Stream de áudio",
        method: "GET",
        path: "/api/playaudio/{id}",
        description:
          "Entrega o áudio convertido pelo endpoint de download. Suporta Range para players progressivos.",
        notes: [
          "O ID é o valor retornado pelos endpoints de YouTube ou Global Audio.",
          "Resposta é um stream binário; utilize apenas em serviços que aceitam redirecionamento/stream."
        ],
      },
      {
        name: "Stream de vídeo",
        method: "GET",
        path: "/api/play/{id}",
        description:
          "Entrega o vídeo convertido pelo endpoint de download, com suporte a Range para players progressivos.",
        notes: [
          "O ID é o valor retornado pelos endpoints de YouTube ou Global Video.",
          "Resposta é um stream binário; ideal para players HTML5."
        ],
      },
    ],
  },
  {
    title: "Interações WhatsApp (beta)",
    description:
      "Endpoints internos para disparos diretamente dos grupos conectados. Requer autenticação no painel e uso responsável: os exemplos abaixo utilizam o ID do grupo exibido no dashboard.",
    endpoints: [
      {
        name: "Disparo texto/mídia",
        method: "POST",
        path: "/api/bot-groups/{groupId}/broadcast",
        description: "Envia uma mensagem simples (texto ou mídia) para o grupo vinculado.",
        notes: [
          "Informe o ID do grupo na URL. É necessário estar autenticado no painel.",
          "Use `type` igual a `text` ou `media`. Para `media`, envie `mediaUrl` ou `mediaPath` (arquivo enviado pelo painel).",
        ],
        sampleBody: {
          type: "media",
          body: "Bem-vindo ao grupo!",
          mediaType: "image",
          mediaUrl: "https://cdn.seuservidor.com/bemvindo.jpg",
        },
      },
      {
        name: "Disparo com botões reply",
        method: "POST",
        path: "/api/bot-groups/{groupId}/broadcast",
        description: "Gera botões de resposta reutilizando os comandos do bot.",
        notes: [
          "Defina `type` como `button_reply`.",
          "Cada botão precisa de `id`, `label`, `command` e opcionalmente `args` (como um link ou argumento padrão).",
        ],
        sampleBody: {
          type: "button_reply",
          body: "Selecione o formato desejado:",
          buttons: [
            { id: "btn_mp3", label: "Baixar MP3", command: "ytmp3", args: "https://youtu.be/dQw4w9WgXcQ" },
            { id: "btn_mp4", label: "Baixar MP4", command: "ytmp4", args: "https://youtu.be/dQw4w9WgXcQ" },
          ],
        },
      },
      {
        name: "Disparo com botões CTA",
        method: "POST",
        path: "/api/bot-groups/{groupId}/broadcast",
        description: "Utiliza botões nativos (URL, copiar ou ligar) para call-to-actions rápidos.",
        notes: [
          "Defina `type` como `button_cta`.",
          "Atualmente suportamos até três botões por disparo.",
        ],
        sampleBody: {
          type: "button_cta",
          body: "Escolha um atalho:",
          ctaButtons: [
            { id: "open_site", text: "Abrir site", type: "cta_url", url: "https://botadmin.shop" },
            { id: "copy_coupon", text: "Copiar cupom", type: "cta_copy", copyCode: "BOTADMIN10" },
            { id: "call_support", text: "Falar com suporte", type: "cta_call", phoneNumber: "+559291234567" },
          ],
        },
      },
    ],
  },
  {
    title: "Campanhas globais (beta)",
    description:
      "Gerencie disparos recorrentes para grupos, status e canais utilizando as mesmas instâncias conectadas no painel.",
    endpoints: [
      {
        name: "Listar campanhas",
        method: "GET",
        path: "/api/bot-ad-campaigns",
        description: "Retorna todas as campanhas configuradas pelo usuário autenticado.",
        notes: [
          "Cada item inclui conteúdo, horário, status e a lista de destinos configurados.",
          "Use este endpoint para sincronizar o painel externo ou auditar execuções.",
        ],
      },
      {
        name: "Criar campanha",
        method: "POST",
        path: "/api/bot-ad-campaigns",
        description:
          "Registra uma nova campanha contendo agendamento e conteúdo (texto, mídia ou status).",
        notes: [
          "Envie `schedule.kind` como `manual`, `immediate`, `once`, `recurring` ou `window`.",
          "O campo `contents` aceita um array; neste beta utilizamos apenas o primeiro item.",
          "Após criar, defina os destinos através do endpoint de targets abaixo.",
        ],
        sampleBody: {
          name: "Campanha matinal",
          description: "Divulgação diária no grupo e status",
          schedule: { kind: "recurring", atTimes: ["08:00"], timezone: "America/Sao_Paulo" },
          contents: [{ id: "cmp1", type: "text", text: "Bom dia! Confira as novidades em nosso canal." }],
        },
      },
      {
        name: "Atualizar campanha",
        method: "PATCH",
        path: "/api/bot-ad-campaigns/{campaignId}",
        description: "Edita nome, descrição, agendamento ou conteúdo de uma campanha existente.",
        notes: [
          "Envie apenas os campos que deseja alterar.",
          "O ID é retornado pelo endpoint de listagem/criação.",
        ],
      },
      {
        name: "Remover campanha",
        method: "DELETE",
        path: "/api/bot-ad-campaigns/{campaignId}",
        description: "Remove a campanha e cancela novos disparos agendados.",
      },
      {
        name: "Definir destinos",
        method: "PUT",
        path: "/api/bot-ad-campaigns/{campaignId}/targets",
        description: "Substitui a lista de destinos (grupos ou status) vinculados à campanha.",
        notes: [
          "Cada destino deve informar `instanceId`, `type` (`group` ou `status`) e, para grupos, o `groupId` cadastrado no painel.",
          "Use `mentionAll`, `mentions` e `statusConfig.deleteAfterMinutes` para personalizar cada envio.",
        ],
        sampleBody: [
          { id: "tg1", type: "group", instanceId: 12, groupId: 34, mentionAll: true },
          { id: "tg2", type: "status", instanceId: 12, statusConfig: { deleteAfterMinutes: 120 } },
        ],
      },
    ],
  },
];

export const metadata: Metadata = {
  title: "API REST | StoreBot Dashboard",
  description:
    "Gerencie sua API key, visualize limites de consumo e explore os endpoints REST disponíveis para integrações.",
};

const ApiRestPage = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const [apiKey, paymentMethods, requestPlans] = await Promise.all([
    getOrCreateUserApiKey(user.id),
    getAdminPaymentMethodSummaries(),
    listApiRequestPlans(),
  ]);

  const snapshot: ApiKeySnapshot = {
    apiKey: apiKey.apiKey,
    dailyQuota: apiKey.dailyQuota,
    requestsUsed: apiKey.requestsUsed,
    remaining: Math.max(0, apiKey.dailyQuota - apiKey.requestsUsed),
    resetAt: apiKey.resetAt ? apiKey.resetAt.toISOString() : null,
    updatedAt: apiKey.updatedAt.toISOString(),
  };

  const baseUrl = resolveBaseUrl();

  return (
    <div className="d-flex flex-column gap-4">
      <DashboardPageTitle
        title="API REST"
        subtitle="Tokens, limites e endpoints oficiais."
      />

      <UserApiRestClient
        initialSnapshot={snapshot}
        sections={API_SECTIONS}
        baseUrl={baseUrl}
        plans={requestPlans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          priceCents: plan.priceCents,
          requestAmount: plan.requestAmount,
          isActive: plan.isActive,
          orderIndex: plan.orderIndex,
        }))}
        paymentMethods={paymentMethods}
      />
    </div>
  );
};

export default ApiRestPage;
