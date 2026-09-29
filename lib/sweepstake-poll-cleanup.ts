import { deleteMessageForEveryone, pinMessageInChat, type WuzapiClient } from "./wuzapi";
import { deleteWhatsappConversationMessageForUser, recordWhatsappRealtimeEvent } from "./whatsapp-conversations";
import { publishWhatsappRealtimeEvent } from "./whatsapp-realtime-bus";
import { normalizeJid } from "./whatsapp";

export async function cleanupSweepstakePoll(client: WuzapiClient, target: {
  userId: number; instanceId: number; groupJid: string; pollMessageId: string; phone: string;
}) {
  if (!target.pollMessageId || !target.phone) throw new Error("Enquete sem chave ou remetente para remoção");
  const key = { chatId: target.groupJid, messageId: target.pollMessageId.replace(/^me:/, ""),
    participant: `${normalizeJid(target.phone)}@s.whatsapp.net`, fromMe: true };
  let unpinned = false;
  let deleted = false;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3 && (!unpinned || !deleted); attempt++) {
    if (!unpinned) {
      try { await pinMessageInChat(client, { ...key, pinned: false }); unpinned = true; }
      catch (error) { lastError = error; }
    }
    if (!deleted) {
      try { await deleteMessageForEveryone(client, key); deleted = true; }
      catch (error) { lastError = error; }
    }
  }
  if (!unpinned || !deleted) throw lastError ?? new Error("Remoção da enquete pendente");
  await deleteWhatsappConversationMessageForUser(target.userId, target.instanceId, target.groupJid, target.pollMessageId);
  const event = await recordWhatsappRealtimeEvent({
    userId: target.userId, instanceId: target.instanceId, chatJid: target.groupJid,
    eventType: "chat.action", messageId: target.pollMessageId,
    payload: { action: "sweepstake.poll.removed", messageId: target.pollMessageId },
  });
  if (event) publishWhatsappRealtimeEvent(event);
}
