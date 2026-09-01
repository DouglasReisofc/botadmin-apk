import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createOrUpdateBotFlowShare } from "lib/bot-flow-sharing";

const parseFlowId = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

export async function POST(_request: Request, { params }: { params: Promise<{ flowId: string }> }) {
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

    const result = await createOrUpdateBotFlowShare(user.id, id);
    return NextResponse.json({
      message: "Link de compartilhamento criado.",
      share: result.share,
      package: result.package,
    });
  } catch (error) {
    console.error("[bot-flows/share] POST error", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível compartilhar o fluxo." },
      { status: 400 },
    );
  }
}

export async function GET(request: Request, context: { params: Promise<{ flowId: string }> }) {
  return POST(request, context);
}

