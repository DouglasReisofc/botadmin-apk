import { NextResponse } from "next/server";

import {
  cacheAdminOperationalUserAvatar,
  getAdminOperationalUserAvatarUrl,
} from "lib/admin-operational-instance";
import { getCurrentUser } from "lib/auth";
import {
  buildSupportThreadSummary,
  getOrCreateSupportThread,
  listAllSupportThreadsWithUsers,
} from "lib/support";
import { getSessionUserById } from "lib/users";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const threadsWithUsers = await listAllSupportThreadsWithUsers();
    const payload = await Promise.all(
      threadsWithUsers.map(async ({ user: owner, thread }, index) => {
        const operationalAvatar =
          owner.avatarUrl || index >= 25
            ? null
            : await cacheAdminOperationalUserAvatar(owner.id, owner.whatsappNumber)
                .catch(() => getAdminOperationalUserAvatarUrl(owner.whatsappNumber))
                .catch(() => null);
        return {
          user: {
            id: owner.id,
            name: owner.name,
            email: owner.email,
            whatsappNumber: owner.whatsappNumber,
            avatarUrl: owner.avatarUrl || operationalAvatar,
            isActive: owner.isActive,
            hasActiveSubscription: owner.hasActiveSubscription,
          },
          thread: await buildSupportThreadSummary(owner.id, thread),
        };
      }),
    );

    return NextResponse.json({ threads: payload });
  } catch (error) {
    console.error("[admin-support] Falha ao listar atendimentos", error);
    return NextResponse.json({ message: "Erro ao listar atendimentos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await getCurrentUser();
    if (!admin) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (admin.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const userId = Number(body?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ message: "Usuário inválido." }, { status: 400 });
    }

    const owner = await getSessionUserById(Math.trunc(userId));
    if (!owner) {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }

    const thread = await getOrCreateSupportThread(owner.id, "__admin__", {
      customerName: "Suporte BotAdmin",
      profileName: "BotAdmin",
    });

    return NextResponse.json({
      entry: {
        user: {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          whatsappNumber: owner.whatsappNumber,
          avatarUrl: owner.avatarUrl ?? null,
        },
        thread: await buildSupportThreadSummary(owner.id, thread),
      },
    });
  } catch (error) {
    console.error("[admin-support] Falha ao iniciar atendimento", error);
    return NextResponse.json({ message: "Erro ao iniciar atendimento." }, { status: 500 });
  }
}
