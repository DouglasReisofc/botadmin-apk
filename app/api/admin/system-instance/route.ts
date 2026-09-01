import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAllBotServers } from "lib/bot-servers";
import {
  BotInstanceError,
  createAdminSystemInstanceForUser,
  getAdminSystemInstanceForUser,
  updateAdminSystemInstanceForUser,
} from "lib/bot-instances";

const parseNumeric = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
};

const parseBooleanInput = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "sim", "yes", "on"].includes(normalized);
  }
  return false;
};

const requireAdmin = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ message: "Acesso restrito." }, { status: 403 }) };
  }
  return { user };
};

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const [instance, servers] = await Promise.all([
      getAdminSystemInstanceForUser(auth.user.id),
      getAllBotServers(),
    ]);

    return NextResponse.json({
      instance,
      servers,
      purpose: "admin_system",
    });
  } catch (error) {
    console.error("Failed to load admin system instance", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a instância operacional do admin." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { serverId, phone, name } = payload as Record<string, unknown>;
    const serverNumeric = parseNumeric(serverId);
    if (!Number.isFinite(serverNumeric)) {
      return NextResponse.json({ message: "Servidor inválido." }, { status: 400 });
    }

    const normalizedPhone =
      typeof phone === "string" || typeof phone === "number" ? String(phone) : "";
    if (!normalizedPhone) {
      return NextResponse.json({ message: "Informe o número do WhatsApp." }, { status: 400 });
    }

    const instance = await createAdminSystemInstanceForUser(auth.user.id, {
      serverId: serverNumeric,
      phone: normalizedPhone,
      name: typeof name === "string" ? name : "BotAdmin Verificações",
    });

    return NextResponse.json({ message: "Instância operacional configurada.", instance }, { status: 201 });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to create admin system instance", error);
    return NextResponse.json(
      { message: "Não foi possível configurar a instância operacional." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const existing = await getAdminSystemInstanceForUser(auth.user.id);
    if (!existing) {
      return NextResponse.json({ message: "Crie a instância operacional primeiro." }, { status: 404 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { name, phone, resetSession, forceReconnect } = payload as Record<string, unknown>;
    const instance = await updateAdminSystemInstanceForUser(auth.user.id, existing.id, {
      name: typeof name === "string" ? name : undefined,
      phone: typeof phone === "string" || typeof phone === "number" ? String(phone) : undefined,
      resetSession: parseBooleanInput(resetSession) || parseBooleanInput(forceReconnect),
    });

    return NextResponse.json({
      message:
        parseBooleanInput(resetSession) || parseBooleanInput(forceReconnect)
          ? "Instância operacional atualizada. Gere o pareamento do novo número."
          : "Instância operacional atualizada.",
      instance,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update admin system instance", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a instância operacional." },
      { status: 500 },
    );
  }
}
