import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  ensurePanelModuleGovernanceTable,
  getGlobalPanelModuleStates,
  saveGlobalPanelModuleState,
} from "lib/panel-module-governance";

const errorResponse = (error: unknown, fallback: string) => {
  const message = error instanceof Error && error.message ? error.message : fallback;
  const status = Number((error as { status?: unknown })?.status);
  return NextResponse.json({ message }, { status: status >= 400 && status <= 499 ? status : 500 });
};

const admin = async () => {
  const user = await getCurrentUser();
  return user && user.role === "admin" ? user : null;
};

export async function GET() {
  try {
    if (!(await admin())) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    return NextResponse.json({ modules: await getGlobalPanelModuleStates() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[admin-panel-modules] load failed", error);
    return errorResponse(error, "Não foi possível carregar a governança dos módulos.");
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await admin())) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const moduleId = typeof input.module === "string" ? input.module.trim() : "";
    if (!moduleId) return NextResponse.json({ message: "Informe o módulo." }, { status: 400 });
    const lifecycle = input.lifecycle;
    if (lifecycle !== undefined && !["active", "beta", "maintenance", "coming_soon"].includes(String(lifecycle))) {
      return NextResponse.json({ message: "Ciclo de vida inválido." }, { status: 400 });
    }
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
      return NextResponse.json({ message: "Estado global inválido." }, { status: 400 });
    }
    const rolloutPercent = input.rolloutPercent === undefined ? undefined : Number(input.rolloutPercent);
    if (rolloutPercent !== undefined && (!Number.isFinite(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100)) {
      return NextResponse.json({ message: "A liberação deve estar entre 0 e 100%." }, { status: 400 });
    }
    const state = await saveGlobalPanelModuleState({
      moduleId,
      enabled: input.enabled as boolean | undefined,
      lifecycle: lifecycle as "active" | "beta" | "maintenance" | "coming_soon" | undefined,
      rolloutPercent,
    });
    return NextResponse.json({ saved: true, state });
  } catch (error) {
    console.error("[admin-panel-modules] save failed", error);
    return errorResponse(error, "Não foi possível salvar a governança do módulo.");
  }
}

export async function HEAD() {
  try {
    if (!(await admin())) return new NextResponse(null, { status: 403 });
    await ensurePanelModuleGovernanceTable();
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
