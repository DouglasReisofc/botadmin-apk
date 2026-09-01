import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getBotFlowForUser, listBotFlowWebhookEventsForUser } from "lib/bot-flows";

const parseFlowId = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

export async function GET(request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { flowId } = await params;
    const id = parseFlowId(flowId);
    if (!id) {
      return NextResponse.json({ message: "Fluxo inválido." }, { status: 400 });
    }

    const flow = await getBotFlowForUser(user.id, id);
    if (!flow) {
      return NextResponse.json({ message: "Fluxo não encontrado." }, { status: 404 });
    }

    const url = new URL(request.url);
    const nodeId = url.searchParams.get("nodeId")?.trim() || null;
    const events = await listBotFlowWebhookEventsForUser({
      userId: user.id,
      flowId: id,
      nodeId,
      limit: Number(url.searchParams.get("limit") || 20),
    });
    return NextResponse.json({ events });
  } catch (error) {
    console.error("[bot-flows] webhook events GET error", error);
    return NextResponse.json({ message: "Não foi possível carregar os exemplos do webhook." }, { status: 500 });
  }
}
