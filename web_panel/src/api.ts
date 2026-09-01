export type SessionUser = {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
  whatsappNumber?: string | null;
  isImpersonated?: boolean;
  canReturnToAdmin?: boolean;
};

export type BotInstance = {
  id: number;
  name: string;
  phone?: string | null;
  sessionStatus?: string | null;
  expiresAt?: string | null;
  avatarUrl?: string | null;
};

export type ConversationThread = {
  id?: number | string;
  instanceId: number;
  chatJid: string;
  title: string;
  phone?: string | null;
  lastMessage?: string | null;
  lastMessagePreview?: string | null;
  lastActivity?: string | null;
  lastMessageAt?: string | null;
  lastMessageSenderName?: string | null;
  lastMessageDirection?: string | null;
  unreadCount?: number;
  avatarUrl?: string | null;
  wallpaperUrl?: string | null;
  chatType?: string | null;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  memberCount?: number;
  role?: string;
  canManage?: boolean;
  internalBotEnabled?: boolean;
  linkedGroupId?: number | null;
  participantsCount?: number;
  instanceIsAdmin?: boolean;
  hasUnreadMention?: boolean;
  isSupport?: boolean;
};

export type ChatMessage = {
  id: string | number;
  instanceId?: number;
  chatJid?: string;
  messageId?: string | null;
  clientMessageId?: string | null;
  direction?: string;
  senderId?: number | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  messageType?: string | null;
  type?: string | null;
  text?: string | null;
  body?: string | null;
  caption?: string | null;
  title?: string | null;
  footer?: string | null;
  mediaUrl?: string | null;
  mediaSourceUrl?: string | null;
  mediaProxyUrl?: string | null;
  thumbnailUrl?: string | null;
  mediaMimeType?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  mediaFileName?: string | null;
  timestamp?: string | null;
  createdAt?: string | null;
  isMine?: boolean;
  isBot?: boolean;
  deliveryState?: "pending" | "sent" | "delivered" | "read" | "failed" | string;
  reactions?: unknown[];
  replyTo?: ChatMessage | null;
  media?: Record<string, unknown> | null;
  buttons?: Array<{
    id?: string;
    title?: string;
    label?: string;
    type?: string;
    url?: string;
    copyCode?: string;
    phoneNumber?: string;
  }>;
  optimistic?: boolean;
  pinned?: boolean;
  deleted?: boolean;
  editedAt?: string | null;
  viewOnce?: boolean;
  viewOnceOpened?: boolean;
  receiptSummary?: JsonRecord;
};

export type ConversationAction =
  | "read"
  | "archive"
  | "unarchive"
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
  | "clear"
  | "delete"
  | "leave";

export type InternalGroup = {
  id: number;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  memberCount?: number;
  unreadCount?: number;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  role?: string;
  canManage?: boolean;
  lastMessage?: ChatMessage | null;
};

export type SweepstakeParticipant = {
  jid?: string;
  userId?: number;
  displayName?: string | null;
  joinedAt?: string | null;
};

export type SweepstakeSummary = {
  id: number;
  question: string;
  status: string;
  winnersCount: number;
  maxParticipants?: number | null;
  expiresAt?: string | null;
  participants: SweepstakeParticipant[];
  winners?: SweepstakeParticipant[];
  pollMessageId?: string | null;
};

export type SweepstakeGroupSnapshot = {
  active: SweepstakeSummary[];
  history: SweepstakeSummary[];
  requiresSync?: boolean;
};

export type JsonRecord = Record<string, unknown>;

export type GiphyMediaItem = {
  id: string;
  title: string;
  type: "gifs" | "stickers";
  previewUrl: string;
  originalUrl: string;
  mp4Url?: string;
  webpUrl?: string;
  width?: number | null;
  height?: number | null;
  source: "giphy";
};

export type AuthRegisterResponse = {
  user?: SessionUser;
  message?: string;
  pendingVerification?: boolean;
  verificationToken?: string;
  verification?: {
    mode?: "user_sends_code" | "send_code";
    code?: string;
    messageToSend?: string;
    whatsappUrl?: string;
    targetWhatsappNumber?: string;
    whatsappNumber?: string;
    instructions?: string;
    supportText?: string;
    expiresAt?: string;
  };
  whatsappNumber?: string | null;
  whatsappVerificationDeferred?: boolean;
  expiresAt?: string;
};

export const absoluteMediaUrl = (value?: string | null) => {
  const source = value?.trim();
  if (!source) return "";
  if (/^(blob:|data:)/i.test(source)) return source;
  try {
    const url = new URL(source, "https://botadmin.shop");
    if (
      url.hostname === "botadmin.shop" ||
      url.hostname === "www.botadmin.shop"
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return source.startsWith("/") ? source : `/${source}`;
  }
};

export const request = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const hasBody = Boolean(init?.body);
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  const method = String(init?.method || "GET").toUpperCase();
  let response: Response | null = null;
  let data: JsonRecord = {};
  // Transient gateway errors are common while the WhatsApp worker refreshes a
  // session. Retry idempotent reads briefly; writes are never repeated.
  for (let attempt = 0; attempt < (method === "GET" ? 3 : 1); attempt += 1) {
    response = await fetch(path, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(hasBody && !isFormData
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
    });
    data = (await response.json().catch(() => ({}))) as JsonRecord;
    if (
      response.status !== 502 &&
      response.status !== 503 &&
      response.status !== 504
    )
      break;
    if (attempt < 2)
      await new Promise((resolve) =>
        window.setTimeout(resolve, 250 * (attempt + 1)),
      );
  }
  if (!response?.ok) {
    const status = response?.status || 500;
    if ((response?.status || 500) >= 500) {
      const error = new Error(
        "Serviço temporariamente indisponível. Tente novamente em instantes.",
      ) as Error & { status?: number };
      error.status = status;
      throw error;
    }
    const error = new Error(
      String(data.message || data.mensagem || data.error || `Erro ${status}`),
    ) as Error & { status?: number };
    error.status = status;
    throw error;
  }
  return data as T;
};

const internalToThread = (group: InternalGroup): ConversationThread => ({
  id: group.id,
  instanceId: 0,
  chatJid: `internal:${group.id}`,
  title: group.name,
  avatarUrl: group.avatarUrl,
  wallpaperUrl: (group as InternalGroup & JsonRecord).wallpaperUrl as
    string | null | undefined,
  chatType: "internal_group",
  memberCount: group.memberCount,
  unreadCount: group.unreadCount || 0,
  pinned: group.pinned,
  archived: group.archived,
  muted: group.muted,
  role: group.role,
  canManage: group.canManage,
  internalBotEnabled: Boolean((group as InternalGroup & JsonRecord).botEnabled),
  lastMessagePreview:
    group.lastMessage?.text || (group.lastMessage?.mediaUrl ? "Mídia" : ""),
  lastMessageAt: group.lastMessage?.createdAt,
});

export const api = {
  session: () => request<{ user?: SessionUser | null }>("/api/auth/session"),
  updateUserProfile: (payload: JsonRecord) =>
    request<{ user?: SessionUser; message?: string }>('/api/user/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  publicSite: () => request<{ settings?: JsonRecord }>("/api/public/site"),
  login: (identifier: string, password: string, remember = true) =>
    request<{ user?: SessionUser; message?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password, remember }),
    }),
  register: (payload: JsonRecord) =>
    request<AuthRegisterResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  requestPasswordReset: (identifier: string) =>
    request<{ message?: string }>("/api/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ identifier }),
    }),
  resetPassword: (payload: {
    identifier?: string;
    code?: string;
    token?: string;
    password: string;
  }) =>
    request<{ message?: string }>("/api/auth/reset", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () => request<JsonRecord>("/api/auth/logout", { method: "POST" }),
  instances: () => request<{ instances?: BotInstance[] }>("/api/bot-instances"),
  botServers: () =>
    request<{
      servers?: Array<{ id: number; name: string; sessionLimit?: number }>;
    }>("/api/bot-servers"),
  createInstance: (payload: {
    serverId: number;
    phone: string;
    name?: string;
  }) =>
    request<{
      instance?: BotInstance;
      message?: string;
      requiresInstanceAddonPayment?: boolean;
      requiresProfilePayment?: boolean;
      profileSlotApplied?: boolean;
    }>("/api/bot-instances", { method: "POST", body: JSON.stringify(payload) }),
  updateInstance: (instanceId: number, payload: JsonRecord) =>
    request<{ instance?: BotInstance; message?: string }>(
      `/api/bot-instances/${instanceId}`,
      { method: "PUT", body: JSON.stringify(payload) },
    ),
  instanceAction: (instanceId: number, action: string) =>
    request<{ message?: string }>(`/api/bot-instances/${instanceId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  pairInstance: (instanceId: number, mode: "auto" | "code" | "qr" = "auto") =>
    request<{ data?: JsonRecord; message?: string }>(
      `/api/bot-instances/${instanceId}/pair`,
      { method: "POST", body: JSON.stringify({ mode }) },
    ),
  instanceStatus: (instanceId: number) =>
    request<{ status?: string }>(`/api/bot-instances/${instanceId}/status`),
  instanceProfile: (instanceId: number) =>
    request<{ profile?: JsonRecord; instance?: BotInstance }>(
      `/api/bot-instances/${instanceId}/profile`,
    ),
  updateInstanceProfile: (instanceId: number, payload: JsonRecord) =>
    request<{
      profile?: JsonRecord;
      instance?: BotInstance;
      message?: string;
    }>(`/api/bot-instances/${instanceId}/profile`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  instanceProxy: (instanceId: number) =>
    request<{
      proxy?: JsonRecord | null;
      policy?: JsonRecord;
      connected?: boolean;
    }>(`/api/bot-instances/${instanceId}/proxy`),
  planMobile: () => request<JsonRecord>("/api/user/plan/mobile"),
  createPlanCheckout: (payload: JsonRecord) =>
    request<JsonRecord>("/api/user/plan/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  instanceSettings: (instanceId: number) =>
    request<{ settings?: JsonRecord; storage?: JsonRecord }>(
      `/api/bot-instances/${instanceId}/settings`,
    ),
  updateInstanceSettings: (instanceId: number, payload: JsonRecord) =>
    request<{ settings?: JsonRecord; storage?: JsonRecord }>(
      `/api/bot-instances/${instanceId}/settings`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  conversations: (
    instanceId: number,
    options: { includeContacts?: boolean; refreshAvatars?: boolean } = {},
  ) =>
    request<{
      conversations?: ConversationThread[];
      threads?: ConversationThread[];
    }>(
      `/api/bot-instances/${instanceId}/whatsapp-conversations?sync=0&includeContacts=${options.includeContacts === false ? 0 : 1}${options.refreshAvatars ? "&refreshAvatars=1" : ""}`,
    ),
  internalGroups: async () => {
    const result = await request<{ groups?: InternalGroup[] }>(
      "/api/internal-groups",
    );
    return (result.groups || []).map(internalToThread);
  },
  createInternalGroup: (name: string, description = "") =>
    request<{ group?: InternalGroup; inviteUrl?: string }>(
      "/api/internal-groups",
      {
        method: "POST",
        body: JSON.stringify({ name, description }),
      },
    ),
  joinInternalGroup: (token: string) =>
    request<{ group?: InternalGroup }>("/api/internal-groups/join", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  internalGroup: (groupId: number | string) =>
    request<{ group?: InternalGroup & JsonRecord; members?: JsonRecord[] }>(
      `/api/internal-groups/${groupId}`,
    ),
  internalGroupInvitePreview: (token: string) =>
    request<{ preview?: JsonRecord }>(
      `/api/internal-groups/invite/preview?token=${encodeURIComponent(token)}`,
    ),
  updateInternalGroup: (groupId: number | string, payload: JsonRecord) =>
    request<{ group?: InternalGroup & JsonRecord }>(
      `/api/internal-groups/${groupId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  updateInternalGroupAvatar: (groupId: number | string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ group?: InternalGroup & JsonRecord }>(
      `/api/internal-groups/${groupId}/avatar`,
      { method: "POST", body: form },
    );
  },
  updateInternalGroupBotAvatar: (groupId: number | string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ group?: InternalGroup & JsonRecord }>(
      `/api/internal-groups/${groupId}/bot-avatar`,
      { method: "POST", body: form },
    );
  },
  rotateInternalGroupInvite: (groupId: number | string) =>
    request<{ inviteUrl?: string }>(`/api/internal-groups/${groupId}/invite`, {
      method: "POST",
    }),
  updateInternalGroupWallpaper: (groupId: number | string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<JsonRecord>(`/api/internal-groups/${groupId}/wallpaper`, {
      method: "POST",
      body: form,
    });
  },
  removeInternalGroupWallpaper: (groupId: number | string) =>
    request<JsonRecord>(`/api/internal-groups/${groupId}/wallpaper`, {
      method: "DELETE",
    }),
  messages: (thread: ConversationThread, limit = 80, warm = true) => {
    if (thread.chatType === "internal_group") {
      const groupId = String(thread.chatJid).replace("internal:", "");
      return request<{ messages?: ChatMessage[]; hasMore?: boolean }>(
        `/api/internal-groups/${groupId}/messages?limit=${limit}`,
      );
    }
    return request<{ messages?: ChatMessage[]; hasMore?: boolean }>(
      `/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}/messages?limit=${limit}${warm ? "&warm=1" : ""}`,
    );
  },
  sendText: (
    thread: ConversationThread,
    text: string,
    clientMessageId: string,
  ) => {
    if (thread.chatType === "internal_group") {
      const groupId = String(thread.chatJid).replace("internal:", "");
      return request<{ message?: ChatMessage }>(
        `/api/internal-groups/${groupId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text, clientMessageId }),
        },
      );
    }
    return request<{ message?: ChatMessage }>(
      `/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}/messages`,
      { method: "POST", body: JSON.stringify({ text, clientMessageId }) },
    );
  },
  sendMedia: (
    thread: ConversationThread,
    file: File,
    text: string,
    clientMessageId: string,
    viewOnce = false,
    options: {
      mediaKind?: "sticker" | "gif";
      mediaSource?: string;
      mediaUrl?: string;
      mediaThumbnail?: string;
      isAnimated?: boolean;
    } = {},
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("text", text);
    form.append("clientMessageId", clientMessageId);
    form.append("viewOnce", String(viewOnce));
    if (options.mediaKind) form.append("mediaKind", options.mediaKind);
    if (options.mediaSource) form.append("mediaSource", options.mediaSource);
    if (options.mediaUrl) form.append("mediaUrl", options.mediaUrl);
    if (options.mediaThumbnail)
      form.append("mediaThumbnail", options.mediaThumbnail);
    if (options.isAnimated) form.append("isAnimated", "true");
    if (thread.chatType === "internal_group") {
      const groupId = String(thread.chatJid).replace("internal:", "");
      return request<{ message?: ChatMessage }>(
        `/api/internal-groups/${groupId}/messages`,
        { method: "POST", body: form },
      );
    }
    return request<{ message?: ChatMessage }>(
      `/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}/messages`,
      { method: "POST", body: form },
    );
  },
  giphySearch: (type: "gifs" | "stickers", query = "", offset = 0) =>
    request<{ items?: GiphyMediaItem[]; pagination?: JsonRecord | null }>(
      `/api/giphy?type=${encodeURIComponent(type)}&q=${encodeURIComponent(query)}&offset=${Math.max(0, offset)}`,
    ),
  giphyMedia: (url: string) =>
    fetch(`/api/giphy/media?url=${encodeURIComponent(url)}`, {
      credentials: "include",
      headers: { Accept: "image/*,video/*,*/*" },
    }).then(async (response) => {
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as JsonRecord;
        throw new Error(
          String(payload.message || "Não foi possível baixar a mídia."),
        );
      }
      return response.blob();
    }),
  messageAction: (
    thread: ConversationThread,
    message: ChatMessage,
    action: string,
    payload: JsonRecord = {},
  ) => {
    const messageId = String(message.messageId || message.id || "");
    if (!messageId || message.optimistic)
      return Promise.reject(
        new Error("Esta mensagem ainda está sendo enviada."),
      );
    if (thread.chatType === "internal_group") {
      const groupId = String(thread.chatJid).replace("internal:", "");
      return request<JsonRecord>(
        `/api/internal-groups/${groupId}/messages/${encodeURIComponent(messageId)}/actions`,
        {
          method: "POST",
          body: JSON.stringify({ action, ...payload }),
        },
      );
    }
    return request<JsonRecord>(
      `/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}/messages/${encodeURIComponent(messageId)}/actions`,
      {
        method: "POST",
        body: JSON.stringify({ action, ...payload }),
      },
    );
  },
  conversationAction: (
    thread: ConversationThread,
    action: ConversationAction,
  ) => {
    if (thread.chatType === "internal_group") {
      const groupId = String(thread.chatJid).replace("internal:", "");
      if (action === "read") {
        return request<JsonRecord>(`/api/internal-groups/${groupId}/read`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }
      return request<JsonRecord>(`/api/internal-groups/${groupId}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
    }
    return request<JsonRecord>(
      `/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}`,
      { method: "POST", body: JSON.stringify({ action }) },
    );
  },
  resyncHistory: (instanceId: number) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/whatsapp-conversations/history-resync`,
      {
        method: "POST",
      },
    ),
  broadcastLists: (instanceId: number) =>
    request<JsonRecord>(`/api/bot-instances/${instanceId}/broadcast-lists`),
  createBroadcastList: (instanceId: number, payload: JsonRecord) =>
    request<JsonRecord>(`/api/bot-instances/${instanceId}/broadcast-lists`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteBroadcastList: (instanceId: number, listId: number | string) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}`,
      { method: "DELETE" },
    ),
  broadcastList: (instanceId: number, listId: number | string) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}`,
    ),
  sendBroadcast: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/send`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  scheduleBroadcast: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/schedules`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  broadcastTemplates: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/templates`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  deleteBroadcastTemplate: (
    instanceId: number,
    listId: number | string,
    templateId: number | string,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/templates`,
      { method: "DELETE", body: JSON.stringify({ templateId }) },
    ),
  broadcastContacts: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/contacts`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  updateBroadcastGroupMentions: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/contacts`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  syncBroadcastGoogleSheet: (
    instanceId: number,
    listId: number | string,
    apply = false,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/sync`,
      { method: "POST", body: JSON.stringify({ apply }) },
    ),
  previewBroadcastVariables: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/variables/preview`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  googleSheetsStatus: () =>
    request<{ connected?: JsonRecord | null }>(
      "/api/integrations/google-sheets/status",
    ),
  authorizeGoogleSheets: (
    returnPath = "/dashboard/react/dashboard/user?section=broadcasts",
  ) =>
    request<{ authorizationUrl?: string }>(
      "/api/integrations/google-sheets/authorize",
      { method: "POST", body: JSON.stringify({ returnPath }) },
    ),
  disconnectGoogleSheets: () =>
    request<JsonRecord>("/api/integrations/google-sheets/status", {
      method: "DELETE",
    }),
  googleSpreadsheets: () =>
    request<JsonRecord>("/api/integrations/google-sheets/files"),
  previewGoogleSheet: (googleSheetUrl: string, mapping?: JsonRecord) =>
    request<JsonRecord>("/api/integrations/google-sheets/preview", {
      method: "POST",
      body: JSON.stringify({ googleSheetUrl, ...(mapping ? { mapping } : {}) }),
    }),
  uploadBroadcastMedia: (
    instanceId: number,
    listId: number | string,
    file: File,
    mediaType = "image",
  ) => {
    const form = new FormData();
    form.append("mediaType", mediaType);
    form.append("file", file);
    return request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/upload`,
      { method: "POST", body: form },
    );
  },
  removeBroadcastContacts: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord = {},
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/contacts`,
      { method: "DELETE", body: JSON.stringify(payload) },
    ),
  updateBroadcastSchedule: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/schedules`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  deleteBroadcastSchedule: (
    instanceId: number,
    listId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/bot-instances/${instanceId}/broadcast-lists/${encodeURIComponent(String(listId))}/schedules`,
      { method: "DELETE", body: JSON.stringify(payload) },
    ),
  status: () => request<JsonRecord>("/api/bot-status"),
  flows: () => request<JsonRecord>("/api/bot-flows"),
  updateFlow: (flowId: number | string, payload: JsonRecord) =>
    request<JsonRecord>(`/api/bot-flows/${flowId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createFlow: (payload: JsonRecord) =>
    request<JsonRecord>("/api/bot-flows", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  raffles: () => request<JsonRecord>("/api/user/raffles"),
  createRaffle: (payload: JsonRecord) =>
    request<JsonRecord>("/api/user/raffles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  raffle: (raffleId: number | string) =>
    request<JsonRecord>(
      `/api/user/raffles/${encodeURIComponent(String(raffleId))}`,
    ),
  updateRaffle: (raffleId: number | string, payload: JsonRecord) =>
    request<JsonRecord>(
      `/api/user/raffles/${encodeURIComponent(String(raffleId))}`,
      { method: "PUT", body: JSON.stringify(payload) },
    ),
  updateRaffleStatus: (raffleId: number | string, status: string) =>
    request<JsonRecord>(
      `/api/user/raffles/${encodeURIComponent(String(raffleId))}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
  deleteRaffle: (raffleId: number | string) =>
    request<JsonRecord>(
      `/api/user/raffles/${encodeURIComponent(String(raffleId))}`,
      { method: "DELETE" },
    ),
  drawRaffle: (raffleId: number | string, announce = true) =>
    request<JsonRecord>(
      `/api/user/raffles/${encodeURIComponent(String(raffleId))}/draw`,
      { method: "POST", body: JSON.stringify({ announce }) },
    ),
  releaseRaffleReservations: (raffleId: number | string) =>
    request<JsonRecord>(
      `/api/user/raffles/${encodeURIComponent(String(raffleId))}/release`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  rafflePaymentSettings: () =>
    request<JsonRecord>("/api/user/raffles/payment-settings"),
  saveRafflePaymentSettings: (payload: JsonRecord) =>
    request<JsonRecord>("/api/user/raffles/payment-settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  groupSweepstakes: (groupId: number | string, internal = false) =>
    request<SweepstakeGroupSnapshot>(
      `${internal ? "/api/internal-groups" : "/api/bot-groups"}/${groupId}/sweepstakes`,
    ),
  createGroupSweepstake: (
    groupId: number | string,
    payload: JsonRecord,
    internal = false,
  ) =>
    request<SweepstakeGroupSnapshot>(
      `${internal ? "/api/internal-groups" : "/api/bot-groups"}/${groupId}/sweepstakes`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  finalizeGroupSweepstake: (
    groupId: number | string,
    sweepstakeId: number | string,
    internal = false,
  ) =>
    request<SweepstakeGroupSnapshot>(
      `${internal ? "/api/internal-groups" : "/api/bot-groups"}/${groupId}/sweepstakes/${sweepstakeId}/finalize`,
      { method: "POST", body: JSON.stringify({ announce: true }) },
    ),
  cancelGroupSweepstake: (
    groupId: number | string,
    sweepstakeId: number | string,
    internal = false,
  ) =>
    request<SweepstakeGroupSnapshot>(
      `${internal ? "/api/internal-groups" : "/api/bot-groups"}/${groupId}/sweepstakes/${sweepstakeId}/cancel`,
      { method: "POST", body: JSON.stringify({ announce: true }) },
    ),
  addGroupSweepstakeParticipant: (
    groupId: number | string,
    sweepstakeId: number | string,
    userId: number,
  ) =>
    request<SweepstakeGroupSnapshot>(
      `/api/internal-groups/${groupId}/sweepstakes/${sweepstakeId}/participants`,
      { method: "POST", body: JSON.stringify({ userId }) },
    ),
  calls: (instanceId: number) =>
    request<JsonRecord>(`/api/bot-instances/${instanceId}/whatsapp-calls`),
  mediaPlans: () => request<JsonRecord>("/api/user/media-storage/plans"),
  botGroups: () => request<JsonRecord>("/api/bot-groups"),
  discoverPublicGroups: (query = "", category = "", page = 1) => {
    const params = new URLSearchParams({
      page: String(Math.max(1, page)),
      maxPages: "3",
    });
    if (query.trim()) params.set("q", query.trim());
    if (category.trim()) params.set("category", category.trim());
    return request<JsonRecord>(
      `/api/bot-ad-campaigns/group-discovery?${params.toString()}`,
    );
  },
  joinPublicGroup: (instanceId: number, inviteLink: string) =>
    request<JsonRecord>("/api/bot-groups", {
      method: "POST",
      body: JSON.stringify({ instanceId, invite: inviteLink.trim() }),
    }),
  botGroupSettings: (groupId: number | string) =>
    request<{ settings?: JsonRecord }>(`/api/bot-groups/${groupId}/settings`),
  updateBotGroup: (groupId: number | string, payload: JsonRecord) =>
    request<{ group?: JsonRecord; settings?: JsonRecord }>(
      `/api/bot-groups/${groupId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  updateBotGroupSettings: (groupId: number | string, payload: JsonRecord) =>
    request<{ settings?: JsonRecord }>(
      `/api/bot-groups/${groupId}/settings`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  botGroupAds: (groupId: number | string) =>
    request<{ ads?: JsonRecord[] }>(`/api/bot-groups/${groupId}/ads`),
  createBotGroupAd: (groupId: number | string, payload: JsonRecord) =>
    request<{ ad?: JsonRecord; ads?: JsonRecord[] }>(
      `/api/bot-groups/${groupId}/ads`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  updateBotGroupAd: (
    groupId: number | string,
    adId: string,
    payload: JsonRecord,
  ) =>
    request<{ ad?: JsonRecord; ads?: JsonRecord[] }>(
      `/api/bot-groups/${groupId}/ads/${encodeURIComponent(adId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  deleteBotGroupAd: (groupId: number | string, adId: string) =>
    request<{ ads?: JsonRecord[] }>(
      `/api/bot-groups/${groupId}/ads/${encodeURIComponent(adId)}`,
      { method: "DELETE" },
    ),
  uploadBotGroupMessageMedia: (
    groupId: number | string,
    kind: "welcome" | "farewell",
    file: File,
  ) => {
    const form = new FormData();
    form.set("media", file);
    return request<{ settings?: JsonRecord }>(
      `/api/bot-groups/${groupId}/${kind}-media`,
      { method: "POST", body: form },
    );
  },
  toggleBotCommand: (
    groupId: number | string,
    command: string,
    value: boolean,
  ) =>
    request<{ toggles?: JsonRecord }>(`/api/bot-groups/${groupId}/commands`, {
      method: "PATCH",
      body: JSON.stringify({ command, value }),
    }),
  charges: () => request<JsonRecord>("/api/user/charges?limit=120"),
  purchases: () => request<JsonRecord>("/api/user/purchases?limit=120"),
  affiliateProviders: () => request<JsonRecord>("/api/affiliates/providers"),
  updateAffiliateProvider: (provider: string, payload: JsonRecord) =>
    request<JsonRecord>(
      `/api/affiliates/providers/${encodeURIComponent(provider)}`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  deleteAffiliateProvider: (provider: string, connectionId?: number) =>
    request<JsonRecord>(
      `/api/affiliates/providers/${encodeURIComponent(provider)}${connectionId ? `?connectionId=${connectionId}` : ""}`,
      { method: "DELETE" },
    ),
  affiliateLinks: (provider: string, limit = 2000) =>
    request<JsonRecord>(`/api/affiliates/${provider}/links?limit=${limit}`),
  createAffiliateLink: (
    provider: string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(`/api/affiliates/${provider}/links`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAffiliateLink: (
    provider: string,
    itemId: string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/affiliates/${provider}/links/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  deleteAffiliateLink: (provider: string, itemId: string) =>
    request<JsonRecord>(
      `/api/affiliates/${provider}/links/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    ),
  deleteAffiliateLinks: (provider: string, itemIds: string[]) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/links`,
      {
        method: "DELETE",
        body: JSON.stringify({ itemIds }),
      },
    ),
  affiliateAutoSync: (provider: string) =>
    request<JsonRecord>(`/api/affiliates/${encodeURIComponent(provider)}/auto-sync`),
  saveAffiliateAutoSync: (provider: string, payload: JsonRecord) =>
    request<JsonRecord>(`/api/affiliates/${encodeURIComponent(provider)}/auto-sync`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  affiliateMlResolver: () =>
    request<JsonRecord>("/api/affiliates/mercadolivre/resolver"),
  saveAffiliateMlResolver: (payload: JsonRecord) =>
    request<JsonRecord>("/api/affiliates/mercadolivre/resolver", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  affiliateGroupDispatches: (provider: string) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/group-dispatches`,
    ),
  createAffiliateGroupDispatch: (provider: string, payload: JsonRecord) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/group-dispatches`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  updateAffiliateGroupDispatch: (
    provider: string,
    dispatchId: number | string,
    payload: JsonRecord,
  ) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/group-dispatches/${encodeURIComponent(String(dispatchId))}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
  deleteAffiliateGroupDispatch: (
    provider: string,
    dispatchId: number | string,
  ) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/group-dispatches/${encodeURIComponent(String(dispatchId))}`,
      { method: "DELETE" },
    ),
  affiliateMessageTemplate: (provider: string) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/message-template`,
    ),
  saveAffiliateMessageTemplate: (provider: string, payload: JsonRecord) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/message-template`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  searchAffiliateProducts: (
    provider: string,
    options: {
      query: string;
      limit?: number;
      mode?: "standard" | "promotions" | "aggressive";
      autoAffiliate?: boolean;
    },
  ) => {
    const params = new URLSearchParams({
      categoryName: options.query,
      limit: String(options.limit || 40),
      mode: options.mode || "promotions",
      autoAffiliate: options.autoAffiliate === false ? "false" : "true",
      preferHighDemand: "true",
    });
    return request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/products?${params.toString()}`,
    );
  },
  importAffiliateProducts: (provider: string, entries: JsonRecord[]) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/links/import`,
      { method: "POST", body: JSON.stringify({ entries }) },
    ),
  refreshAffiliateProducts: (provider: string) =>
    request<JsonRecord>(
      `/api/affiliates/${encodeURIComponent(provider)}/links/refresh`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  store: (instanceId: number) =>
    request<JsonRecord>(`/api/user/store?instanceId=${instanceId}`),
  affiliate: () => request<JsonRecord>("/api/user/bot-resale/affiliate"),
  apiRest: () => request<JsonRecord>("/api/user/apirest"),
  updateApiRest: (payload: JsonRecord) =>
    request<JsonRecord>("/api/user/apirest", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  webhookSettings: () =>
    request<{ webhook?: JsonRecord | null }>("/api/webhooks/meta/settings"),
  saveWebhookSettings: (payload: JsonRecord) =>
    request<{ webhook?: JsonRecord | null }>("/api/webhooks/meta/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  testWebhookSettings: (payload: JsonRecord) =>
    request<JsonRecord>("/api/webhooks/meta/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  campaigns: () => request<JsonRecord>("/api/bot-ad-campaigns"),
};
