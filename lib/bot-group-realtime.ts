import {
  recordWhatsappRealtimeEvent,
  type WhatsappRealtimeEvent,
} from "lib/whatsapp-conversations";
import { publishWhatsappRealtimeEvent } from "lib/whatsapp-realtime-bus";

type BotGroupRealtimeSource = {
  id?: number | string | null;
  instanceId?: number | string | null;
  remoteId?: string | null;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  participantCount?: number | null;
  participantsCount?: number | null;
  status?: string | null;
};

/**
 * Broadcast a bot-group mutation through the same sequence-ordered channel as
 * WhatsApp messages. This lets another browser/device update the robot
 * shortcut and settings without polling the entire directory.
 */
export const publishBotGroupRealtimeUpdate = async (
  recipientUserIds: number[],
  group: BotGroupRealtimeSource,
  action: string,
) => {
  const instanceId = Number(group.instanceId || 0);
  const chatJid = String(group.remoteId || "").trim();
  if (!Number.isFinite(instanceId) || instanceId <= 0 || !chatJid) return;
  const thread = {
    instanceId,
    chatJid,
    chatType: "group",
    title: String(group.name || chatJid),
    groupDescription: group.description || null,
    avatarUrl: group.imageUrl || null,
    linkedGroupId: Number(group.id || 0) || null,
    participantsCount: Number(
      group.participantCount ?? group.participantsCount ?? 0,
    ),
    internalBotEnabled: ["active", "ativo", "enabled"].includes(
      String(group.status || "").trim().toLowerCase(),
    ),
  };
  const ids = Array.from(
    new Set(recipientUserIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)),
  );
  await Promise.all(
    ids.map(async (userId) => {
      try {
        const event = await recordWhatsappRealtimeEvent({
          userId,
          instanceId,
          chatJid,
          eventType: "chat.action",
          payload: { action, thread },
        });
        if (event) publishWhatsappRealtimeEvent(event as WhatsappRealtimeEvent);
      } catch (error) {
        // Realtime fan-out is best effort and must never make a successful
        // settings mutation fail for the user who initiated it.
        console.warn("[bot-group-realtime] failed to publish update", {
          userId,
          instanceId,
          chatJid,
          action,
          error,
        });
      }
    }),
  );
};
