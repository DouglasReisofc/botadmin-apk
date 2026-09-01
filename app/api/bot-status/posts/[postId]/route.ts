import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { ensureBotAdCampaignStatusPostTable, getDb } from "lib/db";
import { getInstanceForUser } from "lib/bot-instances";
import { markStatusPostDeleted } from "lib/bot-ad-campaigns";
import { deleteStatusUpdate } from "lib/wuzapi";
import {
  deleteWhatsappConversationMessageForUser,
  recordWhatsappRealtimeEvent,
} from "lib/whatsapp-conversations";
import { publishWhatsappRealtimeEvent } from "lib/whatsapp-realtime-bus";

type PostRow = {
  id: number;
  post_id: string;
  instance_id: number;
  message_id: string | null;
};

type PostRouteContext = { params: Promise<{ postId: string }> };

const resolvePostId = async (
  context: PostRouteContext,
  request: Request,
): Promise<string | null> => {
  const params = await Promise.resolve(context.params);
  const fromParams = typeof params?.postId === "string" ? params.postId.trim() : "";
  if (fromParams) {
    return fromParams;
  }
  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const fromPath = (path[path.length - 1] ?? "").trim();
    return fromPath || null;
  } catch {
    return null;
  }
};

const findPostByUser = async (userId: number, postId: string): Promise<PostRow | null> => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  const [rows] = await db.query<PostRow[]>(
    `
      SELECT sp.id, sp.post_id, sp.instance_id, sp.message_id
      FROM bot_ad_campaign_status_posts sp
      INNER JOIN bot_ad_campaigns c ON c.id = sp.campaign_id
      WHERE c.user_id = ?
        AND c.deleted_at IS NULL
        AND sp.deleted_at IS NULL
        AND sp.post_id = ?
      LIMIT 1
    `,
    [userId, postId],
  );
  return rows[0] ?? null;
};

export async function DELETE(
  request: Request,
  context: PostRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const postId = await resolvePostId(context, request);
    if (!postId) {
      return NextResponse.json({ message: "Status inválido." }, { status: 400 });
    }

    const post = await findPostByUser(user.id, postId);
    if (!post) {
      return NextResponse.json({ message: "Status não encontrado." }, { status: 404 });
    }

    let errorMessage: string | null = null;
    if (post.message_id) {
      const instance = await getInstanceForUser(user.id, post.instance_id);
      if (!instance) {
        errorMessage = "Instância não encontrada para apagar o status.";
      } else {
        try {
          await deleteStatusUpdate(
            {
              baseUrl: instance.serverBaseUrl,
              token: instance.token,
            },
            { id: post.message_id },
          );
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : "Erro ao apagar status no WhatsApp.";
        }
      }
    }

    await markStatusPostDeleted(post.id, post.message_id ?? null, errorMessage);
    if (post.message_id) {
      await deleteWhatsappConversationMessageForUser(
        user.id,
        post.instance_id,
        "status@broadcast",
        post.message_id,
      );
      try {
        const event = await recordWhatsappRealtimeEvent({
          userId: user.id,
          instanceId: post.instance_id,
          chatJid: "status@broadcast",
          eventType: "status.update",
          messageId: post.message_id,
          payload: {
            eventType: "status.deleted",
            action: "deleted",
            deletedMessageId: post.message_id,
            status: {
              id: post.message_id,
              messageId: post.message_id,
              action: "deleted",
              fromMe: true,
            },
          },
        });
        if (event) {
          publishWhatsappRealtimeEvent(event);
        }
      } catch (publishError) {
        console.warn("Failed to publish deleted status event", publishError);
      }
    }
    return NextResponse.json({
      message: errorMessage
        ? `Status removido do histórico com aviso: ${errorMessage}`
        : "Status removido com sucesso.",
      deletedMessageId: post.message_id ?? null,
    });
  } catch (error) {
    console.error("Failed to delete posted status", error);
    return NextResponse.json(
      { message: "Não foi possível remover o status." },
      { status: 500 },
    );
  }
}
