import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotGroupError, listDiscoverableGroupsForInstance, listGroupsForUser } from "lib/bot-groups";
import { BotInstanceError, refreshInstanceStatus } from "lib/bot-instances";
import { getGroupInfo, getUserAvatar, listUserChannels, listUserContacts } from "lib/wuzapi";
import { resolveInstanceConversationAccess } from "lib/whatsapp-conversation-access";
import {
  getWhatsappChatPhone,
  getWhatsappChatType,
  listKnownWhatsappSenderIdentitiesForUser,
  listWhatsappConversationThreads,
  normalizeWhatsappChatJid,
  restoreWhatsappConversationThreadsFromRealtimeEvents,
  sanitizeWhatsappConversationThreadForTransport,
  upsertWhatsappConversation,
  type WhatsappConversationThread,
} from "lib/whatsapp-conversations";

// Directory calls (contacts/groups/channels) are much more expensive than
// reading the local conversation index. Coalesce them per instance so opening
// the panel in two tabs or a silent refresh cannot create a burst of upstream
// requests (and trigger provider rate limits).
const directorySyncAt = new Map<number, number>();
const DIRECTORY_SYNC_COOLDOWN_MS = 30_000;
import type { BotGroup } from "types/bot-groups";

type Context = { params: Promise<{ instanceId: string }> };

const parseInstanceId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeIdentityText = (value: string | null | undefined) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeIdentityDigits = (value: string | null | undefined) => {
  const text = (value || "").trim();
  if (!text) return "";
  const localPart = text.includes("@") ? text.split("@")[0] ?? "" : text;
  const withoutDeviceSuffix = localPart.split(":")[0] ?? localPart;
  return withoutDeviceSuffix.replace(/\D+/g, "");
};

const hasMatchingIdentityDigits = (left: string, right: string) => {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 8 && right.length >= 8) {
    return left.endsWith(right) || right.endsWith(left);
  }
  return false;
};

const isLikelyWhatsappGroupDigits = (value: string | null | undefined) =>
  /^120363\d{6,}$/.test(normalizeIdentityDigits(value));

const isPhoneLikeTitle = (title: string | null | undefined, chatJid: string) => {
  const titleDigits = normalizeIdentityDigits(title);
  if (titleDigits.length < 8) return false;
  const jidDigits = normalizeIdentityDigits(chatJid);
  return hasMatchingIdentityDigits(titleDigits, jidDigits);
};

const resolveSavedGroupInstanceIsAdmin = (group: BotGroup): boolean | null => {
  const instanceDigits = normalizeIdentityDigits(group.instancePhone);
  if (!instanceDigits) return true;

  const ownerDigits = normalizeIdentityDigits(group.owner);
  if (hasMatchingIdentityDigits(instanceDigits, ownerDigits)) {
    return true;
  }

  const participants = Array.isArray(group.participants) ? group.participants : [];
  const hasParticipantContext = Boolean(ownerDigits) || participants.length > 0;
  if (!hasParticipantContext) {
    return null;
  }

  const hasAdminParticipantData = participants.some((participant) => participant.admin !== "member");
  if (!ownerDigits && !hasAdminParticipantData) {
    return null;
  }

  return participants.some((participant) => {
    if (participant.admin === "member") return false;
    return (
      hasMatchingIdentityDigits(instanceDigits, normalizeIdentityDigits(participant.id)) ||
      hasMatchingIdentityDigits(instanceDigits, normalizeIdentityDigits(participant.phone))
    );
  });
};

const isPlaceholderTitle = (
  title: string | null | undefined,
  chatJid: string,
  invalidTitles: Set<string> = new Set(),
) => {
  const normalizedTitle = (title || "").trim().toLowerCase();
  if (!normalizedTitle) return true;
  if (
    normalizedTitle === "grupo" ||
    normalizedTitle === "group" ||
    normalizedTitle === "comunidade" ||
    normalizedTitle === "community" ||
    normalizedTitle === "canal" ||
    normalizedTitle === "channel"
  ) return true;
  const normalizedJid = chatJid.trim().toLowerCase();
  if (normalizedTitle === normalizedJid) return true;
  if (invalidTitles.has(normalizeIdentityText(title))) return true;
  const titleDigits = normalizeIdentityDigits(title);
  if (titleDigits && invalidTitles.has(titleDigits)) return true;
  const chatType = getWhatsappChatType(chatJid);
  if (chatType === "contact" && isLikelyWhatsappGroupDigits(chatJid)) return true;
  if (chatType === "group" && titleDigits.length >= 12) {
    const jidDigits = normalizeIdentityDigits(chatJid);
    if (titleDigits === jidDigits || titleDigits.startsWith("120363")) return true;
  }
  if (
    normalizedTitle.endsWith("@g.us") ||
    normalizedTitle.endsWith("@newsletter") ||
    normalizedTitle.endsWith("@s.whatsapp.net") ||
    normalizedTitle.endsWith("@c.us") ||
    normalizedTitle.endsWith("@broadcast")
  ) return true;
  return /^\d{8,}@/.test(normalizedTitle);
};

const shouldPreferDirectoryTitle = (
  current: WhatsappConversationThread,
  incoming: WhatsappConversationThread,
  invalidTitles: Set<string> = new Set(),
) => {
  if (!incoming.title || isPlaceholderTitle(incoming.title, incoming.chatJid, invalidTitles)) return false;
  const incomingIsDirectory =
    incoming.directorySource === "groups" ||
    incoming.directorySource === "channels" ||
    incoming.directorySource === "contacts";
  if (!incomingIsDirectory) return false;
  const incomingType = incoming.chatType === "unknown" ? getWhatsappChatType(incoming.chatJid) : incoming.chatType;
  if (incomingType === "contact") {
    if (isPhoneLikeTitle(incoming.title, incoming.chatJid)) return false;
    return (
      isPlaceholderTitle(current.title, current.chatJid, invalidTitles) ||
      isPhoneLikeTitle(current.title, current.chatJid)
    );
  }
  if (
    incomingType !== "group" &&
    incomingType !== "community" &&
    incomingType !== "channel"
  ) {
    return false;
  }
  if (isPlaceholderTitle(current.title, current.chatJid, invalidTitles)) return true;
  return normalizeIdentityText(current.title) !== normalizeIdentityText(incoming.title);
};

const shouldPreferThreadAvatar = (
  current: WhatsappConversationThread,
  incoming: WhatsappConversationThread,
) => {
  const incomingAvatar = incoming.avatarUrl?.trim();
  if (!incomingAvatar) return false;
  const currentAvatar = current.avatarUrl?.trim();
  if (!currentAvatar) return true;
  if (currentAvatar === incomingAvatar) return false;
  return Boolean(incoming.directorySource);
};

const mergeThread = (
  map: Map<string, WhatsappConversationThread>,
  thread: WhatsappConversationThread | null,
  options: { invalidTitles?: Set<string> } = {},
) => {
  if (!thread) return;
  const current = map.get(thread.chatJid);
  if (!current) {
    map.set(thread.chatJid, thread);
    return;
  }
  const incomingHasFreshGroupControls = Boolean(
    thread.directorySource === "groups" &&
      (thread.chatType === "group" || thread.chatType === "community") &&
      (thread.announceOnly !== null ||
        thread.instanceIsAdmin !== null ||
        thread.mentionable !== null ||
        thread.participantsCount !== null),
  );
  const incomingHasFreshCapabilities = Boolean(
    thread.directorySource &&
      (thread.canSendMessages !== null ||
        thread.readOnlyReason !== null ||
        thread.channelRole !== null),
  );
  map.set(thread.chatJid, {
    ...current,
    title: shouldPreferDirectoryTitle(current, thread, options.invalidTitles)
      ? thread.title
      : isPlaceholderTitle(current.title, current.chatJid, options.invalidTitles)
      ? thread.title || current.title
      : current.title,
    phone: current.phone || thread.phone,
    avatarUrl: shouldPreferThreadAvatar(current, thread)
      ? thread.avatarUrl
      : current.avatarUrl || thread.avatarUrl,
    chatType:
      thread.chatType === "community"
        ? "community"
        : current.chatType === "unknown"
          ? thread.chatType
          : current.chatType,
    groupDescription: current.groupDescription ?? thread.groupDescription ?? null,
    participantsCount: incomingHasFreshGroupControls
      ? thread.participantsCount ?? current.participantsCount ?? null
      : current.participantsCount ?? thread.participantsCount ?? null,
    linkedGroupId: current.linkedGroupId ?? thread.linkedGroupId ?? null,
    inviteLink: current.inviteLink ?? thread.inviteLink ?? null,
    announceOnly: incomingHasFreshGroupControls
      ? thread.announceOnly ?? current.announceOnly ?? null
      : current.announceOnly ?? thread.announceOnly ?? null,
    instanceIsAdmin: incomingHasFreshGroupControls
      ? thread.instanceIsAdmin ?? current.instanceIsAdmin ?? null
      : current.instanceIsAdmin ?? thread.instanceIsAdmin ?? null,
    mentionable: incomingHasFreshGroupControls
      ? thread.mentionable ?? current.mentionable ?? null
      : current.mentionable ?? thread.mentionable ?? null,
    canSendMessages: incomingHasFreshCapabilities
      ? thread.canSendMessages ?? current.canSendMessages ?? null
      : current.canSendMessages ?? thread.canSendMessages ?? null,
    readOnlyReason: incomingHasFreshCapabilities
      ? thread.readOnlyReason ?? null
      : current.readOnlyReason ?? thread.readOnlyReason ?? null,
    channelRole: incomingHasFreshCapabilities
      ? thread.channelRole ?? current.channelRole ?? null
      : current.channelRole ?? thread.channelRole ?? null,
    directorySource: current.directorySource ?? thread.directorySource ?? null,
    muted: current.muted || thread.muted,
  });
};

const persistThreadIdentityIfUseful = async (
  current: WhatsappConversationThread | undefined,
  candidate: WhatsappConversationThread,
  invalidTitles: Set<string>,
) => {
  if (!current) return;
  const hasUsefulTitle = Boolean(
    candidate.title &&
    !isPlaceholderTitle(candidate.title, candidate.chatJid, invalidTitles),
  );
  const shouldReplaceStaleDirectoryTitle = Boolean(
    current &&
    shouldPreferDirectoryTitle(current, candidate, invalidTitles),
  );
  const shouldPersistTitle =
    hasUsefulTitle &&
    (isPlaceholderTitle(current.title, current.chatJid, invalidTitles) || shouldReplaceStaleDirectoryTitle);
  const shouldPersistPhone = !current.phone && Boolean(candidate.phone);
  const shouldPersistAvatar = Boolean(
    candidate.avatarUrl &&
      (!current.avatarUrl || current.avatarUrl.trim() !== candidate.avatarUrl.trim()),
  );
  const shouldPersistChatType =
    candidate.chatType === "community" && current.chatType !== "community";
  const shouldPersistCapabilities = Boolean(
    candidate.canSendMessages !== null &&
      (candidate.canSendMessages !== current.canSendMessages ||
        candidate.readOnlyReason !== current.readOnlyReason ||
        candidate.channelRole !== current.channelRole ||
        candidate.announceOnly !== current.announceOnly ||
        candidate.instanceIsAdmin !== current.instanceIsAdmin ||
        candidate.mentionable !== current.mentionable),
  );

  if (
    !shouldPersistTitle &&
    !shouldPersistPhone &&
    !shouldPersistAvatar &&
    !shouldPersistChatType &&
    !shouldPersistCapabilities
  ) {
    return;
  }

  try {
    await upsertWhatsappConversation({
      userId: candidate.userId,
      instanceId: candidate.instanceId,
      chatJid: candidate.chatJid,
      chatType: candidate.chatType,
      title: shouldPersistTitle ? candidate.title : null,
      phone: shouldPersistPhone ? candidate.phone : null,
      avatarUrl: shouldPersistAvatar ? candidate.avatarUrl : null,
      groupDescription: candidate.groupDescription,
      participantsCount: candidate.participantsCount,
      linkedGroupId: candidate.linkedGroupId,
      inviteLink: candidate.inviteLink,
      announceOnly: candidate.announceOnly,
      instanceIsAdmin: candidate.instanceIsAdmin,
      mentionable: candidate.mentionable,
      canSendMessages: candidate.canSendMessages,
      readOnlyReason: candidate.readOnlyReason,
      channelRole: candidate.channelRole,
      directorySource: candidate.directorySource,
    });
  } catch (error) {
    console.warn("[whatsapp-conversations] failed to persist thread identity", {
      chatJid: candidate.chatJid,
      error,
    });
  }
};

const buildDirectoryThread = (options: {
  userId: number;
  instanceId: number;
  chatJid: string;
  chatType: WhatsappConversationThread["chatType"];
  title?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  groupDescription?: string | null;
  participantsCount?: number | null;
  linkedGroupId?: number | null;
  inviteLink?: string | null;
  announceOnly?: boolean | null;
  instanceIsAdmin?: boolean | null;
  mentionable?: boolean | null;
  canSendMessages?: boolean | null;
  readOnlyReason?: string | null;
  channelRole?: string | null;
  directorySource?: WhatsappConversationThread["directorySource"];
}): WhatsappConversationThread => {
  const now = new Date().toISOString();
  return {
    id: 0,
    userId: options.userId,
    instanceId: options.instanceId,
    chatJid: options.chatJid,
    chatType: options.chatType,
    title: options.title ?? null,
    phone: options.phone ?? null,
    avatarUrl: options.avatarUrl ?? null,
    groupDescription: options.groupDescription ?? null,
    participantsCount: options.participantsCount ?? null,
    linkedGroupId: options.linkedGroupId ?? null,
    inviteLink: options.inviteLink ?? null,
    announceOnly: options.announceOnly ?? null,
    instanceIsAdmin: options.instanceIsAdmin ?? null,
    mentionable: options.mentionable ?? null,
    canSendMessages: options.canSendMessages ?? null,
    readOnlyReason: options.readOnlyReason ?? null,
    channelRole: options.channelRole ?? null,
    directorySource: options.directorySource ?? null,
    lastMessagePreview: null,
    lastMessageAt: null,
    lastMessageDirection: null,
    lastMessageSenderName: null,
    lastMessageSenderJid: null,
    unreadCount: 0,
    archived: false,
    pinned: false,
    muted: false,
    deletedInInstance: false,
    deletedInInstanceAt: null,
    deletedInInstanceAction: null,
    createdAt: now,
    updatedAt: now,
  };
};

const sortThreads = (threads: WhatsappConversationThread[]) =>
  threads.sort((left, right) => {
    const leftTime = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
    const rightTime = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    const leftUpdated = left.updatedAt ? Date.parse(left.updatedAt) : 0;
    const rightUpdated = right.updatedAt ? Date.parse(right.updatedAt) : 0;
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
    if (left.id !== right.id) return right.id - left.id;
    const leftTitle = left.title || left.phone || left.chatJid;
    const rightTitle = right.title || right.phone || right.chatJid;
    return leftTitle.localeCompare(rightTitle, "pt-BR");
  });

const hasRecordedConversationActivity = (thread: WhatsappConversationThread) => {
  const preview = (thread.lastMessagePreview || "").trim();
  return Boolean(
    preview ||
      thread.lastMessageAt ||
      thread.lastMessageDirection ||
      thread.lastMessageSenderName ||
      thread.lastMessageSenderJid ||
      thread.unreadCount > 0,
  );
};

const parseBooleanQueryFlag = (value: string | null) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
};

const shouldExposeThread = (
  thread: WhatsappConversationThread,
  options: { includeContacts?: boolean } = {},
) => {
  const chatType = thread.chatType === "unknown" ? getWhatsappChatType(thread.chatJid) : thread.chatType;
  if (chatType === "broadcast") return false;
  if (chatType === "contact" && isLikelyWhatsappGroupDigits(thread.chatJid)) return false;
  if (chatType !== "contact") return true;
  return options.includeContacts === true && hasRecordedConversationActivity(thread);
};

const getAvatarRenderableUrl = (avatar: Awaited<ReturnType<typeof getUserAvatar>>) => {
  if (avatar?.url) return avatar.url;
  if (avatar?.dataUrl && avatar.dataUrl.length <= 4096) return avatar.dataUrl;
  return null;
};

const groupInfoRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const getGroupInfoTitle = (value: unknown): string | null => {
  const root = groupInfoRecord(value);
  const data = groupInfoRecord(root.data ?? root.Data);
  const candidates = [
    data.name,
    data.Name,
    data.subject,
    data.Subject,
    data.groupName,
    data.GroupName,
    root.name,
    root.Name,
    root.subject,
    root.Subject,
    root.groupName,
    root.GroupName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
};

const hydrateMissingGroupTitles = async (options: {
  merged: Map<string, WhatsappConversationThread>;
  serverBaseUrl: string | null;
  token: string;
  sessionStatus: string | null;
  invalidTitles: Set<string>;
}) => {
  if (!options.serverBaseUrl || options.sessionStatus !== "conectado") return;
  const candidates = sortThreads(Array.from(options.merged.values()))
    .filter((thread) => {
      const chatType = thread.chatType === "unknown"
        ? getWhatsappChatType(thread.chatJid)
        : thread.chatType;
      return (
        (chatType === "group" || chatType === "community") &&
        isPlaceholderTitle(thread.title, thread.chatJid, options.invalidTitles)
      );
    })
    .slice(0, 16);
  if (candidates.length === 0) return;

  const client = { baseUrl: options.serverBaseUrl, token: options.token };
  for (let offset = 0; offset < candidates.length; offset += 4) {
    await Promise.all(candidates.slice(offset, offset + 4).map(async (thread) => {
      try {
        const title = getGroupInfoTitle(
          await getGroupInfo<Record<string, unknown>>(client, thread.chatJid),
        );
        if (!title || isPlaceholderTitle(title, thread.chatJid, options.invalidTitles)) return;
        const updatedThread = { ...thread, title, directorySource: "groups" as const };
        options.merged.set(thread.chatJid, updatedThread);
        await persistThreadIdentityIfUseful(thread, updatedThread, options.invalidTitles);
      } catch (error) {
        console.warn("[whatsapp-conversations] skipped group title hydration", {
          chatJid: thread.chatJid,
          error,
        });
      }
    }));
  }
};

const hydrateMissingContactAvatars = async (options: {
  merged: Map<string, WhatsappConversationThread>;
  userId: number;
  instanceId: number;
  serverBaseUrl: string | null;
  token: string;
  sessionStatus: string | null;
  invalidTitles: Set<string>;
}) => {
  if (!options.serverBaseUrl || options.sessionStatus !== "conectado") {
    return;
  }

  const candidates = sortThreads(Array.from(options.merged.values()))
    .filter((thread) => {
      const chatType = thread.chatType === "unknown"
        ? getWhatsappChatType(thread.chatJid)
        : thread.chatType;
      return chatType === "contact" && !thread.avatarUrl;
    })
    .slice(0, 8);

  if (candidates.length === 0) {
    return;
  }

  const client = { baseUrl: options.serverBaseUrl, token: options.token };
  for (const thread of candidates) {
    const avatarUrl = await getUserAvatar(client, { contact: thread.chatJid, preview: true })
      .then(getAvatarRenderableUrl)
      .catch((error) => {
        console.warn("[whatsapp-conversations] skipped contact avatar hydration", {
          chatJid: thread.chatJid,
          error,
        });
        return null;
      });
    if (!avatarUrl) {
      continue;
    }

    const updatedThread = { ...thread, avatarUrl };
    options.merged.set(thread.chatJid, updatedThread);
    try {
      await persistThreadIdentityIfUseful(
        thread,
        {
          ...updatedThread,
          title: isPlaceholderTitle(thread.title, thread.chatJid, options.invalidTitles)
            ? null
            : thread.title,
          avatarUrl,
        },
        options.invalidTitles,
      );
    } catch (error) {
      console.warn("[whatsapp-conversations] failed to persist hydrated avatar", {
        chatJid: thread.chatJid,
        error,
      });
    }
  }
};

const hydrateMissingGroupAvatars = async (options: {
  merged: Map<string, WhatsappConversationThread>;
  instanceId: number;
  serverBaseUrl: string | null;
  token: string;
  sessionStatus: string | null;
  invalidTitles: Set<string>;
}) => {
  if (!options.serverBaseUrl || options.sessionStatus !== "conectado") {
    return;
  }

  const candidates = sortThreads(Array.from(options.merged.values()))
    .filter((thread) => {
      const chatType = thread.chatType === "unknown"
        ? getWhatsappChatType(thread.chatJid)
        : thread.chatType;
      return (
        (chatType === "group" || chatType === "community") &&
        !thread.avatarUrl
      );
    })
    .slice(0, 12);

  if (candidates.length === 0) {
    return;
  }

  const client = { baseUrl: options.serverBaseUrl, token: options.token };
  for (const thread of candidates) {
    const avatarUrl = await getUserAvatar(client, { contact: thread.chatJid, preview: true })
      .then(getAvatarRenderableUrl)
      .catch((error) => {
        console.warn("[whatsapp-conversations] skipped group avatar hydration", {
          chatJid: thread.chatJid,
          error,
        });
        return null;
      });
    if (!avatarUrl) {
      continue;
    }

    const updatedThread = { ...thread, avatarUrl };
    options.merged.set(thread.chatJid, updatedThread);
    await persistThreadIdentityIfUseful(
      thread,
      {
        ...updatedThread,
        title: isPlaceholderTitle(thread.title, thread.chatJid, options.invalidTitles)
          ? null
          : thread.title,
        avatarUrl,
      },
      options.invalidTitles,
    );
  }
};

const enrichContactThreadsFromCachedIdentities = async (options: {
  merged: Map<string, WhatsappConversationThread>;
  userId: number;
  instanceId: number;
  invalidTitles: Set<string>;
}) => {
  const candidates = Array.from(options.merged.values()).filter((thread) => {
    const chatType = thread.chatType === "unknown"
      ? getWhatsappChatType(thread.chatJid)
      : thread.chatType;
    return (
      chatType === "contact" &&
      (isPlaceholderTitle(thread.title, thread.chatJid, options.invalidTitles) ||
        isPhoneLikeTitle(thread.title, thread.chatJid) ||
        !thread.avatarUrl)
    );
  });
  if (candidates.length === 0) return;

  const identities = await listKnownWhatsappSenderIdentitiesForUser(
    options.userId,
    options.instanceId,
    candidates.map((thread) => thread.chatJid),
  );
  if (identities.size === 0) return;

  for (const thread of candidates) {
    const identity = identities.get(thread.chatJid);
    if (!identity) continue;
    const title =
      identity.senderName &&
      (isPlaceholderTitle(thread.title, thread.chatJid, options.invalidTitles) ||
        isPhoneLikeTitle(thread.title, thread.chatJid))
        ? identity.senderName
        : thread.title;
    const avatarUrl = thread.avatarUrl || identity.senderAvatarUrl;
    const updatedThread = { ...thread, title, avatarUrl };
    options.merged.set(thread.chatJid, updatedThread);
    await persistThreadIdentityIfUseful(thread, updatedThread, options.invalidTitles);
  }
};

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(context.params);
    const instanceId = parseInstanceId(resolvedParams.instanceId);
    if (!instanceId) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    const access = await resolveInstanceConversationAccess(user.id, instanceId);
    if (!access) {
      return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    }
    const { instance, storageUserId, isOwnerInstance, sharedGroups, allowedChatJids } = access;

    const url = new URL(request.url);
    const requestedDirectorySync = url.searchParams.get("sync") !== "0";
    const lastDirectorySync = directorySyncAt.get(instance.id) ?? 0;
    const syncDirectory = requestedDirectorySync &&
      Date.now() - lastDirectorySync >= DIRECTORY_SYNC_COOLDOWN_MS;
    const includeContacts = parseBooleanQueryFlag(url.searchParams.get("includeContacts"));
    const refreshAvatars = parseBooleanQueryFlag(url.searchParams.get("refreshAvatars"));
    const invalidConversationTitles = new Set(
      [instance.name, instance.phone]
        .flatMap((value) => [normalizeIdentityText(value), normalizeIdentityDigits(value)])
        .filter(Boolean),
    );

    if (isOwnerInstance) {
      await restoreWhatsappConversationThreadsFromRealtimeEvents(storageUserId, instance.id).catch((error) => {
        console.warn("[whatsapp-conversations] failed to restore threads from realtime events", {
          userId: storageUserId,
          instanceId: instance.id,
          error,
        });
      });
    }

    const rawBaseThreads = await listWhatsappConversationThreads(storageUserId, instance.id);
    const baseThreads = isOwnerInstance
      ? rawBaseThreads
      : rawBaseThreads.filter((thread) => allowedChatJids.has(thread.chatJid));
    const merged = new Map(baseThreads.map((thread) => [thread.chatJid, thread]));
    const directoryErrors: string[] = [];

    try {
      const savedGroups = isOwnerInstance
        ? await listGroupsForUser(user.id, { includeParticipants: true })
        : sharedGroups;
      for (const group of savedGroups) {
        if (group.instanceId !== instance.id) {
          const groupPhone = normalizeIdentityDigits(group.instancePhone);
          const instancePhone = normalizeIdentityDigits(instance.phone);
          if (!groupPhone || !instancePhone || groupPhone !== instancePhone) {
            continue;
          }
        }
        const chatJid = normalizeWhatsappChatJid(group.remoteId);
        if (!chatJid) continue;
        const savedGroupInstanceIsAdmin = resolveSavedGroupInstanceIsAdmin(group);
        const canSendMessages =
          group.metadata.adminsOnly !== true ||
          savedGroupInstanceIsAdmin === true;
        const thread = buildDirectoryThread({
          userId: storageUserId,
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
          instanceIsAdmin: savedGroupInstanceIsAdmin,
          mentionable: group.metadata.adminsOnly ? savedGroupInstanceIsAdmin ?? true : true,
          canSendMessages,
          readOnlyReason: canSendMessages
            ? null
            : "Somente administradores podem enviar mensagens.",
          directorySource: "groups",
        });
        await persistThreadIdentityIfUseful(merged.get(chatJid), thread, invalidConversationTitles);
        mergeThread(merged, thread, { invalidTitles: invalidConversationTitles });
      }
    } catch (error) {
      console.warn("[whatsapp-conversations] failed to merge saved groups", { error });
    }

    let sessionStatus = instance.sessionStatus;
    try {
      sessionStatus = await refreshInstanceStatus(storageUserId, instance.id);
    } catch (error) {
      console.warn("[whatsapp-conversations] failed to refresh instance status", { error });
    }

    if (isOwnerInstance && syncDirectory && sessionStatus === "conectado" && instance.serverBaseUrl) {
      directorySyncAt.set(instance.id, Date.now());
      const [contactsResult, groupsResult, channelsResult] = await Promise.allSettled([
        listUserContacts({ baseUrl: instance.serverBaseUrl, token: instance.token }),
        listDiscoverableGroupsForInstance(storageUserId, instance.id),
        listUserChannels({ baseUrl: instance.serverBaseUrl, token: instance.token }),
      ]);

      if (contactsResult.status === "fulfilled") {
        for (const contact of contactsResult.value) {
          const chatJid = normalizeWhatsappChatJid(contact.jid);
          if (!chatJid) continue;
          const title = contact.name || contact.pushName || contact.shortName || contact.phone;
          const thread = buildDirectoryThread({
            userId: storageUserId,
            instanceId: instance.id,
            chatJid,
            chatType: getWhatsappChatType(chatJid),
            title,
            phone: contact.phone || getWhatsappChatPhone(chatJid),
            avatarUrl: contact.avatarUrl,
            canSendMessages: true,
            directorySource: "contacts",
          });
          await persistThreadIdentityIfUseful(merged.get(chatJid), thread, invalidConversationTitles);
          mergeThread(merged, thread, { invalidTitles: invalidConversationTitles });
        }
      } else {
        directoryErrors.push("Não foi possível carregar contatos.");
      }

      if (groupsResult.status === "fulfilled") {
        for (const group of groupsResult.value) {
          const chatJid = normalizeWhatsappChatJid(group.remoteId);
          if (!chatJid) continue;
          const canSendMessages =
            !group.announceOnly || group.instanceIsAdmin;
          const thread = buildDirectoryThread({
            userId: storageUserId,
            instanceId: instance.id,
            chatJid,
            chatType: group.isCommunity ? "community" : "group",
            title: group.name || group.remoteId,
            avatarUrl: group.imageUrl,
            groupDescription: group.description,
            participantsCount: group.participantsCount,
            linkedGroupId: group.linkedGroupId,
            inviteLink: group.inviteLink,
            announceOnly: group.announceOnly,
            instanceIsAdmin: group.instanceIsAdmin,
            mentionable: group.mentionable,
            canSendMessages,
            readOnlyReason: canSendMessages
              ? null
              : "Somente administradores podem enviar mensagens.",
            directorySource: "groups",
          });
          await persistThreadIdentityIfUseful(merged.get(chatJid), thread, invalidConversationTitles);
          mergeThread(merged, thread, { invalidTitles: invalidConversationTitles });
        }
      } else {
        const error = groupsResult.reason;
        if (error instanceof BotGroupError) {
          directoryErrors.push(error.message);
        } else {
          directoryErrors.push("Não foi possível carregar grupos.");
        }
      }

      if (channelsResult.status === "fulfilled") {
        for (const channel of channelsResult.value) {
          const chatJid = normalizeWhatsappChatJid(channel.jid);
          if (!chatJid) continue;
          const channelRole = channel.viewerRole?.trim().toLowerCase() || null;
          const thread = buildDirectoryThread({
            userId: storageUserId,
            instanceId: instance.id,
            chatJid,
            chatType: "channel",
            title: channel.name || channel.jid,
            avatarUrl: channel.avatarUrl,
            groupDescription: channel.description,
            participantsCount: channel.subscribersCount,
            inviteLink: channel.inviteLink,
            announceOnly: true,
            instanceIsAdmin: channel.canSendMessages,
            mentionable: false,
            canSendMessages: channel.canSendMessages,
            readOnlyReason: channel.canSendMessages
              ? null
              : "Somente administradores do canal podem publicar.",
            channelRole,
            directorySource: "channels",
          });
          await persistThreadIdentityIfUseful(merged.get(chatJid), thread, invalidConversationTitles);
          mergeThread(merged, thread, { invalidTitles: invalidConversationTitles });
        }
      } else {
        directoryErrors.push("Não foi possível carregar canais.");
      }
    }

    if (refreshAvatars) {
      await hydrateMissingGroupAvatars({
        merged,
        instanceId: instance.id,
        serverBaseUrl: instance.serverBaseUrl,
        token: instance.token,
        sessionStatus,
        invalidTitles: invalidConversationTitles,
      });
    }

    // Names already persisted in the local directory are enough for the first
    // paint. Only ask EasyZap for missing titles during an explicit directory
    // sync; this keeps normal polling entirely local and avoids 429 bursts.
    if (syncDirectory) {
      await hydrateMissingGroupTitles({
        merged,
        serverBaseUrl: instance.serverBaseUrl,
        token: instance.token,
        sessionStatus,
        invalidTitles: invalidConversationTitles,
      });
    }

    if (refreshAvatars && includeContacts) {
      await hydrateMissingContactAvatars({
        merged,
        userId: storageUserId,
        instanceId: instance.id,
        serverBaseUrl: instance.serverBaseUrl,
        token: instance.token,
        sessionStatus,
        invalidTitles: invalidConversationTitles,
      });
    }

    await enrichContactThreadsFromCachedIdentities({
      merged,
      userId: storageUserId,
      instanceId: instance.id,
      invalidTitles: invalidConversationTitles,
    });

      const responseThreads = sortThreads(
        Array.from(merged.values()).filter((thread) => shouldExposeThread(thread, { includeContacts })),
      )
        .map(sanitizeWhatsappConversationThreadForTransport);

	    return NextResponse.json({
	      instance: {
        id: instance.id,
        name: instance.name,
        phone: instance.phone,
        sessionStatus,
      },
      threads: responseThreads,
      directoryErrors,
    });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to list WhatsApp conversations", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as conversas do WhatsApp." },
      { status: 500 },
    );
  }
}
