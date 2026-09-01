export type PvCommandEntry = {
  key: string;
  label: string;
  description?: string;
  adminOnly?: boolean;
};

export type PvCommandCategory = {
  id: string;
  title: string;
  description?: string;
  commands: PvCommandEntry[];
};

const curatedCategories: PvCommandCategory[] = [
  {
    id: "shortcuts",
    title: "Atalhos do menu",
    commands: [
      { key: "menu", label: "menu", description: "Abre o menu principal com botões rápidos." },
      { key: "comandos", label: "comandos", description: "Envia a lista de comandos disponíveis para o usuário." },
      { key: "menuadm", label: "menuadm", description: "Abre o menu de administração para quem for admin." },
      { key: "menuativacoes", label: "menuativacoes", description: "Mostra os recursos de ativação do bot." },
      { key: "menudownloads", label: "menudownloads", description: "Mostra atalhos de download e mídia." },
    ],
  },
  {
    id: "downloads",
    title: "Downloads e conversões",
    commands: [
      { key: "play", label: "play", description: "Busca áudio ou vídeo no YouTube." },
      { key: "yt", label: "yt", description: "Retorna prévias e links do YouTube." },
      { key: "ytmp3", label: "ytmp3", description: "Converte link ou termo em MP3." },
      { key: "ytmp4", label: "ytmp4", description: "Baixa o vídeo completo em MP4." },
      { key: "tiktok", label: "tiktok", description: "Remove marca d'água de vídeos do TikTok." },
      { key: "douyin", label: "douyin", description: "Baixa vídeos de links do Douyin." },
      { key: "kwai", label: "kwai", description: "Baixa links do Kwai." },
      { key: "savepin", label: "savepin", description: "Downloads do Pinterest." },
      { key: "spotify", label: "spotify", description: "Converte faixas em MP3 com capa." },
      { key: "soundcloud", label: "soundcloud", description: "Baixa links do SoundCloud." },
      { key: "bandcamp", label: "bandcamp", description: "Converte faixas do Bandcamp." },
      { key: "mixcloud", label: "mixcloud", description: "Download de programas do Mixcloud." },
      { key: "twitterspaces", label: "twitterspaces", description: "Extrai áudio de Twitter/X Spaces." },
      { key: "twitch", label: "twitch", description: "Baixa clips e VODs públicos." },
      { key: "rumble", label: "rumble", description: "Downloads do Rumble." },
      { key: "odysee", label: "odysee", description: "Baixa vídeos do Odysee/LBRY." },
      { key: "dailymotion", label: "dailymotion", description: "Downloads do Dailymotion." },
      { key: "facebook", label: "facebook", description: "Baixa vídeos do Facebook/FB Watch." },
      { key: "mediafire", label: "mediafire", description: "Baixa arquivos hospedados." },
    ],
  },
  {
    id: "media-tools",
    title: "Ferramentas de mídia",
    commands: [
      { key: "sticker", label: "sticker", description: "Converte imagens/vídeos em figurinha respondendo uma mídia." },
      { key: "sticker2", label: "sticker2", description: "Gera figurinha quadrada (s2) com recorte centralizado." },
      { key: "attp", label: "attp", description: "Cria figurinhas animadas com texto." },
      { key: "attp2", label: "attp2", description: "Variante com outra paleta de cores." },
      { key: "attp3", label: "attp3", description: "Sticker com fundo branco e tipografia automática." },
      { key: "tomp3", label: "tomp3", description: "Extrai o áudio MP3 de um vídeo enviado ou respondido." },
      { key: "rename", label: "rename", description: "Reescreve os metadados de um sticker respondido." },
      { key: "revelar", label: "revelar", description: "Reenvia mídias de visualização única (view-once)." },
    ],
  },
  {
    id: "services",
    title: "Serviços integrados",
    commands: [
      { key: "sisreg", label: "sisreg", description: "Consulta de senhas e status do SISREG." },
      { key: "rmsisreg", label: "rmsisreg", description: "Cancela alertas ativos do SISREG." },
    ],
  },
];

export const PV_COMMAND_CATEGORIES: PvCommandCategory[] = curatedCategories;

export const ALL_PV_COMMAND_KEYS = curatedCategories.flatMap((category) =>
  category.commands.map((entry) => entry.key),
);
