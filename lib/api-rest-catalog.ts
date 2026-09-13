export type ApiRestEndpointDefinition = {
  id: string;
  title: string;
  category: "download" | "utility";
  method: "GET";
  path: string;
  description: string;
  parameters: Array<{
    name: string;
    required: boolean;
    description: string;
  }>;
  example: string;
  response: string;
};

/**
 * Catálogo público da API REST do usuário.
 *
 * As rotas são as mesmas usadas pelo autodownloader e pelos comandos do
 * painel. O catálogo é retornado junto com a chave para que clientes externos
 * não precisem adivinhar caminhos ou parâmetros.
 */
export const API_REST_ENDPOINTS: ApiRestEndpointDefinition[] = [
  {
    id: "youtube-mp4",
    title: "YouTube · MP4",
    category: "download",
    method: "GET",
    path: "/api/rest/ytmp4",
    description: "Resolve um link ou termo do YouTube e retorna o vídeo em MP4.",
    parameters: [
      { name: "url", required: true, description: "Link ou termo do YouTube (q/query também são aceitos)." },
    ],
    example: "/api/rest/ytmp4?url=https%3A%2F%2Fyoutu.be%2FVIDEO_ID",
    response: "JSON com resultado.url, título, duração e miniatura.",
  },
  {
    id: "youtube-mp3",
    title: "YouTube · MP3",
    category: "download",
    method: "GET",
    path: "/api/rest/ytmp3",
    description: "Resolve um link ou termo do YouTube e retorna o áudio em MP3.",
    parameters: [
      { name: "url", required: true, description: "Link ou termo do YouTube (q/query também são aceitos)." },
    ],
    example: "/api/rest/ytmp3?url=https%3A%2F%2Fyoutu.be%2FVIDEO_ID",
    response: "JSON com resultado.url, título, duração e miniatura.",
  },
  {
    id: "play-mp4",
    title: "Play · MP4",
    category: "download",
    method: "GET",
    path: "/api/rest/ytplay/mp4",
    description: "Atalho rápido do comando Play para obter vídeo MP4.",
    parameters: [
      { name: "q", required: true, description: "Termo ou URL do conteúdo." },
    ],
    example: "/api/rest/ytplay/mp4?q=nome%20da%20musica",
    response: "JSON com o resultado normalizado do resolvedor Play.",
  },
  {
    id: "play-mp3",
    title: "Play · MP3",
    category: "download",
    method: "GET",
    path: "/api/rest/ytplay/mp3",
    description: "Atalho rápido do comando Play para obter áudio MP3.",
    parameters: [
      { name: "q", required: true, description: "Termo ou URL do conteúdo." },
    ],
    example: "/api/rest/ytplay/mp3?q=nome%20da%20musica",
    response: "JSON com o resultado normalizado do resolvedor Play.",
  },
  {
    id: "tiktok",
    title: "TikTok",
    category: "download",
    method: "GET",
    path: "/api/rest/tiktok",
    description: "Resolve vídeos públicos do TikTok e retorna as mídias disponíveis.",
    parameters: [{ name: "url", required: true, description: "URL pública do vídeo TikTok." }],
    example: "/api/rest/tiktok?url=https%3A%2F%2Fwww.tiktok.com%2F%40perfil%2Fvideo%2F123",
    response: "JSON com URL de vídeo, formato e metadados do conteúdo.",
  },
  {
    id: "kwai",
    title: "Kwai",
    category: "download",
    method: "GET",
    path: "/api/rest/kwai",
    description: "Resolve vídeos públicos do Kwai/Kuaishou.",
    parameters: [{ name: "url", required: true, description: "URL pública do vídeo Kwai." }],
    example: "/api/rest/kwai?url=https%3A%2F%2Fwww.kwai.com%2F%40perfil%2Fvideo%2F123",
    response: "JSON com URL de vídeo MP4 e metadados.",
  },
  {
    id: "facebook",
    title: "Facebook",
    category: "download",
    method: "GET",
    path: "/api/rest/facebook",
    description: "Resolve vídeos públicos do Facebook e fb.watch.",
    parameters: [{ name: "url", required: true, description: "URL pública do vídeo Facebook." }],
    example: "/api/rest/facebook?url=https%3A%2F%2Ffb.watch%2FVIDEO_ID",
    response: "JSON com uma ou mais URLs de vídeo e metadados.",
  },
  {
    id: "instagram",
    title: "Instagram",
    category: "download",
    method: "GET",
    path: "/api/rest/instagram",
    description: "Resolve publicações e Reels públicos do Instagram.",
    parameters: [{ name: "url", required: true, description: "URL pública da publicação ou Reel." }],
    example: "/api/rest/instagram?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FSHORTCODE%2F",
    response: "JSON com URLs de mídia, tipo e metadados.",
  },
  {
    id: "auto-download",
    title: "Download automático",
    category: "download",
    method: "GET",
    path: "/api/rest/auto",
    description: "Escolhe automaticamente o resolvedor para a plataforma do link.",
    parameters: [{ name: "url", required: true, description: "URL pública de uma plataforma suportada." }],
    example: "/api/rest/auto?url=https%3A%2F%2Fwww.tiktok.com%2F%40perfil%2Fvideo%2F123",
    response: "JSON normalizado pelo resolvedor específico da plataforma.",
  },
  {
    id: "attp",
    title: "ATTp · figurinha de texto",
    category: "utility",
    method: "GET",
    path: "/api/rest/attp",
    description: "Gera uma figurinha WebP com o texto informado.",
    parameters: [{ name: "text", required: true, description: "Texto da figurinha (q também é aceito)." }],
    example: "/api/rest/attp?text=Olá%20BotAdmin",
    response: "Imagem WebP inline.",
  },
];

