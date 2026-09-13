import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  ensurePanelModuleTables,
  resolvePanelModules,
  savePanelModuleLayout,
  savePanelModulePreference,
} from "lib/panel-module-access";
import type { PanelModuleScope } from "lib/panel-modules";

const validScope = (value: string | null): value is PanelModuleScope =>
  value === "user" || value === "admin";

const errorResponse = (error: unknown, fallback: string) => {
  const message = error instanceof Error && error.message ? error.message : fallback;
  const status = Number((error as { status?: unknown })?.status);
  return NextResponse.json({ message }, { status: status >= 400 && status <= 499 ? status : 500 });
};

const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return originUrl.protocol === requestUrl.protocol && originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
};

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const scopeValue = new URL(request.url).searchParams.get("scope");
    if (!validScope(scopeValue)) return NextResponse.json({ message: "Painel inválido." }, { status: 400 });
    if (scopeValue === "admin" && user.role !== "admin") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }
    const modules = await resolvePanelModules({
      userId: user.id,
      scope: scopeValue,
      isAdmin: user.role === "admin",
    });
    return NextResponse.json(
      { modules, enabled: modules.filter((item) => item.enabled).map((item) => item.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[panel-modules] load failed", error);
    return errorResponse(error, "Não foi possível carregar seus módulos.");
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    if (!isSameOrigin(request)) return NextResponse.json({ message: "Origem inválida." }, { status: 403 });
    const input: unknown = await request.json().catch(() => null);
    if (!input || typeof input !== "object") {
      return NextResponse.json({ message: "Informe um módulo válido." }, { status: 400 });
    }
    const body = input as Record<string, unknown>;
    const scope = body.scope;
    const moduleId = typeof body.module === "string" ? body.module.trim() : "";
    const enabled = body.enabled;
    const action = body.action === "layout" ? "layout" : "preference";
    if (!validScope(typeof scope === "string" ? scope : null) || !moduleId) {
      return NextResponse.json({ message: "Módulo ou estado inválido." }, { status: 400 });
    }
    if (scope === "admin" && user.role !== "admin") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }
    const modules = action === "layout"
      ? await savePanelModuleLayout({
          userId: user.id,
          actorUserId: user.id,
          scope,
          moduleId,
          pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
          order: typeof body.order === "number" ? body.order : undefined,
          isAdmin: user.role === "admin",
        })
      : await (async () => {
          if (typeof enabled !== "boolean") throw new Error("Informe o estado do módulo.");
          return savePanelModulePreference({
            userId: user.id,
            actorUserId: user.id,
            scope,
            moduleId,
            enabled,
            isAdmin: user.role === "admin",
          });
        })();
    return NextResponse.json({
      saved: true,
      modules,
      enabled: modules.filter((item) => item.enabled).map((item) => item.id),
    });
  } catch (error) {
    console.error("[panel-modules] save failed", error);
    return errorResponse(error, "Não foi possível salvar. Tente novamente.");
  }
}

export async function HEAD() {
  try {
    await ensurePanelModuleTables();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("[panel-modules] health failed", error);
    return new NextResponse(null, { status: 503 });
  }
}
