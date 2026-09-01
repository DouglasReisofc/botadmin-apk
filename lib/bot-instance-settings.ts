import { ResultSetHeader, RowDataPacket } from "mysql2";

import type {
  BotInstanceAutoResponseCounters,
  BotInstanceCommandToggles,
  BotInstanceSettings,
} from "types/bot-instance-settings";
import type { BotAutoResponse } from "types/bot-auto-responses";
import {
  DEFAULT_STICKER_PACK_AUTHOR,
  DEFAULT_STICKER_PACK_NAME,
} from "lib/sticker";
import { ensureBotInstanceSettingsTable, getDb } from "./db";
import { normalizeAutoResponseEntry } from "./bot-group-settings";
import { canonicalizeCommandText } from "./commands/text";

const AUTO_RESPONSE_LIMIT = 50;
const MAX_STICKER_PACK_LENGTH = 128;
const MAX_STICKER_AUTHOR_LENGTH = 64;

export const DEFAULT_INSTANCE_COMMAND_TOGGLES: BotInstanceCommandToggles = {
  autoresposta: false,
  prefixoPv: false,
  pvCommandAllowlist: null,
  nativeButtons: false,
  recoverDeletedMessages: true,
  keepDeletedChatsInHistory: true,
  persistentMediaStorage: false,
  notifyOnlinePresence: false,
  onlinePresenceMonitorJids: null,
  stickerPack: DEFAULT_STICKER_PACK_NAME,
  stickerAuthor: DEFAULT_STICKER_PACK_AUTHOR,
};

const MAX_PV_COMMAND_ALLOWLIST = 200;
const MAX_ONLINE_PRESENCE_MONITOR_JIDS = 500;

export const normalizeInstanceStickerPack = (raw: unknown): string | null | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return DEFAULT_STICKER_PACK_NAME;
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    return undefined;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return DEFAULT_STICKER_PACK_NAME;
  }
  return trimmed.slice(0, MAX_STICKER_PACK_LENGTH);
};

export const normalizeInstanceStickerAuthor = (raw: unknown): string | null | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return DEFAULT_STICKER_PACK_AUTHOR;
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    return undefined;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return DEFAULT_STICKER_PACK_AUTHOR;
  }
  return trimmed.slice(0, MAX_STICKER_AUTHOR_LENGTH);
};

type InstanceSettingsRow = RowDataPacket & {
  instance_id: number;
  command_toggles: string | null;
  auto_responses: string | null;
  auto_response_counters: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

const parseTimestamp = (value: Date | string | null): string => {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
};

type InstanceToggleRow = RowDataPacket & {
  instance_id: number;
  command_toggles: string | null;
};

type InstanceIdRow = RowDataPacket & { id: number };

const normalizeBooleanInput = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return value !== 0;
    }
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return undefined;
    }
    if (["1", "true", "yes", "on", "sim"].includes(trimmed)) {
      return true;
    }
    if (["0", "false", "no", "off", "nao", "não"].includes(trimmed)) {
      return false;
    }
  }
  return undefined;
};

export const normalizeInstancePvCommandAllowlist = (
  raw: unknown,
): string[] | null | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }

  const entries: unknown[] | undefined = (() => {
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) {
        return [];
      }
      return trimmed.split(/[,;\s]+/);
    }
    if (typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      if (Array.isArray(record.value)) return record.value;
      if (Array.isArray(record.values)) return record.values;
      if (Array.isArray(record.commands)) return record.commands;
      if (Array.isArray(record.list)) return record.list;
      const truthyKeys = Object.entries(record)
        .filter(([, value]) => {
          const normalized = normalizeBooleanInput(value);
          if (normalized !== undefined) {
            return normalized;
          }
          return Boolean(value);
        })
        .map(([key]) => key);
      if (truthyKeys.length > 0) {
        return truthyKeys;
      }
      return [];
    }
    return undefined;
  })();

  if (entries === undefined) {
    return undefined;
  }

  const normalized = new Set<string>();
  for (const entry of entries) {
    const normalizedKey = canonicalizeCommandText(
      typeof entry === "string" || typeof entry === "number" ? String(entry) : "",
    );
    if (!normalizedKey) {
      continue;
    }
    normalized.add(normalizedKey);
    if (normalized.size >= MAX_PV_COMMAND_ALLOWLIST) {
      break;
    }
  }

  return Array.from(normalized);
};

const normalizePresenceMonitorJid = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("@")) {
    const [localPart, domainPart] = trimmed.split("@");
    const local = localPart.split(":")[0]?.replace(/[^\w.-]+/g, "") ?? "";
    const domain = domainPart?.replace(/[^\w.-]+/g, "") ?? "";
    return local && domain ? `${local}@${domain}` : null;
  }
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length < 5) {
    return null;
  }
  return `${digits}@s.whatsapp.net`;
};

export const normalizeInstanceOnlinePresenceMonitorJids = (
  raw: unknown,
): string[] | null | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }

  const entries: unknown[] | undefined = (() => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return trimmed.split(/[,;\s]+/);
    }
    if (typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      if (Array.isArray(record.value)) return record.value;
      if (Array.isArray(record.values)) return record.values;
      if (Array.isArray(record.jids)) return record.jids;
      if (Array.isArray(record.contacts)) return record.contacts;
      if (Array.isArray(record.list)) return record.list;
      return Object.entries(record)
        .filter(([, value]) => {
          const normalized = normalizeBooleanInput(value);
          return normalized !== undefined ? normalized : Boolean(value);
        })
        .map(([key]) => key);
    }
    return undefined;
  })();

  if (entries === undefined) {
    return undefined;
  }

  const normalized = new Set<string>();
  for (const entry of entries) {
    const jid =
      entry && typeof entry === "object"
        ? normalizePresenceMonitorJid(
            (entry as Record<string, unknown>).jid ??
              (entry as Record<string, unknown>).id ??
              (entry as Record<string, unknown>).phone ??
              (entry as Record<string, unknown>).phoneNumber,
          )
        : normalizePresenceMonitorJid(entry);
    if (!jid) {
      continue;
    }
    normalized.add(jid);
    if (normalized.size >= MAX_ONLINE_PRESENCE_MONITOR_JIDS) {
      break;
    }
  }

  return Array.from(normalized);
};

export const parseInstanceCommandToggles = (
  raw: unknown,
): BotInstanceCommandToggles => {
  const toggles: BotInstanceCommandToggles = { ...DEFAULT_INSTANCE_COMMAND_TOGGLES };
  if (!raw) {
    return toggles;
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return toggles;
  }

  const autorespostaValue = normalizeBooleanInput(
    (source as Record<string, unknown>).autoresposta,
  );
  if (autorespostaValue !== undefined) {
    toggles.autoresposta = autorespostaValue;
  }

  const prefixoPvValue = normalizeBooleanInput(
    (source as Record<string, unknown>).prefixoPv ??
      (source as Record<string, unknown>).prefixosPv ??
      (source as Record<string, unknown>).prefixCommandsPv ??
      (source as Record<string, unknown>).comandosPv ??
      (source as Record<string, unknown>).commandsPv ??
      (source as Record<string, unknown>).allowPrefixCommandsInPv,
  );
  if (prefixoPvValue !== undefined) {
    toggles.prefixoPv = prefixoPvValue;
  }

  const pvAllowlistValue = normalizeInstancePvCommandAllowlist(
    (source as Record<string, unknown>).pvCommandAllowlist ??
      (source as Record<string, unknown>).allowedPvCommands ??
      (source as Record<string, unknown>).pvCommands ??
      (source as Record<string, unknown>).prefixoPvAllowlist ??
      (source as Record<string, unknown>).allowedPrefixedCommands ??
      (source as Record<string, unknown>).pvCommandWhitelist ??
      (source as Record<string, unknown>).allowedCommandsPv,
  );
  if (pvAllowlistValue !== undefined) {
    toggles.pvCommandAllowlist = pvAllowlistValue;
  }

  const nativeButtonsValue = normalizeBooleanInput(
    (source as Record<string, unknown>).nativeButtons ??
      (source as Record<string, unknown>).nativebuttons ??
      (source as Record<string, unknown>).interactiveButtons ??
      (source as Record<string, unknown>).botButtons,
  );
  if (nativeButtonsValue !== undefined) {
    toggles.nativeButtons = nativeButtonsValue;
  }

  const recoverDeletedMessagesValue = normalizeBooleanInput(
    (source as Record<string, unknown>).recoverDeletedMessages ??
      (source as Record<string, unknown>).recoverDeleted ??
      (source as Record<string, unknown>).restoreDeletedMessages ??
      (source as Record<string, unknown>).recuperarApagadas ??
      (source as Record<string, unknown>).recuperarMensagensApagadas,
  );
  if (recoverDeletedMessagesValue !== undefined) {
    toggles.recoverDeletedMessages = recoverDeletedMessagesValue;
  }

  const keepDeletedChatsInHistoryValue = normalizeBooleanInput(
    (source as Record<string, unknown>).keepDeletedChatsInHistory ??
      (source as Record<string, unknown>).keepDeletedChats ??
      (source as Record<string, unknown>).dontDeleteHistoryOnChatDelete ??
      (source as Record<string, unknown>).manterChatsApagados ??
      (source as Record<string, unknown>).naoApagarHistoricoChats,
  );
  if (keepDeletedChatsInHistoryValue !== undefined) {
    toggles.keepDeletedChatsInHistory = keepDeletedChatsInHistoryValue;
  }

  const persistentMediaStorageValue = normalizeBooleanInput(
    (source as Record<string, unknown>).persistentMediaStorage ??
      (source as Record<string, unknown>).r2PersistentMedia ??
      (source as Record<string, unknown>).premiumMediaStorage ??
      (source as Record<string, unknown>).armazenamentoPersistente ??
      (source as Record<string, unknown>).midiaPersistente,
  );
  if (persistentMediaStorageValue !== undefined) {
    toggles.persistentMediaStorage = persistentMediaStorageValue;
  }

  const notifyOnlinePresenceValue = normalizeBooleanInput(
    (source as Record<string, unknown>).notifyOnlinePresence ??
      (source as Record<string, unknown>).onlinePresenceNotifications ??
      (source as Record<string, unknown>).presenceOnlineNotifications ??
      (source as Record<string, unknown>).avisarOnline ??
      (source as Record<string, unknown>).notificarOnline,
  );
  if (notifyOnlinePresenceValue !== undefined) {
    toggles.notifyOnlinePresence = notifyOnlinePresenceValue;
  }

  const onlinePresenceMonitorJidsValue = normalizeInstanceOnlinePresenceMonitorJids(
    (source as Record<string, unknown>).onlinePresenceMonitorJids ??
      (source as Record<string, unknown>).onlinePresenceContacts ??
      (source as Record<string, unknown>).presenceMonitorJids ??
      (source as Record<string, unknown>).presenceMonitorContacts ??
      (source as Record<string, unknown>).contatosMonitoradosOnline,
  );
  if (onlinePresenceMonitorJidsValue !== undefined) {
    toggles.onlinePresenceMonitorJids = onlinePresenceMonitorJidsValue;
  }

  const stickerPackValue = normalizeInstanceStickerPack(
    (source as Record<string, unknown>).stickerPack ??
      (source as Record<string, unknown>).sticker_pack ??
      (source as Record<string, unknown>).stickerPackName ??
      (source as Record<string, unknown>).packSticker,
  );
  if (stickerPackValue !== undefined) {
    toggles.stickerPack = stickerPackValue;
  }

  const stickerAuthorValue = normalizeInstanceStickerAuthor(
    (source as Record<string, unknown>).stickerAuthor ??
      (source as Record<string, unknown>).sticker_author ??
      (source as Record<string, unknown>).stickerPackAuthor ??
      (source as Record<string, unknown>).authorSticker,
  );
  if (stickerAuthorValue !== undefined) {
    toggles.stickerAuthor = stickerAuthorValue;
  }

  return toggles;
};

const sanitizeAutoResponses = (entries: BotAutoResponse[]): BotAutoResponse[] => {
  const sanitized: BotAutoResponse[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    const matchAny = entry.matchAnyMessage === true;
    const triggers = Array.isArray(entry.triggers)
      ? entry.triggers
          .map((trigger) => (typeof trigger === "string" ? trigger.trim() : ""))
          .filter((trigger, index, array) => trigger && array.indexOf(trigger) === index)
      : [];
    if (!matchAny && triggers.length === 0) {
      continue;
    }
    const hasPayload =
      (typeof entry.responseText === "string" && entry.responseText.trim().length > 0) ||
      Boolean(entry.responseMedia) ||
      Boolean(entry.responseVcard) ||
      Boolean(entry.responseButtons);
    if (!hasPayload) {
      continue;
    }
    const id = entry.id?.trim() || "";
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const limit =
      typeof entry.perContactLimit === "number" && Number.isFinite(entry.perContactLimit)
        ? Math.max(0, Math.floor(entry.perContactLimit))
        : null;
    sanitized.push({
      ...entry,
      matchAnyMessage: matchAny,
      triggers,
      perContactLimit: limit && limit > 0 ? limit : null,
      responseButtons: entry.responseButtons ?? null,
    });
    if (sanitized.length >= AUTO_RESPONSE_LIMIT) {
      break;
    }
  }

  return sanitized;
};

export const normalizeInstanceAutoResponsesInput = (
  raw: unknown,
): BotAutoResponse[] | undefined => {
  if (raw === undefined) {
    return undefined;
  }

  if (raw === null) {
    return [];
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!Array.isArray(source)) {
    return [];
  }

  const normalized = source
    .map((entry) =>
      entry && typeof entry === "object"
        ? normalizeAutoResponseEntry(entry as Record<string, unknown>)
        : null,
    )
    .filter((entry): entry is BotAutoResponse => Boolean(entry));

  return sanitizeAutoResponses(normalized);
};

const sanitizeAutoResponseCounters = (
  raw: unknown,
): BotInstanceAutoResponseCounters => {
  if (!raw) {
    return {};
  }

  const source =
    typeof raw === "string" && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!source || typeof source !== "object") {
    return {};
  }

  const result: BotInstanceAutoResponseCounters = {};
  const nowIso = new Date().toISOString();

  for (const [entryId, entryValue] of Object.entries(source)) {
    if (typeof entryId !== "string" || !entryId.trim()) {
      continue;
    }
    if (!entryValue || typeof entryValue !== "object") {
      continue;
    }
    const contacts: Record<string, { count: number; updatedAt: string }> = {};
    for (const [contactId, counterValue] of Object.entries(entryValue as Record<string, unknown>)) {
      if (typeof contactId !== "string" || !contactId.trim()) {
        continue;
      }
      let count = 0;
      let updatedAt = nowIso;
      if (typeof counterValue === "number") {
        if (Number.isFinite(counterValue)) {
          const normalized = Math.floor(counterValue);
          if (normalized > 0) {
            count = normalized;
            updatedAt = nowIso;
          }
        }
      } else if (counterValue && typeof counterValue === "object") {
        const candidateCount = Number(
          (counterValue as Record<string, unknown>).count ??
            (counterValue as Record<string, unknown>).total ??
            (counterValue as Record<string, unknown>).value ??
            0,
        );
        if (Number.isFinite(candidateCount)) {
          const normalized = Math.floor(candidateCount);
          if (normalized > 0) {
            count = normalized;
            const rawUpdated =
              (counterValue as Record<string, unknown>).updatedAt ??
              (counterValue as Record<string, unknown>).updated_at ??
              (counterValue as Record<string, unknown>).lastSent ??
              (counterValue as Record<string, unknown>).last_sent ??
              null;
            if (typeof rawUpdated === "string" && rawUpdated.trim()) {
              const parsed = new Date(rawUpdated);
              updatedAt = Number.isNaN(parsed.getTime()) ? nowIso : parsed.toISOString();
            }
          }
        }
      }
      if (count > 0) {
        contacts[contactId] = { count, updatedAt };
      }
    }
    if (Object.keys(contacts).length > 0) {
      result[entryId] = contacts;
    }
  }

  return result;
};

const mapSettingsRow = (row: InstanceSettingsRow): BotInstanceSettings => {
  const autoResponses = normalizeInstanceAutoResponsesInput(row.auto_responses) ?? [];
  const counters = sanitizeAutoResponseCounters(row.auto_response_counters);
  const filteredCounters: BotInstanceAutoResponseCounters = {};
  const allowedIds = new Set(autoResponses.map((entry) => entry.id));
  for (const [entryId, contactCounters] of Object.entries(counters)) {
    if (!allowedIds.has(entryId)) {
      continue;
    }
    filteredCounters[entryId] = contactCounters;
  }

  return {
    instanceId: Number(row.instance_id),
    commandToggles: parseInstanceCommandToggles(row.command_toggles),
    autoResponses,
    autoResponseCounters: filteredCounters,
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  };
};

export const getInstanceSettings = async (
  instanceId: number,
): Promise<BotInstanceSettings> => {
  await ensureBotInstanceSettingsTable();
  const db = getDb();

  const [rows] = await db.query<InstanceSettingsRow[]>(
    "SELECT instance_id, command_toggles, auto_responses, auto_response_counters, created_at, updated_at FROM bot_instance_settings WHERE instance_id = ? LIMIT 1",
    [instanceId],
  );

  if (Array.isArray(rows) && rows.length > 0) {
    return mapSettingsRow(rows[0]);
  }

  const commandToggles = { ...DEFAULT_INSTANCE_COMMAND_TOGGLES };
  const autoResponses: BotAutoResponse[] = [];

  await db
    .query<ResultSetHeader>(
      `
        INSERT INTO bot_instance_settings (instance_id, command_toggles, auto_responses, auto_response_counters, created_at, updated_at)
        VALUES (?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE updated_at = updated_at
      `,
      [instanceId, JSON.stringify(commandToggles), JSON.stringify(autoResponses), JSON.stringify({})],
    )
    .catch(() => {});

  const [retryRows] = await db.query<InstanceSettingsRow[]>(
    "SELECT instance_id, command_toggles, auto_responses, auto_response_counters, created_at, updated_at FROM bot_instance_settings WHERE instance_id = ? LIMIT 1",
    [instanceId],
  );

  if (Array.isArray(retryRows) && retryRows.length > 0) {
    return mapSettingsRow(retryRows[0]);
  }

  const now = new Date().toISOString();
  return {
    instanceId,
    commandToggles,
    autoResponses,
    autoResponseCounters: {},
    createdAt: now,
    updatedAt: now,
  };
};

export const upsertInstanceSettings = async (
  instanceId: number,
  updates: {
    commandToggles?: Partial<BotInstanceCommandToggles>;
    autoResponses?: BotAutoResponse[];
    autoResponseCounters?: BotInstanceAutoResponseCounters | null;
  },
): Promise<BotInstanceSettings> => {
  await ensureBotInstanceSettingsTable();
  const db = getDb();

  const current = await getInstanceSettings(instanceId);

  const mergedCommandToggles: BotInstanceCommandToggles = {
    ...current.commandToggles,
  };
  if (updates.commandToggles) {
    const autoresposta = normalizeBooleanInput(updates.commandToggles.autoresposta);
    if (autoresposta !== undefined) {
      mergedCommandToggles.autoresposta = autoresposta;
    }

    const prefixoPv = normalizeBooleanInput(
      updates.commandToggles.prefixoPv ??
        (updates.commandToggles as Record<string, unknown>).prefixosPv ??
        (updates.commandToggles as Record<string, unknown>).prefixCommandsPv ??
        (updates.commandToggles as Record<string, unknown>).comandosPv ??
        (updates.commandToggles as Record<string, unknown>).commandsPv ??
        (updates.commandToggles as Record<string, unknown>).allowPrefixCommandsInPv,
    );
    if (prefixoPv !== undefined) {
      mergedCommandToggles.prefixoPv = prefixoPv;
    }

    const pvAllowlist = normalizeInstancePvCommandAllowlist(
      updates.commandToggles.pvCommandAllowlist ??
        (updates.commandToggles as Record<string, unknown>).allowedPvCommands ??
        (updates.commandToggles as Record<string, unknown>).pvCommands ??
        (updates.commandToggles as Record<string, unknown>).prefixoPvAllowlist ??
        (updates.commandToggles as Record<string, unknown>).allowedPrefixedCommands ??
        (updates.commandToggles as Record<string, unknown>).pvCommandWhitelist ??
        (updates.commandToggles as Record<string, unknown>).allowedCommandsPv,
    );
    if (pvAllowlist !== undefined) {
      mergedCommandToggles.pvCommandAllowlist = pvAllowlist;
    }

    const nativeButtons = normalizeBooleanInput(
      updates.commandToggles.nativeButtons ??
        (updates.commandToggles as Record<string, unknown>).nativebuttons ??
        (updates.commandToggles as Record<string, unknown>).interactiveButtons ??
        (updates.commandToggles as Record<string, unknown>).botButtons,
    );
    if (nativeButtons !== undefined) {
      mergedCommandToggles.nativeButtons = nativeButtons;
    }

    const recoverDeletedMessages = normalizeBooleanInput(
      updates.commandToggles.recoverDeletedMessages ??
        (updates.commandToggles as Record<string, unknown>).recoverDeleted ??
        (updates.commandToggles as Record<string, unknown>).restoreDeletedMessages ??
        (updates.commandToggles as Record<string, unknown>).recuperarApagadas ??
        (updates.commandToggles as Record<string, unknown>).recuperarMensagensApagadas,
    );
    if (recoverDeletedMessages !== undefined) {
      mergedCommandToggles.recoverDeletedMessages = recoverDeletedMessages;
    }

    const keepDeletedChatsInHistory = normalizeBooleanInput(
      updates.commandToggles.keepDeletedChatsInHistory ??
        (updates.commandToggles as Record<string, unknown>).keepDeletedChats ??
        (updates.commandToggles as Record<string, unknown>).dontDeleteHistoryOnChatDelete ??
        (updates.commandToggles as Record<string, unknown>).manterChatsApagados ??
        (updates.commandToggles as Record<string, unknown>).naoApagarHistoricoChats,
    );
    if (keepDeletedChatsInHistory !== undefined) {
      mergedCommandToggles.keepDeletedChatsInHistory = keepDeletedChatsInHistory;
    }

    const persistentMediaStorage = normalizeBooleanInput(
      updates.commandToggles.persistentMediaStorage ??
        (updates.commandToggles as Record<string, unknown>).r2PersistentMedia ??
        (updates.commandToggles as Record<string, unknown>).premiumMediaStorage ??
        (updates.commandToggles as Record<string, unknown>).armazenamentoPersistente ??
        (updates.commandToggles as Record<string, unknown>).midiaPersistente,
    );
    if (persistentMediaStorage !== undefined) {
      mergedCommandToggles.persistentMediaStorage = persistentMediaStorage;
    }

    const notifyOnlinePresence = normalizeBooleanInput(
      updates.commandToggles.notifyOnlinePresence ??
        (updates.commandToggles as Record<string, unknown>).onlinePresenceNotifications ??
        (updates.commandToggles as Record<string, unknown>).presenceOnlineNotifications ??
        (updates.commandToggles as Record<string, unknown>).avisarOnline ??
        (updates.commandToggles as Record<string, unknown>).notificarOnline,
    );
    if (notifyOnlinePresence !== undefined) {
      mergedCommandToggles.notifyOnlinePresence = notifyOnlinePresence;
    }

    const onlinePresenceMonitorJids = normalizeInstanceOnlinePresenceMonitorJids(
      updates.commandToggles.onlinePresenceMonitorJids ??
        (updates.commandToggles as Record<string, unknown>).onlinePresenceContacts ??
        (updates.commandToggles as Record<string, unknown>).presenceMonitorJids ??
        (updates.commandToggles as Record<string, unknown>).presenceMonitorContacts ??
        (updates.commandToggles as Record<string, unknown>).contatosMonitoradosOnline,
    );
    if (onlinePresenceMonitorJids !== undefined) {
      mergedCommandToggles.onlinePresenceMonitorJids = onlinePresenceMonitorJids;
    }

    const stickerPack = normalizeInstanceStickerPack(
      updates.commandToggles.stickerPack ??
        (updates.commandToggles as Record<string, unknown>).sticker_pack ??
        (updates.commandToggles as Record<string, unknown>).stickerPackName,
    );
    if (stickerPack !== undefined) {
      mergedCommandToggles.stickerPack = stickerPack;
    }

    const stickerAuthor = normalizeInstanceStickerAuthor(
      updates.commandToggles.stickerAuthor ??
        (updates.commandToggles as Record<string, unknown>).sticker_author ??
        (updates.commandToggles as Record<string, unknown>).stickerPackAuthor,
    );
    if (stickerAuthor !== undefined) {
      mergedCommandToggles.stickerAuthor = stickerAuthor;
    }
  }

  const mergedAutoResponses =
    updates.autoResponses !== undefined
      ? sanitizeAutoResponses(
          updates.autoResponses.map((entry) => normalizeAutoResponseEntry(entry)),
        )
      : current.autoResponses;

  let mergedCounters: BotInstanceAutoResponseCounters = { ...current.autoResponseCounters };
  if (updates.autoResponseCounters !== undefined) {
    if (updates.autoResponseCounters === null) {
      mergedCounters = {};
    } else {
      const patch = sanitizeAutoResponseCounters(updates.autoResponseCounters);
      mergedCounters = { ...mergedCounters };
      for (const [entryId, contacts] of Object.entries(patch)) {
        mergedCounters[entryId] = {
          ...(mergedCounters[entryId] ?? {}),
          ...contacts,
        };
      }
    }
  }

  const allowedIds = new Set(mergedAutoResponses.map((entry) => entry.id));
  mergedCounters = Object.fromEntries(
    Object.entries(mergedCounters).filter(([entryId]) => allowedIds.has(entryId)),
  ) as BotInstanceAutoResponseCounters;
  mergedCounters = Object.fromEntries(
    Object.entries(mergedCounters).filter(([entryId]) => {
      const entry = mergedAutoResponses.find((item) => item.id === entryId);
      if (!entry) {
        return false;
      }
      const limit =
        typeof entry.perContactLimit === "number" && Number.isFinite(entry.perContactLimit)
          ? Math.floor(entry.perContactLimit)
          : 0;
      return limit > 0;
    }),
  ) as BotInstanceAutoResponseCounters;

  await db.query<ResultSetHeader>(
    `
      INSERT INTO bot_instance_settings (instance_id, command_toggles, auto_responses, auto_response_counters, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        command_toggles = VALUES(command_toggles),
        auto_responses = VALUES(auto_responses),
        auto_response_counters = VALUES(auto_response_counters),
        updated_at = NOW()
    `,
    [
      instanceId,
      JSON.stringify(mergedCommandToggles),
      JSON.stringify(mergedAutoResponses),
      JSON.stringify(mergedCounters),
    ],
  );

  const [rows] = await db.query<InstanceSettingsRow[]>(
    "SELECT instance_id, command_toggles, auto_responses, auto_response_counters, created_at, updated_at FROM bot_instance_settings WHERE instance_id = ? LIMIT 1",
    [instanceId],
  );

  if (Array.isArray(rows) && rows.length > 0) {
    return mapSettingsRow(rows[0]);
  }

  const now = new Date().toISOString();
  return {
    instanceId,
    commandToggles: mergedCommandToggles,
    autoResponses: mergedAutoResponses,
    autoResponseCounters: mergedCounters,
    createdAt: current.createdAt ?? now,
    updatedAt: now,
  };
};

const fetchAllInstanceIds = async (): Promise<number[]> => {
  const db = getDb();
  const [rows] = await db.query<InstanceIdRow[]>("SELECT id FROM bot_instances");
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
};

const normalizeToggleRecord = (value: string | null): BotInstanceCommandToggles =>
  parseInstanceCommandToggles(value ?? "{}");

const buildSqlInPlaceholders = (values: readonly unknown[]): string =>
  values.map(() => "?").join(",");

export const summarizeNativeButtonsToggle = async (): Promise<{
  totalInstances: number;
  enabledInstances: number;
}> => {
  await ensureBotInstanceSettingsTable();
  const db = getDb();
  const instanceIds = await fetchAllInstanceIds();
  if (instanceIds.length === 0) {
    return { totalInstances: 0, enabledInstances: 0 };
  }
  const placeholders = buildSqlInPlaceholders(instanceIds);
  const [rows] = await db.query<InstanceToggleRow[]>(
    `SELECT instance_id, command_toggles FROM bot_instance_settings WHERE instance_id IN (${placeholders})`,
    instanceIds,
  );
  const toggleMap = new Map<number, boolean>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const toggles = normalizeToggleRecord(row.command_toggles);
      toggleMap.set(Number(row.instance_id), Boolean(toggles.nativeButtons));
    }
  }
  let enabledInstances = 0;
  for (const id of instanceIds) {
    if (toggleMap.get(id)) {
      enabledInstances += 1;
    }
  }
  return { totalInstances: instanceIds.length, enabledInstances };
};

export const setNativeButtonsForAllInstances = async (
  enabled: boolean,
): Promise<{ totalInstances: number; updatedInstances: number }> => {
  await ensureBotInstanceSettingsTable();
  const db = getDb();
  const instanceIds = await fetchAllInstanceIds();
  if (instanceIds.length === 0) {
    return { totalInstances: 0, updatedInstances: 0 };
  }

  const placeholders = buildSqlInPlaceholders(instanceIds);
  const [rows] = await db.query<InstanceToggleRow[]>(
    `SELECT instance_id, command_toggles FROM bot_instance_settings WHERE instance_id IN (${placeholders})`,
    instanceIds,
  );
  const existingMap = new Map<number, BotInstanceCommandToggles>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      existingMap.set(Number(row.instance_id), normalizeToggleRecord(row.command_toggles));
    }
  }

  const desired = Boolean(enabled);
  let updated = 0;

  for (const [instanceId, toggles] of existingMap.entries()) {
    if (Boolean(toggles.nativeButtons) === desired) {
      continue;
    }
    const nextToggles = { ...toggles, nativeButtons: desired };
    await db.query(
      "UPDATE bot_instance_settings SET command_toggles = ?, updated_at = CURRENT_TIMESTAMP WHERE instance_id = ?",
      [JSON.stringify(nextToggles), instanceId],
    );
    updated += 1;
  }

  const missingIds = instanceIds.filter((id) => !existingMap.has(id));
  if (missingIds.length > 0) {
    const defaultToggles = { ...DEFAULT_INSTANCE_COMMAND_TOGGLES, nativeButtons: desired };
    const values: Array<number | string> = [];
    const placeholders: string[] = [];
    for (const id of missingIds) {
      placeholders.push("(?, ?, '[]', '{}', NOW(), NOW())");
      values.push(id, JSON.stringify(defaultToggles));
    }
    await db.query(
      `INSERT INTO bot_instance_settings (instance_id, command_toggles, auto_responses, auto_response_counters, created_at, updated_at)
       VALUES ${placeholders.join(",")}`,
      values,
    );
    updated += missingIds.length;
  }

  return { totalInstances: instanceIds.length, updatedInstances: updated };
};
