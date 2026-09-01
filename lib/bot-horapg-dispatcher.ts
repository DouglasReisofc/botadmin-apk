import { promises as fs } from "fs";
import path from "path";

import { getDb } from "lib/db";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import { invalidateGroupSettingsCache } from "lib/bot-events/cache";
import {
  generateHorapgSchedule,
  HORAPG_DEFAULT_IMAGE_URL,
  markHorapgDispatch,
  shouldDispatchHorapgAt,
} from "lib/bot-horapg";
import { ARCHIVE_UPLOAD_ROOT, UPLOADS_STORAGE_ROOT } from "lib/uploads";
import { sendMediaMessage, sendTextMessage, type WuzapiClient } from "lib/wuzapi";
import { resolveTimezonePreference } from "lib/timezones";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";
import { dispatchInternalGroupAutomationMessage } from "lib/internal-groups";

type HorapgDispatcherRow = {
  group_id: number;
  user_id: number;
  instance_id: number | null;
  remote_id: string;
  participants: string | null;
  base_url: string | null;
  token: string | null;
  session_status: string | null;
  internal_group_id: number | null;
  owner_timezone: string | null;
  owner_whatsapp: string | null;
};

const HORAPG_DISPATCH_INTERVAL_MS = 60_000;
const HORAPG_MAX_MENTION_COUNT = 32;

const globalRuntime = globalThis as typeof globalThis & {
  __horapgDispatcherStarted?: boolean;
};

let dispatcherStarted = globalRuntime.__horapgDispatcherStarted ?? false;
let cycleRunning = false;

const parseParticipantIds = (raw: unknown): string[] => {
  if (raw === null || raw === undefined) {
    return [];
  }

  const collectFromArray = (source: unknown[]): string[] => {
    const out: string[] = [];
    for (const entry of source) {
      if (typeof entry === "string" && entry.trim()) {
        out.push(entry.trim());
        continue;
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const candidate =
          (typeof record.id === "string" && record.id.trim()) ||
          (typeof record.Id === "string" && record.Id.trim()) ||
          (typeof record.ID === "string" && record.ID.trim()) ||
          (typeof record.jid === "string" && record.jid.trim()) ||
          (typeof record.JID === "string" && record.JID.trim()) ||
          (typeof record._serialized === "string" && record._serialized.trim()) ||
          (typeof record.phone === "string" && record.phone.trim()) ||
          (typeof record.Phone === "string" && record.Phone.trim()) ||
          (typeof record.Number === "string" && record.Number.trim()) ||
          (typeof record.participant === "string" && record.participant.trim());
        if (candidate) {
          out.push(candidate);
        }
      }
      if (out.length >= 256) {
        break;
      }
    }
    return out;
  };

  if (Array.isArray(raw)) {
    return collectFromArray(raw);
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    if (/^\[object\b/i.test(trimmed)) {
      return [];
    }
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? collectFromArray(parsed) : [];
    } catch {
      return [];
    }
  }

  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.participants)) {
      return collectFromArray(record.participants);
    }
    if (Array.isArray(record.data)) {
      return collectFromArray(record.data);
    }
  }

  return [];
};

const normalizeMentionDigits = (entries: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const digits = entry.replace(/@.+$/, "").replace(/\D+/g, "");
    if (!digits || digits.length < 5) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
    if (out.length >= HORAPG_MAX_MENTION_COUNT) {
      break;
    }
  }
  return out;
};

const joinMentionHandles = (digits: string[]): string =>
  digits.map((value) => `@${value}`).join(" ");

const resolveImageBuffer = async (relativePath: string): Promise<Buffer | null> => {
  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  const relative = normalized.startsWith("uploads/")
    ? normalized.slice("uploads/".length)
    : normalized;

  const candidates: string[] = [];

  if (UPLOADS_STORAGE_ROOT) {
    candidates.push(path.resolve(UPLOADS_STORAGE_ROOT, relative));
    if (!normalized.startsWith("uploads/")) {
      candidates.push(path.resolve(UPLOADS_STORAGE_ROOT, normalized));
    }
  }

  if (ARCHIVE_UPLOAD_ROOT) {
    candidates.push(path.resolve(ARCHIVE_UPLOAD_ROOT, relative));
    if (!normalized.startsWith("uploads/")) {
      candidates.push(path.resolve(ARCHIVE_UPLOAD_ROOT, normalized));
    }
  }

  const publicRoot = path.resolve(process.cwd(), "public");
  const publicCandidate = path.resolve(publicRoot, normalized);
  if (publicCandidate.startsWith(publicRoot)) {
    candidates.push(publicCandidate);
  }

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        console.warn("[HorapgDispatcher] Falha ao ler imagem", { candidate, error });
      }
    }
  }

  return null;
};

const buildMediaPayload = async (
  configImagePath: string | null,
  configImageUrl: string | null,
): Promise<{ media: Buffer | string; mimeType?: string } | null> => {
  if (configImagePath) {
    const buffer = await resolveImageBuffer(configImagePath);
    if (buffer) {
      const ext = path.extname(configImagePath).toLowerCase();
      const mimeType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : ext === ".bmp"
                ? "image/bmp"
                : "image/jpeg";
      return { media: buffer, mimeType };
    }
  }

  const urlCandidate =
    typeof configImageUrl === "string" && configImageUrl.trim().length > 0
      ? configImageUrl.trim()
      : HORAPG_DEFAULT_IMAGE_URL;

  return { media: urlCandidate };
};

const runHorapgDispatchCycle = async () => {
  if (cycleRunning) {
    return;
  }
  cycleRunning = true;
  try {
    const db = getDb();
    const [rows] = await db.query<HorapgDispatcherRow[]>(
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
          u.timezone AS owner_timezone,
          u.whatsapp_number AS owner_whatsapp
          ,ig.id AS internal_group_id
        FROM bot_groups g
        LEFT JOIN bot_instances i ON i.id = g.instance_id
        LEFT JOIN internal_groups ig ON ig.bot_group_id = g.id
        INNER JOIN users u ON u.id = g.user_id
        INNER JOIN bot_group_settings s ON s.group_id = g.id
        WHERE g.status = 'active'
          AND ((ig.id IS NOT NULL AND ig.is_active = 1 AND ig.bot_enabled = 1)
            OR i.session_status = 'conectado')
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.horapg_config, '$.enabled')), 'false') IN ('true', '1', 'TRUE')
      `,
    );

    const now = new Date();

    for (const row of rows) {
      const isInternal = Number(row.internal_group_id ?? 0) > 0;
      if (!row.remote_id || (!isInternal && (!row.base_url || !row.token))) {
        continue;
      }

      try {
        if (!isInternal) {
          const guard = await resolveBotAutomationGuard({
            userId: row.user_id,
            instanceId: row.instance_id!,
            groupId: row.group_id,
          });
          if (guard.blocked) continue;
        }

        const settings = await getGroupSettings(row.group_id);
        const config = settings.horapgConfig;
        if (!config.enabled || !config.times.length) {
          continue;
        }

        const effectiveTimezone = resolveTimezonePreference({
          preferred: [config.timezone, settings.scheduleConfig?.timezone],
          ownerTimezone: row.owner_timezone,
          ownerWhatsapp: row.owner_whatsapp,
        });

        const dispatchDecision = shouldDispatchHorapgAt(config, now, {
          timezone: effectiveTimezone,
        });
        if (!dispatchDecision.run) {
          continue;
        }

        const schedule = generateHorapgSchedule({
          baseDate: now,
          timezone: effectiveTimezone,
        });

        const participantDigits = normalizeMentionDigits(parseParticipantIds(row.participants));
        const mentionDigits = config.mentionAll ? participantDigits : [];
        const mentionLine = mentionDigits.length ? joinMentionHandles(mentionDigits) : "";
        const caption = mentionLine ? `${schedule.message}\n\n${mentionLine}` : schedule.message;

        const mediaPayload = isInternal
          ? null
          : await buildMediaPayload(config.imagePath, config.imageUrl);
        if (!isInternal && !mediaPayload) {
          console.warn("[HorapgDispatcher] Falha ao resolver mídia para envio", {
            groupId: row.group_id,
          });
          continue;
        }

        const client: WuzapiClient = { baseUrl: row.base_url ?? "", token: row.token ?? "" };

        try {
          if (isInternal) {
            const mediaRef = config.imagePath?.trim() || config.imageUrl?.trim() || HORAPG_DEFAULT_IMAGE_URL;
            await dispatchInternalGroupAutomationMessage(row.group_id, caption, {
              mediaType: "image",
              path: config.imagePath?.trim() || null,
              url: config.imagePath?.trim() ? null : mediaRef,
              mimeType: "image/jpeg",
              fileName: "horapg.jpg",
              caption: null,
            });
          } else if (typeof mediaPayload!.media === "string") {
            await sendMediaMessage(client, {
              to: row.remote_id,
              media: mediaPayload!.media,
              mediaType: "image",
              caption,
              mentions: mentionDigits,
            });
          } else {
            await sendMediaMessage(client, {
              to: row.remote_id,
              media: mediaPayload!.media,
              mediaType: "image",
              caption,
              mentions: mentionDigits,
              mimeType: mediaPayload!.mimeType,
            });
          }
        } catch (error) {
          console.error("[HorapgDispatcher] Falha ao enviar mensagem de horário pagante", {
            groupId: row.group_id,
            error,
          });
          try {
            if (isInternal) {
              await dispatchInternalGroupAutomationMessage(row.group_id, caption);
            } else {
              await sendTextMessage(client, {
                to: row.remote_id,
                body: caption,
                mentions: mentionDigits,
              });
            }
          } catch (sendError) {
            console.error("[HorapgDispatcher] Falha no fallback de texto do horapg", {
              groupId: row.group_id,
              error: sendError,
            });
            continue;
          }
        }

        const updatedConfig = markHorapgDispatch(
          config,
          dispatchDecision.clock,
          dispatchDecision.context,
        );
        await upsertGroupSettings(row.group_id, { horapgConfig: updatedConfig });
        invalidateGroupSettingsCache(row.group_id);
      } catch (error) {
        console.error("[HorapgDispatcher] Erro ao processar grupo", {
          groupId: row.group_id,
          error,
        });
      }
    }
  } catch (error) {
    console.error("[HorapgDispatcher] Falha ao executar ciclo", { error });
  } finally {
    cycleRunning = false;
  }
};

export const startHorapgDispatcher = () => {
  if (dispatcherStarted) {
    return;
  }
  dispatcherStarted = true;
  globalRuntime.__horapgDispatcherStarted = true;
  runHorapgDispatchCycle().catch((error) =>
    console.error("[HorapgDispatcher] Erro inicial", { error }),
  );
  setInterval(() => {
    runHorapgDispatchCycle().catch((error) =>
      console.error("[HorapgDispatcher] Erro no intervalo", { error }),
    );
  }, HORAPG_DISPATCH_INTERVAL_MS);
};
