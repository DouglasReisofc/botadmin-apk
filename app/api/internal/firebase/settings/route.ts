import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { getAdminFirebaseSettings } from "lib/admin-firebase";
import { ensureAdminFirebaseSettingsTable } from "lib/db";

const DATA_DIR = path.join(process.cwd(), "data", "firebase");
const GOOGLE_SERVICES_PATH = path.join(DATA_DIR, "google-services.json");

export async function GET(request: Request) {
  const token = request.headers.get("x-internal-token")?.trim() ?? "";
  const expected = process.env.MOBILE_CI_TOKEN?.trim() ?? "";

  if (!expected || token !== expected) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  await ensureAdminFirebaseSettingsTable();
  const settings = await getAdminFirebaseSettings();

  let googleServicesBase64: string | null = null;
  try {
    const raw = await fs.readFile(GOOGLE_SERVICES_PATH);
    if (raw.length > 0) {
      googleServicesBase64 = raw.toString("base64");
    }
  } catch {
    // arquivo não encontrado é aceitável
  }

  return NextResponse.json({
    googleServicesBase64,
    web: settings
      ? {
          apiKey: settings.webApiKey,
          authDomain: settings.webAuthDomain,
          projectId: settings.webProjectId ?? settings.projectId ?? null,
          storageBucket: settings.webStorageBucket,
          messagingSenderId: settings.webMessagingSenderId,
          appId: settings.webAppId,
          measurementId: settings.webMeasurementId,
          vapidKey: settings.vapidKey,
        }
      : null,
  });
}
