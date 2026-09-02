import { ResultSetHeader, RowDataPacket } from "mysql2";

import type {
  BotGroup,
  BotGroupMetadata,
  BotGroupParticipant,
  BotGroupPayload,
  BotGroupShare,
} from "types/bot-groups";
import type { BotInstance } from "types/bot-instances";
import type { SubscriptionPlan } from "types/plans";
import {
  BotGroupRow,
  ensureBotGroupTable,
  ensureBotGroupShareTable,
  ensureBotInstanceTable,
  ensureUserTable,
  getDb,
} from "./db";
import { getGroupSettings } from "./bot-group-settings";
import { DEFAULT_EVENTS, getInstanceForUser, refreshInstanceStatus } from "./bot-instances";
import {
  deleteUploadedFile,
  resolveUploadedFileUrl,
  saveUploadedFile,
} from "./uploads";
import {
  getGroupInfo,
  removeGroupPhoto,
  setGroupEphemeral,
  setGroupLocked,
  setGroupName,
  setGroupPhoto,
  setGroupTopic,
  setMessagesAdminsOnly,
  type WuzapiClient,
} from "./wuzapi";
import { getWebhookRowForUser, recordWebhookEvent } from "./webhooks";
import { getUserBasicByEmail, getUserBasicById } from "./users";
import { getUserPlanStatus } from "./plans";

export class BotGroupError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "BotGroupError";
    this.status = status;
    this.details = details;
  }
}

type BotGroupWithInstanceRow = BotGroupRow & {
  instance_name: string | null;
  instance_phone: string | null;
};

type BotGroupShareRow = RowDataPacket & {
  id: number;
  group_id: number;
  owner_user_id: number;
  shared_user_id: number;
  granted_by_user_id: number | null;
  role: string | null;
  shared_user_name: string | null;
  shared_user_email: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type BotGroupAccess = {
  group: BotGroup;
  ownerUserId: number;
  isOwner: boolean;
  isShared: boolean;
  canManageShares: boolean;
};

type ListGroupsForUserOptions = {
  includeParticipants?: boolean;
  includeShared?: boolean;
  /** Avoid subscription/slot maintenance on latency-sensitive directory reads. */
  skipMaintenance?: boolean;
  /** Restrict admin-wide results to the instance currently being opened. */
  instanceId?: number;
};

type GroupContextRow = BotGroupRow & {
  instance_token: string;
  instance_base_url: string;
  instance_phone: string | null;
};

type SessionRequestInit = RequestInit & { expectedStatus?: number };

const parseJson = (value: unknown) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const GROUP_JID_REGEX = /([0-9A-Za-z-]{6,}@g\.us)/i;

const extractGroupJidFromText = (value: string): string | null => {
  const match = value.match(GROUP_JID_REGEX);
  return match ? match[1] : null;
};

const findStringInObject = (source: unknown, candidates: readonly string[]): string | null => {
  if (!source) {
    return null;
  }

  if (typeof source === "string") {
    const trimmed = source.trim();
    const jid = extractGroupJidFromText(trimmed);
    if (jid) {
      return jid;
    }
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(source)) {
    for (const entry of source) {
      const result = findStringInObject(entry, candidates);
      if (result) {
        return result;
      }
    }
    return null;
  }

  if (typeof source === "object") {
    const record = source as Record<string, unknown>;
    for (const key of candidates) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }

    for (const value of Object.values(record)) {
      const nested = findStringInObject(value, candidates);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
};

const normalizeGroupJid = (value: string, fallbackDomain = "g.us"): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const extracted = extractGroupJidFromText(trimmed);
  if (extracted) {
    return extracted;
  }

  if (trimmed.includes("@")) {
    if (/\s/.test(trimmed)) {
      return extractGroupJidFromText(trimmed);
    }
    return trimmed;
  }

  if (/^[0-9A-Za-z-]+$/.test(trimmed)) {
    return `${trimmed}@${fallbackDomain}`;
  }

  return null;
};

const extractGroupIdFromErrorDetails = (
  details: unknown,
  inviteCode: string,
): string | null => {
  const candidates = [
    "groupJID",
    "GroupJID",
    "groupId",
    "group_id",
    "GroupId",
    "groupID",
    "GroupID",
    "groupJid",
    "GroupJid",
    "group_jid",
    "groupjid",
    "jid",
    "JID",
    "id",
    "remoteId",
    "remote_id",
    "RemoteId",
    "remoteID",
    "RemoteID",
    "chatId",
    "chat_id",
    "ChatId",
    "chatID",
    "ChatID",
  ] as const;

  const raw = findStringInObject(details, candidates);
  if (typeof raw === "string" && raw.trim()) {
    const normalized = normalizeGroupJid(raw);
    if (normalized) {
      return normalized;
    }
  }

  return normalizeGroupJid(inviteCode);
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

const parseMetadataBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "não", "nao", "off"].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const parseMetadataString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const parseMetadataNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return null;
  }
  return numeric;
};

const parseMetadataStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0),
    ),
  );
};

const ADMIN_ROLE_ALIASES = new Set([
  "admin",
  "administrator",
  "administrador",
  "superadmin",
  "super-admin",
  "super_admin",
]);

const isAdminRole = (value: unknown): boolean =>
  typeof value === "string" && ADMIN_ROLE_ALIASES.has(value.trim().toLowerCase());

const userHasAdminAccess = async (userId: number): Promise<boolean> => {
  const normalizedUserId = Number(userId);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return false;
  await ensureUserTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT role FROM users WHERE id = ? LIMIT 1",
    [normalizedUserId],
  );
  return Array.isArray(rows) && rows.length > 0 && isAdminRole(rows[0].role);
};

const buildGroupMetadata = (raw: unknown): BotGroupMetadata => {
  const record = toRecord(raw);

  const adminsOnly = parseMetadataBoolean(
    record.announce ?? record.announceOnly ?? record.adminsOnly ?? record.onlyAdmins,
  );
  const locked = parseMetadataBoolean(record.locked);
  const ephemeralRaw =
    record.ephemeral ?? record.ephemeralDuration ?? record.ephemeral_setting ?? record.ephemeralSetting;
  const menuBackgroundPath = parseMetadataString(
    record.menuBackgroundPath ?? record.menu_background_path ?? record.menu_background,
  );
  const activatedAt = parseMetadataString(record.activatedAt ?? record.activated_at);
  const lastActivatedAt = parseMetadataString(record.lastActivatedAt ?? record.last_activated_at);
  const lastDeactivatedAt = parseMetadataString(record.lastDeactivatedAt ?? record.last_deactivated_at);
  const botPausedPreserveAccess = parseMetadataBoolean(
    record.botPausedPreserveAccess ?? record.bot_paused_preserve_access,
  );
  const botPausedPreserveAccessAt = parseMetadataString(
    record.botPausedPreserveAccessAt ?? record.bot_paused_preserve_access_at,
  );
  const botPausedPreserveAccessReason = parseMetadataString(
    record.botPausedPreserveAccessReason ?? record.bot_paused_preserve_access_reason,
  );
  const licensePlanId = parseMetadataNumber(record.licensePlanId ?? record.license_plan_id);
  const licensePlanName = parseMetadataString(record.licensePlanName ?? record.license_plan_name);
  const licenseStartsAt = parseMetadataString(record.licenseStartsAt ?? record.license_starts_at);
  const licenseExpiresAt = parseMetadataString(record.licenseExpiresAt ?? record.license_expires_at);
  const licenseLastPaidAt = parseMetadataString(record.licenseLastPaidAt ?? record.license_last_paid_at);
  const licenseDurationDays = parseMetadataNumber(record.licenseDurationDays ?? record.license_duration_days);
  const licenseSource = parseMetadataString(record.licenseSource ?? record.license_source);
  const licenseSubscriptionId = parseMetadataNumber(record.licenseSubscriptionId ?? record.license_subscription_id);
  const licenseBasePlanSlot = parseMetadataNumber(record.licenseBasePlanSlot ?? record.license_base_plan_slot);
  const licenseRemovedAt = parseMetadataString(record.licenseRemovedAt ?? record.license_removed_at);
  const licenseTransferredToGroupId = parseMetadataNumber(
    record.licenseTransferredToGroupId ?? record.license_transferred_to_group_id,
  );
  const licenseTransferredFromGroupId = parseMetadataNumber(
    record.licenseTransferredFromGroupId ?? record.license_transferred_from_group_id,
  );
  const licensePaymentReference = parseMetadataString(
    record.licensePaymentReference ?? record.license_payment_reference,
  );
  const licensePaymentReferences = parseMetadataStringList(
    record.licensePaymentReferences ?? record.license_payment_references,
  );

  return {
    adminsOnly: adminsOnly ?? false,
    locked: locked ?? false,
    ephemeral: parseMetadataString(ephemeralRaw),
    menuBackgroundPath: menuBackgroundPath,
    menuBackgroundUrl: menuBackgroundPath ? resolveUploadedFileUrl(menuBackgroundPath) : null,
    activatedAt,
    lastActivatedAt,
    lastDeactivatedAt,
    botPausedPreserveAccess: botPausedPreserveAccess ?? false,
    botPausedPreserveAccessAt,
    botPausedPreserveAccessReason,
    licensePlanId,
    licensePlanName,
    licenseStartsAt,
    licenseExpiresAt,
    licenseLastPaidAt,
    licenseDurationDays,
    licenseSource,
    licenseSubscriptionId,
    licenseBasePlanSlot,
    licenseRemovedAt,
    licenseTransferredToGroupId,
    licenseTransferredFromGroupId,
    licensePaymentReference,
    licensePaymentReferences,
  } satisfies BotGroupMetadata;
};

const requestInstanceJson = async <T>(
  baseUrl: string,
  token: string,
  path: string,
  init: SessionRequestInit = {},
): Promise<T> => {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const { expectedStatus, headers, body, ...rest } = init;

  const headersInit = new Headers(headers as HeadersInit | undefined);
  if (!headersInit.has("Accept")) {
    headersInit.set("Accept", "application/json");
  }
  headersInit.set("Token", token);
  if (body && !headersInit.has("Content-Type")) {
    headersInit.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...rest,
    headers: headersInit,
    body,
  });

  let payload: unknown = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
  }

  const expected = expectedStatus ?? (response.status >= 200 && response.status < 300 ? response.status : 200);
  if (response.status !== expected && !response.ok) {
    const data = payload as { message?: unknown; error?: unknown; detail?: unknown };
    const messageValue = data?.message ?? data?.error ?? data?.detail;
    const message =
      typeof messageValue === "string" && messageValue.trim()
        ? messageValue.trim()
        : `Falha ao comunicar com a instância (status ${response.status}).`;
    throw new BotGroupError(message, response.status, payload);
  }

  return payload as T;
};

const connectSession = async (baseUrl: string, token: string): Promise<void> => {
  try {
    await requestInstanceJson(baseUrl, token, "/session/connect", {
      method: "POST",
      body: JSON.stringify({
        Subscribe: DEFAULT_EVENTS.split(","),
        Immediate: true,
      }),
      expectedStatus: 200,
    });
  } catch {
    /* ignore initial failures; the API will attempt to reconnect later */
  }
};

const normalizeInviteInput = (raw: string): { inviteCode: string; inviteLink: string } => {
  if (typeof raw !== "string") {
    throw new BotGroupError("Informe o link de convite do grupo.");
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BotGroupError("Informe o link de convite do grupo.");
  }

  const codeMatch = trimmed.match(/chat\.whatsapp\.com\/([A-Za-z0-9-_]+)/i);
  const code = codeMatch?.[1] ?? trimmed.split("/").pop();
  if (!code || code.length < 6) {
    throw new BotGroupError("Link de convite do grupo inválido.");
  }

  return {
    inviteCode: code.replace(/\?.*$/, ""),
    inviteLink: trimmed,
  };
};

const normalizeRemoteGroupInput = (raw: string): string => {
  if (typeof raw !== "string") {
    throw new BotGroupError("Informe o identificador do grupo.");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BotGroupError("Informe o identificador do grupo.");
  }
  const normalized = normalizeGroupJid(trimmed);
  if (!normalized) {
    throw new BotGroupError("Identificador de grupo inválido.");
  }
  return normalized;
};

const parseInviteLinkFromPayload = (payload: unknown): string | null => {
  if (typeof payload === "string" && payload.trim()) {
    const text = payload.trim();
    if (text.includes("chat.whatsapp.com/")) {
      return text;
    }
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.inviteLink,
    record.invite_link,
    record.InviteLink,
    record.link,
    record.Link,
    record.url,
    record.URL,
    record.invite,
    record.Invite,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().includes("chat.whatsapp.com/")) {
      return candidate.trim();
    }
  }

  const codeCandidates = [record.code, record.Code, record.inviteCode, record.InviteCode];
  for (const code of codeCandidates) {
    if (typeof code === "string" && code.trim().length >= 6) {
      return `https://chat.whatsapp.com/${code.trim()}`;
    }
  }

  return null;
};

const normalizeParticipant = (raw: unknown): BotGroupParticipant | null => {
  if (typeof raw === "string" && raw.trim()) {
    return {
      id: raw.trim(),
      admin: "member",
    };
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const idCandidates = [
    record.id,
    record.jid,
    record.JID,
    record._serialized,
    record.PhoneNumber,
    record.phone,
    record.Phone,
    record.Number,
    record.lid,
    record.LID,
  ];
  const idValue = idCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  if (typeof idValue !== "string" || !idValue.trim()) {
    return null;
  }

  const adminSources = [
    record.admin,
    record.role,
    record.Role,
    record.Admin,
    record.isAdmin === true ? "admin" : null,
    record.IsAdmin === true ? "admin" : null,
  ];
  const adminRaw = adminSources.find((candidate) => typeof candidate === "string" && candidate);
  const normalizedAdmin = String(adminRaw || "")
    .toLowerCase()
    .trim();

  const admin: BotGroupParticipant["admin"] =
    normalizedAdmin === "superadmin"
      ? "superadmin"
      : normalizedAdmin === "admin"
        ? "admin"
        : "member";

  const stringCandidate = (...values: unknown[]) => {
    const found = values.find((candidate) => typeof candidate === "string" && candidate.trim());
    return typeof found === "string" ? found.trim() : null;
  };

  const name = stringCandidate(
    record.name,
    record.Name,
    record.displayName,
    record.DisplayName,
    record.notify,
    record.Notify,
    record.verifiedName,
    record.VerifiedName,
  );
  const pushName = stringCandidate(record.pushName, record.PushName, record.shortName, record.ShortName);
  const phone = stringCandidate(record.phone, record.Phone, record.PhoneNumber, record.Number);
  const imageUrl = stringCandidate(
    record.imageUrl,
    record.ImageUrl,
    record.avatarUrl,
    record.AvatarUrl,
    record.pictureUrl,
    record.PictureUrl,
    record.profilePicUrl,
    record.ProfilePicUrl,
    record.profilePicture,
    record.ProfilePicture,
  );

  return {
    id: idValue.trim(),
    admin,
    ...(name ? { name, displayName: name } : {}),
    ...(pushName ? { pushName } : {}),
    ...(phone ? { phone } : {}),
    ...(imageUrl ? { imageUrl, avatarUrl: imageUrl } : {}),
  };
};

const normalizeParticipants = (raw: unknown): BotGroupParticipant[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => normalizeParticipant(item))
    .filter((item): item is BotGroupParticipant => Boolean(item));
};

type PartialGroupData = {
  id?: string | null;
  subject?: string | null;
  description?: string | null;
  pictureUrl?: string | null;
  owner?: string | null;
  participants?: BotGroupParticipant[];
  announce?: boolean | null;
  locked?: boolean | null;
  ephemeral?: unknown;
  isParent?: boolean | null;
  linkedParentJid?: string | null;
};

export type DiscoverableGroup = {
  remoteId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  owner: string | null;
  participantsCount: number;
  linkedGroupId: number | null;
  inviteLink: string | null;
  announceOnly: boolean;
  instanceIsAdmin: boolean;
  mentionable: boolean;
  isCommunity: boolean;
  linkedParentJid: string | null;
};

const extractGroupListPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const directCandidates = [
    record.groups,
    record.Groups,
    record.data,
    record.Data,
    record.result,
    record.Result,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.groups)) return nested.groups;
      if (Array.isArray(nested.Groups)) return nested.Groups;
      if (Array.isArray(nested.data)) return nested.data;
      if (Array.isArray(nested.items)) return nested.items;
    }
  }

  return [];
};

const normalizeGroupData = (raw: unknown): PartialGroupData => {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const record = raw as Record<string, unknown>;
  const data = (record.data && typeof record.data === "object" ? record.data : raw) as Record<string, unknown>;

  const idCandidates = [
    data.id,
    data.Id,
    data.ID,
    data.JID,
    data.jid,
    data._serialized,
    data.groupId,
    data.groupID,
    data.GroupId,
    data.GroupID,
    data.groupJid,
    data.groupJID,
    data.GroupJid,
    data.GroupJID,
    data.chatId,
    data.ChatId,
    data.chatID,
    data.ChatID,
    data.remoteId,
    data.remoteID,
    data.RemoteId,
    data.RemoteID,
  ];

  const subjectCandidates = [
    data.subject,
    data.Subject,
    data.name,
    data.Name,
    data.topic,
    data.Topic,
  ];

  const descriptionCandidates = [
    data.description,
    data.Description,
    data.desc,
    data.Desc,
    data.Topic,
    data.topic,
  ];

  const pictureCandidates = [
    data.pictureUrl,
    data.PictureUrl,
    data.pictureURL,
    data.PictureURL,
    data.picture,
    data.Picture,
  ];

  const ownerCandidates = [
    data.owner,
    data.Owner,
    data.superadmin,
    data.SuperAdmin,
    // WuzAPI/MultZap variants
    (data as any).OwnerJID,
    (data as any).OwnerPN,
    (data as any).OwnerNumber,
  ];

  const idValue = idCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  const subjectValue = subjectCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  const descriptionValue = descriptionCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  let pictureValue = pictureCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  // Support object payloads like { Picture: { url: "..." } }
  if (!pictureValue) {
    const picObj = (data as any).Picture || (data as any).picture;
    if (picObj && typeof picObj === "object") {
      const urlCandidate = [picObj.url, picObj.URL, picObj.Url, picObj.link, picObj.href]
        .find((v: unknown) => typeof v === "string" && v.trim());
      if (typeof urlCandidate === "string" && urlCandidate.trim()) {
        pictureValue = urlCandidate;
      } else if (typeof picObj.direct_path === "string" && picObj.direct_path.trim()) {
        // Build absolute URL from WhatsApp CDN direct_path if available
        pictureValue = `https://pps.whatsapp.net${picObj.direct_path}`;
      }
    }
  }
  const ownerValue = ownerCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());

  const announceValue =
    data.isannounce ?? data.isAnnounce ?? data.IsAnnounce ?? data.Announce ?? data.announce ?? null;
  const lockedValue = data.locked ?? data.Locked ?? null;
  const ephemeralValue =
    data.EphemeralDuration ?? data.ephemeralDuration ?? data.Ephemeral ?? data.ephemeral ?? null;
  const isParentValue =
    data.IsParent ?? data.isParent ?? data.isCommunity ?? data.IsCommunity ?? null;
  const linkedParentValue = [
    data.LinkedParentJID,
    data.linkedParentJID,
    data.linkedParentJid,
    data.linked_parent_jid,
  ].find((candidate) => typeof candidate === "string" && candidate.trim());

  const participants = normalizeParticipants(
    (data.participants as unknown) ?? (data.Participants as unknown),
  );
  const normalizedId =
    typeof idValue === "string" && idValue.trim()
      ? normalizeGroupJid(idValue) ?? idValue.trim()
      : null;

  return {
    id: normalizedId,
    subject: typeof subjectValue === "string" ? subjectValue : null,
    description: typeof descriptionValue === "string" ? descriptionValue : null,
    pictureUrl: typeof pictureValue === "string" ? pictureValue : null,
    owner: typeof ownerValue === "string" ? ownerValue : null,
    participants,
    announce: typeof announceValue === "boolean" ? announceValue : typeof announceValue === "string" ? ["true", "1"].includes(announceValue.toLowerCase()) : null,
    locked: typeof lockedValue === "boolean" ? lockedValue : typeof lockedValue === "string" ? ["true", "1"].includes(lockedValue.toLowerCase()) : null,
    ephemeral: ephemeralValue,
    isParent:
      typeof isParentValue === "boolean"
        ? isParentValue
        : typeof isParentValue === "string"
          ? ["true", "1"].includes(isParentValue.toLowerCase())
          : null,
    linkedParentJid:
      typeof linkedParentValue === "string" && linkedParentValue.trim()
        ? normalizeGroupJid(linkedParentValue) ?? linkedParentValue.trim()
        : null,
  };
};

const mergeGroupData = (...sources: PartialGroupData[]): Required<PartialGroupData> => {
  const merged: Required<PartialGroupData> = {
    id: null,
    subject: null,
    description: null,
    pictureUrl: null,
    owner: null,
    participants: [],
    announce: null,
    locked: null,
    ephemeral: null,
    isParent: null,
    linkedParentJid: null,
  };

  for (const source of sources) {
    if (!source) continue;
    if (source.id && !merged.id) merged.id = source.id;
    if (source.subject && !merged.subject) merged.subject = source.subject;
    if (source.description && !merged.description) merged.description = source.description;
    if (source.pictureUrl && !merged.pictureUrl) merged.pictureUrl = source.pictureUrl;
    if (source.owner && !merged.owner) merged.owner = source.owner;
    if ((source.participants?.length ?? 0) > 0 && merged.participants.length === 0) {
      merged.participants = source.participants ?? [];
    }
    if (source.announce !== undefined && source.announce !== null && merged.announce === null) {
      merged.announce = source.announce;
    }
    if (source.locked !== undefined && source.locked !== null && merged.locked === null) {
      merged.locked = source.locked;
    }
    if (source.ephemeral !== null && merged.ephemeral === null) merged.ephemeral = source.ephemeral;
    if (source.isParent !== undefined && source.isParent !== null && merged.isParent === null) {
      merged.isParent = source.isParent;
    }
    if (source.linkedParentJid && !merged.linkedParentJid) {
      merged.linkedParentJid = source.linkedParentJid;
    }
  }

  return merged;
};

const wuzapiClientFromRow = (row: GroupContextRow): WuzapiClient => ({
  baseUrl: String(row.instance_base_url || '').trim(),
  token: String(row.instance_token || ''),
});

const fetchGroupContextRow = async (
  userId: number,
  groupId: number,
): Promise<GroupContextRow> => {
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(GroupContextRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.token AS instance_token,
        bi.base_url AS instance_base_url,
        bi.phone AS instance_phone
      FROM bot_groups bg
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.id = ? AND bg.user_id = ?
      LIMIT 1
    `,
    [groupId, userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  let row = rows[0];
  if (!row.instance_token || !row.instance_base_url) {
    // tenta reatribuir para instância conectada
    const [inst] = await db.query<RowDataPacket[]>(
      `SELECT id, token, base_url FROM bot_instances WHERE user_id = ? AND session_status = 'conectado' ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [userId],
    );
    if (Array.isArray(inst) && inst.length > 0) {
      const newId = Number(inst[0].id);
      await db.query(`UPDATE bot_groups SET instance_id = ?, updated_at = NOW() WHERE id = ?`, [newId, groupId]);
      const [refetched] = await db.query<(GroupContextRow & RowDataPacket)[]>(
        `SELECT bg.*, bi.token AS instance_token, bi.base_url AS instance_base_url, bi.phone AS instance_phone FROM bot_groups bg LEFT JOIN bot_instances bi ON bi.id = bg.instance_id WHERE bg.id = ? LIMIT 1`,
        [groupId],
      );
      if (Array.isArray(refetched) && refetched.length > 0) {
        row = refetched[0];
      }
    }
  }

  return row;
};

const readMetadataRecord = (row: { metadata: string | null }): Record<string, unknown> =>
  toRecord(parseJson(row.metadata));

const persistGroupMetadata = async (
  groupId: number,
  metadata: Record<string, unknown>,
): Promise<void> => {
  const db = getDb();
  await db.query(
    `UPDATE bot_groups SET metadata = ?, updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(metadata), groupId],
  );
};

const normalizeGroupName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new BotGroupError("Informe o nome do grupo.");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BotGroupError("Informe o nome do grupo.");
  }
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
};

const normalizeGroupDescription = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  return text.length > 2000 ? text.slice(0, 2000) : text;
};

const normalizeEphemeral = (value: unknown): string => {
  if (value === null || value === undefined) {
    throw new BotGroupError("Informe a duração das mensagens temporárias.");
  }
  const normalized = String(value).trim().toLowerCase();
  const allowed = new Set(["off", "24h", "7d", "90d"]);
  if (!allowed.has(normalized)) {
    throw new BotGroupError("Duração inválida para mensagens temporárias.");
  }
  return normalized;
};

const normalizeIdentityDigits = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  const localPart = text.includes("@") ? text.split("@")[0] ?? "" : text;
  const normalized = localPart.split(":")[0] ?? localPart;
  return normalized.replace(/\D/g, "");
};

const hasMatchingIdentityDigits = (left: string, right: string): boolean => {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 8 && right.length >= 8) {
    return left.endsWith(right) || right.endsWith(left);
  }
  return false;
};

const hasGroupAdminPermission = (row: GroupContextRow): boolean => {
  const instanceDigits = normalizeIdentityDigits(row.instance_phone);
  if (!instanceDigits) {
    return true;
  }

  const ownerDigits = normalizeIdentityDigits(row.owner);
  if (hasMatchingIdentityDigits(instanceDigits, ownerDigits)) {
    return true;
  }

  const participants = normalizeParticipants(parseJson(row.participants) ?? []);
  if (!ownerDigits && participants.length === 0) {
    return true;
  }
  const hasAdminParticipantData = participants.some((participant) => participant.admin !== "member");
  if (!ownerDigits && !hasAdminParticipantData) {
    return true;
  }

  return participants.some((participant) => {
    if (participant.admin === "member") return false;
    return hasMatchingIdentityDigits(instanceDigits, normalizeIdentityDigits(participant.id));
  });
};

const assertGroupAdminPermission = (row: GroupContextRow): void => {
  if (hasGroupAdminPermission(row)) {
    return;
  }
  throw new BotGroupError(
    "Esta conexão não é administradora deste grupo. Apenas admins podem editar dados e foto.",
    403,
  );
};

const handleWuzapiError = (error: unknown, fallbackMessage: string): never => {
  const statusCandidate = (error as { status?: number })?.status;
  const status = typeof statusCandidate === "number" && Number.isFinite(statusCandidate)
    ? statusCandidate
    : 502;
  const message =
    error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0
      ? error.message.trim()
      : fallbackMessage;
  throw new BotGroupError(message, status);
};

const parseRowDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoString = (value: Date | string | null | undefined): string => {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const mapShareRow = (row: BotGroupShareRow): BotGroupShare => ({
  id: Number(row.id),
  groupId: Number(row.group_id),
  ownerUserId: Number(row.owner_user_id),
  sharedUserId: Number(row.shared_user_id),
  grantedByUserId: row.granted_by_user_id === null ? null : Number(row.granted_by_user_id),
  role: "admin",
  name: row.shared_user_name || row.shared_user_email || `Usuário #${row.shared_user_id}`,
  email: row.shared_user_email ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

type SyncGroupInfoOptions = {
  force?: boolean;
  maxAgeMs?: number;
  minAttemptIntervalMs?: number;
};

const groupInfoSyncAttemptAt = new Map<string, number>();
const GROUP_SYNC_BLOCK_REASON_NOT_PARTICIPANT = "instance_not_participant";

const collectErrorMessages = (value: unknown, messages: string[] = []): string[] => {
  if (!value) {
    return messages;
  }

  if (typeof value === "string") {
    messages.push(value);
    return messages;
  }

  if (value instanceof Error) {
    messages.push(value.message);
  }

  if (typeof value !== "object") {
    return messages;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "details", "response", "data", "body"]) {
    const nested = record[key];
    if (nested && nested !== value) {
      collectErrorMessages(nested, messages);
    }
  }

  return messages;
};

const isInstanceNotParticipantError = (error: unknown): boolean => {
  const text = collectErrorMessages(error).join(" ").toLowerCase();
  return (
    text.includes("not participating in that group") ||
    text.includes("not a participant") ||
    text.includes("não participa") ||
    text.includes("nao participa") ||
    text.includes("não é participante") ||
    text.includes("nao e participante")
  );
};

const isGroupSyncBlockedByMembership = (row: GroupContextRow): boolean => {
  if (row.status === "active") {
    return false;
  }

  const metadata = readMetadataRecord(row);
  return metadata.syncBlockedReason === GROUP_SYNC_BLOCK_REASON_NOT_PARTICIPANT;
};

const disableGroupAfterMembershipSyncFailure = async (
  row: GroupContextRow,
  error: unknown,
): Promise<void> => {
  const db = getDb();
  const metadata = readMetadataRecord(row);
  const errorMessages = collectErrorMessages(error);
  const membershipMessage =
    errorMessages.find((message) => isInstanceNotParticipantError(message)) ??
    errorMessages.find((message) => message.trim().length > 0);
  metadata.syncBlockedReason = GROUP_SYNC_BLOCK_REASON_NOT_PARTICIPANT;
  metadata.syncBlockedAt = new Date().toISOString();
  metadata.syncBlockedMessage =
    membershipMessage ??
    "A instância não participa mais deste grupo.";
  metadata.lastDeactivatedAt = metadata.syncBlockedAt;

  await db.query(
    `
      UPDATE bot_groups
      SET status = 'disabled', slot = 0, metadata = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
    `,
    [JSON.stringify(metadata), row.id, row.user_id],
  );
  await normalizeActiveGroupSlotsForUser(row.user_id);
};

export const syncGroupInfo = async (
  userId: number,
  groupId: number,
  options: SyncGroupInfoOptions = {},
): Promise<void> => {
  let row: GroupContextRow | null = null;
  try {
    row = await fetchGroupContextRow(userId, groupId);
    if (isGroupSyncBlockedByMembership(row)) {
      return;
    }

    const maxAgeMs =
      typeof options.maxAgeMs === "number" && Number.isFinite(options.maxAgeMs)
        ? Math.max(0, options.maxAgeMs)
        : 0;
    const minAttemptIntervalMs =
      typeof options.minAttemptIntervalMs === "number" && Number.isFinite(options.minAttemptIntervalMs)
        ? Math.max(0, options.minAttemptIntervalMs)
        : 0;
    const attemptKey = `${userId}:${groupId}`;
    const now = Date.now();
    if (!options.force && minAttemptIntervalMs > 0) {
      const lastAttempt = groupInfoSyncAttemptAt.get(attemptKey) ?? 0;
      if (lastAttempt > 0 && now - lastAttempt < minAttemptIntervalMs) {
        return;
      }
    }
    if (!options.force && maxAgeMs > 0) {
      const lastSync =
        parseRowDate(row.participants_synced_at) ??
        parseRowDate(row.group_synced_at) ??
        parseRowDate(row.updated_at);
      if (lastSync && now - lastSync.getTime() < maxAgeMs) {
        return;
      }
    }
    groupInfoSyncAttemptAt.set(attemptKey, now);

    const client = wuzapiClientFromRow(row);
    const info = await getGroupInfo(client, row.remote_id);
    const normalized = normalizeGroupData(info);
    const metadata = readMetadataRecord(row);

    const announce = parseMetadataBoolean(normalized.announce);
    if (announce !== null) {
      metadata.announce = announce;
      metadata.adminsOnly = announce;
      metadata.onlyAdmins = announce;
    }

    const locked = parseMetadataBoolean(normalized.locked);
    if (locked !== null) {
      metadata.locked = locked;
    }

    const ephemeral = parseMetadataString(normalized.ephemeral);
    if (ephemeral !== null) {
      metadata.ephemeral = ephemeral;
    }

    const db = getDb();
    await db.query(
      `
        UPDATE bot_groups
        SET
          name = ?,
          description = ?,
          image_url = ?,
          owner = ?,
          participants = ?,
          metadata = ?,
          group_synced_at = NOW(),
          participants_synced_at = NOW(),
          updated_at = NOW()
        WHERE id = ?
      `,
      [
        normalized.subject || row.name,
        normalized.description ?? row.description ?? null,
        normalized.pictureUrl ?? row.image_url ?? null,
        normalized.owner ?? row.owner ?? null,
        JSON.stringify(normalized.participants ?? []),
        JSON.stringify(metadata),
        row.id,
      ],
    );
  } catch (error) {
    if (row && isInstanceNotParticipantError(error)) {
      try {
        await disableGroupAfterMembershipSyncFailure(row, error);
        console.warn("[bot-groups] Grupo desativado porque a instância não participa mais", {
          groupId,
          remoteId: row.remote_id,
          instanceId: row.instance_id,
        });
        return;
      } catch (disableError) {
        console.error("[bot-groups] Falha ao desativar grupo sem participação da instância", {
          groupId,
          error: disableError,
        });
      }
    }

    console.error("[bot-groups] Falha ao sincronizar informações do grupo", {
      groupId,
      error,
    });
  }
};

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
};

const isJoinConflictError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status === 409) {
    return true;
  }

  const messageRaw = typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : "";
  if (!messageRaw) {
    return false;
  }

  const normalized = messageRaw.toLowerCase();
  if (normalized.includes("status 409")) {
    return true;
  }

  if (
    (normalized.includes("already") && normalized.includes("group")) ||
    normalized.includes("já está no grupo") ||
    normalized.includes("ja esta no grupo") ||
    normalized.includes("já participa") ||
    normalized.includes("ja participa")
  ) {
    return true;
  }

  return false;
};

const countActiveGroups = async (userId: number): Promise<number> => {
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM bot_groups WHERE user_id = ? AND status = 'active'",
    [userId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }
  return Number(rows[0].total ?? 0);
};

const resolveInitialGroupStatusForUser = async (
  userId: number,
): Promise<"active" | "disabled"> => {
  void userId;
  return "disabled";
};

export const getActiveGroupCountForUser = async (userId: number): Promise<number> =>
  countActiveGroups(userId);

const metadataLicenseExpiryMillis = (metadata: Record<string, unknown>): number | null => {
  const raw = parseMetadataString(metadata.licenseExpiresAt ?? metadata.license_expires_at);
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const AUTO_PROFILE_GROUP_LICENSE_SOURCES = new Set(["profile_plan", "base_plan"]);

const isAutoProfileGroupLicense = (metadata: Record<string, unknown>): boolean => {
  const source = parseMetadataString(metadata.licenseSource ?? metadata.license_source);
  return Boolean(source && AUTO_PROFILE_GROUP_LICENSE_SOURCES.has(source));
};

const clearGroupLicenseMetadata = (metadata: Record<string, unknown>, nowIso: string): Record<string, unknown> => {
  const next = { ...metadata };
  for (const key of Object.keys(next)) {
    if (key.startsWith("license") || key.startsWith("license_")) {
      delete next[key];
    }
  }
  next.profilePlanLicenseClearedAt = nowIso;
  return next;
};

const metadataHasActiveLicense = (metadata: Record<string, unknown>, now = Date.now()): boolean => {
  if (isAutoProfileGroupLicense(metadata)) {
    return false;
  }
  const expiry = metadataLicenseExpiryMillis(metadata);
  return typeof expiry === "number" && expiry > now;
};

const metadataHasPausedResumeAccess = (metadata: Record<string, unknown>): boolean => {
  if (parseMetadataBoolean(metadata.botPausedPreserveAccess ?? metadata.bot_paused_preserve_access) === true) {
    return true;
  }

  const lastDeactivatedAt = parseMetadataString(metadata.lastDeactivatedAt ?? metadata.last_deactivated_at);
  if (!lastDeactivatedAt || metadataLicenseExpiryMillis(metadata) !== null) {
    return false;
  }

  const licenseRemovedAt = parseMetadataString(metadata.licenseRemovedAt ?? metadata.license_removed_at);
  const licenseTransferredToGroupId = parseMetadataNumber(
    metadata.licenseTransferredToGroupId ?? metadata.license_transferred_to_group_id,
  );
  return !licenseRemovedAt && !licenseTransferredToGroupId;
};

const groupHasPausedResumeAccess = (group: BotGroup | null | undefined): boolean => {
  if (!group) {
    return false;
  }
  return metadataHasPausedResumeAccess(group.metadata ?? {});
};

const activeProfilePlanCoversGroupForUser = async (
  userId: number,
  group: BotGroup,
  now = Date.now(),
): Promise<boolean> => {
  const instanceId = Math.floor(Number(group.instanceId ?? 0));
  if (Number.isFinite(instanceId) && instanceId > 0) {
    const instance = await getInstanceForUser(userId, instanceId);
    const profileExpiry = instance?.expiresAt ? Date.parse(instance.expiresAt) : Number.NaN;
    if (Number.isFinite(profileExpiry) && profileExpiry > now) {
      return true;
    }
  }

  const planStatus = await getUserPlanStatus(userId);
  if (planStatus.status !== "active" || !planStatus.plan) {
    return false;
  }

  const periodEnd = planStatus.currentPeriodEnd ? Date.parse(planStatus.currentPeriodEnd) : null;
  if (periodEnd !== null && (!Number.isFinite(periodEnd) || periodEnd <= now)) {
    return false;
  }

  void group;
  return true;
};

const syncInstanceExpiryFromUserCoverage = async (
  userId: number,
  instanceId: number | null | undefined,
): Promise<void> => {
  const normalizedInstanceId = Math.floor(Number(instanceId ?? 0));
  if (!Number.isFinite(normalizedInstanceId) || normalizedInstanceId <= 0) {
    return;
  }

  await ensureBotInstanceTable();
  await ensureBotGroupTable();

  const now = Date.now();
  const candidates: Date[] = [];
  let activePlanId: number | null = null;

  try {
    const planStatus = await getUserPlanStatus(userId);
    activePlanId = planStatus.status === "active" && planStatus.plan ? planStatus.plan.id : null;
    const planEnd = planStatus.status === "active" ? toValidDate(planStatus.currentPeriodEnd) : null;
    if (planEnd && planEnd.getTime() > now) {
      candidates.push(planEnd);
    }
  } catch (error) {
    console.warn("[bot-groups] Falha ao consultar plano principal para sincronizar perfil", {
      userId,
      instanceId: normalizedInstanceId,
      error,
    });
  }

  const db = getDb();
  const [rows] = await db.query<(RowDataPacket & { metadata: string | null })[]>(
    `
      SELECT metadata
      FROM bot_groups
      WHERE user_id = ?
        AND instance_id = ?
    `,
    [userId, normalizedInstanceId],
  );

  for (const row of rows) {
    const metadata = toRecord(parseJson(row.metadata));
    const expiry = metadataLicenseExpiryMillis(metadata);
    if (metadataHasActiveLicense(metadata, now) && typeof expiry === "number" && expiry > now) {
      candidates.push(new Date(expiry));
    }
  }

  if (candidates.length === 0) {
    return;
  }

  const maxExpiry = candidates.reduce((latest, current) =>
    current.getTime() > latest.getTime() ? current : latest,
  );

  await db.query(
    `
      UPDATE bot_instances
      SET
        expires_at = ?,
        plan_id = COALESCE(?, plan_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND user_id = ?
    `,
    [maxExpiry, activePlanId, normalizedInstanceId, userId],
  );
};

const computeNextSlot = async (userId: number): Promise<number> => {
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(RowDataPacket & { slot: number | null; metadata: string | null; status: string })[]>(
    "SELECT slot, metadata, status FROM bot_groups WHERE user_id = ? ORDER BY slot ASC",
    [userId],
  );
  const usedSlots = new Set<number>();
  for (const row of rows) {
    const metadata = toRecord(parseJson(row.metadata));
    const licensed = metadataHasActiveLicense(metadata);
    if (!licensed) {
      continue;
    }
    const slot = Number(row.slot ?? 0);
    if (Number.isFinite(slot) && slot > 0) {
      usedSlots.add(slot);
    }
  }
  let slot = 1;
  while (usedSlots.has(slot)) {
    slot += 1;
  }
  return slot;
};

const normalizeActiveGroupSlotsForUser = async (userId: number): Promise<void> => {
  await ensureBotGroupTable();
  const db = getDb();
  const now = Date.now();

  const [rows] = await db.query<(RowDataPacket & { id: number; slot: number | null; status: string; metadata: string | null })[]>(
    `
      SELECT id, slot, status, metadata
      FROM bot_groups
      WHERE user_id = ?
      ORDER BY
        CASE WHEN slot IS NULL OR slot <= 0 THEN 2147483647 ELSE slot END ASC,
        id ASC
    `,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const usedSlots = new Set<number>();
  let nextSlot = 1;
  for (const row of rows) {
    const groupId = Number(row.id);
    const currentSlot = Math.floor(Number(row.slot ?? 0));
    const metadata = toRecord(parseJson(row.metadata));
    const occupiesPremiumSlot = metadataHasActiveLicense(metadata, now);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      continue;
    }
    if (!occupiesPremiumSlot) {
      if (Number.isFinite(currentSlot) && currentSlot > 0) {
        await db.query(
          "UPDATE bot_groups SET slot = 0, updated_at = NOW() WHERE id = ? AND user_id = ?",
          [groupId, userId],
        );
      }
      continue;
    }
    if (Number.isFinite(currentSlot) && currentSlot > 0 && !usedSlots.has(currentSlot)) {
      usedSlots.add(currentSlot);
      continue;
    }
    while (usedSlots.has(nextSlot)) {
      nextSlot += 1;
    }
    if (currentSlot !== nextSlot) {
      await db.query(
        "UPDATE bot_groups SET slot = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
        [nextSlot, groupId, userId],
      );
    }
    usedSlots.add(nextSlot);
    nextSlot += 1;
  }
};

const computeNextActiveSlot = async (userId: number, excludedGroupId?: number | null): Promise<number> => {
  await ensureBotGroupTable();
  const db = getDb();
  const params: number[] = [userId];
  const normalizedExcludedGroupId = Number(excludedGroupId ?? 0);
  const excludeClause =
    Number.isFinite(normalizedExcludedGroupId) && normalizedExcludedGroupId > 0 ? "AND id <> ?" : "";
  if (excludeClause) {
    params.push(normalizedExcludedGroupId);
  }

  const [rows] = await db.query<(RowDataPacket & { slot: number | null; status: string; metadata: string | null })[]>(
    `
      SELECT slot, status, metadata
      FROM bot_groups
      WHERE user_id = ? ${excludeClause}
      ORDER BY slot ASC
    `,
    params,
  );
  const usedSlots = new Set<number>();
  for (const row of rows) {
    const metadata = toRecord(parseJson(row.metadata));
    const licensed = metadataHasActiveLicense(metadata);
    if (!licensed) {
      continue;
    }
    const slot = Number(row.slot ?? 0);
    if (Number.isFinite(slot) && slot > 0) {
      usedSlots.add(slot);
    }
  }

  let slot = 1;
  while (usedSlots.has(slot)) {
    slot += 1;
  }
  return slot;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toValidDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const isGroupLicenseActive = (group: BotGroup | null | undefined, now = Date.now()): boolean => {
  if (!group) {
    return false;
  }
  if (isAutoProfileGroupLicense(group.metadata ?? {})) {
    return false;
  }
  const expiresAt = toValidDate(group.metadata?.licenseExpiresAt ?? null);
  return Boolean(expiresAt && expiresAt.getTime() > now);
};

export const isGroupLicenseActiveForUser = async (
  userId: number,
  group: BotGroup | null | undefined,
  now = Date.now(),
): Promise<boolean> => {
  void userId;
  if (!group) {
    return false;
  }
  return isGroupLicenseActive(group, now);
};

const assertGroupHasActiveLicenseForUser = async (userId: number, group: BotGroup): Promise<void> => {
  if (await isGroupLicenseActiveForUser(userId, group)) {
    return;
  }
  if (await activeProfilePlanCoversGroupForUser(userId, group)) {
    return;
  }
  if (groupHasPausedResumeAccess(group)) {
    return;
  }
  throw new BotGroupError("Assine este grupo para liberar o robô.", 402, {
    reason: "group_plan_required",
    groupId: group.id,
  });
};

const isBasePlanLicenseForCurrentSubscription = (
  metadata: Record<string, unknown>,
  options: {
    subscriptionId: number | null;
    planId: number;
    now: number;
  },
): boolean => {
  const source = parseMetadataString(metadata.licenseSource ?? metadata.license_source);
  if (source !== "base_plan") {
    return false;
  }

  const metadataSubscriptionId = parseMetadataNumber(
    metadata.licenseSubscriptionId ?? metadata.license_subscription_id,
  );
  if (options.subscriptionId && metadataSubscriptionId !== options.subscriptionId) {
    return false;
  }

  if (!options.subscriptionId) {
    const metadataPlanId = parseMetadataNumber(metadata.licensePlanId ?? metadata.license_plan_id);
    if (metadataPlanId !== options.planId) {
      return false;
    }
  }

  const expiresAt = toValidDate(metadata.licenseExpiresAt as string | Date | null | undefined);
  return Boolean(expiresAt && expiresAt.getTime() > options.now);
};

const isBasePlanLicenseForSubscriptionIdentity = (
  metadata: Record<string, unknown>,
  options: {
    subscriptionId: number | null;
    planId: number;
  },
): boolean => {
  const source = parseMetadataString(metadata.licenseSource ?? metadata.license_source);
  if (source !== "base_plan") {
    return false;
  }

  const metadataSubscriptionId = parseMetadataNumber(
    metadata.licenseSubscriptionId ?? metadata.license_subscription_id,
  );
  if (options.subscriptionId && metadataSubscriptionId) {
    return metadataSubscriptionId === options.subscriptionId;
  }

  const metadataPlanId = parseMetadataNumber(metadata.licensePlanId ?? metadata.license_plan_id);
  return metadataPlanId === options.planId;
};

const findNextBasePlanSlot = (usedSlots: Set<number>, groupLimit: number): number | null => {
  for (let slot = 1; slot <= groupLimit; slot += 1) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }
  return null;
};

export const refreshBasePlanGroupLicensesForUser = async (userId: number): Promise<number> => {
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupRow & RowDataPacket)[]>(
    `
      SELECT id, instance_id, metadata, status, slot
      FROM bot_groups
      WHERE user_id = ?
    `,
    [userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const nowIso = new Date().toISOString();
  let changed = 0;
  for (const row of rows) {
    const metadata = toRecord(parseJson(row.metadata));
    if (!isAutoProfileGroupLicense(metadata)) {
      continue;
    }

    const previousJson = JSON.stringify(metadata);
    const cleanedMetadata = clearGroupLicenseMetadata(metadata, nowIso);
    const nextJson = JSON.stringify(cleanedMetadata);
    if (nextJson === previousJson) {
      continue;
    }

    await db.query(
      "UPDATE bot_groups SET slot = 0, metadata = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
      [nextJson, row.id, userId],
    );
    await syncInstanceExpiryFromUserCoverage(userId, row.instance_id);
    changed += 1;
  }

  if (changed > 0) {
    await normalizeActiveGroupSlotsForUser(userId);
  }

  return changed;
};

const applyAvailableBasePlanGroupLicenseForUser = async (
  userId: number,
  groupId: number,
): Promise<BotGroup | null> => {
  await refreshBasePlanGroupLicensesForUser(userId);
  return await getGroupByIdForUser(userId, groupId);
};

export const reconcileBasePlanGroupLicenseForUser = async (
  userId: number,
  groupId: number,
): Promise<BotGroup | null> => {
  await refreshBasePlanGroupLicensesForUser(userId);

  const refreshed = await getGroupByIdForUser(userId, groupId);
  if (isGroupLicenseActive(refreshed)) {
    return refreshed;
  }

  return applyAvailableBasePlanGroupLicenseForUser(userId, groupId);
};

export const applyGroupLicenseForUser = async (
  userId: number,
  groupId: number,
  plan: SubscriptionPlan,
  paymentReference?: string | null,
  options?: {
    licenseSource?: string | null;
  },
): Promise<BotGroup> => {
  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }
  if (!plan || !Number.isFinite(plan.id) || plan.id <= 0) {
    throw new BotGroupError("Plano inválido para liberar o grupo.", 400);
  }
  if (!plan.isActive) {
    throw new BotGroupError("Este plano está inativo no momento.", 400);
  }

  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupRow & RowDataPacket)[]>(
    "SELECT metadata, status, slot, instance_id FROM bot_groups WHERE id = ? AND user_id = ? LIMIT 1",
    [groupId, userId],
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  const metadata = toRecord(parseJson(row.metadata));
  const now = new Date();
  const nowIso = now.toISOString();
  const normalizedReference =
    typeof paymentReference === "string" && paymentReference.trim().length > 0
      ? paymentReference.trim()
      : null;
  const existingReferences = parseMetadataStringList(metadata.licensePaymentReferences);
  const alreadyApplied =
    normalizedReference !== null &&
    (metadata.licensePaymentReference === normalizedReference ||
      existingReferences.includes(normalizedReference));

  const currentExpiry = toValidDate(metadata.licenseExpiresAt as string | null | undefined);
  let nextExpiry = currentExpiry;

  if (!alreadyApplied) {
    const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    nextExpiry = new Date(base.getTime() + Math.max(1, Math.floor(plan.durationDays || 1)) * DAY_IN_MS);
  }

  if (!nextExpiry) {
    nextExpiry = new Date(now.getTime() + Math.max(1, Math.floor(plan.durationDays || 1)) * DAY_IN_MS);
  }

  metadata.licensePlanId = plan.id;
  metadata.licensePlanName = plan.name;
  metadata.licenseDurationDays = Math.max(1, Math.floor(plan.durationDays || 1));
  metadata.licenseStartsAt =
    typeof metadata.licenseStartsAt === "string" && metadata.licenseStartsAt.trim()
      ? metadata.licenseStartsAt
      : nowIso;
  metadata.licenseExpiresAt = nextExpiry.toISOString();
  metadata.licenseLastPaidAt = nowIso;
  const licenseSource = typeof options?.licenseSource === "string" ? options.licenseSource.trim() : "";
  if (licenseSource) {
    metadata.licenseSource = licenseSource;
  }
  if (normalizedReference) {
    metadata.licensePaymentReference = normalizedReference;
    metadata.licensePaymentReferences = Array.from(new Set([...existingReferences, normalizedReference]));
  }

  delete metadata.syncBlockedReason;
  delete metadata.syncBlockedAt;
  delete metadata.syncBlockedMessage;
  metadata.syncBlockClearedAt = nowIso;
  if (typeof metadata.activatedAt !== "string" || !metadata.activatedAt.trim()) {
    metadata.activatedAt = nowIso;
  }
  metadata.lastActivatedAt = nowIso;

  const currentSlot = Math.floor(Number(row.slot ?? 0));
  const nextSlot =
    row.status === "active" && Number.isFinite(currentSlot) && currentSlot > 0
      ? currentSlot
      : await computeNextActiveSlot(userId, groupId);

  await db.query(
    `UPDATE bot_groups SET status = 'active', slot = ?, metadata = ?, updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [nextSlot, JSON.stringify(metadata), groupId, userId],
  );
  await normalizeActiveGroupSlotsForUser(userId);
  await syncInstanceExpiryFromUserCoverage(userId, row.instance_id);

  const updated = await getGroupByIdForUser(userId, groupId);
  if (!updated) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return updated;
};

export const transferGroupLicenseForUser = async (
  userId: number,
  sourceGroupId: number,
  targetGroupId: number,
): Promise<{ sourceGroup: BotGroup; targetGroup: BotGroup }> => {
  const normalizedSourceId = Math.floor(Number(sourceGroupId));
  const normalizedTargetId = Math.floor(Number(targetGroupId));
  if (
    !Number.isFinite(normalizedSourceId) ||
    normalizedSourceId <= 0 ||
    !Number.isFinite(normalizedTargetId) ||
    normalizedTargetId <= 0
  ) {
    throw new BotGroupError("Grupo inválido para transferência.", 400);
  }
  if (normalizedSourceId === normalizedTargetId) {
    throw new BotGroupError("Selecione um grupo diferente para receber a assinatura.", 400);
  }

  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupRow & RowDataPacket)[]>(
    `
      SELECT *
      FROM bot_groups
      WHERE user_id = ?
        AND id IN (?, ?)
    `,
    [userId, normalizedSourceId, normalizedTargetId],
  );

  const sourceRow = rows.find((row) => Number(row.id) === normalizedSourceId) ?? null;
  const targetRow = rows.find((row) => Number(row.id) === normalizedTargetId) ?? null;
  if (!sourceRow || !targetRow) {
    throw new BotGroupError("Grupo não encontrado para transferência.", 404);
  }

  const sourceMetadata = toRecord(parseJson(sourceRow.metadata));
  const targetMetadata = toRecord(parseJson(targetRow.metadata));
  const now = new Date();
  if (!metadataHasActiveLicense(sourceMetadata, now.getTime())) {
    throw new BotGroupError("O grupo de origem não possui assinatura ativa para transferir.", 400);
  }
  if (metadataHasActiveLicense(targetMetadata, now.getTime())) {
    throw new BotGroupError("O grupo destino já possui assinatura ativa.", 409);
  }

  const nowIso = now.toISOString();
  const licenseEntries = Object.entries(sourceMetadata).filter(([key]) => key.startsWith("license"));
  for (const [key, value] of licenseEntries) {
    targetMetadata[key] = value;
  }
  targetMetadata.licenseTransferredAt = nowIso;
  targetMetadata.licenseTransferredFromGroupId = normalizedSourceId;
  targetMetadata.licenseSource = "group_transfer";
  targetMetadata.lastActivatedAt = nowIso;
  if (typeof targetMetadata.activatedAt !== "string" || !targetMetadata.activatedAt.trim()) {
    targetMetadata.activatedAt = nowIso;
  }
  delete targetMetadata.syncBlockedReason;
  delete targetMetadata.syncBlockedAt;
  delete targetMetadata.syncBlockedMessage;
  targetMetadata.syncBlockClearedAt = nowIso;

  for (const key of Object.keys(sourceMetadata)) {
    if (key.startsWith("license")) {
      delete sourceMetadata[key];
    }
  }
  sourceMetadata.licenseTransferredAt = nowIso;
  sourceMetadata.licenseTransferredToGroupId = normalizedTargetId;
  sourceMetadata.lastDeactivatedAt = nowIso;

  const targetSlot =
    targetRow.status === "active" && Number(targetRow.slot ?? 0) > 0
      ? Number(targetRow.slot)
      : await computeNextActiveSlot(userId, normalizedTargetId);

  await db.query(
    "UPDATE bot_groups SET status = 'disabled', slot = 0, metadata = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
    [JSON.stringify(sourceMetadata), normalizedSourceId, userId],
  );
  await db.query(
    "UPDATE bot_groups SET status = 'active', slot = ?, metadata = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
    [targetSlot, JSON.stringify(targetMetadata), normalizedTargetId, userId],
  );

  await normalizeActiveGroupSlotsForUser(userId);
  await Promise.all([
    syncInstanceExpiryFromUserCoverage(userId, sourceRow.instance_id),
    syncInstanceExpiryFromUserCoverage(userId, targetRow.instance_id),
  ]);

  const [sourceGroup, targetGroup] = await Promise.all([
    getGroupByIdForUser(userId, normalizedSourceId),
    getGroupByIdForUser(userId, normalizedTargetId),
  ]);
  if (!sourceGroup || !targetGroup) {
    throw new BotGroupError("Não foi possível carregar os grupos após a transferência.", 500);
  }

  return { sourceGroup, targetGroup };
};

const parseGroupLicenseExpiry = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, yearRaw, monthRaw, dayRaw] = match;
      const year = Number.parseInt(yearRaw, 10);
      const month = Number.parseInt(monthRaw, 10);
      const day = Number.parseInt(dayRaw, 10);
      const parsed = new Date(year, month - 1, day, 23, 59, 59, 999);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  const parsed = toValidDate(value);
  if (!parsed) {
    throw new BotGroupError("Data de vencimento do grupo inválida.", 400);
  }
  return parsed;
};

export const updateGroupLicenseForUser = async (
  userId: number,
  groupId: number,
  options: {
    plan?: SubscriptionPlan | null;
    expiresAt?: string | Date | null;
    active?: boolean | null;
    remove?: boolean;
    adminUserId?: number | null;
  },
): Promise<BotGroup> => {
  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupRow & RowDataPacket)[]>(
    "SELECT metadata, status, slot, instance_id FROM bot_groups WHERE id = ? AND user_id = ? LIMIT 1",
    [groupId, userId],
  );
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  const metadata = toRecord(parseJson(row.metadata));
  const now = new Date();
  const nowIso = now.toISOString();
  const shouldRemove = options.remove === true || options.plan === null;
  const nextActive = options.active === null || options.active === undefined
    ? row.status === "active"
    : Boolean(options.active);

  if (shouldRemove) {
    delete metadata.licensePlanId;
    delete metadata.licensePlanName;
    delete metadata.licenseStartsAt;
    delete metadata.licenseExpiresAt;
    delete metadata.licenseLastPaidAt;
    delete metadata.licenseDurationDays;
    delete metadata.licensePaymentReference;
    delete metadata.licensePaymentReferences;
    metadata.licenseRemovedAt = nowIso;
    if (options.adminUserId) {
      metadata.licenseRemovedByAdminId = options.adminUserId;
    }
    metadata.lastDeactivatedAt = nowIso;

    await db.query(
      `UPDATE bot_groups SET status = 'disabled', slot = 0, metadata = ?, updated_at = NOW() WHERE id = ? AND user_id = ?`,
      [JSON.stringify(metadata), groupId, userId],
    );
    await normalizeActiveGroupSlotsForUser(userId);
    await syncInstanceExpiryFromUserCoverage(userId, row.instance_id);
    const updated = await getGroupByIdForUser(userId, groupId);
    if (!updated) {
      throw new BotGroupError("Grupo não encontrado após atualização.", 404);
    }
    return updated;
  }

  const plan = options.plan;
  if (!plan || !Number.isFinite(plan.id) || plan.id <= 0) {
    throw new BotGroupError("Selecione um plano para este grupo.", 400);
  }
  if (!plan.isActive) {
    throw new BotGroupError("Este plano está inativo no momento.", 400);
  }

  const durationDays = Math.max(1, Math.floor(plan.durationDays || 1));
  const nextExpiry = parseGroupLicenseExpiry(options.expiresAt) ??
    new Date(now.getTime() + durationDays * DAY_IN_MS);
  if (nextActive && nextExpiry.getTime() <= now.getTime()) {
    throw new BotGroupError("A validade do grupo precisa ser futura para ativar.", 400);
  }

  metadata.licensePlanId = plan.id;
  metadata.licensePlanName = plan.name;
  metadata.licenseDurationDays = durationDays;
  metadata.licenseStartsAt =
    typeof metadata.licenseStartsAt === "string" && metadata.licenseStartsAt.trim()
      ? metadata.licenseStartsAt
      : nowIso;
  metadata.licenseExpiresAt = nextExpiry.toISOString();
  metadata.licenseLastPaidAt = nowIso;
  metadata.licenseUpdatedAt = nowIso;
  if (options.adminUserId) {
    metadata.licenseUpdatedByAdminId = options.adminUserId;
  }

  let nextStatus: BotGroup["status"] = row.status === "disabled" ? "disabled" : "active";
  let nextSlot = Math.floor(Number(row.slot ?? 0));

  if (nextActive) {
    nextStatus = "active";
    if (!Number.isFinite(nextSlot) || nextSlot <= 0) {
      nextSlot = await computeNextActiveSlot(userId, groupId);
    }
    delete metadata.syncBlockedReason;
    delete metadata.syncBlockedAt;
    delete metadata.syncBlockedMessage;
    metadata.syncBlockClearedAt = nowIso;
    if (typeof metadata.activatedAt !== "string" || !metadata.activatedAt.trim()) {
      metadata.activatedAt = nowIso;
    }
    metadata.lastActivatedAt = nowIso;
  } else {
    nextStatus = "disabled";
    nextSlot = 0;
    metadata.lastDeactivatedAt = nowIso;
  }

  await db.query(
    `UPDATE bot_groups SET status = ?, slot = ?, metadata = ?, updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [nextStatus, nextSlot, JSON.stringify(metadata), groupId, userId],
  );
  await normalizeActiveGroupSlotsForUser(userId);
  await syncInstanceExpiryFromUserCoverage(userId, row.instance_id);

  const updated = await getGroupByIdForUser(userId, groupId);
  if (!updated) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return updated;
};

const findGroupRowForInstanceByRemoteId = async (
  instanceId: number,
  remoteId: string,
): Promise<(BotGroupRow & RowDataPacket) | null> => {
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupRow & RowDataPacket)[]>(
    "SELECT * FROM bot_groups WHERE instance_id = ? AND remote_id = ? LIMIT 1",
    [instanceId, remoteId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return rows[0];
};

export type ExternalLinkedBotGroupLookup = {
  remoteId: string;
  linkedToOtherUser: true;
};

export const listExternalLinkedGroupRemoteIdsForUser = async (
  userId: number,
  remoteIds: string[],
): Promise<ExternalLinkedBotGroupLookup[]> => {
  await ensureBotGroupTable();

  const normalizedRemoteIds = Array.from(
    new Set(
      remoteIds
        .map((remoteId) => {
          try {
            return normalizeRemoteGroupInput(remoteId).trim();
          } catch {
            return "";
          }
        })
        .filter((remoteId) => remoteId.length > 0),
    ),
  );

  if (normalizedRemoteIds.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = normalizedRemoteIds.map(() => "?").join(", ");
  const [rows] = await db.query<(RowDataPacket & { remote_id: string; user_id: number })[]>(
    `
      SELECT remote_id, user_id
      FROM bot_groups
      WHERE remote_id IN (${placeholders})
        AND status = 'active'
    `,
    normalizedRemoteIds,
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows
    .filter((row) => Number(row.user_id) !== Number(userId))
    .map((row) => ({
      remoteId: row.remote_id,
      linkedToOtherUser: true as const,
    }));
};

export const getGroupDispatchContextForUser = async (userId: number, groupId: number): Promise<{
  client: WuzapiClient;
  groupJid: string;
  instancePhone: string | null;
} | null> => {
  const row = await fetchGroupContextRow(userId, groupId);
  if (!row.remote_id || !row.instance_base_url || !row.instance_token) return null;
  return {
    client: wuzapiClientFromRow(row),
    groupJid: row.remote_id,
    instancePhone: row.instance_phone ?? null,
  };
};

const resolveGroupFromInvite = async (
  instance: BotInstance,
  inviteCode: string,
): Promise<{ data: Required<PartialGroupData>; awaitingApproval: boolean; raw: { invite?: unknown; info?: unknown } }> => {
  const baseUrl = instance.serverBaseUrl;
  if (!baseUrl) {
    throw new BotGroupError("Servidor da instância não configurado.", 500);
  }

  await connectSession(baseUrl, instance.token);

  let awaitingApproval = false;
  let fallbackGroupJid: string | null = null;
  let conflictGroupInfo: unknown = null;
  try {
    await requestInstanceJson(baseUrl, instance.token, "/group/join", {
      method: "POST",
      body: JSON.stringify({ Code: inviteCode }),
    });
  } catch (error) {
    const status = getErrorStatus(error);
    if (status === 401 || status === 403 || status === 202) {
      awaitingApproval = true;
    } else if (isJoinConflictError(error)) {
      awaitingApproval = false;
      const detailsSource =
        error instanceof BotGroupError
          ? error.details
          : (error as { details?: unknown }).details;
      let conflictJid = extractGroupIdFromErrorDetails(detailsSource, inviteCode);
      if (!conflictJid) {
        const messageRaw = typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";
        if (messageRaw) {
          conflictJid = extractGroupJidFromText(messageRaw);
        }
      }
      fallbackGroupJid = conflictJid;
      if (conflictJid) {
        try {
          conflictGroupInfo = await requestInstanceJson(
            baseUrl,
            instance.token,
            `/group/info?groupJID=${encodeURIComponent(conflictJid)}`,
          );
        } catch (infoError) {
          console.warn(
            "[BotGroups] Falha ao obter informações do grupo após conflito 409",
            infoError,
          );
        }
      }
    } else {
      throw error;
    }
  }

  let inviteInfo: unknown = null;
  try {
    inviteInfo = await requestInstanceJson(baseUrl, instance.token, "/group/inviteinfo", {
      method: "POST",
      body: JSON.stringify({ Code: inviteCode }),
    });
  } catch {
    /* ignore; fallback to group info */
  }

  const normalizedInvite = normalizeGroupData(inviteInfo);
  const inviteId = normalizedInvite.id || fallbackGroupJid || `${inviteCode}@g.us`;

  let groupInfo: unknown = conflictGroupInfo;
  if (!groupInfo) {
    try {
      groupInfo = await requestInstanceJson(
        baseUrl,
        instance.token,
        `/group/info?groupJID=${encodeURIComponent(inviteId ?? inviteCode)}`,
      );
    } catch {
      /* ignore; rely on invite info */
    }
  }

  const normalizedGroup = normalizeGroupData(groupInfo);
  const merged = mergeGroupData(
    { ...normalizedInvite, id: normalizedInvite.id || inviteId },
    normalizedGroup,
  );

  if (!merged.id) {
    throw new BotGroupError("Não foi possível identificar o grupo pelo link informado.");
  }

  return {
    data: merged,
    awaitingApproval,
    raw: { invite: inviteInfo, info: groupInfo },
  };
};

const mapRowToGroup = (
  row: BotGroupWithInstanceRow,
  options: ListGroupsForUserOptions = {},
): BotGroup => {
  const participantsRaw = parseJson(row.participants);
  const metadataRaw = parseJson(row.metadata);
  const metadata = buildGroupMetadata(metadataRaw);
  const includeParticipants = options.includeParticipants !== false;
  const participantSource = Array.isArray(participantsRaw) ? participantsRaw : [];
  const normalizedParticipants = includeParticipants ? normalizeParticipants(participantSource) : [];
  const participantCount = includeParticipants
    ? normalizedParticipants.length
    : participantSource.filter((entry) => entry && typeof entry === "object").length;

  return {
    id: row.id,
    userId: row.user_id,
    instanceId: Number.isFinite(Number(row.instance_id)) ? Number(row.instance_id) : 0,
    instanceName:
      typeof row.instance_name === "string" && row.instance_name.trim().length > 0
        ? row.instance_name
        : "Sem conexão vinculada",
    instancePhone: typeof row.instance_phone === "string" ? row.instance_phone : "",
    slot: row.slot ?? 0,
    remoteId: row.remote_id,
    inviteCode: row.invite_code,
    inviteLink: row.invite_link,
    name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    owner: row.owner ?? null,
    awaitingApproval: row.awaiting_approval === 1,
    awaitingEntry: row.awaiting_entry === 1,
    status: row.status === "disabled" ? "disabled" : "active",
    participants: includeParticipants ? normalizedParticipants : [],
    participantCount,
    accessRole: "owner",
    metadata,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
};

export const listGroupsForUser = async (
  userId: number,
  options: ListGroupsForUserOptions = {},
): Promise<BotGroup[]> => {
  await ensureBotGroupTable();
  if (!options.skipMaintenance) {
    await refreshBasePlanGroupLicensesForUser(userId);
    await normalizeActiveGroupSlotsForUser(userId);
  }
  const db = getDb();
  const instanceId = Number(options.instanceId ?? 0);
  const hasInstanceFilter = Number.isFinite(instanceId) && instanceId > 0;
  const instanceClause = hasInstanceFilter ? " AND bg.instance_id = ?" : "";
  const ownParams: number[] = [userId];
  if (hasInstanceFilter) ownParams.push(instanceId);
  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.user_id = ?
        ${instanceClause}
        AND bg.remote_id NOT LIKE 'botadmin-internal:%'
      ORDER BY bg.slot ASC, bg.id ASC
    `,
    ownParams,
  );

  const ownGroups = Array.isArray(rows) ? rows.map((row) => mapRowToGroup(row, options)) : [];
  const isAdmin = await userHasAdminAccess(userId);
  if (!options.includeShared) {
    if (!isAdmin) {
      return ownGroups;
    }
    const adminParams: number[] = [];
    if (hasInstanceFilter) adminParams.push(instanceId);
    const [adminRows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
      `
        SELECT
          bg.*,
          bi.name AS instance_name,
          bi.phone AS instance_phone
        FROM bot_groups bg
        LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
        WHERE bg.remote_id NOT LIKE 'botadmin-internal:%'
          ${instanceClause}
        ORDER BY bg.slot ASC, bg.id ASC
      `,
      adminParams,
    );
    const byId = new Map<number, BotGroup>();
    for (const group of Array.isArray(adminRows) ? adminRows.map((row) => mapRowToGroup(row, options)) : []) {
      byId.set(group.id, group);
    }
    return Array.from(byId.values());
  }

  await ensureBotGroupShareTable();
  const [sharedRows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_group_shares bgs
      INNER JOIN bot_groups bg ON bg.id = bgs.group_id
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bgs.shared_user_id = ?
        ${hasInstanceFilter ? " AND bg.instance_id = ?" : ""}
        AND bg.remote_id NOT LIKE 'botadmin-internal:%'
      ORDER BY bg.slot ASC, bg.id ASC
    `,
    hasInstanceFilter ? [userId, instanceId] : [userId],
  );
  const sharedGroups = Array.isArray(sharedRows)
    ? sharedRows.map((row) => ({
        ...mapRowToGroup(row, options),
        accessRole: "shared_admin" as const,
      }))
    : [];

  const byId = new Map<number, BotGroup>();
  for (const group of [...ownGroups, ...sharedGroups]) {
    byId.set(group.id, group);
  }
  if (isAdmin) {
    const adminParams: number[] = [];
    if (hasInstanceFilter) adminParams.push(instanceId);
    const [adminRows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
      `
        SELECT
          bg.*,
          bi.name AS instance_name,
          bi.phone AS instance_phone
        FROM bot_groups bg
        LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
        WHERE bg.remote_id NOT LIKE 'botadmin-internal:%'
          ${instanceClause}
        ORDER BY bg.slot ASC, bg.id ASC
      `,
      adminParams,
    );
    for (const group of Array.isArray(adminRows) ? adminRows.map((row) => mapRowToGroup(row, options)) : []) {
      byId.set(group.id, group);
    }
  }
  return Array.from(byId.values());
};

export const listGroupSharesForOwner = async (
  ownerUserId: number,
  groupId: number,
): Promise<BotGroupShare[]> => {
  await ensureBotGroupShareTable();
  const group = await getGroupByIdForUser(ownerUserId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  const db = getDb();
  const [rows] = await db.query<BotGroupShareRow[]>(
    `
      SELECT
        bgs.*,
        u.name AS shared_user_name,
        u.email AS shared_user_email
      FROM bot_group_shares bgs
      INNER JOIN users u ON u.id = bgs.shared_user_id
      WHERE bgs.group_id = ? AND bgs.owner_user_id = ?
      ORDER BY u.name ASC, u.email ASC
    `,
    [groupId, ownerUserId],
  );

  return Array.isArray(rows) ? rows.map(mapShareRow) : [];
};

export const updateGroupSharesForOwner = async (
  ownerUserId: number,
  groupId: number,
  emails: string[],
): Promise<{ shares: BotGroupShare[]; notFound: string[]; skipped: string[] }> => {
  await ensureBotGroupShareTable();
  const group = await getGroupByIdForUser(ownerUserId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  const normalizedEmails = Array.from(
    new Set(
      emails
        .map((email) => String(email || "").trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),
  );

  const sharedUserIds: number[] = [];
  const notFound: string[] = [];
  const skipped: string[] = [];
  for (const email of normalizedEmails) {
    const targetUser = await getUserBasicByEmail(email);
    if (!targetUser) {
      notFound.push(email);
      continue;
    }
    if (targetUser.id === ownerUserId) {
      skipped.push(email);
      continue;
    }
    sharedUserIds.push(targetUser.id);
  }

  const uniqueUserIds = Array.from(new Set(sharedUserIds));
  const db = getDb();
  if (uniqueUserIds.length > 0) {
    await Promise.all(
      uniqueUserIds.map((sharedUserId) =>
        db.query(
          `
            INSERT INTO bot_group_shares
              (group_id, owner_user_id, shared_user_id, granted_by_user_id, role)
            VALUES (?, ?, ?, ?, 'admin')
            ON DUPLICATE KEY UPDATE
              owner_user_id = VALUES(owner_user_id),
              granted_by_user_id = VALUES(granted_by_user_id),
              role = 'admin',
              updated_at = NOW()
          `,
          [group.id, ownerUserId, sharedUserId, ownerUserId],
        ),
      ),
    );
  }

  await db.query(
    `
      DELETE FROM bot_group_shares
      WHERE group_id = ?
        AND owner_user_id = ?
        ${uniqueUserIds.length > 0 ? "AND shared_user_id NOT IN (?)" : ""}
    `,
    uniqueUserIds.length > 0
      ? [group.id, ownerUserId, uniqueUserIds]
      : [group.id, ownerUserId],
  );

  const shares = await listGroupSharesForOwner(ownerUserId, group.id);
  return { shares, notFound, skipped };
};

export const getGroupAccessForUser = async (
  userId: number,
  groupId: number,
): Promise<BotGroupAccess | null> => {
  await ensureBotGroupShareTable();
  const normalizedUserId = Number(userId);
  const normalizedGroupId = Number(groupId);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return null;
  if (!Number.isFinite(normalizedGroupId) || normalizedGroupId <= 0) return null;

  const db = getDb();
  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.id = ?
      LIMIT 1
    `,
    [normalizedGroupId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const group = mapRowToGroup(rows[0]);
  if (group.userId === normalizedUserId) {
    return {
      group: { ...group, accessRole: "owner" },
      ownerUserId: group.userId,
      isOwner: true,
      isShared: false,
      canManageShares: true,
    };
  }

  if (await userHasAdminAccess(normalizedUserId)) {
    return {
      group: { ...group, accessRole: "owner" },
      ownerUserId: group.userId,
      isOwner: true,
      isShared: false,
      canManageShares: true,
    };
  }

  const internalManager = await import("./internal-groups")
    .then(({ getInternalGroupManagerByBotGroupId }) =>
      getInternalGroupManagerByBotGroupId(group.id, normalizedUserId),
    )
    .catch(() => null);
  if (internalManager) {
    return {
      group: {
        ...group,
        accessRole:
          internalManager.role === "owner" ? "owner" : "shared_admin",
      },
      ownerUserId: internalManager.ownerUserId,
      isOwner: internalManager.role === "owner",
      isShared: internalManager.role === "admin",
      canManageShares: internalManager.role === "owner",
    };
  }

  const [shareRows] = await db.query<RowDataPacket[]>(
    `
      SELECT id
      FROM bot_group_shares
      WHERE group_id = ? AND shared_user_id = ?
      LIMIT 1
    `,
    [group.id, normalizedUserId],
  );
  if (!Array.isArray(shareRows) || shareRows.length === 0) {
    return null;
  }

  return {
    group: { ...group, accessRole: "shared_admin" },
    ownerUserId: group.userId,
    isOwner: false,
    isShared: true,
    canManageShares: false,
  };
};

export const listSharedGroupsForUser = async (
  userId: number,
  options: ListGroupsForUserOptions = {},
): Promise<BotGroup[]> => {
  await ensureBotGroupShareTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_group_shares bgs
      INNER JOIN bot_groups bg ON bg.id = bgs.group_id
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bgs.shared_user_id = ?
      ORDER BY bg.name ASC, bg.id ASC
    `,
    [userId],
  );
  return Array.isArray(rows)
    ? rows.map((row) => ({ ...mapRowToGroup(row, options), accessRole: "shared_admin" as const }))
    : [];
};

export const listDiscoverableGroupsForInstance = async (
  userId: number,
  instanceId: number,
): Promise<DiscoverableGroup[]> => {
  const normalizedInstanceId = Number(instanceId);
  if (!Number.isFinite(normalizedInstanceId) || normalizedInstanceId <= 0) {
    throw new BotGroupError("Instância inválida.", 404);
  }

  const instance = await getInstanceForUser(userId, normalizedInstanceId);
  if (!instance) {
    throw new BotGroupError("Instância não encontrada.", 404);
  }

  const status = await refreshInstanceStatus(userId, instance.id);
  if (status !== "conectado") {
    throw new BotGroupError("Conecte a instância antes de buscar grupos.");
  }

  if (!instance.serverBaseUrl) {
    throw new BotGroupError("Servidor da instância não configurado.", 500);
  }

  await connectSession(instance.serverBaseUrl, instance.token);

  const payload = await requestInstanceJson<unknown>(
    instance.serverBaseUrl,
    instance.token,
    "/group/list",
    { method: "GET" },
  );
  const discovered = extractGroupListPayload(payload);

  await ensureBotGroupTable();
  const db = getDb();
  const isAdmin = await userHasAdminAccess(userId);
  const [existingRows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        bg.id,
        bg.remote_id
      FROM bot_groups bg
      LEFT JOIN bot_instances linked_instance ON linked_instance.id = bg.instance_id
      WHERE bg.instance_id = ?
        OR (
          bg.status = 'active'
          AND (
            bg.user_id = ?
            OR (
              linked_instance.phone IS NOT NULL
              AND linked_instance.phone <> ''
              AND linked_instance.phone = ?
            )
            ${isAdmin ? "OR 1 = 1" : ""}
          )
        )
    `,
    [instance.id, userId, instance.phone ?? ""],
  );

  const linkedByRemote = new Map<string, number>();
  for (const row of existingRows) {
    const remote = typeof row.remote_id === "string" ? row.remote_id.trim().toLowerCase() : "";
    if (remote) {
      linkedByRemote.set(remote, Number(row.id));
    }
  }

  const seen = new Set<string>();
  const groups: DiscoverableGroup[] = [];
  const instanceDigits = normalizeIdentityDigits(instance.phone);
  for (const item of discovered) {
    const normalized = normalizeGroupData(item);
    if (!normalized.id) continue;
    const remoteId = normalizeGroupJid(normalized.id) ?? normalized.id.trim();
    if (!remoteId) continue;
    const key = remoteId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const announceOnly = normalized.announce === true;
    const ownerDigits = normalizeIdentityDigits(normalized.owner);
    const participants = Array.isArray(normalized.participants) ? normalized.participants : [];
    const hasParticipantContext = ownerDigits.length > 0 || participants.length > 0;
    const instanceIsAdmin = announceOnly
      ? !instanceDigits
        ? !hasParticipantContext
        : hasMatchingIdentityDigits(instanceDigits, ownerDigits) ||
          participants.some((participant) => {
            if (participant.admin === "member") {
              return false;
            }
            return hasMatchingIdentityDigits(instanceDigits, normalizeIdentityDigits(participant.id));
          })
      : true;
    const mentionable = announceOnly ? (hasParticipantContext ? instanceIsAdmin : true) : true;

    groups.push({
      remoteId,
      name: normalized.subject || remoteId,
      description: normalized.description ?? null,
      imageUrl: normalized.pictureUrl ?? null,
      owner: normalized.owner ?? null,
      participantsCount: normalized.participants?.length ?? 0,
      linkedGroupId: linkedByRemote.get(key) ?? null,
      inviteLink: parseInviteLinkFromPayload(item),
      announceOnly,
      instanceIsAdmin,
      mentionable,
      isCommunity: normalized.isParent === true,
      linkedParentJid: normalized.linkedParentJid ?? null,
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
};

export const createGroupForUser = async (
  userId: number,
  payload: BotGroupPayload,
): Promise<BotGroup> => {
  const instanceId = Number(payload.instanceId);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    throw new BotGroupError("Instância inválida.", 404);
  }

  const inviteNormalized = normalizeInviteInput(payload.invite ?? payload.remoteId ?? "");
  const groupStatus = await resolveInitialGroupStatusForUser(userId);

  const instance = await getInstanceForUser(userId, instanceId);
  if (!instance) {
    throw new BotGroupError("Instância não encontrada.", 404);
  }

  const status = await refreshInstanceStatus(userId, instance.id);
  if (status !== "conectado") {
    throw new BotGroupError("Conecte a instância antes de vincular um grupo.");
  }

  const { data, awaitingApproval, raw } = await resolveGroupFromInvite(
    instance,
    inviteNormalized.inviteCode,
  );

  const remoteId = data.id ?? inviteNormalized.inviteCode;
  const existingRow = await findGroupRowForInstanceByRemoteId(instance.id, remoteId);
  if (existingRow) {
    if (existingRow.user_id === userId) {
      const existingGroup = await getGroupByIdForUser(userId, existingRow.id);
      if (existingGroup) {
        return existingGroup;
      }
    }
    throw new BotGroupError("Este grupo já está cadastrado neste bot.", 409, {
      groupId: existingRow.id,
      userId: existingRow.user_id,
      remoteId: existingRow.remote_id,
    });
  }
  const slot = groupStatus === "active" ? await computeNextSlot(userId) : 0;

  await ensureBotGroupTable();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_groups (
        user_id,
        instance_id,
        slot,
        remote_id,
        invite_code,
        invite_link,
        name,
        description,
        image_url,
        owner,
      awaiting_approval,
      awaiting_entry,
      status,
      participants,
      metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      instance.id,
      slot,
      remoteId,
      inviteNormalized.inviteCode,
      inviteNormalized.inviteLink,
      data.subject || "Grupo sem nome",
      data.description ?? null,
      data.pictureUrl ?? null,
      data.owner ?? null,
      awaitingApproval ? 1 : 0,
      awaitingApproval ? 1 : 0,
      groupStatus,
      JSON.stringify(data.participants ?? []),
      JSON.stringify({
        invite: raw.invite ?? null,
        group: raw.info ?? null,
        announce: data.announce ?? null,
        locked: data.locked ?? null,
        ephemeral: data.ephemeral ?? null,
      }),
    ],
  );

  const insertedId = result.insertId;
  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      INNER JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.id = ?
      LIMIT 1
    `,
    [insertedId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BotGroupError("Não foi possível carregar o grupo recém-criado.", 500);
  }

  await getGroupSettings(insertedId);

  if (groupStatus === "active") {
    await normalizeActiveGroupSlotsForUser(userId);
  }

  const updated = await getGroupByIdForUser(userId, insertedId);
  return updated ?? mapRowToGroup(rows[0]);
};

export const createGroupForUserFromRemoteId = async (
  userId: number,
  payload: { instanceId: number; remoteId: string },
): Promise<BotGroup> => {
  const instanceId = Number(payload.instanceId);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    throw new BotGroupError("Instância inválida.", 404);
  }

  const remoteId = normalizeRemoteGroupInput(payload.remoteId);
  const groupStatus = await resolveInitialGroupStatusForUser(userId);

  const instance = await getInstanceForUser(userId, instanceId);
  if (!instance) {
    throw new BotGroupError("Instância não encontrada.", 404);
  }

  const status = await refreshInstanceStatus(userId, instance.id);
  if (status !== "conectado") {
    throw new BotGroupError("Conecte a instância antes de vincular um grupo.");
  }

  const existingRow = await findGroupRowForInstanceByRemoteId(instance.id, remoteId);
  if (existingRow) {
    if (existingRow.user_id === userId) {
      const existingGroup = await getGroupByIdForUser(userId, existingRow.id);
      if (existingGroup) {
        return existingGroup;
      }
    }
    throw new BotGroupError("Este grupo já está cadastrado neste bot.", 409, {
      groupId: existingRow.id,
      userId: existingRow.user_id,
      remoteId: existingRow.remote_id,
    });
  }

  if (!instance.serverBaseUrl) {
    throw new BotGroupError("Servidor da instância não configurado.", 500);
  }
  await connectSession(instance.serverBaseUrl, instance.token);

  let groupInfo: unknown = null;
  try {
    groupInfo = await requestInstanceJson(
      instance.serverBaseUrl,
      instance.token,
      `/group/info?groupJID=${encodeURIComponent(remoteId)}`,
      { method: "GET" },
    );
  } catch (error) {
    handleWuzapiError(error, "Não foi possível obter dados do grupo.");
  }

  const normalized = mergeGroupData({ id: remoteId }, normalizeGroupData(groupInfo));
  if (!normalized.id) {
    throw new BotGroupError("Não foi possível identificar o grupo selecionado.");
  }

  let inviteLink: string | null = null;
  let inviteCode: string | null = null;
  try {
    const invitePayload = await requestInstanceJson<unknown>(
      instance.serverBaseUrl,
      instance.token,
      `/group/invitelink?groupJID=${encodeURIComponent(remoteId)}`,
      { method: "GET" },
    );
    inviteLink = parseInviteLinkFromPayload(invitePayload);
    if (inviteLink) {
      inviteCode = normalizeInviteInput(inviteLink).inviteCode;
    }
  } catch {
    inviteLink = null;
    inviteCode = null;
  }

  const slot = groupStatus === "active" ? await computeNextSlot(userId) : 0;
  await ensureBotGroupTable();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_groups (
        user_id,
        instance_id,
        slot,
        remote_id,
        invite_code,
        invite_link,
        name,
        description,
        image_url,
        owner,
      awaiting_approval,
      awaiting_entry,
      status,
      participants,
      metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      instance.id,
      slot,
      normalized.id,
      inviteCode,
      inviteLink,
      normalized.subject || "Grupo sem nome",
      normalized.description ?? null,
      normalized.pictureUrl ?? null,
      normalized.owner ?? null,
      0,
      0,
      groupStatus,
      JSON.stringify(normalized.participants ?? []),
      JSON.stringify({
        group: groupInfo ?? null,
        announce: normalized.announce ?? null,
        locked: normalized.locked ?? null,
        ephemeral: normalized.ephemeral ?? null,
      }),
    ],
  );

  const insertedId = result.insertId;
  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      INNER JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.id = ?
      LIMIT 1
    `,
    [insertedId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BotGroupError("Não foi possível carregar o grupo recém-criado.", 500);
  }

  await getGroupSettings(insertedId);
  if (groupStatus === "active") {
    await normalizeActiveGroupSlotsForUser(userId);
  }

  const updated = await getGroupByIdForUser(userId, insertedId);
  return updated ?? mapRowToGroup(rows[0]);
};

export const linkGroupToInstanceForUser = async (
  userId: number,
  groupId: number,
  instanceId: number,
): Promise<BotGroup> => {
  await ensureBotGroupTable();
  const db = getDb();
  const normalizedGroupId = Number(groupId);
  const normalizedInstanceId = Number(instanceId);

  if (!Number.isFinite(normalizedGroupId) || normalizedGroupId <= 0) {
    throw new BotGroupError("Grupo inválido.", 404);
  }
  if (!Number.isFinite(normalizedInstanceId) || normalizedInstanceId <= 0) {
    throw new BotGroupError("Instância inválida.", 404);
  }

  const [rows] = await db.query<(RowDataPacket & { instance_id?: number | null; linked_instance_id?: number | null })[]>(
    `
      SELECT bg.instance_id, bi.id AS linked_instance_id
      FROM bot_groups bg
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.id = ? AND bg.user_id = ?
      LIMIT 1
    `,
    [normalizedGroupId, userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  const currentInstanceId = Number(rows[0].instance_id ?? 0);
  const linkedInstanceId = Number(rows[0].linked_instance_id ?? 0);
  const hasLinkedInstance = Number.isFinite(linkedInstanceId) && linkedInstanceId > 0;

  if (hasLinkedInstance && currentInstanceId > 0 && currentInstanceId !== normalizedInstanceId) {
    throw new BotGroupError("Este grupo já está vinculado a uma conexão.");
  }

  const instance = await getInstanceForUser(userId, normalizedInstanceId);
  if (!instance) {
    throw new BotGroupError("Instância não encontrada.", 404);
  }

  const status = await refreshInstanceStatus(userId, instance.id);
  if (status !== "conectado") {
    throw new BotGroupError("Conecte a instância antes de vincular o grupo.");
  }

  await db.query(
    `UPDATE bot_groups SET instance_id = ?, updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [instance.id, normalizedGroupId, userId],
  );

  const updated = await getGroupByIdForUser(userId, normalizedGroupId);
  if (!updated) {
    throw new BotGroupError("Não foi possível carregar o grupo após o vínculo.", 500);
  }

  return updated;
};

export const updateGroupActivationForUser = async (
  userId: number,
  groupId: number,
  active: boolean,
  preferredSlot?: number | null,
): Promise<BotGroup> => {
  let group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  const nextStatus = active ? "active" : "disabled";
  await ensureBotGroupTable();
  const db = getDb();
  const requestedSlot = active && preferredSlot !== null && preferredSlot !== undefined
    ? Math.floor(Number(preferredSlot))
    : null;
  if (active && requestedSlot !== null && (!Number.isFinite(requestedSlot) || requestedSlot <= 0)) {
    throw new BotGroupError("Slot de grupo inválido.");
  }

  const ensureNoOtherActiveBotForGroup = async () => {
    const [rows] = await db.query<(RowDataPacket & {
      id: number;
      instance_id: number | null;
      instance_name: string | null;
    })[]>(
      `
        SELECT bg.id, bg.instance_id, bi.name AS instance_name
        FROM bot_groups bg
        LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
        WHERE bg.remote_id = ?
          AND bg.status = 'active'
          AND bg.id <> ?
        ORDER BY bg.updated_at DESC, bg.id DESC
        LIMIT 1
      `,
      [group.remoteId, groupId],
    );
    const conflict = Array.isArray(rows) ? rows[0] : null;
    if (!conflict) return;
    const botName = typeof conflict.instance_name === "string" && conflict.instance_name.trim()
      ? ` (${conflict.instance_name.trim()})`
      : "";
    throw new BotGroupError(
      `Este grupo ainda está ativo em outro bot${botName}. Pause o gerenciamento no outro bot antes de ativar este.`,
      409,
      {
        code: "GROUP_ACTIVE_ON_ANOTHER_BOT",
        groupId: conflict.id,
        instanceId: conflict.instance_id,
        remoteId: group.remoteId,
      },
    );
  };

  if (active) {
    await ensureNoOtherActiveBotForGroup();
  }

  const ensureRequestedSlotIsFree = async (slot: number) => {
    const [rows] = await db.query<(RowDataPacket & { metadata: string | null; status: string })[]>(
      `
        SELECT id, metadata, status
        FROM bot_groups
        WHERE user_id = ?
          AND slot = ?
          AND id <> ?
      `,
      [userId, slot, groupId],
    );
    const occupied = Array.isArray(rows) && rows.some((row) => {
      const metadata = toRecord(parseJson(row.metadata));
      return metadataHasActiveLicense(metadata);
    });
    if (occupied) {
      throw new BotGroupError("Este slot já está ocupado por outro grupo.", 409);
    }
  };

	  if (group.status === nextStatus) {
	    const storedSlot = Math.floor(Number(group.slot ?? 0));
	    if (active && requestedSlot !== null && requestedSlot !== storedSlot) {
	      await assertGroupHasActiveLicenseForUser(userId, group);
	      await ensureRequestedSlotIsFree(requestedSlot);
	      await db.query(
	        "UPDATE bot_groups SET slot = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
        [requestedSlot, groupId, userId],
      );
      await normalizeActiveGroupSlotsForUser(userId);
      const updated = await getGroupByIdForUser(userId, groupId);
      return updated ?? { ...group, slot: requestedSlot };
    }
    if (!active && Number.isFinite(storedSlot) && storedSlot > 0 && !isGroupLicenseActive(group)) {
      await db.query(
        "UPDATE bot_groups SET slot = 0, updated_at = NOW() WHERE id = ? AND user_id = ?",
        [groupId, userId],
      );
      await normalizeActiveGroupSlotsForUser(userId);
      const updated = await getGroupByIdForUser(userId, groupId);
      return updated ?? { ...group, slot: 0 };
	    }
	    if (active && (!Number.isFinite(storedSlot) || storedSlot <= 0)) {
	      await assertGroupHasActiveLicenseForUser(userId, group);
	      const repairedSlot = await computeNextActiveSlot(userId, groupId);
	      await db.query(
	        "UPDATE bot_groups SET slot = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
        [repairedSlot, groupId, userId],
      );
      await normalizeActiveGroupSlotsForUser(userId);
      const updated = await getGroupByIdForUser(userId, groupId);
      return updated ?? { ...group, slot: repairedSlot };
    }
    return group;
  }

  const currentStoredSlot = Math.floor(Number(group.slot ?? 0));
  const nextSlot = active
    ? requestedSlot ?? (Number.isFinite(currentStoredSlot) && currentStoredSlot > 0
      ? currentStoredSlot
      : await computeNextActiveSlot(userId, groupId))
    : isGroupLicenseActive(group)
      ? (Number.isFinite(currentStoredSlot) && currentStoredSlot > 0
        ? currentStoredSlot
        : await computeNextActiveSlot(userId, groupId))
      : 0;
	
	  if (active) {
	    await assertGroupHasActiveLicenseForUser(userId, group);
	    if (nextSlot) {
	      await ensureRequestedSlotIsFree(nextSlot);
	    }
  }

  const [rows] = await db.query<(BotGroupRow & RowDataPacket)[]>(
    "SELECT metadata FROM bot_groups WHERE id = ? AND user_id = ? LIMIT 1",
    [groupId, userId],
  );

	  const metadataRaw = Array.isArray(rows) && rows.length > 0 ? rows[0].metadata : null;
	  const metadata = toRecord(parseJson(metadataRaw));
	  const nowIso = new Date().toISOString();
  const hadTrackedLicense = metadataLicenseExpiryMillis(metadata) !== null;
  const shouldPreserveLegacyResume =
    !active &&
    group.status === "active" &&
    !isGroupLicenseActive(group) &&
    !hadTrackedLicense;

	  if (active) {
	    delete metadata.syncBlockedReason;
	    delete metadata.syncBlockedAt;
	    delete metadata.syncBlockedMessage;
    delete metadata.botPausedPreserveAccess;
    delete metadata.botPausedPreserveAccessAt;
    delete metadata.botPausedPreserveAccessReason;
    metadata.botPausedResumeClearedAt = nowIso;
	    metadata.syncBlockClearedAt = nowIso;
	    if (typeof metadata.activatedAt !== "string" || !metadata.activatedAt.trim()) {
	      metadata.activatedAt = nowIso;
	    }
	    metadata.lastActivatedAt = nowIso;
	  } else {
	    metadata.lastDeactivatedAt = nowIso;
    if (shouldPreserveLegacyResume) {
      metadata.botPausedPreserveAccess = true;
      metadata.botPausedPreserveAccessAt = nowIso;
      metadata.botPausedPreserveAccessReason = "legacy_active_without_tracked_license";
    }
	  }

  await db.query(
    `UPDATE bot_groups SET status = ?, slot = ?, metadata = ?, updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [nextStatus, nextSlot, JSON.stringify(metadata), groupId, userId],
  );
  await normalizeActiveGroupSlotsForUser(userId);

  const updated = await getGroupByIdForUser(userId, groupId);
  if (!updated) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return updated;
};

export const updateGroupDetailsForUser = async (
  userId: number,
  groupId: number,
  updates: { name?: string; description?: string | null },
): Promise<BotGroup> => {
  const row = await fetchGroupContextRow(userId, groupId);
  assertGroupAdminPermission(row);
  const client = wuzapiClientFromRow(row);
  const db = getDb();

  let changed = false;

  if (updates.name !== undefined) {
    const name = normalizeGroupName(updates.name);
    try {
      await setGroupName(client, { groupJid: row.remote_id, name });
    } catch (error) {
      handleWuzapiError(error, "Não foi possível atualizar o nome do grupo.");
    }

    await db.query(
      `UPDATE bot_groups SET name = ?, updated_at = NOW() WHERE id = ?`,
      [name, row.id],
    );
    changed = true;
  }

  if (updates.description !== undefined) {
    const description = normalizeGroupDescription(updates.description);
    try {
      await setGroupTopic(client, { groupJid: row.remote_id, topic: description ?? "" });
    } catch (error) {
      handleWuzapiError(error, "Não foi possível atualizar a descrição do grupo.");
    }

    await db.query(
      `UPDATE bot_groups SET description = ?, updated_at = NOW() WHERE id = ?`,
      [description, row.id],
    );
    changed = true;
  }

  if (!changed) {
    throw new BotGroupError("Nenhuma alteração informada.", 400);
  }

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após a atualização.", 404);
  }
  return group;
};

export const updateGroupInviteForUser = async (
  userId: number,
  groupId: number,
  invite: string,
): Promise<BotGroup> => {
  const row = await fetchGroupContextRow(userId, groupId);
  const instance = await getInstanceForUser(userId, row.instance_id);
  if (!instance) {
    throw new BotGroupError("Instância não encontrada.", 404);
  }

  const normalizedInvite = normalizeInviteInput(invite);

  let resolved: Awaited<ReturnType<typeof resolveGroupFromInvite>> | null = null;
  try {
    resolved = await resolveGroupFromInvite(
      instance,
      normalizedInvite.inviteCode,
    );
  } catch (error) {
    handleWuzapiError(error, "Não foi possível atualizar o link do grupo.");
  }
  if (!resolved) {
    throw new BotGroupError("Não foi possível atualizar o link do grupo.", 500);
  }

  const metadata = readMetadataRecord(row);
  metadata.invite = resolved.raw.invite ?? metadata.invite ?? null;
  metadata.group = resolved.raw.info ?? metadata.group ?? null;
  if (resolved.data.announce !== null && resolved.data.announce !== undefined) {
    const announce = parseMetadataBoolean(resolved.data.announce);
    if (announce !== null) {
      metadata.announce = announce;
      metadata.adminsOnly = announce;
      metadata.onlyAdmins = announce;
    }
  }
  if (resolved.data.locked !== null && resolved.data.locked !== undefined) {
    const locked = parseMetadataBoolean(resolved.data.locked);
    if (locked !== null) {
      metadata.locked = locked;
    }
  }
  if (resolved.data.ephemeral !== undefined && resolved.data.ephemeral !== null) {
    metadata.ephemeral = parseMetadataString(resolved.data.ephemeral);
  }

  const db = getDb();
  await db.query(
    `
      UPDATE bot_groups
      SET
        remote_id = ?,
        invite_code = ?,
        invite_link = ?,
        name = ?,
        description = ?,
        image_url = ?,
        owner = ?,
        awaiting_approval = ?,
        awaiting_entry = ?,
        participants = ?,
        metadata = ?,
        updated_at = NOW()
      WHERE id = ?
    `,
    [
      resolved.data.id ?? normalizedInvite.inviteCode,
      normalizedInvite.inviteCode,
      normalizedInvite.inviteLink,
      resolved.data.subject || row.name,
      resolved.data.description ?? null,
      resolved.data.pictureUrl ?? null,
      resolved.data.owner ?? null,
      resolved.awaitingApproval ? 1 : 0,
      resolved.awaitingApproval ? 1 : 0,
      JSON.stringify(resolved.data.participants ?? []),
      JSON.stringify(metadata),
      row.id,
    ],
  );

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return group;
};

export const updateGroupAdminsOnlyForUser = async (
  userId: number,
  groupId: number,
  onlyAdmins: boolean,
): Promise<BotGroup> => {
  const row = await fetchGroupContextRow(userId, groupId);
  assertGroupAdminPermission(row);
  const client = wuzapiClientFromRow(row);

  try {
    await setMessagesAdminsOnly(client, { groupJid: row.remote_id, onlyAdmins });
  } catch (error) {
    handleWuzapiError(error, "Não foi possível atualizar a configuração de administradores.");
  }

  const metadata = readMetadataRecord(row);
  metadata.announce = onlyAdmins;
  metadata.adminsOnly = onlyAdmins;
  metadata.onlyAdmins = onlyAdmins;
  await persistGroupMetadata(row.id, metadata);

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return group;
};

export const updateGroupLockedForUser = async (
  userId: number,
  groupId: number,
  locked: boolean,
): Promise<BotGroup> => {
  const row = await fetchGroupContextRow(userId, groupId);
  assertGroupAdminPermission(row);
  const client = wuzapiClientFromRow(row);

  try {
    await setGroupLocked(client, { groupJid: row.remote_id, locked });
  } catch (error) {
    handleWuzapiError(error, "Não foi possível atualizar o bloqueio do grupo.");
  }

  const metadata = readMetadataRecord(row);
  metadata.locked = locked;
  await persistGroupMetadata(row.id, metadata);

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return group;
};

export const updateGroupEphemeralForUser = async (
  userId: number,
  groupId: number,
  duration: string,
): Promise<BotGroup> => {
  const row = await fetchGroupContextRow(userId, groupId);
  assertGroupAdminPermission(row);
  const client = wuzapiClientFromRow(row);
  const normalized = normalizeEphemeral(duration);

  try {
    await setGroupEphemeral(client, { groupJid: row.remote_id, duration: normalized });
  } catch (error) {
    handleWuzapiError(error, "Não foi possível atualizar a duração das mensagens.");
  }

  const metadata = readMetadataRecord(row);
  metadata.ephemeral = normalized;
  await persistGroupMetadata(row.id, metadata);

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return group;
};

export const updateGroupPhotoForUser = async (
  userId: number,
  groupId: number,
  file: File,
): Promise<BotGroup> => {
  if (!(file instanceof File) || file.size === 0) {
    throw new BotGroupError("Selecione uma imagem válida.");
  }

  const row = await fetchGroupContextRow(userId, groupId);
  assertGroupAdminPermission(row);
  const client = wuzapiClientFromRow(row);

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  try {
    await setGroupPhoto(client, {
      groupJid: row.remote_id,
      media: buffer,
      mimeType,
    });
  } catch (error) {
    handleWuzapiError(error, "Não foi possível atualizar a foto do grupo.");
  }

  await syncGroupInfo(userId, groupId);

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  try {
    const webhook = await getWebhookRowForUser(userId);
    if (webhook) {
      await recordWebhookEvent(webhook.id, userId, "group.picture", {
        action: "updated",
        groupId,
        remoteId: row.remote_id,
        imageUrl: group.imageUrl,
      });
    }
  } catch {
    /* ignore webhook event failures */
  }
  return group;
};

export const removeGroupPhotoForUser = async (
  userId: number,
  groupId: number,
): Promise<BotGroup> => {
  const row = await fetchGroupContextRow(userId, groupId);
  assertGroupAdminPermission(row);
  const client = wuzapiClientFromRow(row);

  try {
    await removeGroupPhoto(client, { groupJid: row.remote_id });
  } catch (error) {
    handleWuzapiError(error, "Não foi possível remover a foto do grupo.");
  }

  await syncGroupInfo(userId, groupId);

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  try {
    const webhook = await getWebhookRowForUser(userId);
    if (webhook) {
      await recordWebhookEvent(webhook.id, userId, "group.picture", {
        action: "removed",
        groupId,
        remoteId: row.remote_id,
      });
    }
  } catch {
    /* ignore webhook event failures */
  }
  return group;
};

export const updateGroupMenuBackgroundForUser = async (
  userId: number,
  groupId: number,
  file: File,
): Promise<BotGroup> => {
  if (!(file instanceof File) || file.size === 0) {
    throw new BotGroupError("Selecione uma imagem para o fundo do menu.");
  }

  const row = await fetchGroupContextRow(userId, groupId);
  const metadata = readMetadataRecord(row);
  const previousPath = parseMetadataString(metadata.menuBackgroundPath ?? metadata.menu_background_path);

  const storedPath = await saveUploadedFile(file, `bot-groups/${row.id}`, {
    fixedFileName: "menu-background",
    convertToWebp: true,
  });

  metadata.menuBackgroundPath = storedPath;
  metadata.menu_background_path = storedPath;
  await persistGroupMetadata(row.id, metadata);

  if (previousPath && previousPath !== storedPath) {
    await deleteUploadedFile(previousPath).catch(() => {});
  }

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return group;
};

export const removeGroupMenuBackgroundForUser = async (
  userId: number,
  groupId: number,
): Promise<BotGroup> => {
  const row = await fetchGroupContextRow(userId, groupId);
  const metadata = readMetadataRecord(row);
  const currentPath = parseMetadataString(
    metadata.menuBackgroundPath ?? metadata.menu_background_path ?? metadata.menu_background,
  );

  metadata.menuBackgroundPath = null;
  metadata.menu_background_path = null;
  metadata.menu_background = null;
  await persistGroupMetadata(row.id, metadata);

  if (currentPath) {
    await deleteUploadedFile(currentPath).catch(() => {});
  }

  const group = await getGroupByIdForUser(userId, groupId);
  if (!group) {
    throw new BotGroupError("Grupo não encontrado após atualização.", 404);
  }
  return group;
};

export const deleteGroupForUser = async (userId: number, groupId: number): Promise<void> => {
  const id = Number(groupId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new BotGroupError("Grupo inválido.", 404);
  }

  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id FROM bot_groups WHERE id = ? AND user_id = ? LIMIT 1",
    [id, userId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  await db.query("DELETE FROM bot_groups WHERE id = ?", [id]);
};

export const getGroupForInstanceByRemoteId = async (
  instanceId: number,
  remoteId: string,
): Promise<BotGroup | null> => {
  await ensureBotGroupTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      INNER JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.instance_id = ? AND bg.remote_id = ?
      LIMIT 1
    `,
    [instanceId, remoteId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapRowToGroup(rows[0]);
};

export const getGroupForInstanceOrPhoneByRemoteId = async (
  instanceId: number,
  remoteId: string,
): Promise<BotGroup | null> => {
  await ensureBotGroupTable();
  await ensureBotInstanceTable();
  const db = getDb();
  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      INNER JOIN bot_instances bi ON bi.id = bg.instance_id
      INNER JOIN bot_instances current_instance ON current_instance.id = ?
      WHERE bg.remote_id = ?
        AND (
          bg.instance_id = ?
          OR (
            current_instance.phone IS NOT NULL
            AND current_instance.phone <> ''
            AND bi.phone = current_instance.phone
          )
          OR (
            bg.user_id = current_instance.user_id
            AND bg.status = 'active'
          )
        )
      ORDER BY
        CASE
          WHEN bg.instance_id = ? THEN 0
          WHEN bg.status = 'active' AND bi.session_status = 'conectado' THEN 1
          WHEN bg.user_id = current_instance.user_id
            AND bg.status = 'active'
            AND bi.session_status = 'conectado' THEN 2
          WHEN bg.status = 'active' THEN 3
          ELSE 4
        END ASC,
        CASE WHEN bi.purpose = 'profile' THEN 0 ELSE 1 END ASC,
        bg.updated_at DESC,
        bg.id DESC
      LIMIT 1
    `,
    [instanceId, remoteId, instanceId, instanceId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return mapRowToGroup(rows[0]);
};

export const getGroupByIdForUser = async (
  userId: number,
  groupId: number,
): Promise<BotGroup | null> => {
  const access = await getGroupAccessForUser(userId, groupId);
  return access?.group ?? null;
};

export const transferGroupToUser = async ({
  groupId,
  targetUserId,
  targetInstanceId,
}: {
  groupId: number;
  targetUserId: number;
  targetInstanceId?: number | null;
}): Promise<BotGroup> => {
  const normalizedGroupId = Number(groupId);
  const normalizedUserId = Number(targetUserId);

  if (!Number.isFinite(normalizedGroupId) || normalizedGroupId <= 0) {
    throw new BotGroupError("Grupo inválido.", 404);
  }

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new BotGroupError("Usuário alvo inválido.", 400);
  }

  await ensureBotGroupTable();
  await ensureBotInstanceTable();
  const db = getDb();

  const [rows] = await db.query<(BotGroupWithInstanceRow & RowDataPacket)[]>(
    `
      SELECT
        bg.*,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.id = ?
      LIMIT 1
    `,
    [normalizedGroupId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BotGroupError("Grupo não encontrado.", 404);
  }

  const current = rows[0];
  const originalOwnerId = current.user_id;
  const currentInstanceId = current.instance_id;

  const explicitInstanceId = Number.isFinite(Number(targetInstanceId))
    ? Number(targetInstanceId)
    : null;

  const ownerUser = await getUserBasicById(normalizedUserId);
  if (!ownerUser) {
    throw new BotGroupError("Usuário destino não encontrado.", 404);
  }

  let resolvedInstanceId = currentInstanceId;

  if (explicitInstanceId && explicitInstanceId > 0) {
    const instance = await getInstanceForUser(normalizedUserId, explicitInstanceId);
    if (!instance) {
      throw new BotGroupError("Instância selecionada não pertence ao usuário informado.", 404);
    }
    resolvedInstanceId = instance.id;
  } else if (originalOwnerId !== normalizedUserId || !resolvedInstanceId) {
    const [instanceRows] = await db.query<RowDataPacket[]>(
      `
        SELECT id
        FROM bot_instances
        WHERE user_id = ?
        ORDER BY
          CASE WHEN session_status = 'conectado' THEN 0 ELSE 1 END,
          updated_at DESC,
          id DESC
        LIMIT 1
      `,
      [normalizedUserId],
    );

    if (!Array.isArray(instanceRows) || instanceRows.length === 0) {
      throw new BotGroupError(
        "Usuário selecionado não possui instâncias disponíveis. Cadastre ou selecione uma instância antes de transferir.",
        400,
      );
    }

    resolvedInstanceId = Number(instanceRows[0].id);
  }

  if (!Number.isFinite(resolvedInstanceId) || resolvedInstanceId <= 0) {
    throw new BotGroupError("Não foi possível determinar a instância de destino.", 500);
  }

  const isActiveGroup = current.status === "active";
  let slot = isActiveGroup ? Number(current.slot ?? 0) : 0;
  if (originalOwnerId !== normalizedUserId) {
    slot = isActiveGroup ? await computeNextSlot(normalizedUserId) : 0;
  }
  if (isActiveGroup && (!Number.isFinite(slot) || slot <= 0)) {
    slot = await computeNextSlot(normalizedUserId);
  }

  await db.query(
    `
      UPDATE bot_groups
      SET
        user_id = ?,
        instance_id = ?,
        slot = ?,
        updated_at = NOW()
      WHERE id = ?
    `,
    [normalizedUserId, resolvedInstanceId, slot, normalizedGroupId],
  );

  if (originalOwnerId !== normalizedUserId) {
    await normalizeActiveGroupSlotsForUser(originalOwnerId);
  }
  await normalizeActiveGroupSlotsForUser(normalizedUserId);

  const updated = await getGroupByIdForUser(normalizedUserId, normalizedGroupId);
  if (!updated) {
    throw new BotGroupError("Não foi possível carregar o grupo após a transferência.", 500);
  }

  return updated;
};
