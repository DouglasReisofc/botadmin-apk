"use client";

import { ChangeEvent, FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Form,
  Spinner,
} from "react-bootstrap";
import {
  IconArrowLeft,
  IconAlertCircle,
  IconArchive,
  IconBell,
  IconBellOff,
  IconBrandWhatsapp,
  IconBox,
  IconCamera,
  IconCheck,
  IconChecks,
  IconChevronDown,
  IconClock,
  IconCopy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconExternalLink,
  IconLogout,
  IconMapPin,
  IconList,
  IconMessageCircle,
  IconMicrophone,
  IconMoodSmile,
  IconPaperclip,
  IconPencil,
  IconPhoneCall,
  IconPhoneOff,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconSend,
  IconSettings,
  IconSpeakerphone,
  IconSparkles,
  IconTrash,
  IconUser,
  IconUserCircle,
  IconWallet,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";

import styles from "./WhatsAppConversationsClient.module.css";

type InstanceSummary = {
  id: number;
  name: string;
  phone: string;
  sessionStatus: string;
  sharedAccess?: boolean;
  virtual?: "shared_conversations";
};

type ThreadSummary = {
  id: number;
  instanceId: number;
  chatJid: string;
  chatType: "contact" | "group" | "channel" | "broadcast" | "unknown";
  title: string | null;
  phone: string | null;
  avatarUrl: string | null;
  groupDescription?: string | null;
  participantsCount?: number | null;
  linkedGroupId?: number | null;
  inviteLink?: string | null;
  announceOnly?: boolean | null;
  instanceIsAdmin?: boolean | null;
  mentionable?: boolean | null;
  directorySource?: "messages" | "contacts" | "groups" | "channels" | null;
  sharedAccess?: boolean;
  shareKind?: "group_admin" | "conversation";
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageSenderName: string | null;
  lastMessageSenderJid: string | null;
  unreadCount: number;
  archived?: boolean;
  pinned?: boolean;
  muted?: boolean;
};

type MessageLocalStatus = "pending" | "sent" | "failed";

type ConversationMessage = {
  id: number;
  chatJid: string;
  messageId: string | null;
  direction: "inbound" | "outbound";
  senderJid: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  messageType: string;
  text: string | null;
  media: Record<string, unknown> | null;
  deletedAt?: string | null;
  deletedByJid?: string | null;
  deletedByName?: string | null;
  deletedPlaceholder?: string | null;
  revealDeletedContent?: boolean;
  timestamp: string;
  createdAt?: string;
  /** Client-only delivery state for optimistic outbound messages. */
  localStatus?: MessageLocalStatus | null;
  deliveryState?: "sent" | "delivered" | "read";
  receiptSummary?: { recipientCount: number; deliveredCount: number; readCount: number };
};

type MessageReaction = {
  id: number;
  messageId: string | null;
  targetMessageId: string;
  emoji: string;
  senderJid: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  timestamp: string;
};

type MessageReactionGroup = {
  emoji: string;
  count: number;
  reactions: MessageReaction[];
};

type MessageReactionModalState = {
  message: ConversationMessage;
  groups: MessageReactionGroup[];
};

type ConversationRealtimeDetail = {
  type?: string;
  eventType?: string;
  sequenceId?: number;
  instanceId?: number;
  chatJid?: string;
  messageId?: string | null;
  occurredAt?: string;
  createdAt?: string;
  payload?: {
    action?: string;
    call?: Record<string, unknown> | null;
    callId?: string | number | null;
    id?: string | number | null;
    CallID?: string | number | null;
    from?: string | null;
    From?: string | null;
    to?: string | null;
    To?: string | null;
    callCreator?: string | null;
    CallCreator?: string | null;
    creator?: string | null;
    read?: boolean;
    archived?: boolean;
    pinned?: boolean;
    muted?: boolean;
    clearMessages?: boolean;
    deleteThread?: boolean;
    deletedMessageId?: string | null;
    thread?: ThreadSummary | null;
    message?: ConversationMessage | null;
    visibleMessage?: ConversationMessage | null;
    chatAction?: {
      action?: string;
      read?: boolean;
      archived?: boolean;
      pinned?: boolean;
      muted?: boolean;
    } | null;
    messageAction?: {
      action?: string;
      messageId?: string | null;
    } | null;
    receipt?: Record<string, unknown> | null;
  } | null;
  message?: ConversationMessage | null;
  thread?: ThreadSummary | null;
  sourceClientId?: string;
};

type ConversationCallState = {
  instanceId: number;
  chatJid: string;
  callId: string;
  action: string;
  direction?: "incoming" | "outgoing" | null;
  fromJid?: string | null;
  callCreatorJid?: string | null;
  reason?: string | null;
  timestamp?: string | null;
};

type ActiveCallView = {
  key: string;
  call: ConversationCallState;
  thread: ThreadSummary | null;
  instance: InstanceSummary | null;
};

type WhatsappCallResponse = {
  ok?: boolean;
  action?: string;
  chatJid?: string | null;
  callId?: string | null;
  alreadyEnded?: boolean;
  sdpAnswer?: string | null;
  call?: Record<string, unknown> | null;
};

type CallAudioBridgeHandle = {
  callId: string;
  peerConnection?: RTCPeerConnection | null;
  dataChannel?: RTCDataChannel | null;
  socket?: WebSocket | null;
  stream: MediaStream;
  audioContext: AudioContext;
  audioNodes: AudioNode[];
  playbackElement: HTMLAudioElement | null;
  frameMonitorTimer: number | null;
};

type PollVoterSummary = {
  jid: string;
  name: string;
};

type PollOptionSummary = {
  title: string;
  votes: number;
  voters: PollVoterSummary[];
};

type ChatProfile = {
  title: string;
  subtitle: string;
  phone: string | null;
  jid: string;
  avatarUrl: string | null;
  kind: string;
};

type BotFlowSummary = {
  id: number;
  scope: "group" | "private" | "both";
  instanceId: number | null;
  groupId: number | null;
  name: string;
  command: string;
  triggerType: string;
  matchMode: string;
  enabled: boolean;
  description: string | null;
};

type BotGroupParticipantSummary = {
  id: string;
  admin?: "superadmin" | "admin" | "member" | null;
  name?: string | null;
  displayName?: string | null;
  pushName?: string | null;
  phone?: string | null;
  imageUrl?: string | null;
  avatarUrl?: string | null;
};

type BotGroupShareSummary = {
  id: number;
  groupId: number;
  ownerUserId: number;
  sharedUserId: number;
  name: string;
  email: string | null;
  createdAt: string;
};

type BotGroupAdSummary = {
  id: string;
  enabled?: boolean;
  caption: string;
  mentionAll: boolean;
  scheduleType: "frequency" | "times";
  frequency?: string | null;
  times?: string[];
  lastSentAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ConversationShareSummary = {
  id: number;
  instanceId: number;
  ownerUserId: number;
  sharedUserId: number;
  chatJid: string;
  name: string;
  email: string | null;
  createdAt: string;
};

type ParticipantActionTarget = {
  participant: BotGroupParticipantSummary;
  message: ConversationMessage | null;
  origin: "participant" | "message";
};

type BotGroupSummary = {
  id: number;
  instanceId: number;
  remoteId: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  status: "active" | "disabled";
  slot: number;
  participantCount?: number;
  participants?: BotGroupParticipantSummary[];
  accessRole?: "owner" | "shared_admin";
  sharedWith?: BotGroupShareSummary[];
  metadata: {
    adminsOnly?: boolean;
    locked?: boolean;
    ephemeral?: string | null;
    lastDeactivatedAt?: string | null;
    licenseExpiresAt?: string | null;
    licensePlanName?: string | null;
    licenseSource?: string | null;
    licenseRemovedAt?: string | null;
    licenseTransferredToGroupId?: number | null;
    botPausedPreserveAccess?: boolean;
    botPausedPreserveAccessAt?: string | null;
    botPausedPreserveAccessReason?: string | null;
  };
};

type ExternalGroupLinkSummary = {
  remoteId: string;
  linkedToOtherUser: boolean;
};

type BotGroupListPayload = {
  groups: BotGroupSummary[];
  externalLinks?: ExternalGroupLinkSummary[];
};

type UserPlanSummary = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  addonInstancePrice?: number;
  addonGroupPrice?: number;
  groupLimit: number;
  instanceLimit: number;
  durationDays: number;
  isActive: boolean;
};

type UserPlanStatusSummary = {
  status: string;
  currentPeriodEnd: string | null;
  plan: UserPlanSummary | null;
};

type PaymentMethodSummary = {
  provider: "mercadopago_pix" | "mercadopago_checkout" | "polopag_pix";
  displayName: string;
  isActive: boolean;
  isConfigured: boolean;
};

type UserPlanSnapshot = {
  status?: UserPlanStatusSummary | null;
  plans: UserPlanSummary[];
  paymentMethods: PaymentMethodSummary[];
};

type GroupPlanPickerState = {
  group: BotGroupSummary;
  mode: "activation" | "renewal";
  scope: "group" | "profile";
};

type GroupPaymentPickerState = GroupPlanPickerState & {
  plan: UserPlanSummary;
};

type PlanCheckoutResponse = {
  paymentId: string;
  providerPaymentId: string;
  provider: PaymentMethodSummary["provider"];
  amount: number;
  ticketUrl: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  expiresAt: string | null;
};

type GroupCheckoutState = GroupPaymentPickerState & {
  checkout: PlanCheckoutResponse;
};

type GroupSettingsSummary = {
  commandToggles: Record<string, boolean>;
  featureFlags?: Record<string, boolean>;
  welcomeConfig?: {
    enabled?: boolean;
    caption?: string | null;
    mediaUrl?: string | null;
    mediaPath?: string | null;
    useParticipantProfilePhoto?: boolean;
    asSticker?: boolean;
  };
  farewellConfig?: {
    enabled?: boolean;
    caption?: string | null;
    mediaUrl?: string | null;
    mediaPath?: string | null;
    useParticipantProfilePhoto?: boolean;
    asSticker?: boolean;
  };
  bannedWords?: string[];
  allowedLinks?: string[];
  antipalavrasMaxInfractions?: number;
  allowedDdis?: string[];
  antifakeMessage?: string;
  antiInactivityConfig: {
    enabled: boolean;
    days: number;
    scanIntervalHours: number;
    removeLimit: number;
    lastRunAt: string | null;
    lastRemovedCount: number;
    lastError: string | null;
  };
  scheduleConfig?: {
    closeEnabled?: boolean;
    closeTimes?: string[];
    closeMessage?: string | null;
    openEnabled?: boolean;
    openTimes?: string[];
    openMessage?: string | null;
    timezone?: string | null;
  };
};

const RAW_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const BASE_PREFIX = RAW_BASE_PATH && RAW_BASE_PATH !== "/"
  ? (RAW_BASE_PATH.startsWith("/") ? RAW_BASE_PATH : `/${RAW_BASE_PATH}`)
  : "";

const apiPath = (path: string) => `${BASE_PREFIX}${path}`;

const buildWhatsappCallMediaWebSocketUrl = (instanceId: number, callId: string) => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(apiPath("/ws/whatsapp-call-media"), `${protocol}//${window.location.host}`);
  url.searchParams.set("instanceId", String(instanceId));
  url.searchParams.set("callId", callId);
  return url.toString();
};

type ThreadFilter = "all" | "unread" | "favorites" | "groups" | "archived";
type ActivationConfigTarget = "welcome" | "farewell" | "schedule" | "allowedLinks" | "bannedWords" | "antiInactivity" | "antiFake";
type ActivationEditorField = "welcomeText" | "farewellText" | "schedule" | "allowedLinks" | "bannedWords" | "antiInactivity" | "antiFake";
type DashboardSection =
  | "instances"
  | "flows"
  | "affiliates"
  | "apirest"
  | "campaigns"
  | "status"
  | "payments";

const DASHBOARD_SECTION_STORAGE_KEY = "botadmin.dashboard.section";
const THREAD_PIN_STORAGE_PREFIX = "botadmin.whatsapp.pinned";
const SHARED_CONVERSATIONS_INSTANCE_ID = -1;
// Keep the first paint small. Older messages are fetched incrementally when the
// user scrolls, which avoids a large synchronous render on mobile/WebView.
const WHATSAPP_INITIAL_MESSAGE_LIMIT = 150;
const WHATSAPP_OLDER_MESSAGE_LIMIT = 500;
const getThreadSelectionKey = (thread: ThreadSummary) => `${thread.instanceId}|${thread.chatJid}`;
const normalizeJidKey = (value: string | null | undefined) => (value || "").trim().toLowerCase();
const getConversationCallKey = (instanceId: number | null | undefined, chatJid: string | null | undefined) =>
  instanceId && chatJid ? `${instanceId}|${chatJid}` : null;

const splitConversationCallKey = (key: string) => {
  const separator = key.indexOf("|");
  if (separator <= 0) return null;
  const instanceId = Number.parseInt(key.slice(0, separator), 10);
  const chatJid = key.slice(separator + 1);
  if (!Number.isFinite(instanceId) || instanceId <= 0 || !chatJid) return null;
  return { instanceId, chatJid };
};

const readCallString = (record: Record<string, unknown> | null | undefined, ...keys: string[]) => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return String(value);
  }
  return null;
};

const readCallObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const isTerminalCallAction = (action: string | null | undefined) =>
  ["reject", "rejected", "terminate", "terminated", "end", "ended", "hangup", "close", "closed"].includes(
    (action || "").trim().toLowerCase(),
  );

const isMissingWhatsappCallError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return normalized.includes("no such call") ||
    normalized.includes("call not found") ||
    normalized.includes("chamada já finalizada") ||
    normalized.includes("chamada ja finalizada");
};

const isIncomingCallAction = (action: string | null | undefined) =>
  ["offer", "notice", "incoming", "ringing"].includes((action || "").trim().toLowerCase());

const getCallStatusLabel = (call: ConversationCallState | null | undefined) => {
  const action = (call?.action || "").toLowerCase();
  if (!call) return "";
  if (isIncomingCallAction(action)) return "Chamada recebida";
  if (action === "accept" || action === "accepted" || action === "active" || action === "connect" || action === "connected") {
    return "Chamada em andamento";
  }
  if (action === "start" || action === "starting" || action === "outgoing" || action === "ringing") return "Chamando...";
  return "Chamada ativa";
};

const extractCallStateFromRealtime = (detail: ConversationRealtimeDetail): ConversationCallState | null => {
  const payload = readCallObject(detail.payload);
  const call = readCallObject(payload?.call);
  const root = detail as unknown as Record<string, unknown>;
  const instanceId = Number(detail.instanceId ?? readCallString(payload, "instanceId") ?? 0);
  const chatJid =
    detail.chatJid ??
    readCallString(payload, "chatJid", "Chat", "chat", "from", "From", "to", "To") ??
    readCallString(call, "chatJid", "Chat", "chat", "from", "From", "to", "To") ??
    null;
  const callId =
    readCallString(payload, "callId", "CallID", "id", "ID") ??
    readCallString(call, "callId", "CallID", "id", "ID", "call-id") ??
    readCallString(root, "messageId") ??
    null;
  if (!instanceId || !chatJid || !callId) return null;
  const action =
    readCallString(payload, "action", "type", "eventType") ??
    readCallString(call, "action", "type", "eventType") ??
    "update";
  const fromJid =
    readCallString(payload, "from", "From") ??
    readCallString(call, "from", "From", "chatJid", "Chat", "to", "To");

  return {
    instanceId,
    chatJid,
    callId,
    action,
    direction: fromJid && normalizeJidKey(fromJid) !== normalizeJidKey(chatJid) ? "outgoing" : "incoming",
    fromJid,
    callCreatorJid:
      readCallString(payload, "callCreator", "CallCreator", "creator", "Creator") ??
      readCallString(call, "callCreator", "CallCreator", "creator", "Creator"),
    reason: readCallString(payload, "reason", "Reason") ?? readCallString(call, "reason", "Reason"),
    timestamp:
      readCallString(payload, "timestamp", "Timestamp", "occurredAt", "createdAt") ??
      readCallString(call, "timestamp", "Timestamp") ??
      detail.occurredAt ??
      detail.createdAt ??
      null,
  };
};

const extractCallStateFromApiResponse = (
  payload: WhatsappCallResponse,
  fallback: { instanceId: number; chatJid: string; action: string; callId?: string | null },
): ConversationCallState => {
  const call = readCallObject(payload.call);
  const root = payload as unknown as Record<string, unknown>;
  const callId =
    readCallString(root, "callId", "CallID", "id", "ID") ??
    readCallString(call, "callId", "CallID", "id", "ID", "CallId") ??
    fallback.callId ??
    `local-${Date.now()}`;
  return {
    instanceId: fallback.instanceId,
    chatJid: payload.chatJid || fallback.chatJid,
    callId,
    action: payload.action || readCallString(call, "action", "type", "eventType") || fallback.action,
    direction: fallback.action === "start" ? "outgoing" : null,
    fromJid: readCallString(call, "from", "From", "PeerJid", "peerJid"),
    callCreatorJid: readCallString(call, "callCreator", "CallCreator", "creator", "Creator"),
    reason: readCallString(call, "reason", "Reason"),
    timestamp: readCallString(call, "timestamp", "Timestamp") ?? new Date().toISOString(),
  };
};

const extractSdpAnswerFromCallResponse = (payload: WhatsappCallResponse): string | null => {
  const root = payload as unknown as Record<string, unknown>;
  const call = readCallObject(payload.call);
  const nested = readCallObject(call?.data) ?? readCallObject(call?.result) ?? readCallObject(call?.call);
  return (
    readCallString(root, "sdpAnswer", "sdp_answer", "SDPAnswer") ??
    readCallString(call, "sdpAnswer", "sdp_answer", "SDPAnswer") ??
    readCallString(nested, "sdpAnswer", "sdp_answer", "SDPAnswer")
  );
};

const payloadContainsCallId = (payload: unknown, callId: string) => {
  if (!callId) return false;
  return JSON.stringify(payload ?? {}).includes(callId);
};

const waitForIceGatheringComplete = (peerConnection: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (peerConnection.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const onStateChange = () => {
      if (peerConnection.iceGatheringState === "complete") {
        peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      }
    };
    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
  });

const normalizeRtcSdp = (value: string | null | undefined) => {
  const normalized = (value ?? "").replace(/\r?\n/g, "\r\n").trim();
  return normalized ? `${normalized}\r\n` : "";
};

const looksLikeRtcOffer = (sdp: string) => {
  if (!/^v=0\r?\n/i.test(sdp)) return false;
  if (!/\r?\nm=application\s/i.test(sdp)) return false;
  return /webrtc-datachannel|udp\/dtls\/sctp|dtls\/sctp|a=sctp-port/i.test(sdp);
};

const sanitizeRtcAnswer = (value: string | null | undefined) => {
  const normalized = (value ?? "").replace(/\r?\n/g, "\n").trim();
  if (!normalized) return "";
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "a=end-of-candidates");
  return lines.length ? `${lines.join("\r\n")}\r\n` : "";
};

const looksLikeRtcAnswer = (sdp: string) => {
  if (!/^v=0\r?\n/i.test(sdp)) return false;
  if (!/\r?\nm=application\s/i.test(sdp)) return false;
  if (!/\r?\na=ice-ufrag:/i.test(sdp)) return false;
  if (!/\r?\na=fingerprint:/i.test(sdp)) return false;
  return /webrtc-datachannel|udp\/dtls\/sctp|dtls\/sctp|a=sctp-port/i.test(sdp);
};

const CALL_AUDIO_SAMPLE_RATE = 16000;
const CALL_CAPTURE_WORKLET_URL = "/worklets/call-capture-processor.js";
const CALL_PLAYBACK_WORKLET_URL = "/worklets/call-playback-processor.js";
const CALL_AUDIO_WORKLET_VERSION = "20260630-7";
const CALL_CAPTURE_PROCESSOR_NAME = "botadmin-call-capture";
const CALL_PLAYBACK_PROCESSOR_NAME = "botadmin-call-playback";
const CALL_AUDIO_MAX_BUFFERED_BYTES = 128_000;
const callAudioWorkletUrl = (path: string) => `${path}?v=${CALL_AUDIO_WORKLET_VERSION}`;

const downsamplePcm = (input: ArrayLike<number>, inputRate: number, outputRate: number) => {
  if (inputRate === outputRate) return Float32Array.from(input);
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      sum += input[cursor] ?? 0;
      count += 1;
    }
    output[index] = count > 0 ? sum / count : 0;
  }
  return output;
};

const float32ToInt16Le = (pcm: ArrayLike<number>) => {
  const buffer = new ArrayBuffer(pcm.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < pcm.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
};

const int16LeToFloat32 = (buffer: ArrayBuffer) => {
  const view = new DataView(buffer);
  const output = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return output;
};

const dataChannelPayloadToArrayBuffer = async (payload: unknown): Promise<ArrayBuffer | null> => {
  if (payload instanceof ArrayBuffer) return payload.slice(0);
  if (ArrayBuffer.isView(payload)) {
    const source = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy.buffer;
  }
  if (typeof SharedArrayBuffer !== "undefined" && payload instanceof SharedArrayBuffer) {
    const source = new Uint8Array(payload);
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy.buffer;
  }
  if (payload instanceof Blob) {
    return payload.arrayBuffer();
  }
  return null;
};

const SHARED_CONVERSATIONS_INSTANCE: InstanceSummary = {
  id: SHARED_CONVERSATIONS_INSTANCE_ID,
  name: "Conversas compartilhadas",
  phone: "",
  sessionStatus: "compartilhado",
  sharedAccess: true,
  virtual: "shared_conversations",
};

type WhatsAppConversationsClientProps = {
  embedded?: boolean;
  brandName?: string;
  brandLogo?: string;
  preferredInstanceId?: number | null;
  activeGroupChatJids?: string[];
  onPreferredInstanceChange?: (instanceId: number | null) => void;
  onToggleGroupActive?: (groupId: number, active: boolean) => void | Promise<void>;
  onMobileChatOpenChange?: (open: boolean) => void;
};

const THREAD_FILTERS: { id: ThreadFilter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "unread", label: "Não lidas" },
  { id: "favorites", label: "Favoritas" },
  { id: "groups", label: "Grupos" },
  { id: "archived", label: "Arquivadas" },
];

const GROUP_QUICK_TOGGLES: { key: string; label: string }[] = [
  { key: "autoresposta", label: "Auto resposta" },
  { key: "botinterage", label: "BotInterage" },
  { key: "bemvindo", label: "Boas-vindas" },
  { key: "despedida", label: "Saída" },
  { key: "antilink", label: "Anti-link" },
  { key: "antipalavras", label: "Anti-palavras" },
];

const GROUP_ACTIVATION_SECTIONS: Array<{
  title: string;
  items: Array<{ key: string; label: string; description: string }>;
}> = [
  {
    title: "Atendimento e IA",
    items: [
      { key: "autoresposta", label: "Auto resposta", description: "Responde gatilhos cadastrados." },
      { key: "botinterage", label: "BotInterage", description: "IA conversa no grupo." },
      { key: "vozbotinterage", label: "IA por voz", description: "Respostas em áudio." },
      { key: "lerimagem", label: "Ler imagem", description: "IA interpreta imagens." },
      { key: "bemvindo", label: "Boas-vindas", description: "Recebe novos membros." },
      { key: "despedida", label: "Saída", description: "Envia mensagem quando alguém sai." },
      { key: "soadm", label: "Só admin", description: "Restringe comandos críticos." },
    ],
  },
  {
    title: "Proteção",
    items: [
      { key: "antilink", label: "Anti-link", description: "Bloqueia links comuns." },
      { key: "antilinkgp", label: "Anti-link GP", description: "Bloqueia convites de grupo." },
      { key: "antipalavras", label: "Anti-palavras", description: "Remove termos proibidos." },
      { key: "banextremo", label: "Ban extremo", description: "Remove em infrações graves." },
      { key: "bangringos", label: "Ban gringos", description: "Controla DDIs não permitidos." },
      { key: "antinsfwimagem", label: "Anti-NSFW", description: "Modera imagens sensíveis." },
    ],
  },
  {
    title: "Mídia e utilidades",
    items: [
      { key: "autosticker", label: "Auto sticker", description: "Cria stickers automaticamente." },
      { key: "autodownloader", label: "Auto download", description: "Baixa links suportados." },
      { key: "antisticker", label: "Anti-sticker", description: "Bloqueia stickers." },
      { key: "antimage", label: "Anti-imagem", description: "Bloqueia imagens." },
      { key: "antvideo", label: "Anti-vídeo", description: "Bloqueia vídeos." },
      { key: "antaudio", label: "Anti-áudio", description: "Bloqueia áudios." },
      { key: "antdoc", label: "Anti-doc", description: "Bloqueia documentos." },
      { key: "antvcard", label: "Anti-contato", description: "Bloqueia cartões de contato." },
      { key: "moderacaocomia", label: "Moderação IA", description: "Usa IA para moderação." },
      { key: "brincadeiras", label: "Brincadeiras", description: "Libera comandos de diversão." },
      { key: "linkmembro", label: "Link membro", description: "Permite link por membro." },
    ],
  },
];

const CONFIGURABLE_ACTIVATION_KEYS: Record<string, ActivationConfigTarget> = {
  bemvindo: "welcome",
  despedida: "farewell",
  antilink: "allowedLinks",
  antilinkgp: "allowedLinks",
  antipalavras: "bannedWords",
  bangringos: "antiFake",
};

const ACTIVATION_CONFIG_COPY: Record<ActivationConfigTarget, { title: string; subtitle: string }> = {
  welcome: {
    title: "Configurar boas-vindas",
    subtitle: "Texto, mídia e envio em sticker.",
  },
  farewell: {
    title: "Configurar saída",
    subtitle: "Texto, mídia e foto de perfil ao sair.",
  },
  schedule: {
    title: "Abrir e fechar automaticamente",
    subtitle: "Horários para liberar ou restringir mensagens no grupo.",
  },
  allowedLinks: {
    title: "Links permitidos",
    subtitle: "Endereços ignorados pelo antilink.",
  },
  bannedWords: {
    title: "Configurar anti-palavras",
    subtitle: "Lista de termos e limite de infrações.",
  },
  antiInactivity: {
    title: "Configurar anti-inatividade",
    subtitle: "Dias sem falar, varredura e remoções por execução.",
  },
  antiFake: {
    title: "Configurar anti-fake",
    subtitle: "DDIs permitidos e mensagem de bloqueio.",
  },
};

const readJson = async <T,>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "Falha na requisição.";
    throw new Error(message);
  }
  return payload as T;
};

const formatPhone = (value: string | null | undefined) => {
  const digits = (value || "").replace(/\D+/g, "");
  if (!digits) return value || "";
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return `+${digits}`;
};

const formatMoney = (value: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);

const parseMultilineItems = (value: string) =>
  value
    .split(/[\n,;,]+/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);

const parseScheduleTimesDraft = (value: string) =>
  parseMultilineItems(value)
    .map((entry) => {
      const match = entry.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const hour = Number.parseInt(match[1] ?? "", 10);
      const minute = Number.parseInt(match[2] ?? "", 10);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry, index, array) => array.indexOf(entry) === index);

const resolveStoredMediaPreviewUrl = (mediaUrl?: string | null, mediaPath?: string | null) => {
  const direct = (mediaUrl || "").trim();
  if (direct) return direct;
  const stored = (mediaPath || "").trim().replace(/^\/+/, "");
  if (!stored) return "";
  if (/^https?:\/\//i.test(stored)) return stored;
  return apiPath(`/${stored}`);
};

const isVideoUrl = (value: string) => /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(value);
const isAudioUrl = (value: string) => /\.(mp3|ogg|wav|m4a)(?:[?#].*)?$/i.test(value);

const formatTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: sameDay ? "2-digit" : undefined,
    minute: sameDay ? "2-digit" : undefined,
    day: sameDay ? undefined : "2-digit",
    month: sameDay ? undefined : "2-digit",
  }).format(date);
};

const formatLongDateTime = (iso: string | null | undefined) => {
  if (!iso) return "Sem registro";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatShortDateTime = (iso: string | null | undefined) => {
  if (!iso) return "Sem validade";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sem validade";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatDateSeparator = (iso: string | null | undefined) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.round((startOfToday - startOfMessageDay) / 86_400_000);
  if (dayDelta === 0) return "Hoje";
  if (dayDelta === 1) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
};

const getMessageTimestampMs = (message: Pick<ConversationMessage, "timestamp" | "createdAt">) => {
  const primary = Date.parse(message.timestamp);
  if (Number.isFinite(primary)) return primary;
  const created = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
  return Number.isFinite(created) ? created : 0;
};

const getConversationMessageKey = (message: ConversationMessage) =>
  message.messageId?.trim() ||
  (message.id > 0 ? String(message.id) : "") ||
  `${message.chatJid}|${message.senderJid ?? ""}|${message.timestamp}|${message.text ?? ""}|${JSON.stringify(message.media ?? {})}`;

const isSameOptimisticMessage = (left: ConversationMessage, right: ConversationMessage) =>
  left.direction === "outbound" &&
  right.direction === "outbound" &&
  (left.messageId?.startsWith("local-") || left.id < 0 || right.messageId?.startsWith("local-") || right.id < 0) &&
  (left.text ?? "") === (right.text ?? "") &&
  Math.abs(getMessageTimestampMs(left) - getMessageTimestampMs(right)) < 120_000;

const sortConversationMessages = (messages: ConversationMessage[]) =>
  [...messages].sort((left, right) => {
    const timeDelta = getMessageTimestampMs(left) - getMessageTimestampMs(right);
    if (timeDelta !== 0) return timeDelta;
    return left.id - right.id;
  });

const mergeConversationMessage = (messages: ConversationMessage[], incoming: ConversationMessage) => {
  const incomingKey = getConversationMessageKey(incoming);
  let replaced = false;
  const next = messages.map((message) => {
    const sameMessage =
      getConversationMessageKey(message) === incomingKey ||
      (incoming.id > 0 && message.id === incoming.id) ||
      isSameOptimisticMessage(message, incoming);
    if (!sameMessage) return message;
    replaced = true;
    const mergedLocalStatus: MessageLocalStatus | null | undefined =
      incoming.localStatus !== undefined
        ? incoming.localStatus
        : incoming.messageId && !String(incoming.messageId).startsWith("local-")
          ? "sent"
          : message.localStatus;
    return {
      ...message,
      ...incoming,
      media: incoming.media ?? message.media,
      localStatus: mergedLocalStatus,
    };
  });
  if (!replaced) next.push(incoming);
  const deduped = new Map<string, ConversationMessage>();
  for (const message of next) {
    deduped.set(getConversationMessageKey(message), message);
  }
  return sortConversationMessages(Array.from(deduped.values()));
};

const getMessagePreviewText = (message: ConversationMessage) => {
  const text = message.text?.trim();
  if (text) return text.slice(0, 500);
  return describeMedia(message);
};

const sortThreadsByActivity = (threads: ThreadSummary[]) =>
  [...threads].sort((left, right) => {
    const leftPinned = left.pinned ? 1 : 0;
    const rightPinned = right.pinned ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    const leftTime = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
    const rightTime = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
    return rightTime - leftTime;
  });

const getThreadStableKey = (thread: Pick<ThreadSummary, "instanceId" | "chatJid">) =>
  `${thread.instanceId}:${thread.chatJid}`;

const mergeStableThreadMetadata = (
  incoming: ThreadSummary,
  existing: ThreadSummary | null | undefined,
): ThreadSummary => {
  if (!existing) return incoming;
  return {
    ...incoming,
    title: incoming.title || existing.title,
    phone: incoming.phone || existing.phone,
    avatarUrl: incoming.avatarUrl || existing.avatarUrl,
    groupDescription: incoming.groupDescription ?? existing.groupDescription ?? null,
    participantsCount: incoming.participantsCount ?? existing.participantsCount ?? null,
    linkedGroupId: incoming.linkedGroupId ?? existing.linkedGroupId ?? null,
    inviteLink: incoming.inviteLink ?? existing.inviteLink ?? null,
    announceOnly: incoming.announceOnly ?? existing.announceOnly ?? null,
    instanceIsAdmin: incoming.instanceIsAdmin ?? existing.instanceIsAdmin ?? null,
    mentionable: incoming.mentionable ?? existing.mentionable ?? null,
    directorySource: incoming.directorySource ?? existing.directorySource ?? null,
    archived: incoming.archived ?? existing.archived,
    pinned: incoming.pinned ?? existing.pinned,
    muted: incoming.muted ?? existing.muted,
  };
};

const mergeThreadListWithStableMetadata = (
  incomingThreads: ThreadSummary[],
  existingThreads: ThreadSummary[],
) => {
  const byStableKey = new Map(existingThreads.map((thread) => [getThreadStableKey(thread), thread]));
  const byChatJid = new Map(existingThreads.map((thread) => [thread.chatJid, thread]));
  return incomingThreads.map((thread) =>
    mergeStableThreadMetadata(
      thread,
      byStableKey.get(getThreadStableKey(thread)) ?? byChatJid.get(thread.chatJid),
    ),
  );
};

const mergeRealtimeThread = (
  current: ThreadSummary[],
  params: {
    chatJid: string;
    selectedChatJid: string | null;
    thread?: ThreadSummary | null;
    message?: ConversationMessage | null;
    read?: boolean;
    clearMessages?: boolean;
    archived?: boolean;
    pinned?: boolean;
    muted?: boolean;
  },
) => {
  const existing = current.find((thread) => thread.chatJid === params.chatJid);
  const incomingThread = params.thread ?? null;
  const incomingMessage = params.message ?? null;
  const base = incomingThread && existing
    ? mergeStableThreadMetadata(incomingThread, existing)
    : incomingThread ?? existing;
  if (!base) return current;
  const messageTimestamp = incomingMessage?.timestamp ?? incomingMessage?.createdAt ?? null;
  const selectedThreadIsOpen = params.selectedChatJid === params.chatJid;
  const updated: ThreadSummary = {
    ...base,
    ...(incomingThread ?? {}),
    chatJid: params.chatJid,
    lastMessagePreview: params.clearMessages
      ? null
      : incomingMessage
        ? getMessagePreviewText(incomingMessage)
        : base.lastMessagePreview,
    lastMessageAt: params.clearMessages ? null : messageTimestamp ?? base.lastMessageAt,
    lastMessageDirection: params.clearMessages ? null : incomingMessage?.direction ?? base.lastMessageDirection,
    lastMessageSenderName: params.clearMessages ? null : incomingMessage?.senderName ?? base.lastMessageSenderName,
    lastMessageSenderJid: params.clearMessages ? null : incomingMessage?.senderJid ?? base.lastMessageSenderJid,
    unreadCount: params.clearMessages || params.read || selectedThreadIsOpen
      ? 0
      : incomingMessage?.direction === "inbound"
        ? Math.max(0, Number(base.unreadCount ?? 0)) + 1
        : Number(base.unreadCount ?? 0),
    archived: params.archived ?? base.archived,
    pinned: params.pinned ?? base.pinned,
    muted: params.muted ?? base.muted,
  };
  return sortThreadsByActivity([updated, ...current.filter((thread) => thread.chatJid !== params.chatJid)]);
};

const resolveThreadChatType = (thread: ThreadSummary | null): ThreadSummary["chatType"] => {
  if (!thread) return "unknown";
  if (thread.chatType && thread.chatType !== "unknown") return thread.chatType;
  const lowered = thread.chatJid.toLowerCase();
  if (lowered.endsWith("@g.us")) return "group";
  if (lowered.endsWith("@newsletter")) return "channel";
  if (lowered === "status@broadcast" || lowered.endsWith("@broadcast")) return "broadcast";
  if (lowered.endsWith("@s.whatsapp.net") || lowered.endsWith("@c.us")) return "contact";
  return "unknown";
};

const getPhoneFromChatJid = (chatJid: string | null | undefined) => {
  const local = (chatJid || "").split("@")[0] ?? "";
  const digits = local.replace(/\D+/g, "");
  return digits || null;
};

const normalizeMentionJid = (value: string | null | undefined) => {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.endsWith("@g.us") || trimmed.endsWith("@newsletter") || trimmed.endsWith("@broadcast")) {
    return null;
  }
  if (trimmed.endsWith("@s.whatsapp.net")) {
    const digits = trimmed.slice(0, -15).replace(/\D+/g, "");
    return digits ? `${digits}@s.whatsapp.net` : null;
  }
  if (trimmed.endsWith("@c.us")) {
    const digits = trimmed.slice(0, -5).replace(/\D+/g, "");
    return digits ? `${digits}@s.whatsapp.net` : null;
  }
  if (trimmed.includes("@")) return null;
  const digits = trimmed.replace(/\D+/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
};

const buildMentionTargets = (
  group: BotGroupSummary | null,
  instance: InstanceSummary | null,
) => {
  const participants = Array.isArray(group?.participants) ? group.participants : [];
  if (participants.length === 0) return [];
  const ownDigits = normalizeIdentityDigits(instance?.phone);
  const seen = new Set<string>();
  for (const participant of participants) {
    const jid = normalizeMentionJid(participant.id) ?? normalizeMentionJid(participant.phone);
    if (!jid) continue;
    const participantDigits = getPhoneFromChatJid(jid);
    if (ownDigits && participantDigits === ownDigits) continue;
    seen.add(jid);
  }
  return Array.from(seen);
};

const inferClientMediaType = (mimeType: string | null | undefined, filename?: string | null) => {
  const mime = (mimeType || "").toLowerCase();
  const name = (filename || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|ogg|oga|wav|m4a|webm)$/i.test(name)) return "audio";
  return "document";
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

const normalizeIdentityText = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase().replace(/\s+/g, " ");

const normalizeIdentityDigits = (value: string | null | undefined) =>
  (value || "").replace(/\D+/g, "");

const isRawWhatsappIdentifier = (value: string) => {
  const lowered = value.trim().toLowerCase();
  return (
    lowered.endsWith("@g.us") ||
    lowered.endsWith("@newsletter") ||
    lowered.endsWith("@s.whatsapp.net") ||
    lowered.endsWith("@c.us") ||
    lowered.endsWith("@broadcast") ||
    /^\d{8,}@/.test(lowered)
  );
};

const getParticipantDigits = (participant: BotGroupParticipantSummary | string | null | undefined) => {
  if (!participant) return "";
  if (typeof participant === "string") return normalizeIdentityDigits(participant);
  return normalizeIdentityDigits(participant.phone || participant.id);
};

const getParticipantAvatarUrl = (participant: BotGroupParticipantSummary | null | undefined) =>
  participant?.avatarUrl || participant?.imageUrl || null;

const getParticipantDisplayName = (participant: BotGroupParticipantSummary | null | undefined) => {
  if (!participant) return "Participante";
  const candidates = [
    participant.name,
    participant.displayName,
    participant.pushName,
  ];
  const name = candidates.find((value) => typeof value === "string" && value.trim() && !isRawWhatsappIdentifier(value));
  if (typeof name === "string" && name.trim()) return name.trim();
  const phone = formatPhone(getParticipantDigits(participant));
  return phone || participant.id || "Participante";
};

const getParticipantSubtitle = (participant: BotGroupParticipantSummary | null | undefined) => {
  if (!participant) return "";
  const phone = formatPhone(getParticipantDigits(participant));
  const name = getParticipantDisplayName(participant);
  if (phone && normalizeIdentityText(phone) !== normalizeIdentityText(name)) return phone;
  return participant.id;
};

const getParticipantRoleLabel = (participant: BotGroupParticipantSummary | null | undefined) => {
  if (participant?.admin === "superadmin") return "Dono";
  if (participant?.admin === "admin") return "Admin";
  return "Membro";
};

const getParticipantRoleRank = (participant: BotGroupParticipantSummary) => {
  if (participant.admin === "superadmin") return 0;
  if (participant.admin === "admin") return 1;
  return 2;
};

const participantMatches = (
  participant: BotGroupParticipantSummary | null | undefined,
  jid: string | null | undefined,
) => {
  const left = getParticipantDigits(participant);
  const right = normalizeIdentityDigits(jid);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
};

const isThreadTitlePlaceholder = (
  thread: ThreadSummary,
  instance: InstanceSummary | null | undefined,
) => {
  const title = (thread.title || "").trim();
  if (!title) return true;
  if (isRawWhatsappIdentifier(title)) return true;
  if (normalizeIdentityText(title) === normalizeIdentityText(thread.chatJid)) return true;

  const invalidNames = [
    instance?.name,
    instance?.phone,
    instance?.phone ? formatPhone(instance.phone) : null,
  ];
  const normalizedTitle = normalizeIdentityText(title);
  const titleDigits = normalizeIdentityDigits(title);
  return invalidNames.some((value) => {
    if (!value) return false;
    return normalizedTitle === normalizeIdentityText(value) || Boolean(titleDigits && titleDigits === normalizeIdentityDigits(value));
  });
};

const getFallbackThreadTitle = (thread: ThreadSummary) => {
  const type = resolveThreadChatType(thread);
  if (type === "contact") {
    return formatPhone(thread.phone || getPhoneFromChatJid(thread.chatJid)) || thread.chatJid;
  }
  if (type === "group") return "Grupo sem nome";
  if (type === "channel") return "Canal do WhatsApp";
  if (type === "broadcast") return "Lista de transmissão";
  return thread.chatJid;
};

const getThreadTitle = (
  thread: ThreadSummary | null,
  instance?: InstanceSummary | null,
) => {
  if (!thread) return "Conversas";
  if (!isThreadTitlePlaceholder(thread, instance)) return thread.title!.trim();
  return getFallbackThreadTitle(thread);
};

const getChatKindLabel = (thread: ThreadSummary | null) => {
  const type = resolveThreadChatType(thread);
  if (type === "contact") return "Usuário";
  if (type === "group") return "Grupo";
  if (type === "channel") return "Canal";
  if (type === "broadcast") return "Lista";
  return "Chat";
};

const getThreadSubtitle = (
  thread: ThreadSummary | null,
  instance?: InstanceSummary | null,
) => {
  if (!thread) return "";
  const type = resolveThreadChatType(thread);
  if (type === "group") {
    return thread.participantsCount
      ? `${thread.chatJid} • ${thread.participantsCount} participantes`
      : thread.chatJid;
  }
  if (type === "channel" || type === "broadcast") return thread.chatJid;

  const title = getThreadTitle(thread, instance);
  const phone = formatPhone(thread.phone || getPhoneFromChatJid(thread.chatJid));
  if (phone && normalizeIdentityText(phone) !== normalizeIdentityText(title)) return phone;
  return thread.chatJid;
};

const getSenderPhone = (message: ConversationMessage) =>
  formatPhone(getPhoneFromChatJid(message.senderJid) || "");

const getSenderDisplayName = (
  message: ConversationMessage,
  thread: ThreadSummary | null,
  instance?: InstanceSummary | null,
) => {
  if (message.direction === "outbound") return instance?.name || "Você";
  const name = message.senderName?.trim();
  if (name && !isRawWhatsappIdentifier(name)) return name;
  if (resolveThreadChatType(thread) === "contact") return getThreadTitle(thread, instance);
  return getSenderPhone(message) || "Usuário";
};

const buildThreadProfile = (
  thread: ThreadSummary,
  instance?: InstanceSummary | null,
): ChatProfile => ({
  title: getThreadTitle(thread, instance),
  subtitle: getThreadSubtitle(thread, instance) || thread.chatJid,
  phone: thread.phone ? formatPhone(thread.phone) : getPhoneFromChatJid(thread.chatJid) ? formatPhone(getPhoneFromChatJid(thread.chatJid)) : null,
  jid: thread.chatJid,
  avatarUrl: thread.avatarUrl,
  kind: getChatKindLabel(thread),
});

const buildSenderProfile = (
  message: ConversationMessage,
  thread: ThreadSummary | null,
  instance?: InstanceSummary | null,
): ChatProfile => {
  const phone = getSenderPhone(message);
  const jid = message.senderJid || message.chatJid;
  const isContactThread = resolveThreadChatType(thread) === "contact";
  return {
    title: getSenderDisplayName(message, thread, instance),
    subtitle: phone || jid,
    phone: phone || null,
    jid,
    avatarUrl: message.senderAvatarUrl || (isContactThread ? thread?.avatarUrl ?? null : null),
    kind: message.direction === "outbound" ? "Bot" : "Usuário",
  };
};

const getThreadPreview = (
  thread: ThreadSummary,
  instance?: InstanceSummary | null,
) => {
  const preview = thread.lastMessagePreview?.trim();
  if (!preview) return "Sem mensagens registradas";
  if (thread.lastMessageDirection === "outbound") return `Você: ${preview}`;

  const type = resolveThreadChatType(thread);
  const sender = thread.lastMessageSenderName?.trim();
  if (sender && (type === "group" || type === "channel" || type === "broadcast")) {
    const senderIsInstance =
      normalizeIdentityText(sender) === normalizeIdentityText(instance?.name) ||
      Boolean(normalizeIdentityDigits(sender) && normalizeIdentityDigits(sender) === normalizeIdentityDigits(instance?.phone));
    const senderIsTitle = normalizeIdentityText(sender) === normalizeIdentityText(getThreadTitle(thread, instance));
    if (!senderIsInstance && !senderIsTitle && !isRawWhatsappIdentifier(sender)) {
      return `${sender}: ${preview}`;
    }
  }

  return preview;
};

const hasThreadConversationActivity = (thread: ThreadSummary) => {
  const preview = thread.lastMessagePreview?.trim();
  return Boolean(
    preview ||
      thread.lastMessageAt ||
      thread.lastMessageDirection ||
      thread.lastMessageSenderName ||
      thread.lastMessageSenderJid ||
      thread.unreadCount > 0,
  );
};

const shouldShowThreadInList = (thread: ThreadSummary) => {
  if (thread.archived) return true;
  if (resolveThreadChatType(thread) !== "contact") return true;
  if (hasThreadConversationActivity(thread)) return true;
  return thread.directorySource !== "contacts";
};

const getInitials = (value: string) => {
  const words = value
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return "W";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

const getInstanceDisplayName = (instance: InstanceSummary | null) =>
  instance?.virtual === "shared_conversations"
    ? "Conversas compartilhadas"
    : instance
    ? `${instance.name} - ${formatPhone(instance.phone)}${instance.sharedAccess ? " · acesso compartilhado" : ""}`
    : "Nenhuma instância";

const getInstanceStatusLabel = (status: string | null | undefined) => {
  if (status === "compartilhado") return "Compartilhado";
  if (status === "conectado") return "Conectada";
  if (status === "aguardando_qr") return "Aguardando QR";
  if (status === "aguardando_pareamento") return "Aguardando pareamento";
  if (status === "inicializando") return "Inicializando";
  if (status === "desconectado") return "Desconectada";
  return status || "Sem status";
};

const getDirectorySourceLabel = (thread: ThreadSummary) => {
  if (thread.directorySource === "groups") return "Diretório de grupos";
  if (thread.directorySource === "contacts") return "Contatos da instância";
  if (thread.directorySource === "channels") return "Canais da instância";
  return thread.id > 0 ? "Mensagens registradas" : "Diretório da instância";
};

const getLastDirectionLabel = (direction: ThreadSummary["lastMessageDirection"]) => {
  if (direction === "outbound") return "Enviada pelo bot";
  if (direction === "inbound") return "Recebida";
  return "Sem mensagem";
};

const getGroupModeLabel = (thread: ThreadSummary | null) => {
  if (resolveThreadChatType(thread) !== "group") return "Não se aplica";
  if (thread?.announceOnly === true) return "Fechado, somente admins";
  if (thread?.announceOnly === false) return "Aberto";
  return "Não informado";
};

const getAdminLabel = (thread: ThreadSummary | null) => {
  if (resolveThreadChatType(thread) !== "group") return "Não se aplica";
  if (thread?.instanceIsAdmin === true) return "Sim";
  if (thread?.instanceIsAdmin === false) return "Não";
  return "Não informado";
};

const getGroupStatusLabel = (group: BotGroupSummary | null) => {
  if (!group) return "Não vinculado";
  return group.status === "active" ? "Robô ligado" : "Robô desligado";
};

type GroupPlanState = {
  state: "active" | "expired" | "inactive";
  title: string;
  subtitle: string;
  cta: string;
};

const AUTO_PROFILE_GROUP_LICENSE_SOURCES = new Set(["profile_plan", "base_plan"]);

const isAutoProfileGroupLicenseSource = (value: string | null | undefined) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return AUTO_PROFILE_GROUP_LICENSE_SOURCES.has(normalized);
};

const getIndividualGroupLicenseExpiresAt = (group: BotGroupSummary | null | undefined): string | null => {
  if (!group || isAutoProfileGroupLicenseSource(group.metadata?.licenseSource)) {
    return null;
  }
  return group.metadata?.licenseExpiresAt ?? null;
};

const isIndividualGroupLicenseActive = (group: BotGroupSummary | null | undefined): boolean => {
  const expiresAt = getIndividualGroupLicenseExpiresAt(group);
  const expiresAtTs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return Number.isFinite(expiresAtTs) && expiresAtTs > Date.now();
};

const isProfileLicenseActive = (expiresAt: string | null | undefined): boolean => {
  const expiresAtTs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return Number.isFinite(expiresAtTs) && expiresAtTs > Date.now();
};

const hasPausedResumeAccess = (group: BotGroupSummary | null | undefined): boolean => {
  if (group?.metadata?.botPausedPreserveAccess === true) {
    return true;
  }
  return Boolean(
    group?.metadata?.lastDeactivatedAt &&
      !getIndividualGroupLicenseExpiresAt(group) &&
      !group.metadata.licenseRemovedAt &&
      !group.metadata.licenseTransferredToGroupId,
  );
};

const hasIndividualGroupLicenseRecord = (group: BotGroupSummary | null | undefined): boolean =>
  Boolean(getIndividualGroupLicenseExpiresAt(group));

const getGroupValidityBadge = (
  group: BotGroupSummary | null | undefined,
  profilePlanExpiresAt?: string | null,
  options: { linkedToOtherUser?: boolean } = {},
) => {
  if (!group) {
    if (options.linkedToOtherUser) {
      return { label: "Grupo já vinculado a outro usuário", variant: "blocked" as const };
    }
    return { label: "Sem assinatura", variant: "missing" as const };
  }

  const expiresAt = getIndividualGroupLicenseExpiresAt(group);
  const expiresAtTs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  if (expiresAt && Number.isFinite(expiresAtTs)) {
    return expiresAtTs > Date.now()
      ? { label: `Vence ${formatShortDateTime(expiresAt)}`, variant: "active" as const }
      : { label: `Venceu ${formatShortDateTime(expiresAt)}`, variant: "expired" as const };
  }

  if (group.status !== "active" && hasPausedResumeAccess(group)) {
    return { label: "Robô pausado", variant: "paused" as const };
  }

  const profileExpiresAtTs = profilePlanExpiresAt ? new Date(profilePlanExpiresAt).getTime() : Number.NaN;
  if (profilePlanExpiresAt && Number.isFinite(profileExpiresAtTs)) {
    return profileExpiresAtTs > Date.now()
      ? { label: `Perfil até ${formatShortDateTime(profilePlanExpiresAt)}`, variant: "active" as const }
      : { label: `Perfil venceu ${formatShortDateTime(profilePlanExpiresAt)}`, variant: "expired" as const };
  }

  return { label: "Sem assinatura", variant: "missing" as const };
};

const getGroupQuickActionLabel = (
  group: BotGroupSummary | null | undefined,
  linkedToOtherUser = false,
  profilePlanExpiresAt?: string | null,
) => {
  if (linkedToOtherUser) return "Bloqueado";
  if (!group) return "Vincular";
  if (group.status !== "active" && hasPausedResumeAccess(group)) return "Ativar";
  if (hasIndividualGroupLicenseRecord(group) || isProfileLicenseActive(profilePlanExpiresAt)) return "Renovar perfil";
  return "Assinar perfil";
};

const getGroupPlanState = (
  group: BotGroupSummary | null | undefined,
  profilePlanExpiresAt?: string | null,
): GroupPlanState => {
  if (!group) {
    return {
      state: "inactive",
      title: "Grupo não vinculado",
      subtitle: "Vincule o grupo para ativar o robô.",
      cta: "Vincular",
    };
  }

  const expiresAt = getIndividualGroupLicenseExpiresAt(group);
  const expiresAtTs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  const profileExpiresAtTs = profilePlanExpiresAt ? new Date(profilePlanExpiresAt).getTime() : Number.NaN;
  const hasActiveProfileLicense = Number.isFinite(profileExpiresAtTs) && profileExpiresAtTs > Date.now();
  const hasActiveLicense =
    (Number.isFinite(expiresAtTs) && expiresAtTs > Date.now()) ||
    hasActiveProfileLicense ||
    hasPausedResumeAccess(group);

  if (hasActiveLicense) {
	    return {
	      state: "active" as const,
	      title: group.status !== "active" && hasPausedResumeAccess(group)
	        ? "Robô pausado, acesso preservado"
	        : hasActiveProfileLicense && profilePlanExpiresAt
	        ? `Perfil liberado até ${formatLongDateTime(profilePlanExpiresAt)}`
	        : expiresAt
	        ? `Grupo com validade legada até ${formatLongDateTime(expiresAt)}`
	        : "Robô ativo neste grupo",
	      subtitle: group.status !== "active" && hasPausedResumeAccess(group)
	        ? "Toque em Ativar robô para retomar este grupo sem gerar novo pagamento."
	        : hasActiveProfileLicense
	        ? "Todos os grupos deste perfil estão liberados pelo plano ilimitado."
	        : expiresAt
	        ? "A validade atual continua aceita, mas a próxima renovação será pelo perfil inteiro."
	        : "Este grupo está liberado para comandos, automações e atendimento.",
	      cta: group.status !== "active" && hasPausedResumeAccess(group) ? "Ativar robô" : "Renovar perfil",
	    };
	  }

	  if (expiresAt && Number.isFinite(expiresAtTs)) {
	    return {
	      state: "expired",
	      title: `Plano vencido em ${formatLongDateTime(expiresAt)}`,
	      subtitle: "Renove o perfil inteiro para religar comandos, automações e atendimento.",
	      cta: "Renovar perfil",
	    };
	  }

	  return {
	    state: "inactive",
	    title: "Assinatura do perfil necessária",
	    subtitle: "Uma assinatura do perfil libera este grupo e todos os outros grupos da instância.",
	    cta: "Assinar perfil",
	  };
	};

const copyTextToClipboard = async (value: string) => {
  if (!value) return;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  }
};

const getServiceWindowInfo = (messages: ConversationMessage[]) => {
  const lastInbound = [...messages].reverse().find((message) => message.direction === "inbound");
  if (!lastInbound) {
    return { label: "Sem entrada do usuário", tone: "neutral" as const };
  }
  const elapsedMs = Date.now() - new Date(lastInbound.timestamp).getTime();
  if (!Number.isFinite(elapsedMs)) {
    return { label: "Não informado", tone: "neutral" as const };
  }
  if (elapsedMs <= 24 * 60 * 60 * 1000) {
    return { label: "Aberta", tone: "ok" as const };
  }
  return { label: "Fechada, usar template", tone: "warn" as const };
};

const buildFlowCommandText = (flow: BotFlowSummary) => {
  const command = flow.command.trim();
  if (!command) return flow.name;
  if (command.startsWith("/") || command.startsWith("!")) return command;
  return `/${command}`;
};

const renderChatTypeIcon = (thread: ThreadSummary | null, size = 18) => {
  const type = resolveThreadChatType(thread);
  if (type === "group") return <IconUsersGroup size={size} />;
  if (type === "channel" || type === "broadcast") return <IconBell size={size} />;
  if (type === "contact") return <IconUser size={size} />;
  return <IconMessageCircle size={size} />;
};

const matchesThreadFilter = (thread: ThreadSummary, filter: ThreadFilter) => {
  const type = resolveThreadChatType(thread);
  if (filter === "groups") return type === "group";
  if (filter === "archived") return Boolean(thread.archived);
  if (thread.archived) return false;
  if (filter === "unread") return thread.unreadCount > 0;
  if (filter === "favorites") return false;
  return true;
};

const mediaString = (media: Record<string, unknown> | null | undefined, ...keys: string[]) => {
  if (!media) return null;
  for (const key of keys) {
    const value = media[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const mediaNumber = (media: Record<string, unknown> | null | undefined, ...keys: string[]) => {
  if (!media) return null;
  for (const key of keys) {
    const value = media[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};

const mediaRecordArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    : [];

const mediaRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const mediaStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => {
          if (typeof entry === "string") return entry.trim();
          const record = mediaRecord(entry);
          return mediaString(record, "jid", "Jid", "id", "Id", "phone", "Phone", "number", "Number") ?? "";
        })
        .filter(Boolean)
    : [];

const firstMediaCopyCode = (value: unknown): string | null => {
  if (!value || typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstMediaCopyCode(item);
      if (nested) return nested;
    }
    return null;
  }
  const record = mediaRecord(value);
  if (!record) return null;
  const direct = mediaString(record, "copyCode", "copy_code", "clipboardText", "clipboard_text", "copyText", "copy_text");
  if (direct) return direct;
  const pix = mediaRecord(record.pix_static_code) ?? mediaRecord(record.pixStaticCode);
  const pixCode = mediaString(pix, "key", "copyCode", "copy_code", "payload", "code");
  if (pixCode) return pixCode;
  for (const nested of Object.values(record)) {
    const result = firstMediaCopyCode(nested);
    if (result) return result;
  }
  return null;
};

const parseVcardPhoneNumber = (vcard: string | null | undefined) => {
  if (!vcard) return null;
  const telLine = vcard
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^tel(?:[;:])/i.test(line));
  if (!telLine) return null;
  const raw = telLine.includes(":") ? telLine.slice(telLine.indexOf(":") + 1) : telLine;
  return raw.replace(/[^\d+]+/g, "") || null;
};

const getMessageMediaType = (message: ConversationMessage) =>
  String(message.media?.mediaType || message.media?.kind || message.messageType || "media").toLowerCase();

const describeMedia = (message: ConversationMessage) => {
  const type = getMessageMediaType(message);
  if (type.includes("image")) return "Imagem";
  if (type.includes("video")) return "Video";
  if (type.includes("audio") || type.includes("ptt")) return "Audio";
  if (type.includes("document")) return "Documento";
  if (type.includes("sticker")) return "Sticker";
  if (type.includes("list")) return "Lista";
  if (type.includes("button") || type.includes("interactive") || type.includes("template")) return "Botões";
  if (type.includes("contact") || type.includes("vcard")) return "Contato";
  if (type.includes("location")) return "Localização";
  if (type.includes("poll")) return "Enquete";
  if (type.includes("reaction")) return "Reação";
  if (type.includes("undecryptable") || type.includes("unavailable")) return "Mensagem indisponível";
  return "Midia";
};

const getMessageMediaUrl = (
  message: ConversationMessage,
  instanceId: number | null,
): string | null => {
  const media = message.media;
  if (!media) return null;
  const mediaType = getMessageMediaType(message);
  const dataUrl = mediaString(media, "dataUrl");
  const url = mediaString(media, "url", "mediaUrl", "MediaUrl");
  const thumbnailUrl = mediaString(media, "thumbnailUrl");
  const isRenderableMedia =
    mediaType.includes("image") ||
    mediaType.includes("sticker") ||
    mediaType.includes("video") ||
    mediaType.includes("audio") ||
    mediaType.includes("ptt") ||
    mediaType.includes("document");
  const needsProxy = Boolean(
    mediaString(media, "directPath", "DirectPath", "mediaKey", "MediaKey", "fileEncSHA256", "FileEncSHA256") ||
      (url && /mmg\.whatsapp\.net/i.test(url)) ||
      (isRenderableMedia && (message.messageId || message.id > 0)),
  );
  if (dataUrl && /^(blob:|data:)/i.test(dataUrl)) return dataUrl;
  if (dataUrl && !needsProxy) return dataUrl;
  if (needsProxy && instanceId && message.chatJid && (message.messageId || message.id)) {
    return apiPath(
      `/api/bot-instances/${instanceId}/whatsapp-conversations/${encodeURIComponent(message.chatJid)}/messages/${encodeURIComponent(message.messageId ?? String(message.id))}/media`,
    );
  }
  if (url) return url;
  if (dataUrl) return dataUrl;
  if (thumbnailUrl && (mediaType.includes("image") || mediaType.includes("sticker"))) return thumbnailUrl;
  return null;
};

const getMessageFileName = (message: ConversationMessage) =>
  mediaString(message.media, "filename", "fileName", "FileName", "name") || describeMedia(message);

const getMessageBodyText = (message: ConversationMessage) =>
  message.text?.trim() || mediaString(message.media, "caption", "body", "Body", "text", "Text", "title", "Title") || "";

const getReactionEmoji = (message: ConversationMessage) =>
  mediaString(message.media, "emoji", "Emoji", "reaction", "Reaction", "text", "Text", "caption")
    || message.text?.trim()
    || "";

const getReactionTargetMessageId = (message: ConversationMessage) =>
  mediaString(
    message.media,
    "targetMessageId",
    "target_message_id",
    "TargetMessageId",
    "messageId",
    "quotedMessageId",
    "quotedStanzaId",
    "stanzaId",
    "id",
  );

const isReactionConversationMessage = (message: ConversationMessage) => {
  const type = getMessageMediaType(message);
  return (
    type.includes("reaction") ||
    Boolean(getReactionTargetMessageId(message) && getReactionEmoji(message))
  );
};

const getMessageReactionTargetKey = (message: ConversationMessage) =>
  message.messageId?.trim() || (message.id > 0 ? String(message.id) : "");

const getReactionActorKey = (reaction: MessageReaction) => {
  const digits = normalizeIdentityDigits(reaction.senderJid);
  return digits || reaction.senderJid || reaction.messageId || String(reaction.id);
};

const getReactionActorLabel = (reaction: MessageReaction) => {
  const name = reaction.senderName?.trim();
  if (name && !isRawWhatsappIdentifier(name)) return name;
  const phone = formatPhone(getPhoneFromChatJid(reaction.senderJid));
  return phone || reaction.senderJid || "Participante";
};

const getReactionActorSubtitle = (reaction: MessageReaction) => {
  const phone = formatPhone(getPhoneFromChatJid(reaction.senderJid));
  const time = formatLongDateTime(reaction.timestamp);
  return [phone || reaction.senderJid, time].filter(Boolean).join(" · ");
};

const buildMessageReactionGroups = (messages: ConversationMessage[]) => {
  const targetKeys = new Set(
    messages
      .filter((message) => !isReactionConversationMessage(message))
      .map(getMessageReactionTargetKey)
      .filter(Boolean),
  );
  const latestByActor = new Map<string, MessageReaction>();

  for (const message of messages) {
    if (!isReactionConversationMessage(message)) continue;
    const targetMessageId = getReactionTargetMessageId(message);
    const emoji = getReactionEmoji(message);
    if (!targetMessageId || !targetKeys.has(targetMessageId)) continue;

    const reaction: MessageReaction = {
      id: message.id,
      messageId: message.messageId,
      targetMessageId,
      emoji,
      senderJid: message.senderJid,
      senderName: message.senderName,
      senderAvatarUrl: message.senderAvatarUrl,
      timestamp: message.timestamp,
    };
    const key = `${targetMessageId}:${getReactionActorKey(reaction)}`;
    const existing = latestByActor.get(key);
    if (!emoji) {
      if (!existing || getMessageTimestampMs(message) >= Date.parse(existing.timestamp || "")) {
        latestByActor.delete(key);
      }
      continue;
    }
    if (!existing || getMessageTimestampMs(message) >= Date.parse(existing.timestamp || "")) {
      latestByActor.set(key, reaction);
    }
  }

  const byTarget = new Map<string, MessageReaction[]>();
  for (const reaction of latestByActor.values()) {
    const list = byTarget.get(reaction.targetMessageId) ?? [];
    list.push(reaction);
    byTarget.set(reaction.targetMessageId, list);
  }

  const grouped = new Map<string, MessageReactionGroup[]>();
  for (const [targetMessageId, reactions] of byTarget) {
    const byEmoji = new Map<string, MessageReaction[]>();
    for (const reaction of reactions.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))) {
      const list = byEmoji.get(reaction.emoji) ?? [];
      list.push(reaction);
      byEmoji.set(reaction.emoji, list);
    }
    grouped.set(
      targetMessageId,
      Array.from(byEmoji.entries()).map(([emoji, list]) => ({
        emoji,
        count: list.length,
        reactions: list,
      })),
    );
  }

  return grouped;
};

const getContactInfo = (media: Record<string, unknown> | null | undefined) => {
  const firstContact = mediaRecordArray(media?.contacts)[0] ?? mediaRecordArray(media?.Contacts)[0] ?? null;
  const vcard = mediaString(firstContact, "vcard", "Vcard", "vCard", "VCARD") ?? mediaString(media, "vcard", "Vcard", "vCard", "VCARD");
  const phone = mediaString(firstContact, "phoneNumber", "PhoneNumber", "phone", "Phone", "waId", "jid")
    ?? mediaString(media, "phoneNumber", "PhoneNumber", "phone", "Phone", "waId", "jid")
    ?? parseVcardPhoneNumber(vcard);
  const title = mediaString(firstContact, "displayName", "DisplayName", "name", "Name", "fullName")
    ?? mediaString(media, "displayName", "DisplayName", "name", "Name", "fullName", "title", "Title")
    ?? phone
    ?? "Contato";
  return { title, phone, vcard };
};

const getPollVoterName = (names: Record<string, unknown> | null, jid: string) =>
  mediaString(names, jid) ?? jid.split("@")[0] ?? jid;

const getPollOptions = (media: Record<string, unknown> | null | undefined): PollOptionSummary[] => {
  const voterNames =
    mediaRecord(media?.pollVoterNames) ??
    mediaRecord(media?.PollVoterNames) ??
    mediaRecord(media?.voterNames) ??
    mediaRecord(media?.VoterNames);
  const sourceOptions =
    mediaRecordArray(media?.options).length > 0 ? mediaRecordArray(media?.options)
      : mediaRecordArray(media?.Options).length > 0 ? mediaRecordArray(media?.Options)
        : mediaRecordArray(media?.pollOptions).length > 0 ? mediaRecordArray(media?.pollOptions)
          : mediaRecordArray(media?.PollOptions);
  return sourceOptions
    .slice(0, 12)
    .map((option, index) => {
      const title = mediaString(option, "title", "Title", "name", "Name", "optionName", "OptionName", "text", "Text") ?? `Opção ${index + 1}`;
      const voters = [
        ...mediaStringArray(option.voters),
        ...mediaStringArray(option.Voters),
        ...mediaStringArray(option.selectedVoters),
        ...mediaStringArray(option.SelectedVoters),
      ]
        .filter((jid, voterIndex, list) => jid && list.indexOf(jid) === voterIndex)
        .map((jid) => ({ jid, name: getPollVoterName(voterNames, jid) }));
      const votes = mediaNumber(option, "voteCount", "VoteCount", "votes", "Votes", "count", "Count") ?? voters.length;
      return { title, votes, voters };
    });
};

const getMessageCopyText = (message: ConversationMessage) => {
  const type = getMessageMediaType(message);
  if (message.media) {
    const copyCode = firstMediaCopyCode(message.media);
    if (copyCode) return copyCode;
    if (type.includes("contact") || type.includes("vcard")) {
      const contact = getContactInfo(message.media);
      return contact.vcard || [contact.title, contact.phone].filter(Boolean).join("\n");
    }
    if (type.includes("location")) {
      const latitude = mediaNumber(message.media, "latitude", "degreesLatitude");
      const longitude = mediaNumber(message.media, "longitude", "degreesLongitude");
      if (latitude !== null && longitude !== null) {
        return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
      }
    }
  }
  return getMessageBodyText(message) || describeMedia(message);
};

type InteractiveButtonModel = {
  id: string;
  title: string;
  description: string;
  type: string;
  copyCode: string;
  url: string;
};

type InteractiveListRowModel = {
  id: string;
  title: string;
  description: string;
};

type InteractiveListSectionModel = {
  title: string;
  rows: InteractiveListRowModel[];
};

type InteractiveListSheetModel = {
  title: string;
  body: string;
  buttonText: string;
  sections: InteractiveListSectionModel[];
};

const getInteractiveButtons = (media: Record<string, unknown> | null | undefined) =>
  [...mediaRecordArray(media?.buttons), ...mediaRecordArray(media?.Buttons)]
    .slice(0, 6)
    .map((button) => ({
      id: mediaString(button, "id", "buttonId", "ButtonId", "selectedId") ?? "",
      title: mediaString(button, "title", "text", "displayText", "DisplayText", "buttonText", "ButtonText", "name")
        ?? (firstMediaCopyCode(button) ? "Copiar chave Pix" : "Botão"),
      description: mediaString(button, "description", "subtitle") ?? "",
      type: mediaString(button, "type", "Type", "name", "Name") ?? "",
      copyCode: mediaString(button, "copyCode", "copy_code", "clipboardText", "clipboard_text") ?? firstMediaCopyCode(button) ?? "",
      url: mediaString(button, "url", "URL", "href", "link") ?? "",
    }));

const getInteractiveListButtonText = (media: Record<string, unknown> | null | undefined) => {
  const listMessage = mediaRecord(media?.listMessage);
  const firstList = mediaRecordArray(media?.lists)[0];
  return mediaString(media, "buttonText", "ButtonText") ?? mediaString(listMessage, "buttonText", "ButtonText") ?? mediaString(firstList, "buttonText", "ButtonText") ?? "Ver opções";
};

const getInteractiveSections = (media: Record<string, unknown> | null | undefined): InteractiveListSectionModel[] => {
  const listMessage = mediaRecord(media?.listMessage);
  const rawSections = [
    ...mediaRecordArray(media?.sections),
    ...mediaRecordArray(media?.Sections),
    ...mediaRecordArray(listMessage?.sections),
    ...mediaRecordArray(listMessage?.Sections),
    ...mediaRecordArray(media?.lists).flatMap((list) => [
      ...mediaRecordArray(list.sections),
      ...mediaRecordArray(list.Sections),
    ]),
  ];
  const seen = new Set<string>();
  const sections: InteractiveListSectionModel[] = [];

  for (const section of rawSections) {
    const rows = [...mediaRecordArray(section.rows), ...mediaRecordArray(section.Rows)]
      .slice(0, 12)
      .map((row) => ({
        id: mediaString(row, "id", "rowId", "RowId") ?? "",
        title: mediaString(row, "title", "name", "header", "Header") ?? "Item",
        description: mediaString(row, "description", "Description") ?? "",
      }))
      .filter((row) => row.title || row.description || row.id);
    if (rows.length === 0) continue;

    const title = mediaString(section, "title", "name", "Title") ?? "Opções";
    const key = `${title}:${rows.map((row) => `${row.id}:${row.title}:${row.description}`).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push({ title, rows });
    if (sections.length >= 6) break;
  }

  return sections;
};

const getInteractiveCards = (media: Record<string, unknown> | null | undefined) =>
  mediaRecordArray(media?.cards).slice(0, 8).map((card) => ({
    title: mediaString(card, "title", "Title") ?? "",
    body: mediaString(card, "body", "description", "text", "caption") ?? "",
    footer: mediaString(card, "footer", "footerText", "FooterText") ?? "",
    buttonText: getInteractiveListButtonText(card),
    media: mediaRecord(card.media),
    buttons: getInteractiveButtons(card),
    sections: getInteractiveSections(card),
  }));

const MessageInteractiveCard = ({ message }: { message: ConversationMessage }) => {
  const media = message.media;
  const [listSheet, setListSheet] = useState<InteractiveListSheetModel | null>(null);
  const title = mediaString(media, "title", "Title");
  const body = mediaString(media, "body", "Body", "caption", "description", "text", "Text") || message.text || "";
  const footer = mediaString(media, "footer", "Footer", "footerText", "FooterText");
  const selectedId = mediaString(media, "selectedId", "selectedRowId", "selectedButtonId");
  const buttons = getInteractiveButtons(media);
  const sections = getInteractiveSections(media);
  const cards = getInteractiveCards(media);
  const listButtonText = getInteractiveListButtonText(media);
  const hasCards = cards.length > 0;
  const openListSheet = (sheet: InteractiveListSheetModel) => setListSheet(sheet);

  return (
    <div className={`${styles.interactiveMessageCard} ${hasCards ? styles.interactiveMessageCardHasCards : ""}`}>
      {!hasCards && (title || body) ? (
        <div className={styles.interactiveContent}>
          {title ? <strong>{title}</strong> : null}
          {body ? <p>{body}</p> : null}
        </div>
      ) : null}
      {!hasCards && selectedId ? <small>Selecionado: {selectedId}</small> : null}
      {hasCards ? (
        <div className={styles.interactiveCards}>
          {cards.map((card, cardIndex) => {
            const cardImage = mediaString(card.media, "media", "url", "dataUrl", "thumbnailUrl");
            return (
              <div className={styles.interactiveCardItem} key={`${card.title}-${cardIndex}`}>
                {cardImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cardImage} alt={card.title || "Card"} />
                ) : null}
                <div className={styles.interactiveContent}>
                  {card.title ? <strong>{card.title}</strong> : null}
                  {card.body ? <p>{card.body}</p> : null}
                </div>
                {card.sections.length > 0 ? (
                  <InteractiveListTrigger
                    buttonText={card.buttonText || "Ver opções"}
                    onOpen={() =>
                      openListSheet({
                        title: card.title || title || "Ver opções",
                        body: card.body,
                        buttonText: card.buttonText || "Ver opções",
                        sections: card.sections,
                      })
                    }
                  />
                ) : null}
                {card.buttons.length > 0 ? (
                  <InteractiveButtonRows buttons={card.buttons} />
                ) : null}
                {card.footer ? <em className={styles.interactiveFooter}>{card.footer}</em> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {!hasCards && buttons.length > 0 ? <InteractiveButtonRows buttons={buttons} /> : null}
      {!hasCards && sections.length > 0 ? (
        <InteractiveListTrigger
          buttonText={listButtonText}
          onOpen={() =>
            openListSheet({
              title: title || listButtonText,
              body,
              buttonText: listButtonText,
              sections,
            })
          }
        />
      ) : null}
      {!hasCards && footer ? <em className={styles.interactiveFooter}>{footer}</em> : null}
      {listSheet ? <InteractiveListSheet sheet={listSheet} onClose={() => setListSheet(null)} /> : null}
    </div>
  );
};

const InteractiveButtonRows = ({
  buttons,
}: {
  buttons: InteractiveButtonModel[];
}) => {
  const handleButtonClick = (button: InteractiveButtonModel) => {
    if (button.copyCode) {
      void navigator.clipboard?.writeText(button.copyCode);
      return;
    }
    if (button.url) {
      window.open(button.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      className={styles.interactiveButtons}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {buttons.map((button, index) => (
        <button type="button" key={`${button.id}-${index}`} onClick={() => handleButtonClick(button)}>
          {button.copyCode ? <IconCopy size={16} /> : button.url ? <IconExternalLink size={16} /> : null}
          <span>{button.title}</span>
          {button.description ? <small>{button.description}</small> : null}
        </button>
      ))}
    </div>
  );
};

const InteractiveListTrigger = ({
  buttonText,
  onOpen,
}: {
  buttonText: string;
  onOpen: () => void;
}) => (
  <button
    type="button"
    className={styles.interactiveListTrigger}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onOpen();
    }}
  >
    <IconList size={15} />
    <span>{buttonText || "Ver opções"}</span>
  </button>
);

const InteractiveListSheet = ({
  sheet,
  onClose,
}: {
  sheet: InteractiveListSheetModel;
  onClose: () => void;
}) => (
  <div
    className={styles.interactiveListOverlay}
    role="presentation"
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onClose();
    }}
  >
    <div
      className={styles.interactiveListSheet}
      role="dialog"
      aria-modal="true"
      aria-label={sheet.buttonText || "Opções da lista"}
      onClick={(event) => event.stopPropagation()}
    >
      <header className={styles.interactiveListHeader}>
        <button type="button" onClick={onClose} aria-label="Fechar opções">
          <IconX size={18} />
        </button>
        <div>
          <strong>{sheet.buttonText || "Ver opções"}</strong>
          {sheet.title ? <span>{sheet.title}</span> : null}
        </div>
      </header>
      <div className={styles.interactiveListBody}>
        {sheet.sections.length > 0 ? (
          <InteractiveListSections sections={sheet.sections} />
        ) : sheet.body ? (
          <p>{sheet.body}</p>
        ) : (
          <span className={styles.interactiveListEmpty}>Nenhuma opção disponível.</span>
        )}
      </div>
    </div>
  </div>
);

const InteractiveListSections = ({
  sections,
}: {
  sections: InteractiveListSectionModel[];
}) => (
  <div className={styles.interactiveSections}>
    {sections.map((section, sectionIndex) => (
      <div key={`${section.title}-${sectionIndex}`}>
        <strong>
          <IconList size={14} />
          <span>{section.title}</span>
        </strong>
        {section.rows.map((row, rowIndex) => (
          <span key={`${row.id}-${rowIndex}`}>
            <span>
              {row.title}
              {row.description ? <small>{row.description}</small> : null}
            </span>
            <i />
          </span>
        ))}
      </div>
    ))}
  </div>
);

const MessageContactCard = ({ media }: { media: Record<string, unknown> }) => {
  const contact = getContactInfo(media);
  const initials = contact.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";
  const phone = contact.phone?.replace(/[^\d+]+/g, "");
  const openChat = () => {
    if (!phone) return;
    window.open(`https://wa.me/${phone.replace(/^\+/, "")}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={styles.messageContactCard}>
      <div className={styles.messageContactHead}>
        <span className={styles.messageContactAvatar}>{initials}</span>
        <span>
          <strong>{contact.title}</strong>
          {contact.phone ? <small>{contact.phone}</small> : null}
        </span>
      </div>
      <button type="button" className={styles.messageContactAction} disabled={!phone} onClick={openChat}>
        Conversar
      </button>
    </div>
  );
};

const MessageLocationCard = ({ media }: { media: Record<string, unknown> }) => {
  const latitude = mediaNumber(media, "latitude", "degreesLatitude");
  const longitude = mediaNumber(media, "longitude", "degreesLongitude");
  const title = mediaString(media, "title", "name", "address") ?? "Localização";
  const address = mediaString(media, "address", "caption", "comment");
  const mapsUrl = latitude !== null && longitude !== null
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : null;
  const previewUrl = latitude !== null && longitude !== null
    ? `https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=15&size=420x210&markers=${latitude},${longitude},red-pushpin`
    : null;

  return (
    <a className={styles.messageLocationCard} href={mapsUrl ?? "#"} target={mapsUrl ? "_blank" : undefined} rel="noreferrer">
      <span className={styles.messageLocationMap} style={previewUrl ? { backgroundImage: `url("${previewUrl}")` } : undefined}>
        <IconMapPin size={34} />
      </span>
      <span className={styles.messageLocationMeta}>
        <strong>{title}</strong>
        <small>{address || (latitude !== null && longitude !== null ? `${latitude}, ${longitude}` : "Localização compartilhada")}</small>
      </span>
    </a>
  );
};

const MessagePollCard = ({ media }: { media: Record<string, unknown> }) => {
  const title = mediaString(media, "title", "name") ?? "Enquete";
  const options = getPollOptions(media);
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  const [votesOpen, setVotesOpen] = useState(false);

  return (
    <div className={styles.messagePollCard}>
      <strong>{title}</strong>
      <small>Selecione uma opção</small>
      <div className={styles.messagePollOptions}>
        {options.length > 0 ? options.map((option, index) => {
          const percent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
          return (
            <div className={styles.messagePollOption} key={`${option.title}-${index}`}>
              <span>
                <i />
                <b>{option.title}</b>
                <em>{option.votes}</em>
              </span>
              <span className={styles.messagePollTrack}>
                <span style={{ width: `${percent}%` }} />
              </span>
            </div>
          );
        }) : (
          <div className={styles.messagePollOption}>
            <span>
              <i />
              <b>Opção</b>
              <em>0</em>
            </span>
            <span className={styles.messagePollTrack}><span /></span>
          </div>
        )}
      </div>
      <button
        type="button"
        className={styles.messagePollVotesButton}
        disabled={totalVotes <= 0}
        onClick={() => setVotesOpen(true)}
      >
        Mostrar votos
      </button>
      {votesOpen ? (
        <div className={styles.profileOverlay} role="presentation" onClick={() => setVotesOpen(false)}>
          <section
            className={styles.pollVotesModal}
            role="dialog"
            aria-modal="true"
            aria-label="Votos da enquete"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.profileCloseButton}
              onClick={() => setVotesOpen(false)}
              aria-label="Fechar votos"
            >
              <IconX size={18} />
            </button>
            <header className={styles.pollVotesHeader}>
              <strong>Votos da enquete</strong>
              <span>{title}</span>
            </header>
            <div className={styles.pollVotesList}>
              {options.map((option, index) => (
                <section className={styles.pollVotesOption} key={`${option.title}-${index}`}>
                  <header>
                    <strong>{option.title}</strong>
                    <span>{option.votes}</span>
                  </header>
                  {option.voters.length > 0 ? (
                    option.voters.map((voter) => (
                      <div className={styles.pollVotesPerson} key={`${option.title}-${voter.jid}`}>
                        <span>{getInitials(voter.name || voter.jid)}</span>
                        <p>
                          <strong>{voter.name || voter.jid.split("@")[0]}</strong>
                          <small>{voter.jid.split("@")[0] || voter.jid}</small>
                        </p>
                      </div>
                    ))
                  ) : (
                    <small className={styles.pollVotesEmpty}>Nenhum voto nesta opção.</small>
                  )}
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};

const MessageMediaContent = ({
  message,
  instanceId,
}: {
  message: ConversationMessage;
  instanceId: number | null;
}) => {
  const media = message.media;
  const type = getMessageMediaType(message);
  const src = getMessageMediaUrl(message, instanceId);
  const mimeType = mediaString(media, "mimeType", "MimeType", "mimetype", "Mimetype") ?? "";
  const filename = getMessageFileName(message);
  const fileLength = mediaNumber(media, "fileLength", "FileLength", "size", "Size");
  const [retryToken, setRetryToken] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);

  useEffect(() => {
    setRetryToken(0);
    setMediaFailed(false);
  }, [message.id, message.messageId, src]);

  const retrySrc = useMemo(() => {
    if (!src) return null;
    if (/^(blob:|data:)/i.test(src)) return src;
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}mediaRetry=${retryToken}`;
  }, [retryToken, src]);

  const requestMediaLoad = () => {
    if (!src) return;
    setMediaFailed(false);
    setRetryToken((current) => current + 1);
  };

  const mediaLoadButton = (label = "Carregar mídia") => (
    <button
      type="button"
      className={styles.messageMediaLoadButton}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        requestMediaLoad();
      }}
      disabled={!src}
    >
      <IconDownload size={24} />
      <span>{src ? label : "Mídia aguardando link"}</span>
    </button>
  );

  if (!media) return null;

  if (type.includes("list") || type.includes("button") || type.includes("interactive") || type.includes("template")) {
    return <MessageInteractiveCard message={message} />;
  }

  if (type.includes("poll")) {
    return <MessagePollCard media={media} />;
  }

  if (type.includes("reaction")) {
    const emoji = mediaString(media, "emoji", "text", "reaction") || message.text || "reagiu";
    const target = mediaString(media, "targetMessageId", "messageId", "id");
    return (
      <span className={styles.mediaPill} title={target ? `Mensagem ${target}` : undefined}>
        <IconMessageCircle size={16} />
        {emoji} Reação
      </span>
    );
  }

  if (type.includes("undecryptable") || type.includes("unavailable")) {
    const detail = mediaString(media, "caption", "title") || "O WhatsApp não disponibilizou o conteúdo desta mensagem.";
    return (
      <span className={styles.mediaPill} title={detail}>
        <IconMessageCircle size={16} />
        Mensagem indisponível
      </span>
    );
  }

  if (type.includes("image") || type.includes("sticker")) {
    const previewClassName = `${styles.messageMediaPreview} ${type.includes("sticker") ? styles.messageStickerPreview : ""}`;
    if (!retrySrc || mediaFailed) {
      return (
        <div className={previewClassName}>
          {mediaLoadButton(type.includes("sticker") ? "Carregar figurinha" : "Carregar mídia")}
        </div>
      );
    }
    return (
      <a
        className={previewClassName}
        href={src}
        target="_blank"
        rel="noreferrer"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={retrySrc} alt={filename} loading="lazy" onError={() => setMediaFailed(true)} />
      </a>
    );
  }

  if (type.includes("video")) {
    return (
      <div className={styles.messageMediaPreview}>
        {retrySrc && !mediaFailed ? (
          <video key={retrySrc} src={retrySrc} controls preload="metadata" onError={() => setMediaFailed(true)} />
        ) : (
          mediaLoadButton("Carregar vídeo")
        )}
      </div>
    );
  }

  if (type.includes("audio") || type.includes("ptt")) {
    return (
      <div className={styles.messageAudioPreview}>
        <IconMessageCircle size={17} />
        {retrySrc && !mediaFailed ? (
          <audio key={retrySrc} src={retrySrc} controls preload="metadata" onError={() => setMediaFailed(true)} />
        ) : (
          mediaLoadButton("Carregar áudio")
        )}
      </div>
    );
  }

  if (type.includes("document")) {
    return (
      <a className={styles.messageDocumentPreview} href={src ?? "#"} target={src ? "_blank" : undefined} rel="noreferrer">
        <IconPaperclip size={19} />
        <span>
          <strong>{filename}</strong>
          <small>{[formatFileSize(fileLength ?? 0), mimeType || "Documento"].filter(Boolean).join(" · ")}</small>
        </span>
      </a>
    );
  }

  if (type.includes("contact") || type.includes("vcard")) {
    return <MessageContactCard media={media} />;
  }

  if (type.includes("location")) {
    return <MessageLocationCard media={media} />;
  }

  return (
    <span className={styles.mediaPill}>
      <IconMessageCircle size={16} />
      {describeMedia(message)}
    </span>
  );
};

const Avatar = ({ thread, instance }: { thread: ThreadSummary; instance?: InstanceSummary | null }) => {
  const title = getThreadTitle(thread, instance);
  const type = resolveThreadChatType(thread);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [thread.avatarUrl]);

  return (
    <span className={`${styles.avatar} ${type === "channel" ? styles.avatarChannel : ""}`}>
      {thread.avatarUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thread.avatarUrl} alt={title} onError={() => setImageFailed(true)} />
      ) : type === "group" || type === "channel" || type === "broadcast" ? (
        renderChatTypeIcon(thread, 22)
      ) : (
        getInitials(title)
      )}
    </span>
  );
};

const MessageBubble = ({
  message,
  instanceId,
  thread,
  instance,
  reactionGroups,
  onOpenActions,
  onOpenReactions,
  onOpenProfile,
  deletedContentVisible,
}: {
  message: ConversationMessage;
  instanceId: number | null;
  thread: ThreadSummary | null;
  instance: InstanceSummary | null;
  reactionGroups: MessageReactionGroup[];
  onOpenActions: (message: ConversationMessage) => void;
  onOpenReactions: (message: ConversationMessage, groups: MessageReactionGroup[]) => void;
  onOpenProfile: (profile: ChatProfile) => void;
  deletedContentVisible: boolean;
}) => {
  const outbound = message.direction === "outbound";
  const longPressTimerRef = useRef<number | null>(null);
  const mediaType = getMessageMediaType(message);
  const isInteractive = mediaType.includes("list") || mediaType.includes("button") || mediaType.includes("interactive") || mediaType.includes("template");
  const bodyText = isInteractive ? (message.text?.trim() || "") : getMessageBodyText(message);
  const hasText = Boolean(bodyText);
  const hasMedia = Boolean(message.media);
  const isDeleted = Boolean(message.deletedAt);
  const canRevealDeletedContent = isDeleted && message.revealDeletedContent === true;
  const shouldHideDeletedContent = isDeleted && !deletedContentVisible;
  const senderName = getSenderDisplayName(message, thread, instance);
  const senderPhone = getSenderPhone(message);
  const senderProfile = buildSenderProfile(message, thread, instance);
  const showSenderIdentity = !outbound;
  const shouldOpenParticipantActions = !outbound && thread?.chatType === "group";
  const reactionCount = reactionGroups.reduce((total, group) => total + group.count, 0);
  const reactionEmojis = reactionGroups.slice(0, 3).map((group) => group.emoji).join("");
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  return (
    <div className={`${styles.bubbleRow} ${outbound ? styles.bubbleRowOutbound : styles.bubbleRowInbound}`}>
      {showSenderIdentity ? (
        <button
          type="button"
          className={styles.messageAvatar}
          onClick={(event) => {
            event.stopPropagation();
            if (shouldOpenParticipantActions) {
              onOpenActions(message);
            } else {
              onOpenProfile(senderProfile);
            }
          }}
          aria-label={shouldOpenParticipantActions ? `Abrir ações de ${senderName}` : `Abrir perfil de ${senderName}`}
        >
          {senderProfile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={senderProfile.avatarUrl} alt={senderName} />
          ) : (
            getInitials(senderName)
          )}
        </button>
      ) : null}
      <div
        className={`${styles.bubble} ${outbound ? styles.bubbleOutbound : styles.bubbleInbound} ${reactionGroups.length > 0 ? styles.bubbleWithReactions : ""} ${message.localStatus === "pending" ? styles.bubblePending : ""} ${message.localStatus === "failed" ? styles.bubbleFailed : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenActions(message);
        }}
        onClick={() => {
          if (isDeleted) {
            onOpenActions(message);
          }
        }}
        onPointerDown={() => {
          clearLongPressTimer();
          longPressTimerRef.current = window.setTimeout(() => onOpenActions(message), 520);
        }}
        onPointerUp={clearLongPressTimer}
        onPointerLeave={clearLongPressTimer}
        onPointerCancel={clearLongPressTimer}
      >
        <button
          type="button"
          className={styles.bubbleMenu}
          aria-label="Opções da mensagem"
          onClick={(event) => {
            event.stopPropagation();
            onOpenActions(message);
          }}
        >
          <IconChevronDown size={15} />
        </button>
        {showSenderIdentity ? (
          <button
            type="button"
            className={styles.senderName}
            onClick={(event) => {
              event.stopPropagation();
              if (shouldOpenParticipantActions) {
                onOpenActions(message);
              } else {
                onOpenProfile(senderProfile);
              }
            }}
          >
            <span>{senderName}</span>
            {senderPhone ? <small>{senderPhone}</small> : null}
          </button>
        ) : null}
        {isDeleted ? (
          <div
            className={`${styles.deletedMessageNotice} ${canRevealDeletedContent ? styles.deletedMessageRevealable : ""}`}
          >
            <IconTrash size={18} />
            <span>
              {message.deletedPlaceholder || "Mensagem apagada"}
              {message.deletedByName ? <small>por {message.deletedByName}</small> : null}
            </span>
          </div>
        ) : null}
        {!shouldHideDeletedContent && hasMedia ? <MessageMediaContent message={message} instanceId={instanceId} /> : null}
        {!shouldHideDeletedContent && hasText ? (
          <div className={styles.messageText}>{bodyText}</div>
        ) : !shouldHideDeletedContent && !hasMedia ? (
          <span className={styles.mediaPill}>
            <IconMessageCircle size={16} />
            {describeMedia(message)}
          </span>
        ) : null}
        <span
          className={`${styles.messageMeta} ${outbound ? styles.messageMetaOutbound : ""} ${message.localStatus === "failed" ? styles.messageMetaFailed : ""}`}
          title={[
            formatLongDateTime(message.timestamp),
            message.localStatus === "pending" ? "Enviando..." : null,
            message.localStatus === "failed" ? "Falha no envio" : null,
            message.messageId ? `ID ${message.messageId}` : null,
            message.senderJid ? `Origem ${message.senderJid}` : null,
          ].filter(Boolean).join(" • ")}
        >
          <span className={styles.messageTime}>{formatTime(message.timestamp)}</span>
          {outbound ? (
            <span
              className={`${styles.messageStatus} ${
                message.localStatus === "pending"
                  ? styles.messageStatusPending
                  : message.localStatus === "failed"
                    ? styles.messageStatusFailed
                    : message.deliveryState === "delivered" || message.deliveryState === "read"
                      ? styles.messageStatusDelivered
                      : styles.messageStatusSent
              }`}
              aria-label={
                message.localStatus === "pending"
                  ? "Enviando"
                  : message.localStatus === "failed"
                    ? "Falha no envio"
                  : message.deliveryState === "read"
                    ? "Visualizada"
                    : message.deliveryState === "delivered"
                      ? "Entregue"
                      : "Enviada"
              }
            >
              {message.localStatus === "pending" ? (
                <IconClock size={14} stroke={2} />
              ) : message.localStatus === "failed" ? (
                <IconAlertCircle size={14} stroke={2} />
              ) : message.deliveryState === "delivered" || message.deliveryState === "read" ? (
                <IconChecks size={15} stroke={2} />
              ) : message.localStatus === "sent" || !message.messageId?.startsWith("local-") ? (
                <IconCheck size={14} stroke={2} />
              ) : (
                <IconCheck size={14} stroke={2} />
              )}
            </span>
          ) : null}
        </span>
        {reactionGroups.length > 0 ? (
          <button
            type="button"
            className={`${styles.messageReactionBadge} ${outbound ? styles.messageReactionBadgeOutbound : styles.messageReactionBadgeInbound}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpenReactions(message, reactionGroups);
            }}
            aria-label={`Ver ${reactionCount} reação${reactionCount === 1 ? "" : "es"}`}
            title={`Ver ${reactionCount} reação${reactionCount === 1 ? "" : "es"}`}
          >
            <span>{reactionEmojis}</span>
            {reactionCount > 1 ? <strong>{reactionCount}</strong> : null}
          </button>
        ) : null}
      </div>
    </div>
  );
};

const WhatsAppConversationsClient = ({
  embedded = false,
  brandName = "Bot Admin",
  brandLogo,
  preferredInstanceId = null,
  activeGroupChatJids = [],
  onPreferredInstanceChange,
  onToggleGroupActive,
  onMobileChatOpenChange,
}: WhatsAppConversationsClientProps) => {
  const router = useRouter();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [flows, setFlows] = useState<BotFlowSummary[]>([]);
  const [groupRecords, setGroupRecords] = useState<BotGroupSummary[]>([]);
  const [externalLinkedGroupJids, setExternalLinkedGroupJids] = useState<Set<string>>(() => new Set());
  const [selectedGroupRecord, setSelectedGroupRecord] = useState<BotGroupSummary | null>(null);
  const [selectedGroupSettings, setSelectedGroupSettings] = useState<GroupSettingsSummary | null>(null);
  const [selectedChatJid, setSelectedChatJid] = useState<string | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messageHistoryHasMore, setMessageHistoryHasMore] = useState(false);
  const [messageHistoryOldestCursor, setMessageHistoryOldestCursor] = useState<string | null>(null);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const selectedChatJidRef = useRef<string | null>(null);
  const messagesAutoScrollRef = useRef(true);
  const lastRealtimeSequenceRef = useRef(0);
  const realtimeClientIdRef = useRef(`web-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [query, setQuery] = useState("");
  const [threadFilter, setThreadFilter] = useState<ThreadFilter>("all");
  const [composer, setComposer] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [replyTarget, setReplyTarget] = useState<ConversationMessage | null>(null);
  const [messageActionTarget, setMessageActionTarget] = useState<ConversationMessage | null>(null);
  const [messageActionError, setMessageActionError] = useState<string | null>(null);
  const [messageActionSaving, setMessageActionSaving] = useState<string | null>(null);
  const [reactionModal, setReactionModal] = useState<MessageReactionModalState | null>(null);
  const [callsByChat, setCallsByChat] = useState<Record<string, ConversationCallState>>({});
  const [callActionBusy, setCallActionBusy] = useState<string | null>(null);
  const [callAudioStatus, setCallAudioStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [callAudioError, setCallAudioError] = useState<string | null>(null);
  const callAudioBridgeRef = useRef<CallAudioBridgeHandle | null>(null);
  const callAudioBridgeStartingRef = useRef<string | null>(null);
  const callAudioDisconnectTimerRef = useRef<number | null>(null);
  const callAudioPlaybackCursorRef = useRef(0);
  const callAudioSentFramesRef = useRef(0);
  const callAudioReceivedFramesRef = useRef(0);
  const callAudioLastPeakRef = useRef(0);
  const [revealedDeletedMessageIds, setRevealedDeletedMessageIds] = useState<Set<string>>(() => new Set());
  const [participantActionTarget, setParticipantActionTarget] = useState<ParticipantActionTarget | null>(null);
  const [participantActionError, setParticipantActionError] = useState<string | null>(null);
  const [participantActionSaving, setParticipantActionSaving] = useState<string | null>(null);
  const [banConfirmTarget, setBanConfirmTarget] = useState<ParticipantActionTarget | null>(null);
  const [banDeleteRecentMessages, setBanDeleteRecentMessages] = useState(false);
  const [banAddToBlacklist, setBanAddToBlacklist] = useState(false);
  const [participantAddOpen, setParticipantAddOpen] = useState(false);
  const [participantAddDraft, setParticipantAddDraft] = useState("");
  const [threadActionTarget, setThreadActionTarget] = useState<ThreadSummary | null>(null);
  const [threadActionError, setThreadActionError] = useState<string | null>(null);
  const [threadActionSaving, setThreadActionSaving] = useState<string | null>(null);
  const [selectedThreadKeys, setSelectedThreadKeys] = useState<Set<string>>(() => new Set());
  const [pendingFilePreviewUrl, setPendingFilePreviewUrl] = useState<string | null>(null);
  const [mentionAll, setMentionAll] = useState(false);
  const [profileModal, setProfileModal] = useState<ChatProfile | null>(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [pinnedChatJids, setPinnedChatJids] = useState<Set<string>>(() => new Set());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toolsCanvasOpen, setToolsCanvasOpen] = useState(false);
  const [activationsModalOpen, setActivationsModalOpen] = useState(false);
  const [activationConfigTarget, setActivationConfigTarget] = useState<ActivationConfigTarget | null>(null);
  const [activationEditorField, setActivationEditorField] = useState<ActivationEditorField | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [loadingInstances, setLoadingInstances] = useState(true);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [loadingGroupControls, setLoadingGroupControls] = useState(false);
  const [savingGroupControl, setSavingGroupControl] = useState<string | null>(null);
  const [groupControlsError, setGroupControlsError] = useState<string | null>(null);
  const [groupSettingsFeedback, setGroupSettingsFeedback] = useState<string | null>(null);
  const [welcomeEnabledDraft, setWelcomeEnabledDraft] = useState(false);
  const [welcomeCaptionDraft, setWelcomeCaptionDraft] = useState("");
  const [welcomeMediaUrlDraft, setWelcomeMediaUrlDraft] = useState("");
  const [welcomeUseParticipantProfilePhotoDraft, setWelcomeUseParticipantProfilePhotoDraft] = useState(false);
  const [welcomeAsStickerDraft, setWelcomeAsStickerDraft] = useState(false);
  const [farewellEnabledDraft, setFarewellEnabledDraft] = useState(false);
  const [farewellCaptionDraft, setFarewellCaptionDraft] = useState("");
  const [farewellMediaUrlDraft, setFarewellMediaUrlDraft] = useState("");
  const [farewellUseParticipantProfilePhotoDraft, setFarewellUseParticipantProfilePhotoDraft] = useState(false);
  const [farewellAsStickerDraft, setFarewellAsStickerDraft] = useState(false);
  const [bannedWordsDraft, setBannedWordsDraft] = useState("");
  const [allowedLinksDraft, setAllowedLinksDraft] = useState("");
  const [antipalavrasLimitDraft, setAntipalavrasLimitDraft] = useState("5");
  const [antiInactivityEnabledDraft, setAntiInactivityEnabledDraft] = useState(false);
  const [antiInactivityDaysDraft, setAntiInactivityDaysDraft] = useState("30");
  const [antiInactivityScanDraft, setAntiInactivityScanDraft] = useState("24");
  const [antiInactivityRemoveLimitDraft, setAntiInactivityRemoveLimitDraft] = useState("20");
  const [allowedDdisDraft, setAllowedDdisDraft] = useState("");
  const [antifakeMessageDraft, setAntifakeMessageDraft] = useState("");
  const [scheduleCloseEnabledDraft, setScheduleCloseEnabledDraft] = useState(false);
  const [scheduleCloseTimesDraft, setScheduleCloseTimesDraft] = useState("");
  const [scheduleCloseMessageDraft, setScheduleCloseMessageDraft] = useState("");
  const [scheduleOpenEnabledDraft, setScheduleOpenEnabledDraft] = useState(false);
  const [scheduleOpenTimesDraft, setScheduleOpenTimesDraft] = useState("");
  const [scheduleOpenMessageDraft, setScheduleOpenMessageDraft] = useState("");
  const [scheduleTimezoneDraft, setScheduleTimezoneDraft] = useState("");
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [pendingGroupEditorChatJid, setPendingGroupEditorChatJid] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState("");
  const [groupAdminsOnlyDraft, setGroupAdminsOnlyDraft] = useState(false);
  const [groupLockedDraft, setGroupLockedDraft] = useState(false);
  const [groupEphemeralDraft, setGroupEphemeralDraft] = useState("");
  const [groupPhotoDraft, setGroupPhotoDraft] = useState<File | null>(null);
  const [groupEditorError, setGroupEditorError] = useState<string | null>(null);
  const [groupEditorSaving, setGroupEditorSaving] = useState(false);
  const [groupSharesDraft, setGroupSharesDraft] = useState("");
  const [groupSharesLoading, setGroupSharesLoading] = useState(false);
  const [groupSharesFeedback, setGroupSharesFeedback] = useState<string | null>(null);
  const [planSnapshot, setPlanSnapshot] = useState<UserPlanSnapshot | null>(null);
  const [planSnapshotLoading, setPlanSnapshotLoading] = useState(false);
  const [groupPlanPicker, setGroupPlanPicker] = useState<GroupPlanPickerState | null>(null);
  const [groupPlanExpandedId, setGroupPlanExpandedId] = useState<number | null>(null);
  const [groupPaymentPicker, setGroupPaymentPicker] = useState<GroupPaymentPickerState | null>(null);
  const [groupCheckout, setGroupCheckout] = useState<GroupCheckoutState | null>(null);
  const [groupPlanRequiredOpen, setGroupPlanRequiredOpen] = useState(false);
  const [groupPlanError, setGroupPlanError] = useState<string | null>(null);
  const [groupPlanBusy, setGroupPlanBusy] = useState<string | null>(null);
  const [threadGroupActionBusyKey, setThreadGroupActionBusyKey] = useState<string | null>(null);
  const [groupAdsOpen, setGroupAdsOpen] = useState(false);
  const [groupAds, setGroupAds] = useState<BotGroupAdSummary[]>([]);
  const [groupAdsLoading, setGroupAdsLoading] = useState(false);
  const [groupAdsBusy, setGroupAdsBusy] = useState<string | null>(null);
  const [groupAdsError, setGroupAdsError] = useState<string | null>(null);
  const [groupAdsFeedback, setGroupAdsFeedback] = useState<string | null>(null);
  const [groupAdEditor, setGroupAdEditor] = useState<BotGroupAdSummary | null>(null);
  const [groupAdCaptionDraft, setGroupAdCaptionDraft] = useState("");
  const [groupAdEnabledDraft, setGroupAdEnabledDraft] = useState(true);
  const [groupAdMentionAllDraft, setGroupAdMentionAllDraft] = useState(false);
  const [groupAdScheduleTypeDraft, setGroupAdScheduleTypeDraft] = useState<"frequency" | "times">("frequency");
  const [groupAdFrequencyDraft, setGroupAdFrequencyDraft] = useState("6h");
  const [groupAdTimesDraft, setGroupAdTimesDraft] = useState("");
  const [conversationSharesDraft, setConversationSharesDraft] = useState("");
  const [conversationSharesLoading, setConversationSharesLoading] = useState(false);
  const [conversationSharesSaving, setConversationSharesSaving] = useState(false);
  const [conversationSharesFeedback, setConversationSharesFeedback] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [directoryErrors, setDirectoryErrors] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const welcomeMediaInputRef = useRef<HTMLInputElement | null>(null);
  const farewellMediaInputRef = useRef<HTMLInputElement | null>(null);
  const groupPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const threadLongPressTimerRef = useRef<number | null>(null);
  const threadLongPressTriggeredRef = useRef(false);
  const participantLongPressTimerRef = useRef<number | null>(null);
  const participantLongPressTriggeredRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingHoldActiveRef = useRef(false);

  const goToDashboardSection = useCallback((target: DashboardSection) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DASHBOARD_SECTION_STORAGE_KEY, target);
    }
    router.push("/dashboard/user");
  }, [router]);

  const handleLogout = useCallback(async () => {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 2200) : null;
    try {
      await fetch(apiPath("/api/auth/logout"), {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        signal: controller?.signal,
      });
    } catch {
      // segue para redirecionamento mesmo se a rede falhar
    } finally {
      if (timeout) window.clearTimeout(timeout);
      if (typeof window !== "undefined") {
        window.location.replace(apiPath("/sign-in?logout=1"));
      } else {
        router.replace("/sign-in");
      }
    }
  }, [router]);

  const loadPlanSnapshot = useCallback(async () => {
    setPlanSnapshotLoading(true);
    try {
      const payload = await fetch(apiPath("/api/user/plan/mobile"), { cache: "no-store" })
        .then((response) => readJson<UserPlanSnapshot>(response));
      setPlanSnapshot({
        status: payload.status ?? null,
        plans: Array.isArray(payload.plans) ? payload.plans : [],
        paymentMethods: Array.isArray(payload.paymentMethods) ? payload.paymentMethods : [],
      });
    } catch (requestError) {
      setGroupPlanError(requestError instanceof Error ? requestError.message : "Não foi possível carregar os planos.");
    } finally {
      setPlanSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlanSnapshot();
  }, [loadPlanSnapshot]);

  const upsertGroupRecord = useCallback((group: BotGroupSummary | null | undefined) => {
    if (!group) return;
    const remoteKey = normalizeJidKey(group.remoteId);
    if (remoteKey) {
      setExternalLinkedGroupJids((current) => {
        if (!current.has(remoteKey)) return current;
        const next = new Set(current);
        next.delete(remoteKey);
        return next;
      });
    }
    setGroupRecords((current) => {
      const exists = current.some((entry) => entry.id === group.id);
      return exists
        ? current.map((entry) => (entry.id === group.id ? group : entry))
        : [...current, group];
    });
  }, []);

  const loadGroupRecords = useCallback(async () => {
    const payload = await fetch(apiPath("/api/bot-groups"), { cache: "no-store" })
      .then((response) => readJson<BotGroupListPayload>(response));
    const groups = payload.groups ?? [];
    setGroupRecords(groups);
    return groups;
  }, []);

  const loadExternalLinkedGroupsForThreads = useCallback(async (sourceThreads: ThreadSummary[]) => {
    const remoteIds = Array.from(
      new Set(
        sourceThreads
          .filter((thread) => resolveThreadChatType(thread) === "group")
          .map((thread) => thread.chatJid.trim())
          .filter(Boolean),
      ),
    ).slice(0, 200);

    if (remoteIds.length === 0) {
      setExternalLinkedGroupJids(new Set());
      return;
    }

    const params = new URLSearchParams();
    for (const remoteId of remoteIds) {
      params.append("remoteId", remoteId);
    }

    try {
      const payload = await fetch(apiPath(`/api/bot-groups?${params.toString()}`), { cache: "no-store" })
        .then((response) => readJson<BotGroupListPayload>(response));
      if (Array.isArray(payload.groups)) {
        setGroupRecords(payload.groups);
      }
      const requestedKeys = new Set(remoteIds.map(normalizeJidKey).filter(Boolean));
      const linkedKeys = new Set(
        (payload.externalLinks ?? [])
          .filter((entry) => entry.linkedToOtherUser)
          .map((entry) => normalizeJidKey(entry.remoteId))
          .filter(Boolean),
      );
      setExternalLinkedGroupJids((current) => {
        const next = new Set(current);
        for (const key of requestedKeys) {
          next.delete(key);
        }
        for (const key of linkedKeys) {
          next.add(key);
        }
        return next;
      });
    } catch (requestError) {
      console.warn("[whatsapp-conversations] failed to load external linked groups", requestError);
    }
  }, []);

  useEffect(() => {
    void loadGroupRecords().catch(() => undefined);
  }, [loadGroupRecords]);

  useEffect(() => {
    selectedChatJidRef.current = selectedChatJid;
  }, [selectedChatJid]);

  const setMobileChatOpenState = useCallback(
    (open: boolean) => {
      setMobileChatOpen(open);
      onMobileChatOpenChange?.(open);
    },
    [onMobileChatOpenChange],
  );

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );
  const instanceRecordMap = useMemo(() => {
    const map = new Map<number, InstanceSummary>();
    for (const instance of instances) {
      map.set(instance.id, instance);
    }
    return map;
  }, [instances]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.chatJid === selectedChatJid) ?? null,
    [threads, selectedChatJid],
  );
  const groupRecordMaps = useMemo(() => {
    const byId = new Map<number, BotGroupSummary>();
    const byRemoteId = new Map<string, BotGroupSummary>();
    for (const group of [...groupRecords, ...(selectedGroupRecord ? [selectedGroupRecord] : [])]) {
      byId.set(group.id, group);
      byRemoteId.set(group.remoteId.trim().toLowerCase(), group);
    }
    return { byId, byRemoteId };
  }, [groupRecords, selectedGroupRecord]);
  const getThreadGroupRecord = useCallback(
    (thread: ThreadSummary | null | undefined) => {
      if (!thread || resolveThreadChatType(thread) !== "group") return null;
      if (thread.linkedGroupId) {
        const byId = groupRecordMaps.byId.get(thread.linkedGroupId);
        if (byId) return byId;
      }
      return groupRecordMaps.byRemoteId.get(normalizeJidKey(thread.chatJid)) ?? null;
    },
    [groupRecordMaps],
  );
  const isThreadLinkedToOtherUser = useCallback(
    (thread: ThreadSummary | null | undefined) => {
      if (!thread || resolveThreadChatType(thread) !== "group") return false;
      if (getThreadGroupRecord(thread)) return false;
      return externalLinkedGroupJids.has(normalizeJidKey(thread.chatJid));
    },
    [externalLinkedGroupJids, getThreadGroupRecord],
  );
  const activeGroupChatJidSet = useMemo(
    () => new Set(activeGroupChatJids.map((jid) => jid.trim().toLowerCase()).filter(Boolean)),
    [activeGroupChatJids],
  );
  const getGroupProfileExpiresAt = useCallback(
    (group: BotGroupSummary | null | undefined) => {
      if (!group?.instanceId) return null;
      return instanceRecordMap.get(group.instanceId)?.expiresAt ?? null;
    },
    [instanceRecordMap],
  );
  const getThreadProfileExpiresAt = useCallback(
    (thread: ThreadSummary | null | undefined) => {
      const instanceId = thread?.instanceId && thread.instanceId > 0 ? thread.instanceId : selectedInstanceId;
      return instanceId ? instanceRecordMap.get(instanceId)?.expiresAt ?? null : null;
    },
    [instanceRecordMap, selectedInstanceId],
  );
  const selectedIsSharedMailbox = selectedInstanceId === SHARED_CONVERSATIONS_INSTANCE_ID;
  const selectedThreadInstanceId =
    selectedThread?.instanceId && selectedThread.instanceId > 0
      ? selectedThread.instanceId
      : selectedInstanceId && selectedInstanceId > 0
        ? selectedInstanceId
        : null;
  const selectedThreadInstance = selectedThreadInstanceId ? instanceRecordMap.get(selectedThreadInstanceId) ?? selectedInstance : selectedInstance;
  const selectedCallKey = getConversationCallKey(selectedThreadInstanceId, selectedThread?.chatJid);
  const selectedCall = selectedCallKey ? callsByChat[selectedCallKey] ?? null : null;
  const activeCallView = useMemo<ActiveCallView | null>(() => {
    const entries = Object.entries(callsByChat)
      .filter(([, call]) => call?.callId && !isTerminalCallAction(call.action))
      .sort(([, left], [, right]) => {
        const leftTime = Date.parse(left.timestamp || "") || 0;
        const rightTime = Date.parse(right.timestamp || "") || 0;
        return rightTime - leftTime;
      });
    const [key, call] = entries[0] ?? [];
    if (!key || !call) return null;
    const parsed = splitConversationCallKey(key);
    const thread = threads.find((item) => item.instanceId === call.instanceId && item.chatJid === call.chatJid) ??
      (selectedThread?.instanceId === call.instanceId && selectedThread.chatJid === call.chatJid ? selectedThread : null);
    return {
      key,
      call,
      thread,
      instance: parsed ? instanceRecordMap.get(parsed.instanceId) ?? null : instanceRecordMap.get(call.instanceId) ?? null,
    };
  }, [callsByChat, instanceRecordMap, selectedThread, threads]);
  const activeCall = activeCallView?.call ?? null;
  const activeCallKey = activeCallView?.key ?? null;
  const activeCallIncoming = Boolean(activeCall && isIncomingCallAction(activeCall.action));
  const activeCallAudioBridgeKey =
    activeCall && activeCallKey && !activeCallIncoming && !isTerminalCallAction(activeCall.action)
      ? activeCall.callId
      : null;
  const selectedThreadIsShared = Boolean(selectedIsSharedMailbox || selectedThread?.sharedAccess);
  const selectedGroupProfileExpiresAt = useMemo(
    () => getGroupProfileExpiresAt(selectedGroupRecord),
    [getGroupProfileExpiresAt, selectedGroupRecord],
  );
  const selectedGroupPlanState = useMemo(
    () => getGroupPlanState(selectedGroupRecord, selectedGroupProfileExpiresAt),
    [selectedGroupProfileExpiresAt, selectedGroupRecord],
  );
  const selectedGroupHasPremium = selectedGroupPlanState.state === "active";
  const selectedThreadLinkedToOtherUser = useMemo(
    () => isThreadLinkedToOtherUser(selectedThread),
    [isThreadLinkedToOtherUser, selectedThread],
  );
  const availableGroupPlans = useMemo(
    () => (planSnapshot?.plans ?? []).filter((plan) => plan.isActive && plan.price > 0),
    [planSnapshot?.plans],
  );
  const availablePaymentMethods = useMemo(
    () => (planSnapshot?.paymentMethods ?? []).filter((method) => method.isActive && method.isConfigured),
    [planSnapshot?.paymentMethods],
  );

  const chooseInstance = useCallback(
    (instanceId: number | null) => {
      setSelectedInstanceId(instanceId);
      onPreferredInstanceChange?.(instanceId);
      setSelectedChatJid(null);
      setMobileChatOpenState(false);
    },
    [onPreferredInstanceChange, setMobileChatOpenState],
  );

  useEffect(() => {
    if (!preferredInstanceId) return;
    if (!instances.some((instance) => instance.id === preferredInstanceId)) return;
    if (selectedInstanceId === preferredInstanceId) return;
    chooseInstance(preferredInstanceId);
  }, [chooseInstance, instances, preferredInstanceId, selectedInstanceId]);

  useEffect(() => {
    if (!pendingFile) {
      setPendingFilePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  useEffect(() => {
    if (!selectedInstanceId || typeof window === "undefined") {
      setPinnedChatJids(new Set());
      return;
    }
    const raw = window.localStorage.getItem(`${THREAD_PIN_STORAGE_PREFIX}.${selectedInstanceId}`);
    const parsed = raw ? raw.split("\n").map((entry) => entry.trim()).filter(Boolean) : [];
    setPinnedChatJids(new Set(parsed));
  }, [selectedInstanceId]);

  useEffect(() => {
    setSelectedThreadKeys(new Set());
  }, [selectedInstanceId, threadFilter]);

  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (!shouldShowThreadInList(thread)) return false;
      if (!matchesThreadFilter(thread, threadFilter)) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        getThreadTitle(thread, selectedInstance),
        getThreadSubtitle(thread, selectedInstance),
        getThreadPreview(thread, selectedInstance),
        thread.title,
        thread.phone,
        thread.chatJid,
        thread.lastMessageSenderName,
        thread.lastMessageSenderJid,
        thread.lastMessagePreview,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    }).sort((left, right) => {
      const leftPinned = pinnedChatJids.has(left.chatJid) ? 1 : 0;
      const rightPinned = pinnedChatJids.has(right.chatJid) ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      const leftActiveGroup = activeGroupChatJidSet.has(left.chatJid.toLowerCase()) ? 1 : 0;
      const rightActiveGroup = activeGroupChatJidSet.has(right.chatJid.toLowerCase()) ? 1 : 0;
      if (leftActiveGroup !== rightActiveGroup) return rightActiveGroup - leftActiveGroup;
      const leftTime = left.lastMessageAt ? Date.parse(left.lastMessageAt) : 0;
      const rightTime = right.lastMessageAt ? Date.parse(right.lastMessageAt) : 0;
      return rightTime - leftTime;
    });
  }, [activeGroupChatJidSet, pinnedChatJids, query, selectedInstance, threadFilter, threads]);

  const reactionGroupsByMessageId = useMemo(() => buildMessageReactionGroups(messages), [messages]);
  const conversationMessageCount = useMemo(
    () => messages.filter((message) => !isReactionConversationMessage(message)).length,
    [messages],
  );

  const visibleMessages = useMemo(() => {
    const normalizedQuery = messageSearchQuery.trim().toLowerCase();
    const baseMessages = messages.filter((message) => !isReactionConversationMessage(message));
    if (!normalizedQuery) return baseMessages;
    return baseMessages.filter((message) => {
      const haystack = [
        message.text,
        message.senderName,
        message.senderJid,
        message.messageType,
        describeMedia(message),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [messageSearchQuery, messages]);

  const selectedChatType = useMemo(() => resolveThreadChatType(selectedThread), [selectedThread]);
  const canUseSelectedWhatsappCall = Boolean(
    selectedThread &&
      selectedThreadInstanceId &&
      !selectedThreadIsShared &&
      (selectedChatType === "contact" || selectedThread.chatJid.toLowerCase().endsWith("@lid")) &&
      selectedThreadInstance?.sessionStatus === "conectado",
  );
  const pendingFileType = pendingFile ? inferClientMediaType(pendingFile.type, pendingFile.name) : null;
  const canSendComposer = Boolean(composer.trim() || pendingFile);
  const mentionTargets = useMemo(
    () => (selectedChatType === "group" ? buildMentionTargets(selectedGroupRecord, selectedInstance) : []),
    [selectedChatType, selectedGroupRecord, selectedInstance],
  );
  const selectedGroupRecordMatchesThread = Boolean(
    selectedThread &&
      selectedGroupRecord &&
      selectedGroupRecord.instanceId === selectedThreadInstanceId &&
      selectedGroupRecord.remoteId?.toLowerCase() === selectedThread.chatJid.toLowerCase(),
  );
  const selectedLinkedGroupId =
    selectedThread?.linkedGroupId ??
    (selectedGroupRecordMatchesThread ? selectedGroupRecord?.id ?? null : null);
  const canEditSelectedGroup = Boolean(
      selectedThread &&
      selectedChatType === "group" &&
      selectedThread.instanceIsAdmin !== false &&
      selectedLinkedGroupId &&
      selectedGroupRecord,
  );
  const canEditThreadActionGroup = Boolean(
    threadActionTarget &&
      resolveThreadChatType(threadActionTarget) === "group" &&
      threadActionTarget.instanceIsAdmin !== false &&
      threadActionTarget.linkedGroupId,
  );
  const canManageSelectedGroupShares = Boolean(
    selectedGroupRecord && selectedGroupRecord.accessRole !== "shared_admin",
  );
  const canManageSelectedConversationShares = Boolean(
    selectedThread &&
      selectedChatType === "contact" &&
      selectedThreadInstanceId &&
      selectedThreadInstanceId > 0 &&
      !selectedThreadIsShared,
  );
  const selectedGroupParticipants = useMemo(() => {
    const participants = Array.isArray(selectedGroupRecord?.participants)
      ? selectedGroupRecord.participants
      : [];
    return [...participants].sort((left, right) => {
      const rankDelta = getParticipantRoleRank(left) - getParticipantRoleRank(right);
      if (rankDelta !== 0) return rankDelta;
      return getParticipantDisplayName(left).localeCompare(getParticipantDisplayName(right), "pt-BR");
    });
  }, [selectedGroupRecord?.participants]);
  const canModerateSelectedGroup = Boolean(
      selectedThread &&
      selectedChatType === "group" &&
      selectedThread.instanceIsAdmin !== false &&
      selectedLinkedGroupId &&
      selectedGroupRecord,
  );
  const ownParticipantDigits = normalizeIdentityDigits(selectedInstance?.phone);

  const serviceWindow = useMemo(() => getServiceWindowInfo(messages), [messages]);

  const flowShortcuts = useMemo(() => {
    if (!selectedThreadInstanceId || !selectedThread || selectedThreadIsShared) return [];
    const expectedScope = selectedChatType === "group" ? "group" : "private";
    return flows
      .filter((flow) => {
        if (!flow.enabled) return false;
        if (flow.scope !== expectedScope) return false;
        return flow.instanceId === null || flow.instanceId === selectedThreadInstanceId;
      })
      .slice(0, 8);
  }, [flows, selectedChatType, selectedThread, selectedThreadInstanceId, selectedThreadIsShared]);

  const conversationReadOnly = Boolean(
    selectedThread &&
      (selectedChatType === "channel" ||
        selectedChatType === "broadcast" ||
        (selectedChatType === "group" && selectedThread.announceOnly === true && selectedThread.instanceIsAdmin === false)),
  );

  const readOnlyReason =
    selectedChatType === "channel"
      ? "Canais do WhatsApp são exibidos como leitura no painel."
      : selectedChatType === "broadcast"
        ? "Listas de transmissão não aceitam envio direto por esta tela."
        : selectedChatType === "group" && selectedThread?.announceOnly === true && selectedThread.instanceIsAdmin === false
	          ? "Este grupo está fechado e a instância não é administradora."
	          : "";

  const canShowMentionAllToggle = Boolean(
    selectedThread &&
      selectedChatType === "group" &&
      composer.trim() &&
      !conversationReadOnly,
  );
  const profileModalIsSelectedThread = Boolean(
    profileModal && selectedThread && profileModal.jid === selectedThread.chatJid,
  );
  const canShowConversationShareEditor = Boolean(
    profileModalIsSelectedThread && canManageSelectedConversationShares,
  );

  useEffect(() => {
    setMentionAll(false);
  }, [selectedChatJid, selectedInstanceId]);

  useEffect(() => {
    if (!canShowMentionAllToggle && mentionAll) {
      setMentionAll(false);
    }
  }, [canShowMentionAllToggle, mentionAll]);

  const selectedActivationConfigCopy = activationConfigTarget
    ? ACTIVATION_CONFIG_COPY[activationConfigTarget]
    : null;

  const welcomePreviewMediaUrl = useMemo(
    () => resolveStoredMediaPreviewUrl(welcomeMediaUrlDraft, selectedGroupSettings?.welcomeConfig?.mediaPath),
    [selectedGroupSettings?.welcomeConfig?.mediaPath, welcomeMediaUrlDraft],
  );
  const farewellPreviewMediaUrl = useMemo(
    () => resolveStoredMediaPreviewUrl(farewellMediaUrlDraft, selectedGroupSettings?.farewellConfig?.mediaPath),
    [farewellMediaUrlDraft, selectedGroupSettings?.farewellConfig?.mediaPath],
  );
  const activationLifecyclePreviewMediaUrl =
    activationConfigTarget === "welcome"
      ? welcomePreviewMediaUrl
      : activationConfigTarget === "farewell"
        ? farewellPreviewMediaUrl
        : "";
  const activationLifecycleMediaBusy =
    activationConfigTarget === "welcome"
      ? savingGroupControl === "welcomeMedia"
      : activationConfigTarget === "farewell"
        ? savingGroupControl === "farewellMedia"
        : false;

  const activationConfigSaving =
    activationConfigTarget === "welcome"
      ? savingGroupControl === "welcome" ||
        savingGroupControl === "welcomeMedia" ||
        savingGroupControl === "welcomeMediaClear"
      : activationConfigTarget === "farewell"
        ? savingGroupControl === "farewell" ||
          savingGroupControl === "farewellMedia" ||
          savingGroupControl === "farewellMediaClear"
        : activationConfigTarget === "bannedWords"
          ? savingGroupControl === "bannedWords"
          : activationConfigTarget === "allowedLinks"
            ? savingGroupControl === "allowedLinks"
          : activationConfigTarget === "schedule"
            ? savingGroupControl === "schedule"
            : activationConfigTarget === "antiInactivity"
              ? savingGroupControl === "antiInactivityAdvanced"
              : activationConfigTarget === "antiFake"
                ? savingGroupControl === "antiFake"
                : false;

  const activationConfigSaveLabel =
    activationConfigTarget === "welcome"
      ? "Salvar boas-vindas"
      : activationConfigTarget === "farewell"
        ? "Salvar saída"
        : activationConfigTarget === "bannedWords"
          ? "Salvar anti-palavras"
          : activationConfigTarget === "allowedLinks"
            ? "Salvar links"
          : activationConfigTarget === "schedule"
            ? "Salvar horários"
            : activationConfigTarget === "antiInactivity"
              ? "Salvar anti-inatividade"
              : "Salvar anti-fake";

  const syncGroupSettingsDrafts = useCallback((settings: GroupSettingsSummary | null) => {
    if (!settings) {
      setWelcomeEnabledDraft(false);
      setWelcomeCaptionDraft("");
      setWelcomeMediaUrlDraft("");
      setWelcomeUseParticipantProfilePhotoDraft(false);
      setWelcomeAsStickerDraft(false);
      setFarewellEnabledDraft(false);
      setFarewellCaptionDraft("");
      setFarewellMediaUrlDraft("");
      setFarewellUseParticipantProfilePhotoDraft(false);
      setFarewellAsStickerDraft(false);
      setBannedWordsDraft("");
      setAllowedLinksDraft("");
      setAntipalavrasLimitDraft("5");
      setAntiInactivityEnabledDraft(false);
      setAntiInactivityDaysDraft("30");
      setAntiInactivityScanDraft("24");
	      setAntiInactivityRemoveLimitDraft("20");
	      setAllowedDdisDraft("");
	      setAntifakeMessageDraft("");
	      setScheduleCloseEnabledDraft(false);
	      setScheduleCloseTimesDraft("");
	      setScheduleCloseMessageDraft("");
	      setScheduleOpenEnabledDraft(false);
	      setScheduleOpenTimesDraft("");
	      setScheduleOpenMessageDraft("");
	      setScheduleTimezoneDraft("");
	      return;
	    }

    setWelcomeEnabledDraft(Boolean(settings.welcomeConfig?.enabled ?? settings.commandToggles?.bemvindo));
    setWelcomeCaptionDraft(settings.welcomeConfig?.caption ?? "");
    setWelcomeMediaUrlDraft(settings.welcomeConfig?.mediaUrl ?? "");
    setWelcomeUseParticipantProfilePhotoDraft(Boolean(settings.welcomeConfig?.useParticipantProfilePhoto));
    setWelcomeAsStickerDraft(Boolean(settings.welcomeConfig?.asSticker));
    setFarewellEnabledDraft(Boolean(settings.farewellConfig?.enabled ?? settings.commandToggles?.despedida));
    setFarewellCaptionDraft(settings.farewellConfig?.caption ?? "");
    setFarewellMediaUrlDraft(settings.farewellConfig?.mediaUrl ?? "");
    setFarewellUseParticipantProfilePhotoDraft(Boolean(settings.farewellConfig?.useParticipantProfilePhoto));
    setFarewellAsStickerDraft(Boolean(settings.farewellConfig?.asSticker));
    setBannedWordsDraft(Array.isArray(settings.bannedWords) ? settings.bannedWords.join("\n") : "");
    setAllowedLinksDraft(Array.isArray(settings.allowedLinks) ? settings.allowedLinks.join("\n") : "");
    setAntipalavrasLimitDraft(String(Math.max(1, Number(settings.antipalavrasMaxInfractions ?? 5) || 5)));
    setAntiInactivityEnabledDraft(Boolean(settings.antiInactivityConfig?.enabled));
    setAntiInactivityDaysDraft(String(Math.max(1, Number(settings.antiInactivityConfig?.days ?? 30) || 30)));
    setAntiInactivityScanDraft(String(Math.max(1, Number(settings.antiInactivityConfig?.scanIntervalHours ?? 24) || 24)));
	    setAntiInactivityRemoveLimitDraft(String(Math.max(1, Number(settings.antiInactivityConfig?.removeLimit ?? 20) || 20)));
	    setAllowedDdisDraft(Array.isArray(settings.allowedDdis) ? settings.allowedDdis.join("\n") : "");
	    setAntifakeMessageDraft(settings.antifakeMessage ?? "");
	    setScheduleCloseEnabledDraft(Boolean(settings.scheduleConfig?.closeEnabled));
	    setScheduleCloseTimesDraft(Array.isArray(settings.scheduleConfig?.closeTimes) ? settings.scheduleConfig.closeTimes.join("\n") : "");
	    setScheduleCloseMessageDraft(settings.scheduleConfig?.closeMessage ?? "");
	    setScheduleOpenEnabledDraft(Boolean(settings.scheduleConfig?.openEnabled));
	    setScheduleOpenTimesDraft(Array.isArray(settings.scheduleConfig?.openTimes) ? settings.scheduleConfig.openTimes.join("\n") : "");
	    setScheduleOpenMessageDraft(settings.scheduleConfig?.openMessage ?? "");
	    setScheduleTimezoneDraft(settings.scheduleConfig?.timezone ?? "");
	  }, []);

  const loadInstances = useCallback(async () => {
    setLoadingInstances(true);
    setError(null);
    try {
      const [instancesPayload, sharedPayload] = await Promise.all([
        fetch(apiPath("/api/bot-instances"), { cache: "no-store" })
          .then((response) => readJson<{ instances: InstanceSummary[] }>(response)),
        fetch(apiPath("/api/whatsapp-shared-conversations"), { cache: "no-store" })
          .then((response) => readJson<{ threads: ThreadSummary[] }>(response))
          .catch(() => ({ threads: [] as ThreadSummary[] })),
      ]);
      const ownInstances = instancesPayload.instances ?? [];
      const hasSharedConversations = (sharedPayload.threads ?? []).length > 0;
      const nextInstances = hasSharedConversations
        ? [...ownInstances, SHARED_CONVERSATIONS_INSTANCE]
        : ownInstances;
      setInstances(nextInstances);
      setSelectedInstanceId((current) => {
        if (preferredInstanceId && nextInstances.some((instance) => instance.id === preferredInstanceId)) {
          return preferredInstanceId;
        }
        if (current && nextInstances.some((instance) => instance.id === current)) return current;
        const connected = nextInstances.find((instance) => instance.sessionStatus === "conectado");
        return connected?.id ?? nextInstances[0]?.id ?? null;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar instâncias.");
    } finally {
      setLoadingInstances(false);
    }
  }, [preferredInstanceId]);

  const loadFlows = useCallback(async () => {
    setLoadingFlows(true);
    try {
      const payload = await fetch(apiPath("/api/bot-flows"), { cache: "no-store" })
        .then((response) => readJson<{ flows: BotFlowSummary[] }>(response));
      setFlows(payload.flows ?? []);
    } catch (requestError) {
      console.warn("[whatsapp-conversations] failed to load flow shortcuts", requestError);
      setFlows([]);
    } finally {
      setLoadingFlows(false);
    }
  }, []);

  const loadThreads = useCallback(async (
    instanceId: number,
    options: { sync?: boolean; silent?: boolean } = {},
  ) => {
    if (!options.silent) {
      setLoadingThreads(true);
    }
    setError(null);
    try {
      const syncParam = options.sync === false ? "?sync=0" : "?sync=1";
      const url = instanceId === SHARED_CONVERSATIONS_INSTANCE_ID
        ? "/api/whatsapp-shared-conversations"
        : `/api/bot-instances/${instanceId}/whatsapp-conversations${syncParam}`;
      const payload = await fetch(apiPath(url), { cache: "no-store" })
        .then((response) => readJson<{
          threads: ThreadSummary[];
          directoryErrors?: string[];
        }>(response));
      const nextThreads = payload.threads ?? [];
      setThreads((current) => mergeThreadListWithStableMetadata(nextThreads, current));
      void loadExternalLinkedGroupsForThreads(nextThreads);
      setDirectoryErrors(payload.directoryErrors ?? []);
      setSelectedChatJid((current) => {
        if (current && options.silent) return current;
        if (current && nextThreads.some((thread) => thread.chatJid === current)) return current;
        return nextThreads[0]?.chatJid ?? null;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar conversas.");
    } finally {
      if (!options.silent) {
        setLoadingThreads(false);
      }
    }
  }, [loadExternalLinkedGroupsForThreads]);

  const loadMessages = useCallback(async (
    instanceId: number,
    chatJid: string,
    options: { silent?: boolean } = {},
  ) => {
    if (!options.silent) {
      setLoadingMessages(true);
    }
    setError(null);
    try {
      messagesAutoScrollRef.current = true;
      const payload = await fetch(
        apiPath(`/api/bot-instances/${instanceId}/whatsapp-conversations/${encodeURIComponent(chatJid)}/messages?limit=${WHATSAPP_INITIAL_MESSAGE_LIMIT}`),
        { cache: "no-store" },
      ).then((response) => readJson<{
        messages: ConversationMessage[];
        hasMore?: boolean;
        oldestCursor?: string | null;
      }>(response));
      // A silent refresh must never replace the mounted list while the user is
      // reading it: replacing the array resets virtualised rows/scroll and is
      // the source of the occasional jump or hitch in long conversations.
      setMessages((current) => options.silent
        ? sortConversationMessages(
            (payload.messages ?? []).reduce(
              (merged, message) => mergeConversationMessage(merged, message),
              [...current],
            ),
          )
        : sortConversationMessages(payload.messages ?? []));
      setMessageHistoryHasMore(Boolean(payload.hasMore));
      setMessageHistoryOldestCursor(payload.oldestCursor ?? null);
      setThreads((current) =>
        current.map((thread) =>
          thread.chatJid === chatJid ? { ...thread, unreadCount: 0 } : thread,
        ),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar mensagens.");
    } finally {
      if (!options.silent) {
        setLoadingMessages(false);
      }
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (
      !selectedThreadInstanceId ||
      !selectedChatJid ||
      !messageHistoryHasMore ||
      !messageHistoryOldestCursor ||
      loadingOlderMessages
    ) {
      return;
    }

    setLoadingOlderMessages(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(WHATSAPP_OLDER_MESSAGE_LIMIT),
        before: messageHistoryOldestCursor,
      });
      const payload = await fetch(
        apiPath(`/api/bot-instances/${selectedThreadInstanceId}/whatsapp-conversations/${encodeURIComponent(selectedChatJid)}/messages?${params.toString()}`),
        { cache: "no-store" },
      ).then((response) => readJson<{
        messages: ConversationMessage[];
        hasMore?: boolean;
        oldestCursor?: string | null;
      }>(response));
      messagesAutoScrollRef.current = false;
      setMessages((current) => sortConversationMessages([
        ...(payload.messages ?? []),
        ...current,
      ]));
      setMessageHistoryHasMore(Boolean(payload.hasMore));
      setMessageHistoryOldestCursor(payload.oldestCursor ?? null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar o histórico anterior.");
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [
    loadingOlderMessages,
    messageHistoryHasMore,
    messageHistoryOldestCursor,
    selectedChatJid,
    selectedThreadInstanceId,
  ]);

  const loadGroupControls = useCallback(async (
    groupId: number,
    options: { refreshParticipants?: boolean } = {},
  ) => {
    setLoadingGroupControls(true);
    setGroupControlsError(null);
    try {
      const participantsQuery = options.refreshParticipants ? "?refresh=1" : "";
      const [groupsPayload, settingsPayload, participantsPayload] = await Promise.all([
        fetch(apiPath("/api/bot-groups"), { cache: "no-store" })
          .then((response) => readJson<BotGroupListPayload>(response)),
        fetch(apiPath(`/api/bot-groups/${groupId}/settings`), { cache: "no-store" })
          .then((response) => readJson<{ settings: GroupSettingsSummary }>(response)),
        fetch(apiPath(`/api/bot-groups/${groupId}/participants${participantsQuery}`), { cache: "no-store" })
          .then((response) => readJson<{ participants: BotGroupParticipantSummary[] }>(response)),
      ]);
      const groups = groupsPayload.groups ?? [];
      setGroupRecords(groups);
      const groupRecord = groups.find((entry) => entry.id === groupId) ?? null;
      const group = groupRecord
        ? {
            ...groupRecord,
            participants: participantsPayload.participants ?? groupRecord.participants ?? [],
            participantCount: participantsPayload.participants?.length ?? groupRecord.participantCount,
          }
        : null;
      const settings = settingsPayload.settings;
      setSelectedGroupRecord(group);
      setSelectedGroupSettings(settings);
      syncGroupSettingsDrafts(settings);
    } catch (requestError) {
      setSelectedGroupRecord(null);
      setSelectedGroupSettings(null);
      syncGroupSettingsDrafts(null);
      setGroupControlsError(requestError instanceof Error ? requestError.message : "Não foi possível carregar controles do grupo.");
    } finally {
      setLoadingGroupControls(false);
    }
  }, [syncGroupSettingsDrafts]);

  const linkGroupFromThread = useCallback(async (thread: ThreadSummary) => {
    if (
      !thread ||
      !thread.instanceId ||
      thread.sharedAccess ||
      resolveThreadChatType(thread) !== "group"
    ) {
      return null;
    }

    const response = await fetch(apiPath("/api/bot-groups"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instanceId: thread.instanceId,
        remoteId: thread.chatJid,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      group?: BotGroupSummary;
      message?: string;
      code?: string;
      remoteId?: string;
    } | null;

    if (!response.ok) {
      if (response.status === 409 && payload?.code === "GROUP_LINKED_TO_OTHER_USER") {
        const remoteKey = normalizeJidKey(payload.remoteId || thread.chatJid);
        if (remoteKey) {
          setExternalLinkedGroupJids((current) => {
            if (current.has(remoteKey)) return current;
            const next = new Set(current);
            next.add(remoteKey);
            return next;
          });
        }
      }
      throw new Error(typeof payload?.message === "string" ? payload.message : "Falha na requisição.");
    }

    const group = payload?.group;
    if (!group) {
      throw new Error("Não foi possível vincular este grupo.");
    }
    upsertGroupRecord(group);
    setThreads((current) =>
      current.map((entry) =>
        entry.chatJid === thread.chatJid && entry.instanceId === thread.instanceId
          ? {
              ...entry,
              linkedGroupId: group.id,
              title: group.name || entry.title,
              participantsCount: group.participantCount ?? entry.participantsCount,
              announceOnly: group.metadata?.adminsOnly ?? entry.announceOnly,
            }
          : entry,
      ),
    );
    if (selectedChatJid === thread.chatJid && selectedThreadInstanceId === thread.instanceId) {
      setSelectedGroupRecord(group);
    }
    return group;
  }, [selectedChatJid, selectedThreadInstanceId, upsertGroupRecord]);

  const linkSelectedGroupFromChat = useCallback(async () => {
    if (
      !selectedThread ||
      !selectedThreadInstanceId ||
      selectedThreadIsShared ||
      resolveThreadChatType(selectedThread) !== "group"
    ) return;
    setSavingGroupControl("link");
    setGroupControlsError(null);
    try {
      const group = await linkGroupFromThread(selectedThread);
      if (!group) {
        throw new Error("Não foi possível vincular este grupo.");
      }
      await loadGroupControls(group.id);
    } catch (requestError) {
      setGroupControlsError(requestError instanceof Error ? requestError.message : "Não foi possível vincular o grupo.");
    } finally {
      setSavingGroupControl(null);
    }
  }, [linkGroupFromThread, loadGroupControls, selectedThread, selectedThreadInstanceId, selectedThreadIsShared]);

  const patchSelectedGroup = useCallback(async (
    patch: Record<string, unknown>,
    savingKey: string,
  ) => {
    if (!selectedGroupRecord) return;
    setSavingGroupControl(savingKey);
    setGroupControlsError(null);
    try {
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((response) => readJson<{ group?: BotGroupSummary }>(response));
      const group = payload.group ?? ({
        ...selectedGroupRecord,
        ...patch,
        metadata: {
          ...selectedGroupRecord.metadata,
          ...("adminsOnly" in patch ? { adminsOnly: Boolean(patch.adminsOnly) } : {}),
          ...("locked" in patch ? { locked: Boolean(patch.locked) } : {}),
        },
      } as BotGroupSummary);
      upsertGroupRecord(group);
      setSelectedGroupRecord(group);
      setThreads((current) =>
        current.map((thread) =>
          thread.linkedGroupId === group.id
            ? {
                ...thread,
                announceOnly: group.metadata?.adminsOnly ?? thread.announceOnly,
              }
            : thread,
        ),
      );
    } catch (requestError) {
      setGroupControlsError(requestError instanceof Error ? requestError.message : "Não foi possível atualizar o grupo.");
    } finally {
      setSavingGroupControl(null);
    }
  }, [selectedGroupRecord, upsertGroupRecord]);

  const patchSelectedGroupSettings = useCallback(async (
    patch: Record<string, unknown>,
    savingKey: string,
  ) => {
    if (!selectedGroupRecord) return;
    setSavingGroupControl(savingKey);
    setGroupControlsError(null);
    try {
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/settings`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((response) => readJson<{ settings: GroupSettingsSummary }>(response));
      setSelectedGroupSettings(payload.settings);
      syncGroupSettingsDrafts(payload.settings);
      return true;
    } catch (requestError) {
      setGroupControlsError(requestError instanceof Error ? requestError.message : "Não foi possível atualizar as configurações.");
      return false;
    } finally {
      setSavingGroupControl(null);
    }
  }, [selectedGroupRecord, syncGroupSettingsDrafts]);

  const buildActivationSettingsPatch = useCallback((key: string, value: boolean) => {
    const commandToggles = {
      ...(selectedGroupSettings?.commandToggles ?? {}),
      [key]: value,
    };
    const featureFlags = { ...(selectedGroupSettings?.featureFlags ?? {}) };
    const patch: Record<string, unknown> = { commandToggles };

    if (key === "bemvindo") {
      patch.welcomeConfig = {
        ...(selectedGroupSettings?.welcomeConfig ?? {}),
        enabled: value,
      };
    } else if (key === "despedida") {
      patch.farewellConfig = {
        ...(selectedGroupSettings?.farewellConfig ?? {}),
        enabled: value,
      };
    } else if (key === "antilink") {
      patch.antilink = value;
      featureFlags.bloqueiolinks = value;
    } else if (key === "antilinkgp") {
      patch.antilinkGroupInvite = value;
    } else if (key === "antipalavras") {
      featureFlags.antipalavras = value;
    } else if (key === "banextremo") {
      patch.banExtremo = value;
    } else if (key === "bangringos") {
      featureFlags.bangringos = value;
    } else if (key === "antinsfwimagem" || key === "proibirnsfw") {
      commandToggles.antinsfwimagem = value;
      commandToggles.proibirnsfw = value;
      featureFlags.antinsfwimagem = value;
      featureFlags.proibirnsfw = value;
    } else if (key === "soadm") {
      featureFlags.soadm = value;
    }

    if (Object.keys(featureFlags).length > 0) {
      patch.featureFlags = featureFlags;
    }

    return patch;
  }, [selectedGroupSettings]);

  const openToolsCanvas = useCallback(() => {
    setToolsCanvasOpen(true);
    setShortcutsOpen(false);
    setEmojiOpen(false);
  }, []);

	  const openGroupPlanPicker = useCallback((
	    group = selectedGroupRecord,
	    mode: GroupPlanPickerState["mode"] = hasIndividualGroupLicenseRecord(group) || isProfileLicenseActive(getGroupProfileExpiresAt(group))
	      ? "renewal"
	      : "activation",
	    scope: GroupPlanPickerState["scope"] = "profile",
	  ) => {
	    if (!group) return;
	    setGroupPlanRequiredOpen(false);
    setGroupPaymentPicker(null);
    setGroupCheckout(null);
    setGroupPlanError(null);
    setGroupPlanExpandedId(null);
    setGroupPlanPicker({ group, mode, scope });
    if (!planSnapshot && !planSnapshotLoading) {
      void loadPlanSnapshot();
    }
	  }, [getGroupProfileExpiresAt, loadPlanSnapshot, planSnapshot, planSnapshotLoading, selectedGroupRecord]);

	  const requestProfileUnlimitedPayment = useCallback(async (group = selectedGroupRecord) => {
	    if (!group) return;
	    setGroupPlanRequiredOpen(false);
    setToolsCanvasOpen(false);
    openGroupPlanPicker(
      group,
      isProfileLicenseActive(getGroupProfileExpiresAt(group)) ? "renewal" : "activation",
      "profile",
    );
  }, [getGroupProfileExpiresAt, openGroupPlanPicker, selectedGroupRecord]);

  const requireSelectedGroupPremium = useCallback(() => {
    if (!selectedGroupRecord) return false;
    if (selectedGroupHasPremium) return true;
    setGroupPlanRequiredOpen(true);
    setToolsCanvasOpen(false);
    return false;
  }, [selectedGroupHasPremium, selectedGroupRecord]);

  const selectGroupPlan = useCallback((plan: UserPlanSummary) => {
    if (!groupPlanPicker) return;
    setGroupPaymentPicker({ ...groupPlanPicker, plan });
    setGroupPlanPicker(null);
    setGroupPlanError(null);
    if (!planSnapshot && !planSnapshotLoading) {
      void loadPlanSnapshot();
    }
  }, [groupPlanPicker, loadPlanSnapshot, planSnapshot, planSnapshotLoading]);

  const createGroupPlanCheckout = useCallback(async (provider: PaymentMethodSummary["provider"]) => {
    if (!groupPaymentPicker) return;
    setGroupPlanBusy(provider);
    setGroupPlanError(null);
    try {
      const response = await fetch(apiPath("/api/user/plan/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: groupPaymentPicker.plan.id,
          provider,
          addons: [],
	          context: {
	            mode: groupPaymentPicker.scope === "profile"
	              ? "profile_unlimited"
	              : groupPaymentPicker.mode === "renewal"
	              ? "group_renewal"
              : "group_activation",
            ...(groupPaymentPicker.scope === "group" ? { groupId: groupPaymentPicker.group.id, activateGroupOnApproval: true } : {}),
            instanceId: groupPaymentPicker.group.instanceId,
          },
        }),
      });
      const payload = await readJson<{ checkout: PlanCheckoutResponse }>(response);
      if (!payload.checkout) {
        throw new Error("Resposta inesperada ao gerar pagamento.");
      }
      setGroupCheckout({ ...groupPaymentPicker, checkout: payload.checkout });
      setGroupPaymentPicker(null);
    } catch (requestError) {
      setGroupPlanError(requestError instanceof Error ? requestError.message : "Não foi possível gerar o pagamento.");
    } finally {
      setGroupPlanBusy(null);
    }
  }, [groupPaymentPicker]);

	  const toggleSelectedGroupStatusQuick = useCallback(async () => {
	    if (!selectedGroupRecord) return;
	    const nextActive = selectedGroupRecord.status !== "active";
	    if (nextActive && !selectedGroupHasPremium) {
	      openGroupPlanPicker(selectedGroupRecord, "activation", "profile");
	      setToolsCanvasOpen(false);
	      return;
	    }
    if (!onToggleGroupActive) {
      await patchSelectedGroup({ status: nextActive ? "active" : "disabled" }, "quickStatus");
      return;
    }
    setSavingGroupControl("quickStatus");
    setGroupControlsError(null);
    try {
      await onToggleGroupActive(selectedGroupRecord.id, nextActive);
      await loadGroupControls(selectedGroupRecord.id);
    } catch (requestError) {
      setGroupControlsError(requestError instanceof Error ? requestError.message : "Não foi possível atualizar o robô no grupo.");
    } finally {
      setSavingGroupControl(null);
    }
  }, [loadGroupControls, onToggleGroupActive, openGroupPlanPicker, patchSelectedGroup, selectedGroupHasPremium, selectedGroupRecord]);

  const resumeGroupBot = useCallback(async (group: BotGroupSummary) => {
    let updatedGroup: BotGroupSummary | null = null;
    if (onToggleGroupActive) {
      await onToggleGroupActive(group.id, true);
    } else {
      const payload = await fetch(apiPath(`/api/bot-groups/${group.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }).then((response) => readJson<{ group?: BotGroupSummary }>(response));
      updatedGroup = payload.group ?? { ...group, status: "active" };
      upsertGroupRecord(updatedGroup);
    }

    const refreshedGroups = await loadGroupRecords().catch(() => []);
    updatedGroup = refreshedGroups.find((entry) => entry.id === group.id) ?? updatedGroup;
    if (updatedGroup) {
      upsertGroupRecord(updatedGroup);
      if (selectedGroupRecord?.id === group.id) {
        setSelectedGroupRecord(updatedGroup);
      }
    }
    if (selectedLinkedGroupId === group.id) {
      await loadGroupControls(group.id).catch(() => undefined);
    }
  }, [
    loadGroupControls,
    loadGroupRecords,
    onToggleGroupActive,
    selectedGroupRecord?.id,
    selectedLinkedGroupId,
    upsertGroupRecord,
  ]);

  const handleThreadGroupPlanAction = useCallback(async (thread: ThreadSummary) => {
    const actionKey = getThreadSelectionKey(thread);
    setError(null);
    if (isThreadLinkedToOtherUser(thread)) {
      setError("Grupo já vinculado a outro usuário.");
      return;
    }
    setThreadGroupActionBusyKey(actionKey);
    try {
      let group = getThreadGroupRecord(thread);
      if (!group) {
        group = await linkGroupFromThread(thread);
      }
      if (!group) {
        throw new Error("Não foi possível vincular este grupo ao BotAdmin.");
      }

      if (group.status !== "active" && hasPausedResumeAccess(group)) {
        await resumeGroupBot(group);
        return;
      }

	      openGroupPlanPicker(
	        group,
	        hasIndividualGroupLicenseRecord(group) || isProfileLicenseActive(getGroupProfileExpiresAt(group))
	          ? "renewal"
	          : "activation",
	        "profile",
	      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível abrir a ativação deste grupo.");
    } finally {
      setThreadGroupActionBusyKey(null);
    }
  }, [getGroupProfileExpiresAt, getThreadGroupRecord, isThreadLinkedToOtherUser, linkGroupFromThread, openGroupPlanPicker, resumeGroupBot]);

	  const openSelectedProfileRenewal = useCallback(async () => {
	    if (!selectedGroupRecord) return;
	    await requestProfileUnlimitedPayment(selectedGroupRecord);
	  }, [requestProfileUnlimitedPayment, selectedGroupRecord]);

  const openSelectedGroupScheduleConfig = useCallback(() => {
    if (!selectedLinkedGroupId) return;
    setToolsCanvasOpen(false);
    setActivationsModalOpen(true);
    setActivationEditorField("schedule");
    setActivationConfigTarget("schedule");
    setGroupSettingsFeedback(null);
    if (!selectedGroupSettings || selectedGroupRecord?.id !== selectedLinkedGroupId) {
      setSelectedGroupSettings(null);
      void loadGroupControls(selectedLinkedGroupId);
    }
  }, [loadGroupControls, selectedGroupRecord?.id, selectedGroupSettings, selectedLinkedGroupId]);

  const loadGroupAds = useCallback(async (group = selectedGroupRecord) => {
    if (!group) return;
    setGroupAdsLoading(true);
    setGroupAdsError(null);
    try {
      const payload = await fetch(apiPath(`/api/bot-groups/${group.id}/ads`), {
        cache: "no-store",
      }).then((response) => readJson<{ ads: BotGroupAdSummary[] }>(response));
      setGroupAds(Array.isArray(payload.ads) ? payload.ads : []);
    } catch (requestError) {
      setGroupAdsError(requestError instanceof Error ? requestError.message : "Não foi possível carregar os ADS do grupo.");
    } finally {
      setGroupAdsLoading(false);
    }
  }, [selectedGroupRecord]);

  const openGroupAdsModal = useCallback(() => {
    if (!selectedGroupRecord) return;
    setToolsCanvasOpen(false);
    setGroupAdsOpen(true);
    setGroupAdsFeedback(null);
    setGroupAdsError(null);
    setGroupAdEditor(null);
    void loadGroupAds(selectedGroupRecord);
  }, [loadGroupAds, selectedGroupRecord]);

  const openGroupAdEditor = useCallback((ad?: BotGroupAdSummary) => {
    const target = ad ?? {
      id: "",
      enabled: true,
      caption: "",
      mentionAll: false,
      scheduleType: "frequency" as const,
      frequency: "6h",
      times: [],
    };
    setGroupAdEditor(target);
    setGroupAdCaptionDraft(target.caption || "");
    setGroupAdEnabledDraft(target.enabled !== false);
    setGroupAdMentionAllDraft(Boolean(target.mentionAll));
    setGroupAdScheduleTypeDraft(target.scheduleType === "times" ? "times" : "frequency");
    setGroupAdFrequencyDraft(target.frequency || "6h");
    setGroupAdTimesDraft(Array.isArray(target.times) ? target.times.join(", ") : "");
  }, []);

  const saveGroupAd = useCallback(async () => {
    if (!selectedGroupRecord || !groupAdEditor) return;
    const caption = groupAdCaptionDraft.trim();
    if (!caption) {
      setGroupAdsError("Informe a mensagem do ADS.");
      return;
    }
    const isNew = !groupAdEditor.id;
    setGroupAdsBusy(isNew ? "new" : groupAdEditor.id);
    setGroupAdsError(null);
    setGroupAdsFeedback(null);
    try {
      const payloadBody = {
        enabled: groupAdEnabledDraft,
        caption,
        mentionAll: groupAdMentionAllDraft,
        scheduleType: groupAdScheduleTypeDraft,
        frequency: groupAdFrequencyDraft.trim() || "6h",
        times: groupAdTimesDraft
          .split(/[,\n;]/g)
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
      const response = await fetch(
        apiPath(isNew ? `/api/bot-groups/${selectedGroupRecord.id}/ads` : `/api/bot-groups/${selectedGroupRecord.id}/ads/${groupAdEditor.id}`),
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBody),
        },
      );
      const payload = await readJson<{ ads: BotGroupAdSummary[] }>(response);
      setGroupAds(Array.isArray(payload.ads) ? payload.ads : []);
      setGroupAdsFeedback("ADS salvo para este grupo.");
      setGroupAdEditor(null);
    } catch (requestError) {
      setGroupAdsError(requestError instanceof Error ? requestError.message : "Não foi possível salvar o ADS.");
    } finally {
      setGroupAdsBusy(null);
    }
  }, [
    groupAdCaptionDraft,
    groupAdEditor,
    groupAdEnabledDraft,
    groupAdFrequencyDraft,
    groupAdMentionAllDraft,
    groupAdScheduleTypeDraft,
    groupAdTimesDraft,
    selectedGroupRecord,
  ]);

  const deleteGroupAd = useCallback(async (ad: BotGroupAdSummary) => {
    if (!selectedGroupRecord || !ad.id) return;
    setGroupAdsBusy(ad.id);
    setGroupAdsError(null);
    setGroupAdsFeedback(null);
    try {
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/ads/${ad.id}`), {
        method: "DELETE",
      }).then((response) => readJson<{ ads: BotGroupAdSummary[] }>(response));
      setGroupAds(Array.isArray(payload.ads) ? payload.ads : []);
      setGroupAdsFeedback("ADS removido.");
      if (groupAdEditor?.id === ad.id) {
        setGroupAdEditor(null);
      }
    } catch (requestError) {
      setGroupAdsError(requestError instanceof Error ? requestError.message : "Não foi possível apagar o ADS.");
    } finally {
      setGroupAdsBusy(null);
    }
  }, [groupAdEditor?.id, selectedGroupRecord]);

  const toggleGroupAd = useCallback(async (ad: BotGroupAdSummary) => {
    if (!selectedGroupRecord || !ad.id) return;
    setGroupAdsBusy(ad.id);
    setGroupAdsError(null);
    setGroupAdsFeedback(null);
    try {
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/ads/${ad.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: ad.enabled === false }),
      }).then((response) => readJson<{ ads: BotGroupAdSummary[] }>(response));
      setGroupAds(Array.isArray(payload.ads) ? payload.ads : []);
      setGroupAdsFeedback(ad.enabled === false ? "ADS ativado." : "ADS pausado.");
    } catch (requestError) {
      setGroupAdsError(requestError instanceof Error ? requestError.message : "Não foi possível atualizar o ADS.");
    } finally {
      setGroupAdsBusy(null);
    }
  }, [selectedGroupRecord]);

  const openActivationsModal = useCallback(() => {
    setToolsCanvasOpen(false);
    setActivationsModalOpen(true);
    setActivationConfigTarget(null);
    setGroupSettingsFeedback(null);
    if (selectedLinkedGroupId) {
      void loadGroupControls(selectedLinkedGroupId);
    }
  }, [loadGroupControls, selectedLinkedGroupId]);

  const closeActivationsModal = useCallback(() => {
    setActivationsModalOpen(false);
    setActivationConfigTarget(null);
    setActivationEditorField(null);
  }, []);

  const openActivationConfig = useCallback((target: ActivationConfigTarget) => {
    setActivationConfigTarget(target);
    setActivationEditorField(null);
    setGroupSettingsFeedback(null);
  }, []);

  const toggleActivationSetting = useCallback(async (key: string) => {
    if (!selectedGroupSettings) return;
    const enabled = Boolean(selectedGroupSettings.commandToggles?.[key]);
    if (!enabled && !requireSelectedGroupPremium()) return;
    const saved = await patchSelectedGroupSettings(buildActivationSettingsPatch(key, !enabled), `activation-${key}`);
    if (saved) {
      setGroupSettingsFeedback(`${enabled ? "Desativado" : "Ativado"}: ${key}`);
    }
  }, [buildActivationSettingsPatch, patchSelectedGroupSettings, requireSelectedGroupPremium, selectedGroupSettings]);

  const toggleAntiInactivityActivation = useCallback(async () => {
    if (!selectedGroupSettings) return;
    const enabled = Boolean(selectedGroupSettings.antiInactivityConfig?.enabled);
    if (!enabled && !requireSelectedGroupPremium()) return;
    const saved = await patchSelectedGroupSettings({
      antiInactivityConfig: {
        ...(selectedGroupSettings.antiInactivityConfig ?? {}),
        enabled: !enabled,
      },
    }, "antiInactivityEnabled");
    if (saved) {
      setGroupSettingsFeedback(`${enabled ? "Desativado" : "Ativado"}: anti-inatividade`);
    }
  }, [patchSelectedGroupSettings, requireSelectedGroupPremium, selectedGroupSettings]);

  const saveWelcomeSettings = useCallback(async () => {
    if (!selectedGroupSettings) return;
    if (welcomeEnabledDraft && !requireSelectedGroupPremium()) return;
    const mediaUrl = welcomeMediaUrlDraft.trim();
    const saved = await patchSelectedGroupSettings({
      welcomeConfig: {
        ...(selectedGroupSettings.welcomeConfig ?? {}),
        enabled: welcomeEnabledDraft,
        caption: welcomeCaptionDraft,
        mediaUrl: mediaUrl || null,
        mediaPath: mediaUrl ? null : selectedGroupSettings.welcomeConfig?.mediaPath ?? null,
        useParticipantProfilePhoto: welcomeUseParticipantProfilePhotoDraft,
        asSticker: welcomeAsStickerDraft,
      },
      commandToggles: {
        ...(selectedGroupSettings.commandToggles ?? {}),
        bemvindo: welcomeEnabledDraft,
      },
    }, "welcome");
    if (saved) {
      setGroupSettingsFeedback("Boas-vindas atualizadas.");
    }
  }, [
    patchSelectedGroupSettings,
    requireSelectedGroupPremium,
    selectedGroupSettings,
    welcomeAsStickerDraft,
    welcomeCaptionDraft,
    welcomeEnabledDraft,
    welcomeMediaUrlDraft,
    welcomeUseParticipantProfilePhotoDraft,
  ]);

  const uploadWelcomeMedia = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroupRecord) return;
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;

    setSavingGroupControl("welcomeMedia");
    setGroupControlsError(null);
    try {
      const formData = new FormData();
      formData.set("media", file);
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/welcome-media`), {
        method: "POST",
        body: formData,
      }).then((response) => readJson<{ settings: GroupSettingsSummary }>(response));
      setSelectedGroupSettings(payload.settings);
      syncGroupSettingsDrafts(payload.settings);
      setGroupSettingsFeedback("Mídia de boas-vindas atualizada.");
    } catch (requestError) {
      setGroupControlsError(requestError instanceof Error ? requestError.message : "Não foi possível enviar a mídia.");
    } finally {
      setSavingGroupControl(null);
    }
  }, [selectedGroupRecord, syncGroupSettingsDrafts]);

  const clearWelcomeMedia = useCallback(async () => {
    if (!selectedGroupSettings) return;
    setWelcomeMediaUrlDraft("");
    const saved = await patchSelectedGroupSettings({
      welcomeConfig: {
        ...(selectedGroupSettings.welcomeConfig ?? {}),
        mediaUrl: null,
        mediaPath: null,
      },
    }, "welcomeMediaClear");
    if (saved) {
      setGroupSettingsFeedback("Mídia de boas-vindas removida.");
    }
  }, [patchSelectedGroupSettings, selectedGroupSettings]);

  const saveFarewellSettings = useCallback(async () => {
    if (!selectedGroupSettings) return;
    if (farewellEnabledDraft && !requireSelectedGroupPremium()) return;
    const mediaUrl = farewellMediaUrlDraft.trim();
    const saved = await patchSelectedGroupSettings({
      farewellConfig: {
        ...(selectedGroupSettings.farewellConfig ?? {}),
        enabled: farewellEnabledDraft,
        caption: farewellCaptionDraft,
        mediaUrl: mediaUrl || null,
        mediaPath: mediaUrl ? null : selectedGroupSettings.farewellConfig?.mediaPath ?? null,
        useParticipantProfilePhoto: farewellUseParticipantProfilePhotoDraft,
        asSticker: farewellAsStickerDraft,
      },
      commandToggles: {
        ...(selectedGroupSettings.commandToggles ?? {}),
        despedida: farewellEnabledDraft,
      },
    }, "farewell");
    if (saved) {
      setGroupSettingsFeedback("Mensagem de saída atualizada.");
    }
  }, [
    farewellAsStickerDraft,
    farewellCaptionDraft,
    farewellEnabledDraft,
    farewellMediaUrlDraft,
    farewellUseParticipantProfilePhotoDraft,
    patchSelectedGroupSettings,
    requireSelectedGroupPremium,
    selectedGroupSettings,
  ]);

  const uploadFarewellMedia = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroupRecord) return;
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;

    setSavingGroupControl("farewellMedia");
    setGroupControlsError(null);
    try {
      const formData = new FormData();
      formData.set("media", file);
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/farewell-media`), {
        method: "POST",
        body: formData,
      }).then((response) => readJson<{ settings: GroupSettingsSummary }>(response));
      setSelectedGroupSettings(payload.settings);
      syncGroupSettingsDrafts(payload.settings);
      setGroupSettingsFeedback("Mídia de saída atualizada.");
    } catch (requestError) {
      setGroupControlsError(requestError instanceof Error ? requestError.message : "Não foi possível enviar a mídia.");
    } finally {
      setSavingGroupControl(null);
    }
  }, [selectedGroupRecord, syncGroupSettingsDrafts]);

  const clearFarewellMedia = useCallback(async () => {
    if (!selectedGroupSettings) return;
    setFarewellMediaUrlDraft("");
    const saved = await patchSelectedGroupSettings({
      farewellConfig: {
        ...(selectedGroupSettings.farewellConfig ?? {}),
        mediaUrl: null,
        mediaPath: null,
      },
    }, "farewellMediaClear");
    if (saved) {
      setGroupSettingsFeedback("Mídia de saída removida.");
    }
  }, [patchSelectedGroupSettings, selectedGroupSettings]);

  const saveBannedWordsSettings = useCallback(async () => {
    if (!selectedGroupSettings) return;
    const bannedWords = parseMultilineItems(bannedWordsDraft);
    const antipalavrasEnabled = Boolean(selectedGroupSettings.commandToggles?.antipalavras) || bannedWords.length > 0;
    if (antipalavrasEnabled && !requireSelectedGroupPremium()) return;
    const limit = Math.max(1, Math.min(20, Number.parseInt(antipalavrasLimitDraft, 10) || 5));
    const saved = await patchSelectedGroupSettings({
      bannedWords,
      antipalavrasMaxInfractions: limit,
      featureFlags: {
        ...(selectedGroupSettings.featureFlags ?? {}),
        antipalavras: antipalavrasEnabled,
      },
      commandToggles: {
        ...(selectedGroupSettings.commandToggles ?? {}),
        antipalavras: antipalavrasEnabled,
      },
    }, "bannedWords");
    if (saved) {
      setGroupSettingsFeedback("Anti-palavras atualizado.");
    }
  }, [antipalavrasLimitDraft, bannedWordsDraft, patchSelectedGroupSettings, requireSelectedGroupPremium, selectedGroupSettings]);

  const saveAntiInactivitySettings = useCallback(async () => {
    if (!selectedGroupSettings) return;
    if (antiInactivityEnabledDraft && !requireSelectedGroupPremium()) return;
    const days = Math.max(1, Math.min(365, Number.parseInt(antiInactivityDaysDraft, 10) || 30));
    const scanIntervalHours = Math.max(1, Math.min(168, Number.parseInt(antiInactivityScanDraft, 10) || 24));
    const removeLimit = Math.max(1, Math.min(100, Number.parseInt(antiInactivityRemoveLimitDraft, 10) || 20));
    const saved = await patchSelectedGroupSettings({
      antiInactivityConfig: {
        ...(selectedGroupSettings.antiInactivityConfig ?? {}),
        enabled: antiInactivityEnabledDraft,
        days,
        scanIntervalHours,
        removeLimit,
      },
    }, "antiInactivityAdvanced");
    if (saved) {
      setGroupSettingsFeedback("Anti-inatividade atualizado.");
    }
  }, [
    antiInactivityEnabledDraft,
    antiInactivityDaysDraft,
    antiInactivityRemoveLimitDraft,
    antiInactivityScanDraft,
    patchSelectedGroupSettings,
    requireSelectedGroupPremium,
    selectedGroupSettings,
  ]);

  const saveAntiFakeSettings = useCallback(async () => {
    if (!selectedGroupSettings) return;
    const saved = await patchSelectedGroupSettings({
      allowedDdis: parseMultilineItems(allowedDdisDraft),
      antifakeMessage: antifakeMessageDraft,
    }, "antiFake");
    if (saved) {
      setGroupSettingsFeedback("Anti-fake atualizado.");
    }
  }, [allowedDdisDraft, antifakeMessageDraft, patchSelectedGroupSettings, selectedGroupSettings]);

  const saveAllowedLinksSettings = useCallback(async () => {
    if (!selectedGroupSettings) return;
    const saved = await patchSelectedGroupSettings({
      allowedLinks: parseMultilineItems(allowedLinksDraft),
    }, "allowedLinks");
    if (saved) {
      setGroupSettingsFeedback("Links permitidos do antilink atualizados.");
    }
  }, [allowedLinksDraft, patchSelectedGroupSettings, selectedGroupSettings]);

  const saveScheduleSettings = useCallback(async () => {
    if (!selectedGroupSettings) return;
    if ((scheduleCloseEnabledDraft || scheduleOpenEnabledDraft) && !requireSelectedGroupPremium()) return;
    const closeTimes = parseScheduleTimesDraft(scheduleCloseTimesDraft);
    const openTimes = parseScheduleTimesDraft(scheduleOpenTimesDraft);
    if (scheduleCloseEnabledDraft && closeTimes.length === 0) {
      setGroupControlsError("Informe pelo menos um horário válido de fechamento no formato HH:MM.");
      return;
    }
    if (scheduleOpenEnabledDraft && openTimes.length === 0) {
      setGroupControlsError("Informe pelo menos um horário válido de abertura no formato HH:MM.");
      return;
    }
    const saved = await patchSelectedGroupSettings({
      scheduleConfig: {
        ...(selectedGroupSettings.scheduleConfig ?? {}),
        closeEnabled: scheduleCloseEnabledDraft,
        closeTimes,
        closeMessage: scheduleCloseMessageDraft.trim() || null,
        openEnabled: scheduleOpenEnabledDraft,
        openTimes,
        openMessage: scheduleOpenMessageDraft.trim() || null,
        timezone: scheduleTimezoneDraft.trim() || null,
      },
    }, "schedule");
    if (saved) {
      setGroupSettingsFeedback("Abertura e fechamento automáticos atualizados.");
    }
  }, [
    patchSelectedGroupSettings,
    requireSelectedGroupPremium,
    scheduleCloseEnabledDraft,
    scheduleCloseMessageDraft,
    scheduleCloseTimesDraft,
    scheduleOpenEnabledDraft,
    scheduleOpenMessageDraft,
    scheduleOpenTimesDraft,
    scheduleTimezoneDraft,
    selectedGroupSettings,
  ]);

  const saveActivationConfig = useCallback(async () => {
    if (activationConfigTarget === "welcome") {
      await saveWelcomeSettings();
      return;
    }
    if (activationConfigTarget === "farewell") {
      await saveFarewellSettings();
      return;
    }
    if (activationConfigTarget === "bannedWords") {
      await saveBannedWordsSettings();
      return;
    }
    if (activationConfigTarget === "allowedLinks") {
      await saveAllowedLinksSettings();
      return;
    }
    if (activationConfigTarget === "schedule") {
      await saveScheduleSettings();
      return;
    }
    if (activationConfigTarget === "antiInactivity") {
      await saveAntiInactivitySettings();
      return;
    }
    if (activationConfigTarget === "antiFake") {
      await saveAntiFakeSettings();
    }
  }, [
    activationConfigTarget,
    saveAllowedLinksSettings,
    saveAntiFakeSettings,
    saveAntiInactivitySettings,
    saveBannedWordsSettings,
    saveFarewellSettings,
    saveScheduleSettings,
    saveWelcomeSettings,
  ]);

  const openMessageActions = useCallback((message: ConversationMessage) => {
    setMessageActionTarget(message);
    setMessageActionError(null);
    setEmojiOpen(false);
    setShortcutsOpen(false);
    setToolsCanvasOpen(false);
  }, []);

  const persistPinnedChats = useCallback((next: Set<string>) => {
    if (!selectedInstanceId || typeof window === "undefined") return;
    window.localStorage.setItem(`${THREAD_PIN_STORAGE_PREFIX}.${selectedInstanceId}`, Array.from(next).join("\n"));
  }, [selectedInstanceId]);

  const clearThreadLongPressTimer = useCallback(() => {
    if (threadLongPressTimerRef.current !== null) {
      window.clearTimeout(threadLongPressTimerRef.current);
      threadLongPressTimerRef.current = null;
    }
  }, []);

  const clearParticipantLongPressTimer = useCallback(() => {
    if (participantLongPressTimerRef.current !== null) {
      window.clearTimeout(participantLongPressTimerRef.current);
      participantLongPressTimerRef.current = null;
    }
  }, []);

  const openThreadActions = useCallback((thread: ThreadSummary) => {
    clearThreadLongPressTimer();
    setThreadActionTarget(thread);
    setThreadActionError(null);
    setToolsCanvasOpen(false);
    setShortcutsOpen(false);
    setEmojiOpen(false);
  }, [clearThreadLongPressTimer]);

  const clearThreadSelection = useCallback(() => {
    setSelectedThreadKeys(new Set());
  }, []);

  const toggleThreadSelection = useCallback((thread: ThreadSummary) => {
    const key = getThreadSelectionKey(thread);
    setSelectedThreadKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectAllVisibleThreads = useCallback(() => {
    setSelectedThreadKeys(new Set(filteredThreads.map(getThreadSelectionKey)));
  }, [filteredThreads]);

  const runThreadRemoteAction = useCallback(async (
    thread: ThreadSummary,
    action: "archive" | "unarchive" | "pin" | "unpin" | "clear" | "delete",
  ) => {
    const response = await fetch(
      apiPath(`/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action }),
      },
    );
    await readJson<{ ok: boolean; action: string }>(response);
  }, []);

  const togglePinnedThread = useCallback(async () => {
    if (!threadActionTarget) return;
    if (threadActionTarget.sharedAccess || selectedInstanceId === SHARED_CONVERSATIONS_INSTANCE_ID) {
      setThreadActionError("Conversa compartilhada não pode alterar fixação no WhatsApp do dono.");
      return;
    }
    const nextPinned = !pinnedChatJids.has(threadActionTarget.chatJid);
    setThreadActionSaving("pin");
    setThreadActionError(null);
    try {
      await runThreadRemoteAction(threadActionTarget, nextPinned ? "pin" : "unpin");
      setPinnedChatJids((current) => {
        const next = new Set(current);
        if (nextPinned) {
          next.add(threadActionTarget.chatJid);
        } else {
          next.delete(threadActionTarget.chatJid);
        }
        persistPinnedChats(next);
        return next;
      });
      setThreadActionTarget(null);
    } catch (requestError) {
      setThreadActionError(requestError instanceof Error ? requestError.message : "Não foi possível alterar a fixação.");
    } finally {
      setThreadActionSaving(null);
    }
  }, [persistPinnedChats, pinnedChatJids, runThreadRemoteAction, selectedInstanceId, threadActionTarget]);

  const toggleArchivedThread = useCallback(async () => {
    if (!threadActionTarget) return;
    if (threadActionTarget.sharedAccess || selectedInstanceId === SHARED_CONVERSATIONS_INSTANCE_ID) {
      setThreadActionError("Conversa compartilhada não pode alterar arquivamento no WhatsApp do dono.");
      return;
    }
    const nextArchived = !threadActionTarget.archived;
    setThreadActionSaving("archive");
    setThreadActionError(null);
    try {
      await runThreadRemoteAction(threadActionTarget, nextArchived ? "archive" : "unarchive");
      setThreads((current) =>
        current.map((thread) =>
          thread.instanceId === threadActionTarget.instanceId && thread.chatJid === threadActionTarget.chatJid
            ? { ...thread, archived: nextArchived }
            : thread,
        ),
      );
      setThreadActionTarget(null);
    } catch (requestError) {
      setThreadActionError(requestError instanceof Error ? requestError.message : "Não foi possível alterar o arquivamento.");
    } finally {
      setThreadActionSaving(null);
    }
  }, [runThreadRemoteAction, selectedInstanceId, threadActionTarget]);

  const toggleThreadMuted = useCallback(async () => {
    if (!threadActionTarget || !selectedInstanceId) return;
    if (threadActionTarget.sharedAccess || selectedInstanceId === SHARED_CONVERSATIONS_INSTANCE_ID) {
      setThreadActionError("Conversa compartilhada não pode alterar notificações do dono.");
      return;
    }
    const nextMuted = !threadActionTarget.muted;
    setThreadActionSaving("mute");
    setThreadActionError(null);
    try {
      const response = await fetch(
        apiPath(`/api/bot-instances/${threadActionTarget.instanceId}/whatsapp-conversations/${encodeURIComponent(threadActionTarget.chatJid)}/notifications`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ muted: nextMuted }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Não foi possível alterar as notificações.");
      }
      setThreads((current) =>
        current.map((thread) =>
          thread.instanceId === threadActionTarget.instanceId && thread.chatJid === threadActionTarget.chatJid
            ? { ...thread, muted: nextMuted }
            : thread,
        ),
      );
      setThreadActionTarget((current) =>
        current ? { ...current, muted: nextMuted } : current,
      );
    } catch (requestError) {
      setThreadActionError(requestError instanceof Error ? requestError.message : "Não foi possível alterar as notificações.");
    } finally {
      setThreadActionSaving(null);
    }
  }, [selectedInstanceId, threadActionTarget]);

  const deleteThreadFromHistory = useCallback(async () => {
    if (!threadActionTarget || !selectedInstanceId) return;
    if (threadActionTarget.sharedAccess || selectedInstanceId === SHARED_CONVERSATIONS_INSTANCE_ID) {
      setThreadActionError("Conversa compartilhada não pode apagar o histórico do dono.");
      return;
    }
    setThreadActionSaving("delete");
    setThreadActionError(null);
    try {
      const clearOnly = resolveThreadChatType(threadActionTarget) === "group";
      const threadInstance = instances.find((instance) => instance.id === threadActionTarget.instanceId);
      const instanceConnected = threadInstance?.sessionStatus === "conectado";
      if (instanceConnected) {
        await fetch(
          apiPath(`/api/bot-instances/${threadActionTarget.instanceId}/whatsapp-conversations/${encodeURIComponent(threadActionTarget.chatJid)}`),
          { method: "DELETE" },
        ).then((response) => readJson<{ ok: boolean; action?: string }>(response));
      } else {
        setError("WhatsApp desconectado: a conversa foi limpa somente do painel/cache. Reconecte o perfil para apagar tambem no WhatsApp.");
      }
      setThreads((current) =>
        clearOnly
          ? current.map((thread) =>
              thread.chatJid === threadActionTarget.chatJid
                ? { ...thread, lastMessagePreview: "", lastMessageAt: null, unreadCount: 0 }
                : thread,
            )
          : current.filter((thread) => thread.chatJid !== threadActionTarget.chatJid),
      );
      setPinnedChatJids((current) => {
        const next = new Set(current);
        if (!clearOnly) next.delete(threadActionTarget.chatJid);
        persistPinnedChats(next);
        return next;
      });
      if (selectedChatJid === threadActionTarget.chatJid) {
        setMessages([]);
        setMessageHistoryHasMore(false);
        setMessageHistoryOldestCursor(null);
        if (!clearOnly) {
          setSelectedChatJid(null);
          setMobileChatOpenState(false);
        }
      }
      setThreadActionTarget(null);
    } catch (requestError) {
      setThreadActionError(requestError instanceof Error ? requestError.message : "Não foi possível apagar a conversa.");
    } finally {
      setThreadActionSaving(null);
    }
  }, [instances, persistPinnedChats, selectedChatJid, selectedInstanceId, setMobileChatOpenState, threadActionTarget]);

  const deleteSelectedThreads = useCallback(async () => {
    const selectedKeys = selectedThreadKeys;
    const selectedThreads = threads.filter((thread) => selectedKeys.has(getThreadSelectionKey(thread)) && !thread.sharedAccess);
    if (selectedThreads.length === 0) {
      clearThreadSelection();
      return;
    }
    const confirmation =
      typeof window === "undefined" ||
      window.confirm(`Apagar ou limpar ${selectedThreads.length} conversa(s) selecionada(s)?`);
    if (!confirmation) return;

    setThreadActionSaving("delete");
    setError(null);
    let panelOnlyCount = 0;
    let failureCount = 0;

    for (const thread of selectedThreads) {
      const threadInstance = instances.find((instance) => instance.id === thread.instanceId);
      const instanceConnected = threadInstance?.sessionStatus === "conectado";
      try {
        if (instanceConnected) {
          await fetch(
            apiPath(`/api/bot-instances/${thread.instanceId}/whatsapp-conversations/${encodeURIComponent(thread.chatJid)}`),
            { method: "DELETE" },
          ).then((response) => readJson<{ ok: boolean; action?: string }>(response));
        } else {
          panelOnlyCount += 1;
        }
      } catch (requestError) {
        failureCount += 1;
        console.error("Failed to delete selected thread", requestError);
      }
    }

    const selectedKeySet = new Set(selectedThreads.map(getThreadSelectionKey));
    setThreads((current) =>
      current.flatMap((thread) => {
        if (!selectedKeySet.has(getThreadSelectionKey(thread))) return [thread];
        if (resolveThreadChatType(thread) === "group") {
          return [{ ...thread, lastMessagePreview: "", lastMessageAt: null, unreadCount: 0 }];
        }
        return [];
      }),
    );
    setPinnedChatJids((current) => {
      const next = new Set(current);
      selectedThreads.forEach((thread) => {
        if (resolveThreadChatType(thread) !== "group") next.delete(thread.chatJid);
      });
      persistPinnedChats(next);
      return next;
    });
    if (selectedChatJid && selectedThreads.some((thread) => thread.chatJid === selectedChatJid && resolveThreadChatType(thread) !== "group")) {
      setMessages([]);
      setMessageHistoryHasMore(false);
      setMessageHistoryOldestCursor(null);
      setSelectedChatJid(null);
      setMobileChatOpenState(false);
    }
    clearThreadSelection();
    setThreadActionSaving(null);

    if (panelOnlyCount > 0 || failureCount > 0) {
      const notices: string[] = [];
      if (panelOnlyCount > 0) {
        notices.push(`${panelOnlyCount} conversa(s) foram limpas somente do painel/cache porque o WhatsApp estava desconectado.`);
      }
      if (failureCount > 0) {
        notices.push(`${failureCount} conversa(s) falharam ao apagar no WhatsApp e foram removidas da lista local.`);
      }
      setError(notices.join(" "));
    }
  }, [clearThreadSelection, instances, persistPinnedChats, selectedChatJid, selectedThreadKeys, setMobileChatOpenState, threads]);

  const openThreadActionGroupEditor = useCallback(() => {
    if (!threadActionTarget || !canEditThreadActionGroup) return;
    setSelectedChatJid(threadActionTarget.chatJid);
    setMobileChatOpenState(true);
    setPendingGroupEditorChatJid(threadActionTarget.chatJid);
    setThreadActionTarget(null);
  }, [canEditThreadActionGroup, setMobileChatOpenState, threadActionTarget]);

  const buildParticipantTargetFromMessage = useCallback((message: ConversationMessage | null): ParticipantActionTarget | null => {
    if (!message || selectedChatType !== "group" || message.direction !== "inbound") return null;
    const senderJid = message.senderJid?.trim();
    if (!senderJid) return null;
    const participant =
      selectedGroupParticipants.find((entry) => participantMatches(entry, senderJid)) ?? {
        id: senderJid,
        admin: "member" as const,
        name: message.senderName,
        displayName: message.senderName,
        avatarUrl: message.senderAvatarUrl,
        imageUrl: message.senderAvatarUrl,
      };
    return { participant, message, origin: "message" };
  }, [selectedChatType, selectedGroupParticipants]);

  const openParticipantActions = useCallback((
    participant: BotGroupParticipantSummary,
    origin: ParticipantActionTarget["origin"] = "participant",
    message: ConversationMessage | null = null,
  ) => {
    clearParticipantLongPressTimer();
    setParticipantActionTarget({ participant, origin, message });
    setParticipantActionError(null);
    setToolsCanvasOpen(false);
    setShortcutsOpen(false);
    setEmojiOpen(false);
  }, [clearParticipantLongPressTimer]);

  const openBanConfirm = useCallback((target: ParticipantActionTarget) => {
    setBanConfirmTarget(target);
    setBanDeleteRecentMessages(Boolean(target.message));
    setBanAddToBlacklist(false);
    setParticipantActionError(null);
    setMessageActionError(null);
  }, []);

  const closeBanConfirm = useCallback(() => {
    setBanConfirmTarget(null);
    setBanDeleteRecentMessages(false);
    setBanAddToBlacklist(false);
  }, []);

  const runParticipantAction = useCallback(async (
    target: ParticipantActionTarget,
    action: "add" | "promote" | "demote" | "remove" | "resetInfractions",
    options: { deleteRecentMessages?: boolean; addToBlacklist?: boolean } = {},
  ) => {
    if (!selectedGroupRecord) return;
    const savingKey = `${action}:${target.participant.id}`;
    setParticipantActionSaving(savingKey);
    if (target.origin === "message") {
      setMessageActionSaving(savingKey);
      setMessageActionError(null);
    } else {
      setParticipantActionError(null);
    }
    setGroupControlsError(null);

    try {
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/participants/actions`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          participantJid: target.participant.id,
          deleteRecentMessages: Boolean(options.deleteRecentMessages),
          addToBlacklist: Boolean(options.addToBlacklist),
        }),
      }).then((response) => readJson<{ group?: BotGroupSummary; participants?: BotGroupParticipantSummary[] }>(response));

      if (payload.group) {
        setSelectedGroupRecord({
          ...payload.group,
          participants: payload.participants ?? payload.group.participants ?? [],
          participantCount: payload.participants?.length ?? payload.group.participantCount,
        });
      } else {
        await loadGroupControls(selectedGroupRecord.id);
      }

      if (action === "remove" && options.deleteRecentMessages && selectedThreadInstanceId && selectedChatJid) {
        await loadMessages(selectedThreadInstanceId, selectedChatJid, { silent: true });
      }

      setParticipantActionTarget(null);
      setMessageActionTarget(null);
      closeBanConfirm();
      setParticipantAddOpen(false);
      setParticipantAddDraft("");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Não foi possível executar a ação no participante.";
      if (target.origin === "message") {
        setMessageActionError(message);
      } else {
        setParticipantActionError(message);
      }
    } finally {
      setParticipantActionSaving(null);
      setMessageActionSaving(null);
    }
  }, [closeBanConfirm, loadGroupControls, loadMessages, selectedChatJid, selectedGroupRecord, selectedThreadInstanceId]);

  const submitAddParticipant = useCallback(async () => {
    const participantJid = participantAddDraft.trim();
    if (!participantJid) {
      setParticipantActionError("Informe o número do participante.");
      return;
    }
    await runParticipantAction(
      {
        participant: {
          id: participantJid,
          admin: "member",
          phone: participantJid,
        },
        message: null,
        origin: "participant",
      },
      "add",
    );
  }, [participantAddDraft, runParticipantAction]);

  const copyMessageText = useCallback(async () => {
    if (!messageActionTarget) return;
    const text = getMessageCopyText(messageActionTarget).trim();
    if (!text) {
      setMessageActionError("Essa mensagem não tem texto para copiar.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setMessageActionTarget(null);
      setMessageActionError(null);
    } catch {
      setMessageActionError("Não foi possível copiar pelo navegador.");
    }
  }, [messageActionTarget]);

  const getDeletedRevealKey = useCallback((message: ConversationMessage) => message.messageId || String(message.id), []);

  const toggleDeletedMessageReveal = useCallback(() => {
    if (!messageActionTarget?.deletedAt || messageActionTarget.revealDeletedContent !== true) return;
    const revealKey = getDeletedRevealKey(messageActionTarget);
    setRevealedDeletedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(revealKey)) {
        next.delete(revealKey);
      } else {
        next.add(revealKey);
      }
      return next;
    });
    setMessageActionTarget(null);
    setMessageActionError(null);
  }, [getDeletedRevealKey, messageActionTarget]);

  const runMessageAction = useCallback(async (action: "delete" | "pin" | "react" | "reply", emoji?: string) => {
    if (!messageActionTarget || !selectedThreadInstanceId || !selectedChatJid) return;
    if (action === "reply") {
      setReplyTarget(messageActionTarget);
      setMessageActionTarget(null);
      window.setTimeout(() => composerInputRef.current?.focus(), 80);
      return;
    }

    const savingKey = action === "react" ? `react-${emoji ?? "👍"}` : action;
    setMessageActionSaving(savingKey);
    setMessageActionError(null);
    try {
      await fetch(
        apiPath(
          `/api/bot-instances/${selectedThreadInstanceId}/whatsapp-conversations/${encodeURIComponent(selectedChatJid)}/messages/${encodeURIComponent(messageActionTarget.messageId ?? String(messageActionTarget.id))}/actions`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            emoji,
            participant: messageActionTarget.senderJid,
          }),
        },
      ).then((response) => readJson<{ ok: boolean }>(response));

      if (action === "delete") {
        setMessages((current) => current.filter((message) => message.id !== messageActionTarget.id));
      }
      setMessageActionTarget(null);
    } catch (requestError) {
      setMessageActionError(requestError instanceof Error ? requestError.message : "Não foi possível executar a ação.");
    } finally {
      setMessageActionSaving(null);
    }
  }, [messageActionTarget, selectedChatJid, selectedThreadInstanceId]);

  const messageParticipantActionTarget = useMemo(
    () => buildParticipantTargetFromMessage(messageActionTarget),
    [buildParticipantTargetFromMessage, messageActionTarget],
  );

  const syncGroupEditorDrafts = useCallback(() => {
    setGroupNameDraft(selectedGroupRecord?.name || (selectedThread ? getThreadTitle(selectedThread, selectedInstance) : ""));
    setGroupDescriptionDraft(selectedGroupRecord?.description ?? selectedThread?.groupDescription ?? "");
    setGroupAdminsOnlyDraft(Boolean(selectedGroupRecord?.metadata?.adminsOnly ?? selectedThread?.announceOnly));
    setGroupLockedDraft(Boolean(selectedGroupRecord?.metadata?.locked));
    setGroupEphemeralDraft(selectedGroupRecord?.metadata?.ephemeral ?? "");
    setGroupPhotoDraft(null);
    setGroupEditorError(null);
    setGroupSharesFeedback(null);
    setGroupSharesDraft(
      Array.isArray(selectedGroupRecord?.sharedWith)
        ? selectedGroupRecord.sharedWith.map((share) => share.email).filter(Boolean).join("\n")
        : "",
    );
  }, [selectedGroupRecord, selectedInstance, selectedThread]);

  const loadGroupShares = useCallback(async (groupId: number) => {
    setGroupSharesLoading(true);
    setGroupSharesFeedback(null);
    try {
      const payload = await fetch(apiPath(`/api/bot-groups/${groupId}/shares`), { cache: "no-store" })
        .then((response) => readJson<{ shares: BotGroupShareSummary[] }>(response));
      const emails = (payload.shares ?? []).map((share) => share.email).filter(Boolean).join("\n");
      setGroupSharesDraft(emails);
      setSelectedGroupRecord((current) =>
        current && current.id === groupId
          ? { ...current, sharedWith: payload.shares ?? [] }
          : current,
      );
    } catch (requestError) {
      setGroupSharesFeedback(requestError instanceof Error ? requestError.message : "Não foi possível carregar compartilhamentos.");
    } finally {
      setGroupSharesLoading(false);
    }
  }, []);

  const loadConversationShares = useCallback(async () => {
    if (!selectedThread || !selectedThreadInstanceId || !canManageSelectedConversationShares) return;
    setConversationSharesLoading(true);
    setConversationSharesFeedback(null);
    try {
      const payload = await fetch(
        apiPath(`/api/bot-instances/${selectedThreadInstanceId}/whatsapp-conversations/${encodeURIComponent(selectedThread.chatJid)}/shares`),
        { cache: "no-store" },
      ).then((response) => readJson<{ shares: ConversationShareSummary[] }>(response));
      const emails = (payload.shares ?? []).map((share) => share.email).filter(Boolean).join("\n");
      setConversationSharesDraft(emails);
    } catch (requestError) {
      setConversationSharesFeedback(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar compartilhamentos da conversa.",
      );
    } finally {
      setConversationSharesLoading(false);
    }
  }, [canManageSelectedConversationShares, selectedThread, selectedThreadInstanceId]);

  const saveConversationShares = useCallback(async () => {
    if (!selectedThread || !selectedThreadInstanceId || !canManageSelectedConversationShares) return;
    setConversationSharesSaving(true);
    setConversationSharesFeedback(null);
    try {
      const payload = await fetch(
        apiPath(`/api/bot-instances/${selectedThreadInstanceId}/whatsapp-conversations/${encodeURIComponent(selectedThread.chatJid)}/shares`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emails: parseMultilineItems(conversationSharesDraft),
            title: getThreadTitle(selectedThread, selectedInstance),
            phone: selectedThread.phone,
            avatarUrl: selectedThread.avatarUrl,
          }),
        },
      ).then((response) => readJson<{
        shares: ConversationShareSummary[];
        notFound?: string[];
        skipped?: string[];
      }>(response));
      const emails = (payload.shares ?? []).map((share) => share.email).filter(Boolean).join("\n");
      setConversationSharesDraft(emails);
      const missingEmails = payload.notFound ?? [];
      setConversationSharesFeedback(
        missingEmails.length > 0
          ? `Emails não encontrados: ${missingEmails.join(", ")}`
          : "Compartilhamento salvo.",
      );
      void loadInstances();
    } catch (requestError) {
      setConversationSharesFeedback(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível salvar compartilhamento da conversa.",
      );
    } finally {
      setConversationSharesSaving(false);
    }
  }, [
    canManageSelectedConversationShares,
    conversationSharesDraft,
    loadInstances,
    selectedInstance,
    selectedThread,
    selectedThreadInstanceId,
  ]);

  const openGroupEditor = useCallback(() => {
    if (!canEditSelectedGroup) return;
    syncGroupEditorDrafts();
    if (selectedGroupRecord && canManageSelectedGroupShares) {
      void loadGroupShares(selectedGroupRecord.id);
    }
    setGroupEditorOpen(true);
  }, [canEditSelectedGroup, canManageSelectedGroupShares, loadGroupShares, selectedGroupRecord, syncGroupEditorDrafts]);

  const openChatProfile = useCallback(() => {
    if (!selectedThread) return;
    setConversationSharesFeedback(null);
    setConversationSharesDraft("");
    setProfileModal(buildThreadProfile(selectedThread, selectedInstance));
    if (canManageSelectedConversationShares) {
      void loadConversationShares();
    }
  }, [canManageSelectedConversationShares, loadConversationShares, selectedInstance, selectedThread]);

  const handleChatIdentityOpen = useCallback(() => {
    if (!selectedThread) return;
    if (selectedChatType === "group" && canEditSelectedGroup) {
      openGroupEditor();
      return;
    }
    openChatProfile();
  }, [canEditSelectedGroup, openChatProfile, openGroupEditor, selectedChatType, selectedThread]);

  const saveGroupEditor = useCallback(async () => {
    if (!selectedGroupRecord || !canEditSelectedGroup) return;
    setGroupEditorSaving(true);
    setGroupEditorError(null);
    try {
      let nextGroup: BotGroupSummary | null = null;
      let keepEditorOpen = false;
      const payload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupNameDraft.trim(),
          description: groupDescriptionDraft.trim() || null,
          adminsOnly: groupAdminsOnlyDraft,
          locked: groupLockedDraft,
          ephemeral: groupEphemeralDraft || "off",
        }),
      }).then((response) => readJson<{ group?: BotGroupSummary }>(response));
      nextGroup = payload.group ?? null;

      if (groupPhotoDraft) {
        const formData = new FormData();
        formData.set("photo", groupPhotoDraft);
        const photoPayload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/photo`), {
          method: "POST",
          body: formData,
        }).then((response) => readJson<{ group?: BotGroupSummary }>(response));
        nextGroup = photoPayload.group ?? nextGroup;
      }

      if (canManageSelectedGroupShares) {
        const sharePayload = await fetch(apiPath(`/api/bot-groups/${selectedGroupRecord.id}/shares`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: parseMultilineItems(groupSharesDraft) }),
        }).then((response) => readJson<{
          shares: BotGroupShareSummary[];
          notFound?: string[];
          skipped?: string[];
        }>(response));
        const shareEmails = (sharePayload.shares ?? []).map((share) => share.email).filter(Boolean).join("\n");
        setGroupSharesDraft(shareEmails);
        const missingEmails = sharePayload.notFound ?? [];
        keepEditorOpen = missingEmails.length > 0;
        setGroupSharesFeedback(
          missingEmails.length > 0
            ? `Emails não encontrados: ${missingEmails.join(", ")}`
            : null,
        );
        if (nextGroup) {
          nextGroup = { ...nextGroup, sharedWith: sharePayload.shares ?? [] };
        }
      }

      if (nextGroup) {
        upsertGroupRecord(nextGroup);
        setSelectedGroupRecord(nextGroup);
        setThreads((current) =>
          current.map((thread) =>
            thread.linkedGroupId === nextGroup!.id
              ? {
                  ...thread,
                  title: nextGroup!.name || thread.title,
                  groupDescription: nextGroup!.description ?? thread.groupDescription,
                  avatarUrl: nextGroup!.imageUrl ?? thread.avatarUrl,
                  announceOnly: nextGroup!.metadata?.adminsOnly ?? thread.announceOnly,
                }
              : thread,
          ),
        );
      }
      if (!keepEditorOpen) {
        setGroupEditorOpen(false);
      }
      if (selectedLinkedGroupId) {
        void loadGroupControls(selectedLinkedGroupId);
      }
    } catch (requestError) {
      setGroupEditorError(requestError instanceof Error ? requestError.message : "Não foi possível editar o grupo.");
    } finally {
      setGroupEditorSaving(false);
    }
  }, [
    canEditSelectedGroup,
    groupAdminsOnlyDraft,
    groupDescriptionDraft,
    groupEphemeralDraft,
    groupSharesDraft,
    groupLockedDraft,
    groupNameDraft,
    groupPhotoDraft,
    canManageSelectedGroupShares,
    loadGroupControls,
    selectedGroupRecord,
    selectedLinkedGroupId,
    upsertGroupRecord,
  ]);

  useEffect(() => {
    void loadInstances();
  }, [loadInstances]);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  useEffect(() => {
    if (!selectedInstanceId) {
      setThreads([]);
      setSelectedChatJid(null);
      setMessages([]);
      setMessageHistoryHasMore(false);
      setMessageHistoryOldestCursor(null);
      setMobileChatOpenState(false);
      setPendingGroupEditorChatJid(null);
      return;
    }
    setMobileChatOpenState(false);
    setShortcutsOpen(false);
    setToolsCanvasOpen(false);
    setActivationsModalOpen(false);
    setActivationConfigTarget(null);
    setActivationEditorField(null);
    setEmojiOpen(false);
    setReplyTarget(null);
    setPendingFile(null);
    setProfileModal(null);
    setMessageActionTarget(null);
    setThreadActionTarget(null);
    setGroupEditorOpen(false);
    setPendingGroupEditorChatJid(null);
    setMessageSearchOpen(false);
    setMessageSearchQuery("");
    void loadThreads(selectedInstanceId, { sync: false });
    // Directory synchronisation is intentionally deferred until the chat has
    // painted. Running it 350ms after navigation used to compete with the
    // first message request and made the panel look frozen. The realtime
    // stream keeps new conversations current; this is only a low-frequency
    // identity warm-up.
    window.setTimeout(() => {
      void loadThreads(selectedInstanceId, { sync: true, silent: true });
    }, 8000);
    const timer = window.setInterval(() => {
      void loadThreads(selectedInstanceId, { sync: false, silent: true });
    }, 60000);
    const handleRealtime = (event: Event) => {
      applyRealtimeDetail((event as CustomEvent<ConversationRealtimeDetail>).detail, true);
    };
    const broadcastChannel = typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("botadmin:whatsapp-conversations")
      : null;
    const scheduleFallbackRefresh = () => {
      window.setTimeout(() => {
        void loadThreads(selectedInstanceId, { sync: false, silent: true });
        const currentSelectedChat = selectedChatJidRef.current;
        if (currentSelectedChat) {
          void loadMessages(selectedInstanceId, currentSelectedChat, { silent: true });
        }
      }, 900);
    };
    const applyRealtimeDetail = (detail: ConversationRealtimeDetail | undefined, shouldBroadcast: boolean) => {
      if (!detail || detail.sourceClientId === realtimeClientIdRef.current) return;
	      const eventInstanceId = Number(detail?.instanceId ?? 0);
	      if (eventInstanceId > 0 && eventInstanceId !== selectedInstanceId) return;
	      const eventType = detail?.eventType ?? detail?.type;
	      const eventChatJid = detail?.chatJid;
	      const payload = detail?.payload ?? null;
      if (eventType === "group.plan.updated" || eventType === "user.plan.updated") {
        void loadGroupRecords().catch(() => undefined);
        if (!eventChatJid) return;
      }
	      if (!eventType || !eventChatJid) return;
      if (eventType === "status.update") return;
      const sequenceId = Number(detail.sequenceId ?? 0);
      if (sequenceId > 0) {
        const lastSequenceId = lastRealtimeSequenceRef.current;
        if (sequenceId <= lastSequenceId) return;
        if (lastSequenceId > 0 && sequenceId > lastSequenceId + 1) {
          scheduleFallbackRefresh();
        }
        lastRealtimeSequenceRef.current = sequenceId;
      }
      if (shouldBroadcast && broadcastChannel) {
        broadcastChannel.postMessage({ ...detail, sourceClientId: realtimeClientIdRef.current });
      }
      if (eventType === "call.update") {
        const call = extractCallStateFromRealtime(detail);
        if (call) {
          const key = getConversationCallKey(call.instanceId, call.chatJid);
          if (key) {
            setCallsByChat((current) => {
              if (isTerminalCallAction(call.action)) {
                const next = { ...current };
                delete next[key];
                return next;
              }
              return { ...current, [key]: call };
            });
          }
        }
        return;
      }
      const message = detail.message ?? payload?.message ?? payload?.visibleMessage ?? null;
      const thread = detail.thread ?? payload?.thread ?? null;
      const selectedChat = selectedChatJidRef.current;
      const chatAction = payload?.chatAction ?? null;
      const read = payload?.read === true || chatAction?.read === true || payload?.action === "read" || chatAction?.action === "read";
      const clearMessages = payload?.clearMessages === true || payload?.action === "clear" || chatAction?.action === "clear";
      const deleteThread = payload?.deleteThread === true || payload?.action === "delete" || chatAction?.action === "delete";
      const archived = payload?.archived ?? chatAction?.archived;
      const pinned = payload?.pinned ?? chatAction?.pinned;
      const muted = payload?.muted ?? chatAction?.muted;

      if (deleteThread) {
        setThreads((current) => current.filter((item) => item.chatJid !== eventChatJid));
        if (eventChatJid === selectedChat) {
          setMessages([]);
          setMessageHistoryHasMore(false);
          setMessageHistoryOldestCursor(null);
          setSelectedChatJid(null);
        }
        return;
      }

      if (clearMessages) {
        if (eventChatJid === selectedChat) {
          setMessages([]);
          setMessageHistoryHasMore(false);
          setMessageHistoryOldestCursor(null);
        }
        setThreads((current) =>
          mergeRealtimeThread(current, {
            chatJid: eventChatJid,
            selectedChatJid: selectedChat,
            thread,
            clearMessages: true,
            read: true,
          }),
        );
        return;
      }

      if (eventType === "chat.action") {
        setThreads((current) =>
          mergeRealtimeThread(current, {
            chatJid: eventChatJid,
            selectedChatJid: selectedChat,
            thread,
            read,
            archived,
            pinned,
            muted,
          }),
        );
        return;
      }

      if (eventType === "message.action") {
        const deletedMessageId =
          payload?.deletedMessageId ??
          payload?.messageAction?.messageId ??
          detail.messageId ??
          null;
        if (deletedMessageId && eventChatJid === selectedChat) {
          setMessages((current) =>
            current.map((message) =>
              (message.messageId || String(message.id)) === deletedMessageId
                ? {
                    ...message,
                    deletedAt: message.deletedAt ?? detail.createdAt ?? new Date().toISOString(),
                    deletedPlaceholder: message.deletedPlaceholder ?? "Mensagem apagada",
                  }
                : message,
            ),
          );
        } else {
          scheduleFallbackRefresh();
        }
        return;
      }

      if (eventType === "message.receipt") {
        if (eventChatJid !== selectedChat || !detail.messageId) return;
        const receipt = payload?.receipt && typeof payload.receipt === "object"
          ? payload.receipt as Record<string, unknown>
          : {};
        const rawState = String(
          receipt.state ?? receipt.status ?? payload?.action ?? "",
        ).toLowerCase();
        const deliveryState = ["read", "played", "seen", "4", "5"].includes(rawState)
          ? "read" as const
          : ["delivered", "delivery", "received", "2", "3"].includes(rawState)
            ? "delivered" as const
            : null;
        if (!deliveryState) return;
        setMessages((current) => current.map((item) => {
          if ((item.messageId || String(item.id)) !== detail.messageId) return item;
          const previous = item.deliveryState;
          const nextState = previous === "read" || (previous === "delivered" && deliveryState === "delivered")
            ? previous
            : deliveryState;
          return { ...item, deliveryState: nextState, localStatus: item.localStatus === "pending" ? "sent" : item.localStatus };
        }));
        return;
      }

      if (eventType === "conversation.message.upserted") {
        if (message && eventChatJid === selectedChat) {
          setMessages((current) => mergeConversationMessage(current, message));
        }
        if (message || thread) {
          setThreads((current) =>
            mergeRealtimeThread(current, {
              chatJid: eventChatJid,
              selectedChatJid: selectedChat,
              thread,
              message,
            }),
          );
          return;
        }
        scheduleFallbackRefresh();
      }
    };
    const handleBroadcast = (event: MessageEvent<ConversationRealtimeDetail>) => {
      applyRealtimeDetail(event.data, false);
    };
    window.addEventListener("botadmin:whatsapp-conversation-realtime", handleRealtime);
    broadcastChannel?.addEventListener("message", handleBroadcast);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("botadmin:whatsapp-conversation-realtime", handleRealtime);
      broadcastChannel?.removeEventListener("message", handleBroadcast);
      broadcastChannel?.close();
    };
  }, [loadGroupRecords, loadMessages, loadThreads, selectedInstanceId, setMobileChatOpenState]);

  useEffect(() => {
    setShortcutsOpen(false);
    setToolsCanvasOpen(false);
    setActivationConfigTarget(null);
    setActivationEditorField(null);
    setEmojiOpen(false);
    setReplyTarget(null);
    setPendingFile(null);
    setProfileModal(null);
    setMessageActionTarget(null);
    setThreadActionTarget(null);
    setGroupEditorOpen(false);
    setMessageSearchOpen(false);
    setMessageSearchQuery("");
    if (!selectedThreadInstanceId || !selectedChatJid) {
      setMessages([]);
      setMessageHistoryHasMore(false);
      setMessageHistoryOldestCursor(null);
      return;
    }
    void loadMessages(selectedThreadInstanceId, selectedChatJid);
    const timer = window.setInterval(() => {
      void loadMessages(selectedThreadInstanceId, selectedChatJid, { silent: true });
    }, 45000);
    return () => window.clearInterval(timer);
  }, [loadMessages, selectedChatJid, selectedThreadInstanceId]);

  useEffect(() => {
    if (selectedChatType !== "group") {
      setSelectedGroupRecord(null);
      setSelectedGroupSettings(null);
      setActivationConfigTarget(null);
      setActivationEditorField(null);
      setGroupControlsError(null);
      syncGroupSettingsDrafts(null);
      return;
    }

    if (!selectedLinkedGroupId) {
      setSelectedGroupRecord(null);
      setSelectedGroupSettings(null);
      setActivationConfigTarget(null);
      setActivationEditorField(null);
      setGroupControlsError(null);
      syncGroupSettingsDrafts(null);
      return;
    }

    void loadGroupControls(selectedLinkedGroupId);
  }, [loadGroupControls, selectedChatType, selectedLinkedGroupId, syncGroupSettingsDrafts]);

  useEffect(() => {
    if (groupEditorOpen) {
      syncGroupEditorDrafts();
    }
  }, [groupEditorOpen, syncGroupEditorDrafts]);

  useEffect(() => {
    if (!pendingGroupEditorChatJid) return;
    if (selectedChatJid !== pendingGroupEditorChatJid) return;
    if (!selectedThread || selectedChatType !== "group") {
      setPendingGroupEditorChatJid(null);
      return;
    }
    if (canEditSelectedGroup && selectedGroupRecord) {
      openGroupEditor();
      setPendingGroupEditorChatJid(null);
    }
  }, [
    canEditSelectedGroup,
    openGroupEditor,
    pendingGroupEditorChatJid,
    selectedChatJid,
    selectedChatType,
    selectedGroupRecord,
    selectedThread,
  ]);

  useEffect(() => {
    if (!messagesAutoScrollRef.current) {
      messagesAutoScrollRef.current = true;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selectedChatJid]);

  const stopCallAudioBridge = useCallback(() => {
    if (callAudioDisconnectTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(callAudioDisconnectTimerRef.current);
      callAudioDisconnectTimerRef.current = null;
    }
    callAudioBridgeStartingRef.current = null;
    const bridge = callAudioBridgeRef.current;
    callAudioBridgeRef.current = null;
    callAudioSentFramesRef.current = 0;
    callAudioReceivedFramesRef.current = 0;
    callAudioLastPeakRef.current = 0;
    callAudioPlaybackCursorRef.current = 0;
    if (bridge) {
      if (bridge.frameMonitorTimer !== null && typeof window !== "undefined") {
        window.clearTimeout(bridge.frameMonitorTimer);
      }
      if (bridge.playbackElement) {
        try {
          bridge.playbackElement.pause();
          bridge.playbackElement.srcObject = null;
        } catch {
          // ignored
        }
      }
      bridge.audioNodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // ignored
        }
      });
      bridge.stream.getTracks().forEach((track) => track.stop());
      bridge.socket?.close();
      bridge.dataChannel?.close();
      bridge.peerConnection?.close();
      void bridge.audioContext.close().catch(() => undefined);
    }
    setCallAudioStatus("idle");
    setCallAudioError(null);
  }, []);

  const startCallAudioBridge = useCallback(async (call: ConversationCallState) => {
    if (typeof window === "undefined" || call.callId.startsWith("local-")) return;
    if (callAudioBridgeRef.current?.callId === call.callId) return;
    if (callAudioBridgeStartingRef.current === call.callId) return;

    if (callAudioBridgeRef.current && callAudioBridgeRef.current.callId !== call.callId) {
      stopCallAudioBridge();
    }
    callAudioBridgeStartingRef.current = call.callId;

    let socket: WebSocket | null = null;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let captureNode: AudioWorkletNode | null = null;
    let playbackNode: AudioWorkletNode | null = null;
    let fallbackCaptureNode: ScriptProcessorNode | null = null;
    let playbackDestinationNode: MediaStreamAudioDestinationNode | null = null;
    let playbackElement: HTMLAudioElement | null = null;
    let frameMonitorTimer: number | null = null;
    let fallbackCaptureStarted = false;

    const cleanupFailedBridge = () => {
      if (frameMonitorTimer !== null && typeof window !== "undefined") {
        window.clearTimeout(frameMonitorTimer);
        frameMonitorTimer = null;
      }
      if (playbackElement) {
        try {
          playbackElement.pause();
          playbackElement.srcObject = null;
        } catch {
          // ignored
        }
      }
      [playbackDestinationNode, playbackNode, fallbackCaptureNode, captureNode, sourceNode].forEach((node) => {
        try {
          node?.disconnect();
        } catch {
          // ignored
        }
      });
      stream?.getTracks().forEach((track) => track.stop());
      socket?.close();
      void audioContext?.close().catch(() => undefined);
    };
    const isStartStillCurrent = () => callAudioBridgeStartingRef.current === call.callId;
    const clearDisconnectTimer = () => {
      if (callAudioDisconnectTimerRef.current !== null) {
        window.clearTimeout(callAudioDisconnectTimerRef.current);
        callAudioDisconnectTimerRef.current = null;
      }
    };

    try {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        throw new Error("Este navegador não liberou acesso ao microfone.");
      }
      const AudioContextCtor = window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Áudio do navegador indisponível.");
      }
      if (!("AudioWorkletNode" in window)) {
        throw new Error("Este navegador não suporta áudio de chamada em tempo real.");
      }
      if (!("WebSocket" in window)) {
        throw new Error("Este navegador não suporta chamada em tempo real.");
      }

      setCallAudioStatus("connecting");
      setCallAudioError(null);

      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!isStartStillCurrent()) {
        cleanupFailedBridge();
        return;
      }
      audioContext = new AudioContextCtor({ sampleRate: CALL_AUDIO_SAMPLE_RATE });
      await audioContext.audioWorklet.addModule(callAudioWorkletUrl(CALL_CAPTURE_WORKLET_URL));
      await audioContext.audioWorklet.addModule(callAudioWorkletUrl(CALL_PLAYBACK_WORKLET_URL));
      await audioContext.resume().catch(() => undefined);
      if (!isStartStillCurrent()) {
        cleanupFailedBridge();
        return;
      }
      sourceNode = audioContext.createMediaStreamSource(stream);
      socket = new WebSocket(buildWhatsappCallMediaWebSocketUrl(call.instanceId, call.callId));
      socket.binaryType = "arraybuffer";

      captureNode = new AudioWorkletNode(audioContext, CALL_CAPTURE_PROCESSOR_NAME);
      playbackNode = new AudioWorkletNode(audioContext, CALL_PLAYBACK_PROCESSOR_NAME);
      playbackDestinationNode = audioContext.createMediaStreamDestination();
      playbackElement = new Audio();
      playbackElement.autoplay = true;
      playbackElement.playsInline = true;
      playbackElement.srcObject = playbackDestinationNode.stream;
      callAudioSentFramesRef.current = 0;
      callAudioReceivedFramesRef.current = 0;
      callAudioLastPeakRef.current = 0;

      const sendCapturedFrame = (frame: ArrayLike<number>) => {
        if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > CALL_AUDIO_MAX_BUFFERED_BYTES) return;
        let peak = 0;
        for (let index = 0; index < frame.length; index += 1) {
          peak = Math.max(peak, Math.abs(frame[index] ?? 0));
        }
        callAudioLastPeakRef.current = peak;
        socket.send(float32ToInt16Le(frame));
        callAudioSentFramesRef.current += 1;
      };

      const armFrameMonitor = () => {
        if (frameMonitorTimer !== null) return;
        frameMonitorTimer = window.setTimeout(() => {
          if (callAudioBridgeRef.current?.callId !== call.callId) return;
          if (callAudioSentFramesRef.current <= 0) {
            startFallbackCapture();
            window.setTimeout(() => {
              if (callAudioBridgeRef.current?.callId !== call.callId) return;
              if (callAudioSentFramesRef.current <= 0) {
                setCallAudioStatus("error");
                setCallAudioError("Áudio conectado, mas o navegador não está enviando o microfone. Verifique a permissão do microfone e tente novamente.");
              }
            }, 1200);
            return;
          }
          if (callAudioLastPeakRef.current < 0.0005) {
            setCallAudioError("Áudio conectado, mas o microfone está sem sinal. Confira se o microfone correto foi liberado.");
          }
        }, 1200);
        if (callAudioBridgeRef.current?.callId === call.callId) {
          callAudioBridgeRef.current.frameMonitorTimer = frameMonitorTimer;
        }
      };

      const startFallbackCapture = () => {
        if (!audioContext || !sourceNode || fallbackCaptureStarted) return;
        fallbackCaptureStarted = true;
        try {
          captureNode?.disconnect();
        } catch {
          // ignored
        }
        fallbackCaptureNode = audioContext.createScriptProcessor(1024, 1, 1);
        fallbackCaptureNode.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          const output = event.outputBuffer.getChannelData(0);
          output.fill(0);
          sendCapturedFrame(downsamplePcm(input, audioContext?.sampleRate || CALL_AUDIO_SAMPLE_RATE, CALL_AUDIO_SAMPLE_RATE));
        };
        sourceNode.connect(fallbackCaptureNode);
        fallbackCaptureNode.connect(audioContext.destination);
        if (callAudioBridgeRef.current?.callId === call.callId) {
          callAudioBridgeRef.current.audioNodes.push(fallbackCaptureNode);
        }
      };

      captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        sendCapturedFrame(event.data);
      };
      sourceNode.connect(captureNode);
      captureNode.connect(audioContext.destination);
      playbackNode.connect(playbackDestinationNode);
      void playbackElement.play().catch(() => undefined);

      socket.onopen = () => {
        clearDisconnectTimer();
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; message?: string };
            if (message.type === "ready" || message.type === "hello") {
              clearDisconnectTimer();
              setCallAudioStatus("connected");
              setCallAudioError(null);
              armFrameMonitor();
              return;
            }
            if (message.type === "error") {
              setCallAudioStatus("error");
              setCallAudioError(message.message || "Áudio da chamada indisponível.");
              return;
            }
          } catch {
            // Non-JSON control messages are ignored.
          }
          return;
        }
        void dataChannelPayloadToArrayBuffer(event.data)
          .then((buffer) => {
            if (!buffer || buffer.byteLength < 2) return;
            callAudioReceivedFramesRef.current += 1;
            playbackNode?.port.postMessage(int16LeToFloat32(buffer));
            void playbackElement?.play().catch(() => undefined);
          })
          .catch(() => undefined);
      };
      socket.onclose = () => {
        if (callAudioBridgeRef.current?.callId === call.callId) {
          setCallAudioStatus("error");
          setCallAudioError("Áudio do painel desconectado. A chamada continua ativa; encerre e ligue novamente se precisar.");
        }
      };
      socket.onerror = () => {
        if (callAudioBridgeRef.current?.callId === call.callId) {
          setCallAudioStatus("error");
          setCallAudioError("Não foi possível manter o áudio da chamada.");
        }
      };

      if (!isStartStillCurrent()) {
        cleanupFailedBridge();
        return;
      }
      callAudioBridgeRef.current = {
        callId: call.callId,
        socket,
        stream,
        audioContext,
        audioNodes: [playbackDestinationNode, playbackNode, fallbackCaptureNode, captureNode, sourceNode].filter(
          (node): node is AudioNode => Boolean(node),
        ),
        playbackElement,
        frameMonitorTimer,
      };
      if (callAudioBridgeStartingRef.current === call.callId) {
        callAudioBridgeStartingRef.current = null;
      }
    } catch (error) {
      const startWasStillCurrent = callAudioBridgeStartingRef.current === call.callId;
      cleanupFailedBridge();
      if (callAudioBridgeStartingRef.current === call.callId) {
        callAudioBridgeStartingRef.current = null;
      }
      if (!startWasStillCurrent && callAudioBridgeRef.current?.callId !== call.callId) return;
      if (isMissingWhatsappCallError(error)) {
        const key = getConversationCallKey(call.instanceId, call.chatJid);
        if (key) {
          setCallsByChat((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
        setCallAudioStatus("idle");
        return;
      }
      setCallAudioStatus("error");
      setCallAudioError(error instanceof Error ? error.message : "Não foi possível abrir o áudio da chamada.");
    }
  }, [stopCallAudioBridge]);

  useEffect(() => () => stopCallAudioBridge(), [stopCallAudioBridge]);

  useEffect(() => {
    if (!activeCall || !activeCallAudioBridgeKey) {
      stopCallAudioBridge();
      return;
    }
    if (callAudioBridgeRef.current?.callId === activeCall.callId || callAudioBridgeStartingRef.current === activeCall.callId) return;
    void startCallAudioBridge(activeCall);
  }, [
    activeCall,
    activeCallAudioBridgeKey,
    startCallAudioBridge,
    stopCallAudioBridge,
  ]);

  useEffect(() => {
    if (!activeCall || !activeCallKey || activeCall.callId.startsWith("local-")) return;
    let canceled = false;
    const checkCallStillActive = async () => {
      try {
        const response = await fetch(apiPath(`/api/bot-instances/${activeCall.instanceId}/whatsapp-calls`), {
          method: "GET",
          cache: "no-store",
        });
        const payload = await readJson<unknown>(response);
        if (canceled) return;
        if (!payloadContainsCallId(payload, activeCall.callId)) {
          setCallsByChat((current) => {
            if (current[activeCallKey]?.callId !== activeCall.callId) return current;
            const next = { ...current };
            delete next[activeCallKey];
            return next;
          });
          stopCallAudioBridge();
        }
      } catch {
        // Realtime continua como fonte principal; polling e apenas fallback contra estado preso.
      }
    };
    const firstTimer = window.setTimeout(() => void checkCallStillActive(), 1800);
    const interval = window.setInterval(() => void checkCallStillActive(), 3500);
    return () => {
      canceled = true;
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
    };
  }, [
    activeCall?.callId,
    activeCall?.instanceId,
    activeCallKey,
    stopCallAudioBridge,
  ]);

  useEffect(() => {
    if (!activeCall) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Existe uma chamada em andamento. Recarregar a página pode derrubar o áudio.";
      return event.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeCall]);

  const runSelectedWhatsappCallAction = useCallback(async (
    action: "start" | "accept" | "end" | "reject",
    targetView?: ActiveCallView | null,
  ) => {
    const targetCallView = action === "start" ? null : targetView ?? (
      selectedCall && selectedCallKey
        ? {
            key: selectedCallKey,
            call: selectedCall,
            thread: selectedThread,
            instance: selectedThreadInstance,
          }
        : activeCallView
    );
    const existingCall = targetCallView?.call ?? null;
    const actionKey = action === "start" ? selectedCallKey : targetCallView?.key ?? null;
    const actionInstanceId = action === "start" ? selectedThreadInstanceId : existingCall?.instanceId ?? null;
    const actionChatJid = action === "start" ? selectedThread?.chatJid ?? null : existingCall?.chatJid ?? null;
    const actionPhone = action === "start" ? selectedThread?.phone : targetCallView?.thread?.phone ?? null;
    if (!actionKey || !actionInstanceId || !actionChatJid) return;
    if (action === "start" && !canUseSelectedWhatsappCall) {
      setError(
        selectedChatType === "group"
          ? "Chamadas pelo painel estão liberadas apenas para conversas privadas."
          : "Conecte a instância para iniciar chamadas pelo BotAdmin.",
      );
      return;
    }
    if (action !== "start" && !existingCall?.callId) return;

    setCallActionBusy(`${action}:${actionKey}`);
    setError(null);
    if (action === "start") {
      setCallsByChat((current) => ({
        ...current,
        [actionKey]: {
          instanceId: actionInstanceId,
          chatJid: actionChatJid,
          callId: `local-${Date.now()}`,
          action: "starting",
          direction: "outgoing",
          timestamp: new Date().toISOString(),
        },
      }));
    }

    try {
      const response = await fetch(apiPath(`/api/bot-instances/${actionInstanceId}/whatsapp-calls`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          chatJid: actionChatJid,
          phone: actionPhone,
          callId: existingCall?.callId,
          callCreator: existingCall?.callCreatorJid,
        }),
      });
      const payload = await readJson<WhatsappCallResponse>(response);
      if (payload.alreadyEnded || action === "end" || action === "reject" || isTerminalCallAction(payload.action)) {
        setCallsByChat((current) => {
          const next = { ...current };
          delete next[actionKey];
          return next;
        });
        stopCallAudioBridge();
        return;
      }
      setCallsByChat((current) => ({
        ...current,
        [actionKey]: extractCallStateFromApiResponse(payload, {
          instanceId: actionInstanceId,
          chatJid: actionChatJid,
          action,
          callId: existingCall?.callId,
        }),
      }));
    } catch (requestError) {
      if (action !== "start" && isMissingWhatsappCallError(requestError)) {
        setCallsByChat((current) => {
          const next = { ...current };
          delete next[actionKey];
          return next;
        });
        stopCallAudioBridge();
        return;
      }
      if (action === "start") {
        setCallsByChat((current) => {
          const next = { ...current };
          delete next[actionKey];
          return next;
        });
      }
      setError(requestError instanceof Error ? requestError.message : "Não foi possível executar a chamada.");
    } finally {
      setCallActionBusy((current) => current === `${action}:${actionKey}` ? null : current);
    }
  }, [
    activeCallView,
    canUseSelectedWhatsappCall,
    selectedCall,
    selectedCallKey,
    selectedChatType,
    selectedThread,
    selectedThreadInstance,
    selectedThreadInstanceId,
    stopCallAudioBridge,
  ]);

  const stopRecordingStream = useCallback(() => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }, []);

  const startAudioRecording = useCallback(async () => {
    if (conversationReadOnly || pendingFile || composer.trim()) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador não liberou gravação de áudio no painel.");
      recordingHoldActiveRef.current = false;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!recordingHoldActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      const preferredMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (recorderEvent) => {
        if (recorderEvent.data.size > 0) {
          recordingChunksRef.current.push(recorderEvent.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recordingChunksRef.current = [];
        mediaRecorderRef.current = null;
        stopRecordingStream();
        setIsRecordingAudio(false);
        if (blob.size > 0) {
          const extension = blob.type.includes("ogg") ? "ogg" : "webm";
          setPendingFile(new File([blob], `audio-${Date.now()}.${extension}`, { type: blob.type || "audio/webm" }));
        }
      };
      recorder.start();
      setIsRecordingAudio(true);
    } catch (recordingError) {
      console.warn("[whatsapp-conversations] Falha ao iniciar gravação de áudio", recordingError);
      recordingHoldActiveRef.current = false;
      setIsRecordingAudio(false);
      stopRecordingStream();
      setError("Não foi possível acessar o microfone.");
    }
  }, [composer, conversationReadOnly, pendingFile, stopRecordingStream]);

  const stopAudioRecording = useCallback(() => {
    recordingHoldActiveRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    setIsRecordingAudio(false);
    stopRecordingStream();
  }, [stopRecordingStream]);

  useEffect(() => () => {
    recordingHoldActiveRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      stopRecordingStream();
    }
  }, [stopRecordingStream]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedThreadInstanceId || !selectedChatJid || conversationReadOnly) return;
    const text = composer.trim();
    const fileToSend = pendingFile;
    if (!text && !fileToSend) return;
    const mentionAllForSend = Boolean(mentionAll && selectedChatType === "group");
    const mentionTargetsForSend = mentionAllForSend ? mentionTargets : [];
    const replyTargetForSend = replyTarget;
    const mediaType = fileToSend ? inferClientMediaType(fileToSend.type, fileToSend.name) : "text";
    const optimisticUrl = fileToSend ? URL.createObjectURL(fileToSend) : null;
    const tempId = -Date.now();
    const now = new Date().toISOString();
    const outgoingSenderJid = selectedInstance?.phone
      ? `${selectedInstance.phone.replace(/\D+/g, "")}@s.whatsapp.net`
      : null;
    const optimisticMessage: ConversationMessage = {
      id: tempId,
      chatJid: selectedChatJid,
      messageId: `local-${Math.abs(tempId)}`,
      direction: "outbound",
      senderJid: outgoingSenderJid,
      senderName: selectedInstance?.name ?? "Você",
      senderAvatarUrl: selectedThread?.avatarUrl ?? null,
      messageType: mediaType,
      text: text || null,
      media: fileToSend
        ? {
            mediaType,
            kind: mediaType,
            mimeType: fileToSend.type || "application/octet-stream",
            filename: fileToSend.name,
            caption: text || null,
            dataUrl: optimisticUrl,
            size: fileToSend.size,
          }
        : null,
      timestamp: now,
      localStatus: "pending",
    };
    const previewLabel = text || (fileToSend ? describeMedia(optimisticMessage) : "Mensagem");
    // Clear composer immediately and show bubble — network runs in background.
    setError(null);
    setComposer("");
    setPendingFile(null);
    setReplyTarget(null);
    setMentionAll(false);
    setShortcutsOpen(false);
    setEmojiOpen(false);
    setMessages((current) => mergeConversationMessage(current, optimisticMessage));
    setThreads((current) => {
      const existing = current.find((thread) => thread.chatJid === selectedChatJid);
      if (!existing) return current;
      const updated: ThreadSummary = {
        ...existing,
        lastMessagePreview: previewLabel,
        lastMessageAt: now,
        lastMessageDirection: "outbound",
        lastMessageSenderName: selectedInstance?.name ?? "Bot",
        lastMessageSenderJid: outgoingSenderJid,
      };
      return [updated, ...current.filter((thread) => thread.chatJid !== selectedChatJid)];
    });
    messagesAutoScrollRef.current = true;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    window.setTimeout(() => composerInputRef.current?.focus(), 0);

    const instanceIdForSend = selectedThreadInstanceId;
    const chatJidForSend = selectedChatJid;
    try {
      const body = fileToSend
        ? (() => {
            const formData = new FormData();
            formData.set("text", text);
            formData.set("file", fileToSend);
            if (replyTargetForSend?.messageId) {
              formData.set("quotedMessageId", replyTargetForSend.messageId);
              if (replyTargetForSend.senderJid) {
                formData.set("quotedParticipant", replyTargetForSend.senderJid);
              }
            }
            if (mentionAllForSend) {
              formData.set("mentionAll", "true");
              mentionTargetsForSend.forEach((jid) => formData.append("mentions", jid));
            }
            return formData;
          })()
        : JSON.stringify({
            text,
            mentionAll: mentionAllForSend,
            mentions: mentionTargetsForSend,
            quoted: replyTargetForSend?.messageId
              ? { stanzaId: replyTargetForSend.messageId, participant: replyTargetForSend.senderJid }
              : undefined,
          });
      const payload = await fetch(
        apiPath(`/api/bot-instances/${instanceIdForSend}/whatsapp-conversations/${encodeURIComponent(chatJidForSend)}/messages`),
        {
          method: "POST",
          ...(fileToSend ? {} : { headers: { "Content-Type": "application/json" } }),
          body,
        },
      ).then((response) => readJson<{
        message?: ConversationMessage;
        thread?: ThreadSummary;
      }>(response));
      if (payload.message) {
        const confirmedMessage: ConversationMessage =
          fileToSend && optimisticUrl
            ? {
                ...payload.message,
                localStatus: "sent",
                media: {
                  ...(payload.message.media ?? {}),
                  mediaType,
                  kind: mediaType,
                  mimeType: fileToSend.type || String(payload.message.media?.mimeType || "application/octet-stream"),
                  filename: fileToSend.name || String(payload.message.media?.filename || ""),
                  caption: String(payload.message.media?.caption || text || "") || null,
                  dataUrl: optimisticUrl,
                  size: fileToSend.size,
                },
              }
            : { ...payload.message, localStatus: "sent" };
        setMessages((current) => mergeConversationMessage(current, confirmedMessage));
      } else {
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId ? { ...message, localStatus: "sent" as const } : message,
          ),
        );
      }
      if (payload.thread) {
        setThreads((current) => {
          const without = current.filter((thread) => thread.chatJid !== payload.thread!.chatJid);
          return sortThreadsByActivity([payload.thread!, ...without]);
        });
      }
    } catch (requestError) {
      setMessages((current) =>
        current.map((message) =>
          message.id === tempId ? { ...message, localStatus: "failed" as const } : message,
        ),
      );
      setError(requestError instanceof Error ? requestError.message : "Não foi possível enviar a mensagem.");
    }
  };

  const renderParticipantActionButtons = (target: ParticipantActionTarget) => {
    const participant = target.participant;
    const participantDigits = getParticipantDigits(participant);
    const isOwnParticipant = Boolean(
      ownParticipantDigits &&
        participantDigits &&
        (ownParticipantDigits === participantDigits ||
          ownParticipantDigits.endsWith(participantDigits) ||
          participantDigits.endsWith(ownParticipantDigits)),
    );
    const role = participant.admin ?? "member";
    const canPromote = canModerateSelectedGroup && !isOwnParticipant && role === "member";
    const canDemote = canModerateSelectedGroup && !isOwnParticipant && role === "admin";
    const canBan = canModerateSelectedGroup && !isOwnParticipant && role !== "superadmin";
    const botActive = selectedGroupRecord?.status === "active";

    return (
      <div className={styles.messageActionList}>
        {canPromote ? (
          <button
            type="button"
            onClick={() => void runParticipantAction(target, "promote")}
            disabled={Boolean(participantActionSaving || messageActionSaving)}
          >
            <IconUsersGroup size={18} />
            <span>Promover a admin</span>
          </button>
        ) : null}
        {canDemote ? (
          <button
            type="button"
            onClick={() => void runParticipantAction(target, "demote")}
            disabled={Boolean(participantActionSaving || messageActionSaving)}
          >
            <IconUser size={18} />
            <span>Rebaixar admin</span>
          </button>
        ) : null}
        {botActive ? (
          <button
            type="button"
            onClick={() => void runParticipantAction(target, "resetInfractions")}
            disabled={Boolean(participantActionSaving || messageActionSaving)}
          >
            <IconRefresh size={18} />
            <span>Resetar infrações</span>
          </button>
        ) : null}
        {canBan ? (
          <button
            type="button"
            className={styles.threadActionDanger}
            onClick={() => openBanConfirm(target)}
            disabled={Boolean(participantActionSaving || messageActionSaving)}
          >
            <IconTrash size={18} />
            <span>Banir usuário</span>
          </button>
        ) : null}
        {!canModerateSelectedGroup ? (
          <button type="button" disabled>
            <IconUserCircle size={18} />
            <span>Instância sem permissão de admin</span>
          </button>
        ) : null}
        {isOwnParticipant ? (
          <button type="button" disabled>
            <IconUserCircle size={18} />
            <span>Não é possível moderar a própria instância</span>
          </button>
        ) : null}
      </div>
    );
  };

  const selectedCallBusy = Boolean(selectedCallKey && callActionBusy?.endsWith(`:${selectedCallKey}`));
  const selectedCallIncoming = Boolean(selectedCall && isIncomingCallAction(selectedCall.action));
  const activeCallBusy = Boolean(activeCallKey && callActionBusy?.endsWith(`:${activeCallKey}`));
  const activeCallTitle = activeCall
    ? activeCallView?.thread
      ? getThreadTitle(activeCallView.thread, activeCallView.instance)
      : formatPhone(getPhoneFromChatJid(activeCall.chatJid)) || activeCall.chatJid
    : "";
  const activeCallSubtitle = activeCall
    ? activeCallView?.thread
      ? getThreadSubtitle(activeCallView.thread, activeCallView.instance)
      : activeCallView?.instance?.name || activeCall.chatJid
    : "";
  const activeCallAudioLabel = activeCallIncoming
    ? "Chamada recebida pela instância conectada"
    : callAudioStatus === "connected"
      ? "Áudio conectado pelo BotAdmin"
      : callAudioStatus === "connecting"
        ? "Conectando áudio..."
        : callAudioStatus === "error"
          ? callAudioError || "Áudio indisponível"
          : "Chamada pela instância conectada";
  const openActiveCallConversation = useCallback(() => {
    if (!activeCall) return;
    setSelectedInstanceId(activeCall.instanceId);
    setSelectedChatJid(activeCall.chatJid);
    setMobileChatOpenState(true);
  }, [activeCall, setMobileChatOpenState]);

  return (
    <main className={`${styles.workspace} ${embedded ? styles.workspaceEmbedded : ""}`}>
      {activeCall ? (
        <section className={styles.callOverlay} aria-label="Chamada em andamento">
          <button
            type="button"
            className={styles.callOverlayIdentity}
            onClick={openActiveCallConversation}
            title="Abrir conversa da chamada"
          >
            <span className={styles.callOverlayAvatar}>
              {activeCallView?.thread?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeCallView.thread.avatarUrl} alt={activeCallTitle} />
              ) : activeCallView?.thread && resolveThreadChatType(activeCallView.thread) !== "contact" ? (
                renderChatTypeIcon(activeCallView.thread, 24)
              ) : (
                getInitials(activeCallTitle)
              )}
            </span>
            <span className={styles.callOverlayText}>
              <strong>{activeCallTitle}</strong>
              <small>{getCallStatusLabel(activeCall)} • {activeCallAudioLabel}</small>
              {activeCallSubtitle ? <em>{activeCallSubtitle}</em> : null}
            </span>
          </button>
          <div className={styles.callOverlayActions}>
            {activeCallIncoming ? (
              <button
                type="button"
                className={styles.callOverlayAccept}
                onClick={() => void runSelectedWhatsappCallAction("accept", activeCallView)}
                disabled={activeCallBusy}
              >
                {activeCallBusy ? <Spinner animation="border" size="sm" /> : <IconPhoneCall size={18} />}
                Atender
              </button>
            ) : null}
            <button
              type="button"
              className={styles.callOverlayOpen}
              onClick={openActiveCallConversation}
            >
              <IconMessageCircle size={18} />
            </button>
            <button
              type="button"
              className={styles.callOverlayEnd}
              onClick={() => void runSelectedWhatsappCallAction(activeCallIncoming ? "reject" : "end", activeCallView)}
              disabled={activeCallBusy}
            >
              {activeCallBusy ? <Spinner animation="border" size="sm" /> : <IconPhoneOff size={18} />}
              {activeCallIncoming ? "Recusar" : "Encerrar"}
            </button>
          </div>
        </section>
      ) : null}
      {!embedded ? (
        <aside className={styles.botRail} aria-label="Navegação principal do BotAdmin">
          <button
            type="button"
            className={styles.botRailBtn}
            onClick={() => goToDashboardSection("instances")}
            title="Conectar WhatsApp"
          >
            <IconBrandWhatsapp size={18} />
          </button>
          <button
            type="button"
            className={`${styles.botRailBtn} ${styles.botRailBtnActive}`}
            title="Conversas"
          >
            <IconMessageCircle size={18} />
          </button>
          <button
            type="button"
            className={styles.botRailBtn}
            onClick={() => goToDashboardSection("flows")}
            title="Fluxos"
          >
            <IconSparkles size={18} />
          </button>
          <button
            type="button"
            className={styles.botRailBtn}
            onClick={() => goToDashboardSection("affiliates")}
            title="Afiliados"
          >
            <IconBox size={18} />
          </button>
          <button
            type="button"
            className={styles.botRailBtn}
            onClick={() => goToDashboardSection("status")}
            title="Status"
          >
            <IconBell size={18} />
          </button>
          <button
            type="button"
            className={styles.botRailBtn}
            onClick={() => goToDashboardSection("payments")}
            title="Pagamentos"
          >
            <IconWallet size={18} />
          </button>
          <button
            type="button"
            className={styles.botRailBtn}
            onClick={() => goToDashboardSection("apirest")}
            title="API REST"
          >
            <IconSettings size={18} />
          </button>
          <button
            type="button"
            className={styles.botRailFooter}
            onClick={() => void handleLogout()}
            title="Sair da conta"
          >
            <IconLogout size={18} />
          </button>
        </aside>
      ) : null}

      <aside className={`${styles.threadListPane} ${mobileChatOpen ? styles.threadListPaneHiddenMobile : ""}`}>
        {!embedded ? (
          <div className={styles.sidebarHeader}>
            <div className={styles.sidebarTitleWrap}>
              <span className={styles.sidebarLogo}>
                {brandLogo ? (
                  <img src={brandLogo} alt={brandName} className={styles.sidebarBrandLogo} />
                ) : (
                  <IconBrandWhatsapp size={25} />
                )}
              </span>
              <span className={styles.sidebarTitleText}>
                <h1>Conversas</h1>
                <span className={styles.sidebarBrandName}>{brandName}</span>
              </span>
            </div>
            <button
              type="button"
              className={styles.headerIconButton}
              onClick={() => selectedInstanceId && void loadThreads(selectedInstanceId, { sync: true })}
              disabled={!selectedInstanceId || loadingThreads}
              aria-label="Atualizar"
            >
              {loadingThreads ? <Spinner animation="border" size="sm" /> : <IconRefresh size={20} />}
            </button>
          </div>
        ) : null}

          <div className={`${styles.sidebarTools} ${embedded ? styles.sidebarToolsEmbedded : ""}`}>
            {!embedded ? (
            <label className={`${styles.instanceSelector} ${embedded ? styles.instanceSelectorCompact : ""}`}>
              <span>
                <IconBrandWhatsapp size={16} />
                {selectedIsSharedMailbox ? "Conversas liberadas" : "Perfil atual"}
              </span>
              <Form.Select
                value={selectedInstanceId ?? ""}
                disabled={loadingInstances || instances.length === 0}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  chooseInstance(Number.isFinite(next) ? next : null);
                }}
                aria-label="Origem de conversas"
              >
                {instances.length === 0 ? (
                  <option value="">Nenhuma instância</option>
                ) : null}
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {getInstanceDisplayName(instance)}
                  </option>
                ))}
              </Form.Select>
            </label>
            ) : null}
            <label className={styles.searchBox}>
              <IconSearch size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar ou começar uma nova conversa"
              />
            </label>
            <div className={styles.filterRow}>
              {THREAD_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.filterButton} ${threadFilter === item.id ? styles.filterButtonActive : ""}`}
                  onClick={() => setThreadFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {error ? <Alert variant="danger" className={styles.inlineAlert}>{error}</Alert> : null}
          {directoryErrors.length > 0 ? (
            <Alert variant="warning" className={styles.inlineAlert}>
              {Array.from(new Set(directoryErrors)).join(" ")}
            </Alert>
          ) : null}
          {selectedThreadKeys.size > 0 ? (
            <div className={styles.threadSelectionBar}>
              <button type="button" onClick={clearThreadSelection} aria-label="Cancelar seleção">
                <IconX size={18} />
              </button>
              <strong>{selectedThreadKeys.size}</strong>
              <span>selecionada(s)</span>
              <button type="button" onClick={selectAllVisibleThreads} disabled={filteredThreads.length === 0}>
                <IconChecks size={18} />
                Selecionar tudo
              </button>
              <button
                type="button"
                className={styles.threadSelectionDanger}
                onClick={() => void deleteSelectedThreads()}
                disabled={threadActionSaving === "delete"}
              >
                {threadActionSaving === "delete" ? <Spinner animation="border" size="sm" /> : <IconTrash size={18} />}
                Apagar
              </button>
            </div>
          ) : null}

          <div className={styles.threadScroll}>
            {loadingInstances || loadingThreads ? (
              <div className={styles.emptyState}>
                <Spinner animation="border" />
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className={styles.emptyState}>Nenhuma conversa encontrada.</div>
            ) : (
              filteredThreads.map((thread) => {
                const threadKey = getThreadSelectionKey(thread);
                const threadSelected = selectedThreadKeys.has(threadKey);
                const selectionMode = selectedThreadKeys.size > 0;
                const threadIsGroup = resolveThreadChatType(thread) === "group";
                const threadGroupRecord = getThreadGroupRecord(thread);
                const threadLinkedToOtherUser = threadIsGroup && !threadGroupRecord && isThreadLinkedToOtherUser(thread);
                const threadProfileExpiresAt = threadIsGroup
                  ? getGroupProfileExpiresAt(threadGroupRecord) ?? getThreadProfileExpiresAt(thread)
                  : null;
                const threadGroupBadge = threadIsGroup
                  ? getGroupValidityBadge(threadGroupRecord, threadProfileExpiresAt, {
                      linkedToOtherUser: threadLinkedToOtherUser,
                    })
                  : null;
	                const threadGroupActionLabel = threadIsGroup
	                  ? getGroupQuickActionLabel(threadGroupRecord, threadLinkedToOtherUser, threadProfileExpiresAt)
	                  : "";
	                const threadGroupNeedsResume = Boolean(
	                  threadGroupRecord &&
	                    threadGroupRecord.status !== "active" &&
	                    hasPausedResumeAccess(threadGroupRecord),
	                );
	                const showThreadGroupAction = Boolean(
	                  threadIsGroup &&
	                    !selectionMode &&
	                    !thread.sharedAccess &&
	                    threadGroupRecord?.accessRole !== "shared_admin" &&
	                    (!threadGroupRecord || threadLinkedToOtherUser || threadGroupNeedsResume),
	                );
                const threadGroupActionBusy = threadGroupActionBusyKey === threadKey;
                return (
                  <div key={threadKey} className={styles.threadRowShell}>
                    <button
                    type="button"
                    data-thread-row="true"
                    className={`${styles.threadButton} ${showThreadGroupAction ? styles.threadButtonWithGroupAction : ""} ${thread.chatJid === selectedChatJid ? styles.threadButtonActive : ""} ${pinnedChatJids.has(thread.chatJid) ? styles.threadButtonPinned : ""} ${thread.muted ? styles.threadButtonMuted : ""} ${threadSelected ? styles.threadButtonSelected : ""}`}
                    onClick={() => {
                      clearThreadLongPressTimer();
                      if (threadLongPressTriggeredRef.current) {
                        threadLongPressTriggeredRef.current = false;
                        return;
                      }
                      if (selectionMode) {
                        toggleThreadSelection(thread);
                        return;
                      }
                      setSelectedChatJid(thread.chatJid);
                      setMobileChatOpenState(true);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (selectionMode) {
                        toggleThreadSelection(thread);
                      } else {
                        openThreadActions(thread);
                      }
                    }}
                    onPointerDown={() => {
                      clearThreadLongPressTimer();
                      threadLongPressTriggeredRef.current = false;
                      threadLongPressTimerRef.current = window.setTimeout(() => {
                        threadLongPressTriggeredRef.current = true;
                        toggleThreadSelection(thread);
                      }, 560);
                    }}
                    onPointerUp={clearThreadLongPressTimer}
                    onPointerLeave={clearThreadLongPressTimer}
                    onPointerCancel={clearThreadLongPressTimer}
                  >
                    <span className={styles.threadAvatarWrap}>
                      <Avatar thread={thread} instance={selectedInstance} />
                      {threadSelected ? (
                        <span className={styles.threadSelectBadge}>
                          <IconChecks size={15} />
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.threadMeta}>
                      <span className={styles.threadTop}>
                        <span className={styles.threadTitle}>{getThreadTitle(thread, selectedInstance)}</span>
                        <span className={styles.threadTime}>{formatTime(thread.lastMessageAt)}</span>
                      </span>
                      <span className={styles.threadSubtitleLine}>{getThreadSubtitle(thread, selectedInstance)}</span>
	                      <span className={styles.threadPreviewLine}>
	                        {thread.lastMessageDirection === "outbound" ? <IconChecks size={15} /> : null}
	                        <span>{getThreadPreview(thread, selectedInstance)}</span>
	                        {pinnedChatJids.has(thread.chatJid) ? <IconBell size={14} /> : null}
	                        {thread.muted ? <IconBellOff size={14} /> : null}
	                        {thread.unreadCount > 0 ? <span className={styles.unreadBadge}>{thread.unreadCount}</span> : null}
	                      </span>
                      <span className={styles.threadGroupPlanLine}>
                        <span className={`${styles.threadTags} ${styles[`threadTag_${resolveThreadChatType(thread)}`] ?? ""}`}>
                          {getChatKindLabel(thread)}
                        </span>
                        {threadGroupBadge ? (
                          <span className={`${styles.threadPlanBadge} ${styles[`threadPlanBadge_${threadGroupBadge.variant}`] ?? ""}`}>
                            {threadGroupBadge.label}
                          </span>
                        ) : null}
	                      </span>
	                    </span>
                  </button>
                    {showThreadGroupAction ? (
                      <button
                        type="button"
                        className={`${styles.threadGroupPlanAction} ${threadLinkedToOtherUser ? styles.threadGroupPlanActionBlocked : ""}`}
                        onClick={() => void handleThreadGroupPlanAction(thread)}
                        disabled={threadGroupActionBusy || threadLinkedToOtherUser}
                        aria-label={`${threadGroupActionLabel} ${getThreadTitle(thread, selectedInstance)}`}
                      >
                        {threadGroupActionBusy ? "..." : threadGroupActionLabel}
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

        </aside>

        <section className={`${styles.chatPanel} ${mobileChatOpen ? styles.chatPanelOpenMobile : ""}`}>
          <div className={styles.conversationHeader}>
            <div
              className={`${styles.chatIdentity} ${selectedThread ? styles.chatIdentityClickable : ""} ${canEditSelectedGroup ? styles.chatIdentityEditable : ""}`}
              role={selectedThread ? "button" : undefined}
              tabIndex={selectedThread ? 0 : undefined}
              onClick={handleChatIdentityOpen}
              onContextMenu={(event) => {
                if (!canEditSelectedGroup) return;
                event.preventDefault();
                openGroupEditor();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleChatIdentityOpen();
                }
              }}
            >
              <button
                type="button"
                className={`${styles.headerIconButton} ${styles.mobileBack}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMobileChatOpenState(false);
                }}
                aria-label="Voltar"
              >
                <IconArrowLeft size={22} />
              </button>
              <span className={styles.chatAvatar}>
                {selectedThread?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedThread.avatarUrl} alt={getThreadTitle(selectedThread, selectedInstance)} />
                ) : selectedThread ? (
                  resolveThreadChatType(selectedThread) === "contact" ? getInitials(getThreadTitle(selectedThread, selectedInstance)) : renderChatTypeIcon(selectedThread, 22)
                ) : (
                  <IconBrandWhatsapp size={22} />
                )}
              </span>
              <span className={styles.chatTitleBlock}>
                <strong>{getThreadTitle(selectedThread, selectedInstance)}</strong>
                <small>
                  {selectedThread
                    ? `${getThreadSubtitle(selectedThread, selectedInstance)} • ${getLastDirectionLabel(selectedThread.lastMessageDirection)}`
                    : selectedInstance?.name ?? ""}
                </small>
              </span>
            </div>
            <div className={styles.chatActions}>
              <span className={styles.conversationKindChip}>
                {getChatKindLabel(selectedThread)}
              </span>
	              <span className={`${styles.instanceStateChip} ${selectedInstance?.sessionStatus === "conectado" ? styles.instanceStateChipOnline : ""}`}>
	                {getInstanceStatusLabel(selectedInstance?.sessionStatus)}
	              </span>
	              {selectedChatType === "group" && selectedGroupRecord ? (
	                <button
	                  type="button"
	                  className={styles.profileRenewHeaderButton}
	                  onClick={() => void requestProfileUnlimitedPayment(selectedGroupRecord)}
	                  aria-label="Renovar perfil"
	                  title="Renovar perfil"
	                >
	                  <IconWallet size={16} />
	                  <span>Renovar perfil</span>
	                </button>
	              ) : null}
	              <button
	                type="button"
	                className={`${styles.headerIconButton} ${selectedCall ? styles.callHeaderButtonActive : ""}`}
                onClick={() => {
                  if (selectedCall) {
                    void runSelectedWhatsappCallAction(selectedCallIncoming ? "accept" : "end");
                    return;
                  }
                  void runSelectedWhatsappCallAction("start");
                }}
                disabled={selectedCallBusy || (!selectedCall && !canUseSelectedWhatsappCall)}
                aria-label={selectedCall ? (selectedCallIncoming ? "Atender chamada" : "Encerrar chamada") : "Iniciar chamada"}
                title={
                  selectedCall
                    ? selectedCallIncoming
                      ? "Atender chamada"
                      : "Encerrar chamada"
                    : canUseSelectedWhatsappCall
                      ? "Ligar pela instância"
                      : "Chamadas apenas em conversas privadas com instância conectada"
                }
              >
                {selectedCallBusy ? (
                  <Spinner animation="border" size="sm" />
                ) : selectedCall ? (
                  selectedCallIncoming ? <IconPhoneCall size={20} /> : <IconPhoneOff size={20} />
                ) : (
                  <IconPhoneCall size={20} />
                )}
              </button>
              <button
                type="button"
                className={styles.headerIconButton}
                onClick={() => setMessageSearchOpen((value) => !value)}
                aria-label="Pesquisar na conversa"
              >
                <IconSearch size={20} />
              </button>
            </div>
          </div>

          {selectedCall ? (
            <div className={styles.callBanner}>
              <div>
                <strong>{getCallStatusLabel(selectedCall)}</strong>
                <span>
                  {selectedCallIncoming
                    ? "Recebida pela instância conectada"
                    : callAudioStatus === "connected"
                      ? "Áudio conectado pelo BotAdmin"
                      : callAudioStatus === "connecting"
                        ? "Conectando áudio..."
                        : callAudioStatus === "error"
                          ? callAudioError || "Áudio indisponível"
                          : "Realizada pela instância conectada"}
                </span>
              </div>
              <div className={styles.callBannerActions}>
                {selectedCallIncoming ? (
                  <button
                    type="button"
                    className={styles.callAcceptButton}
                    onClick={() => void runSelectedWhatsappCallAction("accept")}
                    disabled={selectedCallBusy}
                  >
                    <IconPhoneCall size={17} />
                    Atender
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.callEndButton}
                  onClick={() => void runSelectedWhatsappCallAction(selectedCallIncoming ? "reject" : "end")}
                  disabled={selectedCallBusy}
                >
                  <IconPhoneOff size={17} />
                  {selectedCallIncoming ? "Recusar" : "Encerrar"}
                </button>
              </div>
            </div>
          ) : null}

          {messageSearchOpen ? (
            <div className={styles.messageSearchBar}>
              <IconSearch size={18} />
              <input
                autoFocus
                value={messageSearchQuery}
                onChange={(event) => setMessageSearchQuery(event.target.value)}
                placeholder="Pesquisar na conversa"
              />
              <span>{messageSearchQuery.trim() ? `${visibleMessages.length}/${conversationMessageCount}` : ""}</span>
              <button
                type="button"
                onClick={() => {
                  setMessageSearchOpen(false);
                  setMessageSearchQuery("");
                }}
                aria-label="Fechar busca"
              >
                <IconX size={18} />
              </button>
            </div>
          ) : null}

          {!selectedChatJid ? (
            <div className={styles.emptyChatState}>
              <IconBrandWhatsapp size={44} />
              <strong>Selecione uma conversa</strong>
              <span>As mensagens da instância aparecem aqui no mesmo fluxo do WhatsApp Web.</span>
            </div>
          ) : (
            <>
              {selectedChatType === "group" && selectedThreadLinkedToOtherUser ? (
                <div className={`${styles.groupPremiumOverlay} ${styles.groupPremiumOverlayBlocked}`}>
                  <span className={styles.groupPremiumIcon}>
                    <IconWallet size={18} />
                  </span>
                  <span>
                    <strong>Grupo já vinculado a outro usuário</strong>
                    <small>Este grupo não pode receber assinatura em mais de uma conta.</small>
                  </span>
                </div>
              ) : selectedChatType === "group" && selectedGroupRecord && !selectedGroupHasPremium ? (
                <div className={styles.groupPremiumOverlay}>
                  <span className={styles.groupPremiumIcon}>
                    <IconWallet size={18} />
                  </span>
                  <span>
                    <strong>{selectedGroupPlanState.title}</strong>
                    <small>{selectedGroupPlanState.subtitle}</small>
                  </span>
	                </div>
	              ) : null}
              <div className={styles.messages}>
                {conversationReadOnly ? (
                  <div className={styles.readOnlyNotice}>{readOnlyReason}</div>
                ) : null}
                {messageHistoryHasMore ? (
                  <button
                    type="button"
                    className={styles.historyLoadButton}
                    onClick={() => void loadOlderMessages()}
                    disabled={loadingOlderMessages}
                  >
                    {loadingOlderMessages ? (
                      <Spinner animation="border" size="sm" />
                    ) : (
                      <IconRefresh size={15} />
                    )}
                    <span>{loadingOlderMessages ? "Carregando histórico..." : "Carregar histórico anterior"}</span>
                  </button>
                ) : messages.length > 0 && !loadingMessages ? (
                  <div className={styles.historyBoundary}>Histórico disponível carregado.</div>
                ) : null}
                <div className={styles.noticePill}>
                  As mensagens são carregadas da instância conectada. Use template aprovado para iniciar conversa fora da janela do WhatsApp.
                </div>
                {loadingMessages ? (
                  <div className={styles.emptyState}>
                    <Spinner animation="border" />
                  </div>
                ) : visibleMessages.length === 0 ? (
                  <div className={styles.noticePill}>
                    {messageSearchQuery.trim() ? "Nenhuma mensagem encontrada nessa busca." : "Nenhuma mensagem registrada para esta conversa."}
                  </div>
                ) : (
                  visibleMessages.map((message, index) => {
                    const currentDate = formatDateSeparator(message.timestamp);
                    const previousDate = index > 0 ? formatDateSeparator(visibleMessages[index - 1]?.timestamp) : "";
                    const showDateSeparator = currentDate && currentDate !== previousDate;
                    return (
                      <Fragment key={`${message.id}-${message.messageId ?? ""}`}>
                        {showDateSeparator ? <div className={styles.dateSeparator}>{currentDate}</div> : null}
                        <MessageBubble
                          message={message}
                          instanceId={selectedThreadInstanceId}
                          thread={selectedThread}
                          instance={selectedInstance}
                          reactionGroups={reactionGroupsByMessageId.get(getMessageReactionTargetKey(message)) ?? []}
                          onOpenActions={openMessageActions}
                          onOpenReactions={(targetMessage, groups) => setReactionModal({ message: targetMessage, groups })}
                          onOpenProfile={setProfileModal}
                          deletedContentVisible={revealedDeletedMessageIds.has(message.messageId || String(message.id))}
                        />
                      </Fragment>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <Form className={styles.composerShell} onSubmit={sendMessage}>
	                {replyTarget ? (
                  <div className={styles.replyComposerPreview}>
                    <span>
                      <strong>Respondendo {replyTarget.senderName || (replyTarget.direction === "outbound" ? "você" : "mensagem")}</strong>
                      <small>{getMessageBodyText(replyTarget) || describeMedia(replyTarget)}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTarget(null)}
                      aria-label="Cancelar resposta"
                    >
                      <IconX size={16} />
                    </button>
	                  </div>
	                ) : null}
	                {canShowMentionAllToggle ? (
	                  <button
	                    type="button"
	                    className={`${styles.mentionAllToggle} ${mentionAll ? styles.mentionAllToggleOn : ""}`}
	                    onClick={() => setMentionAll((value) => !value)}
	                    aria-pressed={mentionAll}
	                  >
	                    <span className={styles.mentionAllSwitch} aria-hidden="true">
	                      <span />
	                    </span>
	                    <span className={styles.mentionAllText}>
	                      <strong>Mencionar todos</strong>
	                      <small>
	                        {mentionTargets.length > 0
	                          ? `${mentionTargets.length} participantes`
	                          : "todos os participantes do grupo"}
	                      </small>
	                    </span>
	                  </button>
	                ) : null}
	                {pendingFile ? (
                  <div className={styles.pendingFile}>
                    {pendingFilePreviewUrl && pendingFileType === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.pendingFilePreview} src={pendingFilePreviewUrl} alt="" />
                    ) : pendingFilePreviewUrl && pendingFileType === "video" ? (
                      <video className={styles.pendingFilePreview} src={pendingFilePreviewUrl} muted playsInline />
                    ) : pendingFilePreviewUrl && pendingFileType === "audio" ? (
                      <audio src={pendingFilePreviewUrl} controls preload="metadata" />
                    ) : (
                      <span className={styles.pendingFilePreview}>
                        <IconPaperclip size={20} />
                      </span>
                    )}
                    <span className={styles.pendingFileMeta}>
                      <strong>{pendingFile.name}</strong>
                      <small>{formatFileSize(pendingFile.size) || pendingFile.type || "Arquivo"}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingFile(null)}
                      aria-label="Remover arquivo"
                    >
                      <IconX size={16} />
                    </button>
                  </div>
                ) : null}
                <div className={styles.composer}>
                  <div className={styles.emojiWrap}>
                    <button
                      type="button"
                      className={styles.composerIcon}
                      onClick={() => setEmojiOpen((value) => !value)}
                      aria-label="Emojis"
                      disabled={conversationReadOnly}
                    >
                      <IconMoodSmile size={23} />
                    </button>
                    {emojiOpen ? (
                      <div className={styles.emojiPanel}>
                        {["😀", "😂", "😍", "🔥", "🙏", "👍", "✅", "🚀", "💰", "📦", "🤖", "❤️"].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              setComposer((current) => `${current}${emoji}`);
                              setEmojiOpen(false);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <label className={styles.composerIcon} aria-label="Anexar">
                    <IconPaperclip size={22} />
                    <input
                      type="file"
                      className="visually-hidden"
                      disabled={conversationReadOnly}
                      onChange={(event) => setPendingFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.composerRobotButton}
                    onClick={openToolsCanvas}
                    disabled={!selectedThread}
                    aria-label="Abrir ferramentas da conversa"
                    title="Ações do robô"
                  >
                    <IconRobot size={18} strokeWidth={1.75} />
                  </button>
                  <input
                    ref={composerInputRef}
                    value={composer}
                    disabled={conversationReadOnly}
                    onChange={(event) => setComposer(event.target.value)}
                    placeholder={conversationReadOnly ? "Conversa em modo leitura" : "Mensagem"}
                  />
                  {canSendComposer ? (
                    <button
                      type="submit"
                      className={styles.sendButton}
                      disabled={conversationReadOnly}
                      aria-label="Enviar mensagem"
                    >
                      <IconSend size={20} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.sendButton} ${isRecordingAudio ? styles.sendButtonRecording : ""}`}
                      disabled={conversationReadOnly}
                      aria-label={isRecordingAudio ? "Solte para finalizar áudio" : "Segure para gravar áudio"}
                      onPointerDown={(pointerEvent) => {
                        pointerEvent.preventDefault();
                        pointerEvent.currentTarget.setPointerCapture?.(pointerEvent.pointerId);
                        recordingHoldActiveRef.current = true;
                        void startAudioRecording();
                      }}
                      onPointerUp={(pointerEvent) => {
                        pointerEvent.preventDefault();
                        pointerEvent.currentTarget.releasePointerCapture?.(pointerEvent.pointerId);
                        stopAudioRecording();
                      }}
                      onPointerCancel={stopAudioRecording}
                      onPointerLeave={() => {
                        if (isRecordingAudio) stopAudioRecording();
                      }}
                    >
                      {isRecordingAudio ? <Spinner animation="border" size="sm" /> : <IconMicrophone size={20} />}
                    </button>
                  )}
                </div>
              </Form>
            </>
          )}
        </section>

        <aside className={styles.detailsPane}>
          <div className={styles.detailsHeader}>
            <div>
              <h2>Detalhes da conversa</h2>
              <p>dados do WhatsApp</p>
            </div>
            <span>{selectedInstance?.name ?? "BotAdmin"}</span>
          </div>
          <div className={styles.detailsScroll}>
            <section className={styles.detailsCard}>
              <div className={styles.detailsCardTitle}>
                <strong>{getChatKindLabel(selectedThread)}</strong>
                {renderChatTypeIcon(selectedThread)}
              </div>
              {selectedThread ? (
                <>
                  <div className={styles.customerHead}>
                    <span className={styles.customerAvatar}>
                      {selectedThread.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={selectedThread.avatarUrl} alt={getThreadTitle(selectedThread, selectedInstance)} />
                      ) : resolveThreadChatType(selectedThread) === "contact" ? (
                        getInitials(getThreadTitle(selectedThread, selectedInstance))
                      ) : (
                        renderChatTypeIcon(selectedThread, 24)
                      )}
                    </span>
                    <span>
                      <strong>{getThreadTitle(selectedThread, selectedInstance)}</strong>
                      <small>{getThreadSubtitle(selectedThread, selectedInstance) || selectedThread.chatJid}</small>
                    </span>
                  </div>

                  <div className={styles.detailBadgeRow}>
                    <span className={styles.detailBadge}>{getChatKindLabel(selectedThread)}</span>
                    <span className={styles.detailBadge}>{getDirectorySourceLabel(selectedThread)}</span>
                    {conversationReadOnly ? <span className={styles.detailBadgeWarn}>Leitura</span> : null}
                  </div>

                  <div className={styles.detailInfoList}>
                    <div className={styles.detailInfoRow}>
                      <span>JID</span>
                      <strong>{selectedThread.chatJid}</strong>
                    </div>
                    <div className={styles.detailInfoRow}>
                      <span>Telefone</span>
                      <strong>{selectedThread.phone ? formatPhone(selectedThread.phone) : "Não se aplica"}</strong>
                    </div>
                    <div className={styles.detailInfoRow}>
                      <span>Instância</span>
                      <strong>{selectedInstance ? getInstanceDisplayName(selectedInstance) : "Não selecionada"}</strong>
                    </div>
                    <div className={styles.detailInfoRow}>
                      <span>Status da instância</span>
                      <strong>{getInstanceStatusLabel(selectedInstance?.sessionStatus)}</strong>
                    </div>
                    <div className={styles.detailInfoRow}>
                      <span>Última atividade</span>
                      <strong>{formatLongDateTime(selectedThread.lastMessageAt)}</strong>
                    </div>
                    <div className={styles.detailInfoRow}>
                      <span>Última direção</span>
                      <strong>{getLastDirectionLabel(selectedThread.lastMessageDirection)}</strong>
                    </div>
                    <div className={styles.detailInfoRow}>
                      <span>Janela 24h</span>
                      <strong className={styles[`windowTone_${serviceWindow.tone}`] ?? ""}>{serviceWindow.label}</strong>
                    </div>
                  </div>

                  <div className={styles.metricGrid}>
                    <div>
                      <span>Mensagens</span>
                      <strong>{conversationMessageCount}</strong>
                    </div>
                    <div>
                      <span>Não lidas</span>
                      <strong>{selectedThread.unreadCount}</strong>
                    </div>
                    <div>
                      <span>Fluxos</span>
                      <strong>{flowShortcuts.length}</strong>
                    </div>
                  </div>

                  {resolveThreadChatType(selectedThread) === "group" ? (
                    <>
                      <div className={styles.detailInfoList}>
                        <div className={styles.detailInfoRow}>
                          <span>Modo do grupo</span>
                          <strong>{getGroupModeLabel(selectedThread)}</strong>
                        </div>
                        <div className={styles.detailInfoRow}>
                          <span>Instância é admin</span>
                          <strong>{getAdminLabel(selectedThread)}</strong>
                        </div>
                        <div className={styles.detailInfoRow}>
                          <span>Participantes</span>
                          <strong>{selectedThread.participantsCount ?? "Não informado"}</strong>
                        </div>
                        <div className={styles.detailInfoRow}>
                          <span>Menções em massa</span>
                          <strong>{selectedThread.mentionable === false ? "Bloqueada" : "Permitida"}</strong>
                        </div>
                        {selectedThread.groupDescription ? (
                          <div className={styles.detailInfoRow}>
                            <span>Descrição</span>
                            <strong>{selectedThread.groupDescription}</strong>
                          </div>
                        ) : null}
                      </div>

                      <section className={styles.participantPanel}>
                        <div className={styles.participantPanelHeader}>
                          <div>
                            <strong>Participantes</strong>
                            <span>{selectedGroupParticipants.length || selectedThread.participantsCount || 0} no grupo</span>
                          </div>
                          <div className={styles.participantPanelActions}>
                            {canModerateSelectedGroup ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setParticipantAddOpen(true);
                                  setParticipantActionError(null);
                                }}
                                disabled={Boolean(participantActionSaving)}
                              >
                                Adicionar
                              </button>
                            ) : null}
                            {selectedLinkedGroupId ? (
                              <button
                                type="button"
                                onClick={() => void loadGroupControls(selectedLinkedGroupId, { refreshParticipants: true })}
                                disabled={loadingGroupControls}
                                aria-label="Atualizar participantes"
                              >
                                {loadingGroupControls ? <Spinner animation="border" size="sm" /> : <IconRefresh size={15} />}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {groupControlsError ? (
                          <div className={styles.groupControlError}>{groupControlsError}</div>
                        ) : null}

                        {!selectedLinkedGroupId ? (
                          <div className={styles.groupControlEmpty}>
                            <span>Vincule este grupo para carregar participantes e liberar ações de admin.</span>
                            <button
                              type="button"
                              onClick={() => void linkSelectedGroupFromChat()}
                              disabled={savingGroupControl === "link"}
                            >
                              {savingGroupControl === "link" ? "Vinculando..." : "Vincular grupo"}
                            </button>
                          </div>
                        ) : loadingGroupControls && !selectedGroupRecord ? (
                          <div className={styles.groupControlEmpty}>
                            <span>Carregando participantes...</span>
                          </div>
                        ) : selectedGroupParticipants.length === 0 ? (
                          <div className={styles.groupControlEmpty}>
                            <span>Nenhum participante sincronizado ainda.</span>
                            <button
                              type="button"
                              onClick={() => selectedLinkedGroupId && void loadGroupControls(selectedLinkedGroupId, { refreshParticipants: true })}
                              disabled={loadingGroupControls}
                            >
                              Atualizar da EasyZap
                            </button>
                          </div>
                        ) : (
                          <div className={styles.participantList}>
                            {selectedGroupParticipants.map((participant) => {
                              const title = getParticipantDisplayName(participant);
                              const subtitle = getParticipantSubtitle(participant);
                              const avatarUrl = getParticipantAvatarUrl(participant);
                              const role = getParticipantRoleLabel(participant);
                              return (
                                <button
                                  key={`${participant.id}-${participant.admin ?? "member"}`}
                                  type="button"
                                  className={styles.participantRow}
                                  onClick={() => {
                                    clearParticipantLongPressTimer();
                                    if (participantLongPressTriggeredRef.current) {
                                      participantLongPressTriggeredRef.current = false;
                                      return;
                                    }
                                    setProfileModal({
                                      title,
                                      subtitle,
                                      phone: formatPhone(getParticipantDigits(participant)) || null,
                                      jid: participant.id,
                                      avatarUrl,
                                      kind: role,
                                    });
                                  }}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    openParticipantActions(participant);
                                  }}
                                  onPointerDown={() => {
                                    clearParticipantLongPressTimer();
                                    participantLongPressTriggeredRef.current = false;
                                    participantLongPressTimerRef.current = window.setTimeout(() => {
                                      participantLongPressTriggeredRef.current = true;
                                      openParticipantActions(participant);
                                    }, 560);
                                  }}
                                  onPointerUp={clearParticipantLongPressTimer}
                                  onPointerLeave={clearParticipantLongPressTimer}
                                  onPointerCancel={clearParticipantLongPressTimer}
                                >
                                  <span className={styles.participantAvatar}>
                                    {avatarUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={avatarUrl} alt={title} />
                                    ) : (
                                      getInitials(title)
                                    )}
                                  </span>
                                  <span className={styles.participantMeta}>
                                    <strong>{title}</strong>
                                    <small>{subtitle}</small>
                                  </span>
                                  <span className={`${styles.participantRole} ${participant.admin !== "member" ? styles.participantRoleAdmin : ""}`}>
                                    {role}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    </>
                  ) : null}
                </>
              ) : (
                <div className={styles.detailsEmpty}>
                  <IconUserCircle size={34} />
                  <strong>Nenhuma conversa selecionada</strong>
                  <span>Selecione um usuário, grupo ou canal para ver os dados.</span>
                </div>
              )}
            </section>
          </div>
        </aside>

      {threadActionTarget ? (
        <div
          className={styles.threadActionsOverlay}
          role="presentation"
          onClick={() => setThreadActionTarget(null)}
        >
          <section
            className={styles.threadActionsSheet}
            role="dialog"
            aria-modal="true"
            aria-label="Opções da conversa"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.threadActionsHeader}>
              <div>
                <strong>{getChatKindLabel(threadActionTarget)}</strong>
                <span>{getThreadTitle(threadActionTarget, selectedInstance)}</span>
              </div>
              <button type="button" onClick={() => setThreadActionTarget(null)} aria-label="Fechar">
                <IconX size={18} />
              </button>
            </header>
            {threadActionError ? <div className={styles.messageActionError}>{threadActionError}</div> : null}
            <div className={styles.threadActionList}>
              <button type="button" onClick={togglePinnedThread} disabled={Boolean(threadActionSaving)}>
                <IconBell size={18} />
                <span>
                  {threadActionSaving === "pin"
                    ? "Salvando..."
                    : pinnedChatJids.has(threadActionTarget.chatJid)
                      ? "Desfixar conversa"
                      : "Fixar conversa"}
                </span>
              </button>
              {!threadActionTarget.sharedAccess && selectedInstanceId !== SHARED_CONVERSATIONS_INSTANCE_ID ? (
                <button type="button" onClick={() => void toggleArchivedThread()} disabled={Boolean(threadActionSaving)}>
                  <IconArchive size={18} />
                  <span>
                    {threadActionSaving === "archive"
                      ? "Salvando..."
                      : threadActionTarget.archived
                        ? "Desarquivar conversa"
                        : "Arquivar conversa"}
                  </span>
                </button>
              ) : null}
              <button type="button" onClick={() => void toggleThreadMuted()} disabled={Boolean(threadActionSaving)}>
                <IconBellOff size={18} />
                <span>
                  {threadActionSaving === "mute"
                    ? "Salvando..."
                    : threadActionTarget.muted
                      ? "Reativar notificações"
                      : "Silenciar notificações"}
                </span>
              </button>
              {canEditThreadActionGroup ? (
                <button type="button" onClick={openThreadActionGroupEditor} disabled={Boolean(threadActionSaving)}>
                  <IconPencil size={18} />
                  <span>Editar grupo</span>
                </button>
              ) : null}
              {!threadActionTarget.sharedAccess && selectedInstanceId !== SHARED_CONVERSATIONS_INSTANCE_ID ? (
                <button
                  type="button"
                  className={styles.threadActionDanger}
                  onClick={() => void deleteThreadFromHistory()}
                  disabled={Boolean(threadActionSaving)}
                >
                  <IconTrash size={18} />
                  <span>
                    {threadActionSaving === "delete"
                      ? "Apagando..."
                      : resolveThreadChatType(threadActionTarget) === "group"
                        ? "Limpar mensagens do WhatsApp"
                        : "Apagar chat do WhatsApp"}
                  </span>
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {messageActionTarget ? (
        <div
          className={styles.messageActionsOverlay}
          role="presentation"
          onClick={() => setMessageActionTarget(null)}
        >
          <section
            className={styles.messageActionsSheet}
            role="dialog"
            aria-modal="true"
            aria-label="Opções da mensagem"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.messageActionsHeader}>
              <div>
                <strong>Mensagem</strong>
                <span>{getMessageBodyText(messageActionTarget) || describeMedia(messageActionTarget)}</span>
              </div>
              <button type="button" onClick={() => setMessageActionTarget(null)} aria-label="Fechar">
                <IconX size={18} />
              </button>
            </header>
            {messageActionError ? <div className={styles.messageActionError}>{messageActionError}</div> : null}
            <div className={styles.reactionRow}>
              {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => void runMessageAction("react", emoji)}
                  disabled={Boolean(messageActionSaving)}
                  aria-label={`Reagir com ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className={styles.messageActionList}>
              {messageActionTarget.deletedAt && messageActionTarget.revealDeletedContent === true ? (
                <button type="button" onClick={() => toggleDeletedMessageReveal()} disabled={Boolean(messageActionSaving)}>
                  {revealedDeletedMessageIds.has(messageActionTarget.messageId || String(messageActionTarget.id)) ? (
                    <IconEyeOff size={18} />
                  ) : (
                    <IconEye size={18} />
                  )}
                  <span>
                    {revealedDeletedMessageIds.has(messageActionTarget.messageId || String(messageActionTarget.id))
                      ? "Ocultar mensagem apagada"
                      : "Revelar mensagem apagada"}
                  </span>
                </button>
              ) : null}
              <button type="button" onClick={() => void runMessageAction("reply")} disabled={Boolean(messageActionSaving)}>
                <IconMessageCircle size={18} />
                <span>Responder</span>
              </button>
              <button type="button" onClick={() => void copyMessageText()} disabled={Boolean(messageActionSaving)}>
                <IconCopy size={18} />
                <span>Copiar texto</span>
              </button>
              <button type="button" onClick={() => void runMessageAction("delete")} disabled={Boolean(messageActionSaving)}>
                <IconTrash size={18} />
                <span>{messageActionSaving === "delete" ? "Apagando..." : "Apagar para todos"}</span>
              </button>
              <button type="button" onClick={() => void runMessageAction("pin")} disabled={Boolean(messageActionSaving)}>
                <IconBell size={18} />
                <span>{messageActionSaving === "pin" ? "Fixando..." : "Fixar mensagem"}</span>
              </button>
            </div>
            {messageParticipantActionTarget ? (
              <div className={styles.participantActionBlock}>
                <div className={styles.participantActionBlockTitle}>
                  <strong>{getParticipantDisplayName(messageParticipantActionTarget.participant)}</strong>
                  <span>{getParticipantSubtitle(messageParticipantActionTarget.participant)}</span>
                </div>
                {renderParticipantActionButtons(messageParticipantActionTarget)}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {participantActionTarget ? (
        <div
          className={styles.messageActionsOverlay}
          role="presentation"
          onClick={() => setParticipantActionTarget(null)}
        >
          <section
            className={styles.messageActionsSheet}
            role="dialog"
            aria-modal="true"
            aria-label="Opções do participante"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.messageActionsHeader}>
              <div>
                <strong>{getParticipantDisplayName(participantActionTarget.participant)}</strong>
                <span>{getParticipantSubtitle(participantActionTarget.participant)}</span>
              </div>
              <button type="button" onClick={() => setParticipantActionTarget(null)} aria-label="Fechar">
                <IconX size={18} />
              </button>
            </header>
            {participantActionError ? <div className={styles.messageActionError}>{participantActionError}</div> : null}
            <div className={styles.participantActionProfile}>
              <span className={styles.participantAvatar}>
                {getParticipantAvatarUrl(participantActionTarget.participant) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getParticipantAvatarUrl(participantActionTarget.participant)!}
                    alt={getParticipantDisplayName(participantActionTarget.participant)}
                  />
                ) : (
                  getInitials(getParticipantDisplayName(participantActionTarget.participant))
                )}
              </span>
              <span>
                <strong>{getParticipantRoleLabel(participantActionTarget.participant)}</strong>
                <small>{participantActionTarget.participant.id}</small>
              </span>
            </div>
            {renderParticipantActionButtons(participantActionTarget)}
          </section>
        </div>
      ) : null}

      {banConfirmTarget ? (
        <div
          className={styles.messageActionsOverlay}
          role="presentation"
          onClick={closeBanConfirm}
        >
          <section
            className={styles.messageActionsSheet}
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar banimento"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.messageActionsHeader}>
              <div>
                <strong>Banir usuário do grupo?</strong>
                <span>{getParticipantDisplayName(banConfirmTarget.participant)}</span>
              </div>
              <button type="button" onClick={closeBanConfirm} aria-label="Fechar">
                <IconX size={18} />
              </button>
            </header>
            <div className={styles.confirmOptions}>
              <label>
                <input
                  type="checkbox"
                  checked={banDeleteRecentMessages}
                  onChange={(event) => setBanDeleteRecentMessages(event.target.checked)}
                />
                <span>Apagar últimas mensagens dele</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={banAddToBlacklist}
                  onChange={(event) => setBanAddToBlacklist(event.target.checked)}
                />
                <span>Adicionar número na blacklist</span>
              </label>
            </div>
            <footer className={styles.confirmFooter}>
              <button type="button" onClick={closeBanConfirm} disabled={Boolean(participantActionSaving)}>
                Não
              </button>
              <button
                type="button"
                className={styles.confirmDanger}
                onClick={() =>
                  void runParticipantAction(banConfirmTarget, "remove", {
                    deleteRecentMessages: banDeleteRecentMessages,
                    addToBlacklist: banAddToBlacklist,
                  })
                }
                disabled={Boolean(participantActionSaving)}
              >
                {participantActionSaving ? "Banindo..." : "Sim, banir"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {participantAddOpen ? (
        <div
          className={styles.messageActionsOverlay}
          role="presentation"
          onClick={() => setParticipantAddOpen(false)}
        >
          <form
            className={styles.messageActionsSheet}
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar participante"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitAddParticipant();
            }}
          >
            <header className={styles.messageActionsHeader}>
              <div>
                <strong>Adicionar participante</strong>
                <span>{selectedThread ? getThreadTitle(selectedThread, selectedInstance) : "Grupo"}</span>
              </div>
              <button type="button" onClick={() => setParticipantAddOpen(false)} aria-label="Fechar">
                <IconX size={18} />
              </button>
            </header>
            {participantActionError ? <div className={styles.messageActionError}>{participantActionError}</div> : null}
            <div className={styles.participantAddBody}>
              <label>
                <span>Número do WhatsApp</span>
                <input
                  value={participantAddDraft}
                  onChange={(event) => setParticipantAddDraft(event.target.value)}
                  placeholder="5592999999999"
                  inputMode="tel"
                />
              </label>
            </div>
            <footer className={styles.confirmFooter}>
              <button type="button" onClick={() => setParticipantAddOpen(false)} disabled={Boolean(participantActionSaving)}>
                Cancelar
              </button>
              <button type="submit" disabled={Boolean(participantActionSaving)}>
                {participantActionSaving ? "Adicionando..." : "Adicionar"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {reactionModal ? (
        <div
          className={styles.profileOverlay}
          role="presentation"
          onClick={() => setReactionModal(null)}
        >
          <section
            className={styles.reactionModal}
            role="dialog"
            aria-modal="true"
            aria-label="Reações da mensagem"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.profileCloseButton}
              onClick={() => setReactionModal(null)}
              aria-label="Fechar reações"
            >
              <IconX size={18} />
            </button>
            <header className={styles.reactionModalHeader}>
              <strong>Reações</strong>
              <span>{getMessageBodyText(reactionModal.message) || describeMedia(reactionModal.message)}</span>
            </header>
            <div className={styles.reactionSummaryBar}>
              {reactionModal.groups.map((group) => (
                <span key={group.emoji}>
                  <b>{group.emoji}</b>
                  <strong>{group.count}</strong>
                </span>
              ))}
            </div>
            <div className={styles.reactionPeopleList}>
              {reactionModal.groups.flatMap((group) =>
                group.reactions.map((reaction) => {
                  const title = getReactionActorLabel(reaction);
                  const subtitle = getReactionActorSubtitle(reaction);
                  return (
                    <div className={styles.reactionPersonRow} key={`${group.emoji}-${reaction.id}-${reaction.senderJid ?? ""}`}>
                      <span className={styles.reactionPersonAvatar}>
                        {reaction.senderAvatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={reaction.senderAvatarUrl} alt={title} />
                        ) : (
                          getInitials(title)
                        )}
                      </span>
                      <span className={styles.reactionPersonMeta}>
                        <strong>{title}</strong>
                        {subtitle ? <small>{subtitle}</small> : null}
                      </span>
                      <b className={styles.reactionPersonEmoji}>{reaction.emoji}</b>
                    </div>
                  );
                }),
              )}
            </div>
          </section>
        </div>
      ) : null}

      {profileModal ? (
        <div
          className={styles.profileOverlay}
          role="presentation"
          onClick={() => setProfileModal(null)}
        >
          <section
            className={styles.profileModal}
            role="dialog"
            aria-modal="true"
            aria-label="Perfil da conversa"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.profileCloseButton}
              onClick={() => setProfileModal(null)}
              aria-label="Fechar perfil"
            >
              <IconX size={18} />
            </button>
            <span className={styles.profileAvatarLarge}>
              {profileModal.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profileModal.avatarUrl} alt={profileModal.title} />
              ) : (
                getInitials(profileModal.title)
              )}
            </span>
            <strong>{profileModal.title}</strong>
            <p>{profileModal.subtitle}</p>
            <div className={styles.profileInfoGrid}>
              <span>Tipo</span>
              <strong>{profileModal.kind}</strong>
              {profileModal.phone ? (
                <>
                  <span>Número</span>
                  <strong>{profileModal.phone}</strong>
                </>
              ) : null}
              <span>JID</span>
              <strong>{profileModal.jid}</strong>
            </div>
            {canShowConversationShareEditor ? (
              <div className={styles.profileShareBox}>
                <label className={styles.groupEditorField}>
                  <span>Compartilhar conversa</span>
                  <textarea
                    value={conversationSharesDraft}
                    onChange={(event) => {
                      setConversationSharesDraft(event.target.value);
                      setConversationSharesFeedback(null);
                    }}
                    rows={4}
                    placeholder={"email1@dominio.com\nemail2@dominio.com"}
                    disabled={conversationSharesLoading || conversationSharesSaving}
                  />
                  <small className={styles.groupEditorHint}>
                    {conversationSharesLoading
                      ? "Carregando acessos..."
                      : "Um email por linha. Esses usuários verão somente esta conversa."}
                  </small>
                  {conversationSharesFeedback ? (
                    <small className={styles.groupEditorWarning}>{conversationSharesFeedback}</small>
                  ) : null}
                </label>
                <div className={styles.profileShareActions}>
                  <button
                    type="button"
                    onClick={() => void saveConversationShares()}
                    disabled={conversationSharesLoading || conversationSharesSaving}
                  >
                    {conversationSharesSaving ? "Salvando..." : "Salvar compartilhamento"}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {groupEditorOpen && canEditSelectedGroup && selectedGroupRecord ? (
        <div
          className={styles.groupEditorOverlay}
          role="presentation"
          onClick={() => setGroupEditorOpen(false)}
        >
          <section
            className={styles.groupEditorModal}
            role="dialog"
            aria-modal="true"
            aria-label="Editar grupo"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.groupEditorHeader}>
              <div>
                <strong>Editar grupo</strong>
                <span>{selectedThread ? getThreadSubtitle(selectedThread, selectedInstance) : selectedGroupRecord.remoteId}</span>
              </div>
              <button type="button" onClick={() => setGroupEditorOpen(false)} aria-label="Fechar edição">
                <IconX size={20} />
              </button>
            </header>
            <div className={styles.groupEditorBody}>
              {groupEditorError ? <div className={styles.groupControlError}>{groupEditorError}</div> : null}
              <input
                ref={groupPhotoInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  setGroupPhotoDraft(event.currentTarget.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
              <div className={styles.groupEditorPhotoRow}>
                <span className={styles.groupEditorPhoto}>
                  {selectedThread?.avatarUrl || selectedGroupRecord.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedThread?.avatarUrl || selectedGroupRecord.imageUrl || ""} alt="" />
                  ) : (
                    <IconUsersGroup size={28} />
                  )}
                  <button type="button" onClick={() => groupPhotoInputRef.current?.click()} aria-label="Alterar foto do grupo">
                    <IconCamera size={16} />
                  </button>
                </span>
                <div>
                  <strong>{groupPhotoDraft ? groupPhotoDraft.name : "Foto do grupo"}</strong>
                  <span>Use imagem quadrada para ficar melhor no WhatsApp.</span>
                </div>
              </div>
              <label className={styles.groupEditorField}>
                <span>Nome do grupo</span>
                <input
                  value={groupNameDraft}
                  onChange={(event) => setGroupNameDraft(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label className={styles.groupEditorField}>
                <span>Descrição</span>
                <textarea
                  value={groupDescriptionDraft}
                  onChange={(event) => setGroupDescriptionDraft(event.target.value)}
                  rows={4}
                  maxLength={2000}
                />
              </label>
              <div className={styles.groupEditorToggleGrid}>
                <button
                  type="button"
                  className={groupAdminsOnlyDraft ? styles.activationToggleCardOn : styles.activationToggleCardOff}
                  onClick={() => setGroupAdminsOnlyDraft((value) => !value)}
                >
                  <span>Somente admins</span>
                  <strong>{groupAdminsOnlyDraft ? "Ligado" : "Desligado"}</strong>
                </button>
                <button
                  type="button"
                  className={groupLockedDraft ? styles.activationToggleCardOn : styles.activationToggleCardOff}
                  onClick={() => setGroupLockedDraft((value) => !value)}
                >
                  <span>Editar dados</span>
                  <strong>{groupLockedDraft ? "Bloqueado" : "Aberto"}</strong>
                </button>
              </div>
              <label className={styles.groupEditorField}>
                <span>Mensagens temporárias</span>
                <select value={groupEphemeralDraft || "off"} onChange={(event) => setGroupEphemeralDraft(event.target.value)}>
                  <option value="off">Desligadas</option>
                  <option value="24h">24 horas</option>
                  <option value="7d">7 dias</option>
                  <option value="90d">90 dias</option>
                </select>
              </label>
              {canManageSelectedGroupShares ? (
                <label className={styles.groupEditorField}>
                  <span>Compartilhar administração do grupo</span>
                  <textarea
                    value={groupSharesDraft}
                    onChange={(event) => {
                      setGroupSharesDraft(event.target.value);
                      setGroupSharesFeedback(null);
                    }}
                    rows={4}
                    placeholder={"email1@dominio.com\nemail2@dominio.com"}
                    disabled={groupSharesLoading}
                  />
                  <small className={styles.groupEditorHint}>
                    {groupSharesLoading
                      ? "Carregando acessos..."
                      : "Um email por linha. Esses usuários verão somente este grupo nas conversas."}
                  </small>
                  {groupSharesFeedback ? (
                    <small className={styles.groupEditorWarning}>{groupSharesFeedback}</small>
                  ) : null}
                </label>
              ) : null}
            </div>
            <footer className={styles.groupEditorFooter}>
              <button type="button" onClick={() => setGroupEditorOpen(false)} disabled={groupEditorSaving}>
                Cancelar
              </button>
              <button type="button" onClick={() => void saveGroupEditor()} disabled={groupEditorSaving || !groupNameDraft.trim()}>
                {groupEditorSaving ? "Salvando..." : "Salvar grupo"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {toolsCanvasOpen ? (
        <div
          className={styles.toolsOverlay}
          role="presentation"
          onClick={() => setToolsCanvasOpen(false)}
        >
          <aside
            className={styles.toolsCanvas}
            role="dialog"
            aria-modal="true"
            aria-label="Ações da conversa"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.toolsCanvasHeader}>
              <div>
                <strong>Ações da conversa</strong>
                <span>{selectedThread ? getThreadTitle(selectedThread, selectedInstance) : "Nenhuma conversa"}</span>
              </div>
              <button
                type="button"
                onClick={() => setToolsCanvasOpen(false)}
                aria-label="Fechar ações"
              >
                <IconX size={20} />
              </button>
            </header>

            <div className={styles.toolsCanvasBody}>
              {selectedChatType === "group" ? (
                <section className={styles.toolsSection}>
                  <div className={styles.toolsSectionHeader}>
                    <div>
                      <strong>Grupo</strong>
                      <small>{selectedThread ? getThreadTitle(selectedThread, selectedInstance) : "BotAdmin"}</small>
                    </div>
                    {selectedGroupRecord ? (
	                      <button
	                        type="button"
	                        className={`${styles.groupPlanHeaderPill} ${selectedGroupPlanState.state === "active" ? styles.groupPlanHeaderPillActive : ""}`}
	                        onClick={() => void openSelectedProfileRenewal()}
	                      >
	                        <IconWallet size={15} />
	                        <span>{selectedGroupPlanState.title}</span>
                      </button>
                    ) : (
                      <span>BotAdmin</span>
                    )}
                  </div>
                  <div className={styles.toolsQuickGrid}>
                    {!selectedLinkedGroupId ? (
                      <button
                        type="button"
                        className={`${styles.toolsActionCard} ${styles.toolsActionCardPrimary}`}
                        onClick={() => void linkSelectedGroupFromChat()}
                        disabled={savingGroupControl === "link"}
                      >
                        <span className={styles.toolsActionIcon}>
                          <IconUsersGroup size={20} />
                        </span>
                        <span>
                          <strong>{savingGroupControl === "link" ? "Vinculando..." : "Vincular grupo"}</strong>
                          <small>Libera ativações, robô e renovação.</small>
                        </span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${styles.toolsActionCard} ${selectedGroupRecord?.status === "active" ? styles.toolsActionCardOn : styles.toolsActionCardOff}`}
                          onClick={() => void toggleSelectedGroupStatusQuick()}
                          disabled={!selectedGroupRecord || savingGroupControl === "quickStatus" || savingGroupControl === "status"}
                        >
                          <span className={styles.toolsActionIcon}>
                            <IconRobot size={20} />
                          </span>
                          <span>
                            <strong>{selectedGroupRecord?.status === "active" ? "Desativar robô" : "Ativar robô"}</strong>
                            <small>{selectedGroupRecord?.status === "active" ? "Bot operando neste grupo." : "Bot parado neste grupo."}</small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={styles.toolsActionCard}
                          onClick={openGroupAdsModal}
                          disabled={!selectedGroupRecord}
                        >
                          <span className={styles.toolsActionIcon}>
                            <IconSpeakerphone size={20} />
                          </span>
                          <span>
                            <strong>ADS do grupo</strong>
                            <small>Campanhas e anúncios deste grupo.</small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={styles.toolsActionCard}
                          onClick={openSelectedGroupScheduleConfig}
                          disabled={!selectedLinkedGroupId}
                        >
                          <span className={styles.toolsActionIcon}>
                            <IconClock size={20} />
                          </span>
                          <span>
                            <strong>Abrir/fechar automático</strong>
                            <small>Configure horários para abrir e fechar mensagens.</small>
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </section>
              ) : null}

              <button
                type="button"
                className={styles.toolsActionCard}
                onClick={openActivationsModal}
                disabled={!selectedThread || selectedChatType !== "group"}
              >
                <span className={styles.toolsActionIcon}>
                  <IconSettings size={20} />
                </span>
                <span>
                  <strong>Ativações</strong>
                  <small>Bot, proteções, boas-vindas, palavras e anti-inatividade.</small>
                </span>
              </button>

              <section className={styles.toolsSection}>
                <div className={styles.toolsSectionHeader}>
                  <strong>Fluxos da instância</strong>
                  <span>{flowShortcuts.length}</span>
                </div>
                {loadingFlows ? (
                  <div className={styles.shortcutEmpty}>Carregando fluxos...</div>
                ) : flowShortcuts.length === 0 ? (
                  <div className={styles.shortcutEmpty}>Nenhum fluxo ativo para esta conversa.</div>
                ) : (
                  <div className={styles.toolsFlowList}>
                    {flowShortcuts.map((flow) => (
                      <button
                        key={flow.id}
                        type="button"
                        disabled={conversationReadOnly}
                        onClick={() => {
                          setComposer(buildFlowCommandText(flow));
                          setToolsCanvasOpen(false);
                        }}
                      >
                        <strong>{flow.name}</strong>
                        <span>{buildFlowCommandText(flow)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </aside>
        </div>
      ) : null}

      {groupAdsOpen && selectedGroupRecord ? (
        <div
          className={styles.planModalOverlay}
          role="presentation"
          onClick={() => {
            setGroupAdsOpen(false);
            setGroupAdEditor(null);
          }}
        >
          <section
            className={styles.groupAdsModal}
            role="dialog"
            aria-modal="true"
            aria-label="ADS do grupo"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.planModalHeader}>
              <div>
                <strong>ADS do grupo</strong>
                <span>{selectedGroupRecord.name}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGroupAdsOpen(false);
                  setGroupAdEditor(null);
                }}
                aria-label="Fechar ADS do grupo"
              >
                <IconX size={20} />
              </button>
            </header>
            <div className={styles.groupAdsBody}>
              <div className={styles.groupAdsIntro}>
                <IconSpeakerphone size={20} />
                <span>Automatize mensagens agendadas ou recorrentes somente neste grupo.</span>
              </div>
              <div className={styles.groupAdsToolbar}>
                <button type="button" onClick={() => openGroupAdEditor()} disabled={Boolean(groupAdsBusy)}>
                  Novo ADS
                </button>
                <button type="button" onClick={() => void loadGroupAds(selectedGroupRecord)} disabled={groupAdsLoading}>
                  {groupAdsLoading ? "Carregando..." : "Atualizar"}
                </button>
              </div>
              {groupAdsFeedback ? <div className={styles.groupControlSuccess}>{groupAdsFeedback}</div> : null}
              {groupAdsError ? <div className={styles.groupControlError}>{groupAdsError}</div> : null}

              {groupAdEditor ? (
                <section className={styles.groupAdEditorCard}>
                  <div className={styles.groupAdEditorHeader}>
                    <strong>{groupAdEditor.id ? "Editar ADS" : "Novo ADS"}</strong>
                    <button type="button" onClick={() => setGroupAdEditor(null)} aria-label="Cancelar edição">
                      <IconX size={18} />
                    </button>
                  </div>
                  <label className={styles.groupEditorField}>
                    <span>Mensagem</span>
                    <textarea
                      rows={5}
                      value={groupAdCaptionDraft}
                      onChange={(event) => setGroupAdCaptionDraft(event.target.value)}
                      placeholder="Digite a mensagem que será enviada no grupo..."
                    />
                  </label>
                  <div className={styles.groupEditorToggleGrid}>
                    <button
                      type="button"
                      className={groupAdEnabledDraft ? styles.activationToggleCardOn : styles.activationToggleCardOff}
                      onClick={() => setGroupAdEnabledDraft((value) => !value)}
                    >
                      <span>Status</span>
                      <strong>{groupAdEnabledDraft ? "Ativo" : "Pausado"}</strong>
                    </button>
                    <button
                      type="button"
                      className={groupAdMentionAllDraft ? styles.activationToggleCardOn : styles.activationToggleCardOff}
                      onClick={() => setGroupAdMentionAllDraft((value) => !value)}
                    >
                      <span>Menções</span>
                      <strong>{groupAdMentionAllDraft ? "Mencionar todos" : "Sem mencionar"}</strong>
                    </button>
                  </div>
                  <div className={styles.groupAdScheduleGrid}>
                    <button
                      type="button"
                      className={groupAdScheduleTypeDraft === "frequency" ? styles.groupAdScheduleActive : ""}
                      onClick={() => setGroupAdScheduleTypeDraft("frequency")}
                    >
                      Intervalo
                    </button>
                    <button
                      type="button"
                      className={groupAdScheduleTypeDraft === "times" ? styles.groupAdScheduleActive : ""}
                      onClick={() => setGroupAdScheduleTypeDraft("times")}
                    >
                      Horários
                    </button>
                  </div>
                  {groupAdScheduleTypeDraft === "times" ? (
                    <label className={styles.groupEditorField}>
                      <span>Horários</span>
                      <input
                        value={groupAdTimesDraft}
                        onChange={(event) => setGroupAdTimesDraft(event.target.value)}
                        placeholder="08:00, 12:00, 18:30"
                      />
                    </label>
                  ) : (
                    <label className={styles.groupEditorField}>
                      <span>Intervalo</span>
                      <input
                        value={groupAdFrequencyDraft}
                        onChange={(event) => setGroupAdFrequencyDraft(event.target.value)}
                        placeholder="30m, 2h, 1d"
                      />
                    </label>
                  )}
                  <footer className={styles.groupAdEditorFooter}>
                    <button type="button" onClick={() => setGroupAdEditor(null)} disabled={Boolean(groupAdsBusy)}>
                      Cancelar
                    </button>
                    <button type="button" onClick={() => void saveGroupAd()} disabled={Boolean(groupAdsBusy) || !groupAdCaptionDraft.trim()}>
                      {groupAdsBusy ? "Salvando..." : "Salvar ADS"}
                    </button>
                  </footer>
                </section>
              ) : null}

              <div className={styles.groupAdsList}>
                {groupAdsLoading ? (
                  <div className={styles.planPickerEmpty}>
                    <Spinner animation="border" />
                    <span>Carregando ADS...</span>
                  </div>
                ) : groupAds.length === 0 ? (
                  <div className={styles.planPickerEmpty}>
                    <IconSpeakerphone size={30} />
                    <strong>Nenhum ADS neste grupo</strong>
                    <span>Crie uma automação para enviar mensagens por horário ou intervalo.</span>
                  </div>
                ) : (
                  groupAds.map((ad) => (
                    <article key={ad.id} className={styles.groupAdCard}>
                      <div>
                        <strong>{ad.caption?.slice(0, 72) || "ADS sem mensagem"}</strong>
                        <span>
                          {ad.scheduleType === "times"
                            ? `Horários: ${(ad.times || []).join(", ") || "não definidos"}`
                            : `Intervalo: ${ad.frequency || "6h"}`}
                        </span>
                        <small>{ad.enabled === false ? "Pausado" : "Ativo"}{ad.mentionAll ? " · menciona todos" : ""}</small>
                      </div>
                      <footer>
                        <button type="button" onClick={() => void toggleGroupAd(ad)} disabled={Boolean(groupAdsBusy)}>
                          {ad.enabled === false ? "Ativar" : "Pausar"}
                        </button>
                        <button type="button" onClick={() => openGroupAdEditor(ad)} disabled={Boolean(groupAdsBusy)}>
                          Editar
                        </button>
                        <button type="button" onClick={() => void deleteGroupAd(ad)} disabled={Boolean(groupAdsBusy)}>
                          Apagar
                        </button>
                      </footer>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {groupPlanRequiredOpen && selectedGroupRecord ? (
        <div
          className={styles.planModalOverlay}
          role="presentation"
          onClick={() => setGroupPlanRequiredOpen(false)}
        >
          <section
            className={styles.planRequiredCard}
            role="dialog"
            aria-modal="true"
            aria-label="Plano do perfil"
            onClick={(event) => event.stopPropagation()}
          >
	              <span className={styles.planRequiredIcon}>
	                <IconRobot size={28} />
	              </span>
	              <div>
	                <strong>Assine o perfil</strong>
	                <span>
	                  Uma assinatura ativa libera todos os grupos desta instância e mantém o robô disponível.
	                </span>
	              </div>
	              <footer>
              <button type="button" onClick={() => setGroupPlanRequiredOpen(false)}>
                Agora não
              </button>
	              <button type="button" onClick={() => void requestProfileUnlimitedPayment(selectedGroupRecord)}>
	                Renovar perfil
	              </button>
	            </footer>
          </section>
        </div>
      ) : null}

      {groupPlanPicker ? (
        <div
          className={styles.planModalOverlay}
          role="presentation"
          onClick={() => setGroupPlanPicker(null)}
        >
	            <section
	              className={styles.planPickerModal}
	              role="dialog"
	              aria-modal="true"
	              aria-label="Escolher plano do perfil"
	              onClick={(event) => event.stopPropagation()}
	            >
            <header className={styles.planModalHeader}>
              <div>
                <strong>
	                  {groupPlanPicker.mode === "renewal" ? "Renovar perfil" : "Assinar perfil"}
	                </strong>
	                <span>
	                  Todos os grupos do perfil que contém {groupPlanPicker.group.name}
	                </span>
              </div>
              <button type="button" onClick={() => setGroupPlanPicker(null)} aria-label="Fechar planos">
                <IconX size={20} />
              </button>
            </header>
            <div className={styles.planPickerBody}>
              {groupPlanError ? <div className={styles.groupControlError}>{groupPlanError}</div> : null}
              {planSnapshotLoading ? (
                <div className={styles.planPickerEmpty}>
                  <Spinner animation="border" />
                  <span>Carregando planos...</span>
                </div>
              ) : availableGroupPlans.length === 0 ? (
                <div className={styles.planPickerEmpty}>
                  <IconWallet size={30} />
	                  <strong>Nenhum plano ativo</strong>
	                  <span>Configure planos ativos no painel admin para liberar assinaturas de perfil.</span>
                  <button type="button" onClick={() => void loadPlanSnapshot()}>
                    Recarregar
                  </button>
                </div>
              ) : (
                availableGroupPlans.map((plan) => {
                  const expanded = groupPlanExpandedId === plan.id;
                  return (
                    <article key={plan.id} className={`${styles.planOptionCard} ${expanded ? styles.planOptionCardOpen : ""}`}>
                      <button
                        type="button"
                        className={styles.planOptionMain}
                        onClick={() => selectGroupPlan(plan)}
                      >
                        <span>
                          <strong>{plan.name}</strong>
                          <small>
	                            {`${plan.durationDays} dias para todos os grupos deste perfil`}
                          </small>
                        </span>
                        <b>{formatMoney(plan.price)}</b>
                      </button>
                      <button
                        type="button"
                        className={styles.planExpandButton}
                        onClick={() => setGroupPlanExpandedId((current) => (current === plan.id ? null : plan.id))}
                        aria-expanded={expanded}
                        aria-label={`Ver detalhes do plano ${plan.name}`}
                      >
                        <IconChevronDown size={18} />
                      </button>
                      {expanded ? (
                        <div className={styles.planOptionDetails}>
	                          <span>{plan.description || "Plano com validade para o perfil inteiro."}</span>
	                          <ul>
	                            <li>
	                              Libera todos os grupos desta instância pelo período contratado
	                            </li>
                            <li>{plan.instanceLimit} perfis no plano principal</li>
                            <li>Ativação automática após confirmação do pagamento</li>
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      ) : null}

      {groupPaymentPicker ? (
        <div
          className={styles.planModalOverlay}
          role="presentation"
          onClick={() => setGroupPaymentPicker(null)}
        >
          <section
            className={styles.planPickerModal}
            role="dialog"
            aria-modal="true"
            aria-label="Escolher pagamento"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.planModalHeader}>
              <div>
                <strong>Pagamento</strong>
                <span>{groupPaymentPicker.plan.name} · {formatMoney(groupPaymentPicker.plan.price)}</span>
              </div>
              <button type="button" onClick={() => setGroupPaymentPicker(null)} aria-label="Fechar pagamento">
                <IconX size={20} />
              </button>
            </header>
            <div className={styles.planPickerBody}>
              {groupPlanError ? <div className={styles.groupControlError}>{groupPlanError}</div> : null}
              {availablePaymentMethods.length === 0 ? (
                <div className={styles.planPickerEmpty}>
	                  <IconWallet size={30} />
	                  <strong>Nenhum método disponível</strong>
	                  <span>Ative Pix ou checkout no painel admin para vender planos de perfil.</span>
                  <button type="button" onClick={() => void loadPlanSnapshot()}>
                    Recarregar métodos
                  </button>
                </div>
              ) : (
                <div className={styles.paymentMethodGrid}>
                  {availablePaymentMethods.map((method) => (
                    <button
                      key={method.provider}
                      type="button"
                      className={styles.paymentMethodCard}
                      onClick={() => void createGroupPlanCheckout(method.provider)}
                      disabled={Boolean(groupPlanBusy)}
                    >
                      <IconWallet size={20} />
                      <span>
                        <strong>{method.displayName}</strong>
                        <small>{method.provider === "mercadopago_checkout" ? "Cartão, boleto ou Pix" : "Pix automático"}</small>
                      </span>
                      {groupPlanBusy === method.provider ? <Spinner animation="border" size="sm" /> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {groupCheckout ? (
        <div
          className={styles.planModalOverlay}
          role="presentation"
          onClick={() => setGroupCheckout(null)}
        >
          <section
            className={styles.planPickerModal}
            role="dialog"
            aria-modal="true"
            aria-label="Pagamento gerado"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.planModalHeader}>
              <div>
                <strong>Pagamento gerado</strong>
                <span>{groupCheckout.plan.name} · {formatMoney(groupCheckout.checkout.amount || groupCheckout.plan.price)}</span>
              </div>
              <button type="button" onClick={() => setGroupCheckout(null)} aria-label="Fechar pagamento gerado">
                <IconX size={20} />
              </button>
            </header>
            <div className={styles.checkoutBody}>
              {groupCheckout.checkout.qrCodeBase64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.checkoutQr}
                  src={`data:image/png;base64,${groupCheckout.checkout.qrCodeBase64}`}
                  alt="QR Code Pix"
                />
              ) : null}
              <div className={styles.checkoutInfo}>
	                <strong>Confirmação automática</strong>
	                <span>
	                  Após o pagamento aprovado, o perfil inteiro é liberado com a validade do plano escolhido.
	                </span>
                {groupCheckout.checkout.qrCode ? (
                  <label className={styles.checkoutCopyField}>
                    <span>Código Pix</span>
                    <textarea readOnly rows={4} value={groupCheckout.checkout.qrCode} />
                  </label>
                ) : null}
                <div className={styles.checkoutActions}>
                  {groupCheckout.checkout.qrCode ? (
                    <button type="button" onClick={() => void copyTextToClipboard(groupCheckout.checkout.qrCode ?? "")}>
                      Copiar Pix
                    </button>
                  ) : null}
                  {groupCheckout.checkout.ticketUrl ? (
                    <a href={groupCheckout.checkout.ticketUrl} target="_blank" rel="noopener noreferrer">
                      Abrir pagamento
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activationsModalOpen ? (
        <div className={styles.activationModalOverlay} role="presentation">
          <section className={styles.activationModal} role="dialog" aria-modal="true" aria-label="Ativações do grupo">
            <header className={styles.activationModalHeader}>
              <div>
                <strong>Ativações</strong>
                <span>{selectedThread ? getThreadTitle(selectedThread, selectedInstance) : "Grupo não selecionado"}</span>
              </div>
              <button
                type="button"
                onClick={closeActivationsModal}
                aria-label="Fechar ativações"
              >
                <IconX size={22} />
              </button>
            </header>

            <div className={styles.activationModalBody}>
              {selectedChatType !== "group" ? (
                <div className={styles.activationEmpty}>
                  <IconUsersGroup size={34} />
                  <strong>Ativações disponíveis apenas para grupos</strong>
                  <span>Selecione um grupo no chat para configurar comandos, filtros e automações.</span>
                </div>
              ) : !selectedLinkedGroupId ? (
                <div className={styles.activationEmpty}>
                  <IconUsersGroup size={34} />
                  <strong>Grupo ainda não vinculado</strong>
                  <span>Vincule este chat ao BotAdmin para liberar todas as ativações.</span>
                  <button
                    type="button"
                    onClick={() => void linkSelectedGroupFromChat()}
                    disabled={savingGroupControl === "link"}
                  >
                    {savingGroupControl === "link" ? "Vinculando..." : "Vincular e gerenciar"}
                  </button>
                </div>
              ) : loadingGroupControls || !selectedGroupRecord || !selectedGroupSettings ? (
                <div className={styles.activationEmpty}>
                  <Spinner animation="border" />
                  <strong>Carregando ativações</strong>
                </div>
              ) : (
                <>
                  {groupControlsError ? (
                    <div className={styles.groupControlError}>{groupControlsError}</div>
                  ) : null}
                  {groupSettingsFeedback ? (
                    <div className={styles.groupControlSuccess}>{groupSettingsFeedback}</div>
                  ) : null}

                  <section className={styles.activationSection}>
                    <div className={styles.activationSectionHeader}>
                      <strong>Controle do grupo</strong>
                      <span>{getGroupStatusLabel(selectedGroupRecord)}</span>
                    </div>
                    <div className={styles.activationControlGrid}>
                      <button
                        type="button"
                        className={`${styles.activationToggleCard} ${selectedGroupRecord.status === "active" ? styles.activationToggleCardOn : styles.activationToggleCardOff}`}
                        onClick={() =>
                          void toggleSelectedGroupStatusQuick()
                        }
                        disabled={savingGroupControl === "quickStatus" || savingGroupControl === "status"}
                      >
                        <span>Bot no grupo</span>
                        <strong>{selectedGroupRecord.status === "active" ? "Ativo" : "Desativado"}</strong>
                      </button>
                      <button
                        type="button"
                        className={`${styles.activationToggleCard} ${selectedGroupRecord.metadata?.adminsOnly ? styles.activationToggleCardOn : styles.activationToggleCardOff}`}
                        onClick={() =>
                          void patchSelectedGroup(
                            { adminsOnly: !selectedGroupRecord.metadata?.adminsOnly },
                            "adminsOnly",
                          )
                        }
                        disabled={savingGroupControl === "adminsOnly"}
                      >
                        <span>Somente admins</span>
                        <strong>{selectedGroupRecord.metadata?.adminsOnly ? "Ligado" : "Desligado"}</strong>
                      </button>
                      <button
                        type="button"
                        className={`${styles.activationToggleCard} ${selectedGroupRecord.metadata?.locked ? styles.activationToggleCardOn : styles.activationToggleCardOff}`}
                        onClick={() =>
                          void patchSelectedGroup(
                            { locked: !selectedGroupRecord.metadata?.locked },
                            "locked",
                          )
                        }
                        disabled={savingGroupControl === "locked"}
                      >
                        <span>Editar dados</span>
                        <strong>{selectedGroupRecord.metadata?.locked ? "Bloqueado" : "Aberto"}</strong>
                      </button>
                    </div>
                  </section>

                  {GROUP_ACTIVATION_SECTIONS.map((section) => (
                    <section key={section.title} className={styles.activationSection}>
                      <div className={styles.activationSectionHeader}>
                        <strong>{section.title}</strong>
                      </div>
                      <div className={styles.activationToggleGrid}>
                        {section.items.map((item) => {
                          const enabled = Boolean(selectedGroupSettings.commandToggles?.[item.key]);
                          const configTarget = CONFIGURABLE_ACTIVATION_KEYS[item.key];
                          const cardClassName = `${styles.activationToggleCard} ${enabled ? styles.activationToggleCardOn : styles.activationToggleCardOff} ${configTarget ? styles.activationToggleCardWithConfig : ""}`;
                          if (configTarget) {
                            return (
                              <article key={item.key} className={cardClassName}>
                                <button
                                  type="button"
                                  className={styles.activationToggleMain}
                                  onClick={() => void toggleActivationSetting(item.key)}
                                  disabled={savingGroupControl === `activation-${item.key}`}
                                >
                                  <span>{item.label}</span>
                                  <strong>{enabled ? "Ligado" : "Desligado"}</strong>
                                  <small>{item.description}</small>
                                </button>
                                <button
                                  type="button"
                                  className={styles.activationConfigButton}
                                  onClick={() => openActivationConfig(configTarget)}
                                  aria-label={`Configurar ${item.label}`}
                                >
                                  <IconSettings size={17} />
                                </button>
                              </article>
                            );
                          }
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className={cardClassName}
                              onClick={() => void toggleActivationSetting(item.key)}
                              disabled={savingGroupControl === `activation-${item.key}`}
                            >
                              <span>{item.label}</span>
                              <strong>{enabled ? "Ligado" : "Desligado"}</strong>
                              <small>{item.description}</small>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}

	                  <section className={styles.activationSection}>
	                    <div className={styles.activationSectionHeader}>
	                      <strong>Configurações com regras</strong>
	                    </div>
	                    <div className={styles.activationToggleGrid}>
	                      <article
	                        className={`${styles.activationToggleCard} ${(scheduleCloseEnabledDraft || scheduleOpenEnabledDraft) ? styles.activationToggleCardOn : styles.activationToggleCardOff} ${styles.activationToggleCardWithConfig}`}
	                      >
	                        <button
	                          type="button"
	                          className={styles.activationToggleMain}
	                          onClick={() => openActivationConfig("schedule")}
	                        >
	                          <span>Abrir/fechar automático</span>
	                          <strong>{(scheduleCloseEnabledDraft || scheduleOpenEnabledDraft) ? "Ligado" : "Desligado"}</strong>
	                          <small>Programa horários para liberar ou restringir mensagens.</small>
	                        </button>
	                        <button
	                          type="button"
	                          className={styles.activationConfigButton}
	                          onClick={() => {
	                            openActivationConfig("schedule");
	                            setActivationEditorField("schedule");
	                          }}
	                          aria-label="Configurar abertura e fechamento automático"
	                        >
	                          <IconSettings size={17} />
	                        </button>
	                      </article>
	                      <article
	                        className={`${styles.activationToggleCard} ${selectedGroupSettings.antiInactivityConfig.enabled ? styles.activationToggleCardOn : styles.activationToggleCardOff} ${styles.activationToggleCardWithConfig}`}
	                      >
                        <button
                          type="button"
                          className={styles.activationToggleMain}
                          onClick={() => void toggleAntiInactivityActivation()}
                          disabled={savingGroupControl === "antiInactivityEnabled"}
                        >
                          <span>Anti-inatividade</span>
                          <strong>{selectedGroupSettings.antiInactivityConfig.enabled ? "Ligado" : "Desligado"}</strong>
                          <small>Remove membros sem mensagem no período configurado.</small>
                        </button>
                        <button
                          type="button"
                          className={styles.activationConfigButton}
                          onClick={() => openActivationConfig("antiInactivity")}
                          aria-label="Configurar anti-inatividade"
                        >
                          <IconSettings size={17} />
                        </button>
                      </article>
                    </div>
                  </section>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activationConfigTarget && selectedGroupRecord && selectedGroupSettings && selectedActivationConfigCopy ? (
        <div className={styles.activationConfigOverlay} role="presentation">
          <section
            className={styles.activationConfigModal}
            role="dialog"
            aria-modal="true"
            aria-label={selectedActivationConfigCopy.title}
          >
            <header className={styles.activationConfigHeader}>
              <div>
                <strong>{selectedActivationConfigCopy.title}</strong>
                <span>{selectedActivationConfigCopy.subtitle}</span>
              </div>
              <button
                type="button"
                onClick={() => setActivationConfigTarget(null)}
                aria-label="Fechar configuração"
              >
                <IconX size={22} />
              </button>
            </header>

            <div className={styles.activationConfigBody}>
              {groupControlsError ? (
                <div className={styles.groupControlError}>{groupControlsError}</div>
              ) : null}
              {groupSettingsFeedback ? (
                <div className={styles.groupControlSuccess}>{groupSettingsFeedback}</div>
              ) : null}

              <input
                ref={welcomeMediaInputRef}
                type="file"
                accept="image/*,video/*,audio/*,application/*"
                hidden
                onChange={(event) => void uploadWelcomeMedia(event)}
              />
              <input
                ref={farewellMediaInputRef}
                type="file"
                accept="image/*,video/*,audio/*,application/*"
                hidden
                onChange={(event) => void uploadFarewellMedia(event)}
              />

              <div className={styles.activationPhoneLayout}>
                <aside className={styles.activationPhoneShell} aria-label="Preview no telefone">
                  <div className={styles.activationPhoneScreen}>
                    <div className={styles.activationPhoneStatus}>
                      <span>11:14</span>
                      <span>4G</span>
                    </div>
	                    <div className={styles.activationPhoneConfigBar}>
	                      <span>
	                        {activationConfigTarget === "welcome"
	                          ? "Boas-vindas"
	                          : activationConfigTarget === "farewell"
	                            ? "Saída"
	                            : activationConfigTarget === "schedule"
	                              ? "Abrir/fechar"
	                              : activationConfigTarget === "allowedLinks"
	                                ? "Links permitidos"
	                              : activationConfigTarget === "bannedWords"
	                                ? "Anti-palavras"
	                                : activationConfigTarget === "antiInactivity"
	                                  ? "Anti-inatividade"
	                                  : "Anti-fake"}
	                      </span>
                      {activationConfigTarget === "welcome" ? (
                        <button
                          type="button"
                          className={welcomeEnabledDraft ? styles.groupMiniToggleOn : styles.groupMiniToggle}
                          onClick={() => setWelcomeEnabledDraft((value) => !value)}
                        >
                          {welcomeEnabledDraft ? "Ligado" : "Desligado"}
                        </button>
                      ) : null}
                      {activationConfigTarget === "farewell" ? (
                        <button
                          type="button"
                          className={farewellEnabledDraft ? styles.groupMiniToggleOn : styles.groupMiniToggle}
                          onClick={() => setFarewellEnabledDraft((value) => !value)}
                        >
                          {farewellEnabledDraft ? "Ligado" : "Desligado"}
                        </button>
                      ) : null}
                      {activationConfigTarget === "antiInactivity" ? (
                        <button
                          type="button"
                          className={antiInactivityEnabledDraft ? styles.groupMiniToggleOn : styles.groupMiniToggle}
	                          onClick={() => setAntiInactivityEnabledDraft((value) => !value)}
	                        >
	                          {antiInactivityEnabledDraft ? "Ligado" : "Desligado"}
	                        </button>
	                      ) : null}
	                      {activationConfigTarget === "schedule" ? (
	                        <button
	                          type="button"
	                          className={(scheduleCloseEnabledDraft || scheduleOpenEnabledDraft) ? styles.groupMiniToggleOn : styles.groupMiniToggle}
	                          onClick={() => {
	                            const next = !(scheduleCloseEnabledDraft || scheduleOpenEnabledDraft);
	                            setScheduleCloseEnabledDraft(next);
	                            setScheduleOpenEnabledDraft(next);
	                          }}
	                        >
	                          {(scheduleCloseEnabledDraft || scheduleOpenEnabledDraft) ? "Ligado" : "Desligado"}
	                        </button>
	                      ) : null}
                    </div>
                    <header className={styles.activationPhoneHeader}>
                      <span className={styles.activationPhoneBack}>‹</span>
                      <span className={styles.activationPhoneAvatar}>
                        {selectedThread?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={selectedThread.avatarUrl} alt="" />
                        ) : (
                          getInitials(getThreadTitle(selectedThread, selectedInstance))
                        )}
                      </span>
                      <strong>{getThreadTitle(selectedThread, selectedInstance)}</strong>
                      {activationConfigTarget === "welcome" || activationConfigTarget === "farewell" ? (
                        <button
                          type="button"
                          className={styles.activationPhoneHeaderAction}
                          onClick={() => {
                            if (activationConfigTarget === "welcome") {
                              welcomeMediaInputRef.current?.click();
                              return;
                            }
                            farewellMediaInputRef.current?.click();
                          }}
                          disabled={activationLifecycleMediaBusy}
                          aria-label={activationConfigTarget === "welcome" ? "Trocar mídia de boas-vindas" : "Trocar mídia de saída"}
                        >
                          <IconCamera size={17} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.activationPhoneHeaderAction}
                          onClick={() =>
                            setActivationEditorField(
		                              activationConfigTarget === "bannedWords"
		                                ? "bannedWords"
		                                : activationConfigTarget === "antiInactivity"
		                                  ? "antiInactivity"
		                                  : activationConfigTarget === "schedule"
		                                    ? "schedule"
		                                    : activationConfigTarget === "allowedLinks"
		                                      ? "allowedLinks"
		                                    : "antiFake",
	                            )
	                          }
                          aria-label="Editar configuração"
                        >
                          <IconPencil size={17} />
                        </button>
                      )}
                    </header>
                    <div className={styles.activationPhoneChat}>
                      {activationConfigTarget === "welcome" || activationConfigTarget === "farewell" ? (
                        <section className={styles.activationPhoneBubble}>
                          <span className={styles.activationPhoneSender}>{selectedInstance?.name || "BotAdmin"}</span>
                          {activationLifecyclePreviewMediaUrl ? (
                            <div className={styles.activationPhoneMediaWrap}>
                              <button
                                type="button"
                                className={styles.activationPhoneMedia}
                                onClick={() => {
                                  if (activationConfigTarget === "welcome") {
                                    welcomeMediaInputRef.current?.click();
                                    return;
                                  }
                                  farewellMediaInputRef.current?.click();
                                }}
                                disabled={activationLifecycleMediaBusy}
                                aria-label={activationConfigTarget === "welcome" ? "Trocar mídia de boas-vindas" : "Trocar mídia de saída"}
                              >
                                {isVideoUrl(activationLifecyclePreviewMediaUrl) ? (
                                  <video controls src={activationLifecyclePreviewMediaUrl} />
                                ) : isAudioUrl(activationLifecyclePreviewMediaUrl) ? (
                                  <audio controls src={activationLifecyclePreviewMediaUrl} />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={activationLifecyclePreviewMediaUrl}
                                    alt={activationConfigTarget === "welcome" ? "Mídia de boas-vindas" : "Mídia de saída"}
                                  />
                                )}
                              </button>
                              <button
                                type="button"
                                className={styles.activationPencilButton}
                                onClick={() => {
                                  if (activationConfigTarget === "welcome") {
                                    welcomeMediaInputRef.current?.click();
                                    return;
                                  }
                                  farewellMediaInputRef.current?.click();
                                }}
                                disabled={activationLifecycleMediaBusy}
                                aria-label="Editar mídia"
                              >
                                <IconPencil size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={styles.activationPhoneMediaEmpty}
                              onClick={() => {
                                if (activationConfigTarget === "welcome") {
                                  welcomeMediaInputRef.current?.click();
                                  return;
                                }
                                farewellMediaInputRef.current?.click();
                              }}
                              disabled={activationLifecycleMediaBusy}
                            >
                              <IconCamera size={16} />
                              Adicionar mídia
                            </button>
                          )}
                          <button
                            type="button"
                            className={[
                              styles.activationProfileToggle,
                              (activationConfigTarget === "welcome"
                                ? welcomeUseParticipantProfilePhotoDraft
                                : farewellUseParticipantProfilePhotoDraft) && styles.activationProfileToggleOn,
                            ].filter(Boolean).join(" ")}
                            onClick={() => {
                              if (activationConfigTarget === "welcome") {
                                setWelcomeUseParticipantProfilePhotoDraft((value) => !value);
                                return;
                              }
                              setFarewellUseParticipantProfilePhotoDraft((value) => !value);
                            }}
                            aria-pressed={
                              activationConfigTarget === "welcome"
                                ? welcomeUseParticipantProfilePhotoDraft
                                : farewellUseParticipantProfilePhotoDraft
                            }
                          >
                            <span className={styles.activationProfileSwitch}><span /></span>
                            <strong>Foto do perfil</strong>
                          </button>
                          <div className={styles.activationPhoneTextBlock}>
                            <p>
                              {activationConfigTarget === "welcome"
                                ? welcomeCaptionDraft.trim() ||
                                  "Olá {{pushName}}, seja bem-vindo ao {{nomeGrupo}}!"
                                : farewellCaptionDraft.trim() ||
                                  "Até mais {{pushName}}. Você saiu de {{nomeGrupo}}."}
                            </p>
                            <button
                              type="button"
                              className={styles.activationPencilButton}
                              onClick={() => setActivationEditorField(activationConfigTarget === "welcome" ? "welcomeText" : "farewellText")}
                              aria-label={activationConfigTarget === "welcome" ? "Editar texto de boas-vindas" : "Editar texto de saída"}
                            >
                              <IconPencil size={14} />
                            </button>
                          </div>
                          <time>11:14</time>
                        </section>
                      ) : (
                        <section className={styles.activationPhoneBubble}>
                          <span className={styles.activationPhoneSender}>BotAdmin</span>
                          <div className={styles.activationPhoneTextBlock}>
	                            <p>
	                              {activationConfigTarget === "bannedWords"
	                                ? `Anti-palavras com ${parseMultilineItems(bannedWordsDraft).length} termo(s) e limite ${antipalavrasLimitDraft || "5"}.`
	                                : activationConfigTarget === "schedule"
	                                  ? `Fecha: ${scheduleCloseEnabledDraft ? parseScheduleTimesDraft(scheduleCloseTimesDraft).join(", ") || "sem horário" : "desligado"} • Abre: ${scheduleOpenEnabledDraft ? parseScheduleTimesDraft(scheduleOpenTimesDraft).join(", ") || "sem horário" : "desligado"}`
	                                  : activationConfigTarget === "allowedLinks"
	                                    ? `Links permitidos: ${parseMultilineItems(allowedLinksDraft).length} item(s).`
	                                : activationConfigTarget === "antiInactivity"
	                                  ? `Remover membros após ${antiInactivityDaysDraft || "30"} dia(s) sem falar.`
	                                  : `DDIs permitidos: ${parseMultilineItems(allowedDdisDraft).join(", ") || "todos"}.`}
                            </p>
                            <button
                              type="button"
                              className={styles.activationPencilButton}
                              onClick={() =>
                                setActivationEditorField(
	                                  activationConfigTarget === "bannedWords"
	                                    ? "bannedWords"
	                                    : activationConfigTarget === "antiInactivity"
	                                      ? "antiInactivity"
	                                      : activationConfigTarget === "schedule"
	                                        ? "schedule"
	                                        : activationConfigTarget === "allowedLinks"
	                                          ? "allowedLinks"
	                                        : "antiFake",
	                                )
	                              }
                              aria-label="Editar configuração"
                            >
                              <IconPencil size={14} />
                            </button>
                          </div>
                          <time>11:14</time>
                        </section>
                      )}
                    </div>
                    <footer className={styles.activationPhoneFooter}>
                      {(activationConfigTarget === "welcome" || activationConfigTarget === "farewell") && activationLifecyclePreviewMediaUrl ? (
                        <button
                          type="button"
                          className={styles.activationPhoneFooterIcon}
                          onClick={() => {
                            if (activationConfigTarget === "welcome") {
                              void clearWelcomeMedia();
                              return;
                            }
                            void clearFarewellMedia();
                          }}
                          disabled={
                            activationConfigTarget === "welcome"
                              ? savingGroupControl === "welcomeMediaClear"
                              : savingGroupControl === "farewellMediaClear"
                          }
                          aria-label="Remover mídia"
                        >
                          <IconTrash size={16} />
                        </button>
                      ) : null}
                      {activationConfigTarget === "welcome" || activationConfigTarget === "farewell" ? (
                        <label className={styles.activationCheckRow}>
                          <input
                            type="checkbox"
                            checked={activationConfigTarget === "welcome" ? welcomeAsStickerDraft : farewellAsStickerDraft}
                            onChange={(event) => {
                              if (activationConfigTarget === "welcome") {
                                setWelcomeAsStickerDraft(event.target.checked);
                                return;
                              }
                              setFarewellAsStickerDraft(event.target.checked);
                            }}
                          />
                          <span>Sticker</span>
                        </label>
                      ) : null}
                      <button
                        type="button"
                        className={styles.activationSaveButton}
                        onClick={() => void saveActivationConfig()}
                        disabled={activationConfigSaving}
                      >
                        {activationConfigSaving ? "Salvando..." : activationConfigSaveLabel}
                      </button>
                    </footer>
                  </div>
                </aside>
              </div>

              {activationEditorField ? (
                <div
                  className={styles.activationInlineEditorOverlay}
                  onClick={() => setActivationEditorField(null)}
                  role="presentation"
                >
                  <section
                    className={styles.activationInlineEditorCard}
                    onClick={(event) => event.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Editar configuração"
                  >
                    <header className={styles.activationInlineEditorHeader}>
                      <div>
                        <strong>
                          {activationEditorField === "welcomeText"
                            ? "Editar texto"
	                            : activationEditorField === "farewellText"
		                              ? "Editar texto de saída"
		                              : activationEditorField === "schedule"
		                                ? "Editar abertura/fechamento"
		                                : activationEditorField === "allowedLinks"
		                                  ? "Editar links permitidos"
		                              : activationEditorField === "bannedWords"
		                                ? "Editar anti-palavras"
                                : activationEditorField === "antiInactivity"
                                  ? "Editar anti-inatividade"
                                  : "Editar anti-fake"}
                        </strong>
                        <span>Altere e salve sem sair do simulador.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActivationEditorField(null)}
                        aria-label="Fechar edição"
                      >
                        <IconX size={18} />
                      </button>
                    </header>
                    <div className={styles.activationInlineEditorBody}>
                      {activationEditorField === "welcomeText" ? (
                        <label className={styles.activationField}>
                          <span>Texto de boas-vindas</span>
                          <textarea
                            value={welcomeCaptionDraft}
                            onChange={(event) => setWelcomeCaptionDraft(event.target.value)}
                            placeholder="Bem-vindo {{pushName}} ao grupo."
                            rows={8}
                          />
                        </label>
                      ) : null}
                      {activationEditorField === "farewellText" ? (
                        <label className={styles.activationField}>
                          <span>Texto de saída</span>
                          <textarea
                            value={farewellCaptionDraft}
                            onChange={(event) => setFarewellCaptionDraft(event.target.value)}
                            placeholder="Até mais {{pushName}}. Você saiu de {{nomeGrupo}}."
                            rows={8}
                          />
                        </label>
                      ) : null}
                      {activationEditorField === "schedule" ? (
                        <div className={styles.activationInlineGrid}>
                          <label className={styles.activationField}>
                            <span>Fechamento automático</span>
                            <select
                              value={scheduleCloseEnabledDraft ? "on" : "off"}
                              onChange={(event) => setScheduleCloseEnabledDraft(event.target.value === "on")}
                            >
                              <option value="on">Ligado</option>
                              <option value="off">Desligado</option>
                            </select>
                          </label>
                          <label className={styles.activationField}>
                            <span>Horários para fechar</span>
                            <textarea
                              value={scheduleCloseTimesDraft}
                              onChange={(event) => setScheduleCloseTimesDraft(event.target.value)}
                              placeholder={"00:00\n22:30"}
                              rows={4}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Mensagem ao fechar</span>
                            <textarea
                              value={scheduleCloseMessageDraft}
                              onChange={(event) => setScheduleCloseMessageDraft(event.target.value)}
                              placeholder="Grupo fechado automaticamente conforme programação."
                              rows={4}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Abertura automática</span>
                            <select
                              value={scheduleOpenEnabledDraft ? "on" : "off"}
                              onChange={(event) => setScheduleOpenEnabledDraft(event.target.value === "on")}
                            >
                              <option value="on">Ligado</option>
                              <option value="off">Desligado</option>
                            </select>
                          </label>
                          <label className={styles.activationField}>
                            <span>Horários para abrir</span>
                            <textarea
                              value={scheduleOpenTimesDraft}
                              onChange={(event) => setScheduleOpenTimesDraft(event.target.value)}
                              placeholder={"07:00\n08:30"}
                              rows={4}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Mensagem ao abrir</span>
                            <textarea
                              value={scheduleOpenMessageDraft}
                              onChange={(event) => setScheduleOpenMessageDraft(event.target.value)}
                              placeholder="Grupo aberto automaticamente conforme programação."
                              rows={4}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Fuso horário</span>
                            <input
                              value={scheduleTimezoneDraft}
                              onChange={(event) => setScheduleTimezoneDraft(event.target.value)}
                              placeholder="America/Sao_Paulo"
                            />
                          </label>
                        </div>
                      ) : null}
                      {activationEditorField === "allowedLinks" ? (
                        <label className={styles.activationField}>
                          <span>Links ou domínios permitidos</span>
                          <textarea
                            value={allowedLinksDraft}
                            onChange={(event) => setAllowedLinksDraft(event.target.value)}
                            placeholder={"seudominio.com\nhttps://siteconfiavel.com/pagina\nchat.whatsapp.com/grupo-oficial"}
                            rows={10}
                          />
                        </label>
                      ) : null}
	                      {activationEditorField === "bannedWords" ? (
                        <>
                          <label className={styles.activationField}>
                            <span>Palavras proibidas</span>
                            <textarea
                              value={bannedWordsDraft}
                              onChange={(event) => setBannedWordsDraft(event.target.value)}
                              placeholder="Uma palavra por linha"
                              rows={8}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Limite de infrações</span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={antipalavrasLimitDraft}
                              onChange={(event) => setAntipalavrasLimitDraft(event.target.value)}
                            />
                          </label>
                        </>
                      ) : null}
                      {activationEditorField === "antiInactivity" ? (
                        <div className={styles.activationInlineGrid}>
                          <label className={styles.activationField}>
                            <span>Dias sem falar</span>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={antiInactivityDaysDraft}
                              onChange={(event) => setAntiInactivityDaysDraft(event.target.value)}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Intervalo de varredura em horas</span>
                            <input
                              type="number"
                              min={1}
                              max={168}
                              value={antiInactivityScanDraft}
                              onChange={(event) => setAntiInactivityScanDraft(event.target.value)}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Limite por execução</span>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={antiInactivityRemoveLimitDraft}
                              onChange={(event) => setAntiInactivityRemoveLimitDraft(event.target.value)}
                            />
                          </label>
                        </div>
                      ) : null}
                      {activationEditorField === "antiFake" ? (
                        <>
                          <label className={styles.activationField}>
                            <span>DDIs permitidos</span>
                            <textarea
                              value={allowedDdisDraft}
                              onChange={(event) => setAllowedDdisDraft(event.target.value)}
                              placeholder="55&#10;351&#10;1"
                              rows={5}
                            />
                          </label>
                          <label className={styles.activationField}>
                            <span>Mensagem para bloqueio</span>
                            <textarea
                              value={antifakeMessageDraft}
                              onChange={(event) => setAntifakeMessageDraft(event.target.value)}
                              placeholder="Seu número não é permitido neste grupo."
                              rows={5}
                            />
                          </label>
                        </>
                      ) : null}
                    </div>
                    <footer className={styles.activationInlineEditorFooter}>
                      <button
                        type="button"
                        className={styles.activationSecondaryButton}
                        onClick={() => setActivationEditorField(null)}
                      >
                        Concluir
                      </button>
                      <button
                        type="button"
                        className={styles.activationSaveButton}
                        onClick={() => void saveActivationConfig()}
                        disabled={activationConfigSaving}
                      >
                        {activationConfigSaving ? "Salvando..." : activationConfigSaveLabel}
                      </button>
                    </footer>
                  </section>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
};

export default WhatsAppConversationsClient;
