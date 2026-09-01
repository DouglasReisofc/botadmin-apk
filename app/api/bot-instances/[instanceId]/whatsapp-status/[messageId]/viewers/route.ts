import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { resolveChatConversationAccess } from "lib/whatsapp-conversation-access";
import { listWhatsappStatusViewersForUser } from "lib/whatsapp-conversations";

type Context = {
  params: Promise<{ instanceId: string; messageId: string }>;
};

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export async function GET(_request: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const params = await Promise.resolve(context.params);
  const instanceId = parseInstanceId(params.instanceId);
  const messageId = decodeURIComponent(params.messageId || "").trim();
  if (!instanceId || !messageId) {
    return NextResponse.json({ message: "Status inválido." }, { status: 400 });
  }

  const access = await resolveChatConversationAccess(user.id, instanceId, "status@broadcast");
  if (!access) {
    return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
  }

  const viewers = await listWhatsappStatusViewersForUser(
    access.storageUserId,
    access.instance.id,
    messageId,
  );

  return NextResponse.json({ viewers });
}
