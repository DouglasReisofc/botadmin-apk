import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getNotificationsForUser,
  getUnreadCountForUser,
  markNotificationsAsRead,
  deleteAllNotificationsForUser,
} from "lib/user-notifications";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const [notifications, unreadCount] = await Promise.all([
      getNotificationsForUser(user.id),
      getUnreadCountForUser(user.id),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error("Failed to load notifications", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as notificações." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const { notificationIds } = body as { notificationIds?: number[] | "all" };

    if (notificationIds !== "all" && !Array.isArray(notificationIds)) {
      return NextResponse.json({ message: "Informe as notificações que deseja marcar como lidas." }, { status: 400 });
    }

    await markNotificationsAsRead(user.id, notificationIds ?? "all");

    const unreadCount = await getUnreadCountForUser(user.id);

    return NextResponse.json({ message: "Notificações atualizadas.", unreadCount });
  } catch (error) {
    console.error("Failed to mark notifications", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar as notificações." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    await deleteAllNotificationsForUser(user.id);
    return NextResponse.json({ message: "Notificações apagadas." });
  } catch (error) {
    console.error("Failed to delete notifications", error);
    return NextResponse.json({ message: "Não foi possível apagar as notificações." }, { status: 500 });
  }
}
