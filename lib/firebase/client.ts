import { initializeApp, getApp, getApps } from "firebase/app";
import { getMessaging, isSupported, Messaging } from "firebase/messaging";

import { getFirebasePublicConfig, getFirebaseWebPushConfig } from "./config";

let messagingPromise: Promise<Messaging | null> | null = null;

const hasValidConfig = (config: ReturnType<typeof getFirebasePublicConfig>) =>
  Boolean(config.apiKey && config.appId && config.messagingSenderId);

const loadPublicConfig = async () => {
  // Start from env
  let cfg = getFirebasePublicConfig();
  // Always attempt to load from admin endpoint on the client and prefer it
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/config/firebase/public", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data?.config) {
          // Prefer values from admin when present
          cfg = { ...cfg, ...data.config };
        }
      }
    } catch {
      // ignore
    }
  }
  return cfg;
};

export const getFirebaseApp = async () => {
  const config = await loadPublicConfig();
  if (!hasValidConfig(config)) {
    throw new Error(
      "Configuração do Firebase Web ausente. Defina NEXT_PUBLIC_FIREBASE_* ou cadastre no painel.",
    );
  }
  if (getApps().length > 0) return getApp();
  return initializeApp(config);
};

export const getFirebaseMessaging = async (): Promise<Messaging | null> => {
  if (typeof window === "undefined") return null;
  if (messagingPromise) return messagingPromise;

  messagingPromise = (async () => {
    const config = await loadPublicConfig();
    if (!hasValidConfig(config)) {
      console.warn("Firebase Web não configurado. Pulei registro de push.");
      return null;
    }

    const supported = await isSupported().catch(() => false);
    if (!supported) return null;

    const app = await getFirebaseApp();
    try {
      return getMessaging(app);
    } catch {
      return null;
    }
  })();

  return messagingPromise;
};

export const getFirebaseWebPushOptions = async () => {
  // Start from env
  let vapid = getFirebaseWebPushConfig().vapidKey ?? "";
  // Prefer admin-configured key when available in the browser
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/config/firebase/public", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.vapidKey === "string" && data.vapidKey.trim()) {
          vapid = data.vapidKey.trim();
        }
      }
    } catch {
      // ignore
    }
  }
  return { vapidKey: vapid };
};

