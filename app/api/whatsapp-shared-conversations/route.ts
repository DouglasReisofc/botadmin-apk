import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { listSharedGroupsForUser } from "lib/bot-groups";
import { getInstanceById } from "lib/bot-instances";
import { listSharedConversationsForUser } from "lib/whatsapp-conversation-shares";
import {
  getWhatsappChatPhone,
  getWhatsappChatType,
  getWhatsappConversationThread,
  normalizeWhatsappChatJid,
  sanitizeWhatsappConversationThreadForTransport,
  type WhatsappConversationThread,
} from "lib/whatsapp-conversations";

type SharedThread = WhatsappConversationThread & {
  sharedAccess: true;
  shareKind: "group_admin" | "conversation";
};

const buildThread = (options: {
  ownerUserId: number;
  instanceId: number;
  chatJid: string;
  chatType?: WhatsappConversationThread["chatType"] | null;
  title?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  groupDescription?: string | null;
  participantsCount?: number | null;
  linkedGroupId?: number | null;
  inviteLink?: string | null;
  announceOnly?: boolean | null;
  shareKind: SharedThread["shareKind"];
}): SharedThread => {
  const now = new Date().toISOString();
  const chatType = options.chatType ?? getWhatsappChatType(options.chatJid);
  return {
    id: 0,
    userId: options.ownerUserId,
    instanceId: options.instanceId,
    chatJid: options.chatJid,
    chatType,
    title: options.title ?? null,
    phone: options.phone ?? getWhatsappChatPhone(options.chatJid),
    avatarUrl: options.avatarUrl ?? null,
    groupDescription: options.groupDescription ?? null,
    participantsCount: options.participantsCount ?? null,
    linkedGroupId: options.linkedGroupId ?? null,
    inviteLink: options.inviteLink ?? null,
    announceOnly: options.announceOnly ?? null,
    instanceIsAdmin: null,
    mentionable: chatType === "group" ? true : null,
    directorySource: chatType === "group" ? "groups" : "messages",
    lastMessagePreview: null,
    lastMessageAt: null,
    lastMessageDirection: null,
    lastMessageSenderName: null,
    lastMessageSenderJid: null,
    unreadCount: 0,
    createdAt: now,
    updatedAt: now,
    sharedAccess: true,
    shareKind: options.shareKind,
  };
};

const withSharedMetadata = (
  thread: WhatsappConversationThread | null,
  fallback: SharedThread,
): SharedThread => ({
  ...fallback,
  ...(thread ?? {}),
  title: thread?.title || fallback.title,
  phone: thread?.phone || fallback.phone,
  avatarUrl: thread?.avatarUrl || fallback.avatarUrl,
  groupDescription: thread?.groupDescription ?? fallback.groupDescription ?? null,
  participantsCount: thread?.participantsCount ?? fallback.participantsCount ?? null,
  linkedGroupId: thread?.linkedGroupId ?? fallback.linkedGroupId ?? null,
  inviteLink: thread?.inviteLink ?? fallback.inviteLink ?? null,
  announceOnly: thread?.announceOnly ?? fallback.announceOnly ?? null,
  instanceIsAdmin: thread?.instanceIsAdmin ?? fallback.instanceIsAdmin ?? null,
  mentionable: thread?.mentionable ?? fallback.mentionable ?? null,
  directorySource: thread?.directorySource ?? fallback.directorySource ?? null,
  sharedAccess: true,
  shareKind: fallback.shareKind,
});

const sortThreads = (threads: SharedThread[]) =>
  threads.sort((left, right) => {
    const leftTime = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
    const rightTime = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return (left.title || left.phone || left.chatJid).localeCompare(
      right.title || right.phone || right.chatJid,
      "pt-BR",
    );
  });

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const [sharedGroups, sharedConversations] = await Promise.all([
      listSharedGroupsForUser(user.id, { includeParticipants: false }),
      listSharedConversationsForUser(user.id),
    ]);
    const byKey = new Map<string, SharedThread>();

    for (const share of sharedConversations) {
      const chatJid = normalizeWhatsappChatJid(share.chatJid);
      if (!chatJid) continue;
      const instance = await getInstanceById(share.instanceId);
      if (!instance) continue;
      const fallback = buildThread({
        ownerUserId: share.ownerUserId,
        instanceId: instance.id,
        chatJid,
        chatType: share.chatType,
        title: share.title,
        phone: share.phone,
        avatarUrl: share.avatarUrl,
        linkedGroupId: share.linkedGroupId,
        shareKind: "conversation",
      });
      const stored = await getWhatsappConversationThread(share.ownerUserId, instance.id, chatJid);
      byKey.set(`${instance.id}:${chatJid}`, withSharedMetadata(stored, fallback));
    }

    for (const group of sharedGroups) {
      const chatJid = normalizeWhatsappChatJid(group.remoteId);
      if (!chatJid) continue;
      const instance = await getInstanceById(group.instanceId);
      if (!instance) continue;
      const fallback = buildThread({
        ownerUserId: group.userId,
        instanceId: instance.id,
        chatJid,
        chatType: "group",
        title: group.name || group.remoteId,
        avatarUrl: group.imageUrl,
        groupDescription: group.description,
        participantsCount: group.participantCount ?? group.participants.length,
        linkedGroupId: group.id,
        inviteLink: group.inviteLink,
        announceOnly: group.metadata.adminsOnly,
        shareKind: "group_admin",
      });
      const stored = await getWhatsappConversationThread(group.userId, instance.id, chatJid);
      byKey.set(`${instance.id}:${chatJid}`, withSharedMetadata(stored, fallback));
    }

    return NextResponse.json({
      threads: sortThreads(Array.from(byKey.values())).map(sanitizeWhatsappConversationThreadForTransport),
      directoryErrors: [],
    });
  } catch (error) {
    console.error("Failed to list shared WhatsApp conversations", error);
    return NextResponse.json(
      { message: "Não foi possível carregar conversas compartilhadas." },
      { status: 500 },
    );
  }
}
