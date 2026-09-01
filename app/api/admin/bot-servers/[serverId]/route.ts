import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotServerError,
  deleteBotServer,
  getBotServerById,
  updateBotServer,
} from "lib/bot-servers";

export async function PUT(
  request: Request,
  { params }: { params: { serverId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const serverId = Number.parseInt(params.serverId, 10);
    if (!Number.isFinite(serverId)) {
      return NextResponse.json({ message: "Servidor inválido." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      name,
      baseUrl,
      apiType,
      globalApiKey,
      sessionLimit,
      isActive,
    } = body as Record<string, unknown>;

    const server = await updateBotServer(serverId, {
      name: typeof name === "string" ? name : undefined,
      baseUrl: typeof baseUrl === "string" ? baseUrl : undefined,
      apiType: typeof apiType === "string" ? apiType : undefined,
      globalApiKey: typeof globalApiKey === "string" ? globalApiKey : undefined,
      sessionLimit: sessionLimit as number | string | undefined,
      isActive: typeof isActive === "boolean" ? isActive : undefined,
    });

    return NextResponse.json({ message: "Servidor atualizado com sucesso.", server });
  } catch (error) {
    if (error instanceof BotServerError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update bot server", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o servidor." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { serverId: string } },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const serverId = Number.parseInt(params.serverId, 10);
    if (!Number.isFinite(serverId)) {
      return NextResponse.json({ message: "Servidor inválido." }, { status: 404 });
    }

    const exists = await getBotServerById(serverId);
    if (!exists) {
      return NextResponse.json({ message: "Servidor não encontrado." }, { status: 404 });
    }

    await deleteBotServer(serverId);
    return NextResponse.json({ message: "Servidor removido." });
  } catch (error) {
    if (error instanceof BotServerError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to delete bot server", error);
    return NextResponse.json(
      { message: "Não foi possível remover o servidor." },
      { status: 500 },
    );
  }
}
