import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  ensureSubscriptionPlanTable,
  ensureUserPlanPaymentTable,
  ensureUserTable,
  getDb,
} from "lib/db";
import { emitPurchaseCreated } from "lib/realtime";

const SIMULATED_PROVIDER = "botadmin_simulator";

export async function POST() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    await Promise.all([
      ensureUserTable(),
      ensureSubscriptionPlanTable(),
      ensureUserPlanPaymentTable(),
    ]);

    const db = getDb();
    const [planRows] = await db.query<any[]>(
      `SELECT id, name, price FROM subscription_plans WHERE is_active = 1 ORDER BY price DESC, id ASC LIMIT 1`,
    );
    const plan = planRows[0] || { id: 1, name: "Plano Mensal", price: 25 };
    const amount = Number.parseFloat(String(plan.price || 25));
    const providerPaymentId = `sim-${Date.now()}`;

    const [result] = await db.query<any>(
      `
        INSERT INTO user_plan_payments (
          user_id,
          plan_id,
          subscription_id,
          provider,
          provider_payment_id,
          status,
          status_detail,
          amount,
          currency,
          metadata
        ) VALUES (?, ?, NULL, ?, ?, 'approved', 'simulated', ?, 'BRL', ?)
      `,
      [
        currentUser.id,
        Number(plan.id),
        SIMULATED_PROVIDER,
        providerPaymentId,
        Number.isFinite(amount) ? amount : 25,
        JSON.stringify({
          simulated: true,
          paymentType: "plan_purchase",
          context: { mode: "admin_tv_test" },
          createdAt: new Date().toISOString(),
        }),
      ],
    );

    // A simulação é deliberadamente isolada: registra a venda marcada como
    // simulada e publica apenas o evento em tempo real para o painel admin.
    emitPurchaseCreated({
      userId: currentUser.id,
      purchase: {
        categoryName: String(plan.name || "Plano Mensal"),
        categoryPrice: Number.isFinite(amount) ? amount : 25,
        customerName: currentUser.name || currentUser.email || `Usuário #${currentUser.id}`,
        customerWhatsapp: currentUser.whatsappNumber ?? null,
        purchasedAt: new Date().toISOString(),
        productDetails: "teste controlado do painel admin",
      },
    });

    return NextResponse.json({
      ok: true,
      eventId: result.insertId,
      providerPaymentId,
      message: "Venda simulada registrada.",
    });
  } catch (error) {
    console.error("Failed to simulate admin sale", error);
    return NextResponse.json(
      { message: "Não foi possível simular a venda." },
      { status: 500 },
    );
  }
}
