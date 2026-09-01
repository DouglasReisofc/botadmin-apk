const stripDeviceSuffix = (value: string): string =>
  value.replace(/:[^@]+/, "");

export const normalizeJid = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }

  const sanitized = stripDeviceSuffix(String(value));
  const withoutDomain = sanitized.replace(/@.+$/, "");
  return withoutDomain.replace(/\D/g, "");
};

export const stripJidDevice = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }

  return stripDeviceSuffix(String(value));
};

export const isGroupJid = (jid: string | null | undefined): boolean => {
  if (!jid) {
    return false;
  }
  return String(jid).toLowerCase().endsWith("@g.us");
};

export const isBroadcastJid = (jid: string | null | undefined): boolean => {
  if (!jid) {
    return false;
  }
  const lowered = String(jid).toLowerCase();
  return lowered.includes("@broadcast");
};

const LINK_REGEX =
  /((?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>]*)?)/gi;

const COMMON_BARE_LINK_TLDS = new Set([
  "app",
  "ai",
  "biz",
  "br",
  "cc",
  "co",
  "com",
  "dev",
  "edu",
  "fm",
  "gov",
  "info",
  "io",
  "link",
  "me",
  "net",
  "org",
  "shop",
  "site",
  "store",
  "tv",
  "us",
  "xyz",
]);

const normalizeLinkCandidate = (value: string): string | null => {
  const trimmed = value.trim().replace(/[.,;!?]+$/, "");
  if (trimmed.length <= 3) {
    return null;
  }

  if (/^(?:https?:\/\/|www\.)/i.test(trimmed)) {
    return trimmed;
  }

  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return null;
  }

  const rawTld = trimmed.slice(dotIndex + 1).replace(/\/.*$/, "");
  const tld = rawTld.toLowerCase();
  if (rawTld !== tld || !COMMON_BARE_LINK_TLDS.has(tld)) {
    return null;
  }

  return trimmed;
};

export const extractLinks = (text: string | null | undefined): string[] => {
  if (!text || typeof text !== "string") {
    return [];
  }

  const matches = text.match(LINK_REGEX);
  if (!matches) {
    return [];
  }

  return Array.from(
    new Set(
      matches
        .map(normalizeLinkCandidate)
        .filter((entry): entry is string => Boolean(entry)),
    ),
  );
};

const GROUP_INVITE_PATTERNS = [
  /chat\.whatsapp\.com/i,
  /wa\.me\/(?:joinchat|message)/i,
  /whatsapp\.com\/channel/i,
  /whatsapp\.com\/invite/i,
];

export const isGroupInviteLink = (link: string): boolean =>
  GROUP_INVITE_PATTERNS.some((pattern) => pattern.test(link));

export const ensureUrl = (value: string): URL | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(prefixed);
  } catch {
    return null;
  }
};

export const normalizeHostname = (value: string): string => {
  const url = ensureUrl(value);
  if (!url) {
    return value.toLowerCase().replace(/^www\./, "");
  }
  return url.hostname.toLowerCase().replace(/^www\./, "");
};

export const isLikelyCommand = (text: string | null | undefined): boolean => {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const prefixes = ["/", "!", "#", "$"];
  return prefixes.some((prefix) => trimmed.startsWith(prefix));
};
