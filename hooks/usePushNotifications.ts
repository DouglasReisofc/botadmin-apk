"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { getToken, onMessage } from "firebase/messaging";

import { getFirebaseMessaging, getFirebaseWebPushOptions } from "lib/firebase/client";
import type { PushPlatform } from "lib/push-notifications";

const DEBUG_NOTIFICATIONS = (process.env.NEXT_PUBLIC_DEBUG_NOTIFICATIONS || "").trim().toLowerCase() === "true";

const API_ENDPOINT = "/api/notifications/push/token";
const STORAGE_KEY = "sb_push_token";
const OWNER_STORAGE_KEY = "sb_push_token_owner";

type PushSessionSnapshot = {
  id: number;
  role: "admin" | "user";
};

const readCurrentPushSession = async (): Promise<PushSessionSnapshot | null> => {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json().catch(() => null);
    const rawUserId = Number(data?.user?.id);
    const role = data?.user?.role;
    if (!Number.isFinite(rawUserId) || rawUserId <= 0) {
      return null;
    }
    if (role !== "admin" && role !== "user") {
      return null;
    }
    return { id: rawUserId, role };
  } catch {
    return null;
  }
};

const parsePayloadUserId = (...values: unknown[]): number | null => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const shouldDisplayForegroundNotification = (
  data: Record<string, string> | undefined,
  session: PushSessionSnapshot | null,
): boolean => {
  if (!session) {
    return false;
  }

  const type = typeof data?.type === "string" ? data.type : "";
  if (type === "support_admin_message") {
    return false;
  }

  const targetUserId = parsePayloadUserId(
    data?.target_user_id,
    data?.targetUserId,
    data?.notification_user_id,
    data?.notificationUserId,
  );
  if (targetUserId != null && targetUserId !== session.id) {
    return false;
  }

  const targetRoleRaw = (data?.target_role || data?.targetRole || "").toLowerCase();
  if ((targetRoleRaw === "admin" || targetRoleRaw === "user") && targetRoleRaw !== session.role) {
    return false;
  }

  const targetUrl = data?.target_url || data?.targetUrl || "";
  if (targetUrl.includes("/dashboard/admin") && session.role !== "admin") {
    return false;
  }
  if (targetUrl.includes("/dashboard/user") && session.role !== "user") {
    return false;
  }

  return true;
};

const registerToken = async (
  token: string,
  platform: PushPlatform,
  session?: PushSessionSnapshot | null,
) => {
  try {
    const payload = { token, platform };
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message = data?.message ?? "Falha ao registrar token de push.";
      console.error(message);
    } else {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, token);
        if (session) {
          localStorage.setItem(OWNER_STORAGE_KEY, `${session.id}:${session.role}`);
        }
      }
    }
  } catch (error) {
    console.error("Erro ao registrar token de push", error);
  }
};

const setupNativePush = async () => {
  const permissionStatus = await PushNotifications.checkPermissions();

  if (permissionStatus.receive !== "granted") {
    const request = await PushNotifications.requestPermissions();
    if (request.receive !== "granted") {
      console.warn("Permissão de push negada no dispositivo.");
      return () => {};
    }
  }

  await PushNotifications.register();

  const registrationListener = await PushNotifications.addListener(
    "registration",
    ({ value }) => {
      if (value) {
        const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";
        registerToken(value, platform);
      }
    },
  );

  const errorListener = await PushNotifications.addListener("registrationError", (error) => {
    console.error("Erro ao registrar push nativo", error);
  });

  const receivedListener = await PushNotifications.addListener(
    "pushNotificationReceived",
    (notification) => {
      if (DEBUG_NOTIFICATIONS) {
        try { console.debug("Push recebido", notification); } catch {}
      }
    },
  );

  const actionListener = await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (event) => {
      try {
        const data: any = (event?.notification as any)?.data || {};
        const target = typeof data?.target_url === "string" && data.target_url.trim()
          ? data.target_url.trim()
          : "/dashboard/user";
        const whatsappId = typeof data?.whatsappId === "string" && data.whatsappId.trim()
          ? data.whatsappId.trim()
          : (typeof data?.target_whatsapp_id === "string" ? data.target_whatsapp_id.trim() : "");
        const notifIdRaw = (data?.notificationId ?? data?.notification_id);
        const notificationId = typeof notifIdRaw === "string" ? parseInt(notifIdRaw, 10) : (typeof notifIdRaw === "number" ? notifIdRaw : 0);

        if (whatsappId) {
          try { sessionStorage.setItem("support:target-thread", whatsappId); } catch {}
        }
        if (notificationId) {
          try { sessionStorage.setItem("notifications:open-id", String(notificationId)); } catch {}
        }
        if (typeof window !== "undefined" && target) {
          window.location.href = target;
        }
      } catch (err) {
        console.error("Falha ao processar ação de notificação", err);
      }
    },
  );

  return async () => {
    await registrationListener.remove();
    await errorListener.remove();
    await receivedListener.remove();
    await actionListener.remove();
  };
};

const setupWebPush = async () => {
  if (typeof window === "undefined") {
    return () => {};
  }

  // Evita ruído e erros de credencial em ambiente de desenvolvimento.
  // Web Push do Firebase exige origem HTTPS válida e credenciais
  // configuradas no Console do Firebase para o domínio. Em `npm run dev`,
  // geralmente rodamos em hosts locais/sem HTTPS e a API retorna 401.
  if (process.env.NODE_ENV !== "production") {
    try {
      console.info("Push web desativado no modo dev. Pulei registro de FCM.");
    } catch {}
    return () => {};
  }

  if (!("Notification" in window)) {
    console.warn("API de notificações não suportada pelo navegador.");
    return () => {};
  }

  let activeSession = await readCurrentPushSession();
  if (!activeSession) {
    return () => {};
  }
  const existingOwner = typeof localStorage !== "undefined" ? localStorage.getItem(OWNER_STORAGE_KEY) : null;

  if (Notification.permission === "denied") {
    console.warn("Permissão de push negada pelo usuário.");
    return () => {};
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("Permissão de push não concedida.");
      return () => {};
    }
  }

  if (!("serviceWorker" in navigator)) {
    console.warn("Service workers não são suportados neste navegador.");
    return () => {};
  }

  const registration = await navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .catch((error) => {
      console.error("Falha ao registrar service worker do Firebase", error);
      return null;
    });

  if (!registration) {
    return () => {};
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return () => {};
  }

  const { vapidKey } = await getFirebaseWebPushOptions();
  if (!vapidKey) {
    console.warn("VAPID key não configurada (NEXT_PUBLIC_FIREBASE_VAPID_KEY).");
    return () => {};
  }

  try {
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.warn("Firebase não retornou token de push web.");
    } else {
      const currentOwner = `${activeSession.id}:${activeSession.role}`;
      if (existingOwner !== currentOwner) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
      }
      await registerToken(token, "web", activeSession);
    }
  } catch (error) {
    // Em produção, se ainda assim falhar (ex.: credenciais incorretas),
    // não interrompe o app: apenas registra aviso e segue sem push.
    console.warn("Falha ao obter token de push web (FCM)", error);
  }

  const unsubscribe = onMessage(messaging, async (payload) => {
    const currentSession = await readCurrentPushSession();
    if (currentSession) {
      activeSession = currentSession;
    }
    if (!shouldDisplayForegroundNotification(payload.data, currentSession ?? activeSession)) {
      if (DEBUG_NOTIFICATIONS) {
        try { console.debug("Push web ignorado por nao pertencer a sessao atual", payload.data); } catch {}
      }
      return;
    }
    const title = payload.notification?.title ?? "Nova notificação";
    const body = payload.notification?.body ?? "";

    if (Notification.permission === "granted") {
      new Notification(title, {
        body,
        data: payload.data,
      });
    }
  });

  return async () => {
    unsubscribe();
  };
};

export const usePushNotifications = () => {
  const cleanupRef = useRef<(() => void | Promise<void>) | null>(null);

  useEffect(() => {
    let isMounted = true;

    const setup = async () => {
      try {
        const cleanup = await (Capacitor.isNativePlatform() ? setupNativePush() : setupWebPush());
        if (isMounted) {
          cleanupRef.current = cleanup;
        } else if (cleanup) {
          await cleanup();
        }
      } catch (error) {
        console.error("Falha ao inicializar push notifications", error);
      }
    };

    setup();

    return () => {
      isMounted = false;
      if (cleanupRef.current) {
        const result = cleanupRef.current();
        if (result instanceof Promise) {
          result.catch((error) => console.error("Erro ao limpar listeners de push", error));
        }
      }
    };
  }, []);
};
