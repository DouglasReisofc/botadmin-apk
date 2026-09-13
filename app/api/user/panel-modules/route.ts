import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getCurrentUser } from "lib/auth";
import { getDb } from "lib/db";
import { PANEL_MODULES, validModulePreference } from "lib/panel-modules";

async function prepare() {
  const db = getDb();
  await db.query(`CREATE TABLE IF NOT EXISTS user_panel_modules (
    user_id BIGINT NOT NULL, panel_scope VARCHAR(16) NOT NULL,
    module_key VARCHAR(40) NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, panel_scope, module_key)
  )`);
  return db;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope !== "user" && scope !== "admin") return NextResponse.json({ message: "Painel inválido." }, { status: 400 });
    if (scope === "admin" && user.role !== "admin") return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    const db = await prepare();
    const [rows] = await db.query<RowDataPacket[]>("SELECT module_key, enabled FROM user_panel_modules WHERE user_id = ? AND panel_scope = ?", [user.id, scope]);
    const enabled = rows.filter(row => Number(row.enabled) === 1 && (PANEL_MODULES[scope] as readonly string[]).includes(row.module_key)).map(row => row.module_key);
    return NextResponse.json({ enabled }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[panel-modules] load failed", error);
    return NextResponse.json({ message: "Não foi possível carregar seus módulos." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ message: "Origem inválida." }, { status: 403 });
    const input: unknown = await request.json().catch(() => null);
    if (!validModulePreference(input)) return NextResponse.json({ message: "Módulo ou estado inválido." }, { status: 400 });
    if (input.scope === "admin" && user.role !== "admin") return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    const db = await prepare();
    await db.query(`INSERT INTO user_panel_modules (user_id, panel_scope, module_key, enabled) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`, [user.id, input.scope, input.module, input.enabled ? 1 : 0]);
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("[panel-modules] save failed", error);
    return NextResponse.json({ message: "Não foi possível salvar. Tente novamente." }, { status: 500 });
  }
}
