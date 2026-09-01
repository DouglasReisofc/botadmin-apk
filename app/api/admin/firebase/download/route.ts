import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { getCurrentUser } from "lib/auth";
import { getAdminFirebaseSettings } from "lib/admin-firebase";

const DATA_DIR = path.join(process.cwd(), "data/firebase");
const GOOGLE_SERVICES_PATH = path.join(DATA_DIR, "google-services.json");

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
  }

  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "").toLowerCase();

  if (type === "google-services") {
    try {
      const buf = await fs.readFile(GOOGLE_SERVICES_PATH);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=google-services.json",
        },
      });
    } catch {
      return NextResponse.json({ message: "google-services.json não encontrado." }, { status: 404 });
    }
  }

  if (type === "service-account") {
    const s = await getAdminFirebaseSettings();
    if (!s?.projectId || !s?.clientEmail || !s?.privateKey) {
      return NextResponse.json({ message: "Credenciais do Service Account incompletas." }, { status: 404 });
    }
    const json = {
      type: "service_account",
      project_id: s.projectId,
      client_email: s.clientEmail,
      private_key: s.privateKey,
    } as const;

    return new NextResponse(Buffer.from(JSON.stringify(json, null, 2), "utf8"), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=service-account.json",
      },
    });
  }

  return NextResponse.json({ message: "Parâmetro 'type' inválido. Use google-services ou service-account." }, { status: 400 });
}

