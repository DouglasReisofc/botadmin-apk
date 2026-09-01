import { randomInt } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  UserRaffle,
  UserRaffleGroupTarget,
  UserRaffleStatus,
  UserRaffleSummary,
  UserRaffleTicket,
  UserRaffleTicketStatus,
  UserRaffleWinner,
  UserRaffleMetadata,
  UserRaffleAnnouncementSettings,
  UserRaffleAnnouncementButton,
  UserRaffleFinalizationSettings,
  UserRafflePurchaseMenuSettings,
} from "types/user-raffles";
export type { UserRaffleStatus } from "types/user-raffles";
import { ensureUserRafflesTable, getDb } from "lib/db";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getMercadoPagoPixConfigForUser, getPoloPagPixConfigForUser } from "lib/payments";
import { normalizeJid, stripJidDevice } from "lib/whatsapp";
import { formatCurrency } from "lib/format";
import { ARCHIVE_UPLOAD_ROOT, UPLOADS_STORAGE_ROOT, resolveUploadedFileUrl, deleteUploadedFile } from "lib/uploads";
import { sendTextMessage, sendMediaMessage, sendInteractiveButtons, type WuzapiClient } from "lib/wuzapi";

const MAX_WINNERS = 50;
const MIN_TICKETS = 1;
const MAX_TICKETS = 10_000;
const DEFAULT_RESERVATION_EXPIRATION_MINUTES = 30;
const RAFFLE_MENTION_LIMIT = Number.isFinite(Number(process.env.RAFFLE_MENTION_LIMIT))
  ? Math.max(1, Math.floor(Number(process.env.RAFFLE_MENTION_LIMIT)))
  : 64;
const DEFAULT_MENTION_ALL = true;

const DEFAULT_ANNOUNCEMENT_TEMPLATE =
  [
    "🎉 Nova rifa aberta: *{{title}}*",
    "• Valor por número: {{price}}",
    "• Total de números: {{numbersTotal}}",
    "• Ganhadores: {{winnersCount}}",
    "",
    "Quem quiser participar, faça sua fézinha e boa sorte!",
    "",
    "👉 Para garantir seus números, envie:",
    "*{{commandPrefix}}comprarrifa*",
    "e escolha a quantidade no menu.",
    "🍀 Boa sorte a todos!",
  ].join("\n");

const DEFAULT_FINAL_TEMPLATE =
  [
    "🎉 Resultado da rifa *{{title}}*",
    "{{winnerList}}",
    "",
    "Parabéns aos ganhadores e obrigado a todos que participaram!",
  ].join("\n");

const DEFAULT_PURCHASE_MENU_STORAGE: UserRafflePurchaseMenuSettings = {
  title: "Comprar números",
  description:
    "Escolha quantos números deseja reservar. O valor total aparece em cada opção.",
  buttonText: "Escolher quantidade",
  footerText: "{{title}} · {{price}} por número",
  cardTitleTemplate: "{{from}} a {{to}} números",
  rowTitleTemplate: "{{quantity}} número(s) · {{total}}",
  rowDescriptionTemplate: "{{quantity}} × {{price}}",
};

const ALLOWED_ANNOUNCEMENT_MEDIA_TYPES = new Set<"image" | "video" | "audio" | "document">([
  "image",
  "video",
  "audio",
  "document",
]);

type RaffleAnnouncementMediaStored = {
  path: string;
  mediaType: "image" | "video" | "audio" | "document";
  mimeType?: string | null;
  fileName?: string | null;
};

type RaffleAnnouncementStorage = {
  message: string;
  media: RaffleAnnouncementMediaStored | null;
  mentionAll: boolean;
  buttons: UserRaffleAnnouncementButton[];
};

type RaffleFinalizationStorage = {
  message: string;
};

type GroupDispatchContext = {
  groupId: number;
  groupName: string | null;
  groupJid: string;
  client: WuzapiClient;
  participants: string[];
};

const DEFAULT_ANNOUNCEMENT_STORAGE: RaffleAnnouncementStorage = {
  message: DEFAULT_ANNOUNCEMENT_TEMPLATE,
  media: null,
  mentionAll: DEFAULT_MENTION_ALL,
  buttons: [
    {
      id: "!comprarrifa",
      text: "Comprar rifa",
      type: "quick_reply",
      value: "!comprarrifa",
    },
  ],
};

const DEFAULT_FINALIZATION_STORAGE: RaffleFinalizationStorage = {
  message: DEFAULT_FINAL_TEMPLATE,
};

const sanitizeTemplate = (value: unknown, fallback: string): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    const str = String(value).trim();
    return str || fallback;
  }

  return fallback;
};

const normalizeUploadPath = (value: string): string | null => {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return null;
  }
  const withoutPrefix = trimmed.startsWith("uploads/")
    ? trimmed
    : trimmed.replace(/^\/+/, "").startsWith("uploads/")
      ? `uploads/${trimmed.replace(/^\/+/, "").slice("uploads/".length)}`
      : `uploads/${trimmed.replace(/^\/+/, "")}`;
  const normalized = withoutPrefix.replace(/\\/g, "/");
  if (!normalized.startsWith("uploads/") || normalized.includes("..")) {
    return null;
  }
  return normalized;
};

const sanitizeAnnouncementMediaInput = (value: unknown): RaffleAnnouncementMediaStored | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawPath = typeof record.path === "string" ? record.path : typeof record.url === "string" ? record.url : "";
  const normalizedPath = rawPath ? normalizeUploadPath(rawPath) : null;
  if (!normalizedPath) {
    return null;
  }

  const rawMediaType = typeof record.mediaType === "string" ? record.mediaType.trim().toLowerCase() : "";
  const mediaType = ALLOWED_ANNOUNCEMENT_MEDIA_TYPES.has(rawMediaType as any)
    ? (rawMediaType as RaffleAnnouncementMediaStored["mediaType"])
    : "document";

  const mimeType = typeof record.mimeType === "string" ? record.mimeType : null;
  const fileName = typeof record.fileName === "string" ? record.fileName : null;

  return {
    path: normalizedPath,
    mediaType,
    mimeType,
    fileName,
  };
};

const sanitizeAnnouncementButtons = (
  value: unknown,
  fallback: readonly UserRaffleAnnouncementButton[],
): UserRaffleAnnouncementButton[] => {
  if (!Array.isArray(value)) {
    return fallback.map((button) => ({ ...button }));
  }

  const buttons: UserRaffleAnnouncementButton[] = [];
  for (const raw of value.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const text = String(record.text ?? record.label ?? "").trim().slice(0, 40);
    const rawType = String(record.type ?? "quick_reply").trim().toLowerCase();
    const type: UserRaffleAnnouncementButton["type"] =
      rawType === "cta_url" || rawType === "cta_copy" ? rawType : "quick_reply";
    const source =
      type === "cta_url"
        ? record.url ?? record.value
        : type === "cta_copy"
          ? record.copyCode ?? record.value
          : record.command ?? record.value ?? record.id;
    const value = String(source ?? "").trim().slice(0, 1000);
    if (!text || !value) continue;
    if (type === "cta_url" && !/^https?:\/\//i.test(value)) continue;
    const id = String(record.id ?? value).trim().slice(0, 180) || value.slice(0, 180);
    buttons.push({ id, text, type, value });
  }
  return buttons;
};

const normalizeAnnouncementStorage = (
  value: unknown,
  fallback: RaffleAnnouncementStorage,
): RaffleAnnouncementStorage => {
  if (typeof value === "string") {
    return {
      ...fallback,
      message: sanitizeTemplate(value, fallback.message),
    };
  }

  if (!value || typeof value !== "object") {
    return { ...fallback };
  }

  const record = value as Record<string, unknown>;
  const message = sanitizeTemplate(record.message, fallback.message);

  let media = fallback.media;
  if (record.media === null) {
    media = null;
  } else {
    const sanitizedMedia = sanitizeAnnouncementMediaInput(record.media);
    if (sanitizedMedia) {
      media = sanitizedMedia;
    }
  }

  const mentionAll =
    record.mentionAll === false
      ? false
      : record.mentionAll === true
        ? true
        : fallback.mentionAll;

  const buttons = sanitizeAnnouncementButtons(record.buttons, fallback.buttons);

  return {
    message,
    media,
    mentionAll,
    buttons,
  };
};

const normalizeFinalizationStorage = (
  value: unknown,
  fallback: RaffleFinalizationStorage,
): RaffleFinalizationStorage => {
  if (typeof value === "string") {
    return { message: sanitizeTemplate(value, fallback.message) };
  }
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }
  const record = value as Record<string, unknown>;
  const source = record.message ?? record.template ?? value;
  return { message: sanitizeTemplate(source, fallback.message) };
};

const normalizePurchaseMenuStorage = (
  value: unknown,
  fallback: UserRafflePurchaseMenuSettings,
): UserRafflePurchaseMenuSettings => {
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }
  const record = value as Record<string, unknown>;
  return {
    title: sanitizeTemplate(record.title, fallback.title).slice(0, 60),
    description: sanitizeTemplate(
      record.description,
      fallback.description,
    ).slice(0, 500),
    buttonText: sanitizeTemplate(
      record.buttonText,
      fallback.buttonText,
    ).slice(0, 30),
    footerText: sanitizeTemplate(
      record.footerText,
      fallback.footerText,
    ).slice(0, 120),
    cardTitleTemplate: sanitizeTemplate(
      record.cardTitleTemplate,
      fallback.cardTitleTemplate,
    ).slice(0, 80),
    rowTitleTemplate: sanitizeTemplate(
      record.rowTitleTemplate,
      fallback.rowTitleTemplate,
    ).slice(0, 100),
    rowDescriptionTemplate: sanitizeTemplate(
      record.rowDescriptionTemplate,
      fallback.rowDescriptionTemplate,
    ).slice(0, 120),
  };
};

const hydrateAnnouncementSettingsFromStorage = (
  storage: RaffleAnnouncementStorage,
): UserRaffleAnnouncementSettings => ({
  message: storage.message,
  media: storage.media
    ? {
        path: storage.media.path,
        mediaType: storage.media.mediaType,
        mimeType: storage.media.mimeType ?? null,
        fileName: storage.media.fileName ?? null,
        url: resolveUploadedFileUrl(storage.media.path),
      }
    : null,
  mentionAll: storage.mentionAll,
  buttons: storage.buttons.map((button) => ({ ...button })),
});

const hydrateFinalizationSettingsFromStorage = (
  storage: RaffleFinalizationStorage,
): UserRaffleFinalizationSettings => ({
  message: storage.message,
});

const parseRaffleMetadata = (raw: unknown): UserRaffleMetadata | null => {
  const base = parseJsonColumn<Record<string, unknown> | null>(raw, null);

  const announcementStorage = normalizeAnnouncementStorage(
    base?.announcement,
    DEFAULT_ANNOUNCEMENT_STORAGE,
  );
  const finalizationStorage = normalizeFinalizationStorage(
    base?.finalization,
    DEFAULT_FINALIZATION_STORAGE,
  );
  const purchaseMenuStorage = normalizePurchaseMenuStorage(
    base?.purchaseMenu,
    DEFAULT_PURCHASE_MENU_STORAGE,
  );

  const metadata: UserRaffleMetadata = base && typeof base === "object" ? { ...base } : {};
  metadata.announcement = hydrateAnnouncementSettingsFromStorage(announcementStorage);
  metadata.finalization = hydrateFinalizationSettingsFromStorage(finalizationStorage);
  metadata.purchaseMenu = purchaseMenuStorage;

  return metadata;
};

const clampStatus = (status: unknown): UserRaffleStatus => {
  if (typeof status !== "string") {
    return "active";
  }
  const normalized = status.trim().toLowerCase();
  switch (normalized) {
    case "draft":
    case "selling":
    case "sold_out":
    case "completed":
    case "cancelled":
      return normalized as UserRaffleStatus;
    case "active":
    default:
      return "active";
  }
};

const parseJsonColumn = <T>(value: unknown, fallback: T): T => {
  if (!value) {
    return fallback;
  }
  if (typeof value === "object") {
    return value as T;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as T;
    }
  } catch {
    // ignore parsing errors
  }
  return fallback;
};

const parseStringArray = (value: unknown): string[] => {
  const unique = new Set<string>();

  const addEntry = (raw: unknown) => {
    if (typeof raw !== "string") {
      return;
    }
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    if (!trimmed) {
      return;
    }
    const digits = normalizeJid(trimmed);
    const candidate = digits || trimmed.toLowerCase();
    if (candidate) {
      unique.add(candidate);
    }
  };

  const addFromUnknown = (input: unknown) => {
    if (Array.isArray(input)) {
      input.forEach(addEntry);
      return true;
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) {
        return true;
      }
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            parsed.forEach(addEntry);
            return true;
          }
          addEntry(parsed);
          return true;
        } catch {
          // fall back to manual split below
        }
      }
      trimmed
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .forEach(addEntry);
      return true;
    }

    return false;
  };

  addFromUnknown(value);

  return Array.from(unique);
};

const ACTIVE_RAFFLE_STATUSES: readonly UserRaffleStatus[] = ["active", "selling", "sold_out"];

const buildNormalizedJidSet = (entries: readonly string[]): Set<string> => {
  const set = new Set<string>();
  entries.forEach((entry) => {
    const normalized = normalizeJid(entry);
    if (normalized) {
      set.add(normalized);
    } else {
      const lowered = entry.trim().toLowerCase();
      if (lowered) {
        set.add(lowered);
      }
    }
  });
  return set;
};

const buildTargetJidSet = (targets: readonly UserRaffleGroupTarget[]): Set<string> => {
  const set = new Set<string>();
  targets.forEach((target) => {
    if (!target?.remoteId) {
      return;
    }
    const normalized = normalizeJid(target.remoteId);
    if (normalized) {
      set.add(normalized);
    } else {
      const lowered = target.remoteId.trim().toLowerCase();
      if (lowered) {
        set.add(lowered);
      }
    }
  });
  return set;
};

const ensureRaffleGroupAvailability = async (
  userId: number,
  targets: readonly UserRaffleGroupTarget[],
  options: { excludeRaffleId?: number } = {},
) => {
  await ensureUserRafflesTable();
  const db = getDb();

  const params: Array<number> = [userId];
  let query = `
    SELECT id, title, status, group_jids
    FROM user_raffles
    WHERE user_id = ?
      AND status IN ('active','selling','sold_out')
  `;
  if (options.excludeRaffleId) {
    query += " AND id <> ?";
    params.push(options.excludeRaffleId);
  }

  const [rows] = await db.query<UserRaffleRow[]>(query, params);
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const targetSet = buildTargetJidSet(targets);
  const appliesToAllGroups = targetSet.size === 0;

  for (const row of rows) {
    if (!ACTIVE_RAFFLE_STATUSES.includes(clampStatus(row.status))) {
      continue;
    }
    const existingSet = buildNormalizedJidSet(parseStringArray(row.group_jids));
    const existingCoversAll = existingSet.size === 0;

    if (appliesToAllGroups || existingCoversAll) {
      throw new Error(
        `Já existe a rifa ativa "${row.title}" abrangendo estes grupos. Finalize ou cancele-a antes de criar outra.`,
      );
    }

    for (const jid of targetSet) {
      if (existingSet.has(jid)) {
        throw new Error(
          `O grupo selecionado já participa da rifa "${row.title}". Finalize ou cancele a rifa atual antes de iniciar outra.`,
        );
      }
    }
  }
};

const sanitizeTicket = (ticket: Partial<UserRaffleTicket>, number: number): UserRaffleTicket => ({
  number,
  status: ((ticket.status ?? "available") as UserRaffleTicketStatus) ?? "available",
  customerName: ticket.customerName ?? null,
  customerWhatsapp: ticket.customerWhatsapp ?? null,
  chargePublicId: ticket.chargePublicId ?? null,
  reservedAt: ticket.reservedAt ?? null,
  paidAt: ticket.paidAt ?? null,
  groupJid: ticket.groupJid ?? null,
});

const parseTickets = (value: unknown, total: number): UserRaffleTicket[] => {
  const entries = Array.isArray(value) ? value : parseJsonColumn<unknown[]>(value, []);
  const mapped = Array.isArray(entries)
    ? entries
        .map((entry, index) => {
          if (entry && typeof entry === "object") {
            const record = entry as Partial<UserRaffleTicket> & { number?: number };
            const number = Number.isFinite(record.number) ? Number(record.number) : index + 1;
            return sanitizeTicket(record, number);
          }
          return sanitizeTicket({}, index + 1);
        })
        .filter((ticket) => Number.isFinite(ticket.number))
    : [];

  const normalized = mapped.sort((a, b) => a.number - b.number);
  if (normalized.length >= total) {
    return normalized.slice(0, total);
  }

  const existingNumbers = new Set(normalized.map((ticket) => ticket.number));
  for (let i = 1; i <= total; i += 1) {
    if (!existingNumbers.has(i)) {
      normalized.push(
        sanitizeTicket(
          {
            status: "available",
          },
          i,
        ),
      );
    }
  }

  return normalized
    .filter((ticket, index, array) => array.findIndex((entry) => entry.number === ticket.number) === index)
    .sort((a, b) => a.number - b.number);
};

const parseGroupTargets = (value: unknown): UserRaffleGroupTarget[] => {
  const entries = parseJsonColumn<unknown[]>(value, []);
  if (!Array.isArray(entries)) {
    return [];
  }

  const result: UserRaffleGroupTarget[] = [];
  const seen = new Set<number>();

  for (const entry of entries) {
    if (entry && typeof entry === "object") {
      const record = entry as Partial<UserRaffleGroupTarget> & { groupId?: number; remoteId?: string };
      const id = Number(record.groupId);
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
        continue;
      }
      const remoteId = typeof record.remoteId === "string" ? record.remoteId.trim() : "";
      if (!remoteId) {
        continue;
      }
      seen.add(id);
      result.push({
        groupId: id,
        remoteId,
        name: typeof record.name === "string" ? record.name : null,
        instanceId: Number.isFinite(record.instanceId) ? Number(record.instanceId) : null,
      });
    }
  }

  return result;
};

const computeTicketCounts = (tickets: readonly UserRaffleTicket[]) => {
  let reservedCount = 0;
  let soldCount = 0;
  let availableCount = 0;

  tickets.forEach((ticket) => {
    switch (ticket.status) {
      case "reserved":
        reservedCount += 1;
        break;
      case "paid":
        soldCount += 1;
        break;
      case "available":
        availableCount += 1;
        break;
      default:
        break;
    }
  });

  return { reservedCount, soldCount, availableCount };
};

const resolveStatusFromCounts = (
  current: UserRaffleStatus,
  counts: ReturnType<typeof computeTicketCounts>,
  numbersTotal: number,
): UserRaffleStatus => {
  if (current === "completed" || current === "cancelled") {
    return current;
  }

  if (counts.soldCount >= numbersTotal) {
    return "sold_out";
  }

  if (counts.soldCount > 0 || counts.reservedCount > 0) {
    return current === "draft" ? "selling" : "selling";
  }

  return current === "draft" ? "draft" : "active";
};

const getReservationExpirationMinutes = async (userId: number): Promise<number> => {
  try {
    const mpConfig = await getMercadoPagoPixConfigForUser(userId);
    if (mpConfig && mpConfig.isConfigured && mpConfig.isActive && mpConfig.pixExpirationMinutes > 0) {
      return Math.min(Math.max(Math.floor(mpConfig.pixExpirationMinutes), 5), 1440);
    }
  } catch (error) {
    console.error("[raffles] Failed to load Mercado Pago PIX config for expiration", error);
  }

  try {
    const polopagConfig = await getPoloPagPixConfigForUser(userId);
    if (polopagConfig && polopagConfig.isConfigured && polopagConfig.isActive && polopagConfig.pixExpirationMinutes > 0) {
      return Math.min(Math.max(Math.floor(polopagConfig.pixExpirationMinutes), 5), 1440);
    }
  } catch (error) {
    console.error("[raffles] Failed to load PoloPag PIX config for expiration", error);
  }

  return DEFAULT_RESERVATION_EXPIRATION_MINUTES;
};

async function releaseExpiredTicketsIfNeeded(
  userId: number,
  rows: readonly UserRaffleRow[],
): Promise<UserRaffleRow[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return Array.isArray(rows) ? rows.slice() : [];
  }

  const expirationMinutes = await getReservationExpirationMinutes(userId);
  const cutoff = Date.now() - expirationMinutes * 60 * 1000;
  if (cutoff <= 0) {
    return rows.slice();
  }

  const db = getDb();
  const updatedRows: UserRaffleRow[] = [];

  for (const row of rows) {
    const raffle = mapRowToRaffle(row);
    const changed = releaseExpiredReservations(raffle.tickets, cutoff);
    if (!changed) {
      updatedRows.push(row);
      continue;
    }

    const counts = computeTicketCounts(raffle.tickets);
    const nextStatus = resolveStatusFromCounts(raffle.status, counts, raffle.numbersTotal);
    const serializedTickets = serializeTickets(raffle.tickets);

    await db.query(
      `
        UPDATE user_raffles
        SET tickets = ?,
            reserved_count = ?,
            sold_count = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        serializedTickets,
        counts.reservedCount,
        counts.soldCount,
        nextStatus,
        raffle.id,
        userId,
      ],
    );

    updatedRows.push({
      ...row,
      tickets: serializedTickets,
      reserved_count: counts.reservedCount,
      sold_count: counts.soldCount,
      status: nextStatus,
      updated_at: new Date(),
    } as UserRaffleRow);
  }

  return updatedRows;
}

const resolveGroupTargetsForUser = async (
  userId: number,
  groupIds: readonly number[],
): Promise<UserRaffleGroupTarget[]> => {
  const normalized = Array.isArray(groupIds)
    ? Array.from(
        new Set(
          groupIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      )
    : [];

  if (normalized.length === 0) {
    return [];
  }

  const groups: UserRaffleGroupTarget[] = [];
  for (const groupId of normalized) {
    const group = await getGroupByIdForUser(userId, groupId);
    if (group && group.remoteId) {
      groups.push({
        groupId: group.id,
        remoteId: group.remoteId,
        name: group.name,
        instanceId: group.instanceId,
      });
    }
  }

  return groups;
};


const releaseExpiredReservations = (tickets: UserRaffleTicket[], cutoffMs: number): boolean => {
  let changed = false;
  tickets.forEach((ticket) => {
    if (ticket.status === "reserved" && ticket.reservedAt) {
      const reservedAt = Date.parse(ticket.reservedAt);
      if (Number.isFinite(reservedAt) && reservedAt <= cutoffMs) {
        ticket.status = "available";
        ticket.chargePublicId = null;
        ticket.customerName = null;
        ticket.customerWhatsapp = null;
        ticket.reservedAt = null;
        ticket.paidAt = null;
        ticket.groupJid = null;
        changed = true;
      }
    }
  });
  return changed;
};

type UserRaffleRow = RowDataPacket & {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  status: string;
  price: string | number;
  numbers_total: number;
  reserved_count: number;
  sold_count: number;
  winners_count: number;
  tickets: unknown;
  group_targets: unknown;
  group_jids: unknown;
  winners: unknown;
  metadata: unknown;
  drawn_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const mapRowToRaffle = (row: UserRaffleRow): UserRaffle => {
  const numbersTotal = Number(row.numbers_total ?? 0);
  const tickets = parseTickets(row.tickets, numbersTotal);
  const winners = parseJsonColumn<UserRaffleWinner[]>(row.winners, []).map((winner) => ({
    number: Number.isFinite(winner.number) ? Number(winner.number) : 0,
    customerName: winner.customerName ?? null,
    customerWhatsapp: winner.customerWhatsapp ?? null,
    chargePublicId: winner.chargePublicId ?? null,
    drawnAt: winner.drawnAt ?? new Date().toISOString(),
  }));
  const counts = computeTicketCounts(tickets);
  const metadata = parseRaffleMetadata(row.metadata);

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description ?? null,
    price: Number.parseFloat(String(row.price ?? 0)) || 0,
    numbersTotal,
    winnersCount: Number(row.winners_count ?? 1) || 1,
    status: clampStatus(row.status),
    tickets,
    groups: parseGroupTargets(row.group_targets),
    groupJids: parseStringArray(row.group_jids),
    reservedCount: counts.reservedCount,
    soldCount: counts.soldCount,
    winners,
    metadata,
    drawnAt: row.drawn_at
      ? row.drawn_at instanceof Date
        ? row.drawn_at.toISOString()
        : new Date(row.drawn_at).toISOString()
      : null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
};

export const summarizeRaffle = (raffle: UserRaffle): UserRaffleSummary => {
  const { reservedCount, soldCount, availableCount } = computeTicketCounts(raffle.tickets);
  return {
    id: raffle.id,
    title: raffle.title,
    description: raffle.description,
    price: raffle.price,
    numbersTotal: raffle.numbersTotal,
    winnersCount: raffle.winnersCount,
    status: raffle.status,
    reservedCount,
    soldCount,
    availableCount,
    groups: raffle.groups,
    winners: raffle.winners,
    announcement:
      raffle.metadata?.announcement ??
      hydrateAnnouncementSettingsFromStorage(DEFAULT_ANNOUNCEMENT_STORAGE),
    finalization:
      raffle.metadata?.finalization ??
      hydrateFinalizationSettingsFromStorage(DEFAULT_FINALIZATION_STORAGE),
    purchaseMenu:
      raffle.metadata?.purchaseMenu ?? { ...DEFAULT_PURCHASE_MENU_STORAGE },
    drawnAt: raffle.drawnAt,
    createdAt: raffle.createdAt,
    updatedAt: raffle.updatedAt,
  };
};

const serializeGroups = (
  groups: readonly UserRaffleGroupTarget[],
): { groupTargets: string; groupJids: string | null } => {
  const groupEntries = groups.map((group) => ({
    groupId: group.groupId,
    remoteId: group.remoteId,
    name: group.name ?? null,
    instanceId: group.instanceId ?? null,
  }));
  const groupJids = groups
    .map((group) => normalizeJid(group.remoteId))
    .filter((jid, index, array) => jid && array.indexOf(jid) === index);
  return {
    groupTargets: JSON.stringify(groupEntries),
    groupJids: groupJids.length > 0 ? JSON.stringify(groupJids) : null,
  };
};

const serializeTickets = (tickets: readonly UserRaffleTicket[]): string => JSON.stringify(tickets);

type RaffleAnnouncementInput = {
  message?: string | null;
  media?: {
    path?: string | null;
    url?: string | null;
    mediaType?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
  } | null;
  mentionAll?: boolean | null;
  buttons?: Array<{
    id?: string | null;
    text?: string | null;
    label?: string | null;
    type?: string | null;
    value?: string | null;
    command?: string | null;
    url?: string | null;
    copyCode?: string | null;
  }> | null;
};

type RaffleFinalizationInput = {
  message?: string | null;
};

type RafflePurchaseMenuInput = Partial<UserRafflePurchaseMenuSettings>;

const extractParticipantJids = (raw: unknown): string[] => {
  const unique = new Set<string>();

  const register = (candidate: unknown) => {
    if (typeof candidate !== "string") {
      return;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      return;
    }
    const withoutDevice = stripJidDevice(trimmed);
    if (withoutDevice.includes("@")) {
      unique.add(withoutDevice);
      return;
    }
    const digits = normalizeJid(trimmed);
    if (!digits) {
      return;
    }
    unique.add(`${digits}@c.us`);
  };

  const inspectEntry = (entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const idCandidates = [
      record.id,
      record.Id,
      record.ID,
      record.jid,
      record.JID,
      record._serialized,
      record.phone,
      record.Phone,
      record.Number,
      record.number,
    ];
    const idCandidate = idCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());
    if (idCandidate) {
      register(idCandidate);
    }
  };

  if (Array.isArray(raw)) {
    raw.forEach(inspectEntry);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          parsed.forEach(inspectEntry);
        } else {
          inspectEntry(parsed);
        }
      } catch {
        // ignore invalid JSON
      }
    }
  } else if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.participants)) {
      record.participants.forEach(inspectEntry);
    } else if (Array.isArray(record.data)) {
      record.data.forEach(inspectEntry);
    } else {
      inspectEntry(raw);
    }
  }

  return Array.from(unique);
};

const buildMentionPayload = (
  ids: readonly string[],
): { prefix: string; mentions: string[]; handleMap: Map<string, string> } => {
  const normalized: string[] = [];
  const handles = new Map<string, string>();

  const push = (jid: string) => {
    const trimmed = jid.trim();
    if (!trimmed) {
      return;
    }
    const normalizedJid = normalizeJid(trimmed) || trimmed;
    if (!normalizedJid.includes("@") || handles.has(normalizedJid)) {
      return;
    }
    const handle = `@${normalizedJid.replace(/@.+$/, "")}`;
    normalized.push(normalizedJid);
    handles.set(normalizedJid, handle);
  };

  ids.forEach(push);

  const limited = normalized.slice(0, RAFFLE_MENTION_LIMIT);
  const prefixHandles = limited.map((jid) => handles.get(jid) ?? `@${jid.replace(/@.+$/, "")}`);
  const prefix = prefixHandles.length ? prefixHandles.join(" ") : "";

  const limitedMap = new Map<string, string>();
  limited.forEach((jid, index) => limitedMap.set(jid, prefixHandles[index]));

  return {
    prefix,
    mentions: limited,
    handleMap: limitedMap,
  };
};

const applyTemplate = (template: string, context: Record<string, string>): string =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => context[key] ?? "");

const buildAnnouncementMessage = (
  raffle: UserRaffle,
  template: string,
  groupName: string | null,
  mentionPrefix: string,
  commandPrefix: string | null = "!",
): string => {
  const available = Math.max(0, raffle.numbersTotal - raffle.reservedCount - raffle.soldCount);
  const resolvedPrefix = commandPrefix && commandPrefix.trim() ? commandPrefix.trim() : "!";
  const buyCommand = `${resolvedPrefix}comprarrifa`;
  const context: Record<string, string> = {
    title: raffle.title,
    price: formatCurrency(raffle.price),
    numbersTotal: String(raffle.numbersTotal),
    winnersCount: String(raffle.winnersCount),
    numbersSold: String(raffle.soldCount),
    numbersReserved: String(raffle.reservedCount),
    numbersAvailable: String(available),
    groupName: groupName ?? "",
    commandPrefix: resolvedPrefix,
    buyCommand,
  };
  const rendered = applyTemplate(template || DEFAULT_ANNOUNCEMENT_TEMPLATE, context).trim();
  return mentionPrefix ? `${mentionPrefix}\n${rendered}`.trim() : rendered;
};

const buildWinnerSummary = (
  winners: UserRaffleWinner[],
  handleMap: Map<string, string>,
): { list: string; names: string; numbers: string } => {
  if (winners.length === 0) {
    return {
      list: "Nenhum participante elegível para sorteio.",
      names: "",
      numbers: "",
    };
  }

  const lines: string[] = [];
  const names: string[] = [];
  const numbers: string[] = [];

  winners.forEach((winner, index) => {
    const position = index + 1;
    const numberLabel = `Número ${winner.number}`;
    const parts = [`${position}º prêmio — ${numberLabel}`];
    const normalizedJid = normalizeJid(winner.customerWhatsapp ?? "");
    const handle = normalizedJid ? handleMap.get(normalizedJid) ?? `@${normalizedJid.replace(/@.+$/, "")}` : "";
    const name = winner.customerName?.trim();
    if (name) {
      parts.push(`(${name})`);
      names.push(name);
    } else if (handle) {
      names.push(handle);
    } else {
      names.push(`#${winner.number}`);
    }
    if (handle) {
      parts.push(handle);
    }
    numbers.push(`#${winner.number}`);
    lines.push(parts.join(" "));
  });

  return {
    list: lines.join("\n"),
    names: names.join(", "),
    numbers: numbers.join(", "),
  };
};

const buildFinalizationMessage = (
  raffle: UserRaffle,
  template: string,
  groupName: string | null,
  mentionPrefix: string,
  summary: ReturnType<typeof buildWinnerSummary>,
): string => {
  const context: Record<string, string> = {
    title: raffle.title,
    price: formatCurrency(raffle.price),
    numbersTotal: String(raffle.numbersTotal),
    winnersCount: String(raffle.winnersCount),
    winnerList: summary.list,
    winnerNames: summary.names,
    winnerNumbers: summary.numbers,
    groupName: groupName ?? "",
  };
  const rendered = applyTemplate(template || DEFAULT_FINAL_TEMPLATE, context).trim();
  return mentionPrefix ? `${mentionPrefix}\n${rendered}`.trim() : rendered;
};

const resolveUploadCandidates = (relativePath: string): string[] => {
  const normalized = relativePath.replace(/^\/+/g, "").replace(/\\/g, "/");
  const trimmed = normalized.startsWith("uploads/") ? normalized.slice("uploads/".length) : normalized;
  const candidates: string[] = [];
  if (UPLOADS_STORAGE_ROOT) {
    const absolute = path.resolve(UPLOADS_STORAGE_ROOT, trimmed);
    if (absolute.startsWith(UPLOADS_STORAGE_ROOT)) {
      candidates.push(absolute);
    }
  }
  if (ARCHIVE_UPLOAD_ROOT) {
    const absolute = path.resolve(ARCHIVE_UPLOAD_ROOT, trimmed);
    if (absolute.startsWith(ARCHIVE_UPLOAD_ROOT)) {
      candidates.push(absolute);
    }
  }
  return candidates;
};

const loadUploadedMediaBuffer = async (relativePath: string): Promise<Buffer | null> => {
  const candidates = resolveUploadCandidates(relativePath);
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return null;
};

type GroupDispatchRow = {
  id: number;
  name: string | null;
  remote_id: string | null;
  participants: unknown;
  base_url: string | null;
  token: string | null;
  session_status: string | null;
};

const fetchGroupDispatchContexts = async (
  userId: number,
  groups: readonly UserRaffleGroupTarget[],
): Promise<GroupDispatchContext[]> => {
  const ids = Array.from(
    new Set(
      groups
        .map((group) => group.groupId)
        .filter((groupId) => Number.isFinite(groupId) && groupId > 0),
    ),
  );

  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const db = getDb();
  const [rows] = await db.query<(GroupDispatchRow & RowDataPacket)[]>(
    `
      SELECT
        g.id,
        g.name,
        g.remote_id,
        g.participants,
        i.base_url,
        i.token,
        i.session_status
      FROM bot_groups g
      LEFT JOIN bot_instances i ON i.id = g.instance_id
      WHERE g.user_id = ? AND g.id IN (${placeholders})
    `,
    [userId, ...ids],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const contexts: GroupDispatchContext[] = [];
  for (const row of rows) {
    if (!row.remote_id || !row.base_url || !row.token) {
      continue;
    }
    if ((row.session_status || "").toLowerCase() !== "conectado") {
      continue;
    }
    const rawRemoteId = String(row.remote_id || "").trim();
    const strippedRemote = stripJidDevice(rawRemoteId);
    let groupJid = strippedRemote;
    if (!groupJid.includes("@")) {
      const digits = normalizeJid(groupJid);
      if (!digits) {
        continue;
      }
      groupJid = `${digits}@g.us`;
    }
    if (!groupJid.endsWith("@g.us")) {
      const digits = normalizeJid(groupJid);
      if (!digits) {
        continue;
      }
      groupJid = `${digits}@g.us`;
    }
    if (!groupJid) {
      continue;
    }

    const participants = extractParticipantJids(row.participants);
    contexts.push({
      groupId: row.id,
      groupName: row.name ?? null,
      groupJid,
      client: { baseUrl: row.base_url, token: row.token },
      participants,
    });
  }

  return contexts;
};

async function dispatchRaffleAnnouncement(userId: number, raffle: UserRaffle): Promise<void> {
  const settings: UserRaffleAnnouncementSettings =
    raffle.metadata?.announcement ??
    hydrateAnnouncementSettingsFromStorage(DEFAULT_ANNOUNCEMENT_STORAGE);

  if (!raffle.groups.length) {
    return;
  }

  const contexts = await fetchGroupDispatchContexts(userId, raffle.groups);
  if (!contexts.length) {
    return;
  }

  await Promise.allSettled(
    contexts.map(async (context) => {
      try {
        const mentionSource = settings.mentionAll !== false ? context.participants : [];
        const { prefix, mentions } = buildMentionPayload(mentionSource);
        const message = buildAnnouncementMessage(
          raffle,
          settings.message ?? DEFAULT_ANNOUNCEMENT_TEMPLATE,
          context.groupName,
          prefix,
          "!",
        );

        if (settings.buttons.length > 0) {
          const mediaBuffer = settings.media?.path
            ? await loadUploadedMediaBuffer(settings.media.path)
            : null;
          await sendInteractiveButtons(context.client, {
            to: context.groupJid,
            title: raffle.title,
            body: message,
            footer: "Escolha uma opção para participar",
            buttons: settings.buttons.map((button) => {
              const normalizedButtonValue =
                button.type === "quick_reply" &&
                /^[!/#$%&.~]*comprarrifa\s+1$/i.test(button.value.trim())
                  ? "!comprarrifa"
                  : button.value;
              const commandParts = normalizedButtonValue
                .replace(/^[!/#$%&.~]+/, "")
                .trim()
                .split(/\s+/);
              return {
                id:
                  normalizedButtonValue === button.value
                    ? button.id
                    : normalizedButtonValue,
                text: button.text,
                type: button.type,
                url:
                  button.type === "cta_url"
                    ? normalizedButtonValue
                    : undefined,
                copyCode:
                  button.type === "cta_copy"
                    ? normalizedButtonValue
                    : undefined,
                payload:
                  button.type === "quick_reply"
                    ? {
                        command: commandParts[0] ?? "comprarrifa",
                        args: commandParts.slice(1).join(" "),
                      }
                    : undefined,
              };
            }),
            headerMedia:
              mediaBuffer && settings.media && settings.media.mediaType !== "audio"
                ? {
                    type:
                      settings.media.mediaType === "image" || settings.media.mediaType === "video"
                        ? settings.media.mediaType
                        : "document",
                    media: mediaBuffer,
                    mimeType: settings.media.mimeType ?? undefined,
                    fileName: settings.media.fileName ?? undefined,
                  }
                : null,
            buttonType: "native",
            mentions,
          });
          return;
        }

        if (settings.media && settings.media.path) {
          const buffer = await loadUploadedMediaBuffer(settings.media.path);
          if (buffer) {
            await sendMediaMessage(context.client, {
              to: context.groupJid,
              media: buffer,
              mediaType: settings.media.mediaType,
              caption: message,
              filename: settings.media.fileName ?? undefined,
              mimeType: settings.media.mimeType ?? undefined,
              mentions,
            });
            return;
          }
        }

        if (message.trim()) {
          await sendTextMessage(context.client, {
            to: context.groupJid,
            body: message,
            mentions,
          });
        }
      } catch (error) {
        console.error("[raffles] Falha ao anunciar rifa em grupo", {
          userId,
          raffleId: raffle.id,
          groupId: context.groupId,
          error,
        });
      }
    }),
  );
}

export const announceRafflePaymentToGroups = async (payload: {
  userId: number;
  raffle: UserRaffle;
  numbers: number[];
  customerName?: string | null;
  customerWhatsapp?: string | null;
  groupJid?: string | null;
  amount?: number;
}): Promise<void> => {
  if (!payload.numbers || payload.numbers.length === 0) {
    return;
  }

  const contexts = await fetchGroupDispatchContexts(payload.userId, payload.raffle.groups);
  if (!contexts.length) {
    return;
  }

  const normalizedTarget = payload.groupJid ? normalizeJid(payload.groupJid) : "";
  const targetContexts = normalizedTarget
    ? contexts.filter((context) => normalizeJid(context.groupJid) === normalizedTarget)
    : contexts;

  if (!targetContexts.length) {
    return;
  }

  const sortedNumbers = [...payload.numbers].sort((a, b) => a - b);
  const quantityLabel = `${sortedNumbers.length} número${sortedNumbers.length > 1 ? "s" : ""}`;
  const numbersLabel = sortedNumbers.join(", ");
  const amountLabel = typeof payload.amount === "number" && Number.isFinite(payload.amount)
    ? formatCurrency(payload.amount)
    : null;

  const buyerLabel = (payload.customerName?.trim()
    || payload.customerWhatsapp?.trim()
    || "Cliente do bot").trim();

  await Promise.allSettled(
    targetContexts.map(async (context) => {
      try {
        const mentionIds: string[] = [];
        if (payload.customerWhatsapp) {
          const customerDigits = normalizeJid(payload.customerWhatsapp);
          if (customerDigits) {
            mentionIds.push(`${customerDigits}@s.whatsapp.net`);
          }
        }

        const { prefix, mentions } = buildMentionPayload(mentionIds);
        const header = prefix ? `${prefix}\n\n` : "";

        const quantitySummary = numbersLabel ? `${quantityLabel} (${numbersLabel})` : quantityLabel;
        const lines: string[] = [
          "🎉 *Nova venda concluída!*",
          `🙋 Cliente: ${buyerLabel}`,
          `🏷️ Rifa: ${payload.raffle.title}`,
          `🎟️ ${quantitySummary}`,
        ];

        if (amountLabel) {
          lines.push(`💰 Valor: ${amountLabel}`);
        }

        lines.push("🍀 A sorte está lançada! Obrigado por participar.");
        lines.push("✨ Compartilhe com a galera e boa sorte nos próximos números!");

        const message = `${header}${lines.join("\n")}`;

        await sendTextMessage(context.client, {
          to: context.groupJid,
          body: message,
          mentions,
        });
      } catch (error) {
        console.error("[raffles] Falha ao anunciar pagamento em grupo", {
          userId: payload.userId,
          raffleId: payload.raffle.id,
          groupId: context.groupId,
          error,
        });
      }
    }),
  );
};

export async function dispatchRaffleFinalization(
  userId: number,
  raffle: UserRaffle,
  winners: UserRaffleWinner[],
): Promise<void> {
  const finalSettings: UserRaffleFinalizationSettings = raffle.metadata?.finalization ?? {
    message: DEFAULT_FINAL_TEMPLATE,
  };
  const mentionAll = raffle.metadata?.announcement?.mentionAll ?? DEFAULT_MENTION_ALL;

  if (!raffle.groups.length) {
    return;
  }

  const contexts = await fetchGroupDispatchContexts(userId, raffle.groups);
  if (!contexts.length) {
    return;
  }

  await Promise.allSettled(
    contexts.map(async (context) => {
      try {
        const winnerJids = winners
          .map((winner) => normalizeJid(winner.customerWhatsapp ?? ""))
          .filter((jid): jid is string => Boolean(jid));

        const mentionIds: string[] = [];
        const register = (jid: string) => {
          if (!jid) {
            return;
          }
          if (!mentionIds.includes(jid)) {
            mentionIds.push(jid);
          }
        };

        winnerJids.forEach(register);
        if (mentionAll !== false) {
          context.participants.forEach(register);
        }

        const { prefix, mentions, handleMap } = buildMentionPayload(mentionIds);
        const summary = buildWinnerSummary(winners, handleMap);
        const message = buildFinalizationMessage(
          raffle,
          finalSettings.message ?? DEFAULT_FINAL_TEMPLATE,
          context.groupName,
          prefix,
          summary,
        );

        if (message.trim()) {
          await sendTextMessage(context.client, {
            to: context.groupJid,
            body: message,
            mentions,
          });
        }
      } catch (error) {
        console.error("[raffles] Falha ao anunciar resultado da rifa", {
          userId,
          raffleId: raffle.id,
          groupId: context.groupId,
          error,
        });
      }
    }),
  );
}

export type CreateUserRafflePayload = {
  title: string;
  description?: string | null;
  price: number;
  numbersTotal: number;
  winnersCount: number;
  groupIds: number[];
  metadata?: Record<string, unknown> | null;
  announcement?: RaffleAnnouncementInput | null;
  finalization?: RaffleFinalizationInput | null;
  purchaseMenu?: RafflePurchaseMenuInput | null;
};

export type UpdateUserRafflePayload = {
  title?: string;
  description?: string | null;
  price?: number;
  numbersTotal?: number;
  winnersCount?: number;
  groupIds?: number[];
  announcement?: RaffleAnnouncementInput | null;
  finalization?: RaffleFinalizationInput | null;
  purchaseMenu?: RafflePurchaseMenuInput | null;
};

export const createUserRaffleForUser = async (
  userId: number,
  payload: CreateUserRafflePayload,
): Promise<UserRaffle> => {
  const normalizedTitle = payload.title?.toString().trim();
  if (!normalizedTitle) {
    throw new Error("Informe o título da rifa.");
  }

  const normalizedNumbers = Number(payload.numbersTotal);
  if (!Number.isFinite(normalizedNumbers) || normalizedNumbers < MIN_TICKETS || normalizedNumbers > MAX_TICKETS) {
    throw new Error(`Informe uma quantidade de números entre ${MIN_TICKETS} e ${MAX_TICKETS}.`);
  }
  if (!Number.isInteger(normalizedNumbers)) {
    throw new Error("A quantidade de números deve ser um número inteiro.");
  }

  const normalizedWinners = Number(payload.winnersCount ?? 1);
  if (!Number.isFinite(normalizedWinners) || normalizedWinners <= 0 || normalizedWinners > MAX_WINNERS) {
    throw new Error(`Informe uma quantidade de ganhadores entre 1 e ${MAX_WINNERS}.`);
  }
  if (!Number.isInteger(normalizedWinners)) {
    throw new Error("A quantidade de ganhadores deve ser um número inteiro.");
  }

  if (normalizedWinners > normalizedNumbers) {
    throw new Error("A quantidade de ganhadores não pode ser maior que o total de números disponíveis.");
  }

  const normalizedPrice = Number(payload.price);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    throw new Error("Informe um valor válido para cada número da rifa.");
  }

  const [mercadoPagoConfig, poloPagConfig] = await Promise.all([
    getMercadoPagoPixConfigForUser(userId),
    getPoloPagPixConfigForUser(userId),
  ]);
  const hasPaymentProvider =
    (mercadoPagoConfig.isConfigured &&
      mercadoPagoConfig.isActive &&
      Boolean(mercadoPagoConfig.accessToken)) ||
    (poloPagConfig.isConfigured &&
      poloPagConfig.isActive &&
      Boolean(poloPagConfig.apiKey));
  if (!hasPaymentProvider) {
    throw new Error(
      "Configure primeiro o Mercado Pago ou a PoloPag para receber os pagamentos da rifa.",
    );
  }

  const groupIds = Array.isArray(payload.groupIds) ? payload.groupIds : [];
  const groups = await resolveGroupTargetsForUser(userId, groupIds);
  await ensureRaffleGroupAvailability(userId, groups);

  const tickets: UserRaffleTicket[] = [];
  for (let i = 1; i <= normalizedNumbers; i += 1) {
    tickets.push(
      sanitizeTicket(
        {
          status: "available",
        },
        i,
      ),
    );
  }

  const serializedGroups = serializeGroups(groups);

  const announcementStorage = normalizeAnnouncementStorage(
    payload.announcement ?? null,
    DEFAULT_ANNOUNCEMENT_STORAGE,
  );
  const finalizationStorage = normalizeFinalizationStorage(
    payload.finalization ?? null,
    DEFAULT_FINALIZATION_STORAGE,
  );
  const purchaseMenuStorage = normalizePurchaseMenuStorage(
    payload.purchaseMenu ?? null,
    DEFAULT_PURCHASE_MENU_STORAGE,
  );

  const metadataBase =
    payload.metadata && typeof payload.metadata === "object" && payload.metadata
      ? Object.fromEntries(
          Object.entries(payload.metadata).filter(
            ([key]) =>
              key !== "announcement" &&
              key !== "finalization" &&
              key !== "purchaseMenu",
          ),
        )
      : {};
  metadataBase.announcement = announcementStorage;
  metadataBase.finalization = finalizationStorage;
  metadataBase.purchaseMenu = purchaseMenuStorage;
  const metadataJson = JSON.stringify(metadataBase);

  await ensureUserRafflesTable();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `
      INSERT INTO user_raffles (
        user_id,
        title,
        description,
        status,
        price,
        numbers_total,
        reserved_count,
        sold_count,
        winners_count,
        tickets,
        group_targets,
        group_jids,
        winners,
        metadata
      ) VALUES (?, ?, ?, 'active', ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      normalizedTitle,
      payload.description ?? null,
      Number(normalizedPrice.toFixed(2)),
      normalizedNumbers,
      normalizedWinners,
      serializeTickets(tickets),
      serializedGroups.groupTargets,
      serializedGroups.groupJids,
      JSON.stringify([]),
      metadataJson,
    ],
  );

  const raffle = await getUserRaffleByIdForUser(userId, result.insertId);
  if (!raffle) {
    throw new Error("Não foi possível carregar a rifa recém-criada.");
  }

  if (raffle.groups.length > 0) {
    dispatchRaffleAnnouncement(userId, raffle).catch((error) =>
      console.error("[raffles] Falha ao anunciar criação da rifa", error),
    );
  }

  return raffle;
};

export const updateUserRaffleForUser = async (
  userId: number,
  raffleId: number,
  payload: UpdateUserRafflePayload,
): Promise<UserRaffle | null> =>
  withTransaction(async (connection) => {
    const [rows] = await connection.query<UserRaffleRow[]>(
      `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? FOR UPDATE`,
      [userId, raffleId],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const raffle = mapRowToRaffle(row);

    const nextTitleRaw = payload.title !== undefined ? String(payload.title ?? "").trim() : raffle.title;
    if (!nextTitleRaw) {
      throw new Error("Informe o título da rifa.");
    }
    const nextTitle = nextTitleRaw;

    const nextDescription =
      payload.description === undefined
        ? raffle.description
        : payload.description === null
          ? null
          : String(payload.description).trim() || null;

    const nextPrice = payload.price !== undefined ? Number(payload.price) : raffle.price;
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      throw new Error("Informe um valor válido para cada número da rifa.");
    }

    const nextNumbersTotal = payload.numbersTotal !== undefined ? Number(payload.numbersTotal) : raffle.numbersTotal;
    if (
      !Number.isFinite(nextNumbersTotal)
      || nextNumbersTotal < MIN_TICKETS
      || nextNumbersTotal > MAX_TICKETS
      || !Number.isInteger(nextNumbersTotal)
    ) {
      throw new Error(`Informe uma quantidade de números inteira entre ${MIN_TICKETS} e ${MAX_TICKETS}.`);
    }

    const nextWinnersCount =
      payload.winnersCount !== undefined ? Number(payload.winnersCount) : raffle.winnersCount;
    if (
      !Number.isFinite(nextWinnersCount)
      || nextWinnersCount <= 0
      || nextWinnersCount > MAX_WINNERS
      || !Number.isInteger(nextWinnersCount)
    ) {
      throw new Error(`Informe uma quantidade de ganhadores inteira entre 1 e ${MAX_WINNERS}.`);
    }

    if (nextWinnersCount > nextNumbersTotal) {
      throw new Error("A quantidade de ganhadores não pode ser maior que o total de números disponíveis.");
    }

    const nextGroups =
      payload.groupIds === undefined
        ? raffle.groups
        : await resolveGroupTargetsForUser(userId, payload.groupIds);

    const currentMetadataRaw = parseJsonColumn<Record<string, unknown> | null>(row.metadata, null) ?? {};
    const currentAnnouncementStorage = normalizeAnnouncementStorage(
      (currentMetadataRaw as Record<string, unknown>).announcement,
      DEFAULT_ANNOUNCEMENT_STORAGE,
    );
    const currentFinalizationStorage = normalizeFinalizationStorage(
      (currentMetadataRaw as Record<string, unknown>).finalization,
      DEFAULT_FINALIZATION_STORAGE,
    );
    const currentPurchaseMenuStorage = normalizePurchaseMenuStorage(
      (currentMetadataRaw as Record<string, unknown>).purchaseMenu,
      DEFAULT_PURCHASE_MENU_STORAGE,
    );
    const nextAnnouncementStorage =
      payload.announcement === undefined
        ? currentAnnouncementStorage
        : normalizeAnnouncementStorage(payload.announcement, currentAnnouncementStorage);
    const nextFinalizationStorage =
      payload.finalization === undefined
        ? currentFinalizationStorage
        : normalizeFinalizationStorage(payload.finalization, currentFinalizationStorage);
    const nextPurchaseMenuStorage =
      payload.purchaseMenu === undefined
        ? currentPurchaseMenuStorage
        : normalizePurchaseMenuStorage(
            payload.purchaseMenu,
            currentPurchaseMenuStorage,
          );

    if (payload.groupIds !== undefined) {
      const currentSet = buildTargetJidSet(raffle.groups);
      const nextSet = buildTargetJidSet(nextGroups);
      const groupsChanged =
        currentSet.size !== nextSet.size || Array.from(currentSet).some((jid) => !nextSet.has(jid));
      if (groupsChanged) {
        await ensureRaffleGroupAvailability(userId, nextGroups, { excludeRaffleId: raffleId });
      }
    }

    const tickets = [...raffle.tickets];
    if (nextNumbersTotal < raffle.soldCount) {
      throw new Error("Não é possível reduzir o total de números abaixo da quantidade já vendida.");
    }
    if (nextNumbersTotal < raffle.reservedCount + raffle.soldCount) {
      throw new Error("Não é possível reduzir o total de números abaixo da soma de vendas e reservas ativas.");
    }
    if (nextNumbersTotal > raffle.numbersTotal) {
      const additional = nextNumbersTotal - raffle.numbersTotal;
      for (let i = 1; i <= additional; i += 1) {
        tickets.push(
          sanitizeTicket(
            {
              status: "available",
            },
            raffle.numbersTotal + i,
          ),
        );
      }
    }

    const nextCounts = computeTicketCounts(tickets);
    const nextStatus = resolveStatusFromCounts(row.status as UserRaffleStatus, nextCounts, nextNumbersTotal);

    const serializedGroups = serializeGroups(nextGroups);
    const serializedTickets = serializeTickets(tickets);

    const metadataBase: Record<string, unknown> = {
      ...currentMetadataRaw,
      announcement: nextAnnouncementStorage,
      finalization: nextFinalizationStorage,
      purchaseMenu: nextPurchaseMenuStorage,
    };

    await connection.query(
      `
        UPDATE user_raffles
        SET title = ?,
            description = ?,
            price = ?,
            numbers_total = ?,
            winners_count = ?,
            tickets = ?,
            reserved_count = ?,
            sold_count = ?,
            group_targets = ?,
            group_jids = ?,
            metadata = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        nextTitle,
        nextDescription,
        Number(nextPrice.toFixed(2)),
        nextNumbersTotal,
        nextWinnersCount,
        serializedTickets,
        nextCounts.reservedCount,
        nextCounts.soldCount,
        serializedGroups.groupTargets,
        serializedGroups.groupJids,
        JSON.stringify(metadataBase),
        nextStatus,
        raffleId,
        userId,
      ],
    );

    const updatedRow: UserRaffleRow = {
      ...row,
      title: nextTitle,
      description: nextDescription,
      price: Number(nextPrice.toFixed(2)),
      numbers_total: nextNumbersTotal,
      winners_count: nextWinnersCount,
      tickets: serializedTickets,
      reserved_count: nextCounts.reservedCount,
      sold_count: nextCounts.soldCount,
      group_targets: serializedGroups.groupTargets,
      group_jids: serializedGroups.groupJids,
      metadata: metadataBase,
      status: nextStatus,
      updated_at: new Date(),
    };

    if (
      currentAnnouncementStorage.media?.path &&
      currentAnnouncementStorage.media.path !== (nextAnnouncementStorage.media?.path ?? null)
    ) {
      await deleteUploadedFile(currentAnnouncementStorage.media.path).catch(() => {});
    }

    return mapRowToRaffle(updatedRow);
  });

export const listUserRafflesForUser = async (userId: number): Promise<UserRaffle[]> => {
  await ensureUserRafflesTable();
  const db = getDb();
  const [rowsRaw] = await db.query<UserRaffleRow[]>(
    `SELECT * FROM user_raffles WHERE user_id = ? ORDER BY id DESC`,
    [userId],
  );

  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return [];
  }

  const rows = await releaseExpiredTicketsIfNeeded(userId, rowsRaw);

  return rows.map(mapRowToRaffle);
};

export const getUserRaffleByIdForUser = async (
  userId: number,
  raffleId: number,
): Promise<UserRaffle | null> => {
  await ensureUserRafflesTable();
  const db = getDb();
  const [rowsRaw] = await db.query<UserRaffleRow[]>(
    `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, raffleId],
  );

  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return null;
  }

  const [row] = await releaseExpiredTicketsIfNeeded(userId, rowsRaw);
  return mapRowToRaffle(row);
};

const withTransaction = async <T>(handler: (connection: PoolConnection) => Promise<T>): Promise<T> => {
  const db = getDb();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback error
    }
    throw error;
  } finally {
    connection.release();
  }
};

type ReserveTicketsPayload = {
  userId: number;
  raffleId: number;
  quantity: number;
  chargePublicId: string;
  customerName?: string | null;
  customerWhatsapp?: string | null;
  groupJid?: string | null;
};

export const reserveRaffleTicketsForCharge = async (
  payload: ReserveTicketsPayload,
): Promise<{ raffle: UserRaffle; numbers: number[] }> => {
  const quantity = Number(payload.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Informe a quantidade de números desejada.");
  }

  const chargeId = payload.chargePublicId.trim();
  if (!chargeId) {
    throw new Error("Identificador da cobrança inválido.");
  }

  const expirationMinutes = await getReservationExpirationMinutes(payload.userId);
  const expirationMillis = expirationMinutes * 60 * 1000;

  return withTransaction(async (connection) => {
    const [rows] = await connection.query<UserRaffleRow[]>(
      `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? FOR UPDATE`,
      [payload.userId, payload.raffleId],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Rifa não encontrada.");
    }

    const row = rows[0];
    const raffle = mapRowToRaffle(row);

    const expirationCutoff = Date.now() - expirationMillis;
    if (expirationCutoff > 0) {
      releaseExpiredReservations(raffle.tickets, expirationCutoff);
    }

    if (raffle.status === "cancelled" || raffle.status === "completed") {
      throw new Error("Esta rifa não está disponível no momento.");
    }

    if (raffle.status === "sold_out") {
      throw new Error("Todos os números desta rifa já foram vendidos.");
    }

    const normalizedGroupJid = payload.groupJid ? normalizeJid(payload.groupJid) : null;
    if (raffle.groupJids.length > 0 && normalizedGroupJid && !raffle.groupJids.includes(normalizedGroupJid)) {
      throw new Error("Esta rifa não está disponível neste grupo.");
    }

    const nowIso = new Date().toISOString();
    const availableTickets = raffle.tickets.filter((ticket) => ticket.status === "available");
    if (availableTickets.length < quantity) {
      throw new Error("Não há números suficientes disponíveis no momento.");
    }

    const reservedNumbers: number[] = [];
    const customerName = payload.customerName?.toString().trim() || null;
    const customerWhatsapp = payload.customerWhatsapp ? normalizeJid(payload.customerWhatsapp) : null;

    for (const ticket of raffle.tickets) {
      if (ticket.status === "available") {
        ticket.status = "reserved";
        ticket.reservedAt = nowIso;
        ticket.customerName = customerName;
        ticket.customerWhatsapp = customerWhatsapp;
        ticket.chargePublicId = chargeId;
        ticket.groupJid = normalizedGroupJid;
        reservedNumbers.push(ticket.number);
        if (reservedNumbers.length >= quantity) {
          break;
        }
      }
    }

    const counts = computeTicketCounts(raffle.tickets);
    const nextStatus = resolveStatusFromCounts(raffle.status, counts, raffle.numbersTotal);
    const serializedTickets = serializeTickets(raffle.tickets);

    await connection.query(
      `
        UPDATE user_raffles
        SET tickets = ?,
            reserved_count = ?,
            sold_count = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        serializedTickets,
        counts.reservedCount,
        counts.soldCount,
        nextStatus,
        raffle.id,
        payload.userId,
      ],
    );

    const updatedRow: UserRaffleRow = {
      ...row,
      tickets: serializedTickets,
      reserved_count: counts.reservedCount,
      sold_count: counts.soldCount,
      status: nextStatus,
    };

    return { raffle: mapRowToRaffle(updatedRow), numbers: reservedNumbers };
  });
};

type ReleaseTicketsPayload = {
  userId: number;
  raffleId: number;
  chargePublicId: string;
};

export const releaseRaffleTicketsForCharge = async (
  payload: ReleaseTicketsPayload,
): Promise<UserRaffle | null> =>
  withTransaction(async (connection) => {
    const [rows] = await connection.query<UserRaffleRow[]>(
      `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? FOR UPDATE`,
      [payload.userId, payload.raffleId],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const raffle = mapRowToRaffle(row);
    let changed = false;

    raffle.tickets.forEach((ticket) => {
      if (ticket.chargePublicId === payload.chargePublicId && ticket.status === "reserved") {
        ticket.status = "available";
        ticket.chargePublicId = null;
        ticket.customerName = null;
        ticket.customerWhatsapp = null;
        ticket.reservedAt = null;
        ticket.groupJid = null;
        changed = true;
      }
    });

    if (!changed) {
      return raffle;
    }

    const counts = computeTicketCounts(raffle.tickets);
    const nextStatus = resolveStatusFromCounts(raffle.status, counts, raffle.numbersTotal);

    await connection.query(
      `
        UPDATE user_raffles
        SET tickets = ?,
            reserved_count = ?,
            sold_count = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        serializeTickets(raffle.tickets),
        counts.reservedCount,
        counts.soldCount,
        nextStatus,
        raffle.id,
        payload.userId,
      ],
    );

    const updatedRow: UserRaffleRow = {
      ...row,
      tickets: raffle.tickets,
      reserved_count: counts.reservedCount,
      sold_count: counts.soldCount,
      status: nextStatus,
    };

    return mapRowToRaffle(updatedRow);
  });

type MarkPaidPayload = {
  userId: number;
  chargePublicId: string;
  raffleId?: number;
  quantity?: number;
  suggestedNumbers?: number[];
  customerName?: string | null;
  customerWhatsapp?: string | null;
  groupJid?: string | null;
};

export const markRaffleTicketsPaidByCharge = async (
  payload: MarkPaidPayload,
): Promise<{ raffle: UserRaffle; numbers: number[] } | null> =>
  withTransaction(async (connection) => {
    const [rows] = await connection.query<UserRaffleRow[]>(
      `SELECT * FROM user_raffles WHERE user_id = ?`,
      [payload.userId],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    let target: UserRaffleRow | null = null;
    for (const row of rows) {
      const raffle = mapRowToRaffle(row);
      if (raffle.tickets.some((ticket) => ticket.chargePublicId === payload.chargePublicId)) {
        target = row;
        break;
      }
    }

    const targetRaffleId = target ? target.id : (Number.isFinite(payload.raffleId) ? Number(payload.raffleId) : null);
    if (!targetRaffleId) {
      return null;
    }

    const [lockedRows] = await connection.query<UserRaffleRow[]>(
      `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? FOR UPDATE`,
      [payload.userId, targetRaffleId],
    );

    if (!Array.isArray(lockedRows) || lockedRows.length === 0) {
      return null;
    }

    const lockedRow = lockedRows[0];
    const raffle = mapRowToRaffle(lockedRow);

    const expirationMinutes = await getReservationExpirationMinutes(payload.userId);
    const expirationMillis = expirationMinutes * 60 * 1000;
    const nowIso = new Date().toISOString();
    const numbers: number[] = [];
    let changed = false;

    const normalizedGroupJid = payload.groupJid ? normalizeJid(payload.groupJid) : null;
    const normalizedCustomerWhatsapp = payload.customerWhatsapp ? normalizeJid(payload.customerWhatsapp) : null;
    const customerName = payload.customerName?.toString().trim() || null;

    raffle.tickets.forEach((ticket) => {
      if (ticket.chargePublicId !== payload.chargePublicId) {
        return;
      }
      numbers.push(ticket.number);
      if (ticket.status === "reserved") {
        ticket.status = "paid";
        ticket.paidAt = nowIso;
        if (!ticket.reservedAt) {
          ticket.reservedAt = nowIso;
        }
        changed = true;
      }
    });

    if (!changed && numbers.length === 0) {
      const requestedQuantityRaw = Number(payload.quantity);
      const requestedQuantity = Number.isFinite(requestedQuantityRaw) && requestedQuantityRaw > 0
        ? Math.min(Math.floor(requestedQuantityRaw), MAX_TICKETS)
        : 1;

      const expirationCutoff = Date.now() - expirationMillis;
      if (expirationCutoff > 0) {
        if (releaseExpiredReservations(raffle.tickets, expirationCutoff)) {
          // remove stale reservations linked to other charges before allocating
        }
      }

      const preferredNumbers = Array.isArray(payload.suggestedNumbers)
        ? payload.suggestedNumbers
          .map((entry) => Number(entry))
          .filter((entry, index, array) => Number.isFinite(entry) && entry > 0 && array.indexOf(entry) === index)
        : [];

      const takeTicket = (ticket: UserRaffleTicket) => {
        ticket.status = "paid";
        ticket.paidAt = nowIso;
        ticket.reservedAt = nowIso;
        ticket.chargePublicId = payload.chargePublicId;
        ticket.customerName = customerName;
        ticket.customerWhatsapp = normalizedCustomerWhatsapp;
        ticket.groupJid = normalizedGroupJid;
        numbers.push(ticket.number);
        changed = true;
      };

      for (const preferred of preferredNumbers) {
        const match = raffle.tickets.find((ticket) => ticket.number === preferred && ticket.status === "available");
        if (match) {
          takeTicket(match);
          if (numbers.length >= requestedQuantity) {
            break;
          }
        }
      }

      if (numbers.length < requestedQuantity) {
        for (const ticket of raffle.tickets) {
          if (ticket.status !== "available") {
            continue;
          }
          takeTicket(ticket);
          if (numbers.length >= requestedQuantity) {
            break;
          }
        }
      }

      if (numbers.length === 0) {
        return null;
      }
    }

    const counts = computeTicketCounts(raffle.tickets);
    const nextStatus = resolveStatusFromCounts(raffle.status, counts, raffle.numbersTotal);

    await connection.query(
      `
        UPDATE user_raffles
        SET tickets = ?,
            reserved_count = ?,
            sold_count = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        serializeTickets(raffle.tickets),
        counts.reservedCount,
        counts.soldCount,
        nextStatus,
        raffle.id,
        payload.userId,
      ],
    );

    const updatedRow: UserRaffleRow = {
      ...lockedRow,
      tickets: raffle.tickets,
      reserved_count: counts.reservedCount,
      sold_count: counts.soldCount,
      status: nextStatus,
    };

    numbers.sort((a, b) => a - b);
    return { raffle: mapRowToRaffle(updatedRow), numbers };
  });

export const deleteUserRaffleForUser = async (
  userId: number,
  raffleId: number,
): Promise<void> => {
  await ensureUserRafflesTable();
  const db = getDb();
  const [rows] = await db.query<UserRaffleRow[]>(
    `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, raffleId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Rifa não encontrada.");
  }

  const [refreshedRow] = await releaseExpiredTicketsIfNeeded(userId, rows);
  const raffle = mapRowToRaffle(refreshedRow);
  if (raffle.soldCount > 0) {
    throw new Error("Não é possível excluir rifas que possuem números pagos.");
  }
  if (raffle.reservedCount > 0) {
    throw new Error("Libere as reservas ativas antes de excluir a rifa.");
  }

  await db.query(
    `DELETE FROM user_raffles WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, raffleId],
  );
};

export const releaseAllReservationsForRaffleForUser = async (
  userId: number,
  raffleId: number,
): Promise<UserRaffle | null> =>
  withTransaction(async (connection) => {
    const [rows] = await connection.query<UserRaffleRow[]>(
      `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? FOR UPDATE`,
      [userId, raffleId],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const raffle = mapRowToRaffle(row);
    let changed = false;

    raffle.tickets.forEach((ticket) => {
      if (ticket.status === "reserved") {
        ticket.status = "available";
        ticket.chargePublicId = null;
        ticket.customerName = null;
        ticket.customerWhatsapp = null;
        ticket.reservedAt = null;
        ticket.groupJid = null;
        changed = true;
      }
    });

    if (!changed) {
      return raffle;
    }

    const counts = computeTicketCounts(raffle.tickets);
    const nextStatus = resolveStatusFromCounts(raffle.status, counts, raffle.numbersTotal);
    const serializedTickets = serializeTickets(raffle.tickets);

    await connection.query(
      `
        UPDATE user_raffles
        SET tickets = ?,
            reserved_count = ?,
            sold_count = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        serializedTickets,
        counts.reservedCount,
        counts.soldCount,
        nextStatus,
        raffle.id,
        userId,
      ],
    );

    const updatedRow: UserRaffleRow = {
      ...row,
      tickets: serializedTickets,
      reserved_count: counts.reservedCount,
      sold_count: counts.soldCount,
      status: nextStatus,
    };

    return mapRowToRaffle(updatedRow);
  });

export const updateUserRaffleStatus = async (
  userId: number,
  raffleId: number,
  status: UserRaffleStatus,
): Promise<UserRaffle | null> => {
  const normalized = clampStatus(status);
  if (normalized === "completed") {
    const { raffle, winners } = await drawUserRaffle({
      userId,
      raffleId,
      executedBy: `user:${userId}`,
    });
    dispatchRaffleFinalization(userId, raffle, winners).catch((error) =>
      console.error("[raffles] Falha ao anunciar finalização da rifa", {
        userId,
        raffleId,
        error,
      }),
    );
    return raffle;
  }
  await ensureUserRafflesTable();
  const db = getDb();
  await db.query(
    `
      UPDATE user_raffles
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `,
    [normalized, userId, raffleId],
  );

  return getUserRaffleByIdForUser(userId, raffleId);
};

export const findActiveRaffleForGroup = async (
  userId: number,
  groupJid: string,
): Promise<UserRaffle | null> => {
  const normalized = normalizeJid(groupJid);

  await ensureUserRafflesTable();
  const db = getDb();
  const [rowsRaw] = await db.query<UserRaffleRow[]>(
    `
      SELECT *
      FROM user_raffles
      WHERE user_id = ?
        AND status IN ('active', 'selling')
      ORDER BY id DESC
    `,
    [userId],
  );

  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return null;
  }

  const rows = await releaseExpiredTicketsIfNeeded(userId, rowsRaw);

  for (const row of rows) {
    const raffle = mapRowToRaffle(row);
    if (raffle.groupJids.length === 0) {
      return raffle;
    }
    if (normalized && raffle.groupJids.some((jid) => normalizeJid(jid) === normalized)) {
      return raffle;
    }
    const lowered = groupJid ? groupJid.trim().toLowerCase() : "";
    if (lowered && raffle.groupJids.some((jid) => jid.trim().toLowerCase() === lowered)) {
      return raffle;
    }
  }

  return null;
};

export const findRaffleReadyForDraw = async (
  userId: number,
  groupJid: string,
): Promise<UserRaffle | null> => {
  const normalized = normalizeJid(groupJid);

  await ensureUserRafflesTable();
  const db = getDb();
  const [rowsRaw] = await db.query<UserRaffleRow[]>(
    `
      SELECT *
      FROM user_raffles
      WHERE user_id = ?
        AND status IN ('sold_out')
      ORDER BY id DESC
    `,
    [userId],
  );

  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return null;
  }

  const rows = await releaseExpiredTicketsIfNeeded(userId, rowsRaw);

  for (const row of rows) {
    const raffle = mapRowToRaffle(row);
    if (raffle.groupJids.length === 0) {
      return raffle;
    }
    if (normalized && raffle.groupJids.some((jid) => normalizeJid(jid) === normalized)) {
      return raffle;
    }
    const lowered = groupJid ? groupJid.trim().toLowerCase() : "";
    if (lowered && raffle.groupJids.some((jid) => jid.trim().toLowerCase() === lowered)) {
      return raffle;
    }
  }

  return null;
};

type DrawRafflePayload = {
  userId: number;
  raffleId: number;
  executedBy?: string | null;
};

export const drawUserRaffle = async (
  payload: DrawRafflePayload,
): Promise<{ raffle: UserRaffle; winners: UserRaffleWinner[] }> =>
  withTransaction(async (connection) => {
    const [rows] = await connection.query<UserRaffleRow[]>(
      `SELECT * FROM user_raffles WHERE user_id = ? AND id = ? FOR UPDATE`,
      [payload.userId, payload.raffleId],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Rifa não encontrada.");
    }

    const row = rows[0];
    const raffle = mapRowToRaffle(row);

    if (!ACTIVE_RAFFLE_STATUSES.includes(raffle.status)) {
      throw new Error("Esta rifa não está disponível para sorteio no momento.");
    }

    const paidTickets = raffle.tickets.filter((ticket) => ticket.status === "paid");
    if (paidTickets.length === 0) {
      throw new Error("Nenhum participante confirmado para sortear.");
    }

    const maxWinners = Math.min(Math.max(1, raffle.winnersCount), paidTickets.length);

    const pool = paidTickets.slice();
    const winners: UserRaffleWinner[] = [];
    const nowDate = new Date();
    const nowIso = nowDate.toISOString();

    for (let i = 0; i < maxWinners; i += 1) {
      const index = pool.length === 1 ? 0 : randomInt(pool.length);
      const ticket = pool.splice(index, 1)[0];
      winners.push({
        number: ticket.number,
        customerName: ticket.customerName ?? null,
        customerWhatsapp: ticket.customerWhatsapp ?? null,
        chargePublicId: ticket.chargePublicId ?? null,
        drawnAt: nowIso,
      });
    }

    const metadata = Array.isArray(raffle.metadata) || typeof raffle.metadata === "object"
      ? { ...(raffle.metadata ?? {}) }
      : {};

    (metadata as Record<string, unknown>).lastDraw = {
      executedAt: nowIso,
      executedBy: payload.executedBy ?? null,
      participants: paidTickets.length,
      winnersDrawn: winners.length,
    };

    await connection.query(
      `
        UPDATE user_raffles
        SET status = 'completed',
            winners = ?,
            drawn_at = ?,
            metadata = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [
        JSON.stringify(winners),
        nowDate,
        JSON.stringify(metadata),
        raffle.id,
        payload.userId,
      ],
    );

    const updatedRow: UserRaffleRow = {
      ...row,
      status: "completed",
      winners,
      metadata,
      drawn_at: nowDate,
    } as UserRaffleRow;

    const updated = mapRowToRaffle(updatedRow);
    return { raffle: updated, winners };
  });

export const buildRaffleWinnerAnnouncement = (
  raffle: Pick<UserRaffle, "title" | "price" | "numbersTotal" | "winnersCount">,
  winners: UserRaffleWinner[],
): { body: string; mentions: string[] } => {
  const lines: string[] = [];
  lines.push(`🎉 Resultado da rifa: *${raffle.title}*`);
  lines.push(`• Valor por número: ${formatCurrency(raffle.price)}`);
  lines.push(`• Total de números: ${raffle.numbersTotal}`);
  lines.push(`• Ganhador${raffle.winnersCount > 1 ? "es" : ""}:`);

  winners.forEach((winner, index) => {
    const position = index + 1;
    const name = winner.customerName?.trim();
    const numberLabel = `Número ${winner.number}`;
    const parts = [`${position}º prêmio — ${numberLabel}`];
    if (name) {
      parts.push(`(${name})`);
    }
    lines.push(parts.join(" "));
  });

  if (winners.length === 0) {
    lines.push("Nenhum participante elegível para sorteio.");
  }

  lines.push("", "Parabéns aos ganhadores e obrigado a todos que participaram! 🎟️");

  const mentions = winners
    .map((winner) => normalizeJid(winner.customerWhatsapp ?? ""))
    .filter((jid): jid is string => typeof jid === "string" && jid.length > 0);

  return { body: lines.join("\n"), mentions };
};
