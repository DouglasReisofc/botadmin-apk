import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotInstanceError,
  getAdminSystemInstanceForUser,
  refreshInstanceStatus,
} from "lib/bot-instances";

export async function GET() {
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

    const status = await refreshInstanceStatus(user.id, instance.id, { purpose: "admin_system" });
    const refreshed = await getAdminSystemInstanceForUser(user.id);
    return NextResponse.json({ status, instance: refreshed ?? { ...instance, sessionStatus: status } });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to refresh admin system instance", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o status da instância operacional." },
      { status: 500 },
    );
  }
}
