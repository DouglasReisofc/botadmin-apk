import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  AdminSiteSettingsError,
  refreshOfficialGroupInviteLink,
} from "lib/admin-site";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const payload = await request.json().catch(() => ({}));
    const settings = await refreshOfficialGroupInviteLink({
      groupId: payload?.groupId,
      instanceId: payload?.instanceId,
      groupJid: payload?.groupJid,
      reset: payload?.reset,
    });

    return NextResponse.json({
      message: "Link do grupo oficial atualizado com sucesso.",
      settings,
      inviteLink: settings.officialGroupInviteLink,
    });
  } catch (error) {
    if (error instanceof AdminSiteSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to refresh official group invite link", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o link do grupo oficial." },
      { status: 500 },
    );
  }
}
