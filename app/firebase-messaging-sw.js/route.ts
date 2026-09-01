import { NextResponse } from "next/server";

import { getFirebasePublicConfig } from "lib/firebase/config";
import { getAdminFirebaseSettings } from "lib/admin-firebase";
import { getAdminSiteSettings } from "lib/admin-site";

export const dynamic = "force-dynamic";

const FIREBASE_SW_VERSION = "10.13.1";

type FirebasePublicConfig = ReturnType<typeof getFirebasePublicConfig>;

const buildServiceWorker = async () => {
  // Prefer admin-configured settings when available, fallback to env
  const fallback = getFirebasePublicConfig();
  let config: FirebasePublicConfig = fallback;
  let hasConfig = Boolean(config.apiKey && config.appId && config.messagingSenderId);

  try {
    const settings = await getAdminFirebaseSettings();
    if (settings) {
      config = {
        apiKey: settings.webApiKey ?? fallback.apiKey ?? "",
        authDomain: settings.webAuthDomain ?? fallback.authDomain ?? "",
        projectId: settings.webProjectId ?? settings.projectId ?? fallback.projectId ?? "",
        storageBucket: settings.webStorageBucket ?? fallback.storageBucket ?? "",
        messagingSenderId: settings.webMessagingSenderId ?? fallback.messagingSenderId ?? "",
        appId: settings.webAppId ?? fallback.appId ?? "",
        measurementId: settings.webMeasurementId ?? fallback.measurementId ?? "",
      };
      hasConfig = Boolean(config.apiKey && config.appId && config.messagingSenderId);
    }
  } catch {}

  if (!hasConfig) {
    return "self.addEventListener('install', () => {\n  console.warn('Firebase Messaging não configurado.');\n});";
  }

  const site = await getAdminSiteSettings().catch(() => null);
  const defaultIcon = (site?.mobileAppIconUrl || site?.logoUrl || "/images/brand/logo/logo-icon.svg");

  const serializedConfig = JSON.stringify(config);
  const lines: string[] = [
    `importScripts('https://www.gstatic.com/firebasejs/${FIREBASE_SW_VERSION}/firebase-app-compat.js');`,
    `importScripts('https://www.gstatic.com/firebasejs/${FIREBASE_SW_VERSION}/firebase-messaging-compat.js');`,
    '',
    `const firebaseConfig = ${serializedConfig};`,
    '',
    "if (!firebase.apps.length) {",
    "  firebase.initializeApp(firebaseConfig);",
    "}",
    '',
    "const messaging = firebase.messaging();",
    '',
    `const DEFAULT_ICON = ${JSON.stringify(defaultIcon)};`,
    '',
    "messaging.onBackgroundMessage(function(payload) {",
    "  // Evita notificações duplicadas: se o payload já tiver 'notification',",
    "  // deixe o navegador exibir automaticamente e não chame showNotification de novo.",
    "  if (payload && payload.notification && (payload.notification.title || payload.notification.body || payload.notification.icon)) {",
    "    return;",
    "  }",
    "  const title = (payload && payload.data && payload.data.storebot_title) || 'StoreBot';",
    "  const options = {",
    "    body: (payload && payload.data && payload.data.storebot_body) || '',",
    "    icon: DEFAULT_ICON,",
    "    data: (payload && payload.data) || {},",
    "  };",
    "  self.registration.showNotification(title, options);",
    "});",
    '',
    "self.addEventListener('notificationclick', function(event) {",
    "  event.notification.close();",
    "  const targetUrl = event.notification?.data?.targetUrl || '/';",
    "  event.waitUntil(",
    "    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {",
    "      for (const client of clientList) {",
    "        if (client.url.includes(targetUrl) && 'focus' in client) {",
    "          return client.focus();",
    "        }",
    "      }",
    "      if (self.clients.openWindow) {",
    "        return self.clients.openWindow(targetUrl);",
    "      }",
    "    })",
    "  );",
    "});",
  ];

  return lines.join("\n");
};

export async function GET() {
  const script = await buildServiceWorker();
  return new NextResponse(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
