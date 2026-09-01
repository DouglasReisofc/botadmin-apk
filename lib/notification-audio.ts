import {
  DEFAULT_NOTIFICATION_VOICE,
  NOTIFICATION_VOICE_ID_SET,
} from "data/notification-audio";

const DEFAULT_TTS_BASE_URL = "/api/tts";

const sanitizeString = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveDefaultSpeechVoice = (): string => {
  const candidates = [
    sanitizeString(process.env.NOTIFICATIONS_TTS_DEFAULT_VOICE),
    sanitizeString(process.env.NEXT_PUBLIC_TTS_VOICE),
  ];

  for (const candidate of candidates) {
    if (candidate && NOTIFICATION_VOICE_ID_SET.has(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_NOTIFICATION_VOICE;
};

export const sanitizeSpeechVoice = (voice?: string | null): string => {
  const normalized = sanitizeString(voice);
  if (normalized && NOTIFICATION_VOICE_ID_SET.has(normalized)) {
    return normalized;
  }
  return resolveDefaultSpeechVoice();
};

const resolveTtsBaseUrl = (): string => {
  const candidates = [
    sanitizeString(process.env.NOTIFICATIONS_TTS_BASE_URL),
    sanitizeString(process.env.NEXT_PUBLIC_TTS_BASE_URL),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return DEFAULT_TTS_BASE_URL;
};

// API key não é necessária para o endpoint local

const resolveAppBase = (): string => {
  const cands = [process.env.NOTIFICATIONS_APP_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL, process.env.VERCEL_URL];
  for (const raw of cands) {
    if (!raw) continue;
    const v = raw.trim();
    if (!v) continue;
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try { const u = new URL(withScheme); u.pathname = u.pathname.replace(/\/+$/, ""); return u.toString().replace(/\/+$/, ""); } catch {}
  }
  return "http://localhost:4478";
};

export const buildTtsUrlForText = (text: string, voice?: string | null): string | null => {
  const normalizedText = sanitizeString(text);
  if (!normalizedText) {
    return null;
  }

  const baseUrl = resolveTtsBaseUrl();
  const resolvedVoice = sanitizeSpeechVoice(voice);

  try {
    let url: URL;
    if (/^https?:\/\//i.test(baseUrl)) {
      url = new URL(baseUrl);
    } else if (baseUrl.startsWith("/")) {
      url = new URL(baseUrl, resolveAppBase());
    } else {
      url = new URL(`/${baseUrl}`, resolveAppBase());
    }

    url.searchParams.set("texto", normalizedText);
    if (resolvedVoice) {
      url.searchParams.set("voz", resolvedVoice);
    }

    return url.toString();
  } catch (error) {
    try {
      console.error("[notifications] Falha ao construir URL de TTS", error);
    } catch {
      // ignore logging issues
    }
    return null;
  }
};
