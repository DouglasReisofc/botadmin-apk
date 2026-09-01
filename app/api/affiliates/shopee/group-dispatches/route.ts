import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  listAffiliateShopeeGroupDispatchesForUser,
  upsertAffiliateShopeeGroupDispatchForUser,
} from "lib/affiliate-shopee-group-dispatches";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const dispatches = await listAffiliateShopeeGroupDispatchesForUser(user.id);
    return NextResponse.json({ status: true, dispatches });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível carregar as ativações de envio.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as {
      groupId?: number;
      instanceId?: number;
      enabled?: boolean;
      delayMinutes?: number;
      categoryRotationEnabled?: boolean;
    };

    const dispatch = await upsertAffiliateShopeeGroupDispatchForUser(user.id, {
      groupId: payload.groupId,
      instanceId: payload.instanceId,
      enabled: payload.enabled,
      delayMinutes: payload.delayMinutes,
      categoryRotationEnabled: payload.categoryRotationEnabled,
    });

    return NextResponse.json({
      status: true,
      message: "Ativação de envio salva com sucesso.",
      dispatch,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível salvar a ativação de envio.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
