import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  type PairingRequestMode,
  requestPairingCode,
} from "lib/bot-instances";

type PairingRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveInstanceId = async (
  context: PairingRouteContext,
  request: Request,
): Promise<number | null> => {
  const tryParse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const params = await Promise.resolve(context.params);
  const direct = tryParse(params?.instanceId);
  if (direct !== null) {
    return direct;
  }

  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const idx = path.lastIndexOf("bot-instances");
    if (idx >= 0 && path[idx + 1]) {
      const parsed = tryParse(path[idx + 1]);
      if (parsed !== null) {
        return parsed;
      }
    }
  } catch {
    return null;
  }

  return null;
};

const parsePairingMode = async (request: Request): Promise<PairingRequestMode> => {
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  const modeRaw = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : "auto";
  if (modeRaw === "code" || modeRaw === "qr") {
    return modeRaw;
  }
  return "auto";
};

export async function POST(
  request: Request,
  context: PairingRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const mode = await parsePairingMode(request);
    const data = await requestPairingCode(user.id, instanceId, mode);
    return NextResponse.json({
      message:
        data.alreadyConnected
          ? "Esta conexão já está ativa."
          : mode === "qr"
            ? "QR Code de pareamento gerado."
            : mode === "code"
              ? "Código de pareamento gerado."
              : "Dados de pareamento gerados.",
      data,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to generate pairing information", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o código de pareamento." },
      { status: 500 },
    );
  }
}
