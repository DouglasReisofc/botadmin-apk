import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotGroupError,
  getGroupByIdForUser,
  listGroupsForUser,
  updateGroupLicenseForUser,
} from "lib/bot-groups";
import {
  SubscriptionPlanError,
  getAllSubscriptionPlans,
  getUserPlanLimits,
  getUserPlanStatus,
} from "lib/plans";
import { recordWhatsappRealtimeEvent } from "lib/whatsapp-conversations";
import { publishWhatsappRealtimeEvent } from "lib/whatsapp-realtime-bus";

type RouteParams<T> = T | Promise<T>;

const parsePositiveId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalBoolean = (value: unknown): boolean | null | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "active" || normalized === "ativo") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "disabled" || normalized === "desativado") {
      return false;
    }
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

const parsePlanId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
};

const buildOverviewPayload = async (userId: number) => {
  const [status, limits, plans, groups] = await Promise.all([
    getUserPlanStatus(userId),
    getUserPlanLimits(userId),
    getAllSubscriptionPlans(),
    listGroupsForUser(userId),
  ]);
  return { status, limits, plans, groups };
};

const publishGroupPlanRealtime = async (
  userId: number,
  group: Awaited<ReturnType<typeof updateGroupLicenseForUser>>,
  action: "updated" | "removed",
) => {
  if (!group?.instanceId || !group.remoteId) return;
  try {
    const event = await recordWhatsappRealtimeEvent({
      userId,
      instanceId: group.instanceId,
      chatJid: group.remoteId,
      eventType: "group.plan.updated",
      messageId: null,
      payload: {
        action,
        group,
        groupId: group.id,
        remoteId: group.remoteId,
        licenseExpiresAt: group.metadata?.licenseExpiresAt ?? null,
        planId: group.metadata?.licensePlanId ?? null,
        planName: group.metadata?.licensePlanName ?? null,
      },
    });
    if (event) {
      publishWhatsappRealtimeEvent(event);
    }
  } catch (error) {
    console.warn("[admin-group-plan] failed to publish realtime update", {
      userId,
      groupId: group?.id,
      error,
    });
  }
};

const assertAdminAndParams = async (
  params: RouteParams<{ id: string; groupId: string }>,
) => {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return {
      error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }),
    };
  }
  if (currentUser.role !== "admin") {
    return {
      error: NextResponse.json({ message: "Acesso restrito." }, { status: 403 }),
    };
  }

  const resolvedParams = await Promise.resolve(params);
  const userId = parsePositiveId(resolvedParams.id);
  const groupId = parsePositiveId(resolvedParams.groupId);
  if (!userId || !groupId) {
    return {
      error: NextResponse.json({ message: "Usuário ou grupo inválido." }, { status: 400 }),
    };
  }

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    return {
      error: NextResponse.json({ message: "Grupo não encontrado para este usuário." }, { status: 404 }),
    };
  }

  return { currentUser, userId, groupId };
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: RouteParams<{ id: string; groupId: string }> },
) {
  try {
    const context = await assertAdminAndParams(params);
    if ("error" in context) {
      return context.error;
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const active = parseOptionalBoolean(payload.active ?? payload.status);
    if (active === null) {
      return NextResponse.json({ message: "Status do grupo inválido." }, { status: 400 });
    }

    const planId = parsePlanId(payload.planId ?? payload.plan_id);
    if (Number.isNaN(planId)) {
      return NextResponse.json({ message: "Plano inválido." }, { status: 400 });
    }
    if (!planId) {
      return NextResponse.json({ message: "Selecione um plano para este grupo." }, { status: 400 });
    }

    const plans = await getAllSubscriptionPlans();
    const plan = plans.find((entry) => entry.id === planId) ?? null;
    if (!plan) {
      return NextResponse.json({ message: "Plano não encontrado." }, { status: 404 });
    }

    const group = await updateGroupLicenseForUser(context.userId, context.groupId, {
      plan,
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
      active: active ?? true,
      adminUserId: context.currentUser.id,
    });

    const overview = await buildOverviewPayload(context.userId);
    await publishGroupPlanRealtime(context.userId, group, "updated");

    return NextResponse.json({
      message: group.status === "active"
        ? "Licença legada salva e grupo ativado."
        : "Licença legada salva.",
      group,
      ...overview,
    });
  } catch (error) {
    if (error instanceof BotGroupError || error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to update admin group plan", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a licença legada do grupo." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: RouteParams<{ id: string; groupId: string }> },
) {
  try {
    const context = await assertAdminAndParams(params);
    if ("error" in context) {
      return context.error;
    }

    const group = await updateGroupLicenseForUser(context.userId, context.groupId, {
      plan: null,
      active: false,
      remove: true,
      adminUserId: context.currentUser.id,
    });
    const overview = await buildOverviewPayload(context.userId);
    await publishGroupPlanRealtime(context.userId, group, "removed");

    return NextResponse.json({
      message: "Licença legada do grupo removida.",
      group,
      ...overview,
    });
  } catch (error) {
    if (error instanceof BotGroupError || error instanceof SubscriptionPlanError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to remove admin group plan", error);
    return NextResponse.json(
      { message: "Não foi possível remover o plano do grupo." },
      { status: 500 },
    );
  }
}
