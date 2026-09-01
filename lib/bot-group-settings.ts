import { randomUUID } from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2";

import { DEFAULT_MENU_TEXTS } from "resources/default-menu-texts";
import { DEFAULT_COMMAND_ALIASES } from "resources/default-command-aliases";

export const DEFAULT_COMMAND_PREFIXES = ["/", "!", "#"] as const;

import type {
  BotGroupSettings,
  BotGroupInfraction,
  BotGroupCommandToggles,
  BotGroupWelcomeConfig,
  BotGroupFarewellConfig,
  BotGroupWelcomeButtonTemplate,
  BotGroupWelcomeReplyButton,
  BotGroupAutoResponse,
  BotGroupAutoResponseMedia,
  BotGroupAutoResponseVcard,
  BotGroupMenuCard,
  BotGroupMenuButton,
  BotGroupMenuListSection,
  BotGroupMenuCardKind,
  BotGroupMenuCarousel,
  BotGroupMenuTexts,
  BotGroupAiMemoryEntry,
  BotGroupAd,
  BotGroupMarkMessage,
  BotGroupBroadcastTemplate,
  BotGroupCtaButton,
  BotGroupHorapgConfig,
  BotGroupScheduleConfig,
  BotGroupAntiInactivityConfig,
  BotGroupAntispamConfig,
  BotGroupStaticMessage,
  BotGroupCoinsConfig,
  BotGroupMuteEntry,
  BotGroupModerationActionConfig,
  BotGroupModerationActionKey,
  BotGroupModerationActions,
} from "types/bot-groups";
import type { BotAutoResponseButtons, BotAutoResponseReplyButton } from "types/bot-auto-responses";
import { normalizeHorapgTimeToken, parseHorapgTimesArgument } from "lib/bot-horapg";
import { deleteUploadedFile } from "lib/uploads";
import { normalizeTimezoneInput, resolveTimezonePreference } from "lib/timezones";
import {
  ensureBotGroupInfractionsTable,
  ensureBotGroupMutesTable,
  ensureBotGroupSettingsTable,
  ensureBotGroupTable,
  ensureUserTable,
  getDb,
} from "./db";

const DEFAULT_COMMAND_TOGGLES: BotGroupCommandToggles = {
  autoresposta: false,
  botinterage: false,
  vozbotinterage: false,
  ouviraudiobotinterage: false,
  lerimagem: false,
  autosticker: false,
  autodownloader: false,
  bemvindo: false,
  despedida: false,
  antisticker: false,
  antimage: false,
  antvideo: false,
  antaudio: false,
  antdoc: false,
  antvcard: false,
  // Legado (defaultCommands)
  moderacaocomia: false,
  antilink: false,
  antilinkgp: false,
  antipalavras: false,
  banextremo: false,
  bangringos: false,
  antinsfwimagem: false,
  proibirnsfw: false,
  soadm: false,
  brincadeiras: false,
  linkmembro: false,
};

const MODERATION_ACTION_KEYS: BotGroupModerationActionKey[] = [
  "antilink",
  "antilinkgp",
  "banextremo",
  "antipalavras",
  "bangringos",
  "antinsfwimagem",
  "proibirnsfw",
  "antisticker",
  "antimage",
  "antvideo",
  "antaudio",
  "antdoc",
  "antvcard",
];

const MODERATION_ACTION_KEY_SET = new Set<string>(MODERATION_ACTION_KEYS);

const isModerationActionKey = (key: string): key is BotGroupModerationActionKey =>
  MODERATION_ACTION_KEY_SET.has(key);

const defaultModerationActionConfig = (
  key: BotGroupModerationActionKey,
): BotGroupModerationActionConfig => ({
  deleteMessage: true,
  registerInfraction: true,
  banUser: key === "banextremo" || key === "bangringos",
  maxInfractions: key === "banextremo" || key === "bangringos" ? 1 : null,
});

export const getBotGroupModerationActionConfig = (
  settings: Pick<BotGroupSettings, "moderationActions">,
  key: BotGroupModerationActionKey,
): BotGroupModerationActionConfig => ({
  ...defaultModerationActionConfig(key),
  ...(settings.moderationActions?.[key] ?? {}),
});

const DEFAULT_WELCOME_CONFIG: BotGroupWelcomeConfig = {
  enabled: false,
  caption:
    "✨ Bem-vindo ✨\n👤 Usuário: {{pushName}}\n📱 Número: {{numero}}\n👥 Grupo: {{nomeGrupo}}\n📅 Data: {{data}}\n⏰ Horário: {{hora}}\n\n⚡ Utilize o prefixo {{prefixo}} para comandos!",
  mediaUrl: null,
  mediaPath: null,
  useParticipantProfilePhoto: false,
  asSticker: false,
  updatedAt: null,
  attachments: [],
  replyButtons: null,
};

const DEFAULT_FAREWELL_CONFIG: BotGroupFarewellConfig = {
  enabled: false,
  caption:
    "👋 {{pushName}} saiu do grupo.\n📱 Número: {{numero}}\n👥 Grupo: {{nomeGrupo}}\n📅 Data: {{data}}\n⏰ Horário: {{hora}}",
  mediaUrl: null,
  mediaPath: null,
  useParticipantProfilePhoto: false,
  asSticker: false,
  updatedAt: null,
  attachments: [],
  replyButtons: null,
};

const DEFAULT_HORAPG_CONFIG: BotGroupHorapgConfig = {
  enabled: false,
  times: [],
  imageUrl: null,
  imagePath: null,
  sentTimes: {},
  lastSentAt: null,
  mentionAll: false,
  timezone: null,
};

const DEFAULT_SCHEDULE_CONFIG: BotGroupScheduleConfig = {
  closeEnabled: false,
  closeTimes: [],
  closeMessage: "🚫 Grupo fechado automaticamente conforme programação.",
  closeSentTimes: {},
  openEnabled: false,
  openTimes: [],
  openMessage: "✅ Grupo aberto automaticamente conforme programação.",
  openSentTimes: {},
  timezone: null,
  lastCloseAt: null,
  lastOpenAt: null,
};

const DEFAULT_ANTI_INACTIVITY_CONFIG: BotGroupAntiInactivityConfig = {
  enabled: false,
  days: 30,
  scanIntervalHours: 24,
  removeLimit: 20,
  lastRunAt: null,
  lastRemovedCount: 0,
  lastError: null,
  updatedAt: null,
};

const DEFAULT_ANTISPAM_CONFIG: BotGroupAntispamConfig = {
  burstLimit: 5,
  burstWindowSeconds: 12,
  repeatLimit: 3,
  repeatWindowSeconds: 45,
  infractionResetDays: 7,
};

const DEFAULT_BOT_COINS_CONFIG: BotGroupCoinsConfig = {
  enabled: false,
  currencyName: "BotCoins",
  monetizationOnly: false,
  interactiveShopEnabled: false,
  earnings: {
    message: {
      enabled: true,
      amount: 1,
      messagesPerReward: 10,
      cooldownSec: 30,
      minLength: 1,
      maxPerDay: 100,
    },
    daily: {
      enabled: true,
      amount: 10,
    },
    levelUp: {
      enabled: true,
      amount: 10,
    },
  },
  leveling: {
    xpPerMessage: 1,
    levelStep: 100,
  },
  penalties: {
    infraction: {
      enabled: true,
      amount: 5,
    },
  },
  spending: {
    defaultCostsByCategory: {
      downloads: 5,
      media: 2,
    },
    commandCosts: {},
    autoDownloaderCost: 5,
    autoStickerCost: 2,
  },
  notifications: {
    mode: "group_reply",
    includeBalance: true,
  },
  premium: {
    enabled: false,
    plans: [
      {
        key: "p30",
        label: "Premium 30 dias",
        price: 100,
        durationDays: 30,
        enabled: true,
        description: "Acesso premium por 30 dias.",
      },
      {
        key: "p60",
        label: "Premium 60 dias",
        price: 180,
        durationDays: 60,
        enabled: true,
        description: "Acesso premium por 60 dias.",
      },
      {
        key: "p90",
        label: "Premium 90 dias",
        price: 250,
        durationDays: 90,
        enabled: true,
        description: "Acesso premium por 90 dias.",
      },
    ],
    price: 100,
    durationDays: 30,
    commandKeys: [],
    bypassCoinCosts: true,
  },
  robbery: {
    enabled: false,
    cooldownHours: 6,
    targetCooldownHours: 6,
    attemptCost: 2,
    failPenalty: 2,
    minAttackerBalance: 5,
    minTargetBalance: 10,
    stealPercentMin: 10,
    stealPercentMax: 25,
    minSteal: 3,
    maxSteal: 30,
  },
  shopItems: [],
  topup: {
    enabled: false,
    coinsPerCurrency: 10,
    minCoins: 20,
    maxCoins: 5000,
    allowPix: true,
    allowCheckout: false,
  },
  rewards: {
    weekly: {
      enabled: true,
      amount: 10,
      top: 10,
      minMessages: 5,
      announce: true,
    },
    monthly: {
      enabled: true,
      amount: 30,
      top: 10,
      minMessages: 20,
      announce: true,
    },
  },
};

const DEFAULT_PREMIUM_CONFIG = DEFAULT_BOT_COINS_CONFIG.premium;

const DEFAULT_AI_PROMPTS: Record<string, string> = {
  ptbr: "Fale de forma direta e natural em português do Brasil.",
  enus: "Speak directly and naturally in English (US).",
  es: "Habla de forma directa y natural en español.",
};

const DEFAULT_AI_PROMPT = DEFAULT_AI_PROMPTS.ptbr;
const DEFAULT_AI_TOOLS_PROMPT = [
  "Quando a IA identificar pedido real de música, áudio, MP3, vídeo ou MP4, o BotAdmin abrirá a seleção do play para o usuário escolher MP3 ou MP4.",
  "Extraia somente o termo, nome ou URL citado na mensagem atual.",
  "Não reutilize pedidos antigos da memória para inferir mídia.",
  "Se faltar termo ou link, peça apenas o nome ou URL da mídia.",
].join("\n");

const DEFAULT_AI_MODEL = "llama-3.1-8b-instant";
const DEFAULT_AI_VOICE = "laizza";

const DEFAULT_ANTIFAKE_MESSAGE =
  "🚫 @{{numero}}, este grupo aceita apenas DDI(s) {{allowed_ddis}}. Você será removido em instantes.";

export const getDefaultAiPrompt = (language: string): string => {
  const normalized = typeof language === "string" ? language.trim().toLowerCase() : "";
  return DEFAULT_AI_PROMPTS[normalized] ?? DEFAULT_AI_PROMPT;
};

export const getDefaultAiToolsPrompt = (): string => DEFAULT_AI_TOOLS_PROMPT;

// DEFAULT_COMMAND_ALIASES agora é compartilhado via resources/default-command-aliases

const DEFAULT_SETTINGS: Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt"> = {
  antilink: false,
  antilinkGroupInvite: false,
  banExtremo: false,
  autoRead: true,
  allowedLinks: [],
  featureFlags: {
    bangringos: false,
    antipalavras: false,
    antipalavrasBan: false,
    soadm: false,
    antifake: false,
    bloqueiolinks: false,
    multprefixo: false,
    iaConversas: true,
    downloaderOnlyMode: false,
  },
  moderationActions: {},
  allowedDdis: ["55"],
  antifakeMessage: DEFAULT_ANTIFAKE_MESSAGE,
  bannedWords: [],
  antipalavrasMaxInfractions: 5,
  maxInfractions: 3,
  language: "ptbr",
  commandPrefixes: Array.from(DEFAULT_COMMAND_PREFIXES),
  allowCommandsWithoutPrefix: false,
  commandToggles: { ...DEFAULT_COMMAND_TOGGLES },
  commandAliases: { ...DEFAULT_COMMAND_ALIASES },
  menuTexts: { ...DEFAULT_MENU_TEXTS },
  menuCarousel: {
    cards: [
      {
        id: "main",
        kind: "main",
        title: null,
        description: null,
        footerText: null,
        listButtonText: null,
        imageUrl: null,
        imagePath: null,
        sections: null,
        buttons: null,
      },
      {
        id: "admin",
        kind: "admin",
        title: null,
        description: null,
        footerText: null,
        listButtonText: null,
        imageUrl: null,
        imagePath: null,
        sections: null,
        buttons: null,
      },
      {
        id: "downloads",
        kind: "downloads",
        title: null,
        description: null,
        footerText: null,
        listButtonText: null,
        imageUrl: null,
        imagePath: null,
        sections: null,
        buttons: null,
      },
      {
        id: "fun",
        kind: "fun",
        title: null,
        description: null,
        footerText: null,
        listButtonText: null,
        imageUrl: null,
        imagePath: null,
        sections: null,
        buttons: null,
      },
    ],
  },
  welcomeConfig: { ...DEFAULT_WELCOME_CONFIG },
  farewellConfig: { ...DEFAULT_FAREWELL_CONFIG },
  autoResponses: [],
  ads: [],
  horapgConfig: { ...DEFAULT_HORAPG_CONFIG },
  scheduleConfig: { ...DEFAULT_SCHEDULE_CONFIG },
  antiInactivityConfig: { ...DEFAULT_ANTI_INACTIVITY_CONFIG },
  antispamConfig: { ...DEFAULT_ANTISPAM_CONFIG },
  premium: { ...DEFAULT_PREMIUM_CONFIG, plans: [...DEFAULT_PREMIUM_CONFIG.plans], commandKeys: [] },
  botCoins: { ...DEFAULT_BOT_COINS_CONFIG },
  lastMarkMessage: null,
  lastBroadcastTemplate: null,
  rulesMessage: null,
  tableMessage: null,
  mutedMembers: [],
  muteBanLimit: 3,
  blacklist: [],
  aiProvider: "groq",
  groqKeys: [],
  openAiApiKey: null,
  aiPrompt: DEFAULT_AI_PROMPT,
  aiToolsPrompt: DEFAULT_AI_TOOLS_PROMPT,
  aiVoice: DEFAULT_AI_VOICE,
  aiModel: DEFAULT_AI_MODEL,
  aiMemory: [],
  aiLastInteractionAt: null,
  unknownCommandTemplate: null,
  planRenewalAdminsOnly: false,
  planRenewalSilent: false,
};

const cloneDefaultSettings = (): typeof DEFAULT_SETTINGS => {
  if (typeof structuredClone === "function") {
    return structuredClone(DEFAULT_SETTINGS);
  }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
};

const normalizeAliasToken = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const DISABLED_LEGACY_ALIAS_KEYS = new Set([
  "comprar",
  "saldo",
  "suporte",
  "perfil",
  "compras",
]);

const parseCommandAliases = (raw: unknown): Record<string, string[]> => {
  if (!raw) return { ...DEFAULT_COMMAND_ALIASES };
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  const out: Record<string, string[]> = {};
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const k = normalizeAliasToken(String(key));
      if (!k || DISABLED_LEGACY_ALIAS_KEYS.has(k)) continue;
      const list = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(/[\s,;]+/)
          : [];
      const normalized = Array.from(new Set(list.map((v) => normalizeAliasToken(String(v))).filter(Boolean)));
      if (normalized.length > 0) out[k] = normalized;
    }
  }
  for (const [k, v] of Object.entries(DEFAULT_COMMAND_ALIASES)) {
    if (!out[k]) out[k] = v.slice();
  }
  return out;
};

const parseStringList = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }

  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0);
      }
    } catch {
      /* fall back to manual split */
    }

    return trimmed
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const sanitizeDigitsList = (entries: string[]): string[] =>
  entries
    .map((entry) => entry.replace(/\D/g, "").trim())
    .filter((entry, index, array) => entry.length >= 5 && array.indexOf(entry) === index);

const parseJsonRecordLoose = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
};

const parseFeatureFlags = (raw: unknown): Record<string, boolean> => {
  const source = parseJsonRecordLoose(raw);
  if (!source) {
    return { ...DEFAULT_SETTINGS.featureFlags };
  }
  return Object.entries(source).reduce<Record<string, boolean>>((acc, [key, value]) => {
    if (key === "moderationActions" || key === "moderation_actions") {
      return acc;
    }
    if (value && typeof value === "object") {
      return acc;
    }
    acc[key] = value === true || value === "true" || value === 1 || value === "1";
    return acc;
  }, {});
};

const normalizeModerationBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "nao", "não", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const normalizeModerationMaxInfractions = (
  value: unknown,
  fallback: number | null,
): number | null => {
  if (value === null) {
    return null;
  }
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(20, Math.floor(parsed)));
};

const normalizeModerationActionConfig = (
  key: BotGroupModerationActionKey,
  raw: unknown,
  fallback: BotGroupModerationActionConfig = defaultModerationActionConfig(key),
): BotGroupModerationActionConfig => {
  const source = parseJsonRecordLoose(raw);
  if (!source) {
    return { ...fallback };
  }
  return {
    deleteMessage: normalizeModerationBoolean(
      source.deleteMessage ?? source.delete_message ?? source.delete,
      fallback.deleteMessage,
    ),
    registerInfraction: normalizeModerationBoolean(
      source.registerInfraction ?? source.register_infraction ?? source.infraction,
      fallback.registerInfraction,
    ),
    banUser: normalizeModerationBoolean(
      source.banUser ?? source.ban_user ?? source.ban,
      fallback.banUser,
    ),
    maxInfractions: normalizeModerationMaxInfractions(
      source.maxInfractions ??
        source.max_infractions ??
        source.infractionLimit ??
        source.infraction_limit ??
        source.limit,
      fallback.maxInfractions ?? null,
    ),
  };
};

const parseModerationActions = (raw: unknown): BotGroupModerationActions => {
  const source = parseJsonRecordLoose(raw);
  const actionSource = parseJsonRecordLoose(
    source?.moderationActions ?? source?.moderation_actions ?? raw,
  );
  if (!actionSource) {
    return {};
  }
  const actions: BotGroupModerationActions = {};
  for (const [key, value] of Object.entries(actionSource)) {
    if (!isModerationActionKey(key)) {
      continue;
    }
    actions[key] = normalizeModerationActionConfig(key, value);
  }
  return actions;
};

const mergeModerationActions = (
  current: BotGroupModerationActions | undefined,
  updates: BotGroupModerationActions | undefined,
): BotGroupModerationActions => {
  const merged = parseModerationActions(current ?? {});
  const source = parseJsonRecordLoose(updates ?? {});
  if (!source) {
    return merged;
  }
  for (const [key, value] of Object.entries(source)) {
    if (!isModerationActionKey(key)) {
      continue;
    }
    merged[key] = normalizeModerationActionConfig(
      key,
      value,
      merged[key] ?? defaultModerationActionConfig(key),
    );
  }
  return merged;
};

const serializeFeatureFlags = (
  featureFlags: Record<string, boolean>,
  moderationActions: BotGroupModerationActions,
): string =>
  JSON.stringify({
    ...(featureFlags ?? {}),
    moderationActions: moderationActions ?? {},
  });

const parseCommandToggles = (raw: unknown): BotGroupCommandToggles => {
  const base = { ...DEFAULT_COMMAND_TOGGLES };

  if (!raw) {
    return base;
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (key in base) {
        base[key as keyof BotGroupCommandToggles] =
          value === true || value === "true" || value === 1 || value === "1";
      }
    }
  }

  return base;
};

const parseCommandPrefixes = (raw: unknown): string[] => {
  const parsed = parseStringList(raw);
  if (parsed.length > 0) {
    return parsed;
  }

  if (typeof raw === "string" && raw.trim()) {
    const splitted = raw
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
    if (splitted.length > 0) {
      return splitted;
    }
  }

  return Array.from(DEFAULT_COMMAND_PREFIXES);
};

const MENU_TEXT_KEYS: (keyof BotGroupMenuTexts)[] = [
  "main",
  "admin",
  "comandos",
  "outros",
  "downloads",
  "ativacoes",
  "jogos",
];

const shouldDropDeprecatedFunEntry = (entry: string): boolean => {
  if (typeof entry !== "string") return false;
  const normalized = entry.normalize("NFKD").toLowerCase();
  if (!normalized.includes("{prefix}")) {
    return false;
  }
  if (normalized.includes("{prefix}modobrinc")) {
    return true;
  }
  if (normalized.includes("{prefix}brinc")) {
    return true;
  }
  if (normalized.includes("{prefix}jogo")) {
    return true;
  }
  if (normalized.includes("{prefix}jueg")) {
    return true;
  }
  return false;
};

const applyMenuCleanup = (
  key: keyof BotGroupMenuTexts,
  entries: readonly string[],
): string[] => {
  if (key === "brincadeiras" || key === "jogos") {
    return [...DEFAULT_MENU_TEXTS[key]];
  }

  const filtered = entries.filter((entry) => !shouldDropDeprecatedFunEntry(entry));

  if (filtered.length === 0) {
    return [...DEFAULT_MENU_TEXTS[key]];
  }

  return filtered;
};

const sanitizeMenuTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\n\r]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const looksMojibake = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.includes("??")) {
    return true;
  }

  if (trimmed.includes("�")) {
    return true;
  }

  if (trimmed.includes("Ã") || trimmed.includes("Â")) {
    return true;
  }

  if (/[A-Za-zÀ-ÿ]\?[A-Za-zÀ-ÿ]/.test(trimmed)) {
    return true;
  }

  const questionMatches = trimmed.match(/\?/g);
  const questionCount = questionMatches ? questionMatches.length : 0;
  if (questionCount >= 2 && questionCount / Math.max(1, trimmed.length) > 0.03) {
    return true;
  }

  return false;
};

const shouldResetMenuTexts = (entries: string[]): boolean => {
  if (entries.length === 0) {
    return false;
  }

  let flagged = 0;
  for (const entry of entries) {
    if (looksMojibake(entry)) {
      flagged += 1;
    }
  }

  if (flagged >= 2) {
    return true;
  }

  return flagged > 0 && flagged / entries.length > 0.3;
};

const parseMenuTexts = (raw: unknown): BotGroupMenuTexts => {
  const base: BotGroupMenuTexts = { ...DEFAULT_MENU_TEXTS };

  if (!raw) {
    return base;
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return base;
  }

  for (const key of MENU_TEXT_KEYS) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) {
      const sanitized = applyMenuCleanup(key, sanitizeMenuTextList(value));
      if (sanitized.length > 0) {
        base[key] = shouldResetMenuTexts(sanitized) ? [...DEFAULT_MENU_TEXTS[key]] : sanitized;
      } else {
        base[key] = [];
      }
    }
  }

  return base;
};

const normalizeMenuTextsUpdate = (
  current: BotGroupMenuTexts,
  updates: Partial<BotGroupMenuTexts> | undefined,
): BotGroupMenuTexts => {
  if (!updates) {
    return { ...current };
  }

  return MENU_TEXT_KEYS.reduce<BotGroupMenuTexts>((acc, key) => {
    const value = updates[key];
    if (value !== undefined) {
      const sanitized = applyMenuCleanup(key, sanitizeMenuTextList(value));
      acc[key] = shouldResetMenuTexts(sanitized) ? [...DEFAULT_MENU_TEXTS[key]] : sanitized;
    } else {
      acc[key] = current[key];
    }
    return acc;
  }, { ...current });
};

const MENU_CARD_KINDS: BotGroupMenuCardKind[] = [
  "main",
  "admin",
  "downloads",
  "fun",
];

const normalizeOptionalMenuValue = (
  value: unknown,
  maxLength: number,
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
};

const defaultMenuCarousel = (): BotGroupMenuCarousel =>
  structuredClone(DEFAULT_SETTINGS.menuCarousel);

const normalizeMenuEntityId = (
  value: unknown,
  fallback: string,
  maxLength = 80,
): string => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
};

const normalizeMenuSections = (value: unknown): BotGroupMenuListSection[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((section, sectionIndex) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return [];
    }
    const source = section as Record<string, unknown>;
    const title =
      normalizeOptionalMenuValue(source.title, 60) ??
      `Opções ${sectionIndex + 1}`;
    const rawRows = Array.isArray(source.rows) ? source.rows : [];
    const rows = rawRows.slice(0, 30).flatMap((row, rowIndex) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const entry = row as Record<string, unknown>;
      const rowTitle = normalizeOptionalMenuValue(entry.title, 60);
      const command = normalizeOptionalMenuValue(
        entry.command ?? entry.rowId ?? entry.row_id ?? entry.id,
        180,
      );
      if (!rowTitle || !command) return [];
      return [{
        id: normalizeMenuEntityId(
          entry.id,
          `row-${sectionIndex + 1}-${rowIndex + 1}`,
        ),
        title: rowTitle,
        description: normalizeOptionalMenuValue(entry.description, 110),
        command,
      }];
    });
    if (rows.length === 0) return [];
    return [{
      id: normalizeMenuEntityId(source.id, `section-${sectionIndex + 1}`),
      title,
      rows,
    }];
  });
};

const normalizeMenuButtons = (value: unknown): BotGroupMenuButton[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).flatMap((button, index) => {
    if (!button || typeof button !== "object" || Array.isArray(button)) {
      return [];
    }
    const source = button as Record<string, unknown>;
    const rawType = String(source.type ?? "").trim().toLowerCase();
    const type =
      rawType === "url" || rawType === "cta_url"
        ? "url"
        : rawType === "copy" || rawType === "cta_copy"
          ? "copy"
          : rawType === "reply" || rawType === "quick_reply"
            ? "reply"
            : null;
    const label = normalizeOptionalMenuValue(
      source.label ?? source.text ?? source.buttonText,
      40,
    );
    const payload = normalizeOptionalMenuValue(
      source.value ??
        source.url ??
        source.copyCode ??
        source.copy_code ??
        source.command ??
        source.payload,
      type === "url" ? 2048 : 180,
    );
    if (!type || !label || !payload) return [];
    return [{
      id: normalizeMenuEntityId(source.id, `button-${index + 1}`),
      type,
      label,
      value: payload,
    }];
  });
};

const normalizeMenuCarousel = (
  raw: unknown,
  fallback: BotGroupMenuCarousel = defaultMenuCarousel(),
): BotGroupMenuCarousel => {
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  const sourceCards =
    source && typeof source === "object" && Array.isArray((source as Record<string, unknown>).cards)
      ? ((source as Record<string, unknown>).cards as unknown[])
      : Array.isArray(source)
        ? source
        : [];
  const byKind = new Map<BotGroupMenuCardKind, Record<string, unknown>>();
  for (const entry of sourceCards) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kind = String(record.kind ?? record.id ?? "").trim().toLowerCase() as BotGroupMenuCardKind;
    if (MENU_CARD_KINDS.includes(kind) && !byKind.has(kind)) {
      byKind.set(kind, record);
    }
  }
  const fallbackByKind = new Map(
    fallback.cards.map((card) => [card.kind, card] as const),
  );
  return {
    cards: MENU_CARD_KINDS.map((kind): BotGroupMenuCard => {
      const previous =
        fallbackByKind.get(kind) ??
        defaultMenuCarousel().cards.find((card) => card.kind === kind)!;
      const record = byKind.get(kind);
      if (!record) {
        return { ...previous, id: kind, kind };
      }
      return {
        id: kind,
        kind,
        title: normalizeOptionalMenuValue(record.title, 120),
        description: normalizeOptionalMenuValue(
          record.description ?? record.body,
          1024,
        ),
        footerText: normalizeOptionalMenuValue(
          record.footerText ?? record.footer,
          120,
        ),
        listButtonText: normalizeOptionalMenuValue(
          record.listButtonText ?? record.buttonText,
          40,
        ),
        imageUrl: normalizeOptionalMenuValue(
          record.imageUrl ?? record.image_url,
          2048,
        ),
        imagePath: normalizeOptionalMenuValue(
          record.imagePath ?? record.image_path,
          512,
        )?.replace(/^\/+/, "") ?? null,
        sections: Object.prototype.hasOwnProperty.call(record, "sections")
          ? record.sections === null
            ? null
            : normalizeMenuSections(record.sections)
          : previous.sections,
        buttons: Object.prototype.hasOwnProperty.call(record, "buttons")
          ? record.buttons === null
            ? null
            : normalizeMenuButtons(record.buttons)
          : previous.buttons,
      };
    }),
  };
};

const normalizeGroqKey = (value: string): string | null => {
  const trimmed = value.replace(/\s+/g, "").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
};

const parseGroqKeys = (raw: unknown): string[] => {
  const baseList = parseStringList(raw);
  const sanitized = baseList
    .map((entry) => normalizeGroqKey(entry))
    .filter((entry): entry is string => Boolean(entry));
  return sanitized.filter((entry, index, array) => array.indexOf(entry) === index);
};

const normalizeGroqKeys = (values: unknown): string[] => {
  if (Array.isArray(values)) {
    return values
      .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
      .map((entry) => normalizeGroqKey(entry))
      .filter((entry): entry is string => Boolean(entry))
      .filter((entry, index, array) => array.indexOf(entry) === index);
  }
  if (typeof values === "string") {
    return parseGroqKeys(values);
  }
  return [];
};

const AI_MEMORY_LIMIT = 20;

const normalizeAiMemoryEntry = (raw: Record<string, unknown>): BotGroupAiMemoryEntry | null => {
  const roleRaw = typeof raw.role === "string" ? raw.role.trim().toLowerCase() : "";
  const role = roleRaw === "assistant" ? "assistant" : roleRaw === "user" ? "user" : null;
  if (!role) {
    return null;
  }

  const contentRaw =
    typeof raw.content === "string"
      ? raw.content
      : raw.content !== undefined && raw.content !== null
        ? String(raw.content)
        : "";
  const content = contentRaw.trim();
  if (!content) {
    return null;
  }

  const author =
    typeof raw.author === "string" && raw.author.trim().length > 0
      ? raw.author.trim()
      : null;
  const authorId =
    typeof raw.authorId === "string" && raw.authorId.trim().length > 0
      ? raw.authorId.trim()
      : typeof (raw as Record<string, unknown>)["author_id"] === "string" &&
          (raw as Record<string, unknown>)["author_id"]!.trim().length > 0
        ? ((raw as Record<string, unknown>)["author_id"] as string).trim()
        : null;
  const replyTo =
    typeof raw.replyTo === "string" && raw.replyTo.trim().length > 0
      ? raw.replyTo.trim()
      : typeof (raw as Record<string, unknown>)["reply_to"] === "string" &&
          (raw as Record<string, unknown>)["reply_to"]!.trim().length > 0
        ? ((raw as Record<string, unknown>)["reply_to"] as string).trim()
        : null;
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.trim().length > 0
      ? raw.createdAt.trim()
      : new Date().toISOString();

  return {
    role,
    author,
    authorId,
    content,
    createdAt,
    replyTo,
  } satisfies BotGroupAiMemoryEntry;
};

const parseAiMemory = (raw: unknown): BotGroupAiMemoryEntry[] => {
  if (!raw) {
    return [];
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((entry) =>
      entry && typeof entry === "object"
        ? normalizeAiMemoryEntry(entry as Record<string, unknown>)
        : null,
    )
    .filter((entry): entry is BotGroupAiMemoryEntry => Boolean(entry))
    .slice(-AI_MEMORY_LIMIT);
};

const normalizeAiMemoryUpdate = (
  current: BotGroupAiMemoryEntry[],
  updates?: BotGroupAiMemoryEntry[] | null,
): BotGroupAiMemoryEntry[] => {
  if (!updates) {
    return [...current];
  }

  if (!Array.isArray(updates)) {
    return [...current];
  }

  const normalized = updates
    .map((entry) => normalizeAiMemoryEntry(entry as unknown as Record<string, unknown>))
    .filter((entry): entry is BotGroupAiMemoryEntry => Boolean(entry));

  return normalized.slice(-AI_MEMORY_LIMIT);
};

const parseWelcomeConfig = (
  raw: unknown,
  defaults: BotGroupWelcomeConfig = DEFAULT_WELCOME_CONFIG,
): BotGroupWelcomeConfig => {
  if (!raw) {
    return { ...defaults };
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return { ...defaults };
  }

  const base = { ...defaults };

  if ("enabled" in source) {
    base.enabled =
      (source as Record<string, unknown>).enabled === true ||
      (source as Record<string, unknown>).enabled === "true" ||
      (source as Record<string, unknown>).enabled === 1 ||
      (source as Record<string, unknown>).enabled === "1";
  }
  if (typeof (source as Record<string, unknown>).caption === "string") {
    base.caption = ((source as Record<string, unknown>).caption as string).trim() || base.caption;
  }
  if (typeof (source as Record<string, unknown>).mediaUrl === "string") {
    base.mediaUrl = ((source as Record<string, unknown>).mediaUrl as string).trim() || null;
  }
  if (typeof (source as Record<string, unknown>).mediaPath === "string") {
    base.mediaPath = ((source as Record<string, unknown>).mediaPath as string).trim() || null;
  }
  const useParticipantProfilePhotoRaw =
    (source as Record<string, unknown>).useParticipantProfilePhoto ??
    (source as Record<string, unknown>).use_participant_profile_photo ??
    (source as Record<string, unknown>).useMemberProfilePhoto ??
    (source as Record<string, unknown>).use_member_profile_photo;
  if (useParticipantProfilePhotoRaw !== undefined) {
    base.useParticipantProfilePhoto =
      useParticipantProfilePhotoRaw === true ||
      useParticipantProfilePhotoRaw === "true" ||
      useParticipantProfilePhotoRaw === 1 ||
      useParticipantProfilePhotoRaw === "1";
  }
  if ("asSticker" in source) {
    base.asSticker =
      (source as Record<string, unknown>).asSticker === true ||
      (source as Record<string, unknown>).asSticker === "true" ||
      (source as Record<string, unknown>).asSticker === 1 ||
      (source as Record<string, unknown>).asSticker === "1";
  }
  if (typeof (source as Record<string, unknown>).updatedAt === "string") {
    base.updatedAt = ((source as Record<string, unknown>).updatedAt as string).trim() || null;
  }

  // Parse optional attachments
  const attachmentsRaw = (source as Record<string, unknown>)["attachments"];
  if (Array.isArray(attachmentsRaw)) {
    const list = attachmentsRaw
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
      .filter(Boolean)
      .map((rec) => {
        const kindRaw = typeof rec!.kind === "string" ? rec!.kind.trim().toLowerCase() : "";
        if (kindRaw === "vcard") {
          const name = typeof rec!.name === "string" ? rec!.name.trim() : "Contato";
          const vcard = typeof rec!.vcard === "string" ? rec!.vcard.replace(/\r\n/g, "\n").trim() : "";
          if (!vcard) return null;
          return { kind: "vcard", name, vcard } as BotGroupWelcomeConfig["attachments"][number];
        }
        const kind = ((): "image" | "video" | "audio" | "document" | "sticker" => {
          switch (kindRaw) {
            case "video":
            case "audio":
            case "document":
            case "sticker":
              return kindRaw;
            default:
              return "image";
          }
        })();
        const url = typeof rec!.url === "string" ? rec!.url.trim() : "";
        const path = typeof rec!.path === "string" ? rec!.path.trim() : "";
        if (!url && !path) return null;
        const fileName = typeof rec!.fileName === "string" ? rec!.fileName.trim() : null;
        const mimeType = typeof rec!.mimeType === "string" ? rec!.mimeType.trim() : null;
        const caption = typeof rec!.caption === "string" ? rec!.caption.trim() : null;
        return { kind, url: url || null, path: path || null, fileName, mimeType, caption } as const;
      })
      .filter((a): a is NonNullable<typeof a> => Boolean(a));
    base.attachments = list;
  }

  const replyButtonsRaw =
    (source as Record<string, unknown>)["replyButtons"] ??
    (source as Record<string, unknown>)["reply_buttons"];
  base.replyButtons = parseWelcomeReplyButtons(replyButtonsRaw);

  // Backwards compatibility: if old fields are present and no attachments configured,
  // expose single media as first attachment for send pipeline.
  if ((!base.attachments || base.attachments.length === 0) && (base.mediaUrl || base.mediaPath)) {
    base.attachments = [
      {
        kind: base.asSticker ? ("sticker" as const) : ("image" as const),
        url: base.mediaUrl,
        path: base.mediaPath,
        fileName: null,
        mimeType: null,
        caption: null,
      },
    ];
  }

  return base;
};

const parseFarewellConfig = (raw: unknown): BotGroupFarewellConfig =>
  parseWelcomeConfig(raw, DEFAULT_FAREWELL_CONFIG);

const parseJsonObject = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) return null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
};

const serializeWelcomeConfigWithFarewell = (
  welcomeConfig: BotGroupWelcomeConfig,
  farewellConfig: BotGroupFarewellConfig,
): string => JSON.stringify({ ...welcomeConfig, farewellConfig });

const normalizeOptionalBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0 ? true : false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["1", "true", "on", "yes", "sim"].includes(normalized)) return true;
    if (["0", "false", "off", "no", "nao", "não"].includes(normalized)) return false;
  }
  return undefined;
};

const sanitizeReplyButtonEntry = (
  value: unknown,
  fallbackIndex: number,
): BotGroupWelcomeReplyButton | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const label =
    typeof source.label === "string"
      ? source.label.trim()
      : typeof source.text === "string"
        ? source.text.trim()
        : "";
  if (!label) {
    return null;
  }
  const idCandidate =
    typeof source.id === "string" && source.id.trim()
      ? source.id.trim()
      : `btn_${fallbackIndex}`;
  const typeRaw =
    typeof source.type === "string" && source.type.trim()
      ? source.type.trim().toLowerCase()
      : "";
  const type = ((): BotGroupWelcomeReplyButton["type"] => {
    switch (typeRaw) {
      case "cta_url":
      case "url":
      case "link":
        return "cta_url";
      case "cta_call":
      case "call":
      case "phone":
        return "cta_call";
      case "cta_copy":
      case "copy":
      case "copiar":
        return "cta_copy";
      default:
        return "quick_reply";
    }
  })();
  const command =
    typeof source.command === "string" && source.command.trim()
      ? source.command.trim()
      : typeof source.value === "string" && source.value.trim()
        ? source.value.trim()
        : null;
  const args =
    typeof source.args === "string" && source.args.trim()
      ? source.args.trim()
      : typeof source.argument === "string" && source.argument.trim()
        ? source.argument.trim()
        : typeof source.payload === "string" && source.payload.trim()
          ? source.payload.trim()
          : null;
  const url =
    typeof source.url === "string" && source.url.trim()
      ? source.url.trim()
      : typeof source.merchantUrl === "string" && source.merchantUrl.trim()
        ? source.merchantUrl.trim()
        : null;
  const phoneNumber =
    typeof source.phoneNumber === "string" && source.phoneNumber.trim()
      ? source.phoneNumber.trim()
      : typeof source.phone === "string" && source.phone.trim()
        ? source.phone.trim()
        : null;
  const copyCode =
    typeof source.copyCode === "string" && source.copyCode.trim()
      ? source.copyCode.trim()
      : typeof source.copy === "string" && source.copy.trim()
        ? source.copy.trim()
        : null;
  if (type === "quick_reply" && !command) {
    return null;
  }
  if (type === "cta_url" && !url) {
    return null;
  }
  if (type === "cta_call" && !phoneNumber) {
    return null;
  }
  if (type === "cta_copy" && !copyCode) {
    return null;
  }
  return {
    id: idCandidate,
    label,
    type,
    command,
    args,
    url,
    phoneNumber,
    copyCode,
  };
};

const parseWelcomeReplyButtons = (raw: unknown): BotGroupWelcomeButtonTemplate | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const enabled = normalizeOptionalBoolean(source.enabled);
  const positionRaw =
    typeof source.position === "string" ? source.position.trim().toLowerCase() : "";
  const position: BotGroupWelcomeButtonTemplate["position"] =
    positionRaw === "after_attachments" || positionRaw === "after"
      ? "after_attachments"
      : "before_attachments";
  const body = typeof source.body === "string" ? source.body : "";
  const footer = typeof source.footer === "string" ? source.footer : null;
  const updatedAt =
    typeof source.updatedAt === "string" && source.updatedAt.trim()
      ? new Date(source.updatedAt).toISOString()
      : null;
  const buttonsSource = Array.isArray(source.buttons) ? source.buttons : [];
  const buttons: BotGroupWelcomeReplyButton[] = [];
  for (let i = 0; i < buttonsSource.length && buttons.length < 3; i += 1) {
    const entry = sanitizeReplyButtonEntry(buttonsSource[i], i + 1);
    if (entry) {
      buttons.push(entry);
    }
  }
  if (buttons.length === 0) {
    return null;
  }

  return {
    enabled: enabled ?? true,
    position,
    body: body || "",
    footer,
    buttons,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
};

const normalizeWelcomeConfigEntry = (
  raw: Partial<BotGroupWelcomeConfig> | BotGroupWelcomeConfig,
): BotGroupWelcomeConfig => {
  if (!raw) {
    return { ...DEFAULT_WELCOME_CONFIG };
  }

  const parsed = parseWelcomeConfig({
    ...(DEFAULT_WELCOME_CONFIG as Record<string, unknown>),
    ...(raw as Record<string, unknown>),
  });

  if (parsed.replyButtons && parsed.replyButtons.buttons.length === 0) {
    parsed.replyButtons = null;
  }

  return parsed;
};

const sanitizeCtaButtonEntry = (
  value: unknown,
  fallbackIndex: number,
): BotGroupCtaButton | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const text =
    typeof source.text === "string"
      ? source.text.trim()
      : typeof source.label === "string"
        ? source.label.trim()
        : "";
  if (!text) return null;
  const typeRaw = typeof source.type === "string" ? source.type.trim().toLowerCase() : "";
  const type = ((): BotGroupCtaButton["type"] | null => {
    switch (typeRaw) {
      case "cta_url":
      case "url":
        return "cta_url";
      case "cta_call":
      case "call":
        return "cta_call";
      case "cta_copy":
      case "copy":
        return "cta_copy";
      default:
        return null;
    }
  })();
  if (!type) {
    return null;
  }
  const id =
    typeof source.id === "string" && source.id.trim()
      ? source.id.trim()
      : `cta_${fallbackIndex}`;
  const url = typeof source.url === "string" ? source.url.trim() : undefined;
  const phoneNumber =
    typeof source.phoneNumber === "string"
      ? source.phoneNumber.trim()
      : typeof source.phone_number === "string"
        ? source.phone_number.trim()
        : undefined;
  const copyCode =
    typeof source.copyCode === "string"
      ? source.copyCode.trim()
      : typeof source.copy_code === "string"
        ? source.copy_code.trim()
        : undefined;
  return {
    id,
    text,
    type,
    url: url || null,
    phoneNumber: phoneNumber || null,
    copyCode: copyCode || null,
  };
};

const sanitizeOptionalText = (value: unknown, maxLength?: number): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0 && trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }
  return trimmed;
};

const normalizeAutoResponseReplyButton = (
  raw: unknown,
  fallbackIndex: number,
): BotAutoResponseReplyButton | null => {
  if (raw === null || raw === undefined) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const labelCandidate =
    typeof raw === "string"
      ? raw
      : (source?.text ??
          source?.title ??
          source?.label ??
          source?.name ??
          source?.body ??
          source?.value ??
          null);
  const text = sanitizeOptionalText(labelCandidate, 20);
  if (!text) {
    return null;
  }

  const idCandidate =
    typeof raw === "string"
      ? null
      : (source?.id ??
          source?.buttonId ??
          source?.button_id ??
          source?.command ??
          source?.value ??
          source?.key ??
          null);
  const id =
    typeof idCandidate === "string" && idCandidate.trim()
      ? idCandidate.trim()
      : `reply_${fallbackIndex}`;

  return {
    id,
    text,
  };
};

const normalizeAutoResponseButtons = (raw: unknown): BotAutoResponseButtons | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const typeRaw = typeof source.type === "string" ? source.type.trim().toLowerCase() : "";
  const type: BotAutoResponseButtons["type"] =
    typeRaw === "button_cta" ? "button_cta" : "button_reply";

  const title =
    sanitizeOptionalText(
      (source.title ??
        source.headerTitle ??
        source.header_title ??
        source.header) as string | undefined,
      60,
    ) ?? null;
  const body =
    sanitizeOptionalText(
      (source.body ?? source.text ?? source.message ?? source.description) as string | undefined,
      1024,
    ) ?? null;
  const footer =
    sanitizeOptionalText(
      (source.footer ?? source.footerText ?? source.footer_text) as string | undefined,
      60,
    ) ?? null;

  if (type === "button_reply") {
    const rawButtons = (() => {
      const candidate =
        source.buttons ??
        source.replyButtons ??
        source.reply_buttons ??
        source.options ??
        source.choices ??
        null;
      return Array.isArray(candidate) ? candidate : [];
    })();
    const buttons: BotAutoResponseReplyButton[] = [];
    for (let i = 0; i < rawButtons.length && buttons.length < 3; i += 1) {
      const entry = normalizeAutoResponseReplyButton(rawButtons[i], i + 1);
      if (entry) {
        buttons.push(entry);
      }
    }
    if (buttons.length === 0) {
      return null;
    }
    return {
      type: "button_reply",
      title,
      body,
      footer,
      buttons,
    };
  }

  const ctaSource = (() => {
    const candidate =
      source.ctaButtons ?? source.cta_buttons ?? source.buttons ?? source.options ?? null;
    return Array.isArray(candidate) ? candidate : [];
  })();
  const buttons: BotGroupCtaButton[] = [];
  for (let i = 0; i < ctaSource.length && buttons.length < 3; i += 1) {
    const entry = sanitizeCtaButtonEntry(ctaSource[i], i + 1);
    if (entry) {
      buttons.push(entry);
    }
  }
  if (buttons.length === 0) {
    return null;
  }

  return {
    type: "button_cta",
    title,
    body,
    footer,
    buttons,
  };
};

export const parseBroadcastTemplate = (raw: unknown): BotGroupBroadcastTemplate | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const typeRaw = typeof source.type === "string" ? source.type.trim().toLowerCase() : "";
  const type: BotGroupBroadcastTemplate["type"] = ((): BotGroupBroadcastTemplate["type"] => {
    if (["media", "button_reply", "button_cta", "text"].includes(typeRaw)) {
      return typeRaw as BotGroupBroadcastTemplate["type"];
    }
    return "text";
  })();
  const body = typeof source.body === "string" ? source.body : "";
  const footer = typeof source.footer === "string" ? source.footer : null;
  const mediaUrl =
    typeof source.mediaUrl === "string" ? source.mediaUrl.trim() : null;
  const mediaPath =
    typeof source.mediaPath === "string" ? source.mediaPath.trim() : null;
  const mediaType =
    typeof source.mediaType === "string" && source.mediaType.trim()
      ? (source.mediaType.trim().toLowerCase() as BotGroupBroadcastTemplate["mediaType"])
      : undefined;
  const buttons =
    type === "button_reply" && Array.isArray(source.buttons)
      ? source.buttons
          .map((entry, index) => sanitizeReplyButtonEntry(entry, index + 1))
          .filter(Boolean)
          .slice(0, 3) ?? undefined
      : undefined;
  const ctaButtons =
    type === "button_cta" && Array.isArray(source.ctaButtons ?? source.cta_buttons)
      ? (source.ctaButtons ?? source.cta_buttons)
          .map((entry: unknown, index: number) => sanitizeCtaButtonEntry(entry, index + 1))
          .filter(Boolean)
          .slice(0, 3) ?? undefined
      : undefined;
  const headerMediaUrl =
    typeof source.headerMediaUrl === "string"
      ? source.headerMediaUrl.trim()
      : typeof source.header_media_url === "string"
        ? source.header_media_url.trim()
        : null;
  const headerMediaPath =
    typeof source.headerMediaPath === "string"
      ? source.headerMediaPath.trim()
      : typeof source.header_media_path === "string"
        ? source.header_media_path.trim()
        : null;
  const titleRaw =
    typeof source.title === "string"
      ? source.title
      : typeof source.headerTitle === "string"
        ? source.headerTitle
        : null;
  const title = titleRaw?.trim() ? titleRaw.trim() : null;
  const mentionAllRaw =
    typeof source.mentionAll === "boolean"
      ? source.mentionAll
      : typeof source.mention_all === "boolean"
        ? source.mention_all
        : false;
  const mentionListRaw = source.mentionList ?? source.mention_list ?? source.mentions;
  const mentionList = (() => {
    if (Array.isArray(mentionListRaw)) {
      return mentionListRaw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0);
    }
    if (typeof mentionListRaw === "string") {
      return mentionListRaw
        .split(/[\r\n,;]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return [];
  })();

  const updatedAt =
    typeof source.updatedAt === "string" && source.updatedAt.trim()
      ? new Date(source.updatedAt).toISOString()
      : null;

  const hasContent =
    Boolean(body) ||
    Boolean(mediaUrl) ||
    Boolean(mediaPath) ||
    (buttons && buttons.length > 0) ||
    (ctaButtons && ctaButtons.length > 0);

  if (!hasContent) {
    return null;
  }

  return {
    type,
    title,
    body,
    footer,
    mediaUrl,
    mediaPath,
    mediaType,
    buttons: buttons?.filter(Boolean).slice(0, 3),
    ctaButtons: ctaButtons?.filter(Boolean).slice(0, 3),
    headerMediaUrl,
    headerMediaPath,
    mentionAll: mentionAllRaw,
    mentionList,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
};


const AUTO_RESPONSE_MEDIA_TYPES: BotGroupAutoResponseMedia["mediaType"][] = [
  "image",
  "video",
  "audio",
  "document",
  "sticker",
];

const MEDIA_TYPE_ALIASES: Record<string, BotGroupAutoResponseMedia["mediaType"]> = {
  img: "image",
  imagem: "image",
  picture: "image",
  photo: "image",
  doc: "document",
  documento: "document",
  file: "document",
  audio: "audio",
  som: "audio",
  music: "audio",
  video: "video",
  gif: "sticker",
  sticker: "sticker",
};

const guessMediaTypeFromMime = (
  mimeType: string | null,
): BotGroupAutoResponseMedia["mediaType"] | null => {
  if (!mimeType) {
    return null;
  }
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/")) {
    return "image";
  }
  if (normalized.startsWith("video/")) {
    return "video";
  }
  if (normalized.startsWith("audio/")) {
    return "audio";
  }
  if (normalized.includes("webp") || normalized.includes("sticker")) {
    return "sticker";
  }
  return null;
};

const guessMediaTypeFromUrl = (
  url: string | null,
): BotGroupAutoResponseMedia["mediaType"] | null => {
  if (!url) {
    return null;
  }
  const normalized = url.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|avif|heic)(\?|$)/.test(normalized)) {
    return "image";
  }
  if (/\.(mp4|m4v|mov|webm|mkv)(\?|$)/.test(normalized)) {
    return "video";
  }
  if (/\.(mp3|m4a|aac|ogg|wav|flac)(\?|$)/.test(normalized)) {
    return "audio";
  }
  if (/\.(vcard|vcf)(\?|$)/.test(normalized)) {
    return "document";
  }
  return null;
};

const normalizeAutoResponseMedia = (raw: unknown): BotGroupAutoResponseMedia | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const rawType =
    typeof source.mediaType === "string"
      ? source.mediaType
      : typeof source.type === "string"
        ? source.type
        : typeof source.kind === "string"
          ? source.kind
          : "";

  const alias = MEDIA_TYPE_ALIASES[rawType.toLowerCase()];
  let mediaType = alias ?? rawType.toLowerCase();

  if (source.asSticker === true) {
    mediaType = "sticker";
  }

  const rawPath =
    typeof source.path === "string"
      ? source.path
      : typeof source.mediaPath === "string"
        ? source.mediaPath
        : typeof source.filePath === "string"
          ? source.filePath
          : null;
  const rawUrl =
    typeof source.url === "string"
      ? source.url
      : typeof source.mediaUrl === "string"
        ? source.mediaUrl
        : typeof source.fileUrl === "string"
          ? source.fileUrl
          : null;

  const path = rawPath && rawPath.trim().length > 0 ? rawPath.trim() : null;
  const url = rawUrl && rawUrl.trim().length > 0 ? rawUrl.trim() : null;

  if (!path && !url) {
    return null;
  }

  const rawMime =
    typeof source.mimeType === "string"
      ? source.mimeType
      : typeof source.mimetype === "string"
        ? source.mimetype
        : null;
  const mimeType = rawMime && rawMime.trim().length > 0 ? rawMime.trim() : null;

  const guessedFromMime = guessMediaTypeFromMime(mimeType);
  const guessedFromUrl = guessMediaTypeFromUrl(url);

  let finalType: BotGroupAutoResponseMedia["mediaType"] = "document";

  if (mediaType === "sticker") {
    finalType = "sticker";
  } else if (AUTO_RESPONSE_MEDIA_TYPES.includes(mediaType as any)) {
    finalType = mediaType as BotGroupAutoResponseMedia["mediaType"];
  } else if (guessedFromMime) {
    finalType = guessedFromMime;
  } else if (guessedFromUrl) {
    finalType = guessedFromUrl;
  }

  const fileName =
    typeof source.fileName === "string"
      ? source.fileName
      : typeof source.filename === "string"
        ? source.filename
        : null;
  const normalizedFileName = fileName && fileName.trim().length > 0 ? fileName.trim() : null;

  const rawCaption =
    typeof source.caption === "string"
      ? source.caption
      : typeof source.mediaCaption === "string"
        ? source.mediaCaption
        : null;
  const caption = rawCaption && rawCaption.trim().length > 0 ? rawCaption : null;

  return {
    mediaType: finalType,
    url,
    path,
    fileName: normalizedFileName,
    mimeType,
    caption,
  } satisfies BotGroupAutoResponseMedia;
};

const normalizeVcardPhone = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/[^0-9+]/g, "");
  if (!digits) {
    return null;
  }
  if (digits.startsWith("+")) {
    return digits;
  }
  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }
  return `+${digits}`;
};

const normalizeAutoResponseVcard = (raw: unknown): BotGroupAutoResponseVcard | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const organization =
    typeof source.organization === "string" ? source.organization.trim() : "";
  const email = typeof source.email === "string" ? source.email.trim() : "";
  const phone = normalizeVcardPhone(
    source.phone ?? source.number ?? source.tel ?? source.whatsapp,
  );

  const rawVcard = typeof source.vcard === "string" ? source.vcard : "";
  const normalizedVcard = rawVcard.replace(/\r\n/g, "\n").trim();

  const fallbackName = name || (phone ?? "Contato");
  let vcard = normalizedVcard;

  if (!vcard) {
    if (!fallbackName && !phone) {
      return null;
    }
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${fallbackName || "Contato"}`];
    if (organization) {
      lines.push(`ORG:${organization}`);
    }
    if (email) {
      lines.push(`EMAIL:${email}`);
    }
    if (phone) {
      lines.push(`TEL:${phone}`);
    }
    lines.push("END:VCARD");
    vcard = lines.join("\n");
  }

  if (!vcard.trim()) {
    return null;
  }

  return {
    name: fallbackName || "Contato",
    phone: phone ?? null,
    organization: organization || null,
    email: email || null,
    vcard,
  } satisfies BotGroupAutoResponseVcard;
};

const normalizeBooleanLike = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (["1", "true", "yes", "on", "sim"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "não", "nao"].includes(normalized)) {
      return false;
    }
  }
  return false;
};

const normalizePositiveLimit = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  const normalized = Math.floor(num);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
};

const normalizeNumberClamp = (
  value: unknown,
  fallback: number,
  { min = 0, max = 1_000_000 }: { min?: number; max?: number } = {},
): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const normalized = Math.floor(num);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.min(Math.max(normalized, min), max);
};

const cloneBotCoinsConfig = (value: BotGroupCoinsConfig): BotGroupCoinsConfig => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as BotGroupCoinsConfig;
};

const normalizeCoinItemKey = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return normalizeAliasToken(value);
};

const normalizePremiumPlanKey = (value: unknown, fallback: string): string => {
  const normalized = normalizeAliasToken(value);
  return normalized || fallback;
};

const parseCoinItemAliases = (raw: unknown, baseKey: string): string[] => {
  const entries: string[] = [];
  if (Array.isArray(raw)) {
    entries.push(...raw.map((item) => String(item ?? "").trim()));
  } else if (typeof raw === "string" && raw.trim()) {
    entries.push(...raw.split(/[,;\n]+/).map((item) => item.trim()));
  }
  const normalized = Array.from(
    new Set(
      entries
        .map((entry) => normalizeAliasToken(entry))
        .filter(Boolean),
    ),
  );
  if (baseKey && !normalized.includes(baseKey)) {
    normalized.unshift(baseKey);
  }
  return normalized;
};

const normalizeBotCoinsConfigEntry = (
  raw: unknown,
  fallback?: BotGroupCoinsConfig,
): BotGroupCoinsConfig => {
  const base = cloneBotCoinsConfig(fallback ?? DEFAULT_BOT_COINS_CONFIG);
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  base.premium = {
    ...DEFAULT_BOT_COINS_CONFIG.premium,
    ...(base.premium ?? {}),
    plans: Array.isArray(base.premium?.plans) ? [...base.premium.plans] : [...DEFAULT_BOT_COINS_CONFIG.premium.plans],
    commandKeys: Array.isArray(base.premium?.commandKeys) ? [...base.premium.commandKeys] : [],
  };
  base.robbery = {
    ...DEFAULT_BOT_COINS_CONFIG.robbery,
    ...(base.robbery ?? {}),
  };
  base.shopItems = Array.isArray(base.shopItems) ? base.shopItems : [];
  if (!source || typeof source !== "object") {
    base.interactiveShopEnabled = false;
    base.robbery.enabled = false;
    base.shopItems = [];
    return base;
  }
  const record = source as Record<string, unknown>;

  if (record.enabled !== undefined) {
    base.enabled = normalizeBooleanLike(record.enabled);
  }
  if (typeof record.currencyName === "string" && record.currencyName.trim()) {
    base.currencyName = record.currencyName.trim().slice(0, 40);
  }
  if (record.monetizationOnly !== undefined) {
    base.monetizationOnly = normalizeBooleanLike(record.monetizationOnly);
  } else if (record.commandMonetizationOnly !== undefined) {
    base.monetizationOnly = normalizeBooleanLike(record.commandMonetizationOnly);
  }
  if (record.interactiveShopEnabled !== undefined) {
    base.interactiveShopEnabled = normalizeBooleanLike(record.interactiveShopEnabled);
  } else if (record.shopEnabled !== undefined) {
    base.interactiveShopEnabled = normalizeBooleanLike(record.shopEnabled);
  }

  const earnings = record.earnings && typeof record.earnings === "object"
    ? (record.earnings as Record<string, unknown>)
    : null;
  if (earnings) {
    const msg = earnings.message && typeof earnings.message === "object"
      ? (earnings.message as Record<string, unknown>)
      : null;
    if (msg) {
      if (msg.enabled !== undefined) base.earnings.message.enabled = normalizeBooleanLike(msg.enabled);
      base.earnings.message.amount = normalizeNumberClamp(
        msg.amount,
        base.earnings.message.amount,
        { min: 0, max: 1000 },
      );
      base.earnings.message.messagesPerReward = normalizeNumberClamp(
        msg.messagesPerReward ?? msg.messagesPerGain ?? msg.perMessages ?? msg.perMessage,
        base.earnings.message.messagesPerReward,
        { min: 10, max: 10_000 },
      );
      base.earnings.message.cooldownSec = normalizeNumberClamp(
        msg.cooldownSec ?? msg.cooldown,
        base.earnings.message.cooldownSec,
        { min: 0, max: 3600 },
      );
      base.earnings.message.minLength = normalizeNumberClamp(
        msg.minLength,
        base.earnings.message.minLength,
        { min: 1, max: 500 },
      );
      base.earnings.message.maxPerDay = normalizeNumberClamp(
        msg.maxPerDay,
        base.earnings.message.maxPerDay,
        { min: 0, max: 10_000 },
      );
    }

    const daily = earnings.daily && typeof earnings.daily === "object"
      ? (earnings.daily as Record<string, unknown>)
      : null;
    if (daily) {
      if (daily.enabled !== undefined) base.earnings.daily.enabled = normalizeBooleanLike(daily.enabled);
      base.earnings.daily.amount = normalizeNumberClamp(
        daily.amount,
        base.earnings.daily.amount,
        { min: 0, max: 10_000 },
      );
    }

    const levelUp = earnings.levelUp && typeof earnings.levelUp === "object"
      ? (earnings.levelUp as Record<string, unknown>)
      : null;
    if (levelUp) {
      if (levelUp.enabled !== undefined) base.earnings.levelUp.enabled = normalizeBooleanLike(levelUp.enabled);
      base.earnings.levelUp.amount = normalizeNumberClamp(
        levelUp.amount,
        base.earnings.levelUp.amount,
        { min: 0, max: 10_000 },
      );
    }
  }

  const leveling = record.leveling && typeof record.leveling === "object"
    ? (record.leveling as Record<string, unknown>)
    : null;
  if (leveling) {
    base.leveling.xpPerMessage = normalizeNumberClamp(
      leveling.xpPerMessage,
      base.leveling.xpPerMessage,
      { min: 0, max: 1000 },
    );
    base.leveling.levelStep = normalizeNumberClamp(
      leveling.levelStep,
      base.leveling.levelStep,
      { min: 1, max: 100_000 },
    );
  }

  const penalties = record.penalties && typeof record.penalties === "object"
    ? (record.penalties as Record<string, unknown>)
    : null;
  if (penalties) {
    const infraction = penalties.infraction && typeof penalties.infraction === "object"
      ? (penalties.infraction as Record<string, unknown>)
      : null;
    if (infraction) {
      if (infraction.enabled !== undefined) base.penalties.infraction.enabled = normalizeBooleanLike(infraction.enabled);
      base.penalties.infraction.amount = normalizeNumberClamp(
        infraction.amount,
        base.penalties.infraction.amount,
        { min: 0, max: 10_000 },
      );
    }
  }

  const spending = record.spending && typeof record.spending === "object"
    ? (record.spending as Record<string, unknown>)
    : null;
  if (spending) {
    const defaults = spending.defaultCostsByCategory && typeof spending.defaultCostsByCategory === "object"
      ? (spending.defaultCostsByCategory as Record<string, unknown>)
      : null;
    if (defaults) {
      if (defaults.downloads !== undefined) {
        base.spending.defaultCostsByCategory.downloads = normalizeNumberClamp(
          defaults.downloads,
          base.spending.defaultCostsByCategory.downloads,
          { min: 0, max: 10_000 },
        );
      }
      if (defaults.media !== undefined) {
        base.spending.defaultCostsByCategory.media = normalizeNumberClamp(
          defaults.media,
          base.spending.defaultCostsByCategory.media,
          { min: 0, max: 10_000 },
        );
      }
    }

    const costsRaw = spending.commandCosts && typeof spending.commandCosts === "object"
      ? (spending.commandCosts as Record<string, unknown>)
      : null;
    if (costsRaw) {
      const next: Record<string, number> = {};
      for (const [key, value] of Object.entries(costsRaw)) {
        const normalizedKey = normalizeAliasToken(key);
        if (!normalizedKey) continue;
        const cost = normalizeNumberClamp(value, 0, { min: 0, max: 10_000 });
        next[normalizedKey] = cost;
      }
      base.spending.commandCosts = next;
    }

    if (spending.autoDownloaderCost !== undefined) {
      base.spending.autoDownloaderCost = normalizeNumberClamp(
        spending.autoDownloaderCost,
        base.spending.autoDownloaderCost,
        { min: 0, max: 10_000 },
      );
    }
    if (spending.autoStickerCost !== undefined) {
      base.spending.autoStickerCost = normalizeNumberClamp(
        spending.autoStickerCost,
        base.spending.autoStickerCost,
        { min: 0, max: 10_000 },
      );
    }
  }

  const notifications = record.notifications && typeof record.notifications === "object"
    ? (record.notifications as Record<string, unknown>)
    : null;
  if (notifications) {
    if (typeof notifications.mode === "string") {
      const mode = notifications.mode.trim().toLowerCase();
      if (mode === "group_reply" || mode === "private" || mode === "silent") {
        base.notifications.mode = mode as BotGroupCoinsConfig["notifications"]["mode"];
      }
    }
    if (notifications.includeBalance !== undefined) {
      base.notifications.includeBalance = normalizeBooleanLike(notifications.includeBalance);
    }
  }

  const premium = record.premium && typeof record.premium === "object"
    ? (record.premium as Record<string, unknown>)
    : null;
  if (premium) {
    if (premium.enabled !== undefined) base.premium.enabled = normalizeBooleanLike(premium.enabled);
    base.premium.price = normalizeNumberClamp(
      premium.price ?? premium.cost ?? premium.subscriptionPrice,
      base.premium.price,
      { min: 0, max: 1_000_000 },
    );
    base.premium.durationDays = normalizeNumberClamp(
      premium.durationDays ?? premium.days ?? premium.validityDays,
      base.premium.durationDays,
      { min: 1, max: 3650 },
    );
    if (premium.bypassCoinCosts !== undefined) {
      base.premium.bypassCoinCosts = normalizeBooleanLike(premium.bypassCoinCosts);
    } else if (premium.freePremiumCommands !== undefined) {
      base.premium.bypassCoinCosts = normalizeBooleanLike(premium.freePremiumCommands);
    }
    const plansRaw = premium.plans ?? premium.subscriptionPlans ?? premium.premiumPlans ?? null;
    if (Array.isArray(plansRaw)) {
      const nextPlans: BotGroupCoinsConfig["premium"]["plans"] = [];
      const usedKeys = new Set<string>();
      plansRaw.slice(0, 3).forEach((rawPlan, index) => {
        const planRecord = rawPlan && typeof rawPlan === "object"
          ? (rawPlan as Record<string, unknown>)
          : {};
        const fallbackKey = `p${index + 1}`;
        let key = normalizePremiumPlanKey(planRecord.key ?? planRecord.id ?? planRecord.name, fallbackKey);
        while (usedKeys.has(key)) {
          key = `${fallbackKey}${usedKeys.size + 1}`;
        }
        usedKeys.add(key);
        const labelRaw = typeof planRecord.label === "string"
          ? planRecord.label
          : typeof planRecord.name === "string"
            ? planRecord.name
            : "";
        const durationDays = normalizeNumberClamp(
          planRecord.durationDays ?? planRecord.days ?? planRecord.validityDays,
          index === 0 ? base.premium.durationDays : DEFAULT_BOT_COINS_CONFIG.premium.plans[index]?.durationDays ?? 30,
          { min: 1, max: 3650 },
        );
        const price = normalizeNumberClamp(
          planRecord.price ?? planRecord.cost ?? planRecord.value,
          index === 0 ? base.premium.price : DEFAULT_BOT_COINS_CONFIG.premium.plans[index]?.price ?? 0,
          { min: 0, max: 1_000_000 },
        );
        const description = typeof planRecord.description === "string" && planRecord.description.trim()
          ? planRecord.description.trim().slice(0, 160)
          : null;
        nextPlans.push({
          key,
          label: labelRaw.trim().slice(0, 60) || `Premium ${durationDays} dias`,
          price,
          durationDays,
          enabled: planRecord.enabled !== undefined ? normalizeBooleanLike(planRecord.enabled) : true,
          description,
        });
      });
      if (nextPlans.length > 0) {
        base.premium.plans = nextPlans;
      }
    } else if (!Array.isArray(base.premium.plans) || base.premium.plans.length === 0) {
      base.premium.plans = [
        {
          key: "p30",
          label: "Premium 30 dias",
          price: base.premium.price,
          durationDays: base.premium.durationDays,
          enabled: true,
          description: "Acesso premium configurado pelo administrador.",
        },
      ];
    }
    const premiumCommandsRaw =
      premium.commandKeys ??
      premium.commands ??
      premium.premiumCommands ??
      null;
    if (Array.isArray(premiumCommandsRaw)) {
      const next = new Set<string>();
      for (const entry of premiumCommandsRaw) {
        const normalizedKey = normalizeAliasToken(entry);
        if (normalizedKey) next.add(normalizedKey);
      }
      base.premium.commandKeys = [...next].slice(0, 300);
    }
  }

  const robbery = record.robbery && typeof record.robbery === "object"
    ? (record.robbery as Record<string, unknown>)
    : null;
  if (robbery) {
    if (robbery.enabled !== undefined) base.robbery.enabled = normalizeBooleanLike(robbery.enabled);
    base.robbery.cooldownHours = normalizeNumberClamp(
      robbery.cooldownHours,
      base.robbery.cooldownHours,
      { min: 0, max: 168 },
    );
    base.robbery.targetCooldownHours = normalizeNumberClamp(
      robbery.targetCooldownHours,
      base.robbery.targetCooldownHours,
      { min: 0, max: 168 },
    );
    base.robbery.attemptCost = normalizeNumberClamp(
      robbery.attemptCost,
      base.robbery.attemptCost,
      { min: 0, max: 10_000 },
    );
    base.robbery.failPenalty = normalizeNumberClamp(
      robbery.failPenalty,
      base.robbery.failPenalty,
      { min: 0, max: 10_000 },
    );
    base.robbery.minAttackerBalance = normalizeNumberClamp(
      robbery.minAttackerBalance,
      base.robbery.minAttackerBalance,
      { min: 0, max: 1_000_000 },
    );
    base.robbery.minTargetBalance = normalizeNumberClamp(
      robbery.minTargetBalance,
      base.robbery.minTargetBalance,
      { min: 0, max: 1_000_000 },
    );
    base.robbery.stealPercentMin = normalizeNumberClamp(
      robbery.stealPercentMin,
      base.robbery.stealPercentMin,
      { min: 0, max: 100 },
    );
    base.robbery.stealPercentMax = normalizeNumberClamp(
      robbery.stealPercentMax,
      base.robbery.stealPercentMax,
      { min: 0, max: 100 },
    );
    const minPercent = Math.min(base.robbery.stealPercentMin, base.robbery.stealPercentMax);
    const maxPercent = Math.max(base.robbery.stealPercentMin, base.robbery.stealPercentMax);
    base.robbery.stealPercentMin = minPercent;
    base.robbery.stealPercentMax = maxPercent;
    base.robbery.minSteal = normalizeNumberClamp(
      robbery.minSteal,
      base.robbery.minSteal,
      { min: 0, max: 1_000_000 },
    );
    base.robbery.maxSteal = normalizeNumberClamp(
      robbery.maxSteal,
      base.robbery.maxSteal,
      { min: 0, max: 1_000_000 },
    );
    if (base.robbery.maxSteal < base.robbery.minSteal) {
      base.robbery.maxSteal = base.robbery.minSteal;
    }
  }

  const itemsRaw =
    record.shopItems ??
    record.items ??
    record.robberyItems ??
    null;
  if (Array.isArray(itemsRaw)) {
    if (itemsRaw.length === 0) {
      base.shopItems = [];
    } else {
      const nextItems: BotGroupCoinsConfig["shopItems"] = [];
      for (const rawItem of itemsRaw) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const itemRecord = rawItem as Record<string, unknown>;
        const key = normalizeCoinItemKey(itemRecord.key ?? itemRecord.id ?? itemRecord.name);
        if (!key) continue;
        const labelRaw = typeof itemRecord.label === "string" ? itemRecord.label : String(itemRecord.name ?? "");
        const label = labelRaw.trim() ? labelRaw.trim().slice(0, 40) : key;
        const iconRaw = typeof itemRecord.icon === "string" ? itemRecord.icon : "";
        const icon = iconRaw.trim() ? iconRaw.trim().slice(0, 8) : "🛡️";
        const type =
          itemRecord.type === "block"
            ? "block"
            : itemRecord.type === "attack"
              ? "attack"
              : "reduce";
        const price = normalizeNumberClamp(itemRecord.price, 0, { min: 0, max: 1_000_000 });
        const durationDays = normalizeNumberClamp(itemRecord.durationDays, 1, { min: 1, max: 365 });
        const uses = normalizeNumberClamp(itemRecord.uses, 1, { min: 1, max: 10_000 });
        const reducePercent =
          type === "reduce"
            ? normalizeNumberClamp(itemRecord.reducePercent ?? itemRecord.reduce, 0, { min: 0, max: 100 })
            : undefined;
        const reflectPenalty =
          type === "block"
            ? normalizeNumberClamp(itemRecord.reflectPenalty ?? itemRecord.reflect, 0, { min: 0, max: 10_000 })
            : undefined;
        const successBonusPercent =
          type === "attack"
            ? normalizeNumberClamp(
                itemRecord.successBonusPercent ??
                  itemRecord.successBonus ??
                  itemRecord.bonusSuccess,
                0,
                { min: 0, max: 100 },
              )
            : undefined;
        const stealBonusPercent =
          type === "attack"
            ? normalizeNumberClamp(
                itemRecord.stealBonusPercent ??
                  itemRecord.stealBonus ??
                  itemRecord.bonusSteal,
                0,
                { min: 0, max: 300 },
              )
            : undefined;
        const resetTarget =
          type === "attack"
            ? normalizeBooleanLike(itemRecord.resetTarget ?? itemRecord.reset)
            : undefined;
        const description =
          typeof itemRecord.description === "string" && itemRecord.description.trim()
            ? itemRecord.description.trim().slice(0, 120)
            : undefined;
        const enabled =
          itemRecord.enabled !== undefined ? normalizeBooleanLike(itemRecord.enabled) : true;
        const aliases = parseCoinItemAliases(itemRecord.aliases ?? itemRecord.alias, key);

        nextItems.push({
          key,
          label,
          icon,
          price,
          durationDays,
          uses,
          type,
          reducePercent,
          reflectPenalty,
          successBonusPercent,
          stealBonusPercent,
          resetTarget,
          description,
          enabled,
          aliases,
        });
      }
      const hasAttackItem = nextItems.some((item) => item.type === "attack");
      if (!hasAttackItem) {
        const existingKeys = new Set(nextItems.map((item) => item.key));
        for (const item of DEFAULT_BOT_COINS_CONFIG.shopItems) {
          if (item.type !== "attack") continue;
          if (existingKeys.has(item.key)) continue;
          nextItems.push({
            key: item.key,
            label: item.label,
            icon: item.icon,
            price: item.price,
            durationDays: item.durationDays,
            uses: item.uses,
            type: item.type,
            reducePercent: item.reducePercent,
            reflectPenalty: item.reflectPenalty,
            successBonusPercent: item.successBonusPercent,
            stealBonusPercent: item.stealBonusPercent,
            resetTarget: item.resetTarget,
            description: item.description,
            enabled: item.enabled !== false,
            aliases: Array.isArray(item.aliases) ? [...item.aliases] : [],
          });
        }
      }
      if (nextItems.length > 0) {
        base.shopItems = nextItems;
      }
    }
  }

  base.interactiveShopEnabled = false;
  base.robbery.enabled = false;
  base.shopItems = [];

  const topup = record.topup && typeof record.topup === "object"
    ? (record.topup as Record<string, unknown>)
    : null;
  if (topup) {
    if (topup.enabled !== undefined) base.topup.enabled = normalizeBooleanLike(topup.enabled);
    base.topup.coinsPerCurrency = normalizeNumberClamp(
      topup.coinsPerCurrency ?? topup.coinsPerReal ?? topup.rate,
      base.topup.coinsPerCurrency,
      { min: 1, max: 1_000_000 },
    );
    base.topup.minCoins = normalizeNumberClamp(
      topup.minCoins,
      base.topup.minCoins,
      { min: 1, max: 1_000_000 },
    );
    base.topup.maxCoins = normalizeNumberClamp(
      topup.maxCoins,
      base.topup.maxCoins,
      { min: 1, max: 1_000_000 },
    );
    if (base.topup.maxCoins < base.topup.minCoins) {
      base.topup.maxCoins = base.topup.minCoins;
    }
    if (topup.allowPix !== undefined) {
      base.topup.allowPix = normalizeBooleanLike(topup.allowPix);
    }
    if (topup.allowCheckout !== undefined) {
      base.topup.allowCheckout = normalizeBooleanLike(topup.allowCheckout);
    }
    if (base.topup.allowPix && base.topup.allowCheckout) {
      base.topup.allowCheckout = false;
    }
  }

  const rewards = record.rewards && typeof record.rewards === "object"
    ? (record.rewards as Record<string, unknown>)
    : null;
  if (rewards) {
    const weekly = rewards.weekly && typeof rewards.weekly === "object"
      ? (rewards.weekly as Record<string, unknown>)
      : null;
    if (weekly) {
      if (weekly.enabled !== undefined) base.rewards.weekly.enabled = normalizeBooleanLike(weekly.enabled);
      base.rewards.weekly.amount = normalizeNumberClamp(
        weekly.amount,
        base.rewards.weekly.amount,
        { min: 0, max: 1_000_000 },
      );
      base.rewards.weekly.top = normalizeNumberClamp(
        weekly.top,
        base.rewards.weekly.top,
        { min: 1, max: 100 },
      );
      base.rewards.weekly.minMessages = normalizeNumberClamp(
        weekly.minMessages,
        base.rewards.weekly.minMessages,
        { min: 0, max: 1_000_000 },
      );
      if (weekly.announce !== undefined) base.rewards.weekly.announce = normalizeBooleanLike(weekly.announce);
    }

    const monthly = rewards.monthly && typeof rewards.monthly === "object"
      ? (rewards.monthly as Record<string, unknown>)
      : null;
    if (monthly) {
      if (monthly.enabled !== undefined) base.rewards.monthly.enabled = normalizeBooleanLike(monthly.enabled);
      base.rewards.monthly.amount = normalizeNumberClamp(
        monthly.amount,
        base.rewards.monthly.amount,
        { min: 0, max: 1_000_000 },
      );
      base.rewards.monthly.top = normalizeNumberClamp(
        monthly.top,
        base.rewards.monthly.top,
        { min: 1, max: 100 },
      );
      base.rewards.monthly.minMessages = normalizeNumberClamp(
        monthly.minMessages,
        base.rewards.monthly.minMessages,
        { min: 0, max: 1_000_000 },
      );
      if (monthly.announce !== undefined) base.rewards.monthly.announce = normalizeBooleanLike(monthly.announce);
    }
  }

  return base;
};

const normalizePremiumConfigEntry = (
  raw: unknown,
  fallback?: BotGroupCoinsConfig["premium"],
): BotGroupCoinsConfig["premium"] => {
  const wrapperFallback = cloneBotCoinsConfig(DEFAULT_BOT_COINS_CONFIG);
  wrapperFallback.premium = {
    ...DEFAULT_PREMIUM_CONFIG,
    ...(fallback ?? {}),
    plans: Array.isArray(fallback?.plans) ? [...fallback.plans] : [...DEFAULT_PREMIUM_CONFIG.plans],
    commandKeys: Array.isArray(fallback?.commandKeys) ? [...fallback.commandKeys] : [],
  };
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  const premiumSource =
    source && typeof source === "object" && Object.prototype.hasOwnProperty.call(source, "premium")
      ? (source as Record<string, unknown>).premium
      : source;
  const wrapper = normalizeBotCoinsConfigEntry({ premium: premiumSource }, wrapperFallback);
  return wrapper.premium;
};

const extractLegacyPremiumConfig = (raw: unknown): unknown => {
  if (!raw) return null;
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!source || typeof source !== "object") return null;
  return (source as Record<string, unknown>).premium ?? null;
};

export const normalizeAutoResponseEntry = (
  raw: Partial<BotGroupAutoResponse>,
): BotGroupAutoResponse => {
  const now = new Date().toISOString();
  const triggers = Array.isArray(raw.triggers)
    ? raw.triggers
        .map((trigger) => trigger?.toString().trim().toLowerCase())
        .filter((trigger, index, array) => trigger && array.indexOf(trigger) === index)
    : [];

  return {
    id: raw.id && typeof raw.id === "string" ? raw.id : randomUUID(),
    triggers,
    matchMode:
      raw.matchMode === "contains" || raw.matchMode === "equals"
        ? raw.matchMode
        : "equals",
    responseText:
      typeof raw.responseText === "string"
        ? raw.responseText.trim()
        : typeof raw.responseText === "number"
          ? String(raw.responseText)
          : "",
    responseMedia: normalizeAutoResponseMedia(
      (raw as Record<string, unknown>).responseMedia ??
        (raw as Record<string, unknown>).media ??
        null,
    ),
    responseVcard: normalizeAutoResponseVcard(
      (raw as Record<string, unknown>).responseVcard ??
        (raw as Record<string, unknown>).vcard ??
        null,
    ),
    responseButtons: normalizeAutoResponseButtons(
      (raw as Record<string, unknown>).responseButtons ??
        (raw as Record<string, unknown>).buttonTemplate ??
        (raw as Record<string, unknown>).buttonsTemplate ??
        (raw as Record<string, unknown>).buttons ??
        null,
    ),
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt.trim()
        ? raw.createdAt
        : now,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : now,
    matchAnyMessage: normalizeBooleanLike(
      (raw as Record<string, unknown>).matchAnyMessage ??
        (raw as Record<string, unknown>).match_any_message ??
        (raw as Record<string, unknown>).globalTrigger ??
        (raw as Record<string, unknown>).global ??
        (raw as Record<string, unknown>).respondAll ??
        false,
    ),
    perContactLimit: normalizePositiveLimit(
      (raw as Record<string, unknown>).perContactLimit ??
        (raw as Record<string, unknown>).per_contact_limit ??
        (raw as Record<string, unknown>).contactLimit ??
        (raw as Record<string, unknown>).contact_limit ??
        null,
    ),
  } satisfies BotGroupAutoResponse;
};

const parseAutoResponses = (raw: unknown): BotGroupAutoResponse[] => {
  if (!raw) {
    return [];
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : raw;

  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((entry) =>
      entry && typeof entry === "object"
        ? normalizeAutoResponseEntry(entry as Partial<BotGroupAutoResponse>)
        : null,
    )
    .filter((entry): entry is BotGroupAutoResponse => Boolean(entry))
    .filter((entry, index, array) => {
      const hasPayload =
        entry.responseText.length > 0 ||
        entry.responseMedia !== null ||
        entry.responseVcard !== null ||
        entry.responseButtons !== null;
      if (!hasPayload) {
        return false;
      }
      if (!entry.matchAnyMessage && entry.triggers.length === 0) {
        return false;
      }
      return array.findIndex((item) => item.id === entry.id) === index;
    });
};

const DEFAULT_AD_FREQUENCY = "24h";

const normalizeAdFrequency = (value: string | null | undefined): string => {
  if (!value) {
    return DEFAULT_AD_FREQUENCY;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return DEFAULT_AD_FREQUENCY;
  }
  const match = trimmed.match(/^(\d+)([mhd])$/i);
  if (!match) {
    return DEFAULT_AD_FREQUENCY;
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return DEFAULT_AD_FREQUENCY;
  }
  if (unit === "m") {
    const clamped = Math.max(1, amount);
    return `${clamped}m`;
  }
  if (unit === "h") {
    const clamped = Math.max(1, amount);
    return `${clamped}h`;
  }
  if (unit === "d") {
    const clamped = Math.max(1, amount);
    return `${clamped}d`;
  }
  return `${amount}${unit}` as string;
};

const normalizeAdTimes = (input: unknown): string[] => {
  if (!input) {
    return [];
  }
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,|\n]/)
      : [];
  const normalized = new Set<string>();
  for (const entry of source) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!match) continue;
    const hours = Math.max(0, Math.min(23, Number.parseInt(match[1], 10)));
    const minutes = match[2] ? Math.max(0, Math.min(59, Number.parseInt(match[2], 10))) : 0;
    const formatted = `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`;
    normalized.add(formatted);
  }
  return Array.from(normalized).sort();
};

const normalizeAdEntry = (raw: Partial<BotGroupAd> & Record<string, unknown>): BotGroupAd => {
  const nowIso = new Date().toISOString();
  const enabledRaw = (raw as Record<string, unknown>).enabled;
  const mentionAllRaw = (raw as Record<string, unknown>).mentionAll;
  const enabled =
    enabledRaw === false || enabledRaw === "false" || enabledRaw === 0 || enabledRaw === "0"
      ? false
      : true;
  const scheduleType =
    raw.scheduleType === "times" ? "times" : raw.scheduleType === "frequency" ? "frequency" : "frequency";
  const times = scheduleType === "times" ? normalizeAdTimes(raw.times) : [];
  const frequency =
    scheduleType === "frequency"
      ? normalizeAdFrequency(typeof raw.frequency === "string" ? raw.frequency : null)
      : DEFAULT_AD_FREQUENCY;

  const media = normalizeAutoResponseMedia(raw.media ?? raw.mediaResource ?? null);
  const responseButtons = normalizeAutoResponseButtons(
    raw.responseButtons ??
      raw.buttonTemplate ??
      raw.buttonsTemplate ??
      raw.buttons ??
      null,
  );
  const interactiveButtonsSource =
    raw.interactiveButtons ??
    (raw as Record<string, unknown>).interactive_buttons ??
    null;
  const interactiveButtons = Array.isArray(interactiveButtonsSource)
    ? interactiveButtonsSource
        .map((entry, index) => sanitizeReplyButtonEntry(entry, index + 1))
        .filter((entry): entry is BotGroupWelcomeReplyButton => Boolean(entry))
        .slice(0, 3)
    : null;

  const sentTimesSource = raw.sentTimes && typeof raw.sentTimes === "object" ? raw.sentTimes : {};
  const sentTimes: Record<string, string> = {};
  for (const [key, value] of Object.entries(sentTimesSource as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    sentTimes[key.trim()] = value.trim();
  }

  const caption = typeof raw.caption === "string" ? raw.caption.replace(/\r\n/g, "\n").trim() : "";

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : randomUUID(),
    enabled,
    caption,
    mentionAll: mentionAllRaw === true || mentionAllRaw === "true",
    scheduleType: times.length > 0 && scheduleType === "times" ? "times" : "frequency",
    frequency,
    times: times.length > 0 ? times : undefined,
    lastSentAt:
      typeof raw.lastSentAt === "string" && raw.lastSentAt.trim()
        ? toIsoString(raw.lastSentAt)
        : null,
    sentTimes: Object.keys(sentTimes).length > 0 ? sentTimes : undefined,
    media,
    responseButtons,
    interactiveButtons:
      interactiveButtons && interactiveButtons.length > 0
        ? interactiveButtons
        : null,
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt.trim()
        ? toIsoString(raw.createdAt)
        : nowIso,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? toIsoString(raw.updatedAt)
        : nowIso,
  };
};

const parseAdsConfig = (raw: unknown): BotGroupAd[] => {
  if (!raw) {
    return [];
  }
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : raw;
  if (!Array.isArray(source)) {
    return [];
  }
  const normalized = source
    .map((entry) =>
      entry && typeof entry === "object" ? normalizeAdEntry(entry as Partial<BotGroupAd> & Record<string, unknown>) : null,
    )
    .filter((entry): entry is BotGroupAd => Boolean(entry));

  const unique = new Map<string, BotGroupAd>();
  for (const ad of normalized) {
    if (!unique.has(ad.id)) {
      unique.set(ad.id, ad);
    }
  }
  return Array.from(unique.values());
};

const normalizeAdsUpdate = (current: BotGroupAd[], updates: BotGroupAd[] | null | undefined): BotGroupAd[] => {
  if (!updates) {
    return current.slice();
  }
  const currentById = new Map<string, BotGroupAd>();
  for (const ad of current) {
    currentById.set(ad.id, ad);
  }
  return updates.map((entry) => {
    const base = entry && typeof entry === "object" ? entry : ({} as BotGroupAd);
    const existing = base.id ? currentById.get(base.id) : undefined;
    const merged = existing ? { ...existing, ...base } : base;
    return normalizeAdEntry(merged as Partial<BotGroupAd> & Record<string, unknown>);
  });
};

const normalizeMarkMessageEntry = (
  raw: Partial<BotGroupMarkMessage> & Record<string, unknown>,
): BotGroupMarkMessage => {
  const nowIso = new Date().toISOString();
  const captionRaw =
    typeof raw.caption === "string" ? raw.caption.replace(/\r\n/g, "\n").trim() : "";
  const media = normalizeAutoResponseMedia(raw.media ?? raw.mediaResource ?? null);
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? toIsoString(raw.updatedAt)
      : nowIso;

  return {
    caption: captionRaw ? captionRaw : null,
    media,
    updatedAt,
  };
};

const normalizeStaticMessageEntry = (
  raw: Partial<BotGroupStaticMessage> & Record<string, unknown>,
): BotGroupStaticMessage => {
  const nowIso = new Date().toISOString();
  const textRaw = (() => {
    if (typeof raw.text === "string" && raw.text.trim()) {
      return raw.text.replace(/\r\n/g, "\n").trim();
    }
    if (typeof (raw as Record<string, unknown>).caption === "string") {
      return String((raw as Record<string, unknown>).caption)
        .replace(/\r\n/g, "\n")
        .trim();
    }
    return "";
  })();
  const media = normalizeAutoResponseMedia(raw.media ?? raw.mediaResource ?? null);
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? toIsoString(raw.updatedAt)
      : nowIso;

  return {
    text: textRaw || null,
    media,
    updatedAt,
  };
};

const parseLastMarkMessage = (raw: unknown): BotGroupMarkMessage | null => {
  if (!raw) {
    return null;
  }
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return null;
  }

  return normalizeMarkMessageEntry(source as Partial<BotGroupMarkMessage> & Record<string, unknown>);
};

const parseLastBroadcastTemplate = (raw: unknown): BotGroupBroadcastTemplate | null => {
  if (!raw) {
    return null;
  }
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!source || typeof source !== "object") {
    return null;
  }
  return parseBroadcastTemplate(source);
};

const parseStaticMessageEntry = (raw: unknown): BotGroupStaticMessage | null => {
  if (!raw) {
    return null;
  }
  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return null;
  }

  return normalizeStaticMessageEntry(source as Partial<BotGroupStaticMessage> & Record<string, unknown>);
};

const normalizeBroadcastTemplateEntry = (
  raw: Partial<BotGroupBroadcastTemplate> | BotGroupBroadcastTemplate | null,
): BotGroupBroadcastTemplate | null => {
  if (!raw) {
    return null;
  }
  return parseBroadcastTemplate(raw);
};

const toIsoString = (value: Date | string | null | undefined): string => {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
};

const toMysqlDateTime = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 19).replace("T", " ");
};

const normalizeHorapgConfigEntry = (
  raw: unknown,
  fallback?: BotGroupHorapgConfig,
): BotGroupHorapgConfig => {
  const base = fallback ? { ...fallback } : { ...DEFAULT_HORAPG_CONFIG };

  if (raw === null || raw === undefined) {
    return base;
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return base;
  }

  const record = source as Record<string, unknown>;
  const enabled = record.enabled;
  if (enabled === true || enabled === false) {
    base.enabled = enabled;
  } else if (typeof enabled === "string") {
    const normalized = enabled.trim().toLowerCase();
    base.enabled = ["1", "true", "on", "yes", "sim"].includes(normalized);
  }

  if (Array.isArray(record.times)) {
    const sanitized = record.times
      .map((entry) => {
        if (typeof entry !== "string") return null;
        return normalizeHorapgTimeToken(entry);
      })
      .filter((entry): entry is string => Boolean(entry));
    if (sanitized.length > 0) {
      base.times = Array.from(new Set(sanitized)).slice(0, 12);
    } else {
      base.times = [];
    }
  } else if (typeof record.times === "string") {
    base.times = parseHorapgTimesArgument(record.times).slice(0, 12);
  }

  const imageUrl = record.imageUrl ?? record.image_url ?? record.imageURL;
  if (imageUrl === null) {
    base.imageUrl = null;
  } else if (typeof imageUrl === "string") {
    const trimmed = imageUrl.trim();
    base.imageUrl = trimmed.length > 0 ? trimmed : null;
  }

  const imagePath = record.imagePath ?? record.image_path ?? record.path;
  if (imagePath === null) {
    base.imagePath = null;
  } else if (typeof imagePath === "string") {
    const trimmed = imagePath.trim();
    base.imagePath = trimmed.length > 0 ? trimmed.replace(/^\/+/, "") : null;
  }

  const mentionAll = record.mentionAll ?? record.mention_all ?? record.tagAll;
  if (mentionAll === null) {
    base.mentionAll = false;
  } else if (mentionAll === true || mentionAll === false) {
    base.mentionAll = mentionAll;
  } else if (typeof mentionAll === "string") {
    const normalized = mentionAll.trim().toLowerCase();
    base.mentionAll = ["1", "true", "on", "yes", "sim"].includes(normalized);
  }

  const timezone = record.timezone ?? record.timeZone ?? record.tz;
  if (timezone === null) {
    base.timezone = null;
  } else if (typeof timezone === "string") {
    const normalized = normalizeTimezoneInput(timezone);
    base.timezone = normalized;
  }

  const sentTimes = record.sentTimes ?? record.sent_times;
  if (Array.isArray(sentTimes)) {
    const normalized: Record<string, string> = {};
    for (const entry of sentTimes) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const time = normalizeHorapgTimeToken(String(rec.time ?? rec.clock ?? ""));
      const date = typeof rec.date === "string" ? rec.date.trim() : null;
      if (time && date) {
        normalized[time] = date;
      }
    }
    base.sentTimes = normalized;
  } else if (sentTimes && typeof sentTimes === "object") {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(sentTimes as Record<string, unknown>)) {
      const time = normalizeHorapgTimeToken(key);
      if (!time) continue;
      if (typeof value === "string" && value.trim()) {
        normalized[time] = value.trim();
      } else if (value instanceof Date) {
        normalized[time] = value.toISOString().slice(0, 10);
      }
    }
    base.sentTimes = normalized;
  }

  if (Object.prototype.hasOwnProperty.call(record, "lastSentAt") || Object.prototype.hasOwnProperty.call(record, "last_sent_at")) {
    const raw = record.lastSentAt ?? record.last_sent_at;
    if (raw === null) {
      base.lastSentAt = null;
    } else if (typeof raw === "string" && raw.trim()) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        base.lastSentAt = parsed.toISOString();
      }
    } else if (raw instanceof Date) {
      base.lastSentAt = raw.toISOString();
    }
  }

  return base;
};

const mergeHorapgConfig = (
  current: BotGroupHorapgConfig,
  update: Partial<BotGroupHorapgConfig> | undefined,
): BotGroupHorapgConfig => {
  if (!update || Object.keys(update).length === 0) {
    return { ...current };
  }
  const merged = normalizeHorapgConfigEntry({ ...current, ...update }, current);
  if (!merged.enabled) {
    merged.sentTimes = {};
    merged.lastSentAt = null;
  } else if (Object.prototype.hasOwnProperty.call(update, "times")) {
    merged.sentTimes = {};
  }

  if (Object.prototype.hasOwnProperty.call(update, "imageUrl") && merged.imageUrl === undefined) {
    merged.imageUrl = null;
  }
  if (Object.prototype.hasOwnProperty.call(update, "imagePath") && merged.imagePath === undefined) {
    merged.imagePath = null;
  }

  const validTimes = new Set(merged.times);
  merged.sentTimes = Object.entries(merged.sentTimes ?? {})
    .filter(([time]) => validTimes.has(time))
    .reduce<Record<string, string>>((acc, [time, date]) => {
      acc[time] = date;
      return acc;
    }, {});

  return merged;
};

const normalizeScheduleConfigEntry = (
  raw: unknown,
  fallback?: BotGroupScheduleConfig,
): BotGroupScheduleConfig => {
  const base = fallback ? { ...fallback } : { ...DEFAULT_SCHEDULE_CONFIG };

  if (raw === null || raw === undefined) {
    return base;
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return base;
  }

  const record = source as Record<string, unknown>;
  const toBool = (value: unknown): boolean | undefined => {
    if (value === true || value === false) return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "on", "yes", "sim"].includes(normalized)) return true;
      if (["0", "false", "off", "no", "nao", "não"].includes(normalized)) return false;
    }
    if (typeof value === "number") {
      if (value === 0) return false;
      if (value === 1) return true;
    }
    return undefined;
  };

  const applyTimes = (value: unknown): string[] => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value) || typeof value === "string") {
      return parseHorapgTimesArgument(value as any);
    }
    return [];
  };
  const applyMessage = (value: unknown): string | null | undefined => {
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const closeEnabled = toBool(record.closeEnabled ?? record.close_enabled);
  if (closeEnabled !== undefined) {
    base.closeEnabled = closeEnabled;
  }
  const openEnabled = toBool(record.openEnabled ?? record.open_enabled);
  if (openEnabled !== undefined) {
    base.openEnabled = openEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(record, "closeTimes") || Object.prototype.hasOwnProperty.call(record, "close_times")) {
    base.closeTimes = applyTimes(record.closeTimes ?? record.close_times);
  }
  if (Object.prototype.hasOwnProperty.call(record, "closeMessage") || Object.prototype.hasOwnProperty.call(record, "close_message")) {
    const closeMessage = applyMessage(record.closeMessage ?? record.close_message);
    if (closeMessage !== undefined) {
      base.closeMessage = closeMessage;
    }
  }
  if (Object.prototype.hasOwnProperty.call(record, "openTimes") || Object.prototype.hasOwnProperty.call(record, "open_times")) {
    base.openTimes = applyTimes(record.openTimes ?? record.open_times);
  }
  if (Object.prototype.hasOwnProperty.call(record, "openMessage") || Object.prototype.hasOwnProperty.call(record, "open_message")) {
    const openMessage = applyMessage(record.openMessage ?? record.open_message);
    if (openMessage !== undefined) {
      base.openMessage = openMessage;
    }
  }

  const parseSentTimes = (value: unknown): Record<string, string> => {
    if (Array.isArray(value)) {
      const result: Record<string, string> = {};
      for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const rec = entry as Record<string, unknown>;
        const clock = normalizeHorapgTimeToken(String(rec.time ?? rec.clock ?? ""));
        const date =
          typeof rec.date === "string"
            ? rec.date.trim()
            : rec.date instanceof Date
              ? rec.date.toISOString().slice(0, 10)
              : null;
        if (clock && date) {
          result[clock] = date;
        }
      }
      return result;
    }
    if (value && typeof value === "object") {
      const result: Record<string, string> = {};
      for (const [clock, date] of Object.entries(value as Record<string, unknown>)) {
        const normalizedClock = normalizeHorapgTimeToken(clock);
        if (!normalizedClock) continue;
        if (typeof date === "string" && date.trim()) {
          result[normalizedClock] = date.trim();
        } else if (date instanceof Date) {
          result[normalizedClock] = date.toISOString().slice(0, 10);
        }
      }
      return result;
    }
    return {};
  };

  if (Object.prototype.hasOwnProperty.call(record, "closeSentTimes") || Object.prototype.hasOwnProperty.call(record, "close_sent_times")) {
    base.closeSentTimes = parseSentTimes(record.closeSentTimes ?? record.close_sent_times);
  }
  if (Object.prototype.hasOwnProperty.call(record, "openSentTimes") || Object.prototype.hasOwnProperty.call(record, "open_sent_times")) {
    base.openSentTimes = parseSentTimes(record.openSentTimes ?? record.open_sent_times);
  }

  if (Object.prototype.hasOwnProperty.call(record, "timezone")) {
    const rawTz = record.timezone;
    if (rawTz === null) {
      base.timezone = null;
    } else if (typeof rawTz === "string") {
      base.timezone = normalizeTimezoneInput(rawTz);
    }
  }

  if (Object.prototype.hasOwnProperty.call(record, "lastCloseAt") || Object.prototype.hasOwnProperty.call(record, "last_close_at")) {
    const raw = record.lastCloseAt ?? record.last_close_at;
    if (raw === null) {
      base.lastCloseAt = null;
    } else if (typeof raw === "string" && raw.trim()) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        base.lastCloseAt = parsed.toISOString();
      }
    } else if (raw instanceof Date) {
      base.lastCloseAt = raw.toISOString();
    }
  }

  if (Object.prototype.hasOwnProperty.call(record, "lastOpenAt") || Object.prototype.hasOwnProperty.call(record, "last_open_at")) {
    const raw = record.lastOpenAt ?? record.last_open_at;
    if (raw === null) {
      base.lastOpenAt = null;
    } else if (typeof raw === "string" && raw.trim()) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        base.lastOpenAt = parsed.toISOString();
      }
    } else if (raw instanceof Date) {
      base.lastOpenAt = raw.toISOString();
    }
  }

  const closeSet = new Set(base.closeTimes);
  base.closeSentTimes = Object.entries(base.closeSentTimes ?? {})
    .filter(([clock]) => closeSet.has(clock))
    .reduce<Record<string, string>>((acc, [clock, date]) => {
      acc[clock] = date;
      return acc;
    }, {});

  const openSet = new Set(base.openTimes);
  base.openSentTimes = Object.entries(base.openSentTimes ?? {})
    .filter(([clock]) => openSet.has(clock))
    .reduce<Record<string, string>>((acc, [clock, date]) => {
      acc[clock] = date;
      return acc;
    }, {});

  return base;
};

const mergeScheduleConfig = (
  current: BotGroupScheduleConfig,
  update: Partial<BotGroupScheduleConfig> | undefined,
): BotGroupScheduleConfig => {
  if (!update || Object.keys(update).length === 0) {
    return { ...current };
  }

  const merged = normalizeScheduleConfigEntry({ ...current, ...update }, current);

  if (!merged.closeEnabled) {
    merged.closeSentTimes = {};
    merged.lastCloseAt = null;
  } else if (Object.prototype.hasOwnProperty.call(update, "closeTimes")) {
    merged.closeSentTimes = {};
  }

  if (!merged.openEnabled) {
    merged.openSentTimes = {};
    merged.lastOpenAt = null;
  } else if (Object.prototype.hasOwnProperty.call(update, "openTimes")) {
    merged.openSentTimes = {};
  }

  const closeSet = new Set(merged.closeTimes);
  merged.closeSentTimes = Object.entries(merged.closeSentTimes ?? {})
    .filter(([clock]) => closeSet.has(clock))
    .reduce<Record<string, string>>((acc, [clock, date]) => {
      acc[clock] = date;
      return acc;
    }, {});

  const openSet = new Set(merged.openTimes);
  merged.openSentTimes = Object.entries(merged.openSentTimes ?? {})
    .filter(([clock]) => openSet.has(clock))
    .reduce<Record<string, string>>((acc, [clock, date]) => {
      acc[clock] = date;
      return acc;
    }, {});

  return merged;
};

const normalizeAntiInactivityConfigEntry = (
  raw: unknown,
  fallback?: BotGroupAntiInactivityConfig,
): BotGroupAntiInactivityConfig => {
  const base = fallback ? { ...fallback } : { ...DEFAULT_ANTI_INACTIVITY_CONFIG };

  if (raw === null || raw === undefined) {
    return base;
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return base;
  }

  const record = source as Record<string, unknown>;
  const toBool = (value: unknown): boolean | undefined => {
    if (value === true || value === false) return value;
    if (typeof value === "number") {
      if (value === 0) return false;
      if (value === 1) return true;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "on", "yes", "sim"].includes(normalized)) return true;
      if (["0", "false", "off", "no", "nao", "não"].includes(normalized)) return false;
    }
    return undefined;
  };
  const toInt = (value: unknown, fallbackValue: number, min: number, max: number): number => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) {
      return fallbackValue;
    }
    return Math.max(min, Math.min(max, parsed));
  };
  const toIsoOrNull = (value: unknown): string | null => {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  const enabled = toBool(record.enabled);
  if (enabled !== undefined) {
    base.enabled = enabled;
  }

  const days = record.days ?? record.inactiveDays ?? record.inactive_days;
  if (days !== undefined) {
    base.days = toInt(days, DEFAULT_ANTI_INACTIVITY_CONFIG.days, 1, 365);
  }

  const scanIntervalHours =
    record.scanIntervalHours ?? record.scan_interval_hours ?? record.intervalHours ?? record.interval_hours;
  if (scanIntervalHours !== undefined) {
    base.scanIntervalHours = toInt(
      scanIntervalHours,
      DEFAULT_ANTI_INACTIVITY_CONFIG.scanIntervalHours,
      1,
      168,
    );
  }

  const removeLimit = record.removeLimit ?? record.remove_limit ?? record.limit;
  if (removeLimit !== undefined) {
    base.removeLimit = toInt(removeLimit, DEFAULT_ANTI_INACTIVITY_CONFIG.removeLimit, 1, 100);
  }

  if (Object.prototype.hasOwnProperty.call(record, "lastRunAt") || Object.prototype.hasOwnProperty.call(record, "last_run_at")) {
    base.lastRunAt = toIsoOrNull(record.lastRunAt ?? record.last_run_at);
  }

  if (
    Object.prototype.hasOwnProperty.call(record, "lastRemovedCount") ||
    Object.prototype.hasOwnProperty.call(record, "last_removed_count")
  ) {
    base.lastRemovedCount = toInt(record.lastRemovedCount ?? record.last_removed_count, 0, 0, 1000);
  }

  if (Object.prototype.hasOwnProperty.call(record, "lastError") || Object.prototype.hasOwnProperty.call(record, "last_error")) {
    const rawError = record.lastError ?? record.last_error;
    base.lastError = rawError === null ? null : String(rawError ?? "").trim().slice(0, 500) || null;
  }

  if (Object.prototype.hasOwnProperty.call(record, "updatedAt") || Object.prototype.hasOwnProperty.call(record, "updated_at")) {
    base.updatedAt = toIsoOrNull(record.updatedAt ?? record.updated_at);
  }

  return base;
};

const mergeAntiInactivityConfig = (
  current: BotGroupAntiInactivityConfig,
  update: Partial<BotGroupAntiInactivityConfig> | undefined,
): BotGroupAntiInactivityConfig => {
  if (!update || Object.keys(update).length === 0) {
    return { ...current };
  }
  const merged = normalizeAntiInactivityConfigEntry({ ...current, ...update }, current);
  if (
    Object.prototype.hasOwnProperty.call(update, "enabled") ||
    Object.prototype.hasOwnProperty.call(update, "days") ||
    Object.prototype.hasOwnProperty.call(update, "scanIntervalHours") ||
    Object.prototype.hasOwnProperty.call(update, "removeLimit")
  ) {
    merged.updatedAt = new Date().toISOString();
    if (Object.prototype.hasOwnProperty.call(update, "enabled") || Object.prototype.hasOwnProperty.call(update, "days")) {
      merged.lastError = null;
    }
  }
  return merged;
};

const normalizeAntispamConfigEntry = (
  raw: unknown,
  fallback?: BotGroupAntispamConfig,
): BotGroupAntispamConfig => {
  const base = fallback ? { ...fallback } : { ...DEFAULT_ANTISPAM_CONFIG };

  if (raw === null || raw === undefined) {
    return base;
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return base;
  }

  const record = source as Record<string, unknown>;
  const toInt = (value: unknown, fallbackValue: number, min: number, max: number): number => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) {
      return fallbackValue;
    }
    return Math.max(min, Math.min(max, parsed));
  };

  const burstLimit = record.burstLimit ?? record.burst_limit ?? record.messageLimit ?? record.message_limit;
  if (burstLimit !== undefined) {
    base.burstLimit = toInt(burstLimit, DEFAULT_ANTISPAM_CONFIG.burstLimit, 2, 50);
  }

  const burstWindowSeconds =
    record.burstWindowSeconds ?? record.burst_window_seconds ?? record.windowSeconds ?? record.window_seconds;
  if (burstWindowSeconds !== undefined) {
    base.burstWindowSeconds = toInt(
      burstWindowSeconds,
      DEFAULT_ANTISPAM_CONFIG.burstWindowSeconds,
      2,
      60,
    );
  }

  const repeatLimit = record.repeatLimit ?? record.repeat_limit;
  if (repeatLimit !== undefined) {
    base.repeatLimit = toInt(repeatLimit, DEFAULT_ANTISPAM_CONFIG.repeatLimit, 2, 20);
  }

  const repeatWindowSeconds = record.repeatWindowSeconds ?? record.repeat_window_seconds;
  if (repeatWindowSeconds !== undefined) {
    base.repeatWindowSeconds = toInt(
      repeatWindowSeconds,
      DEFAULT_ANTISPAM_CONFIG.repeatWindowSeconds,
      5,
      300,
    );
  }

  const infractionResetDays =
    record.infractionResetDays ??
    record.infraction_reset_days ??
    record.resetDays ??
    record.reset_days;
  if (infractionResetDays !== undefined) {
    base.infractionResetDays = toInt(
      infractionResetDays,
      DEFAULT_ANTISPAM_CONFIG.infractionResetDays,
      1,
      365,
    );
  }

  return base;
};

const mergeAntispamConfig = (
  current: BotGroupAntispamConfig,
  update: Partial<BotGroupAntispamConfig> | undefined,
): BotGroupAntispamConfig => {
  if (!update || Object.keys(update).length === 0) {
    return { ...current };
  }
  return normalizeAntispamConfigEntry({ ...current, ...update }, current);
};

const fetchGroupOwnerContext = async (groupId: number): Promise<{ timezone: string | null; whatsapp: string | null }> => {
  await ensureBotGroupTable();
  await ensureUserTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT u.timezone, u.whatsapp_number
      FROM bot_groups bg
      INNER JOIN users u ON u.id = bg.user_id
      WHERE bg.id = ?
      LIMIT 1
    `,
    [groupId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return { timezone: null, whatsapp: null };
  }

  const row = rows[0];
  return {
    timezone: typeof row.timezone === "string" ? row.timezone : null,
    whatsapp: typeof row.whatsapp_number === "string" ? row.whatsapp_number : null,
  };
};

const applyDefaultTimezones = (
  settings: BotGroupSettings,
  ownerTimezone: string | null,
  ownerWhatsapp: string | null,
) => {
  const fallbackTimezone = resolveTimezonePreference({
    ownerTimezone,
    ownerWhatsapp,
  });

  const scheduleTimezone =
    normalizeTimezoneInput(settings.scheduleConfig?.timezone ?? null) ?? fallbackTimezone;
  const horapgTimezone =
    normalizeTimezoneInput(settings.horapgConfig?.timezone ?? null) ?? scheduleTimezone ?? fallbackTimezone;

  settings.scheduleConfig = {
    ...settings.scheduleConfig,
    timezone: scheduleTimezone,
  };

  settings.horapgConfig = {
    ...settings.horapgConfig,
    timezone: horapgTimezone,
  };
};

const mapSettingsRow = (row: RowDataPacket): BotGroupSettings => {
  const groupId = Number(row.group_id);
  const language =
    typeof row.language === "string" && row.language.trim()
      ? row.language.trim().toLowerCase()
      : DEFAULT_SETTINGS.language;
  const groqKeys = parseGroqKeys(row.groq_keys);
  const aiProvider =
    row.ai_provider === "openai" || row.ai_provider === "chatgpt_system"
      ? row.ai_provider
      : "groq";
  const openAiApiKey =
    typeof row.openai_api_key === "string" && row.openai_api_key.trim()
      ? row.openai_api_key.trim()
      : null;
  const aiPromptRaw = typeof row.ai_prompt === "string" ? row.ai_prompt.trim() : "";
  const aiPrompt = aiPromptRaw || getDefaultAiPrompt(language);
  const aiToolsPromptRaw = typeof row.ai_tools_prompt === "string" ? row.ai_tools_prompt.trim() : "";
  const aiToolsPrompt = aiToolsPromptRaw || getDefaultAiToolsPrompt();
  const aiVoiceRaw = typeof row.ai_voice === "string" ? row.ai_voice.trim() : "";
  const aiVoice = aiVoiceRaw || DEFAULT_AI_VOICE;
  const aiModelRaw =
    typeof row.ai_model === "string"
      ? row.ai_model.trim()
      : typeof (row as Record<string, unknown>).aiModel === "string"
        ? ((row as Record<string, unknown>).aiModel as string).trim()
        : "";
  const aiModel =
    aiModelRaw === "qwen2.5:7b" && aiProvider === "groq"
      ? DEFAULT_AI_MODEL
      : aiModelRaw || DEFAULT_AI_MODEL;
  const aiMemory = parseAiMemory(row.ai_memory);
  const aiLastInteractionAt =
    row.ai_last_interaction_at !== undefined && row.ai_last_interaction_at !== null
      ? toIsoString(row.ai_last_interaction_at)
      : null;

  return {
    groupId,
    antilink: row.antilink === 1,
    antilinkGroupInvite: row.antilink_group_invite === 1,
    banExtremo: row.ban_extremo === 1,
    autoRead: row.auto_read !== 0,
    allowedLinks: parseStringList(row.allowed_links),
    featureFlags: { ...DEFAULT_SETTINGS.featureFlags, ...parseFeatureFlags(row.feature_flags) },
    moderationActions: parseModerationActions(row.feature_flags),
    allowedDdis: (() => {
      const parsed = parseStringList(row.allowed_ddis);
      return parsed.length > 0 ? parsed : [...DEFAULT_SETTINGS.allowedDdis];
    })(),
    antifakeMessage:
      typeof row.antifake_message === "string" && row.antifake_message.trim()
        ? row.antifake_message.trim()
        : DEFAULT_SETTINGS.antifakeMessage,
    bannedWords: parseStringList(row.banned_words),
    antipalavrasMaxInfractions: Number.isFinite(row.antipalavras_max_infractions)
      ? Math.max(1, Number(row.antipalavras_max_infractions))
      : DEFAULT_SETTINGS.antipalavrasMaxInfractions,
    maxInfractions: Number.isFinite(row.max_infractions)
      ? Number(row.max_infractions)
      : DEFAULT_SETTINGS.maxInfractions,
    language,
    commandPrefixes: parseCommandPrefixes(row.command_prefixes),
    allowCommandsWithoutPrefix:
      normalizeOptionalBoolean(row.allow_commands_without_prefix) ??
      DEFAULT_SETTINGS.allowCommandsWithoutPrefix,
    commandToggles: parseCommandToggles(row.command_flags),
    commandAliases: parseCommandAliases(row.command_aliases),
    menuTexts: parseMenuTexts(row.menu_texts),
    menuCarousel: normalizeMenuCarousel(row.menu_carousel),
    welcomeConfig: parseWelcomeConfig(row.welcome_config),
    farewellConfig: parseFarewellConfig(parseJsonObject(row.welcome_config)?.farewellConfig),
    autoResponses: parseAutoResponses(row.auto_responses),
    ads: parseAdsConfig((row as Record<string, unknown>).ads_config ?? (row as Record<string, unknown>).ads ?? null),
    horapgConfig: normalizeHorapgConfigEntry((row as Record<string, unknown>).horapg_config ?? null),
    scheduleConfig: normalizeScheduleConfigEntry((row as Record<string, unknown>).schedule_config ?? null),
    antiInactivityConfig: normalizeAntiInactivityConfigEntry(
      (row as Record<string, unknown>).anti_inactivity_config ?? null,
    ),
    antispamConfig: normalizeAntispamConfigEntry(
      (row as Record<string, unknown>).antispam_config ?? null,
    ),
    premium: normalizePremiumConfigEntry(
      (row as Record<string, unknown>).premium_config ??
        extractLegacyPremiumConfig((row as Record<string, unknown>).bot_coins_config ?? null),
    ),
    botCoins: normalizeBotCoinsConfigEntry((row as Record<string, unknown>).bot_coins_config ?? null),
    lastMarkMessage: parseLastMarkMessage((row as Record<string, unknown>).last_mark_message ?? null),
    lastBroadcastTemplate: parseLastBroadcastTemplate(
      (row as Record<string, unknown>).last_broadcast_template ?? null,
    ),
    rulesMessage: parseStaticMessageEntry((row as Record<string, unknown>).rules_message ?? null),
    tableMessage: parseStaticMessageEntry((row as Record<string, unknown>).table_message ?? null),
    mutedMembers: sanitizeDigitsList(parseStringList(row.muted_members)),
    muteBanLimit: Number.isFinite(Number(row.mute_ban_limit))
      ? Math.max(1, Math.min(50, Number(row.mute_ban_limit)))
      : DEFAULT_SETTINGS.muteBanLimit,
    blacklist: sanitizeDigitsList(parseStringList((row as Record<string, unknown>).blacklist_members)),
    aiProvider,
    groqKeys,
    openAiApiKey,
    aiPrompt,
    aiToolsPrompt,
    aiVoice,
    aiModel,
    aiMemory,
    aiLastInteractionAt,
    unknownCommandTemplate:
      typeof row.unknown_command_template === "string"
        ? (() => {
            const normalized = row.unknown_command_template.replace(/\r\n/g, "\n").trim();
            return normalized || null;
          })()
        : null,
    planRenewalAdminsOnly: row.plan_renewal_admins_only === 1,
    planRenewalSilent: row.plan_renewal_silent === 1,
    createdAt: toIsoString(row.created_at ?? null),
    updatedAt: toIsoString(row.updated_at ?? null),
  };
};

const mapInfractionRow = (row: RowDataPacket): BotGroupInfraction => ({
  id: Number(row.id),
  groupId: Number(row.group_id),
  memberJid: String(row.member_jid ?? ""),
  reason: String(row.reason ?? "link"),
  count: Number(row.count ?? 0),
  createdAt: toIsoString(row.created_at ?? null),
  lastOccurredAt: toIsoString(row.last_occurred_at ?? row.updated_at ?? null),
});

const mapMuteRow = (row: RowDataPacket): BotGroupMuteEntry => ({
  groupId: Number(row.group_id),
  memberJid: String(row.member_jid ?? ""),
  banAfterMessages: Math.max(1, Number(row.ban_after_messages ?? 3) || 3),
  deletedCount: Math.max(0, Number(row.deleted_count ?? 0) || 0),
  lastWarnedCount: Math.max(0, Number(row.last_warned_count ?? 0) || 0),
  mutedBy: typeof row.muted_by === "string" && row.muted_by.trim() ? row.muted_by.trim() : null,
  createdAt: toIsoString(row.created_at ?? null),
  updatedAt: toIsoString(row.updated_at ?? null),
});

const normalizeMuteLimit = (value: unknown, fallback = DEFAULT_SETTINGS.muteBanLimit): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(50, parsed));
};

export const getGroupSettings = async (groupId: number): Promise<BotGroupSettings> => {
  const id = Number(groupId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Grupo inválido.");
  }

  await ensureBotGroupSettingsTable();
  const db = getDb();

  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM bot_group_settings WHERE group_id = ? LIMIT 1",
    [id],
  );

  const ownerContext = await fetchGroupOwnerContext(id);

  if (Array.isArray(rows) && rows.length > 0) {
    const mapped = mapSettingsRow(rows[0]);
    applyDefaultTimezones(mapped, ownerContext.timezone, ownerContext.whatsapp);
    return mapped;
  }

  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_group_settings (
        group_id,
        antilink,
        antilink_group_invite,
        ban_extremo,
        auto_read,
        allowed_links,
        feature_flags,
        allowed_ddis,
        antifake_message,
        banned_words,
        antipalavras_max_infractions,
        max_infractions,
        language,
	        command_flags,
	        command_prefixes,
	        allow_commands_without_prefix,
	        command_aliases,
        menu_texts,
        welcome_config,
        auto_responses,
        ads_config,
        schedule_config,
        horapg_config,
        anti_inactivity_config,
        antispam_config,
        premium_config,
        bot_coins_config,
        last_mark_message,
        last_broadcast_template,
        rules_message,
        table_message,
        muted_members,
        mute_ban_limit,
        blacklist_members,
        groq_keys,
        ai_prompt,
        ai_tools_prompt,
        ai_model,
        ai_voice,
        ai_memory,
        ai_last_interaction_at,
        plan_renewal_admins_only,
        plan_renewal_silent,
        unknown_command_template
      )
        VALUES (
	          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `,
      [
        id,
        DEFAULT_SETTINGS.antilink ? 1 : 0,
        DEFAULT_SETTINGS.antilinkGroupInvite ? 1 : 0,
        DEFAULT_SETTINGS.banExtremo ? 1 : 0,
        DEFAULT_SETTINGS.autoRead ? 1 : 0,
        JSON.stringify(DEFAULT_SETTINGS.allowedLinks),
        serializeFeatureFlags(DEFAULT_SETTINGS.featureFlags, DEFAULT_SETTINGS.moderationActions),
        DEFAULT_SETTINGS.allowedDdis.join("\n"),
        DEFAULT_SETTINGS.antifakeMessage,
        DEFAULT_SETTINGS.bannedWords.join("\n"),
        DEFAULT_SETTINGS.antipalavrasMaxInfractions,
        DEFAULT_SETTINGS.maxInfractions,
        DEFAULT_SETTINGS.language,
	        JSON.stringify(DEFAULT_SETTINGS.commandToggles),
	        DEFAULT_SETTINGS.commandPrefixes.join("\n"),
	        DEFAULT_SETTINGS.allowCommandsWithoutPrefix ? 1 : 0,
	        JSON.stringify(DEFAULT_SETTINGS.commandAliases),
        JSON.stringify(DEFAULT_SETTINGS.menuTexts),
        serializeWelcomeConfigWithFarewell(DEFAULT_SETTINGS.welcomeConfig, DEFAULT_SETTINGS.farewellConfig),
        JSON.stringify(DEFAULT_SETTINGS.autoResponses),
        JSON.stringify(DEFAULT_SETTINGS.ads),
        JSON.stringify(DEFAULT_SETTINGS.scheduleConfig),
        JSON.stringify(DEFAULT_SETTINGS.horapgConfig),
        JSON.stringify(DEFAULT_SETTINGS.antiInactivityConfig),
        JSON.stringify(DEFAULT_SETTINGS.antispamConfig),
        JSON.stringify(DEFAULT_SETTINGS.premium),
        null,
        (DEFAULT_SETTINGS.lastMarkMessage ? JSON.stringify(DEFAULT_SETTINGS.lastMarkMessage) : null),
        (DEFAULT_SETTINGS.lastBroadcastTemplate
          ? JSON.stringify(DEFAULT_SETTINGS.lastBroadcastTemplate)
          : null),
        (DEFAULT_SETTINGS.rulesMessage ? JSON.stringify(DEFAULT_SETTINGS.rulesMessage) : null),
        (DEFAULT_SETTINGS.tableMessage ? JSON.stringify(DEFAULT_SETTINGS.tableMessage) : null),
        JSON.stringify(DEFAULT_SETTINGS.mutedMembers),
        DEFAULT_SETTINGS.muteBanLimit,
        JSON.stringify(DEFAULT_SETTINGS.blacklist),
        DEFAULT_SETTINGS.groqKeys.join("\n"),
        DEFAULT_SETTINGS.aiPrompt,
        DEFAULT_SETTINGS.aiToolsPrompt,
        DEFAULT_SETTINGS.aiModel,
        DEFAULT_SETTINGS.aiVoice,
        JSON.stringify(DEFAULT_SETTINGS.aiMemory),
        DEFAULT_SETTINGS.aiLastInteractionAt,
        DEFAULT_SETTINGS.planRenewalAdminsOnly ? 1 : 0,
        DEFAULT_SETTINGS.planRenewalSilent ? 1 : 0,
        DEFAULT_SETTINGS.unknownCommandTemplate,
      ],
    );

  if (result.insertId > 0) {
    const [freshRows] = await db.query<RowDataPacket[]>(
      "SELECT * FROM bot_group_settings WHERE group_id = ? LIMIT 1",
      [id],
    );
    if (Array.isArray(freshRows) && freshRows.length > 0) {
      const mapped = mapSettingsRow(freshRows[0]);
      applyDefaultTimezones(mapped, ownerContext.timezone, ownerContext.whatsapp);
      return mapped;
    }
  }

  const defaultsClone = cloneDefaultSettings();
  const defaults: BotGroupSettings = {
    groupId: id,
    ...defaultsClone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  applyDefaultTimezones(defaults, ownerContext.timezone, ownerContext.whatsapp);
  return defaults;
};

export const upsertGroupSettings = async (
  groupId: number,
  updates: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">>,
): Promise<BotGroupSettings> => {
  const current = await getGroupSettings(groupId);
  const nextLanguage =
    updates.language !== undefined && typeof updates.language === "string"
      ? updates.language.trim().toLowerCase() || current.language
      : current.language;
  const merged = {
    ...current,
    ...updates,
    featureFlags: {
      ...current.featureFlags,
      ...(updates.featureFlags ?? {}),
    },
    moderationActions: mergeModerationActions(current.moderationActions, updates.moderationActions),
    allowedLinks:
      updates.allowedLinks !== undefined ? updates.allowedLinks : current.allowedLinks,
    allowedDdis:
      updates.allowedDdis !== undefined ? updates.allowedDdis : current.allowedDdis,
    antifakeMessage:
      updates.antifakeMessage !== undefined
        ? (() => {
            const value =
              updates.antifakeMessage === null || updates.antifakeMessage === undefined
                ? ""
                : String(updates.antifakeMessage);
            const trimmed = value.trim();
            return trimmed || DEFAULT_SETTINGS.antifakeMessage;
          })()
        : current.antifakeMessage || DEFAULT_SETTINGS.antifakeMessage,
    antipalavrasMaxInfractions: (() => {
      if (updates.antipalavrasMaxInfractions === undefined) {
        return current.antipalavrasMaxInfractions ?? DEFAULT_SETTINGS.antipalavrasMaxInfractions;
      }
      const parsed = Number.parseInt(
        String(updates.antipalavrasMaxInfractions ?? ""),
        10,
      );
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_SETTINGS.antipalavrasMaxInfractions;
      }
      return Math.min(parsed, 20);
    })(),
    bannedWords:
      updates.bannedWords !== undefined ? updates.bannedWords : current.bannedWords,
	    commandPrefixes:
	      updates.commandPrefixes !== undefined
	        ? updates.commandPrefixes
	            .map((entry) => (entry ? entry.toString().trim() : ""))
	            .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
	        : current.commandPrefixes,
	    allowCommandsWithoutPrefix:
	      updates.allowCommandsWithoutPrefix !== undefined
	        ? Boolean(updates.allowCommandsWithoutPrefix)
	        : current.allowCommandsWithoutPrefix,
	    commandToggles: {
      ...current.commandToggles,
      ...(updates.commandToggles ?? {}),
    },
    commandAliases: (() => {
      if (updates.commandAliases === undefined) return current.commandAliases || { ...DEFAULT_COMMAND_ALIASES };
      const source = updates.commandAliases || {};
      const result: Record<string, string[]> = { ...(current.commandAliases || {}) };
      for (const [key, value] of Object.entries(source)) {
        const canon = normalizeAliasToken(key);
        if (!canon || DISABLED_LEGACY_ALIAS_KEYS.has(canon)) {
          continue;
        }
        const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,;]+/) : [];
        const normalized = Array.from(new Set(list.map((v) => normalizeAliasToken(v)).filter(Boolean)));
        if (normalized.length > 0) {
          result[canon] = normalized;
        }
      }
      // garante defaults mínimos
      for (const [k, v] of Object.entries(DEFAULT_COMMAND_ALIASES)) {
        if (!result[k]) result[k] = v.slice();
      }
      return result;
    })(),
    menuTexts: normalizeMenuTextsUpdate(current.menuTexts, updates.menuTexts),
    menuCarousel:
      updates.menuCarousel !== undefined
        ? normalizeMenuCarousel(updates.menuCarousel, current.menuCarousel)
        : current.menuCarousel,
    welcomeConfig:
      updates.welcomeConfig !== undefined
        ? normalizeWelcomeConfigEntry({ ...current.welcomeConfig, ...updates.welcomeConfig })
        : current.welcomeConfig,
    farewellConfig:
      updates.farewellConfig !== undefined
        ? normalizeWelcomeConfigEntry({ ...current.farewellConfig, ...updates.farewellConfig })
        : current.farewellConfig,
    autoResponses:
      updates.autoResponses !== undefined
        ? updates.autoResponses.map((entry) => normalizeAutoResponseEntry(entry))
        : current.autoResponses,
    ads:
      updates.ads !== undefined
        ? normalizeAdsUpdate(current.ads, updates.ads)
        : current.ads,
    horapgConfig:
      updates.horapgConfig !== undefined
        ? mergeHorapgConfig(current.horapgConfig, updates.horapgConfig)
        : current.horapgConfig,
    scheduleConfig:
      updates.scheduleConfig !== undefined
        ? mergeScheduleConfig(current.scheduleConfig, updates.scheduleConfig)
        : current.scheduleConfig,
    antiInactivityConfig:
      updates.antiInactivityConfig !== undefined
        ? mergeAntiInactivityConfig(current.antiInactivityConfig, updates.antiInactivityConfig)
        : current.antiInactivityConfig ?? { ...DEFAULT_ANTI_INACTIVITY_CONFIG },
    antispamConfig:
      updates.antispamConfig !== undefined
        ? mergeAntispamConfig(current.antispamConfig, updates.antispamConfig)
        : current.antispamConfig ?? { ...DEFAULT_ANTISPAM_CONFIG },
    premium:
      updates.premium !== undefined
        ? normalizePremiumConfigEntry(updates.premium, current.premium)
        : current.premium ?? normalizePremiumConfigEntry(null),
    botCoins:
      updates.botCoins !== undefined
        ? normalizeBotCoinsConfigEntry(updates.botCoins, current.botCoins)
        : current.botCoins ?? cloneBotCoinsConfig(DEFAULT_BOT_COINS_CONFIG),
    lastMarkMessage: (() => {
      if (!Object.prototype.hasOwnProperty.call(updates, "lastMarkMessage")) {
        return current.lastMarkMessage ?? null;
      }
      const raw = updates.lastMarkMessage;
      if (!raw) {
        return null;
      }
      return normalizeMarkMessageEntry(raw as Partial<BotGroupMarkMessage> & Record<string, unknown>);
    })(),
    lastBroadcastTemplate: (() => {
      if (!Object.prototype.hasOwnProperty.call(updates, "lastBroadcastTemplate")) {
        return current.lastBroadcastTemplate ?? null;
      }
      const raw = updates.lastBroadcastTemplate;
      if (!raw) {
        return null;
      }
      return normalizeBroadcastTemplateEntry(
        raw as Partial<BotGroupBroadcastTemplate> & Record<string, unknown>,
      );
    })(),
    rulesMessage: (() => {
      if (!Object.prototype.hasOwnProperty.call(updates, "rulesMessage")) {
        return current.rulesMessage ?? null;
      }
      const raw = updates.rulesMessage;
      if (!raw) {
        return null;
      }
      return normalizeStaticMessageEntry(raw as Partial<BotGroupStaticMessage> & Record<string, unknown>);
    })(),
    tableMessage: (() => {
      if (!Object.prototype.hasOwnProperty.call(updates, "tableMessage")) {
        return current.tableMessage ?? null;
      }
      const raw = updates.tableMessage;
      if (!raw) {
        return null;
      }
      return normalizeStaticMessageEntry(raw as Partial<BotGroupStaticMessage> & Record<string, unknown>);
    })(),
    mutedMembers:
      updates.mutedMembers !== undefined
        ? updates.mutedMembers
            .map((v) => String(v || "").replace(/\D/g, "").trim())
            .filter((v, i, a) => v.length >= 5 && a.indexOf(v) === i)
        : current.mutedMembers,
    muteBanLimit:
      updates.muteBanLimit !== undefined
        ? Math.max(1, Math.min(50, Number.parseInt(String(updates.muteBanLimit), 10) || DEFAULT_SETTINGS.muteBanLimit))
        : current.muteBanLimit ?? DEFAULT_SETTINGS.muteBanLimit,
    blacklist:
      updates.blacklist !== undefined
        ? sanitizeDigitsList(
            (Array.isArray(updates.blacklist) ? updates.blacklist : [])
              .map((value) => (typeof value === "string" ? value : String(value ?? ""))),
          )
        : current.blacklist,
    language: nextLanguage,
    groqKeys:
      updates.groqKeys !== undefined
        ? normalizeGroqKeys(updates.groqKeys)
        : current.groqKeys,
    aiProvider:
      updates.aiProvider === "openai" || updates.aiProvider === "chatgpt_system"
        ? updates.aiProvider
        : updates.aiProvider === "groq"
          ? "groq"
          : current.aiProvider,
    openAiApiKey:
      updates.openAiApiKey === null
        ? null
        : typeof updates.openAiApiKey === "string"
          ? updates.openAiApiKey.trim() || current.openAiApiKey
          : current.openAiApiKey,
    aiPrompt:
      updates.aiPrompt !== undefined && typeof updates.aiPrompt === "string"
        ? updates.aiPrompt.trim() || getDefaultAiPrompt(nextLanguage)
        : current.aiPrompt || getDefaultAiPrompt(nextLanguage),
    aiToolsPrompt:
      updates.aiToolsPrompt !== undefined && typeof updates.aiToolsPrompt === "string"
        ? updates.aiToolsPrompt.trim() || getDefaultAiToolsPrompt()
        : current.aiToolsPrompt || getDefaultAiToolsPrompt(),
    aiVoice:
      updates.aiVoice === null
        ? null
        : updates.aiVoice !== undefined && typeof updates.aiVoice === "string"
          ? updates.aiVoice.trim() || current.aiVoice
          : current.aiVoice,
    aiModel:
      updates.aiModel === undefined
        ? current.aiModel
        : (() => {
            if (updates.aiModel === null) return DEFAULT_AI_MODEL;
            if (typeof updates.aiModel === "string") {
              const trimmed = updates.aiModel.trim();
              return trimmed.length > 0 ? trimmed : DEFAULT_AI_MODEL;
            }
            return current.aiModel;
          })(),
    aiMemory:
      updates.aiMemory !== undefined
        ? normalizeAiMemoryUpdate(current.aiMemory, updates.aiMemory)
        : current.aiMemory,
    aiLastInteractionAt:
      updates.aiLastInteractionAt !== undefined
        ? updates.aiLastInteractionAt
          ? toIsoString(updates.aiLastInteractionAt)
          : null
        : current.aiLastInteractionAt,
    unknownCommandTemplate:
      updates.unknownCommandTemplate !== undefined
        ? (() => {
            const raw = updates.unknownCommandTemplate;
            if (raw === null) return null;
            const normalized = String(raw ?? "").replace(/\r\n/g, "\n").trim();
            return normalized || null;
          })()
        : current.unknownCommandTemplate ?? null,
  };

  const previousMediaPaths = new Set<string>();
  const nextMediaPaths = new Set<string>();

  const registerPath = (set: Set<string>, path: string | null | undefined) => {
    if (typeof path === "string") {
      const trimmed = path.trim();
      if (trimmed) {
        set.add(trimmed);
      }
    }
  };

  for (const entry of current.autoResponses) {
    registerPath(previousMediaPaths, entry.responseMedia?.path || null);
  }
  for (const ad of current.ads ?? []) {
    registerPath(previousMediaPaths, ad.media?.path || null);
  }
  registerPath(previousMediaPaths, current.horapgConfig?.imagePath || null);
  if (current.lastMarkMessage?.media?.path) {
    registerPath(previousMediaPaths, current.lastMarkMessage.media.path);
  }
  if (current.lastBroadcastTemplate?.mediaPath) {
    registerPath(previousMediaPaths, current.lastBroadcastTemplate.mediaPath);
  }
  if (current.rulesMessage?.media?.path) {
    registerPath(previousMediaPaths, current.rulesMessage.media.path);
  }
  if (current.tableMessage?.media?.path) {
    registerPath(previousMediaPaths, current.tableMessage.media.path);
  }
  for (const entry of merged.autoResponses) {
    registerPath(nextMediaPaths, entry.responseMedia?.path || null);
  }
  for (const ad of merged.ads ?? []) {
    registerPath(nextMediaPaths, ad.media?.path || null);
  }
  registerPath(nextMediaPaths, merged.horapgConfig?.imagePath || null);
  if (merged.lastMarkMessage?.media?.path) {
    registerPath(nextMediaPaths, merged.lastMarkMessage.media.path);
  }
  if (merged.lastBroadcastTemplate?.mediaPath) {
    registerPath(nextMediaPaths, merged.lastBroadcastTemplate.mediaPath);
  }
  if (merged.rulesMessage?.media?.path) {
    registerPath(nextMediaPaths, merged.rulesMessage.media.path);
  }
  if (merged.tableMessage?.media?.path) {
    registerPath(nextMediaPaths, merged.tableMessage.media.path);
  }

  const removedMediaPaths = Array.from(previousMediaPaths).filter((path) => !nextMediaPaths.has(path));

  await ensureBotGroupSettingsTable();
  const db = getDb();

  const columnEntries: Array<[string, unknown]> = [
    ["group_id", groupId],
    ["antilink", merged.antilink ? 1 : 0],
    ["antilink_group_invite", merged.antilinkGroupInvite ? 1 : 0],
    ["ban_extremo", merged.banExtremo ? 1 : 0],
    ["auto_read", merged.autoRead ? 1 : 0],
    ["allowed_links", JSON.stringify(merged.allowedLinks ?? [])],
    ["feature_flags", serializeFeatureFlags(merged.featureFlags ?? {}, merged.moderationActions ?? {})],
    ["allowed_ddis", merged.allowedDdis.join("\n")],
    ["antifake_message", merged.antifakeMessage],
    ["banned_words", merged.bannedWords.join("\n")],
    ["antipalavras_max_infractions", merged.antipalavrasMaxInfractions],
    ["max_infractions", merged.maxInfractions],
    ["language", merged.language],
    ["command_flags", JSON.stringify(merged.commandToggles)],
    ["command_prefixes", merged.commandPrefixes.join("\n")],
    ["allow_commands_without_prefix", merged.allowCommandsWithoutPrefix ? 1 : 0],
    ["command_aliases", JSON.stringify(merged.commandAliases)],
    ["menu_texts", JSON.stringify(merged.menuTexts)],
    ["menu_carousel", JSON.stringify(merged.menuCarousel)],
    ["welcome_config", serializeWelcomeConfigWithFarewell(merged.welcomeConfig, merged.farewellConfig)],
    ["auto_responses", JSON.stringify(merged.autoResponses)],
    ["ads_config", JSON.stringify(merged.ads)],
    ["schedule_config", JSON.stringify(merged.scheduleConfig)],
    ["horapg_config", JSON.stringify(merged.horapgConfig)],
    ["anti_inactivity_config", JSON.stringify(merged.antiInactivityConfig)],
    ["antispam_config", JSON.stringify(merged.antispamConfig)],
    ["premium_config", JSON.stringify(merged.premium)],
    ["bot_coins_config", null],
    ["last_mark_message", merged.lastMarkMessage ? JSON.stringify(merged.lastMarkMessage) : null],
    [
      "last_broadcast_template",
      merged.lastBroadcastTemplate ? JSON.stringify(merged.lastBroadcastTemplate) : null,
    ],
    ["rules_message", merged.rulesMessage ? JSON.stringify(merged.rulesMessage) : null],
    ["table_message", merged.tableMessage ? JSON.stringify(merged.tableMessage) : null],
    ["muted_members", JSON.stringify(merged.mutedMembers)],
    ["mute_ban_limit", merged.muteBanLimit],
    ["blacklist_members", JSON.stringify(merged.blacklist)],
    ["ai_provider", merged.aiProvider],
    ["groq_keys", merged.groqKeys.join("\n")],
    ["openai_api_key", merged.openAiApiKey],
    ["ai_prompt", merged.aiPrompt],
    ["ai_tools_prompt", merged.aiToolsPrompt],
    ["ai_model", merged.aiModel],
    ["ai_voice", merged.aiVoice],
    ["ai_memory", JSON.stringify(merged.aiMemory ?? [])],
    ["ai_last_interaction_at", toMysqlDateTime(merged.aiLastInteractionAt)],
    ["plan_renewal_admins_only", merged.planRenewalAdminsOnly ? 1 : 0],
    ["plan_renewal_silent", merged.planRenewalSilent ? 1 : 0],
    ["unknown_command_template", merged.unknownCommandTemplate],
  ];

  const columnSql = columnEntries.map(([column]) => column).join(",\n        ");
  const placeholderSql = columnEntries.map(() => "?").join(", ");
  const updateSql = columnEntries
    .filter(([column]) => column !== "group_id")
    .map(([column]) => `${column} = VALUES(${column})`)
    .join(",\n        ");
  const values = columnEntries.map(([, value]) => value);

  await db.query(
    `
      INSERT INTO bot_group_settings (
        ${columnSql}
      )
        VALUES (
          ${placeholderSql}
        )
      ON DUPLICATE KEY UPDATE
        ${updateSql}
    `,
    values,
  );

  for (const mediaPath of removedMediaPaths) {
    try {
      await deleteUploadedFile(mediaPath);
    } catch (error) {
      console.warn("Failed to delete auto response media", { mediaPath, error });
    }
  }

  return getGroupSettings(groupId);
};

export const registerGroupInfraction = async (options: {
  groupId: number;
  memberJid: string;
  reason?: string;
  resetAfterDays?: number | null;
}): Promise<BotGroupInfraction> => {
  const groupId = Number(options.groupId);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error("Grupo inválido para infração.");
  }
  const memberJid = options.memberJid.trim();
  if (!memberJid) {
    throw new Error("Participante inválido para infração.");
  }
  const reason = (options.reason ?? "link").trim() || "link";

  await ensureBotGroupInfractionsTable();
  const db = getDb();
  const resetAfterDays = Number.parseInt(String(options.resetAfterDays ?? ""), 10);
  if (Number.isFinite(resetAfterDays) && resetAfterDays > 0) {
    const cutoff = new Date(Date.now() - Math.min(resetAfterDays, 365) * 24 * 60 * 60 * 1000);
    await db.query(
      `
        DELETE FROM bot_group_infractions
        WHERE group_id = ?
          AND member_jid = ?
          AND last_occurred_at < ?
      `,
      [groupId, memberJid, cutoff],
    );
  }

  await db.query(
    `
      INSERT INTO bot_group_infractions (group_id, member_jid, reason, count)
      VALUES (?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        count = count + 1,
        last_occurred_at = CURRENT_TIMESTAMP
    `,
    [groupId, memberJid, reason],
  );

  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT *
      FROM bot_group_infractions
      WHERE group_id = ? AND member_jid = ? AND reason = ?
      LIMIT 1
    `,
    [groupId, memberJid, reason],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Não foi possível registrar a infração.");
  }

  return mapInfractionRow(rows[0]);
};

export const resetGroupInfractions = async (groupId: number, memberJid?: string) => {
  const id = Number(groupId);
  if (!Number.isFinite(id) || id <= 0) {
    return;
  }

  await ensureBotGroupInfractionsTable();
  const db = getDb();
  if (memberJid && memberJid.trim()) {
    await db.query("DELETE FROM bot_group_infractions WHERE group_id = ? AND member_jid = ?", [
      id,
      memberJid.trim(),
    ]);
    return;
  }

  await db.query("DELETE FROM bot_group_infractions WHERE group_id = ?", [id]);
};

export const upsertGroupMute = async (options: {
  groupId: number;
  memberJid: string;
  banAfterMessages?: number;
  mutedBy?: string | null;
}): Promise<BotGroupMuteEntry> => {
  const groupId = Number(options.groupId);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error("Grupo inválido para mute.");
  }
  const memberJid = String(options.memberJid ?? "").replace(/\D/g, "").trim();
  if (!memberJid) {
    throw new Error("Participante inválido para mute.");
  }
  const limit = normalizeMuteLimit(options.banAfterMessages);
  const mutedBy = options.mutedBy ? String(options.mutedBy).replace(/\D/g, "").trim() || null : null;

  await ensureBotGroupMutesTable();
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_group_mutes (
        group_id,
        member_jid,
        ban_after_messages,
        deleted_count,
        last_warned_count,
        muted_by
      ) VALUES (?, ?, ?, 0, 0, ?)
      ON DUPLICATE KEY UPDATE
        ban_after_messages = VALUES(ban_after_messages),
        deleted_count = 0,
        last_warned_count = 0,
        muted_by = VALUES(muted_by),
        updated_at = CURRENT_TIMESTAMP
    `,
    [groupId, memberJid, limit, mutedBy],
  );

  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM bot_group_mutes WHERE group_id = ? AND member_jid = ? LIMIT 1",
    [groupId, memberJid],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Não foi possível carregar o mute.");
  }

  return mapMuteRow(rows[0]);
};

export const registerMutedMessageDeletion = async (options: {
  groupId: number;
  memberJid: string;
  defaultBanAfterMessages?: number;
}): Promise<BotGroupMuteEntry> => {
  const groupId = Number(options.groupId);
  const memberJid = String(options.memberJid ?? "").replace(/\D/g, "").trim();
  if (!Number.isFinite(groupId) || groupId <= 0 || !memberJid) {
    throw new Error("Mute inválido.");
  }
  const limit = normalizeMuteLimit(options.defaultBanAfterMessages);

  await ensureBotGroupMutesTable();
  const db = getDb();
  await db.query(
    `
      INSERT INTO bot_group_mutes (
        group_id,
        member_jid,
        ban_after_messages,
        deleted_count,
        last_warned_count
      ) VALUES (?, ?, ?, 1, 0)
      ON DUPLICATE KEY UPDATE
        deleted_count = deleted_count + 1,
        updated_at = CURRENT_TIMESTAMP
    `,
    [groupId, memberJid, limit],
  );

  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM bot_group_mutes WHERE group_id = ? AND member_jid = ? LIMIT 1",
    [groupId, memberJid],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Não foi possível registrar infração de mute.");
  }

  return mapMuteRow(rows[0]);
};

export const markMutedMessageWarning = async (options: {
  groupId: number;
  memberJid: string;
  warnedCount: number;
}) => {
  const groupId = Number(options.groupId);
  const memberJid = String(options.memberJid ?? "").replace(/\D/g, "").trim();
  if (!Number.isFinite(groupId) || groupId <= 0 || !memberJid) {
    return;
  }

  await ensureBotGroupMutesTable();
  const db = getDb();
  await db.query(
    `
      UPDATE bot_group_mutes
      SET last_warned_count = ?, updated_at = CURRENT_TIMESTAMP
      WHERE group_id = ? AND member_jid = ?
    `,
    [Math.max(0, Number(options.warnedCount) || 0), groupId, memberJid],
  );
};

export const clearGroupMutes = async (groupId: number, memberJids?: string[]) => {
  const id = Number(groupId);
  if (!Number.isFinite(id) || id <= 0) {
    return;
  }

  await ensureBotGroupMutesTable();
  const db = getDb();
  const digits = Array.isArray(memberJids)
    ? memberJids.map((value) => String(value ?? "").replace(/\D/g, "").trim()).filter(Boolean)
    : [];
  if (digits.length === 0) {
    await db.query("DELETE FROM bot_group_mutes WHERE group_id = ?", [id]);
    return;
  }

  await db.query(
    `DELETE FROM bot_group_mutes WHERE group_id = ? AND member_jid IN (${digits.map(() => "?").join(", ")})`,
    [id, ...digits],
  );
};
