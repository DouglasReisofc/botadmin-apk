import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  getInstanceById,
  type PairingRequestMode,
  requestPairingCode,
} from "lib/bot-instances";

type AdminPairRouteContext = { params: Promise<{ instanceId: string }> | { instanceId: string } };

const resolveInstanceId = async (
  context: AdminPairRouteContext,
  request: Request,
): Promise<number | null> => {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const params = await Promise.resolve(context.params);
  const direct = parse(params?.instanceId);
  if (direct !== null) {
    return direct;
  }

  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const idx = path.lastIndexOf("bot-instances");
    if (idx >= 0 && path[idx + 1]) {
      return parse(path[idx + 1]);
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
  context: AdminPairRouteContext,
) {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const instanceId = await resolveInstanceId(context, request);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 404 });
    }

    const instance = await getInstanceById(instanceId);
    if (!instance) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }

    const mode = await parsePairingMode(request);
    const data = await requestPairingCode(instance.userId, instanceId, mode);
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
    console.error("Failed to generate pairing data (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível gerar o código de pareamento." },
      { status: 500 },
    );
  }
}
