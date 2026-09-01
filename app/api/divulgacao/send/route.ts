import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { sendDivulgacao } from "lib/divulgacao";
import type { BotAdCampaignContent } from "types/bot-ad-campaigns";

type SendPayload = {
  instanceId?: number;
  invite?: string;
  templateId?: number | null;
  contents?: BotAdCampaignContent[];
  mentionAll?: boolean;
};

const parsePayload = async (request: NextRequest): Promise<SendPayload | null> => {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return null;
    }
    return body as SendPayload;
  } catch {
    return null;
  }
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const payload = await parsePayload(request);
    if (!payload || !payload.instanceId || !payload.invite) {
      return NextResponse.json(
        { message: "Informe a instância e o link do grupo para enviar a mensagem." },
        { status: 400 },
      );
    }

    const result = await sendDivulgacao({
      userId: user.id,
      instanceId: Number(payload.instanceId),
      invite: payload.invite,
      templateId: payload.templateId ? Number(payload.templateId) : undefined,
      contents: payload.contents,
      mentionAll: payload.mentionAll,
    });

    return NextResponse.json({ message: "Mensagem enviada com sucesso.", result }, { status: 201 });
  } catch (error) {
    const status =
      error instanceof Error && typeof (error as { status?: number }).status === "number"
        ? (error as { status?: number }).status!
        : 400;
    const message =
      error instanceof Error ? error.message : "Não foi possível enviar a mensagem.";
    return NextResponse.json({ message }, { status: Number.isFinite(status) ? status : 400 });
  }
}
