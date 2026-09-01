"use client";

import { useEffect, useRef } from "react";

import { getAssetPath } from "../../helper/assetPath";
import {
  DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  DEFAULT_NOTIFICATION_BOT_NAME,
  DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
  DEFAULT_NOTIFICATION_VOICE,
  NOTIFICATION_VOICE_ID_SET,
} from "data/notification-audio";

type SupportMessagePayload = {
  userId?: number;
  whatsappId: string;
  message: {
    id: number;
    direction: "inbound" | "outbound";
    messageType: string;
    text: string | null;
    timestamp: string;
    senderUserId: number | null;
    senderRole: "user" | "admin" | "contact" | "system";
  };
};

type PurchaseCreatedEvent = {
  categoryName: string;
  categoryPrice: number;
  customerName: string | null;
  customerWhatsapp: string | null;
  purchasedAt: string;
  productDetails?: string | null;
};

type NotificationCreatedEvent = {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type NotificationAudioSettings = {
  soundsEnabled: boolean;
  ttsEnabled: boolean;
  speechMode: "browser" | "api";
  speechVoice: string;
  purchaseTemplate: string;
  balanceTemplate: string;
  raffleTemplate: string;
  planTemplate: string;
};

type ListenerAuthState = {
  status: "unknown" | "authenticated" | "unauthenticated";
  role: string | null;
  userId: number | null;
};

const RECONNECT_DELAY = 5000;
const RAW_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const BASE_PREFIX = RAW_BASE_PATH && RAW_BASE_PATH !== "/"
  ? (RAW_BASE_PATH.startsWith("/") ? RAW_BASE_PATH : `/${RAW_BASE_PATH}`)
  : "";
const USER_SSE_PATH = `${BASE_PREFIX}/api/support/stream`;
const ADMIN_SSE_PATH = `${BASE_PREFIX}/api/admin/support/stream`;

const TTS_BASE_URL = (process.env.NEXT_PUBLIC_TTS_BASE_URL || "/api/tts").trim();
const DEBUG_NOTIFICATIONS = (process.env.NEXT_PUBLIC_DEBUG_NOTIFICATIONS || "").trim().toLowerCase() === "true";
const TTS_VOICE = (process.env.NEXT_PUBLIC_TTS_VOICE || "ludmilla").trim();
const TTS_FORCE_WEBAUDIO = ((process.env.NEXT_PUBLIC_TTS_FORCE_WEBAUDIO || "").trim().toLowerCase() === "true");
const TTS_USE_PROXY = ((process.env.NEXT_PUBLIC_TTS_USE_PROXY || "true").trim().toLowerCase() !== "false");
const AUDIO_SETTINGS_STORAGE_KEY = "notification-audio-settings";
const DEFAULT_AUDIO_SETTINGS: NotificationAudioSettings = {
  soundsEnabled: true,
  ttsEnabled: true,
  speechMode: "api",
  speechVoice: DEFAULT_NOTIFICATION_VOICE,
  purchaseTemplate: DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  balanceTemplate: DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  raffleTemplate: DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  planTemplate: DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
};

const AUTH_RETRY_DELAY_MS = 5000;
const AUTH_CONNECTED_CHECK_MS = 20000;

const SupportNotificationListener = () => {
  const sseRef = useRef<EventSource | null>(null);
  const supportOpenAudioRef = useRef<HTMLAudioElement | null>(null);
  const supportReplyAudioRef = useRef<HTMLAudioElement | null>(null);
  const purchaseAudioRef = useRef<HTMLAudioElement | null>(null);
  const balanceAudioRef = useRef<HTMLAudioElement | null>(null);
  const generalAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSpeechUrlRef = useRef<string | null>(null);
  const speechQueueRef = useRef<string[]>([]);
  const isProcessingSpeechRef = useRef(false);
  const voiceDefaultsRef = useRef({
    botName: DEFAULT_NOTIFICATION_BOT_NAME,
    purchaseTemplate: DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
    balanceTemplate: DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
    raffleTemplate: DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
    planTemplate: DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
    voice: DEFAULT_NOTIFICATION_VOICE,
  });
  const lastCoinPlaybackRef = useRef(0);
  const recentCoinKeysRef = useRef<Record<string, number>>({});
  const recentSpeechKeysRef = useRef<Record<string, number>>({});
    // Thread updates only refresh UI state. Sounds are driven by message-created
    // so an outbound message sent by the same user never becomes a notification.
  const reconnectRef = useRef<number | null>(null);
  const primedAudioRef = useRef(false);
  const userInteractedRef = useRef(false);
  const primingPromiseRef = useRef<Promise<boolean> | null>(null);
  const activeOneShotsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const activeBufferSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const audioSettingsRef = useRef<NotificationAudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const sseRoleRef = useRef<string | null>(null);
  const activeSupportThreadRef = useRef<string | null>(null);
  const localOutboundRef = useRef<Map<string, number>>(new Map());
  const authStateRef = useRef<ListenerAuthState>({
    status: "unknown",
    role: null,
    userId: null,
  });
  const authCheckTimerRef = useRef<number | null>(null);
  const audioPermissionRef = useRef(false);

  useEffect(() => {
    const log = (...args: unknown[]) => {
      if (!DEBUG_NOTIFICATIONS) return;
      try {
        console.info("[notifications]", ...args);
      } catch {
        // ignore logging failures
      }
    };

    const handleLocalOutboundSent = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{ whatsappId?: string; messageId?: number }>).detail;
        const whatsappIdRaw = detail?.whatsappId;
        const whatsappId = typeof whatsappIdRaw === "string" ? whatsappIdRaw.trim() : "";
        const messageIdRaw = detail?.messageId;
        const messageId = typeof messageIdRaw === "number" && Number.isFinite(messageIdRaw)
          ? messageIdRaw
          : Number(messageIdRaw);
        if (!whatsappId || !Number.isFinite(messageId)) {
          return;
        }
        const key = `${whatsappId}:${messageId}`;
        localOutboundRef.current.set(key, Date.now());
      } catch {}
    };

    const normalizeAudioSettings = (
      value: Partial<NotificationAudioSettings> | null | undefined,
    ): NotificationAudioSettings => {
      const defaults = voiceDefaultsRef.current;
      const rawVoice = typeof value?.speechVoice === "string" ? value.speechVoice.trim() : "";
      const voice = NOTIFICATION_VOICE_ID_SET.has(rawVoice)
        ? rawVoice
        : defaults.voice ?? DEFAULT_NOTIFICATION_VOICE;
      const purchaseTemplate =
        typeof value?.purchaseTemplate === "string" && value.purchaseTemplate.trim()
          ? value.purchaseTemplate.trim()
          : defaults.purchaseTemplate;
      const balanceTemplate =
        typeof value?.balanceTemplate === "string" && value.balanceTemplate.trim()
          ? value.balanceTemplate.trim()
          : defaults.balanceTemplate;
      const raffleTemplate =
        typeof value?.raffleTemplate === "string" && value.raffleTemplate.trim()
          ? value.raffleTemplate.trim()
          : defaults.raffleTemplate ?? DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE;
      const planTemplate =
        typeof value?.planTemplate === "string" && value.planTemplate.trim()
          ? value.planTemplate.trim()
          : defaults.planTemplate ?? DEFAULT_NOTIFICATION_PLAN_TEMPLATE;

      return {
        soundsEnabled: value?.soundsEnabled !== false,
        ttsEnabled: value?.ttsEnabled !== false,
        speechMode: value?.speechMode === "browser" ? "browser" : "api",
        speechVoice: voice,
        purchaseTemplate,
        balanceTemplate,
        raffleTemplate,
        planTemplate,
      } satisfies NotificationAudioSettings;
    };

    const resolveBotName = () => {
      const raw = voiceDefaultsRef.current.botName;
      if (typeof raw === "string" && raw.trim().length > 0) {
        return raw.trim();
      }
      return DEFAULT_NOTIFICATION_BOT_NAME;
    };

    const resolveVoiceId = () => {
      const candidate = audioSettingsRef.current.speechVoice?.trim();
      if (candidate && (NOTIFICATION_VOICE_ID_SET.has(candidate) || NOTIFICATION_VOICE_ID_SET.size === 0)) {
        return candidate;
      }

      const fallbackVoice = voiceDefaultsRef.current.voice?.trim();
      if (fallbackVoice && (NOTIFICATION_VOICE_ID_SET.has(fallbackVoice) || NOTIFICATION_VOICE_ID_SET.size === 0)) {
        return fallbackVoice;
      }

      if (TTS_VOICE) {
        return TTS_VOICE;
      }

      return DEFAULT_NOTIFICATION_VOICE;
    };

    const applyTemplate = (template: string, context: Record<string, string>): string => {
      return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => {
        const replacement = context[key];
        return typeof replacement === "string" ? replacement : "";
      });
    };

    const buildSpeechMessage = (
      template: string,
      fallbackTemplate: string,
      context: Record<string, string>,
      plainFallback: string,
    ): string => {
      const primary = applyTemplate(template, context).replace(/\s+/g, " ").trim();
      if (primary) {
        return primary;
      }

      const secondary = applyTemplate(fallbackTemplate, context).replace(/\s+/g, " ").trim();
      if (secondary) {
        return secondary;
      }

      return plainFallback.replace(/\s+/g, " ").trim();
    };

    const broadcastAudioStatus = () => {
      try {
        window.dispatchEvent(
          new CustomEvent("notifications:audio-status", {
            detail: {
              permission: audioPermissionRef.current,
              primed: primedAudioRef.current,
              pending: Boolean(primingPromiseRef.current),
            },
          }),
        );
      } catch {}
    };

    const normalizePathname = (pathname: string): string => {
      if (!pathname) {
        return "/";
      }
      if (BASE_PREFIX && BASE_PREFIX !== "/" && pathname.startsWith(BASE_PREFIX)) {
        const trimmed = pathname.slice(BASE_PREFIX.length);
        return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      }
      return pathname;
    };

    // kept for backward-compatibility and possible future use
    const _isConversationRouteActive = (role: string | null): boolean => {
      if (typeof window === "undefined") {
        return false;
      }
      try {
        const normalized = normalizePathname(window.location.pathname || "/");
        if (role === "admin") {
          return normalized.startsWith("/dashboard/admin/suporte");
        }
        return normalized.startsWith("/dashboard/user/conversas");
      } catch {
        return false;
      }
    };

    // Consider a conversation "active" whenever the UI marked a thread as opened
    // and the page is visible, regardless of the current route. This supports
    // cases where the admin is using the floating modal in other routes.
    const isSupportConversationActive = (whatsappId: string | null | undefined): boolean => {
      if (!whatsappId) {
        return false;
      }
      if (activeSupportThreadRef.current !== whatsappId) {
        return false;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false;
      }
      return true;
    };

    const buildSupportAudioQueue = (
      whatsappId: string,
      messageType: string,
    ): Array<HTMLAudioElement | null> => {
      const queue: Array<HTMLAudioElement | null> = [];
      const isInteractive = messageType === "interactive";
      const conversationActive = isSupportConversationActive(whatsappId);

      if (conversationActive) {
        queue.push(supportReplyAudioRef.current);
      } else if (isInteractive) {
        queue.push(supportOpenAudioRef.current);
      } else {
        queue.push(generalAudioRef.current);
      }

      if (supportReplyAudioRef.current && !queue.includes(supportReplyAudioRef.current)) {
        queue.push(supportReplyAudioRef.current);
      }
      if (supportOpenAudioRef.current && !queue.includes(supportOpenAudioRef.current)) {
        queue.push(supportOpenAudioRef.current);
      }
      if (generalAudioRef.current && !queue.includes(generalAudioRef.current)) {
        queue.push(generalAudioRef.current);
      }

      return queue;
    };

    const readStoredAudioSettings = (): NotificationAudioSettings => {
      if (typeof window === "undefined") {
        return DEFAULT_AUDIO_SETTINGS;
      }
      try {
        const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return normalizeAudioSettings(parsed);
      } catch {
        return DEFAULT_AUDIO_SETTINGS;
      }
    };

    const applyAudioSettings = (settings: NotificationAudioSettings) => {
      audioSettingsRef.current = settings;
      if (!settings.ttsEnabled) {
        speechQueueRef.current = [];
        if (speechAudioRef.current) {
          try {
            speechAudioRef.current.pause();
          } catch {
            // ignore pause errors
          }
          speechAudioRef.current = null;
        }
        isProcessingSpeechRef.current = false;
      }
    };

    const persistLocalSettings = (settings: NotificationAudioSettings) => {
      if (typeof window === "undefined") {
        return;
      }
      try {
        window.localStorage.setItem(
          AUDIO_SETTINGS_STORAGE_KEY,
          JSON.stringify(settings),
        );
      } catch {
        // ignore storage write errors
      }
      window.dispatchEvent(new CustomEvent("notifications:audio-settings", { detail: settings }));
    };

    const initialSettings = readStoredAudioSettings();
    applyAudioSettings(initialSettings);
    persistLocalSettings(initialSettings);

    const syncUserAudioSettings = async () => {
      try {
        const response = await fetch("/api/notifications/audio-settings", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = await response.json().catch(() => null);
        const settingsPayload = (payload as { settings?: Partial<NotificationAudioSettings> | null } | null)?.settings;
        const remote = normalizeAudioSettings(settingsPayload);
        applyAudioSettings(remote);
        persistLocalSettings(remote);
      } catch (error) {
        if (DEBUG_NOTIFICATIONS) {
          try { console.debug("[notifications] Falha ao sincronizar configurações de áudio do usuário", error); } catch {}
        }
      }
    };

    const syncAudioDefaults = async () => {
      try {
        const response = await fetch("/api/notifications/audio-config", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = await response.json().catch(() => null);
        const defaults = (payload?.defaults ?? {}) as Record<string, unknown>;

        const botName = typeof payload?.botName === "string" && payload.botName.trim()
          ? payload.botName.trim()
          : DEFAULT_NOTIFICATION_BOT_NAME;

        const purchaseTemplate =
          typeof defaults.purchaseTemplate === "string" && defaults.purchaseTemplate.trim()
            ? defaults.purchaseTemplate.trim()
            : DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE;

        const balanceTemplate =
          typeof defaults.balanceTemplate === "string" && defaults.balanceTemplate.trim()
            ? defaults.balanceTemplate.trim()
            : DEFAULT_NOTIFICATION_BALANCE_TEMPLATE;

        const raffleTemplate =
          typeof defaults.raffleTemplate === "string" && defaults.raffleTemplate.trim()
            ? defaults.raffleTemplate.trim()
            : DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE;

        const planTemplate =
          typeof defaults.planTemplate === "string" && defaults.planTemplate.trim()
            ? defaults.planTemplate.trim()
            : DEFAULT_NOTIFICATION_PLAN_TEMPLATE;

        const defaultVoice =
          typeof defaults.voice === "string" && defaults.voice.trim()
            ? defaults.voice.trim()
            : DEFAULT_NOTIFICATION_VOICE;

        voiceDefaultsRef.current = {
          botName,
          purchaseTemplate,
          balanceTemplate,
          raffleTemplate,
          planTemplate,
          voice: defaultVoice,
        };

        const normalized = normalizeAudioSettings(audioSettingsRef.current);
        applyAudioSettings(normalized);
        persistLocalSettings(normalized);

        await syncUserAudioSettings();
      } catch (error) {
        if (DEBUG_NOTIFICATIONS) {
          try { console.debug("[notifications] Falha ao sincronizar voz padrão", error); } catch {}
        }
        void syncUserAudioSettings();
      }
    };
    // Nota: sincronização de defaults agora ocorre apenas após verificar autenticação

    const ensureAuthInfo = async (): Promise<{ canListen: boolean; role: string | null }> => {
      // If we already authenticated, reuse until next scheduled check
      if (authStateRef.current.status === "authenticated") {
        const role = authStateRef.current.role;
        const canListen = role === "user" || role === "admin";
        return { canListen, role };
      }

      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });

        if (!res.ok) {
          authStateRef.current = { status: "unauthenticated", role: null, userId: null };
          return { canListen: false, role: null };
        }

        const data = await res.json().catch(() => null);
        const role = data?.user?.role ?? null;
        const rawUserId = Number(data?.user?.id);
        const userId = Number.isFinite(rawUserId) && rawUserId > 0 ? rawUserId : null;
        if (role) {
          authStateRef.current = { status: "authenticated", role, userId };
          const canListen = role === "user" || role === "admin";
          return { canListen, role };
        }
        authStateRef.current = { status: "unauthenticated", role: null, userId: null };
        return { canListen: false, role: null };
      } catch {
        authStateRef.current = { status: "unauthenticated", role: null, userId: null };
        return { canListen: false, role: null };
      }
    };

    const clearAuthTimer = () => {
      if (authCheckTimerRef.current) {
        window.clearTimeout(authCheckTimerRef.current);
        authCheckTimerRef.current = null;
      }
    };

    const createAudioWithFallback = (candidates: Array<{ path: string; mime?: string }>) => {
      const audio = document.createElement("audio");
      audio.setAttribute("playsinline", "true");
      audio.preload = "none";
      audio.muted = false;
      audio.autoplay = false;

      let selectedSource: string | null = null;

      for (const candidate of candidates) {
        if (!candidate?.path) {
          continue;
        }

        const assetPath = getAssetPath(candidate.path);
        const sourceEl = document.createElement("source");
        sourceEl.src = assetPath;
        if (candidate.mime) {
          sourceEl.type = candidate.mime;
        }
        audio.appendChild(sourceEl);

        if (!selectedSource) {
          const supportLevel = candidate.mime
            ? audio.canPlayType?.(candidate.mime) ?? ""
            : "maybe";

          if (supportLevel) {
            selectedSource = assetPath;
          }
        }
      }

      if (selectedSource) {
        audio.src = selectedSource;
      } else if (candidates[0]?.path) {
        audio.src = getAssetPath(candidates[0].path);
      }

      return audio;
    };

    const handleAudioSettingsChange = (event: Event) => {
      const detail = (event as CustomEvent<Partial<NotificationAudioSettings> | NotificationAudioSettings>).detail;
      if (!detail || typeof detail !== "object") {
        return;
      }
      const next = normalizeAudioSettings(detail);
      log("audio settings updated", next);
      applyAudioSettings(next);
    };

    window.addEventListener("notifications:audio-settings", handleAudioSettingsChange as EventListener);
    window.addEventListener("notifications:prime-audio", () => {
      userInteractedRef.current = true;
      requestAudioPriming();
    });

    const createdAudios: HTMLAudioElement[] = [];

    // Som ao abrir novo suporte
    const supportOpenAudio = createAudioWithFallback([
      { path: "/sounds/notificacao.mp3", mime: "audio/mpeg" },
      { path: "/sounds/general-notification.mp3", mime: "audio/mpeg" },
      { path: "/sounds/jh1.ogg", mime: "audio/ogg" },
    ]);
    supportOpenAudioRef.current = supportOpenAudio;
    createdAudios.push(supportOpenAudio);

    // Som para resposta do cliente no suporte
    const supportReplyAudio = createAudioWithFallback([
      { path: "/sounds/support-reply.mp3", mime: "audio/mpeg" },
      { path: "/sounds/support-reply.m4a", mime: "audio/mp4" },
      { path: "/sounds/jgf.mp3", mime: "audio/mpeg" },
      { path: "/sounds/jgf.m4a", mime: "audio/mp4" },
      { path: "/sounds/jh1.ogg", mime: "audio/ogg" },
    ]);
    supportReplyAudioRef.current = supportReplyAudio;
    createdAudios.push(supportReplyAudio);

    const purchaseAudio = createAudioWithFallback([
      // Prefer new descriptive name; keep antigo como fallback
      { path: "/sounds/nfcpayments_core_dark_sound_nfc.mp3", mime: "audio/mpeg" },
      { path: "/sounds/purchase-notification.mp3", mime: "audio/mpeg" },
      { path: "/sounds/coin.mp3", mime: "audio/mpeg" },
      { path: "/sounds/jh1.ogg", mime: "audio/ogg" },
      { path: "/sounds/jh4.m4a", mime: "audio/mp4" },
    ]);
    purchaseAudioRef.current = purchaseAudio;
    createdAudios.push(purchaseAudio);

    const balanceAudio = createAudioWithFallback([
      // Prefer new descriptive name; keep antigo como fallback
      { path: "/sounds/visa_sound.mp3", mime: "audio/mpeg" },
      { path: "/sounds/general-notification.mp3", mime: "audio/mpeg" },
      { path: "/sounds/coin.mp3", mime: "audio/mpeg" },
      { path: "/sounds/jh1.ogg", mime: "audio/ogg" },
      { path: "/sounds/jh4.m4a", mime: "audio/mp4" },
    ]);
    balanceAudioRef.current = balanceAudio;
    createdAudios.push(balanceAudio);

    const generalAudio = createAudioWithFallback([
      // Prefer new descriptive name; keep antigo como fallback
      { path: "/sounds/visa_sound.mp3", mime: "audio/mpeg" },
      { path: "/sounds/general-notification.mp3", mime: "audio/mpeg" },
      { path: "/sounds/coin.mp3", mime: "audio/mpeg" },
      { path: "/sounds/jh1.ogg", mime: "audio/ogg" },
    ]);
    generalAudioRef.current = generalAudio;
    createdAudios.push(generalAudio);

    log("audio buffers created", {
      supportOpen: supportOpenAudio.currentSrc || supportOpenAudio.src,
      supportReply: supportReplyAudio.currentSrc || supportReplyAudio.src,
      purchase: purchaseAudio.currentSrc || purchaseAudio.src,
      balance: balanceAudio.currentSrc || balanceAudio.src,
      general: generalAudio.currentSrc || generalAudio.src,
    });

    const tryPrimeAudio = async (audio: HTMLAudioElement) => {
      // Never prime an audio that is currently playing
      if (!audio.paused && !audio.ended) {
        return true;
      }
      const previousMuted = audio.muted;
      const previousTime = audio.currentTime;

      try {
        audio.muted = true;
        audio.currentTime = 0;
        const playbackResult = audio.play();
        if (playbackResult && typeof playbackResult.then === "function") {
          await playbackResult;
        }
        audio.pause();
        audio.currentTime = 0;
        return true;
      } catch (error) {
        log("audio priming blocked", { src: audio.currentSrc || audio.src, error });
        return false;
      } finally {
        audio.muted = previousMuted;
        audio.currentTime = previousTime;
      }
    };

    type AudioContextCtor = { new(): AudioContext };
    const getAudioContextCtor = (): AudioContextCtor | null => {
      const w = window as unknown as {
        AudioContext?: AudioContextCtor;
        webkitAudioContext?: AudioContextCtor;
      };
      return w.AudioContext || w.webkitAudioContext || null;
    };

    const hasUserActivation = () => {
      if (userInteractedRef.current) {
        return true;
      }
      try {
        const activation = (navigator as unknown as { userActivation?: { isActive?: boolean; hasBeenActive?: boolean } }).userActivation;
        return Boolean(activation?.isActive || activation?.hasBeenActive);
      } catch {
        return false;
      }
    };

    const primeAllAudios = async () => {
      if (!hasUserActivation()) {
        // Do not attempt to start/resume AudioContext before user gesture
        return false;
      }
      if (!createdAudios.length) {
        // still try to prime the WebAudio context
        try {
          const Ctor = getAudioContextCtor();
          if (Ctor && !audioCtxRef.current) {
            audioCtxRef.current = new Ctor();
          }
          if (audioCtxRef.current?.state === "suspended") {
            await audioCtxRef.current.resume().catch(() => {});
          }
          return audioCtxRef.current?.state === "running";
        } catch {
          return false;
        }
      }
      try {
        const results = await Promise.all(createdAudios.map((audio) => tryPrimeAudio(audio)));
        let ctxOk = false;
        try {
          const Ctor = getAudioContextCtor();
          if (Ctor && !audioCtxRef.current) {
            audioCtxRef.current = new Ctor();
          }
          if (audioCtxRef.current?.state === "suspended") {
            await audioCtxRef.current.resume().catch(() => {});
          }
          ctxOk = audioCtxRef.current?.state === "running";
        } catch {
          ctxOk = false;
        }
        return results.some(Boolean) || ctxOk;
      } catch {
        // Expected on strict autoplay environments; try again after gesture
        return false;
      }
    };

    const primeEventTypes = [
      "pointerdown",
      "touchstart",
      "keydown",
      "visibilitychange",
    ] as const;

    let removePrimeListeners: (() => void) | null = null;

    const requestAudioPriming = () => {
      log("audio priming requested", {
        permission: audioPermissionRef.current,
        primed: primedAudioRef.current,
        pending: Boolean(primingPromiseRef.current),
      });
      if (!audioPermissionRef.current) {
        return;
      }
      if (primedAudioRef.current) {
        if (removePrimeListeners) {
          removePrimeListeners();
          removePrimeListeners = null;
        }
        return;
      }

      if (!primingPromiseRef.current) {
        primingPromiseRef.current = primeAllAudios()
          .then((success) => {
            primedAudioRef.current = success;
            if (success && removePrimeListeners) {
              removePrimeListeners();
              removePrimeListeners = null;
            }
            log("audio priming result", { success });
            return success;
          })
          .catch((error) => {
            log("audio priming failed", error);
            return false;
          })
          .finally(() => {
            primingPromiseRef.current = null;
          });
      }
    };

    const ensurePrimeListeners = () => {
      if (!audioPermissionRef.current) {
        if (removePrimeListeners) {
          removePrimeListeners();
          removePrimeListeners = null;
        }
        return;
      }
      if (removePrimeListeners) {
        return;
      }

      const listener: EventListener = (event) => {
        if (event.type !== "visibilitychange") {
          userInteractedRef.current = true;
        }
        if (primedAudioRef.current) {
          if (removePrimeListeners) {
            removePrimeListeners();
            removePrimeListeners = null;
          }
          return;
        }

        if (event.type === "visibilitychange" && document.visibilityState !== "visible") {
          return;
        }

        requestAudioPriming();
      };

      primeEventTypes.forEach((type) => {
        window.addEventListener(type, listener, { passive: true });
      });

      removePrimeListeners = () => {
        primeEventTypes.forEach((type) => {
          window.removeEventListener(type, listener as EventListener);
        });
      };
    };

    // WebAudio helpers
    const ensureAudioContext = (): AudioContext | null => {
      if (!hasUserActivation()) {
        return null;
      }
      try {
        const Ctor = getAudioContextCtor();
        if (!Ctor) return null;
        if (!audioCtxRef.current) {
          audioCtxRef.current = new Ctor();
        }
        return audioCtxRef.current;
      } catch {
        return null;
      }
    };

    const decodeToBuffer = async (url: string): Promise<AudioBuffer | null> => {
      const cache = bufferCacheRef.current;
      const cached = cache.get(url);
      if (cached) return cached;
      const ctx = ensureAudioContext();
      if (!ctx) return null;
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr.slice(0));
        cache.set(url, buf);
        log("decoded audio buffer", url);
        return buf;
      } catch (error) {
        log("failed to decode audio buffer", { url, error });
        return null;
      }
    };

    const playWebAudioOneShot = async (urls: string[]): Promise<boolean> => {
      if (!hasUserActivation()) {
        ensurePrimeListeners();
        try {
          window.dispatchEvent(new CustomEvent("notifications:audio-permission-required", { detail: { reason: "no-activation" } }));
        } catch {}
        broadcastAudioStatus();
        return false;
      }
      const ctx = ensureAudioContext();
      if (!ctx) return false;
      try { if (ctx.state === "suspended") await ctx.resume().catch(() => {}); } catch {}

      for (const rawUrl of urls) {
        const url = getAssetPath(rawUrl.replace(window.location.origin, ""));
        const buf = await decodeToBuffer(url);
        if (!buf) continue;
        try {
          const source = ctx.createBufferSource();
          source.buffer = buf;
          source.connect(ctx.destination);
          activeBufferSourcesRef.current.add(source);
          const done = new Promise<boolean>((resolve) => {
            source.onended = () => {
              activeBufferSourcesRef.current.delete(source);
              resolve(true);
            };
          });
          source.start(0);
          await done;
          log("played buffer via WebAudio", url);
          return true;
        } catch (error) {
          log("webaudio playback error", { url, error });
          // try next fallback url
        }
      }
      log("webaudio fallback exhausted", urls);
      return false;
    };

    const playOneShotWithFallback = (
      primary: HTMLAudioElement | null,
      fallbackAudios: Array<HTMLAudioElement | null> = [],
    ): Promise<boolean> => {
      if (!audioSettingsRef.current.soundsEnabled) {
        log("audio attempt skipped - sounds disabled");
        return Promise.resolve(false);
      }

      if (!hasUserActivation()) {
        log("audio attempt blocked - no user activation");
        ensurePrimeListeners();
        return Promise.resolve(false);
      }

      const queue = [primary, ...fallbackAudios].filter(
        (audio): audio is HTMLAudioElement => Boolean(audio),
      );

      if (!queue.length) {
        requestAudioPriming();
        return Promise.resolve(false);
      }

      const tryPlayAt = (index: number, hasRetriedAfterPriming = false): Promise<boolean> => {
        const base = queue[index];
        if (!base) {
          primedAudioRef.current = false;
          requestAudioPriming();
          return Promise.resolve(false);
        }

        // Create an isolated clone/new element so simultaneous notifications don't cut each other
        const clone = new Audio(base.currentSrc || base.src);
        clone.preload = "auto";
        clone.setAttribute("playsinline", "true");
        clone.muted = false;
        clone.autoplay = false;
        clone.currentTime = 0;

        activeOneShotsRef.current.add(clone);

        return new Promise<boolean>((resolve) => {
          const cleanup = (ok: boolean) => {
            clone.removeEventListener("ended", onEnded);
            clone.removeEventListener("error", onError);
            // 'stalled' and 'suspend' are not fatal; avoid treating as errors to not cut audio
            clone.removeEventListener("stalled", onStalled);
            clone.removeEventListener("abort", onAbort);
            try { clone.pause(); } catch {}
            activeOneShotsRef.current.delete(clone);
            resolve(ok);
          };
          const onEnded = () => {
            primedAudioRef.current = true;
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              try { navigator.vibrate?.(30); } catch {}
            }
            log("audio playback finished", clone.currentSrc || clone.src);
            cleanup(true);
          };
          const onError = (err?: unknown) => {
            log("audio playback error", { src: clone.currentSrc || clone.src, err });
            if (err) {
              try { console.debug("playOneShot error", err); } catch {}
            }
            // Try next fallback
            if (!primedAudioRef.current && !hasRetriedAfterPriming) {
              // Likely autoplay block; try to prime and retry once on same source
              const wait = primingPromiseRef.current || Promise.resolve(false);
              wait
                .then((success) => success || primeAllAudios())
                .then((success) => {
                  if (success) {
                    cleanup(false);
                    void tryPlayAt(index, true).then(resolve);
                    return;
                  }
                  // continue to next source
                  if (index + 1 < queue.length) {
                    cleanup(false);
                    void tryPlayAt(index + 1, hasRetriedAfterPriming).then(resolve);
                  } else {
                    primedAudioRef.current = false;
                    requestAudioPriming();
                    cleanup(false);
                  }
                })
                .catch(() => {
                  if (index + 1 < queue.length) {
                    cleanup(false);
                    void tryPlayAt(index + 1, hasRetriedAfterPriming).then(resolve);
                  } else {
                    primedAudioRef.current = false;
                    requestAudioPriming();
                    cleanup(false);
                  }
                });
              return;
            }
            if (index + 1 < queue.length) {
              cleanup(false);
              void tryPlayAt(index + 1, hasRetriedAfterPriming).then(resolve);
            } else {
              primedAudioRef.current = false;
              requestAudioPriming();
              cleanup(false);
            }
          };
          const onStalled = () => {
            // Ignore stalled; browser may resume
          };
          const onAbort = () => {
            // Ignore aborts not caused by us (we don't call load/replace src here)
          };

          clone.addEventListener("ended", onEnded);
          clone.addEventListener("error", onError);
          clone.addEventListener("stalled", onStalled);
          clone.addEventListener("abort", onAbort);

          // In some TVs needing a user gesture, play() might reject; try once
          const attempt = clone.play();
          if (attempt && typeof attempt.then === "function") {
            attempt.catch((e) => onError(e));
          }
        });
      };

      const urls = queue
        .map((a) => a.currentSrc || a.src)
        .filter((u): u is string => !!u);
      return tryPlayAt(0)
        .then((ok) => (ok ? ok : playWebAudioOneShot(urls)))
        .then((result) => {
          log("audio attempt", result ? "played" : "skipped", urls, {
            soundsEnabled: audioSettingsRef.current.soundsEnabled,
            userActivated: hasUserActivation(),
          });
          if (!result) {
            try { window.dispatchEvent(new CustomEvent("notifications:audio-permission-required", { detail: { reason: "blocked" } })); } catch {}
          }
          broadcastAudioStatus();
          return result;
        });
    };

    ensurePrimeListeners();
    if (document.visibilityState === "visible") {
      requestAudioPriming();
    }

    const MIN_COIN_INTERVAL_MS = 120;
    const COIN_DEDUP_WINDOW_MS = 5000;
    const SPEECH_DEDUP_WINDOW_MS = 4000;

    const playSpeechFromUrl = async (url: URL): Promise<void> => {
      if (!audioSettingsRef.current.ttsEnabled) {
        return;
      }

      if (TTS_FORCE_WEBAUDIO) {
        try {
          const ok = await playWebAudioOneShot([url.toString()]);
          if (ok) return;
          // fall back to HTMLAudio if WebAudio failed unexpectedly
        } catch {
          // ignore and continue to HTMLAudio path
        }
      }
      // Try HTMLAudio first
      try {
        const el = new Audio(url.toString());
        el.preload = "auto";
        el.setAttribute("playsinline", "true");
        try {
          const u = new URL(url.toString());
          if (u.origin !== window.location.origin) {
            el.crossOrigin = "anonymous";
          }
        } catch {}

        speechAudioRef.current = el;
        log("speech element created", url.toString());
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            el.removeEventListener("ended", onEnded);
            el.removeEventListener("error", onError);
            el.removeEventListener("playing", onPlaying);
            el.removeEventListener("timeupdate", onTime);
            el.removeEventListener("stalled", onStalled);
            el.removeEventListener("suspend", onSuspend);
            if (startGuard) { clearTimeout(startGuard); startGuard = null; }
            if (endGuard) { clearTimeout(endGuard); endGuard = null; }
            try { el.pause(); } catch {}
          };
          let started = false;
          let startGuard: number | null = null;
          let endGuard: number | null = null;

          const armEndGuard = () => {
            try {
              const d = Number.isFinite(el.duration) && el.duration > 0 ? Math.min(Math.max(el.duration + 4, 8), 40) : 15;
              endGuard = window.setTimeout(() => onError(), d * 1000);
            } catch {
              endGuard = window.setTimeout(() => onError(), 15000);
            }
          };

          const onPlaying = () => {
            started = true;
            if (startGuard) { clearTimeout(startGuard); startGuard = null; }
            if (!endGuard) armEndGuard();
            log("speech playback started", url.toString());
          };
          const onTime = () => {
            if (!started && el.currentTime > 0) {
              onPlaying();
            }
          };
          const onStalled = () => {
            // let it buffer; guards will handle deadlocks
          };
          const onSuspend = () => {
            // ignore; some browsers fire this mid-playback
          };
          const onEnded = () => { cleanup(); log("speech playback finished", url.toString()); resolve(); };
          const onError = () => { cleanup(); log("speech playback error", url.toString()); reject(new Error("html-audio-error")); };
          el.addEventListener("ended", onEnded);
          el.addEventListener("error", onError);
          el.addEventListener("playing", onPlaying);
          el.addEventListener("timeupdate", onTime);
          el.addEventListener("stalled", onStalled);
          el.addEventListener("suspend", onSuspend);
          el.currentTime = 0;
          const p = el.play();
          if (p && typeof p.then === "function") {
            p.catch(() => onError());
          }
          // Start guard: if it doesn't start within 3.5s, fallback
          startGuard = window.setTimeout(() => {
            if (!started) onError();
          }, 3500);
        });
        speechAudioRef.current = null;
        return;
      } catch {
        // Fall back to WebAudio
        log("speech html audio failed, trying WebAudio", url.toString());
      }

      // WebAudio fallback: fetch and decode, then play via AudioContext
      try {
        const ok = await playWebAudioOneShot([url.toString()]);
        if (!ok) throw new Error("webaudio-failed");
        log("speech played via WebAudio", url.toString());
      } catch {
        // give up; queue handler will continue
        log("speech playback failed", url.toString());
      }
    };

    const speakWithWebSpeech = async (text: string): Promise<void> => {
      if (!audioSettingsRef.current.ttsEnabled) {
        return;
      }

      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        throw new Error("webspeech-unavailable");
      }

      return new Promise((resolve, reject) => {
        try {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = "pt-BR";
          utterance.onend = () => resolve();
          utterance.onerror = () => reject(new Error("webspeech-error"));
          try {
            window.speechSynthesis.cancel();
          } catch {
            // ignore cancellation errors
          }
          window.speechSynthesis.speak(utterance);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("webspeech-init"));
        }
      });
    };

    const processSpeechQueue = () => {
      if (isProcessingSpeechRef.current) {
        return;
      }

      const nextText = speechQueueRef.current.shift();
      if (!nextText) {
        return;
      }

      if (!userInteractedRef.current && !primedAudioRef.current) {
        // Wait until user gesture before attempting TTS playback
        speechQueueRef.current.unshift(nextText);
        ensurePrimeListeners();
        return;
      }

      if (!audioSettingsRef.current.ttsEnabled) {
        isProcessingSpeechRef.current = false;
        speechQueueRef.current = [];
        return;
      }

      isProcessingSpeechRef.current = true;

      const handleFailure = (error?: unknown) => {
        if (error) {
          try { console.debug("Falha ao preparar áudio de TTS", error); } catch {}
          log("speech preparation failure", error);
        }
        if (speechAudioRef.current) {
          speechAudioRef.current.pause();
          speechAudioRef.current = null;
        }
        isProcessingSpeechRef.current = false;
        processSpeechQueue();
      };
      const settings = audioSettingsRef.current;

      if (settings.speechMode === "browser") {
        speakWithWebSpeech(nextText)
          .catch((error) => {
            handleFailure(error);
          })
          .finally(() => {
            isProcessingSpeechRef.current = false;
            processSpeechQueue();
          });
        return;
      }

      try {
        const ttsUrl = buildTtsUrl(nextText);
        if (!ttsUrl) {
          handleFailure();
          return;
        }

        void playSpeechFromUrl(ttsUrl)
          .catch((err) => {
            try { console.debug("Falha ao reproduzir áudio da fila de TTS", err); } catch {}
          })
          .finally(() => {
            isProcessingSpeechRef.current = false;
            processSpeechQueue();
          });
      } catch (error) {
        handleFailure(error);
      }
    };

    const enqueueSpeech = (text: string, dedupeKey?: string, delayMs?: number) => {
      if (!audioSettingsRef.current.ttsEnabled) {
        log("speech suppressed - tts disabled", { text });
        return;
      }

      const trimmedText = text.trim();
      if (!trimmedText) {
        return;
      }

      const now = Date.now();

      if (dedupeKey) {
        const lastTime = recentSpeechKeysRef.current[dedupeKey];
        if (typeof lastTime === "number" && now - lastTime < SPEECH_DEDUP_WINDOW_MS) {
          log("speech deduped", { dedupeKey, text });
          return;
        }
        recentSpeechKeysRef.current[dedupeKey] = now;

        for (const [key, timestamp] of Object.entries(recentSpeechKeysRef.current)) {
          if (now - timestamp > SPEECH_DEDUP_WINDOW_MS) {
            delete recentSpeechKeysRef.current[key];
          }
        }
      }

      const append = () => {
        speechQueueRef.current.push(trimmedText);
        log("speech queued", { text: trimmedText, queueSize: speechQueueRef.current.length });
        processSpeechQueue();
      };

      if (typeof delayMs === "number" && delayMs > 0) {
        window.setTimeout(append, delayMs);
      } else {
        append();
      }
    };

    const playCoin = (
      audioInstance: HTMLAudioElement | null,
      dedupeKey?: string,
      fallbackAudios: Array<HTMLAudioElement | null> = [],
    ) => {
      if (!audioSettingsRef.current.soundsEnabled) {
        log("coin sound suppressed - sounds disabled");
        return;
      }

      const now = Date.now();
      if (dedupeKey) {
        const lastTime = recentCoinKeysRef.current[dedupeKey];
        if (typeof lastTime === "number" && now - lastTime < COIN_DEDUP_WINDOW_MS) {
          log("coin deduped", { dedupeKey });
          return;
        }
        recentCoinKeysRef.current[dedupeKey] = now;

        for (const [key, timestamp] of Object.entries(recentCoinKeysRef.current)) {
          if (now - timestamp > COIN_DEDUP_WINDOW_MS) {
            delete recentCoinKeysRef.current[key];
          }
        }
      }

      if (now - lastCoinPlaybackRef.current < MIN_COIN_INTERVAL_MS) {
        log("coin skipped due to throttle", { sinceLast: now - lastCoinPlaybackRef.current });
        return;
      }

      lastCoinPlaybackRef.current = now;

      const fallbacks = [...fallbackAudios];
      if (!fallbacks.includes(generalAudioRef.current)) {
        fallbacks.push(generalAudioRef.current);
      }

      if (audioInstance) {
        void playOneShotWithFallback(audioInstance, fallbacks)
          .then((ok) => {
            log("coin sound", ok ? "played" : "blocked", { dedupeKey, src: audioInstance.currentSrc || audioInstance.src });
          });
        return;
      }

      if (fallbacks.length) {
        const [primaryFallback, ...rest] = fallbacks;
        if (primaryFallback) {
          void playOneShotWithFallback(primaryFallback, rest)
            .then((ok) => {
              log("coin fallback", ok ? "played" : "blocked", { dedupeKey, src: primaryFallback.currentSrc || primaryFallback.src });
            });
        }
      } else {
        requestAudioPriming();
        log("coin fallback unavailable - requested priming");
      }
    };

    const readCounts = (): Record<string, number> => {
      try {
        const raw = sessionStorage.getItem("support-unread-counts");
        if (!raw) {
          return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    };

    const writeCounts = (counts: Record<string, number>) => {
      try {
        sessionStorage.setItem("support-unread-counts", JSON.stringify(counts));
      } catch {
        // storage might be full or unavailable
      }

      window.dispatchEvent(
        new CustomEvent("support:unread-counts", { detail: { counts } }),
      );
    };

    const incrementCount = (whatsappId: string) => {
      const counts = readCounts();
      counts[whatsappId] = (counts[whatsappId] ?? 0) + 1;
      writeCounts(counts);
    };

    const clearCount = (whatsappId: string) => {
      const counts = readCounts();
      if (!counts[whatsappId]) {
        return;
      }
      delete counts[whatsappId];
      writeCounts(counts);
    };

    const formatCurrency = (value: number) => new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 2,
    }).format(value);

    const buildTtsUrl = (text: string) => {
      if (!TTS_BASE_URL) {
        return null;
      }

      try {
        const selectedVoice = resolveVoiceId();
        if (TTS_USE_PROXY) {
          const proxy = new URL(`${BASE_PREFIX}/api/tts-proxy`, window.location.origin);
          proxy.searchParams.set("texto", text);
          if (selectedVoice) proxy.searchParams.set("voz", selectedVoice);
          return proxy;
        }

        const upstream = TTS_BASE_URL.startsWith("http")
          ? new URL(TTS_BASE_URL)
          : new URL(TTS_BASE_URL, window.location.origin);
        upstream.searchParams.set("texto", text);
        if (selectedVoice) upstream.searchParams.set("voz", selectedVoice);

        return upstream;
      } catch (error) {
        console.warn("Não foi possível construir a URL da API de TTS", error);
        return null;
      }
    };

    const extractString = (value: unknown) => {
      if (typeof value !== "string") {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const normalizeIdentifier = (value: string | null | undefined) => {
      if (typeof value !== "string") {
        return "";
      }
      return value.trim().toLowerCase();
    };

    const playBalanceSpeech = (payload: NotificationCreatedEvent) => {
      const rawMetadata = (payload?.metadata as Record<string, unknown>) ?? {};
      const amountValue = Number(rawMetadata.amount);
      const hasValidAmount = Number.isFinite(amountValue);

      const customerName = extractString(rawMetadata.customerName);
      const customerWhatsapp = extractString(rawMetadata.customerWhatsapp);
      const speakerLabel = customerName || customerWhatsapp || "Seu cliente";

      const formattedAmount = hasValidAmount ? formatCurrency(amountValue) : null;
      const balanceAfterRaw = Number(rawMetadata.customerBalanceAfter);
      const balanceLabel = Number.isFinite(balanceAfterRaw) ? formatCurrency(balanceAfterRaw) : null;
      const balanceText = balanceLabel ? `Saldo atual: ${balanceLabel}` : "";
      const fallbackSentence = formattedAmount
        ? balanceLabel
          ? `${speakerLabel} adicionou ${formattedAmount} no bot ${resolveBotName()}. Saldo atual: ${balanceLabel}.`
          : `${speakerLabel} adicionou ${formattedAmount} no bot ${resolveBotName()}.`
        : balanceLabel
          ? `${speakerLabel} adicionou saldo no bot ${resolveBotName()}. Saldo atual: ${balanceLabel}.`
          : `${speakerLabel} adicionou saldo no bot ${resolveBotName()}.`;

      const message = buildSpeechMessage(
        audioSettingsRef.current.balanceTemplate,
        voiceDefaultsRef.current.balanceTemplate,
        {
          bot_name: resolveBotName(),
          customer_name: speakerLabel,
          amount: formattedAmount ?? "",
          balance: balanceLabel ?? "",
          balance_text: balanceText,
        },
        fallbackSentence,
      );

      if (!message) {
        return;
      }

      try {
        const dedupeKey = `balance:${payload.id}`;
        log("balance notification", { text: message, amount: formattedAmount, dedupeKey });
        enqueueSpeech(message, dedupeKey, formattedAmount ? 120 : 240);
      } catch (error) {
        console.error("Falha ao enfileirar áudio de crédito", error);
      }
    };

    const buildPurchaseAnnouncement = (data: {
      customerName: string | null;
      customerWhatsapp: string | null;
      categoryName: string | null;
      productDetails: string | null;
    }) => {
      const normalizedCustomerWhatsapp = extractString(data.customerWhatsapp);
      const normalizedCustomerName = extractString(data.customerName);
      const customerLabel = normalizedCustomerName
        || normalizedCustomerWhatsapp
        || "Seu cliente";

      const productLabel = extractString(data.categoryName)
        || extractString(data.productDetails)
        || "produto";

      const fallback = productLabel && productLabel !== "produto"
        ? `${customerLabel} comprou ${productLabel} no bot ${resolveBotName()}.`
        : `${customerLabel} realizou uma compra no bot ${resolveBotName()}.`;

      const message = buildSpeechMessage(
        audioSettingsRef.current.purchaseTemplate,
        voiceDefaultsRef.current.purchaseTemplate,
        {
          bot_name: resolveBotName(),
          category_name: productLabel,
          customer_name: customerLabel,
        },
        fallback,
      );

      const key = [
        normalizeIdentifier(normalizedCustomerWhatsapp || normalizedCustomerName || customerLabel),
        normalizeIdentifier(productLabel),
        resolveVoiceId(),
      ].join("|");

      return { message, key };
    };

    const announcePurchase = (data: {
      customerName: string | null;
      customerWhatsapp: string | null;
      categoryName: string | null;
      productDetails: string | null;
      coinAudio?: HTMLAudioElement | null;
    }) => {
      const { message, key } = buildPurchaseAnnouncement(data);

      log("purchase event", {
        message,
        customerName: data.customerName,
        customerWhatsapp: data.customerWhatsapp,
        categoryName: data.categoryName,
      });

      // Play a dedicated one-shot so it won't be cut by other events
      void playOneShotWithFallback(
        data.coinAudio ?? purchaseAudioRef.current,
        [generalAudioRef.current]
      ).then((ok) => {
        log("purchase sound", ok ? "played" : "blocked", { key, hasSpeech: Boolean(message) });
        // If sound ended ok, start TTS right after; otherwise, small fallback delay
        const delay = ok ? 60 : 700;
        enqueueSpeech(message, key, delay);
      });
    };

    const announceRaffleNotification = (payload: NotificationCreatedEvent) => {
      if (sseRoleRef.current === "admin") {
        return;
      }

      const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
      const raffleName = extractString(metadata.raffleName)
        || extractString(metadata.categoryName)
        || "sua rifa";
      const customerName = extractString(metadata.customerName);
      const customerWhatsapp = extractString(metadata.customerWhatsapp);
      const customerLabel = customerName || customerWhatsapp || "Seu cliente";

      const quantityRaw = Number(metadata.ticketQuantity ?? metadata.quantity ?? metadata.tickets);
      const ticketQuantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? String(quantityRaw) : "";

      const numbersSource = metadata.ticketNumbers ?? metadata.numbers;
      const ticketNumbers = Array.isArray(numbersSource)
        ? numbersSource
            .map((entry) => Number(entry))
            .filter((entry) => Number.isFinite(entry))
            .sort((a, b) => a - b)
        : [];
      const ticketNumbersLabel = ticketNumbers.length ? ticketNumbers.join(", ") : "";
      const ticketNumbersPhrase = ticketNumbersLabel ? ` com os números ${ticketNumbersLabel}` : "";
      const quantityLabel = ticketQuantity
        ? `${ticketQuantity} número${ticketQuantity === "1" ? "" : "s"}`
        : "novos números";

      const fallbackSentence = `${customerLabel} garantiu ${quantityLabel} na rifa ${raffleName}${ticketNumbersPhrase}.`;

      const message = buildSpeechMessage(
        audioSettingsRef.current.raffleTemplate,
        voiceDefaultsRef.current.raffleTemplate ?? DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
        {
          bot_name: resolveBotName(),
          customer_name: customerLabel,
          raffle_name: raffleName,
          ticket_quantity: ticketQuantity,
          ticket_numbers: ticketNumbersLabel,
          ticket_numbers_phrase: ticketNumbersPhrase,
        },
        fallbackSentence,
      );

      const dedupeKey = `raffle:${payload.id}`;
      playCoin(purchaseAudioRef.current ?? generalAudioRef.current, dedupeKey);
      enqueueSpeech(message, dedupeKey, ticketNumbers.length ? 80 : 160);
    };

    const announcePlanNotification = (payload: NotificationCreatedEvent) => {
      const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
      const isAdminNotification =
        payload.type === "admin_plan_payment"
        || payload.type === "admin_plan_addon"
        || payload.type === "admin_api_request_package";
      const isApiNotification =
        payload.type === "api_request_package" || payload.type === "admin_api_request_package";

      const planName =
        extractString(metadata.planName as string)
        || extractString(metadata.plan_name as string)
        || extractString(metadata.packageLabel as string)
        || (isApiNotification ? "pacote de requisições" : "plano");
      const planLabel = planName.toLowerCase().startsWith("plano ")
        ? planName
        : isApiNotification
          ? planName
          : `plano ${planName}`;

      const buyerName =
        extractString(metadata.buyerName)
        || extractString(metadata.customerName as string)
        || extractString(metadata.buyerEmail as string)
        || (isAdminNotification ? "Cliente" : "Você");

      const amountValue = Number(metadata.amount);
      let amountLabel =
        Number.isFinite(amountValue) && amountValue > 0 ? formatCurrency(amountValue) : null;
      if (!amountLabel) {
        amountLabel =
          extractString(metadata.amountLabel as string)
          || extractString(metadata.amount as string)
          || "";
      }

      const requestValue = Number(
        metadata.requestAmount ?? metadata.requests ?? metadata.quantity,
      );
      const requestLabel =
        Number.isFinite(requestValue) && requestValue > 0
          ? Math.floor(requestValue).toLocaleString("pt-BR")
          : extractString(metadata.requestLabel as string) || "";

      const fallbackSentence = (() => {
        if (isApiNotification) {
          if (requestLabel) {
            return `${buyerName} recebeu ${requestLabel} requisições no pacote ${planName}.`;
          }
          return `${buyerName} teve o limite de API atualizado (${planName}).`;
        }
        return amountLabel
          ? `${buyerName} comprou ${planLabel} no valor de ${amountLabel}.`
          : `${buyerName} comprou ${planLabel}.`;
      })();

      const message = buildSpeechMessage(
        audioSettingsRef.current.planTemplate,
        voiceDefaultsRef.current.planTemplate ?? DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
        {
          bot_name: resolveBotName(),
          buyer_name: buyerName,
          plan_name: planName,
          amount: amountLabel ?? "",
          requests: requestLabel,
        },
        fallbackSentence,
      )
        .replace(/\bo\s+plano\s+plano\b/gi, "o plano")
        .replace(/\bplano\s+plano\b/gi, "plano")
        .replace(/\bassinar\s+o\s+plano\b/gi, "comprou o plano");

      const dedupeKey = `${isApiNotification ? "api-plan" : "plan"}:${payload.id}`;
      const isAdminRole = sseRoleRef.current === "admin";
      const shouldPlayAudio = !(isAdminNotification && isAdminRole);
      if (shouldPlayAudio) {
        playCoin(generalAudioRef.current ?? purchaseAudioRef.current, dedupeKey);
        const delay = amountLabel || requestLabel ? 90 : 180;
        enqueueSpeech(message, dedupeKey, delay);
      }
    };

    const disconnectStream = () => {
      log("disconnecting streams");
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (sseRef.current) {
        try {
          sseRef.current.close();
        } catch {}
        sseRef.current = null;
      }
      sseRoleRef.current = null;
      audioPermissionRef.current = false;
      if (removePrimeListeners) {
        removePrimeListeners();
        removePrimeListeners = null;
      }
    };

    const connect = (role?: string | null) => {
      if (sseRef.current) {
        return;
      }

      const currentRole = role ?? authStateRef.current.role ?? null;
      const targetPath = currentRole === "admin" ? ADMIN_SSE_PATH : USER_SSE_PATH;

      const es = new EventSource(targetPath, { withCredentials: true });
      sseRef.current = es;
      sseRoleRef.current = currentRole;
      log("SSE connecting", targetPath, { role: currentRole });

      es.addEventListener("support:message-created", (event: MessageEvent) => {
        try {
          const raw = JSON.parse(event.data) as any;
          const rawMessage = raw?.message ?? null;
          const whatsappId: string = typeof raw?.whatsappId === "string"
            ? raw.whatsappId.trim()
            : typeof rawMessage?.whatsappId === "string"
              ? rawMessage.whatsappId.trim()
              : "";
          if (!whatsappId || !rawMessage) {
            return;
          }

          const current = sseRoleRef.current;
          const userId = typeof raw?.userId === "number" ? raw.userId : undefined;

          const originalDirection = rawMessage?.direction === "outbound" ? "outbound" : "inbound";
          const direction = current === "admin"
            ? (originalDirection === "inbound" ? "outbound" : "inbound")
            : originalDirection;

          const senderRole =
            rawMessage?.senderRole === "admin" ||
            rawMessage?.senderRole === "contact" ||
            rawMessage?.senderRole === "system"
              ? rawMessage.senderRole
              : "user";

          const message = {
            id: Number.isFinite(Number(rawMessage?.id)) ? Number(rawMessage.id) : Date.now(),
            direction,
            messageType: typeof rawMessage?.messageType === "string" ? rawMessage.messageType : "text",
            text: typeof rawMessage?.text === "string" ? rawMessage.text : null,
            timestamp:
              typeof rawMessage?.timestamp === "string" && rawMessage.timestamp.trim()
                ? rawMessage.timestamp
                : new Date().toISOString(),
            senderUserId: Number.isFinite(Number(rawMessage?.senderUserId)) ? Number(rawMessage.senderUserId) : null,
            senderRole,
          } satisfies SupportMessagePayload["message"];

          const payload: SupportMessagePayload = {
            userId,
            whatsappId,
            message,
          };

          log("sse support:message-created", payload);

          window.dispatchEvent(
            new CustomEvent("support:message-created", { detail: payload }),
          );

          const authState = authStateRef.current;
          const isCurrentUserSupportEvent =
            current === "user" &&
            (userId == null || (authState.userId != null && userId === authState.userId));
          const shouldPlayInbound = isCurrentUserSupportEvent && originalDirection === "inbound";

          if (shouldPlayInbound) {
            const conversationActive = isSupportConversationActive(payload.whatsappId);
            const queue = buildSupportAudioQueue(payload.whatsappId, payload.message.messageType);
            const [primary, ...fallbacks] = queue;
            // Sempre reproduz o som adequado; dentro da conversa será support-reply.mp3
            void playOneShotWithFallback(primary ?? null, fallbacks);

            // Não criar notificação/unread quando a conversa estiver aberta
            if (!conversationActive) {
              incrementCount(payload.whatsappId);
            }

            window.dispatchEvent(
              new CustomEvent("support:new-inbound", {
                detail: {
                  whatsappId: payload.whatsappId,
                  messageId: payload.message.id,
                  userId: payload.userId,
                },
              }),
            );
          } else {
            const messageId = payload.message?.id;
            const numericId = typeof messageId === "number" ? messageId : Number(messageId);
            const messageKey = Number.isFinite(numericId)
              ? `${payload.whatsappId}:${numericId}`
              : null;

            if (messageKey) {
              const outboundMap = localOutboundRef.current;
              const now = Date.now();
              // Cleanup outdated markers
              outboundMap.forEach((value, key) => {
                if (now - value > 60000) {
                  outboundMap.delete(key);
                }
              });

              if (outboundMap.has(messageKey)) {
                outboundMap.delete(messageKey);
                return;
              }
            }

            // Mensagens enviadas não geram alerta/notificação local. O evento só
            // mantém outras telas sincronizadas sem tocar som no navegador.
            const conversationActive = isSupportConversationActive(payload.whatsappId);
            if (!conversationActive && isCurrentUserSupportEvent) {
              window.dispatchEvent(
                new CustomEvent("support:new-outbound", {
                  detail: {
                    whatsappId: payload.whatsappId,
                    messageId: payload.message.id,
                    userId: payload.userId,
                  },
                }),
              );
            }
          }
        } catch (error) {
          if (DEBUG_NOTIFICATIONS) { try { console.debug("Falha ao processar evento de suporte", error); } catch {} }
        }
      });

      es.addEventListener("support:thread-updated", (event: MessageEvent) => {
        try {
          const raw = JSON.parse(event.data) as any;
          const base = raw && typeof raw === "object" && "thread" in raw && raw.thread
            ? raw.thread
            : raw;
          if (!base || typeof base !== "object") {
            return;
          }

          const detail = {
            whatsappId: typeof base.whatsappId === "string" ? base.whatsappId : "",
            customerName: base.customerName ?? null,
            profileName: base.profileName ?? null,
            lastMessagePreview: base.lastMessagePreview ?? null,
            lastMessageAt: base.lastMessageAt ?? null,
            status: base.status === "closed" ? "closed" : "open",
            within24h: base.within24h ?? undefined,
            minutesLeft24h: base.minutesLeft24h ?? undefined,
            userId: typeof raw?.userId === "number" ? raw.userId : undefined,
            isAdminThread: base.isAdminThread ?? undefined,
          };

          log("sse support:thread-updated", detail);

          window.dispatchEvent(
            new CustomEvent("support:thread-updated", { detail }),
          );

        } catch (error) {
          if (DEBUG_NOTIFICATIONS) { try { console.debug("Falha ao processar atualização de thread", error); } catch {} }
        }
      });

      es.addEventListener("purchase:created", (event: MessageEvent) => {
        if (sseRoleRef.current === "admin") {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as PurchaseCreatedEvent;
          log("sse purchase:created", payload);

          announcePurchase({
            customerName: payload.customerName,
            customerWhatsapp: payload.customerWhatsapp,
            categoryName: payload.categoryName,
            productDetails: payload.productDetails ?? null,
            coinAudio: purchaseAudioRef.current,
          });

          window.dispatchEvent(
            new CustomEvent("purchase:created", { detail: payload }),
          );
        } catch (error) {
          if (DEBUG_NOTIFICATIONS) { try { console.debug("Falha ao processar evento de compra", error); } catch {} }
        }
      });

      es.addEventListener("notification:created", (event: MessageEvent) => {
        try {
          const raw = JSON.parse(event.data) as any;
          const rawUserId = Number(raw?.userId);
          const eventUserId = Number.isFinite(rawUserId) && rawUserId > 0 ? rawUserId : null;
          const payloadSource =
            raw && typeof raw === "object" && raw.notification && typeof raw.notification === "object"
              ? raw.notification
              : raw;
          const payload = payloadSource as NotificationCreatedEvent;
          if (!payload || typeof payload.id !== "number") {
            return;
          }
          if (eventUserId != null && eventUserId !== authStateRef.current.userId) {
            return;
          }
          log("sse notification:created", payload);

          const currentRole = sseRoleRef.current;
          const isAdminRole = currentRole === "admin";
          const metadata = (payload.metadata ?? {}) as Record<string, unknown>;

          let handled = false;

          if (payload.type === "customer_balance_credit") {
            const coinKey = `balance:${payload.id}`;
            playCoin(balanceAudioRef.current ?? purchaseAudioRef.current, coinKey);
            playBalanceSpeech(payload);
            handled = true;
          } else if (payload.type === "bot_purchase") {
            const isRaffle = Boolean(
              metadata?.raffle === true ||
                metadata?.raffleTitle ||
                metadata?.raffle_name ||
                metadata?.ticketNumbers ||
                metadata?.ticketQuantity,
            );

            if (isRaffle) {
              if (!isAdminRole) {
                announceRaffleNotification(payload);
              }
              handled = true;
            } else if (!isAdminRole) {
              void playOneShotWithFallback(generalAudioRef.current, [purchaseAudioRef.current]);
              handled = true;
            }
          } else if (
            payload.type === "plan_payment" ||
            payload.type === "admin_plan_payment" ||
            payload.type === "admin_plan_addon" ||
            payload.type === "api_request_package" ||
            payload.type === "admin_api_request_package"
          ) {
            announcePlanNotification(payload);
            handled = true;
          }

          if (!handled && !isAdminRole) {
            void playOneShotWithFallback(generalAudioRef.current, [purchaseAudioRef.current]);
          }

          window.dispatchEvent(
            new CustomEvent("notification:created", { detail: payload }),
          );
        } catch (error) {
          if (DEBUG_NOTIFICATIONS) { try { console.debug("Falha ao processar notificação", error); } catch {} }
        }
      });

      es.addEventListener("open", () => {
        if (reconnectRef.current) {
          clearTimeout(reconnectRef.current);
          reconnectRef.current = null;
        }
        log("SSE connected");
      });

      es.onerror = () => {
        log("SSE error - scheduling reconnect");
        disconnectStream();
        if (!reconnectRef.current) {
          reconnectRef.current = window.setTimeout(() => {
            reconnectRef.current = null;
            void attemptConnection(true);
          }, RECONNECT_DELAY);
        }
        scheduleAuthCheck(AUTH_RETRY_DELAY_MS);
      };
    };
    function scheduleAuthCheck(delay = AUTH_RETRY_DELAY_MS) {
      clearAuthTimer();
      authCheckTimerRef.current = window.setTimeout(() => {
        void attemptConnection();
      }, delay);
    }

    async function attemptConnection(force = false) {
      const { canListen, role } = await ensureAuthInfo();
      log("auth state", { canListen, role });

      if (!canListen) {
        disconnectStream();
        const delay = role ? Math.max(AUTH_CONNECTED_CHECK_MS, 45000) : AUTH_RETRY_DELAY_MS;
        scheduleAuthCheck(delay);
        return;
      }

      audioPermissionRef.current = true;
      log("audio permission enabled");
      ensurePrimeListeners();
      broadcastAudioStatus();

      // Agora que usuário pode escutar, sincroniza defaults e preferências remotas
      void syncAudioDefaults();

      if (sseRef.current && !force) {
        if (sseRoleRef.current === role) {
          scheduleAuthCheck(AUTH_CONNECTED_CHECK_MS);
          return;
        }
        disconnectStream();
      }

      connect(role);
      requestAudioPriming();
      scheduleAuthCheck(AUTH_CONNECTED_CHECK_MS);
    }

    void attemptConnection();

    window.setTimeout(() => {
      requestAudioPriming();
      broadcastAudioStatus();
    }, 750);

    writeCounts(readCounts());

    window.addEventListener("support:outbound-sent", handleLocalOutboundSent as EventListener);

    const handleThreadOpened = (event: Event) => {
      const detail = (event as CustomEvent<{ whatsappId?: string; userId?: number }>).detail;
      const whatsappId = detail?.whatsappId ?? null;
      activeSupportThreadRef.current = whatsappId;
      if (!whatsappId) {
        return;
      }
      if (sseRoleRef.current !== "admin") {
        clearCount(whatsappId);
      }
    };

    window.addEventListener("support:thread-opened", handleThreadOpened as EventListener);

    const activeOneShots = activeOneShotsRef.current;
    const activeBufferSources = activeBufferSourcesRef.current;

    return () => {
      clearAuthTimer();
      authStateRef.current = { status: "unknown", role: null, userId: null };
      activeSupportThreadRef.current = null;
      disconnectStream();
      if (removePrimeListeners) {
        removePrimeListeners();
        removePrimeListeners = null;
      }
      supportOpenAudioRef.current?.pause();
      supportOpenAudioRef.current = null;
      supportReplyAudioRef.current?.pause();
      supportReplyAudioRef.current = null;
      purchaseAudioRef.current?.pause();
      purchaseAudioRef.current = null;
      balanceAudioRef.current?.pause();
      balanceAudioRef.current = null;
      generalAudioRef.current?.pause();
      generalAudioRef.current = null;
      if (speechAudioRef.current) {
        speechAudioRef.current.pause();
        speechAudioRef.current = null;
      }
      // Stop any one-shot clones still playing
      try {
        activeOneShots.forEach((el) => {
          try { el.pause(); } catch {}
        });
      } finally {
        activeOneShots.clear();
      }
      // Stop WebAudio sources
      try {
        activeBufferSources.forEach((src) => {
          try { src.stop(); } catch {}
        });
      } finally {
        activeBufferSources.clear();
      }
      if (currentSpeechUrlRef.current) {
        URL.revokeObjectURL(currentSpeechUrlRef.current);
        currentSpeechUrlRef.current = null;
      }
      speechQueueRef.current = [];
      isProcessingSpeechRef.current = false;
      recentCoinKeysRef.current = {};
      recentSpeechKeysRef.current = {};
      window.removeEventListener("support:outbound-sent", handleLocalOutboundSent as EventListener);
      window.removeEventListener("support:thread-opened", handleThreadOpened as EventListener);
      window.removeEventListener("notifications:audio-settings", handleAudioSettingsChange as EventListener);
      log("listener disposed");
    };
  }, []);

  return null;
};

export default SupportNotificationListener;
