import type { RowDataPacket } from "mysql2/promise";

import { ensureBotInstanceTable, ensureBotServerTable, ensureUserTable, getDb } from "lib/db";
import { saveBufferAsUploadedFile } from "lib/uploads";
import { updateUserProfile } from "lib/users";
import { getUserAvatar, sendTextMessage, type WuzapiClient } from "lib/wuzapi";

type OperationalInstanceRow = RowDataPacket & {
  instance_id: number;
  user_id: number;
  instance_name: string | null;
  instance_phone: string | null;
  token: string;
  server_base_url: string;
  purpose: string | null;
};

const isNoSessionError = (value: unknown) => {
  const message = String(value ?? "").toLowerCase();
  return message.includes("no session") || message.includes("session not found") || message.includes("not logged");
};

const isOperationalSessionLive = async (row: OperationalInstanceRow): Promise<boolean> => {
  const response = await fetch(`${row.server_base_url.replace(/\/+$/, "")}/session/status`, {
    headers: {
      accept: "application/json",
      token: row.token,
    },
    cache: "no-store",
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = await response.text().catch(() => null);
  }

  if (response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
    const loggedIn = data.LoggedIn ?? data.loggedIn ?? data.connected ?? data.Connected;
    return loggedIn !== false;
  }

  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (isNoSessionError(record.error) || isNoSessionError(record.message) || isNoSessionError(payload)) {
    return false;
  }
  throw new Error(`Falha ao validar instância operacional (${response.status}).`);
};

export type AdminOperationalClient = WuzapiClient & {
  instanceId: number;
  purpose: "admin_system";
};

export const getAdminOperationalWuzapiClient = async (): Promise<AdminOperationalClient | null> => {
  await Promise.all([ensureUserTable(), ensureBotServerTable(), ensureBotInstanceTable()]);
  const db = getDb();
  const [rows] = await db.query<OperationalInstanceRow[]>(
    `
      SELECT
        bi.id AS instance_id,
        bi.user_id,
        bi.name AS instance_name,
        bi.phone AS instance_phone,
        bi.token,
        bs.base_url AS server_base_url,
        bi.purpose
      FROM bot_instances bi
      INNER JOIN bot_servers bs ON bs.id = bi.server_id
      INNER JOIN users u ON u.id = bi.user_id
      WHERE bi.purpose = 'admin_system'
        AND u.role IN ('admin', 'administrator', 'administrador', 'superadmin', 'super-admin', 'super_admin')
        AND bi.session_status = 'conectado'
        AND bi.token IS NOT NULL
        AND bi.token <> ''
        AND bs.is_active = 1
      ORDER BY
        bi.updated_at DESC,
        bi.id DESC
      LIMIT 10
    `,
  );

  const candidates = Array.isArray(rows) ? rows : [];
  let row: OperationalInstanceRow | null = null;
  for (const candidate of candidates) {
    const live = await isOperationalSessionLive(candidate).catch((error) => {
      console.warn("[admin-operational] falha ao validar sessão", {
        instanceId: candidate.instance_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    });
    if (live) {
      row = candidate;
      break;
    }
    await db.query(
      "UPDATE bot_instances SET session_status = 'desconectado', last_status_sync = NOW() WHERE id = ?",
      [candidate.instance_id],
    ).catch(() => undefined);
  }
  if (!row) return null;

  return {
    baseUrl: row.server_base_url,
    token: row.token,
    instanceId: Number(row.instance_id),
    purpose: "admin_system",
    conversation: {
      userId: Number(row.user_id),
      instanceId: Number(row.instance_id),
      instanceName: row.instance_name ?? "BotAdmin",
      instancePhone: row.instance_phone ?? null,
    },
  };
};

export const requireAdminOperationalWuzapiClient = async (): Promise<AdminOperationalClient> => {
  const client = await getAdminOperationalWuzapiClient();
  if (!client) {
    throw new Error("A instância operacional do painel admin não está conectada.");
  }
  return client;
};

export const sendAdminOperationalText = async (params: {
  toDigits: string | null | undefined;
  body: string;
}): Promise<boolean> => {
  const toDigits = (params.toDigits || "").replace(/\D+/g, "");
  if (!toDigits || !params.body.trim()) return false;
  const client = await getAdminOperationalWuzapiClient();
  if (!client) return false;
  await sendTextMessage(client, {
    to: `${toDigits}@s.whatsapp.net`,
    body: params.body,
  });
  return true;
};

export const getAdminOperationalUserAvatarUrl = async (
  phoneOrJid: string | null | undefined,
): Promise<string | null> => {
  const raw = (phoneOrJid || "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  const contact = raw.includes("@") ? raw : digits ? `${digits}@s.whatsapp.net` : raw;
  const client = await getAdminOperationalWuzapiClient();
  if (!client) return null;
  const avatar = await getUserAvatar(client, { contact, preview: false }).catch(() => null);
  return avatar?.dataUrl || avatar?.url || null;
};

const extensionFromMime = (mimeType: string | null | undefined) => {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.includes("png")) return ".png";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("gif")) return ".gif";
  return ".jpg";
};

const bufferFromAvatarSource = async (
  source: string,
): Promise<{ buffer: Buffer; mimeType: string | null } | null> => {
  const trimmed = source.trim();
  if (!trimmed) return null;

  const dataUrlMatch = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(trimmed);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1] || "image/jpeg";
    const encoded = dataUrlMatch[3] || "";
    const buffer = dataUrlMatch[2]
      ? Buffer.from(encoded, "base64")
      : Buffer.from(decodeURIComponent(encoded));
    return buffer.length > 0 ? { buffer, mimeType } : null;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const response = await fetch(trimmed, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Falha ao baixar avatar (${response.status}).`);
  }
  const contentType = response.headers.get("content-type");
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length > 0 ? { buffer, mimeType: contentType } : null;
};

export const cacheAdminOperationalUserAvatar = async (
  userId: number,
  phoneOrJid: string | null | undefined,
): Promise<string | null> => {
  const avatarSource = await getAdminOperationalUserAvatarUrl(phoneOrJid);
  if (!avatarSource) return null;

  const downloaded = await bufferFromAvatarSource(avatarSource);
  if (!downloaded) return avatarSource;

  const avatarPath = await saveBufferAsUploadedFile(downloaded.buffer, "avatars", {
    fixedFileName: `support-user-${userId}`,
    forceExtension: extensionFromMime(downloaded.mimeType),
  });

  const updated = await updateUserProfile(userId, { avatarPath });
  return updated.avatarUrl || `/${avatarPath}`;
};
