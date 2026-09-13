import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";

import { getCurrentUser } from "lib/auth";
import { ensureUserTable, getDb } from "lib/db";
import {
  resolvePanelModules,
  savePanelModulePreference,
} from "lib/panel-module-access";
import { getPanelModule } from "lib/panel-modules";

type RouteContext = { params: Promise<{ id: string }> };

const authorize = async () => {
  const user = await getCurrentUser();
  return user?.role === "admin" ? user : null;
};

const targetUserId = async (context: RouteContext): Promise<number> => {
  const { id } = await context.params;
  const parsed = Number.parseInt(id, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const userExists = async (userId: number): Promise<boolean> => {
  await ensureUserTable();
  const [rows] = await getDb().query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  return rows.length > 0;
};

const errorResponse = (error: unknown) => {
  const status = Number((error as { status?: unknown })?.status);
  return NextResponse.json(
    {
      message:
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível atualizar os módulos do usuário.",
    },
    { status: status >= 400 && status <= 499 ? status : 500 },
  );
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await authorize();
    if (!actor) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    const userId = await targetUserId(context);
    if (!userId || !(await userExists(userId))) {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }
    const modules = await resolvePanelModules({
      userId,
      scope: "user",
      isAdmin: false,
    });
    return NextResponse.json(
      { modules },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[admin-user-modules] load failed", error);
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await authorize();
    if (!actor) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    const userId = await targetUserId(context);
    if (!userId || !(await userExists(userId))) {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const moduleId = typeof input.module === "string" ? input.module.trim() : "";
    if (!getPanelModule("user", moduleId) || typeof input.enabled !== "boolean") {
      return NextResponse.json({ message: "Módulo ou estado inválido." }, { status: 400 });
    }
    const modules = await savePanelModulePreference({
      userId,
      actorUserId: actor.id,
      scope: "user",
      moduleId,
      enabled: input.enabled,
      isAdmin: false,
    });
    return NextResponse.json({ saved: true, modules });
  } catch (error) {
    console.error("[admin-user-modules] save failed", error);
    return errorResponse(error);
  }
}
