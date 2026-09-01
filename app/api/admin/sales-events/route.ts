import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";

import { getCurrentUser } from "lib/auth";
import {
  ensureSubscriptionPlanTable,
  ensureUserPlanPaymentTable,
  ensureUserTable,
  getDb,
} from "lib/db";

type AdminSaleRow = RowDataPacket & {
  id: number;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  plan_id: number;
  plan_name: string | null;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

const formatIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const parseAfter = (value: string | null): number => {
  const parsed = Number.parseInt(value || "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const parseLimit = (value: string | null): number => {
  const parsed = Number.parseInt(value || "20", 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(1, parsed));
};

const metadataContextLabel = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    const metadata = JSON.parse(raw) as Record<string, unknown>;
    const context = metadata.context && typeof metadata.context === "object"
      ? metadata.context as Record<string, unknown>
      : null;
    const mode = typeof context?.mode === "string" ? context.mode : null;
    if (mode === "group_activation") return "ativação de grupo";
    if (mode === "group_renewal") return "renovação de grupo";
    if (mode === "instance_creation") return "novo perfil";
    if (mode === "instance_renewal") return "renovação de perfil";
    const paymentType = typeof metadata.paymentType === "string" ? metadata.paymentType : null;
    if (paymentType === "plan_addon") return "extra do plano";
    if (paymentType === "plan_purchase") return "assinatura";
  } catch {}
  return null;
};

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const url = new URL(request.url);
    const after = parseAfter(url.searchParams.get("after"));
    const limit = parseLimit(url.searchParams.get("limit"));

    await Promise.all([
      ensureUserTable(),
      ensureSubscriptionPlanTable(),
      ensureUserPlanPaymentTable(),
    ]);

    const db = getDb();
    const [latestRows] = await db.query<(RowDataPacket & { latest_id: number | null })[]>(
      `
        SELECT MAX(id) AS latest_id
        FROM user_plan_payments
        WHERE LOWER(status) IN ('approved', 'paid', 'active', 'completed')
      `,
    );
    const latestApprovedId = Number(latestRows[0]?.latest_id || 0);

    const [rows] = await db.query<AdminSaleRow[]>(
      `
        SELECT
          upp.id,
          upp.user_id,
          u.name AS user_name,
          u.email AS user_email,
          upp.plan_id,
          sp.name AS plan_name,
          upp.provider,
          upp.status,
          upp.amount,
          upp.currency,
          upp.metadata,
          upp.created_at,
          upp.updated_at
        FROM user_plan_payments upp
        LEFT JOIN users u ON u.id = upp.user_id
        LEFT JOIN subscription_plans sp ON sp.id = upp.plan_id
        WHERE upp.id > ? AND LOWER(upp.status) IN ('approved', 'paid', 'active', 'completed')
        ORDER BY upp.id ASC
        LIMIT ?
      `,
      [after, limit],
    );

    const events = rows.map((row) => {
      const amount = Number.parseFloat(String(row.amount || "0"));
      const customerName = row.user_name || row.user_email || `Usuário #${row.user_id}`;
      const planName = row.plan_name || `Plano #${row.plan_id}`;
      const contextLabel = metadataContextLabel(row.metadata);
      const amountLabel = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: row.currency || "BRL",
      }).format(Number.isFinite(amount) ? amount : 0);
      return {
        id: row.id,
        userId: row.user_id,
        customerName,
        customerEmail: row.user_email,
        planId: row.plan_id,
        planName,
        provider: row.provider,
        status: row.status,
        amount: Number.isFinite(amount) ? amount : 0,
        currency: row.currency || "BRL",
        context: contextLabel,
        title: "Nova venda no painel",
        message: `${customerName} assinou ${planName} no valor de ${amountLabel}${contextLabel ? ` (${contextLabel})` : ""}.`,
        createdAt: formatIso(row.updated_at),
        updatedAt: formatIso(row.updated_at),
      };
    });

    const latestId = Math.max(latestApprovedId, events.length > 0 ? events[events.length - 1].id : after);
    return NextResponse.json({ events, latestId });
  } catch (error) {
    console.error("Failed to load admin sales events", error);
    return NextResponse.json(
      { message: "Não foi possível carregar eventos de vendas." },
      { status: 500 },
    );
  }
}
