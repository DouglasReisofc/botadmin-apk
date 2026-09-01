import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  getAdminSystemInstanceForUser,
  requestPairingCode,
  type PairingRequestMode,
} from "lib/bot-instances";

const parsePairingRequest = async (
  request: Request,
): Promise<{ mode: PairingRequestMode; forceReconnect: boolean }> => {
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  const modeRaw = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : "auto";
  const mode = modeRaw === "code" || modeRaw === "qr" ? modeRaw : "auto";
  const forceValue = (body as { forceReconnect?: unknown; resetSession?: unknown } | null)?.forceReconnect ??
    (body as { forceReconnect?: unknown; resetSession?: unknown } | null)?.resetSession;
  const forceReconnect =
    forceValue === true ||
    forceValue === 1 ||
    (typeof forceValue === "string" && ["true", "1", "sim", "yes", "on"].includes(forceValue.trim().toLowerCase()));
  return { mode, forceReconnect };
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const instance = await getAdminSystemInstanceForUser(user.id);
    if (!instance) {
      return NextResponse.json({ message: "Crie a instância operacional primeiro." }, { status: 404 });
    }

    const { mode, forceReconnect } = await parsePairingRequest(request);
    const data = await requestPairingCode(user.id, instance.id, mode, {
      purpose: "admin_system",
      forceReconnect,
    });
    return NextResponse.json({
      message: data.alreadyConnected ? "Instância operacional já conectada." : "Dados de pareamento gerados.",
      data,
      instance,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to pair admin system instance", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o pareamento da instância operacional." },
      { status: 500 },
    );
  }
}
