export type AdminCommandToggle = {
  key: string;
  label: string;
  description?: string;
  default: boolean;
};

// Espelha os toggles padrão do arquivo lib/bot-group-settings.ts
export const DEFAULT_ADMIN_COMMANDS: AdminCommandToggle[] = [
  { key: 'autoresposta', label: 'Auto-resposta', default: false },
  { key: 'botinterage', label: 'IA conversa', default: false },
  { key: 'vozbotinterage', label: 'IA voz', default: false },
  { key: 'ouviraudiobotinterage', label: 'IA ouvir áudios', default: false },
  { key: 'lerimagem', label: 'Ler imagem', default: false },
  { key: 'autosticker', label: 'Auto-sticker', default: false },
  { key: 'autodownloader', label: 'Auto-downloader', default: false },
  { key: 'bemvindo', label: 'Mensagem de boas-vindas', default: false },
  { key: 'antisticker', label: 'Anti-figurinha', default: false },
  { key: 'antimage', label: 'Anti-imagem', default: false },
  { key: 'antvideo', label: 'Anti-vídeo', default: false },
  { key: 'antaudio', label: 'Anti-áudio', default: false },
  { key: 'antdoc', label: 'Anti-documento', default: false },
  { key: 'antvcard', label: 'Anti-contato', default: false },
  // Herdado do botadmin
  { key: 'moderacaocomia', label: 'Moderação com IA', default: false },
  { key: 'antilink', label: 'Anti-link', default: false },
  { key: 'antilinkgp', label: 'Anti-link convite', default: false },
  { key: 'antipalavras', label: 'Anti-palavras', default: false },
  { key: 'banextremo', label: 'Ban extremo', default: false },
  { key: 'bangringos', label: 'Ban DDI não permitidos', default: false },
  { key: 'antinsfwimagem', label: 'Anti-NSFW (imagem)', default: false },
  { key: 'proibirnsfw', label: 'Proibir NSFW', default: false },
  { key: 'soadm', label: 'Somente admins', default: false },
  { key: 'brincadeiras', label: 'Brincadeiras', default: false },
  { key: 'linkmembro', label: 'Permitir link de membro', default: false },
];
