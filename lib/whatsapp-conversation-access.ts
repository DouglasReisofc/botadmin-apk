import { getInstanceById, getInstanceForUser } from "lib/bot-instances";
import { getGroupAccessForUser, listSharedGroupsForUser } from "lib/bot-groups";
import {
  getConversationShareAccessForUser,
  listSharedConversationsForUser,
} from "lib/whatsapp-conversation-shares";
import { normalizeWhatsappChatJid } from "lib/whatsapp-conversations";
import type { BotGroup } from "types/bot-groups";
import type { BotInstance } from "types/bot-instances";

export type WhatsappConversationAccess = {
  instance: BotInstance;
  storageUserId: number;
  isOwnerInstance: boolean;
  sharedGroups: BotGroup[];
  allowedChatJids: Set<string>;
};

export const resolveInstanceConversationAccess = async (
  userId: number,
  instanceId: number,
): Promise<WhatsappConversationAccess | null> => {
  const ownInstance = await getInstanceForUser(userId, instanceId);
  if (ownInstance) {
    return {
      instance: ownInstance,
      storageUserId: userId,
      isOwnerInstance: true,
      sharedGroups: [],
      allowedChatJids: new Set(),
    };
  }

  const sharedGroups = (await listSharedGroupsForUser(userId, { includeParticipants: false }))
    .filter((group) => group.instanceId === instanceId);
  const sharedConversations = (await listSharedConversationsForUser(userId))
    .filter((share) => share.instanceId === instanceId);
  if (sharedGroups.length === 0 && sharedConversations.length === 0) {
    return null;
  }

  const instance = await getInstanceById(instanceId);
  if (!instance) {
    return null;
  }

  const allowedChatJids = new Set(
    [
      ...sharedGroups.map((group) => group.remoteId),
      ...sharedConversations.map((share) => share.chatJid),
    ]
      .map((jid) => normalizeWhatsappChatJid(jid))
      .filter((jid): jid is string => Boolean(jid)),
  );

  return {
    instance,
    storageUserId: instance.userId,
    isOwnerInstance: false,
    sharedGroups,
    allowedChatJids,
  };
};

export const resolveChatConversationAccess = async (
  userId: number,
  instanceId: number,
  chatJid: string,
): Promise<WhatsappConversationAccess | null> => {
  const normalizedChatJid = normalizeWhatsappChatJid(chatJid);
  if (!normalizedChatJid) {
    return null;
  }

  const ownInstance = await getInstanceForUser(userId, instanceId);
  if (ownInstance) {
    return {
      instance: ownInstance,
      storageUserId: userId,
      isOwnerInstance: true,
      sharedGroups: [],
      allowedChatJids: new Set(),
    };
  }

  const instance = await getInstanceById(instanceId);
  if (!instance) {
    return null;
  }

  const sharedGroups = (await listSharedGroupsForUser(userId, { includeParticipants: false }))
    .filter((group) => group.instanceId === instanceId);
  const allowedGroup = sharedGroups.some((group) => normalizeWhatsappChatJid(group.remoteId) === normalizedChatJid);
  const allowedConversation = await getConversationShareAccessForUser(userId, instanceId, normalizedChatJid);
  if (!allowedGroup && !allowedConversation) {
    return null;
  }

  return {
    instance,
    storageUserId: instance.userId,
    isOwnerInstance: false,
    sharedGroups,
    allowedChatJids: new Set([
      ...sharedGroups
        .map((group) => normalizeWhatsappChatJid(group.remoteId))
        .filter((jid): jid is string => Boolean(jid)),
      ...(allowedConversation ? [allowedConversation.chatJid] : []),
    ]),
  };
};

export const resolveGroupAccessOwnerUserId = async (
  userId: number,
  groupId: number,
): Promise<number | null> => {
  const access = await getGroupAccessForUser(userId, groupId);
  return access?.ownerUserId ?? null;
};
