import { DEFAULT_MENU_TEXTS } from "resources/default-menu-texts";
import {
  getPublicCommandInfo,
  normalizeCommand,
  type CommandFunctionInfo,
} from "lib/command-tutorials";
import type { BotGroupMenuTexts } from "types/bot-groups";

type ActivationPreset = {
  emoji: string;
  title: string;
  on: { label: string; description: string; cta: string };
  off: { label: string; description: string; cta: string };
};

type MediaGuardKind = "sticker" | "image" | "video" | "audio" | "document" | "vcard";

export type CommandPreviewMessage = {
  id: string;
  from: "user" | "member" | "bot" | "system" | "event";
  text: string;
  sender?: string;
  buttons?: string[];
  footer?: string | null;
  sourceLabel?: string;
};

export type CommandPreviewScenario = {
  command: string;
  commandText: string;
  sourceLabel: string;
  intro: string;
  steps: string[];
  messages: CommandPreviewMessage[];
};

const PREVIEW_REPLACEMENTS: Record<string, string> = {
  usuario: "Maria",
  bot: "botadmin-demo",
  nomebot: "BotAdmin",
  numerobot: "5511999999999",
  vencimento: "Plano ativo - 30/06/2026",
  origem: "Plano Premium",
  coveragesource: "Plano Premium",
  datavencimento: "2026-06-30",
  prefix: "!",
  prefixo: "!",
  grupo: "120363000000000000@g.us",
  nomegrupo: "Grupo de exemplo",
  lista: "",
};

const ACTIVATION_PRESETS: Record<string, ActivationPreset> = {
  antilink: {
    emoji: "🛡️",
    title: "ANTILINK",
    on: {
      label: "Ativado ✅",
      description: "Links fora da lista de permissões serão removidos automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Links enviados pelos participantes não serão mais bloqueados.",
      cta: "ativar",
    },
  },
  antilinkgp: {
    emoji: "🔗",
    title: "ANTILINK INVITE",
    on: {
      label: "Ativado ✅",
      description: "Convites de grupos e canais do WhatsApp serão apagados.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Convites de grupos e canais não serão mais removidos automaticamente.",
      cta: "ativar",
    },
  },
  banextremo: {
    emoji: "⛔",
    title: "BAN EXTREMO",
    on: {
      label: "Ativado ✅",
      description: "Quem enviar links proibidos será banido e a mensagem será apagada.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Links proibidos não causarão banimento automático.",
      cta: "ativar",
    },
  },
  bangringos: {
    emoji: "🚷",
    title: "BAN DDI",
    on: {
      label: "Ativado ✅",
      description: "Participantes com DDI não permitido serão removidos automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Participantes de outros DDI não serão mais removidos automaticamente.",
      cta: "ativar",
    },
  },
  antipalavras: {
    emoji: "🚫",
    title: "ANTI PALAVRAS",
    on: {
      label: "Ativado ✅",
      description: "Mensagens com palavras proibidas serão apagadas automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "As palavras configuradas não serão mais filtradas.",
      cta: "ativar",
    },
  },
  soadm: {
    emoji: "👮",
    title: "SOMENTE ADMINS",
    on: {
      label: "Ativado ✅",
      description: "Somente administradores poderão interagir com o robô.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Todos os participantes podem voltar a usar o robô.",
      cta: "ativar",
    },
  },
  autoresposta: {
    emoji: "💬",
    title: "AUTO RESPOSTA",
    on: {
      label: "Ativada ✅",
      description: "As respostas automáticas configuradas serão disparadas no grupo.",
      cta: "desativar",
    },
    off: {
      label: "Desativada ❌",
      description: "Respostas automáticas não serão mais enviadas.",
      cta: "ativar",
    },
  },
  autosticker: {
    emoji: "🎨",
    title: "AUTOSTICKER",
    on: {
      label: "Ativado ✅",
      description: "Imagens e vídeos curtos serão convertidos em figurinhas automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Mídias não serão mais transformadas em figurinhas.",
      cta: "ativar",
    },
  },
  autodownloader: {
    emoji: "📥",
    title: "AUTO DOWNLOADER",
    on: {
      label: "Ativado ✅",
      description: "Links compatíveis terão conteúdos baixados automaticamente pelo robô.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "O robô não fará mais downloads automáticos de links enviados.",
      cta: "ativar",
    },
  },
  bemvindo: {
    emoji: "👋",
    title: "BOAS-VINDAS",
    on: {
      label: "Ativado ✅",
      description: "Novos participantes receberão a mensagem de boas-vindas configurada.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Mensagens de boas-vindas não serão mais enviadas automaticamente.",
      cta: "ativar",
    },
  },
  botinterage: {
    emoji: "🤖",
    title: "BOT INTERAGE",
    on: {
      label: "Ativado ✅",
      description: "A IA responderá mensagens no grupo quando mencionada.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "A IA não responderá mais automaticamente no grupo.",
      cta: "ativar",
    },
  },
  vozbotinterage: {
    emoji: "🎙️",
    title: "BOT VOZ",
    on: {
      label: "Ativado ✅",
      description: "O robô poderá responder com mensagens de voz.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Respostas em voz foram desativadas.",
      cta: "ativar",
    },
  },
  ouviraudiobotinterage: {
    emoji: "👂",
    title: "IA OUVIR ÁUDIOS",
    on: {
      label: "Ativado ✅",
      description: "Notas de voz serão transcritas e respondidas pela IA do grupo.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Notas de voz não serão enviadas para a IA.",
      cta: "ativar",
    },
  },
  lerimagem: {
    emoji: "🖼️",
    title: "LER IMAGEM",
    on: {
      label: "Ativado ✅",
      description: "O robô tentará ler textos em imagens automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "O OCR automático foi desativado para novas imagens.",
      cta: "ativar",
    },
  },
  moderacaocomia: {
    emoji: "🧠",
    title: "MODERAÇÃO IA",
    on: {
      label: "Ativada ✅",
      description: "A moderação assistida por IA está ativa para revisar mensagens.",
      cta: "desativar",
    },
    off: {
      label: "Desativada ❌",
      description: "A moderação assistida por IA foi desativada.",
      cta: "ativar",
    },
  },
  antisticker: {
    emoji: "🚫",
    title: "ANTI FIGURINHA",
    on: {
      label: "Ativado ✅",
      description: "Figurinhas enviadas serão removidas automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Figurinhas não serão mais bloqueadas.",
      cta: "ativar",
    },
  },
  antimage: {
    emoji: "🖼️",
    title: "ANTI IMAGEM",
    on: {
      label: "Ativado ✅",
      description: "Imagens compartilhadas pelos participantes serão apagadas.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Imagens não serão mais bloqueadas automaticamente.",
      cta: "ativar",
    },
  },
  antvideo: {
    emoji: "🎞️",
    title: "ANTI VÍDEO",
    on: {
      label: "Ativado ✅",
      description: "Vídeos enviados serão removidos automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Vídeos não serão mais bloqueados.",
      cta: "ativar",
    },
  },
  antaudio: {
    emoji: "🎧",
    title: "ANTI ÁUDIO",
    on: {
      label: "Ativado ✅",
      description: "Áudios e notas de voz serão apagados assim que enviados.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Áudios não serão mais bloqueados automaticamente.",
      cta: "ativar",
    },
  },
  antdoc: {
    emoji: "📄",
    title: "ANTI DOCUMENTO",
    on: {
      label: "Ativado ✅",
      description: "Documentos compartilhados serão excluídos automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Documentos não serão mais bloqueados pelo robô.",
      cta: "ativar",
    },
  },
  antvcard: {
    emoji: "📇",
    title: "ANTI CONTATO",
    on: {
      label: "Ativado ✅",
      description: "Contatos e vCards enviados no grupo serão removidos.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "Contatos compartilhados não serão mais bloqueados.",
      cta: "ativar",
    },
  },
  antinsfwimagem: {
    emoji: "🔞",
    title: "ANTI NSFW",
    on: {
      label: "Ativado ✅",
      description: "Imagens e figurinhas impróprias serão removidas automaticamente.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "O filtro de NSFW para imagens e figurinhas foi desativado.",
      cta: "ativar",
    },
  },
  proibirnsfw: {
    emoji: "🔞",
    title: "PROIBIR NSFW",
    on: {
      label: "Ativado ✅",
      description: "Conteúdos NSFW em imagens e figurinhas serão bloqueados.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "O bloqueio de conteúdos NSFW foi desativado.",
      cta: "ativar",
    },
  },
};

const MEDIA_GUARD_NOTICE_TEMPLATES: Record<
  MediaGuardKind,
  { emoji: string; description: string; command: string; sample: string }
> = {
  sticker: {
    emoji: "🚫",
    description: "figurinhas não são permitidas neste grupo.",
    command: "antisticker",
    sample: "[figurinha enviada]",
  },
  image: {
    emoji: "🖼️",
    description: "imagens não são permitidas neste grupo.",
    command: "antimage",
    sample: "[imagem enviada]",
  },
  video: {
    emoji: "🎞️",
    description: "vídeos não são permitidos neste grupo.",
    command: "antvideo",
    sample: "[vídeo enviado]",
  },
  audio: {
    emoji: "🎧",
    description: "áudios não são permitidos neste grupo.",
    command: "antaudio",
    sample: "[áudio enviado]",
  },
  document: {
    emoji: "📄",
    description: "documentos não são permitidos neste grupo.",
    command: "antdoc",
    sample: "📄 catalogo.pdf",
  },
  vcard: {
    emoji: "📇",
    description: "contatos em vCard não são permitidos neste grupo.",
    command: "antvcard",
    sample: "📇 Contato salvo",
  },
};

const applyPreviewPlaceholders = (value: string): string =>
  value.replace(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
    const key = String(doubleKey ?? singleKey ?? "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(PREVIEW_REPLACEMENTS, key)
      ? PREVIEW_REPLACEMENTS[key]
      : match;
  });

const renderMenuText = (key: keyof BotGroupMenuTexts): string =>
  (DEFAULT_MENU_TEXTS[key] ?? [])
    .map((line) => applyPreviewPlaceholders(line).replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const commandOnly = (value: string): string => normalizeCommand(value).replace(/\s.+$/u, "");

const getUsageText = (command: string, info: CommandFunctionInfo | null): string => {
  const usage = info?.usage?.find((item) => item.trim().startsWith("!"));
  return usage?.trim() || `!${normalizeCommand(command)}`;
};

const message = {
  system: (id: string, text: string): CommandPreviewMessage => ({ id, from: "system", text }),
  event: (id: string, text: string): CommandPreviewMessage => ({ id, from: "event", text }),
  admin: (id: string, text: string): CommandPreviewMessage => ({ id, from: "user", text }),
  member: (id: string, text: string, sender = "@usuario"): CommandPreviewMessage => ({
    id,
    from: "member",
    sender,
    text,
  }),
  bot: (
    id: string,
    text: string,
    options?: Pick<CommandPreviewMessage, "buttons" | "footer" | "sourceLabel">,
  ): CommandPreviewMessage => ({ id, from: "bot", sender: "BotAdmin", text, ...options }),
};

const renderToggleAnnouncement = (commandKey: string, enabled = true, prefix = "!"): string => {
  const key = commandKey.toLowerCase();
  const preset: ActivationPreset = ACTIVATION_PRESETS[key] ?? {
    emoji: "⚙️",
    title: key.toUpperCase(),
    on: {
      label: "Ativado ✅",
      description: "A função foi ativada com sucesso.",
      cta: "desativar",
    },
    off: {
      label: "Desativado ❌",
      description: "A função foi desativada com sucesso.",
      cta: "ativar",
    },
  };
  const state = enabled ? preset.on : preset.off;
  return [
    `${preset.emoji} ${preset.title} ${state.label}`,
    "",
    `${state.description} Use o comando abaixo para ${state.cta} esta função novamente 👇`,
    "",
    "╔═════ᴄᴍᴅ═════╗",
    `     ${prefix}${key}`,
    "╚═════════════╝",
  ].join("\n");
};

const renderMediaGuardNotice = (kind: MediaGuardKind, prefix = "!", memberLabel = "@usuario"): string => {
  const template = MEDIA_GUARD_NOTICE_TEMPLATES[kind];
  return `${template.emoji} ${memberLabel} ${template.description} Se você for administrador, use ${prefix}${template.command} para ajustar esta proteção.`;
};

const renderNsfwGuardNotice = (prefix = "!", memberLabel = "@usuario"): string =>
  `🔞 ${memberLabel} conteúdo impróprio (NSFW) detectado e removido automaticamente. Se você for administrador, use ${prefix}antinsfwimagem para ajustar esta proteção.`;

const scenario = (input: CommandPreviewScenario): CommandPreviewScenario => input;

const activationSteps = (commandText: string, infraction: string, result: string): string[] => [
  `Admin envia ${commandText} e o bot confirma a ativação.`,
  infraction,
  result,
];

const activationStart = (normalized: string, commandText = `!${normalized}`): CommandPreviewMessage[] => [
  message.system("intro", "Simulação no grupo"),
  message.admin("activate", commandText),
  message.bot("activation-result", renderToggleAnnouncement(normalized)),
];

const buildMenuScenario = (
  normalized: string,
  info: CommandFunctionInfo | null,
): CommandPreviewScenario | null => {
  const menuMap: Partial<Record<keyof BotGroupMenuTexts | string, keyof BotGroupMenuTexts>> = {
    m: "main",
    menu: "main",
    menuadm: "admin",
    menuadmin: "admin",
    menudownloads: "downloads",
    menudownload: "downloads",
    menuativacoes: "ativacoes",
    menuativacao: "ativacoes",
    menuoutros: "outros",
    outros: "outros",
    menucomandos: "comandos",
    jogos: "jogos",
    menujogos: "jogos",
  };

  const section = normalized === "comandos" ? "comandos" : menuMap[normalized];
  if (!section) return null;

  const text = renderMenuText(section);
  const isMainMenu = section === "main";
  const commandText = normalized === "m" ? "!m" : `!${normalized}`;

  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Menu padrão do BotAdmin",
    intro: "A simulação mostra o menu padrão que o bot envia quando o grupo ainda não personalizou o texto.",
    steps: [
      `Usuário envia ${commandText}.`,
      "BotAdmin abre a seção do menu no WhatsApp.",
      isMainMenu ? "Botões de atalho aparecem junto com o menu principal." : "A lista de comandos aparece no balão do bot.",
    ],
    messages: [
      message.system("intro", "Fluxo real do menu no grupo"),
      message.admin("user-command", commandText),
      message.bot("bot-result", text, {
        buttons: isMainMenu ? ["📜 Comandos", "🛡️ Menu ADM", "⚙️ Menu ativações"] : undefined,
        sourceLabel: info?.adminOnly ? "Restrito a admins" : "Disponível no grupo",
      }),
    ],
  });
};

const buildLinkGuardScenario = (normalized: string): CommandPreviewScenario | null => {
  if (!["antilink", "antilinkgp", "banextremo"].includes(normalized)) return null;

  const commandText = `!${normalized}`;
  const invite = normalized === "antilinkgp";
  const extreme = normalized === "banextremo";
  const sampleLink = invite
    ? "Entra nesse grupo: https://chat.whatsapp.com/ABCDE12345"
    : "Promoção aqui: https://spam.example/oferta";

  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo real de proteção",
    intro: "O celular mostra a ativação, a infração do membro e a ação automática aplicada pelo bot.",
    steps: activationSteps(
      commandText,
      invite ? "Membro envia convite de outro grupo." : "Membro envia link não permitido.",
      extreme
        ? "BotAdmin apaga a mensagem e remove o participante."
        : "BotAdmin apaga a mensagem, registra infração e avisa quantas faltam antes do banimento.",
    ),
    messages: [
      ...activationStart(normalized, commandText),
      message.member("violation", sampleLink),
      message.event("delete-event", "BotAdmin apagou a mensagem de @usuario"),
      ...(extreme
        ? [message.event("ban-event", "BotAdmin removeu @usuario")]
        : [
            message.bot(
              "warning",
              "⚠️ @usuario envio de links não permitido. Restam 2 infração(ões) antes do banimento automático.",
            ),
          ]),
    ],
  });
};

const buildMediaGuardScenario = (normalized: string): CommandPreviewScenario | null => {
  const guardMap: Record<string, MediaGuardKind> = {
    antisticker: "sticker",
    antimage: "image",
    antvideo: "video",
    antaudio: "audio",
    antdoc: "document",
    antvcard: "vcard",
  };
  const kind = guardMap[normalized];
  if (!kind) return null;
  const template = MEDIA_GUARD_NOTICE_TEMPLATES[kind];
  const commandText = `!${normalized}`;

  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo real de proteção",
    intro: "O celular mostra o comando sendo ativado e a mídia proibida sendo apagada no grupo.",
    steps: activationSteps(
      commandText,
      `Membro envia ${template.description.replace(" não são permitidas neste grupo.", "").replace(" não são permitidos neste grupo.", "")}.`,
      "BotAdmin apaga a mídia e envia o aviso de proteção no mesmo grupo.",
    ),
    messages: [
      ...activationStart(normalized, commandText),
      message.member("violation", template.sample),
      message.event("delete-event", "BotAdmin apagou a mensagem de @usuario"),
      message.bot("notice", renderMediaGuardNotice(kind)),
    ],
  });
};

const buildNsfwScenario = (normalized: string): CommandPreviewScenario | null => {
  if (!["antinsfwimagem", "proibirnsfw"].includes(normalized)) return null;
  const commandText = `!${normalized}`;
  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo real de proteção",
    intro: "O celular mostra o filtro NSFW removendo automaticamente imagem ou figurinha imprópria.",
    steps: activationSteps(
      commandText,
      "Membro envia imagem imprópria no grupo.",
      "BotAdmin detecta o conteúdo, apaga a mídia e envia o aviso de NSFW.",
    ),
    messages: [
      ...activationStart(normalized, commandText),
      message.member("violation", "[imagem imprópria enviada]"),
      message.event("delete-event", "BotAdmin apagou a mensagem de @usuario"),
      message.bot("notice", renderNsfwGuardNotice()),
    ],
  });
};

const buildAntiWordsScenario = (normalized: string): CommandPreviewScenario | null => {
  if (normalized !== "antipalavras") return null;
  const commandText = "!antipalavras";
  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo real de proteção",
    intro: "O celular mostra a palavra proibida sendo bloqueada no grupo depois da ativação.",
    steps: activationSteps(
      commandText,
      "Membro envia mensagem com palavra bloqueada.",
      "BotAdmin apaga a mensagem. Se o modo banir estiver ativo, a remoção acontece ao atingir o limite.",
    ),
    messages: [
      ...activationStart(normalized, commandText),
      message.member("violation", "Essa mensagem tem palavra proibida"),
      message.event("delete-event", "BotAdmin apagou a mensagem de @usuario"),
      message.bot(
        "ban-warning",
        "🚫 Você atingiu o limite de infrações de palavras proibidas e está sendo removido do grupo.\nSe acha que isso foi um engano, contate um dos administradores.",
      ),
      message.event("ban-event", "BotAdmin removeu @usuario"),
    ],
  });
};

const buildBangringosScenario = (normalized: string): CommandPreviewScenario | null => {
  if (normalized !== "bangringos") return null;
  const commandText = "!bangringos";
  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo real de proteção",
    intro: "O celular mostra o filtro de DDI removendo participante fora da lista permitida.",
    steps: activationSteps(
      commandText,
      "Número com DDI não permitido envia mensagem no grupo.",
      "BotAdmin apaga a mensagem, avisa a regra de DDI e remove o participante.",
    ),
    messages: [
      ...activationStart(normalized, commandText),
      message.member("violation", "Oi, alguém me adicionou aqui", "@+1 202 555 0100"),
      message.event("delete-event", "BotAdmin apagou a mensagem de @+1 202 555 0100"),
      message.bot(
        "notice",
        "🚷 Este grupo aceita apenas DDI(s) 55. Mensagens de números não autorizados serão removidas automaticamente.",
      ),
      message.event("ban-event", "BotAdmin removeu @+1 202 555 0100"),
    ],
  });
};

const buildAutomationScenario = (normalized: string): CommandPreviewScenario | null => {
  const commandText = `!${normalized}`;
  if (normalized === "autodownloader") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de automação",
      intro: "O celular mostra o membro enviando um link compatível e o bot baixando o conteúdo sozinho.",
      steps: activationSteps(
        commandText,
        "Membro envia link compatível com download automático.",
        "BotAdmin reage ao link e devolve a mídia pronta no grupo.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.member("link", "https://www.tiktok.com/@criador/video/123456789"),
        message.event("reaction", "BotAdmin reagiu com ⬇️"),
        message.bot("result", "🎬 Vídeo baixado automaticamente pelo BotAdmin."),
      ],
    });
  }

  if (normalized === "autosticker") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de automação",
      intro: "O celular mostra a imagem enviada por um membro virando figurinha automaticamente.",
      steps: activationSteps(
        commandText,
        "Membro envia uma imagem no grupo.",
        "BotAdmin converte a mídia e responde com a figurinha.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.member("image", "[imagem enviada]"),
        message.bot("sticker", "[figurinha criada automaticamente]"),
      ],
    });
  }

  if (normalized === "bemvindo") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de boas-vindas",
      intro: "O celular mostra o participante entrando e recebendo a mensagem configurada pelo grupo.",
      steps: activationSteps(
        commandText,
        "Novo participante entra pelo link do grupo.",
        "BotAdmin envia a mensagem de boas-vindas com texto, mídia e botões quando configurados.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.event("join", "Maria entrou usando o link de convite deste grupo"),
        message.bot(
          "welcome",
          "✨ Bem-vindo ✨\n👤 Usuário: Maria\n📱 Número: 5511999999999\n👥 Grupo: Grupo de exemplo\n📅 Data: 14/05/2026\n⏰ Horário: 11:14\n\n⚡ Utilize o prefixo ! para comandos!",
          { buttons: ["📜 Ver regras", "🔗 Grupo oficial"] },
        ),
      ],
    });
  }

  if (normalized === "botinterage" || normalized === "vozbotinterage" || normalized === "ouviraudiobotinterage") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de IA",
      intro:
        normalized === "vozbotinterage"
          ? "O celular mostra a IA respondendo em áudio quando o modo de voz está ativo."
          : normalized === "ouviraudiobotinterage"
            ? "O celular mostra uma nota de voz sendo transcrita e respondida pela IA."
          : "O celular mostra a IA respondendo uma pergunta dentro do grupo.",
      steps: activationSteps(
        commandText,
        "Membro chama o bot no grupo.",
        normalized === "vozbotinterage"
          ? "BotAdmin devolve a resposta em áudio."
          : normalized === "ouviraudiobotinterage"
            ? "BotAdmin transcreve a nota de voz e responde usando o contexto do grupo."
            : "BotAdmin responde com IA no balão do grupo.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.member("question", "BotAdmin, resume as regras do grupo?"),
        message.bot(
          "answer",
          normalized === "vozbotinterage"
            ? "🎙️ Áudio gerado: resumo das regras do grupo."
            : normalized === "ouviraudiobotinterage"
              ? "Entendi sua nota de voz. Aqui está a resposta com base no que você pediu."
            : "Claro. As regras principais são respeitar os membros, evitar spam e seguir as orientações dos administradores.",
        ),
      ],
    });
  }

  if (normalized === "lerimagem") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de IA visual",
      intro: "O celular mostra o bot lendo uma imagem enviada no grupo.",
      steps: activationSteps(
        commandText,
        "Membro envia imagem com texto.",
        "BotAdmin lê a imagem e responde com o conteúdo encontrado.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.member("image", "[imagem com texto enviada]"),
        message.bot("ocr", "🖼️ Texto encontrado na imagem:\nPromoção válida até hoje às 18h."),
      ],
    });
  }

  if (normalized === "moderacaocomia") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de moderação com IA",
      intro: "O celular mostra a IA ajudando a identificar mensagem inadequada e aplicar a moderação.",
      steps: activationSteps(
        commandText,
        "Membro envia mensagem ofensiva ou perigosa.",
        "BotAdmin remove a mensagem e registra a moderação do grupo.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.member("bad-message", "Mensagem ofensiva contra outro participante"),
        message.event("delete-event", "BotAdmin apagou a mensagem de @usuario"),
        message.bot("notice", "🧠 Mensagem removida pela moderação com IA por violar as regras do grupo."),
      ],
    });
  }

  if (normalized === "autoresposta") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de auto resposta",
      intro: "O celular mostra uma palavra-chave disparando a resposta automática cadastrada.",
      steps: activationSteps(
        commandText,
        "Membro envia uma palavra-chave cadastrada.",
        "BotAdmin responde com o texto salvo na auto resposta do grupo.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.member("trigger", "preço"),
        message.bot("reply", "O plano mensal do BotAdmin custa R$ 25 e inclui automações para o grupo."),
      ],
    });
  }

  if (normalized === "soadm") {
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de permissão",
      intro: "O celular mostra o robô ignorando comandos de membros quando o modo somente administradores está ativo.",
      steps: activationSteps(
        commandText,
        "Membro comum tenta usar comando do bot.",
        "BotAdmin bloqueia a interação e preserva os recursos do grupo para admins.",
      ),
      messages: [
        ...activationStart(normalized, commandText),
        message.member("member-command", "!play música"),
        message.bot("blocked", "🔒 Apenas administradores podem usar comandos do bot neste grupo."),
      ],
    });
  }

  return null;
};

const STATIC_COMMAND_SCENARIOS: Record<
  string,
  {
    commandText?: string;
    sourceLabel: string;
    messages: CommandPreviewMessage[];
    steps: string[];
    intro?: string;
  }
> = {
  fechargrupo: {
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!fechargrupo"),
      message.event(
        "group-event",
        "BotAdmin alterou as configurações deste grupo para permitir que somente admins enviem mensagens.",
      ),
      message.bot("result", "✅ Grupo fechado: apenas administradores podem enviar mensagens."),
    ],
    steps: [
      "Admin envia !fechargrupo.",
      "WhatsApp registra o grupo fechado para membros comuns.",
      "BotAdmin confirma a alteração no grupo.",
    ],
  },
  fechargp: {
    commandText: "!fechargp",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!fechargp"),
      message.event(
        "group-event",
        "BotAdmin alterou as configurações deste grupo para permitir que somente admins enviem mensagens.",
      ),
      message.bot("result", "✅ Grupo fechado: apenas administradores podem enviar mensagens."),
    ],
    steps: ["Admin envia !fechargp.", "Grupo fica fechado.", "BotAdmin confirma no WhatsApp."],
  },
  abrirgrupo: {
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!abrirgrupo"),
      message.event(
        "group-event",
        "BotAdmin alterou as configurações deste grupo para permitir que todos os participantes enviem mensagens.",
      ),
      message.bot("result", "✅ Grupo aberto: todos os participantes podem enviar mensagens."),
    ],
    steps: ["Admin envia !abrirgrupo.", "WhatsApp libera mensagens de todos.", "BotAdmin confirma no grupo."],
  },
  abrirgp: {
    commandText: "!abrirgp",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!abrirgp"),
      message.event(
        "group-event",
        "BotAdmin alterou as configurações deste grupo para permitir que todos os participantes enviem mensagens.",
      ),
      message.bot("result", "✅ Grupo aberto: todos os participantes podem enviar mensagens."),
    ],
    steps: ["Admin envia !abrirgp.", "Grupo fica aberto.", "BotAdmin confirma no WhatsApp."],
  },
  addregras: {
    commandText: "!addregras Respeite os membros e evite spam.",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!addregras Respeite os membros e evite spam."),
      message.bot("result", "✅ Regras atualizadas com sucesso!"),
      message.member("ask", "!regras"),
      message.bot("rules", "Respeite os membros e evite spam."),
    ],
    steps: ["Admin salva as regras.", "Membro consulta !regras.", "BotAdmin envia o texto salvo."],
  },
  regras: {
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.member("command", "!regras"),
      message.bot("rules", "📌 Regras do grupo\n\n1. Respeite todos os membros.\n2. Não envie spam.\n3. Siga as orientações dos administradores."),
    ],
    steps: ["Membro envia !regras.", "BotAdmin busca as regras salvas.", "As regras aparecem no grupo."],
  },
  addtabela: {
    commandText: "!addtabela Plano mensal: R$ 25",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!addtabela Plano mensal: R$ 25"),
      message.bot("result", "✅ Tabela atualizada com sucesso!"),
      message.member("ask", "!tabela"),
      message.bot("table", "Plano mensal: R$ 25"),
    ],
    steps: ["Admin salva a tabela.", "Membro consulta !tabela.", "BotAdmin envia o conteúdo salvo."],
  },
  tabela: {
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.member("command", "!tabela"),
      message.bot("table", "📋 Tabela do grupo\n\nPlano mensal: R$ 25\nPlano anual: R$ 240"),
    ],
    steps: ["Membro envia !tabela.", "BotAdmin busca a tabela salva.", "A tabela aparece no grupo."],
  },
  mutar: {
    commandText: "!mutar 3 @usuario",
    sourceLabel: "Fluxo real de mute",
    intro: "O celular mostra o mute, as mensagens apagadas e a remoção ao insistir depois do limite.",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!mutar 3 @usuario"),
      message.bot(
        "muted",
        "@usuario, você foi mutado. Você está proibido de mandar mensagens aqui até um admin permitir novamente.",
      ),
      message.member("talk-1", "Mas eu ainda quero falar"),
      message.event("delete-1", "BotAdmin apagou a mensagem de @usuario"),
      message.bot("warn-1", "🤫 @usuario, você não pode falar nesse grupo por enquanto. Se continuar falando, será removido do grupo."),
      message.member("talk-2", "Eu vou falar mesmo assim"),
      message.event("delete-2", "BotAdmin apagou a mensagem de @usuario"),
      message.bot(
        "warn-2",
        "😠 @usuario, já avisei: se você continuar falando enquanto está mutado, vai ser banido. Para de insistir.",
      ),
      message.member("talk-3", "Última tentativa"),
      message.event("delete-3", "BotAdmin apagou a mensagem de @usuario"),
      message.bot("ban", "🚫 @usuario foi removido do grupo por insistir em falar enquanto estava mutado."),
      message.event("ban-event", "BotAdmin removeu @usuario"),
    ],
    steps: [
      "Admin envia !mutar com limite 3.",
      "Membro insiste em mandar mensagens e o bot apaga.",
      "No limite, BotAdmin remove o participante.",
    ],
  },
  silenciar: {
    commandText: "!silenciar 3 @usuario",
    sourceLabel: "Fluxo real de mute",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!silenciar 3 @usuario"),
      message.bot(
        "muted",
        "@usuario, você foi mutado. Você está proibido de mandar mensagens aqui até um admin permitir novamente.",
      ),
      message.member("talk", "Tentando falar mesmo mutado"),
      message.event("delete", "BotAdmin apagou a mensagem de @usuario"),
      message.bot("warn", "🤫 @usuario, você não pode falar nesse grupo por enquanto. Se continuar falando, será removido do grupo."),
    ],
    steps: ["Admin silencia o membro.", "Membro tenta falar.", "BotAdmin apaga e avisa."],
  },
  desmutar: {
    commandText: "!desmutar @usuario",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!desmutar @usuario"),
      message.bot("result", "✅ 1 participante(s) liberado(s)."),
      message.member("talk", "Agora consigo falar normalmente."),
    ],
    steps: ["Admin envia !desmutar.", "BotAdmin remove o bloqueio.", "O membro volta a conversar."],
  },
  ban: {
    commandText: "!ban @usuario",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!ban @usuario"),
      message.event("group-event", "BotAdmin removeu @usuario"),
      message.bot("result", "🛡️ Usuário removido por motivos justos."),
    ],
    steps: ["Admin menciona ou responde o membro.", "WhatsApp mostra a remoção.", "BotAdmin envia o fallback do ban."],
  },
  addblacklist: {
    commandText: "!addblacklist @usuario",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!addblacklist @usuario"),
      message.event("group-event", "BotAdmin removeu @usuario"),
      message.bot("result", "🚫 Número adicionado à lista de bloqueio.\n✅ Participante removido imediatamente."),
      message.event("return", "@usuario tentou entrar novamente pelo link"),
      message.event("blocked", "BotAdmin removeu @usuario"),
    ],
    steps: ["Admin adiciona na blacklist.", "Participante é removido.", "Se voltar ao grupo, o bot remove novamente."],
  },
  promover: {
    commandText: "!promover @usuario",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!promover @usuario"),
      message.event("group-event", "BotAdmin promoveu @usuario a admin"),
      message.bot("result", "🛡️ Cargo de administrador atualizado com sucesso."),
    ],
    steps: ["Admin envia !promover.", "WhatsApp registra o novo admin.", "BotAdmin confirma a alteração."],
  },
  rebaixar: {
    commandText: "!rebaixar @usuario",
    sourceLabel: "Mensagem real do bot",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", "!rebaixar @usuario"),
      message.event("group-event", "BotAdmin removeu @usuario da lista de admins"),
      message.bot("result", "✅ Membro rebaixado ao nível padrão."),
    ],
    steps: ["Admin envia !rebaixar.", "WhatsApp retira o cargo.", "BotAdmin confirma no grupo."],
  },
  apagar: {
    commandText: "!apagar",
    sourceLabel: "Fluxo real de apagar mensagem",
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.member("target", "Mensagem que precisa ser apagada"),
      message.admin("command", "!apagar"),
      message.event("delete-event", "BotAdmin apagou a mensagem de @usuario"),
      message.event("command-delete", "BotAdmin apagou o comando !apagar"),
    ],
    steps: ["Admin responde uma mensagem com !apagar.", "BotAdmin apaga a mensagem alvo.", "O comando também sai da conversa."],
  },
};

const STATIC_ALIASES: Record<string, string> = {
  kick: "ban",
  mban: "ban",
  avadakedrava: "ban",
  mute: "mutar",
  unmute: "desmutar",
  demote: "rebaixar",
  promote: "promover",
  delete: "apagar",
  del: "apagar",
  apagarmensagem: "apagar",
  promoveradm: "promover",
  promver: "promover",
  rebaixaradm: "rebaixar",
};

const buildStaticScenario = (normalized: string, info: CommandFunctionInfo | null): CommandPreviewScenario | null => {
  const key = STATIC_ALIASES[normalized] ?? normalized;
  const item = STATIC_COMMAND_SCENARIOS[key];
  if (!item) return null;
  const commandText = item.commandText ?? getUsageText(normalized, info);
  const messages = item.messages.map((entry) => {
    if (entry.id !== "command" || entry.from !== "user") return entry;
    return { ...entry, text: commandText };
  });
  return scenario({
    command: normalized,
    commandText,
    sourceLabel: item.sourceLabel,
    intro: item.intro ?? "O celular mostra a sequência esperada dentro do grupo no WhatsApp.",
    steps: item.steps,
    messages,
  });
};

const buildAdminConfigScenario = (normalized: string, info: CommandFunctionInfo | null): CommandPreviewScenario | null => {
  const commandText = getUsageText(normalized, info);
  const configMap: Record<string, string> = {
    prefix: "Prefixos atualizados: !, /",
    prefixo: "Prefixos atuais: !, /",
    id: "ID do grupo: 120363000000000000@g.us\nSeu ID: 5511999999999",
    linkgp: "🔗 Link do grupo:\nhttps://chat.whatsapp.com/ABCDE12345",
    vencimento: "📅 Plano ativo até 30/06/2026.",
    participantes: "👥 Participantes do grupo: 128",
    dono: "👑 Dono do grupo: @administrador",
    painel: "🔐 Acesse seu painel BotAdmin:\nhttps://botadmin.shop/painel",
  };
  const text = configMap[normalized];
  if (!text) return null;
  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Mensagem realista do bot",
    intro: "O celular mostra a consulta ou configuração sendo respondida no grupo.",
    steps: [`Usuário envia ${commandText}.`, "BotAdmin consulta os dados do grupo.", "A resposta aparece no WhatsApp."],
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", commandText),
      message.bot("result", text),
    ],
  });
};

const buildDownloadScenario = (normalized: string, info: CommandFunctionInfo | null): CommandPreviewScenario | null => {
  const isDownload = /^(play|yt|ytsearch|ytmp3|ytmp4|tomp3|tiktok|kwai|savepin|pinterest|pin|insta|instagram|facebook|spotify|spotifydl|soundcloud|bandcamp|mixcloud|twitterspaces|twitch|rumble|odysee|dailymotion|mediafire|playstore|uptodown|apkmodhacker|filme|movie|serie|series|série|gpwhatsapp|instastalk|resolve|resolver|desencurtar|unshorten|tourl|tuurl|freepik|envato|shopee|mercadolivre|amazon)$/.test(
    normalized,
  );
  if (!isDownload) return null;
  const commandText = getUsageText(normalized, info);
  const result =
    normalized.includes("mp3") || normalized === "play" || normalized === "spotify" || normalized === "spotifydl"
      ? "🎧 Áudio encontrado e enviado no grupo."
      : normalized === "ytsearch"
        ? "🔎 Resultados encontrados no YouTube.\n1. Tutorial BotAdmin\n2. Automação para WhatsApp\n3. Robô para grupos"
        : normalized === "tourl" || normalized === "tuurl"
          ? "✅ Link gerado para a mídia:\nhttps://files.botadmin.shop/midia-demo"
          : "🎬 Conteúdo encontrado e enviado no grupo.";
  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo real de download",
    intro: "O celular mostra o pedido de download, o processamento e a mídia sendo entregue no grupo.",
    steps: [`Usuário envia ${commandText}.`, "BotAdmin busca o conteúdo.", "O arquivo ou resultado aparece na conversa."],
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.member("command", commandText),
      message.event("reaction", "BotAdmin reagiu com ⬇️"),
      message.bot("result", result),
    ],
  });
};

const buildStickerAiScenario = (normalized: string, info: CommandFunctionInfo | null): CommandPreviewScenario | null => {
  if (/^(sticker|sticker2|s|s2)$/.test(normalized)) {
    const commandText = getUsageText(normalized, info);
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de figurinha",
      intro: "O celular mostra a mídia enviada e a figurinha sendo criada.",
      steps: ["Usuário responde uma imagem ou vídeo com o comando.", "BotAdmin converte a mídia.", "A figurinha aparece no grupo."],
      messages: [
        message.system("intro", "Fluxo do comando no grupo"),
        message.member("media", "[imagem enviada]"),
        message.member("command", commandText),
        message.bot("result", "[figurinha criada]"),
      ],
    });
  }

  if (/^(attp|attp2|attp3|frase|frase2|frase3|frase4|frasenovideo|frasenovideo2|frasevideo|gerarfrase)$/.test(normalized)) {
    const commandText = getUsageText(normalized, info);
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de mídia criativa",
      intro: "O celular mostra o texto virando figurinha, imagem ou vídeo conforme o comando.",
      steps: [`Usuário envia ${commandText}.`, "BotAdmin processa o texto.", "A mídia pronta aparece no WhatsApp."],
      messages: [
        message.system("intro", "Fluxo do comando no grupo"),
        message.member("command", commandText),
        message.bot("result", normalized.includes("video") ? "[vídeo com frase criado]" : "[figurinha com texto criada]"),
      ],
    });
  }

  if (/^(criarimagem|criarimage|createimage|removebg|removebg2|removebgec|rb2|rbgec|revelar|legendaaudio|tts|videotts|listatts|clonarvoz|rmtts|keygroq|promptbot)$/.test(normalized)) {
    const commandText = getUsageText(normalized, info);
    return scenario({
      command: normalized,
      commandText,
      sourceLabel: "Fluxo real de IA e mídia",
      intro: "O celular mostra o comando sendo processado e o resultado voltando no grupo.",
      steps: [`Usuário envia ${commandText}.`, "BotAdmin processa a solicitação.", "A resposta, áudio, imagem ou configuração aparece no WhatsApp."],
      messages: [
        message.system("intro", "Fluxo do comando no grupo"),
        message.member("command", commandText),
        message.event("processing", "BotAdmin está processando a solicitação"),
        message.bot("result", "✅ Resultado gerado e enviado no grupo."),
      ],
    });
  }

  return null;
};

const buildEngagementScenario = (normalized: string, info: CommandFunctionInfo | null): CommandPreviewScenario | null => {
  if (!/^(ranking|meuranking|resetarranking|sorteio|addrifa|rifa|rifas|comprarrifa|sortearrifa|cancelarrifa|bc|coins|coinsrank|menubotcoins|premium|comprarpremium|comprarcoins|all|allg|hidetag|hidetagall|marcar|menciona|mencionar|brincadeiras|feliz|nerding|menubrincadeiras)$/.test(normalized)) {
    return null;
  }
  const commandText = getUsageText(normalized, info);
  const adminCommand = info?.adminOnly || /^(resetarranking|addrifa|sortearrifa|cancelarrifa|all|allg|hidetag|hidetagall|marcar|menciona|mencionar)$/.test(normalized);
  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo realista no grupo",
    intro: "O celular mostra o comando de interação sendo executado dentro da conversa.",
    steps: [`${adminCommand ? "Admin" : "Membro"} envia ${commandText}.`, "BotAdmin executa a ação do grupo.", "O resultado aparece para todos."],
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      adminCommand ? message.admin("command", commandText) : message.member("command", commandText),
      message.bot("result", resultTextForEngagement(normalized)),
    ],
  });
};

const resultTextForEngagement = (normalized: string): string => {
  if (normalized.includes("ranking")) return "🏆 Ranking do grupo\n1. Maria - 120 pontos\n2. João - 98 pontos\n3. Ana - 75 pontos";
  if (normalized.includes("rifa")) return "🎟️ Rifa atualizada no grupo. Participantes podem consultar e comprar números disponíveis.";
  if (normalized === "premium") return "💎 Premium do grupo\nStatus: ativo até 14/06/2026\nComandos premium: !criarimagem, !tts";
  if (normalized === "comprarpremium") return "✅ Premium ativado neste grupo.\nValidade renovada conforme configuração do admin.";
  if (normalized.includes("coins") || normalized.startsWith("bc")) return "🪙 BotCoins\nSaldo de Maria: 50 coins\nUse moedas para premium ou comandos pagos.";
  if (/^(all|allg|hidetag|hidetagall|marcar|menciona|mencionar)$/.test(normalized)) return "📢 Aviso para todos os participantes do grupo.";
  return "✅ Interação enviada no grupo.";
};

const buildAutoResponseManagementScenario = (
  normalized: string,
  info: CommandFunctionInfo | null,
): CommandPreviewScenario | null => {
  if (!/^(addautorepo|rmautorepo|removeautorepo|listaautorepo|addads|addad|rmads|removeads|listads|ads|addhorapg|horapg|idiomas|portugues|pt|ptbr|english|en|espanol|es|fundobemvindo|legendabemvindo|fundomenu)$/.test(normalized)) {
    return null;
  }
  const commandText = getUsageText(normalized, info);
  const text =
    normalized === "addautorepo"
      ? "✅ Auto resposta cadastrada.\n\nQuando alguém enviar \"preço\", o bot responderá com a mensagem salva."
      : normalized === "listaautorepo"
        ? "📋 Auto respostas cadastradas\n\n1. preço\n2. suporte\n3. planos"
        : normalized.includes("bemvindo") || normalized === "fundomenu"
          ? "✅ Configuração de mídia ou legenda atualizada com sucesso."
          : "✅ Configuração atualizada com sucesso.";

  return scenario({
    command: normalized,
    commandText,
    sourceLabel: "Fluxo realista de configuração",
    intro: "O celular mostra a configuração sendo salva e refletida no grupo.",
    steps: [`Admin envia ${commandText}.`, "BotAdmin salva a configuração.", "A próxima mensagem do grupo já usa o novo ajuste."],
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      message.admin("command", commandText),
      message.bot("result", text),
      ...(normalized === "addautorepo"
        ? [message.member("trigger", "preço"), message.bot("auto-reply", "O plano mensal do BotAdmin custa R$ 25.")]
        : []),
    ],
  });
};

const buildFallbackScenario = (
  normalized: string,
  info: CommandFunctionInfo | null,
  summary?: string | null,
): CommandPreviewScenario => {
  const commandText = getUsageText(normalized, info);
  const adminCommand = Boolean(info?.adminOnly);
  const text =
    summary?.trim() ||
    info?.summary ||
    `✅ Comando !${normalized} executado conforme as configurações atuais do grupo.`;

  return scenario({
    command: normalized,
    commandText,
    sourceLabel: adminCommand ? "Comando restrito a admins" : "Comando ativo",
    intro: "O celular mostra o comando sendo usado dentro do grupo e a resposta do BotAdmin.",
    steps: [`${adminCommand ? "Admin" : "Membro"} envia ${commandText}.`, "BotAdmin valida as regras do grupo.", "A ação aparece no WhatsApp."],
    messages: [
      message.system("intro", "Fluxo do comando no grupo"),
      adminCommand ? message.admin("command", commandText) : message.member("command", commandText),
      message.bot("result", text),
    ],
  });
};

export const buildCommandPreviewScenario = (
  command: string,
  summary?: string | null,
): CommandPreviewScenario => {
  const normalized = commandOnly(command);
  const info = getPublicCommandInfo(normalized);
  return (
    buildMenuScenario(normalized, info) ??
    buildLinkGuardScenario(normalized) ??
    buildMediaGuardScenario(normalized) ??
    buildNsfwScenario(normalized) ??
    buildAntiWordsScenario(normalized) ??
    buildBangringosScenario(normalized) ??
    buildAutomationScenario(normalized) ??
    buildStaticScenario(normalized, info) ??
    buildAdminConfigScenario(normalized, info) ??
    buildAutoResponseManagementScenario(normalized, info) ??
    buildDownloadScenario(normalized, info) ??
    buildStickerAiScenario(normalized, info) ??
    buildEngagementScenario(normalized, info) ??
    buildFallbackScenario(normalized, info, summary)
  );
};
