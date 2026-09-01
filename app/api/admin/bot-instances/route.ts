import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAllBotServers } from "lib/bot-servers";
import {
  createInstanceForUser,
  listInstancesForAdmin,
} from "lib/bot-instances";
import { listUserProfilesForAdmin } from "lib/bot-user-profiles";
import { SubscriptionPlanError } from "lib/plans";

const parseNumeric = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.NaN;
};

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const url = new URL(request.url);
    const userIdParam = url.searchParams.get("userId");
    const userId = userIdParam ? Number.parseInt(userIdParam, 10) : Number.NaN;

    const targetUserId = Number.isFinite(userId) ? userId : undefined;
    const [instances, profiles, servers] = await Promise.all([
      listInstancesForAdmin({ userId: targetUserId }),
      listUserProfilesForAdmin({ userId: targetUserId }),
      getAllBotServers(),
    ]);

    return NextResponse.json(
      { instances, profiles, servers },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Failed to list bot instances (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as instâncias." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const current = await getCurrentUser();
    if (!current) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (current.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { userId, serverId, phone, name } = payload as Record<string, unknown>;

    const targetUserId = parseNumeric(userId);
    if (!Number.isFinite(targetUserId)) {
      return NextResponse.json({ message: "Usuário alvo inválido." }, { status: 400 });
    }

    const serverNumeric = parseNumeric(serverId);
    if (!Number.isFinite(serverNumeric)) {
      return NextResponse.json({ message: "Servidor inválido." }, { status: 400 });
    }

    const normalizedPhone =
      typeof phone === "string" || typeof phone === "number" ? String(phone) : "";
    if (!normalizedPhone) {
      return NextResponse.json({ message: "Informe o número do WhatsApp." }, { status: 400 });
    }

    const instance = await createInstanceForUser(targetUserId, {
      serverId: serverNumeric,
      phone: normalizedPhone,
      name: typeof name === "string" ? name : undefined,
    });

    const summary = await listInstancesForAdmin({ userId: targetUserId });
    const created = summary.find((item) => item.id === instance.id) ?? null;

    return NextResponse.json(
      {
        message: "Instância criada com sucesso.",
        instance: created ?? instance,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to create bot instance (admin)", error);
    return NextResponse.json(
      { message: "Não foi possível criar a instância." },
      { status: 500 },
    );
  }
}
