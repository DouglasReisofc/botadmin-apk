import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import { listSupportThreads, buildSupportThreadSummary } from "lib/support";
import { findActiveUserByWhatsappId } from "lib/users";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    let threads = await listSupportThreads(user.id);

    // Conversas internas com suporte sempre usam o identificador canônico "__admin__".
    // O número público do suporte fica apenas como displayWhatsappId para não quebrar
    // seleção, realtime e contadores quando o admin responde pelo painel.
    const adminRow = await getAdminWebhookRow();
    const adminDigits = (adminRow?.phone_number || "").toString().replace(/\D+/g, "");
    const supportThreadId = "__admin__";

    if (supportThreadId) {
      const { mergeSupportThreadAlias, getOrCreateSupportThread } = await import("lib/support");

      // Se houver registros antigos com número do admin ou com o próprio número do usuário,
      // migra para "__admin__" para manter a conversa única e sincronizada.
      const userDigits = (user.whatsappNumber || "").replace(/\D+/g, "");

      if (adminDigits && threads.some((t) => t.whatsappId === adminDigits)) {
        await mergeSupportThreadAlias(user.id, adminDigits, supportThreadId, {
          customerName: "Suporte Bot Admin",
          profileName: "Equipe StoreBot",
        });
        threads = await listSupportThreads(user.id);
      }

      if (userDigits && threads.some((t) => t.whatsappId === userDigits)) {
        await mergeSupportThreadAlias(user.id, userDigits, supportThreadId, {
          customerName: "Suporte Bot Admin",
          profileName: "Equipe StoreBot",
        });
        threads = await listSupportThreads(user.id);
      }

      if (!threads.some((thread) => thread.whatsappId === supportThreadId)) {
        const supportThread = await getOrCreateSupportThread(user.id, supportThreadId, {
          customerName: "Suporte Bot Admin",
          profileName: "Equipe StoreBot",
        });
        threads = [supportThread, ...threads];
      }
    }

    const adminPhoneNumber = adminRow?.phone_number?.trim() || null;
    const supportAgent = adminDigits
      ? await findActiveUserByWhatsappId(adminDigits).catch(() => null)
      : null;
    const supportAgentName = supportAgent?.name?.trim() || "";
    const supportName = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(supportAgentName)
      ? supportAgentName
      : process.env.DEFAULT_ADMIN_NAME?.trim() || "Administrador";

    const summaries = await Promise.all(
      threads.map(async (thread) => {
        const summary = await buildSupportThreadSummary(user.id, thread);
        if (
          supportThreadId &&
          thread.whatsappId === supportThreadId
        ) {
          return {
            ...summary,
            displayWhatsappId: adminPhoneNumber,
            supportName,
            supportAvatarUrl:
              supportAgent?.avatarUrl || "/images/brand/botadmin-logo.png",
            supportRole:
              supportAgent?.role === "admin" ? "Administrador" : "Suporte",
          };
        }
        return summary;
      }),
    );

    return NextResponse.json({ threads: summaries });
  } catch (error) {
    console.error("Failed to list support threads", error);
    return NextResponse.json({ message: "Erro ao listar conversas." }, { status: 500 });
  }
}
