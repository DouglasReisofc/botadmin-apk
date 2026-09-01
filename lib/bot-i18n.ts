import enusMessages from "data/bot-i18n/messages/enus.json" assert { type: "json" };
import esMessages from "data/bot-i18n/messages/es.json" assert { type: "json" };
import ptbrMessages from "data/bot-i18n/messages/ptbr.json" assert { type: "json" };
import enusTranslations from "data/bot-i18n/enus.json" assert { type: "json" };
import esTranslations from "data/bot-i18n/es.json" assert { type: "json" };
import ptbrTranslations from "data/bot-i18n/ptbr.json" assert { type: "json" };

type SupportedLanguage = "ptbr" | "enus" | "es";

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["ptbr", "enus", "es"];

type TranslationValue = string | number | boolean | null | TranslationValue[] | TranslationTree;
type TranslationTree = Record<string, TranslationValue>;

type TranslationDictionary = Record<SupportedLanguage, TranslationTree>;

const DEFAULT_LANGUAGE: SupportedLanguage = "ptbr";

const BASE_TRANSLATIONS: TranslationDictionary = {
  ptbr: ptbrTranslations as TranslationTree,
  enus: enusTranslations as TranslationTree,
  es: esTranslations as TranslationTree,
};

const CASE_TRANSLATIONS: TranslationDictionary = {
  ptbr: ptbrMessages as TranslationTree,
  enus: enusMessages as TranslationTree,
  es: esMessages as TranslationTree,
};

const FALLBACK_TRANSLATIONS: Record<SupportedLanguage, Record<string, string>> = {
  ptbr: {
    idiomas:
      "🌐 Escolha o idioma do bot:\n• {{prefix}}pt — Português\n• {{prefix}}en — English\n• {{prefix}}es — Español",
    apenas_admins: "❌ Apenas administradores podem usar este comando.",
    selecionar_idioma: "Não foi possível atualizar o idioma. Tente novamente mais tarde.",
    idioma_atualizado: "Idioma atualizado com sucesso.",
  },
  enus: {
    idiomas:
      "🌐 Choose the bot language:\n• {{prefix}}pt — Portuguese\n• {{prefix}}en — English\n• {{prefix}}es — Spanish",
    apenas_admins: "❌ Only administrators can use this command.",
    selecionar_idioma: "Unable to update the language. Please try again later.",
    idioma_atualizado: "Language updated successfully.",
  },
  es: {
    idiomas:
      "🌐 Elige el idioma del bot:\n• {{prefix}}pt — Portugués\n• {{prefix}}en — Inglés\n• {{prefix}}es — Español",
    apenas_admins: "❌ Solo los administradores pueden usar este comando.",
    selecionar_idioma: "No fue posible actualizar el idioma. Intenta nuevamente más tarde.",
    idioma_atualizado: "Idioma actualizado correctamente.",
  },
};

const toTranslationTree = (value: unknown): TranslationTree =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as TranslationTree)
    : {};

const getPath = (tree: TranslationTree | undefined, key: string): TranslationValue | undefined => {
  if (!tree || !key) {
    return undefined;
  }

  return key
    .split(".")
    .filter((segment) => segment.length > 0)
    .reduce<TranslationValue | undefined>((current, segment) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }
      const next = (current as TranslationTree)[segment];
      return next === undefined ? undefined : next;
    }, tree);
};

const applyPlaceholders = (value: string, context?: BotTranslationContext): string => {
  const prefix = context?.commandPrefix && context.commandPrefix.trim().length > 0 ? context.commandPrefix : "!";
  const baseUrl = context?.appBaseUrl ?? "";
  const replacements: Array<[RegExp, string]> = [
    [/\{\{\s*prefix\s*\}\}/gi, prefix],
    [/\{prefix\}/gi, prefix],
    [/\{\{\s*base_url\s*\}\}/gi, baseUrl],
    [/\{base_url\}/gi, baseUrl],
  ];

  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
};

const renderTranslationValue = (
  raw: TranslationValue | undefined,
  context?: BotTranslationContext,
): string | null => {
  if (raw === null || raw === undefined) {
    return null;
  }

  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return applyPlaceholders(String(raw), context);
  }

  if (Array.isArray(raw)) {
    const rendered = raw
      .map((item) => renderTranslationValue(item as TranslationValue, context))
      .filter((item): item is string => Boolean(item && item.trim().length > 0));
    return rendered.length > 0 ? rendered.join("\n") : null;
  }

  return null;
};

export type BotTranslationContext = {
  appBaseUrl: string;
  groupId?: number | null;
  commandPrefix: string;
};

const normalizeLanguageInternal = (raw: string | null | undefined): string => {
  if (!raw) {
    return "ptbr";
  }
  const normalized = raw.toString().trim().toLowerCase();
  if (!normalized) {
    return "ptbr";
  }

  if (normalized.startsWith("en")) {
    return "enus";
  }
  if (normalized.startsWith("es") || normalized.startsWith("spa") || normalized.startsWith("esp")) {
    return "es";
  }
  if (
    normalized.startsWith("pt") ||
    normalized.startsWith("br") ||
    normalized.startsWith("por") ||
    normalized.startsWith("port")
  ) {
    return "ptbr";
  }

  if (SUPPORTED_LANGUAGES.includes(normalized as SupportedLanguage)) {
    return normalized;
  }

  return "ptbr";
};

export const normalizeLanguage = (raw: string | null | undefined): SupportedLanguage =>
  normalizeLanguageInternal(raw) as SupportedLanguage;

export const buildTranslationContext = (
  settings: { groupId?: number; commandPrefixes?: string[] } | null | undefined,
  appBaseUrl: string,
): BotTranslationContext => ({
  appBaseUrl: (appBaseUrl || "").trim(),
  groupId: settings?.groupId ?? null,
  commandPrefix: (() => {
    if (!Array.isArray(settings?.commandPrefixes)) {
      return "!";
    }
    const first = settings.commandPrefixes.find((entry) => entry && entry.toString().trim().length > 0);
    return first ? first.toString().trim() : "!";
  })(),
});

export const translate = (
  language: string,
  key: string,
  context?: BotTranslationContext,
): string | null => {
  const normalized = normalizeLanguageInternal(language) as SupportedLanguage;
  const dictionaries: TranslationTree[] = [
    toTranslationTree(BASE_TRANSLATIONS[normalized]),
  ];

  if (normalized !== DEFAULT_LANGUAGE) {
    dictionaries.push(toTranslationTree(BASE_TRANSLATIONS[DEFAULT_LANGUAGE]));
  }

  for (const dictionary of dictionaries) {
    const value = renderTranslationValue(getPath(dictionary, key), context);
    if (value !== null) {
      return value;
    }
  }

  const fallback =
    FALLBACK_TRANSLATIONS[normalized]?.[key] ?? FALLBACK_TRANSLATIONS[DEFAULT_LANGUAGE]?.[key];
  return fallback ? applyPlaceholders(fallback, context) : null;
};

export const translateCase = (
  language: string,
  key: string,
  context?: BotTranslationContext,
): string | null => {
  const normalized = normalizeLanguageInternal(language) as SupportedLanguage;
  const dictionaries: TranslationTree[] = [
    toTranslationTree(CASE_TRANSLATIONS[normalized]),
  ];

  if (normalized !== DEFAULT_LANGUAGE) {
    dictionaries.push(toTranslationTree(CASE_TRANSLATIONS[DEFAULT_LANGUAGE]));
  }

  for (const dictionary of dictionaries) {
    const value = renderTranslationValue(getPath(dictionary, key), context);
    if (value !== null) {
      return value;
    }
  }

  return null;
};
