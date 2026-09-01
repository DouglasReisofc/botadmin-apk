import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, syncAllInstanceWebhooksAdmin } from "lib/bot-instances";

export async function POST() {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const summary = await syncAllInstanceWebhooksAdmin();

    const { total, succeeded, failures } = summary;
    const message =
      failures.length > 0
        ? `Webhooks sincronizados para ${succeeded} de ${total} instâncias. Falhas: ${failures.length}.`
        : total === 0
          ? "Nenhuma instância encontrada para sincronização."
          : `Webhooks sincronizados com sucesso para ${succeeded} instâncias.`;

    return NextResponse.json({
      message,
      summary,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to sync all instance webhooks (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível sincronizar os webhooks das instâncias." },
      { status: 500 },
    );
  }
}
