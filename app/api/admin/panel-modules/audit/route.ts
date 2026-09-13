import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getDb } from "lib/db";
import { ensurePanelModuleGovernanceTable } from "lib/panel-module-governance";

type AuditRow = RowDataPacket & {
  id: number;
  actor_user_id: number;
  target_user_id: number;
  panel_scope: string;
  module_key: string;
  action: string;
  previous_value: string | null;
  next_value: string | null;
  created_at: Date | string;
  actor_name: string | null;
  actor_email: string | null;
  target_name: string | null;
  target_email: string | null;
};

const parseJson = (value: string | null): unknown => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export async function GET(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }
    await ensurePanelModuleGovernanceTable();
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") || 80);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(200, Math.floor(rawLimit)))
      : 80;
    const [rows] = await getDb().query<AuditRow[]>(
      `SELECT l.id, l.actor_user_id, l.target_user_id, l.panel_scope,
              l.module_key, l.action, l.previous_value, l.next_value,
              l.created_at, actor.name AS actor_name,
              actor.email AS actor_email, target.name AS target_name,
              target.email AS target_email
         FROM panel_module_audit_logs l
         LEFT JOIN users actor ON actor.id = l.actor_user_id
         LEFT JOIN users target ON target.id = l.target_user_id
        ORDER BY l.id DESC
        LIMIT ?`,
      [limit],
    );
    return NextResponse.json(
      {
        audit: rows.map((row) => ({
          id: Number(row.id),
          actorUserId: Number(row.actor_user_id),
          actorName: row.actor_name || row.actor_email || `Usuário #${row.actor_user_id}`,
          targetUserId: Number(row.target_user_id),
          targetName: row.target_name || row.target_email || `Usuário #${row.target_user_id}`,
          scope: row.panel_scope,
          module: row.module_key,
          action: row.action,
          previous: parseJson(row.previous_value),
          next: parseJson(row.next_value),
          createdAt: new Date(row.created_at).toISOString(),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[admin-panel-modules-audit] load failed", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o histórico dos módulos." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
