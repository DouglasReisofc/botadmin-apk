import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteUserProfile,
  listUserProfilesForAdmin,
  renewUserProfileForAdmin,
} from "lib/bot-user-profiles";

type RouteContext = {
  params: Promise<{ profileId: string }>;
};

const resolveProfileId = async (context: RouteContext): Promise<number | null> => {
  const params = await Promise.resolve(context.params);
  const profileId = Number.parseInt(params.profileId, 10);
  return Number.isFinite(profileId) && profileId > 0 ? profileId : null;
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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const profileId = await resolveProfileId(context);
    if (!profileId) {
      return NextResponse.json({ message: "Perfil inválido." }, { status: 404 });
    }

    const profile = (await listUserProfilesForAdmin({ profileId }))[0];
    if (!profile) {
      return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    }
    return NextResponse.json(
      { profile },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Failed to load admin profile", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o perfil." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const profileId = await resolveProfileId(context);
    if (!profileId) {
      return NextResponse.json({ message: "Perfil inválido." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const extendDaysValue = (body as Record<string, unknown>).extendDays;
    const expiresAtValue = (body as Record<string, unknown>).expiresAt;
    const hasExtendDays = extendDaysValue !== undefined && extendDaysValue !== null;
    const hasExpiresAt =
      typeof expiresAtValue === "string" && expiresAtValue.trim().length > 0;
    if (!hasExtendDays && !hasExpiresAt) {
      return NextResponse.json(
        { message: "Informe os dias ou a nova validade do perfil." },
        { status: 400 },
      );
    }

    const extendDays = hasExtendDays ? Number(extendDaysValue) : undefined;
    if (hasExtendDays && (!Number.isFinite(extendDays) || Number(extendDays) <= 0)) {
      return NextResponse.json(
        { message: "Período de renovação inválido." },
        { status: 400 },
      );
    }

    const profile = await renewUserProfileForAdmin(profileId, {
      extendDays,
      expiresAt: hasExpiresAt ? String(expiresAtValue) : undefined,
    });

    return NextResponse.json({
      message: "Perfil renovado com sucesso.",
      profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível renovar o perfil.";
    const status =
      message.includes("não encontrado")
        ? 404
        : message.includes("inválido") ||
            message.includes("validade") ||
            message.includes("Período")
          ? 400
          : 500;
    console.error("Failed to renew admin profile", error);
    return NextResponse.json({ message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const profileId = await resolveProfileId(context);
    if (!profileId) {
      return NextResponse.json({ message: "Perfil inválido." }, { status: 404 });
    }

    const profile = (await listUserProfilesForAdmin({ profileId }))[0];
    if (!profile) {
      return NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 });
    }
    if (profile.instanceId) {
      return NextResponse.json(
        { message: "Exclua a instância vinculada para remover o perfil completo." },
        { status: 409 },
      );
    }

    await deleteUserProfile(profile.userId, profileId);
    return NextResponse.json({ message: "Perfil excluído permanentemente." });
  } catch (error) {
    console.error("Failed to delete admin profile", error);
    return NextResponse.json(
      { message: "Não foi possível excluir o perfil." },
      { status: 500 },
    );
  }
}
