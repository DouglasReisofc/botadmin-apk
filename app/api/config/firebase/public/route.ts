import { NextResponse } from "next/server";

import { getFirebasePublicConfig, getFirebaseWebPushConfig } from "lib/firebase/config";
import { ensureAdminFirebaseSettingsTable } from "lib/db";
import { getAdminFirebaseSettings } from "lib/admin-firebase";

export async function GET() {
  // Load env defaults
  const envConfig = getFirebasePublicConfig();
  const envWebPush = getFirebaseWebPushConfig();

  // Try admin settings and prefer them when present
  await ensureAdminFirebaseSettingsTable();
  const admin = await getAdminFirebaseSettings().catch(() => null);

  const config = {
    apiKey: admin?.webApiKey ?? envConfig.apiKey ?? "",
    authDomain: admin?.webAuthDomain ?? envConfig.authDomain ?? "",
    projectId: admin?.webProjectId ?? admin?.projectId ?? envConfig.projectId ?? "",
    storageBucket: admin?.webStorageBucket ?? envConfig.storageBucket ?? "",
    messagingSenderId: admin?.webMessagingSenderId ?? envConfig.messagingSenderId ?? "",
    appId: admin?.webAppId ?? envConfig.appId ?? "",
    measurementId: admin?.webMeasurementId ?? envConfig.measurementId ?? "",
  };

  const vapidKey = (admin?.vapidKey && admin.vapidKey.trim()) || envWebPush.vapidKey || "";

  return NextResponse.json({ config, vapidKey });
}

