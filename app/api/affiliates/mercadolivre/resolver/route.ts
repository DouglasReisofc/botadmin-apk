import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  clearAffiliateMlResolverForUser,
  getAffiliateMlResolverForUser,
  saveAffiliateMlResolverForUser,
  setAffiliateMlResolverEnabledForUser,
  validateAffiliateMlResolverForUser,
} from "lib/affiliate-ml-resolver";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const resolver = await getAffiliateMlResolverForUser(user.id);
    return NextResponse.json({ status: true, resolver });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível carregar o resolvedor do Mercado Livre.";
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
      action?: string;
      cookie?: string | null;
      csrfToken?: string | null;
      tag?: string | null;
      sampleUrl?: string | null;
      enabled?: boolean | null;
    };
    const action = String(payload.action || "save").trim().toLowerCase();

    if (action === "clear") {
      await clearAffiliateMlResolverForUser(user.id);
      return NextResponse.json({
        status: true,
        message: "Resolvedor removido com sucesso.",
        resolver: await getAffiliateMlResolverForUser(user.id),
      });
    }

    if (action === "validate") {
      const result = await validateAffiliateMlResolverForUser(user.id, {
        sampleUrl: payload.sampleUrl ?? null,
      });
      return NextResponse.json({
        status: true,
        message: result.validation.message,
        resolver: result.summary,
        validation: result.validation,
      });
    }

    if (action === "set_enabled") {
      const nextEnabled = Boolean(payload.enabled);
      const result = await setAffiliateMlResolverEnabledForUser(user.id, nextEnabled);
      return NextResponse.json({
        status: true,
        message: nextEnabled
          ? result.validation?.message ?? "Resolvedor automático ativado."
          : "Resolvedor automático desativado.",
        resolver: result.summary,
        validation: result.validation,
      });
    }

    if (action !== "save") {
      return NextResponse.json({ status: false, message: "Ação inválida." }, { status: 400 });
    }

    const result = await saveAffiliateMlResolverForUser(user.id, {
      cookie: payload.cookie ?? null,
      csrfToken: payload.csrfToken ?? null,
      tag: payload.tag ?? null,
      sampleUrl: payload.sampleUrl ?? null,
    });

    return NextResponse.json({
      status: true,
      message: result.validation.message,
      resolver: result.summary,
      validation: result.validation,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível atualizar o resolvedor do Mercado Livre.";
    return NextResponse.json({ status: false, message }, { status: 400 });
  }
}
