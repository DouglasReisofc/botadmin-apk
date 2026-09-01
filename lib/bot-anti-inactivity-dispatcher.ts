import type { RowDataPacket } from "mysql2";

import { ensureBotGroupSettingsTable, getDb } from "lib/db";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import { invalidateGroupSettingsCache } from "lib/bot-events/cache";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import {
  deleteGroupRankingMembers,
  getGroupRankingHistoryCoverage,
  listInactiveGroupRankingMembers,
  seedGroupRankingMembers,
  syncGroupRankingFromMessageHistory,
} from "lib/group-ranking";
import {
  getGroupInfo,
  removeGroupParticipant,
  sendTextMessage,
  type WuzapiClient,
} from "lib/wuzapi";
import type { BotGroupAntiInactivityConfig, BotGroupParticipant } from "types/bot-groups";

type AntiInactivityDispatcherRow = RowDataPacket & {
  group_id: number;
  user_id: number;
  instance_id: number;
  remote_id: string;
  participants: string | null;
  base_url: string;
  token: string;
  session_status: string;
  instance_phone: string | null;
  anti_inactivity_config: string | null;
};

const DISPATCH_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_DAYS = 30;
const DEFAULT_SCAN_INTERVAL_HOURS = 24;
const DEFAULT_REMOVE_LIMIT = 20;
const MIN_HISTORY_MESSAGES = 20;
const MIN_HISTORY_OBSERVED_MEMBERS = 3;
const MIN_HISTORY_MEMBER_COVERAGE = 0.25;

export type AntiInactivityRunResult = {
  status: "completed" | "skipped" | "busy" | "unavailable" | "blocked" | "error";
  days: number;
  candidates: number;
  removed: number;
  failed: number;
  error?: string;
};

type ProcessGroupOptions = {
  force?: boolean;
  daysOverride?: number;
  announce?: boolean;
};

const runtime = globalThis as typeof globalThis & {
  __antiInactivityDispatcherStarted?: boolean;
  __antiInactivityDispatchInFlight?: Set<number>;
};

let dispatcherStarted = runtime.__antiInactivityDispatcherStarted ?? false;
let cycleRunning = false;
const antiInactivityDispatchInFlight =
  runtime.__antiInactivityDispatchInFlight ?? new Set<number>();
runtime.__antiInactivityDispatchInFlight = antiInactivityDispatchInFlight;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeDigits = (value: string | null | undefined): string =>
  String(value ?? "").replace(/\D+/g, "");

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
};

const getInsufficientHistoryReason = (
  coverage: {
    membersWithMessages: number;
    messageCount: number;
    firstMessageAt: Date | null;
  },
  currentMemberCount: number,
  days: number,
  now: Date,
): string | null => {
  const minimumMembers = Math.min(
    currentMemberCount,
    Math.max(MIN_HISTORY_OBSERVED_MEMBERS, Math.ceil(currentMemberCount * MIN_HISTORY_MEMBER_COVERAGE)),
  );
  if (coverage.messageCount < MIN_HISTORY_MESSAGES) {
    return `Histórico insuficiente: são necessárias pelo menos ${MIN_HISTORY_MESSAGES} mensagens registradas antes de remover inativos.`;
  }
  if (coverage.membersWithMessages < minimumMembers) {
    return `Histórico insuficiente: somente ${coverage.membersWithMessages} membro(s) possuem atividade registrada; são necessários ${minimumMembers}.`;
  }
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  if (!coverage.firstMessageAt || coverage.firstMessageAt.getTime() > cutoff) {
    return `Histórico insuficiente: a atividade registrada ainda não cobre os últimos ${days} dia(s).`;
  }
  return null;
};

const parseJson = (value: unknown): unknown => {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const parseParticipants = (value: unknown): BotGroupParticipant[] => {
  const source = parseJson(value);
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const rawId =
        record.id ??
        record.jid ??
        record.JID ??
        record.PhoneNumber ??
        record.phone ??
        record.Phone ??
        record.Number;
      if (typeof rawId !== "string" || !rawId.trim()) {
        return null;
      }
      const rawAdmin =
        record.admin ??
        record.role ??
        record.Role ??
        record.Admin ??
        (record.isAdmin === true ? "admin" : null) ??
        (record.IsAdmin === true ? "admin" : null);
      const normalizedAdmin = String(rawAdmin ?? "").toLowerCase().trim();
      const admin: BotGroupParticipant["admin"] =
        normalizedAdmin === "superadmin"
          ? "superadmin"
          : normalizedAdmin === "admin"
            ? "admin"
            : normalizedAdmin
              ? "member"
              : "admin";
      return { id: rawId.trim(), admin };
    })
    .filter((entry): entry is BotGroupParticipant => Boolean(entry));
};

const extractParticipantArray = (value: unknown): unknown[] | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = record.participants ?? record.Participants ?? record.members ?? record.Members;
  if (Array.isArray(direct)) {
    return direct;
  }
  for (const child of [record.data, record.Data, record.group, record.Group]) {
    if (child && typeof child === "object") {
      const nested = extractParticipantArray(child);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};

const loadParticipants = async (
  client: WuzapiClient,
  groupJid: string,
  storedParticipants: string | null,
): Promise<BotGroupParticipant[]> => {
  const stored = parseParticipants(storedParticipants);
  try {
    const info = await getGroupInfo(client, groupJid);
    const participants = extractParticipantArray(info);
    const current = parseParticipants(participants ?? []);
    if (current.length > 0) {
      return current;
    }
  } catch (error) {
    console.warn("[AntiInactivityDispatcher] Não foi possível carregar participantes atuais", {
      groupJid,
      error,
    });
  }
  return stored;
};

const shouldRunNow = (config: BotGroupAntiInactivityConfig, now: Date): boolean => {
  if (!config.enabled) {
    return false;
  }
  const intervalHours = clampInt(
    config.scanIntervalHours,
    DEFAULT_SCAN_INTERVAL_HOURS,
    1,
    168,
  );
  if (!config.lastRunAt) {
    return true;
  }
  const lastRun = new Date(config.lastRunAt);
  if (Number.isNaN(lastRun.getTime())) {
    return true;
  }
  return now.getTime() - lastRun.getTime() >= intervalHours * 60 * 60 * 1000;
};

const persistAntiInactivityConfig = async (
  groupId: number,
  antiInactivityConfig: Partial<BotGroupAntiInactivityConfig>,
) => {
  await upsertGroupSettings(groupId, {
    antiInactivityConfig: antiInactivityConfig as BotGroupAntiInactivityConfig,
  });
  invalidateGroupSettingsCache(groupId);
};

const processGroup = async (
  row: AntiInactivityDispatcherRow,
  now: Date,
  options: ProcessGroupOptions = {},
): Promise<AntiInactivityRunResult> => {
  const fallbackDays = clampInt(options.daysOverride, DEFAULT_DAYS, 1, 365);
  const emptyResult = (
    status: AntiInactivityRunResult["status"],
    error?: string,
  ): AntiInactivityRunResult => ({
    status,
    days: fallbackDays,
    candidates: 0,
    removed: 0,
    failed: 0,
    ...(error ? { error } : {}),
  });
  if (!row.remote_id || !row.base_url || !row.token) {
    return emptyResult("unavailable", "Instância ou grupo sem conexão disponível.");
  }
  if (antiInactivityDispatchInFlight.has(row.group_id)) {
    return emptyResult("busy", "Já existe uma remoção de inativos em andamento neste grupo.");
  }

  antiInactivityDispatchInFlight.add(row.group_id);
  try {
    const guard = await resolveBotAutomationGuard({
      userId: row.user_id,
      instanceId: row.instance_id,
      groupId: row.group_id,
    });
    if (guard.blocked) {
      return emptyResult("blocked", "A automação está bloqueada pela assinatura do perfil.");
    }

    const settings = await getGroupSettings(row.group_id);
    const config = settings.antiInactivityConfig;
    if (!options.force && (!config?.enabled || !shouldRunNow(config, now))) {
      return emptyResult("skipped");
    }

    const days = clampInt(options.daysOverride ?? config?.days, DEFAULT_DAYS, 1, 365);
    const removeLimit = clampInt(config?.removeLimit, DEFAULT_REMOVE_LIMIT, 1, 100);
    const client: WuzapiClient = { baseUrl: row.base_url, token: row.token };
    const participants = await loadParticipants(client, row.remote_id, row.participants);
    if (participants.length === 0) {
      await persistAntiInactivityConfig(row.group_id, {
        lastRunAt: now.toISOString(),
        lastRemovedCount: 0,
        lastError: "Lista atual de participantes indisponível.",
      });
      return {
        ...emptyResult("unavailable", "Lista atual de participantes indisponível."),
        days,
      };
    }

    const participantByDigits = new Map<string, BotGroupParticipant>();
    for (const participant of participants) {
      const digits = normalizeDigits(participant.id);
      if (digits) {
        participantByDigits.set(digits, participant);
      }
    }

    const botPhoneDigits = normalizeDigits(row.instance_phone);
    const memberParticipants = participants.filter(
      (participant) =>
        participant.admin === "member" && normalizeDigits(participant.id) !== botPhoneDigits,
    );
    await syncGroupRankingFromMessageHistory(row.group_id, { force: true });
    await seedGroupRankingMembers(
      row.group_id,
      memberParticipants.map((participant) => participant.id),
      now,
    );
    const historyCoverage = await getGroupRankingHistoryCoverage(
      row.group_id,
      memberParticipants.map((participant) => participant.id),
    );
    const insufficientHistoryReason = getInsufficientHistoryReason(
      historyCoverage,
      memberParticipants.length,
      days,
      now,
    );
    if (insufficientHistoryReason) {
      console.warn("[AntiInactivityDispatcher] Remoção bloqueada por histórico insuficiente", {
        groupId: row.group_id,
        days,
        participants: memberParticipants.length,
        ...historyCoverage,
      });
      await persistAntiInactivityConfig(row.group_id, {
        lastRunAt: now.toISOString(),
        lastRemovedCount: 0,
        lastError: insufficientHistoryReason,
      });
      return { ...emptyResult("skipped", insufficientHistoryReason), days };
    }
    const rankingCandidates = await listInactiveGroupRankingMembers(row.group_id, days, removeLimit * 2);
    const candidates = rankingCandidates
      .map((entry) => {
        const digits = normalizeDigits(entry.memberJid);
        const participant = participantByDigits.get(digits);
        return { ...entry, digits, participant };
      })
      .filter((entry) => {
        if (!entry.digits || entry.digits.length < 5) return false;
        if (!entry.participant) return false;
        if (entry.participant.admin !== "member") return false;
        if (botPhoneDigits && entry.digits === botPhoneDigits) return false;
        if (!Number.isFinite(entry.score) || entry.score <= 0) return false;
        if (!(entry.firstMessageAt instanceof Date) || Number.isNaN(entry.firstMessageAt.getTime())) return false;
        if (!(entry.lastMessageAt instanceof Date) || Number.isNaN(entry.lastMessageAt.getTime())) return false;
        return true;
      })
      .slice(0, removeLimit);

    const removedMembers: string[] = [];
    let failedCount = 0;
    for (const candidate of candidates) {
      try {
        await removeGroupParticipant(client, {
          groupJid: row.remote_id,
          participant: candidate.digits,
        });
        removedMembers.push(candidate.digits);
        await sleep(750);
      } catch (error) {
        failedCount += 1;
        console.error("[AntiInactivityDispatcher] Falha ao remover participante inativo", {
          groupId: row.group_id,
          participant: candidate.digits,
          error,
        });
      }
    }

    if (removedMembers.length > 0) {
      await deleteGroupRankingMembers(row.group_id, removedMembers);
      if (options.announce !== false) {
        try {
          await sendTextMessage(client, {
            to: row.remote_id,
            body: `🧊 AntiAFK executado: ${removedMembers.length} participante(s) sem falar há ${days}+ dias foram removidos. Administradores foram preservados.`,
          });
        } catch (error) {
          console.warn("[AntiInactivityDispatcher] Falha ao avisar grupo sobre remoções", {
            groupId: row.group_id,
            error,
          });
        }
      }
    }

    await persistAntiInactivityConfig(row.group_id, {
      lastRunAt: now.toISOString(),
      lastRemovedCount: removedMembers.length,
      lastError: null,
    });
    return {
      status: "completed",
      days,
      candidates: candidates.length,
      removed: removedMembers.length,
      failed: failedCount,
    };
  } catch (error) {
    console.error("[AntiInactivityDispatcher] Erro ao processar grupo", {
      groupId: row.group_id,
      error,
    });
    await persistAntiInactivityConfig(row.group_id, {
      lastRunAt: now.toISOString(),
      lastRemovedCount: 0,
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido.",
    });
    return emptyResult(
      "error",
      error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido.",
    );
  } finally {
    antiInactivityDispatchInFlight.delete(row.group_id);
  }
};

export const runAntiInactivityNow = async (
  groupId: number,
  days: number,
): Promise<AntiInactivityRunResult> => {
  const safeDays = clampInt(days, DEFAULT_DAYS, 1, 365);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return {
      status: "unavailable",
      days: safeDays,
      candidates: 0,
      removed: 0,
      failed: 0,
      error: "Grupo inválido.",
    };
  }
  await ensureBotGroupSettingsTable();
  const db = getDb();
  const [rows] = await db.query<AntiInactivityDispatcherRow[]>(
    `
      SELECT
        g.id AS group_id,
        g.user_id,
        g.instance_id,
        g.remote_id,
        g.participants,
        i.base_url,
        i.token,
        i.session_status,
        i.phone AS instance_phone,
        s.anti_inactivity_config
      FROM bot_groups g
      INNER JOIN bot_instances i ON i.id = g.instance_id
      LEFT JOIN bot_group_settings s ON s.group_id = g.id
      WHERE g.id = ? AND g.status = 'active'
      LIMIT 1
    `,
    [groupId],
  );
  const row = rows?.[0];
  if (!row || row.session_status !== "conectado") {
    return {
      status: "unavailable",
      days: safeDays,
      candidates: 0,
      removed: 0,
      failed: 0,
      error: "A instância do WhatsApp não está conectada.",
    };
  }
  return await processGroup(row, new Date(), {
    force: true,
    daysOverride: safeDays,
    announce: false,
  });
};

const runAntiInactivityDispatchCycle = async () => {
  if (cycleRunning) {
    return;
  }
  cycleRunning = true;
  try {
    await ensureBotGroupSettingsTable();
    const db = getDb();
    const [rows] = await db.query<AntiInactivityDispatcherRow[]>(
      `
        SELECT
          g.id AS group_id,
          g.user_id,
          g.instance_id,
          g.remote_id,
          g.participants,
          i.base_url,
          i.token,
          i.session_status,
          i.phone AS instance_phone,
          s.anti_inactivity_config
        FROM bot_groups g
        INNER JOIN bot_instances i ON i.id = g.instance_id
        INNER JOIN bot_group_settings s ON s.group_id = g.id
        WHERE g.status = 'active'
          AND i.session_status = 'conectado'
          AND s.anti_inactivity_config IS NOT NULL
      `,
    );

    const now = new Date();
    for (const row of rows) {
      await processGroup(row, now);
    }
  } catch (error) {
    console.error("[AntiInactivityDispatcher] Falha no ciclo", { error });
  } finally {
    cycleRunning = false;
  }
};

export const startAntiInactivityDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  runtime.__antiInactivityDispatcherStarted = true;
  runAntiInactivityDispatchCycle().catch((error) =>
    console.error("[AntiInactivityDispatcher] Erro inicial", { error }),
  );
  setInterval(() => {
    runAntiInactivityDispatchCycle().catch((error) =>
      console.error("[AntiInactivityDispatcher] Erro no intervalo", { error }),
    );
  }, DISPATCH_INTERVAL_MS);
};
