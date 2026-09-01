import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { purgeDisconnectedProfileInstancesForAdmin } from "lib/bot-instances";

export async function POST() {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const summary = await purgeDisconnectedProfileInstancesForAdmin();

    if (summary.targets === 0) {
      return NextResponse.json({
        message: "Não há sessões desconectadas para limpar.",
        summary,
      });
    }

    const message =
      summary.failed > 0
        ? `${summary.succeeded} instância(s) removida(s). ${summary.failed} falha(s). Os perfis dos usuários foram preservados.`
        : `${summary.succeeded} instância(s) desconectada(s) removidas do painel e dos servidores. Os perfis foram preservados.`;

    return NextResponse.json({ message, summary });
  } catch (error) {
    console.error("Failed to purge disconnected bot instances (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível limpar as sessões desconectadas." },
      { status: 500 },
    );
  }
}