import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAffiliateMlAutoSyncConfigForUser,
  upsertAffiliateMlAutoSyncConfigForUser,
} from "lib/affiliate-ml-auto-sync";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const config = await getAffiliateMlAutoSyncConfigForUser(user.id);
    return NextResponse.json({ status: true, config });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar a configuração de varredura automática.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as {
      enabled?: unknown;
      refreshExisting?: unknown;
      discoverNew?: unknown;
      targetImportLimit?: unknown;
      intervalMinutes?: unknown;
      discoveryTerms?: unknown;
      discoveryCategories?: unknown;
    };

    const config = await upsertAffiliateMlAutoSyncConfigForUser(user.id, payload);
    return NextResponse.json({
      status: true,
      message: "Configuração de varredura automática atualizada com sucesso.",
      config,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível salvar a configuração de varredura automática.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
