import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { getCurrentUser } from "lib/auth";
import { ensureAdminFirebaseSettingsTable } from "lib/db";
import { getAdminFirebaseSettings, upsertAdminFirebaseSettings } from "lib/admin-firebase";

const DATA_DIR = path.join(process.cwd(), "data/firebase");
const GOOGLE_SERVICES_PATH = path.join(DATA_DIR, "google-services.json");

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
  }
  await ensureAdminFirebaseSettingsTable();
  const settings = await getAdminFirebaseSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ message: "Envie como multipart/form-data." }, { status: 400 });
  }

  const form = await request.formData();
  await ensureAdminFirebaseSettingsTable();
  const existing = await getAdminFirebaseSettings();

  const getOptionalText = (key: string, fallback: string | null = null) => {
    const value = form.get(key);
    if (typeof value !== "string") {
      return fallback;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
  };

  let projectId: string | null = getOptionalText("projectId", existing?.projectId ?? null);
  let clientEmail: string | null = getOptionalText("clientEmail", existing?.clientEmail ?? null);
  let privateKey: string | null = getOptionalText("privateKey", existing?.privateKey ?? null);

  const serviceAccount = form.get("serviceAccount");
  if (serviceAccount instanceof File) {
    const text = await serviceAccount.text();
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      projectId = typeof json.project_id === "string" ? json.project_id : null;
      clientEmail = typeof json.client_email === "string" ? json.client_email : null;
      privateKey = typeof json.private_key === "string" ? json.private_key : null;
    } catch (_error) {
      return NextResponse.json({ message: "serviceAccount inválido." }, { status: 400 });
    }
  }

  const googleServices = form.get("googleServices");
  if (googleServices instanceof File) {
    const text = await googleServices.text();
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(GOOGLE_SERVICES_PATH, text, "utf8");
  }

  const webApiKey = getOptionalText("webApiKey", existing?.webApiKey ?? null);
  const webAuthDomain = getOptionalText("webAuthDomain", existing?.webAuthDomain ?? null);
  const webProjectId = getOptionalText("webProjectId", existing?.webProjectId ?? null);
  const webStorageBucket = getOptionalText("webStorageBucket", existing?.webStorageBucket ?? null);
  const webMessagingSenderId = getOptionalText("webMessagingSenderId", existing?.webMessagingSenderId ?? null);
  const webAppId = getOptionalText("webAppId", existing?.webAppId ?? null);
  const webMeasurementId = getOptionalText("webMeasurementId", existing?.webMeasurementId ?? null);
  const vapidKey = getOptionalText("vapidKey", existing?.vapidKey ?? null);

  await upsertAdminFirebaseSettings({
    projectId,
    clientEmail,
    privateKey,
    webApiKey,
    webAuthDomain,
    webProjectId,
    webStorageBucket,
    webMessagingSenderId,
    webAppId,
    webMeasurementId,
    vapidKey,
  });

  return NextResponse.json({ message: "Configurações atualizadas." });
}

