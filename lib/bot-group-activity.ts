import { promises as fs } from "fs";
import path from "path";

export type BotGroupActivityEntry = {
  id: string;
  timestamp: string;
  reason: string;
  action: string;
  groupId?: string | number;
  groupRemoteId?: string | null;
  groupName?: string | null;
  participant?: string | null;
  pushName?: string | null;
  messageId?: string | null;
  messageText?: string | null;
  links?: string[];
  allowedLinks?: string[];
  remainingInfractions?: number;
  instanceId?: string | number;
  instanceName?: string | null;
  evidenceUrl?: string | null;
  evidenceKind?: string | null;
  nsfw?: {
    porn: number;
    hentai: number;
    sexy: number;
    total: number;
    dominant?: "porn" | "hentai" | "sexy";
    dominantScore?: number;
  } | null;
};

const MODERATION_LOG_PATH = path.join(process.cwd(), "logs", "moderation-actions.log");
const MAX_SCAN_LINES = 5000;
const ensureModerationLogDir = async () => {
  try {
    await fs.mkdir(path.dirname(MODERATION_LOG_PATH), { recursive: true });
  } catch {
    // ignore
  }
};

const toArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter((item) => item.length > 0);
};

const normalizeScore = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
};

const parseNsfwFromMessageText = (messageText: string | null): BotGroupActivityEntry["nsfw"] => {
  if (!messageText) return null;
  const match = messageText.match(/NSFW\[([^\]]+)\]/i);
  if (!match?.[1]) return null;
  const map: Record<string, number> = {};
  for (const piece of match[1].split(",")) {
    const [keyRaw, valueRaw] = piece.split("=").map((entry) => entry.trim());
    if (!keyRaw) continue;
    map[keyRaw.toLowerCase()] = normalizeScore(valueRaw);
  }
  const porn = map.porn ?? 0;
  const hentai = map.hentai ?? 0;
  const sexy = map.sexy ?? 0;
  const total = map.total ?? map.nsfw ?? 0;
  const ranked = [
    ["porn", porn],
    ["hentai", hentai],
    ["sexy", sexy],
  ] as const;
  ranked.sort((left, right) => right[1] - left[1]);
  return {
    porn,
    hentai,
    sexy,
    total,
    dominant: ranked[0]?.[0] ?? "porn",
    dominantScore: ranked[0]?.[1] ?? 0,
  };
};

const parseLine = (line: string): BotGroupActivityEntry | null => {
  if (!line.trim()) return null;
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    const timestamp =
      typeof json.ts === "string" && json.ts.trim().length > 0
        ? json.ts
        : new Date().toISOString();
    const reason =
      typeof json.reason === "string" && json.reason.trim().length > 0
        ? json.reason.trim()
        : "unknown";
    const action =
      typeof json.action === "string" && json.action.trim().length > 0
        ? json.action.trim()
        : "info";
    const participant = typeof json.participant === "string" ? json.participant : null;
    const pushName = typeof json.pushName === "string" ? json.pushName : null;
    const messageId = typeof json.messageId === "string" ? json.messageId : null;
    const messageText = typeof json.messageText === "string" ? json.messageText : null;
    const remainingInfractions =
      typeof json.remainingInfractions === "number"
        ? json.remainingInfractions
        : undefined;
    const groupRemoteId =
      typeof json.groupRemoteId === "string" ? json.groupRemoteId : null;
    const groupName = typeof json.groupName === "string" ? json.groupName : null;
    const groupId =
      typeof json.groupId === "string" || typeof json.groupId === "number"
        ? json.groupId
        : undefined;
    const instanceId =
      typeof json.instanceId === "string" || typeof json.instanceId === "number"
        ? json.instanceId
        : undefined;
    const instanceName =
      typeof json.instanceName === "string" ? json.instanceName : null;
    const evidenceUrlRaw =
      typeof json.evidenceUrl === "string" ? json.evidenceUrl.trim() : "";
    const evidenceKind =
      typeof json.evidenceKind === "string" && json.evidenceKind.trim().length > 0
        ? json.evidenceKind.trim().toLowerCase()
        : null;
    const rawNsfw = json.nsfw;
    let nsfw: BotGroupActivityEntry["nsfw"] = null;
    if (rawNsfw && typeof rawNsfw === "object") {
      const record = rawNsfw as Record<string, unknown>;
      const porn = normalizeScore(record.porn);
      const hentai = normalizeScore(record.hentai);
      const sexy = normalizeScore(record.sexy);
      const total = normalizeScore(record.total ?? record.nsfw);
      const dominantRaw = typeof record.dominant === "string" ? record.dominant.trim().toLowerCase() : "";
      const ranked = [
        ["porn", porn],
        ["hentai", hentai],
        ["sexy", sexy],
      ] as const;
      ranked.sort((left, right) => right[1] - left[1]);
      const dominant =
        dominantRaw === "porn" || dominantRaw === "hentai" || dominantRaw === "sexy"
          ? dominantRaw
          : ranked[0]?.[0] ?? "porn";
      nsfw = {
        porn,
        hentai,
        sexy,
        total,
        dominant,
        dominantScore: normalizeScore(record.dominantScore ?? record[dominant]),
      };
    } else {
      nsfw = parseNsfwFromMessageText(messageText);
    }

    const links = toArray(json.links);
    const allowedLinks = toArray(json.allowedLinks);
    const fallbackEvidenceUrl =
      evidenceUrlRaw ||
      (reason === "media" && links.length > 0 ? links[0] : "");
    const evidenceUrl = fallbackEvidenceUrl || null;

    const suffix = messageId ?? `${participant ?? "anon"}-${action}-${reason}`;
    return {
      id: `${timestamp}-${suffix}`,
      timestamp,
      reason,
      action,
      groupId,
      groupRemoteId,
      groupName,
      participant,
      pushName,
      messageId,
      messageText,
      links,
      allowedLinks,
      remainingInfractions,
      instanceId,
      instanceName,
      evidenceUrl,
      evidenceKind,
      nsfw,
    };
  } catch {
    return null;
  }
};

export const listGroupActivityEntries = async ({
  groupId,
  groupRemoteId,
  limit = 80,
}: {
  groupId: number;
  groupRemoteId?: string | null;
  limit?: number;
}): Promise<BotGroupActivityEntry[]> => {
  const maxItems = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 300) : 80;

  let content: string;
  try {
    content = await fs.readFile(MODERATION_LOG_PATH, "utf8");
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const result: BotGroupActivityEntry[] = [];
  const groupIdStr = String(groupId);
  const groupRemote = groupRemoteId?.trim() ?? "";
  let scanned = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (scanned >= MAX_SCAN_LINES || result.length >= maxItems) {
      break;
    }
    scanned += 1;
    const entry = parseLine(lines[index] ?? "");
    if (!entry) continue;

    const entryGroupId = entry.groupId !== undefined ? String(entry.groupId) : "";
    const entryRemoteId = entry.groupRemoteId?.trim() ?? "";
    const matched = entryGroupId === groupIdStr || (groupRemote.length > 0 && entryRemoteId === groupRemote);
    if (!matched) continue;

    result.push(entry);
  }

  return result;
};

export const clearGroupActivityEntries = async ({
  groupId,
  groupRemoteId,
}: {
  groupId: number;
  groupRemoteId?: string | null;
}): Promise<number> => {
  const groupIdStr = String(groupId);
  const groupRemote = groupRemoteId?.trim() ?? "";

  let content: string;
  try {
    content = await fs.readFile(MODERATION_LOG_PATH, "utf8");
  } catch {
    return 0;
  }

  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let removed = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (!entry) {
      kept.push(line);
      continue;
    }
    const entryGroupId = entry.groupId !== undefined ? String(entry.groupId) : "";
    const entryRemoteId = entry.groupRemoteId?.trim() ?? "";
    const matched =
      entryGroupId === groupIdStr ||
      (groupRemote.length > 0 && entryRemoteId === groupRemote);
    if (matched) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }

  if (removed === 0) {
    return 0;
  }

  await ensureModerationLogDir();
  await fs.writeFile(MODERATION_LOG_PATH, `${kept.join("\n")}\n`, "utf8");
  return removed;
};
