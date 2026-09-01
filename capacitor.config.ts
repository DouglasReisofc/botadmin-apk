import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "fs";
import path from "path";

// Ensure .env variables are available when running `cap sync` directly
try {
  const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");
    if (process.env[k] == null) process.env[k] = v;
  }
} catch {
  // ignore if .env is not present
}

const resolveServerUrl = () => {
  const a = process.env.NEXT_PUBLIC_CAP_SERVER_URL?.trim();
  const b = process.env.APP_URL?.trim();
  const raw = a || b || "";
  return raw || undefined;
};

const serverUrl = resolveServerUrl();

const config: CapacitorConfig = {
  appId: process.env.APP_ID?.trim() || process.env.APP_PACKAGE?.trim() || "com.botadmin.shop",
  appName: process.env.APP_NAME?.trim() || "Bot Admin",
  webDir: "dist/mobile",
  bundledWebRuntime: false,
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
