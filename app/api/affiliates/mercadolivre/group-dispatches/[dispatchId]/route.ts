import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteAffiliateMlGroupDispatchForUser,
  updateAffiliateMlGroupDispatchForUser,
} from "lib/affiliate-ml-group-dispatches";

type RouteContext = { params: Promise<{ dispatchId: string }> | { dispatchId: string } };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const dispatchId = Number(params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
      return NextResponse.json({ status: false, message: "Ativação inválida." }, { status: 400 });
    }

    const payload = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      delayMinutes?: number;
      categoryRotationEnabled?: boolean;
      groupId?: number;
      instanceId?: number;
    };

    const dispatch = await updateAffiliateMlGroupDispatchForUser(user.id, Math.floor(dispatchId), {
      enabled: payload.enabled,
      delayMinutes: payload.delayMinutes,
      categoryRotationEnabled: payload.categoryRotationEnabled,
      groupId: payload.groupId,
      instanceId: payload.instanceId,
    });

    return NextResponse.json({
      status: true,
      message: "Ativação de envio atualizada com sucesso.",
      dispatch,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível atualizar a ativação de envio.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const dispatchId = Number(params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
      return NextResponse.json({ status: false, message: "Ativação inválida." }, { status: 400 });
    }

    await deleteAffiliateMlGroupDispatchForUser(user.id, Math.floor(dispatchId));

    return NextResponse.json({
      status: true,
      message: "Ativação de envio removida com sucesso.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível remover a ativação de envio.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
