import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  addBotInterageAllowedUser,
  BotInterageConfigError,
  listBotInterageAllowedUsers,
  removeBotInterageAllowedUser,
} from "lib/admin-botinterage-config";

const parseUserId = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const ensureAdmin = async () => {
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
    const auth = await ensureAdmin();
    if ("error" in auth) {
      return auth.error;
    }

    const users = await listBotInterageAllowedUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Failed to list BotInterage allowed users", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os usuários permitidos." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await ensureAdmin();
    if ("error" in auth) {
      return auth.error;
    }

    const payload = await request.json().catch(() => ({}));
    const userId = parseUserId((payload as Record<string, unknown>).userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ message: "Usuário inválido." }, { status: 400 });
    }

    const added = await addBotInterageAllowedUser(userId);
    const users = await listBotInterageAllowedUsers();
    return NextResponse.json({
      message: `Usuário ${added.name} liberado para o BotInterage.`,
      user: added,
      users,
    });
  } catch (error) {
    if (error instanceof BotInterageConfigError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to add BotInterage user", error);
    return NextResponse.json(
      { message: "Não foi possível liberar o usuário para o BotInterage." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await ensureAdmin();
    if ("error" in auth) {
      return auth.error;
    }

    const payload = await request.json().catch(() => ({}));
    const userId = parseUserId((payload as Record<string, unknown>).userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ message: "Usuário inválido." }, { status: 400 });
    }

    const removed = await removeBotInterageAllowedUser(userId);
    const users = await listBotInterageAllowedUsers();

    return NextResponse.json({
      message: removed
        ? "Usuário removido da lista do BotInterage."
        : "Usuário não estava na lista do BotInterage.",
      removed,
      users,
    });
  } catch (error) {
    if (error instanceof BotInterageConfigError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to remove BotInterage user", error);
    return NextResponse.json(
      { message: "Não foi possível remover o usuário da lista do BotInterage." },
      { status: 500 },
    );
  }
}
