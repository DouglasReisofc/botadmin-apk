import type { RowDataPacket } from "mysql2";

import {
  ensureBotGroupTable,
  ensureUserTable,
  getDb,
} from "lib/db";
import type { BotGroup } from "types/bot-groups";
import type { AdminGroupSummary } from "types/admin-groups";
import { mapBotGroupToAdminSummary } from "lib/admin-groups-map";
import { getGroupByIdForUser } from "./bot-groups";

export { mapBotGroupToAdminSummary } from "lib/admin-groups-map";

type AdminGroupRow = RowDataPacket & {
  id: number;
  user_id: number;
  instance_id: number | null;
  slot: number | null;
  name: string;
  description: string | null;
  remote_id: string;
  invite_code: string | null;
  invite_link: string | null;
  status: string | null;
  awaiting_approval: number | null;
  awaiting_entry: number | null;
  owner: string | null;
  image_url: string | null;
  metadata: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  user_name: string | null;
  user_email: string | null;
  instance_name: string | null;
  instance_phone: string | null;
};

type AdminGroupUserRow = RowDataPacket & {
  user_id: number;
  user_name: string | null;
  user_email: string | null;
};

const sanitizeLikeQuery = (value: string) =>
  value.replace(/[!%_]/g, (char) => `!${char}`);

const normalizeDate = (value: Date | string): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
};

const parseMetadata = (value: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const readMetadataString = (metadata: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
};

const readMetadataNumber = (metadata: Record<string, unknown>, ...keys: string[]) => {
  const raw = readMetadataString(metadata, ...keys);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const licenseExpiryMillis = (value: string | null) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapRowToSummary = (row: AdminGroupRow): AdminGroupSummary => {
  const metadata = parseMetadata(row.metadata);
  const licenseExpiresAt = readMetadataString(metadata, "licenseExpiresAt", "license_expires_at");
  const licensePlanId = readMetadataNumber(metadata, "licensePlanId", "license_plan_id");
  const licensePlanName = readMetadataString(metadata, "licensePlanName", "license_plan_name");
  const licenseSource = readMetadataString(metadata, "licenseSource", "license_source");
  const isVip = licenseExpiryMillis(licenseExpiresAt) > Date.now();

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    userId: row.user_id,
    userName: row.user_name ?? "Usuário sem nome",
    userEmail: row.user_email ?? null,
    instanceId: row.instance_id ?? null,
    instanceName: row.instance_name ?? null,
    instancePhone: row.instance_phone ?? null,
    slot: row.slot ?? 0,
    remoteId: row.remote_id,
    inviteCode: row.invite_code ?? null,
    inviteLink: row.invite_link ?? null,
    owner: row.owner ?? null,
    imageUrl: row.image_url ?? null,
    status: row.status === "disabled" ? "disabled" : "active",
    isVip,
    licenseExpiresAt,
    licensePlanId,
    licensePlanName,
    licenseSource,
    awaitingApproval: row.awaiting_approval === 1,
    awaitingEntry: row.awaiting_entry === 1,
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at),
  };
};

export const searchAdminGroups = async ({
  query,
  page = 1,
  pageSize = 20,
}: {
  query?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<{
  groups: AdminGroupSummary[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}> => {
  await ensureUserTable();
  await ensureBotGroupTable();

  const db = getDb();

  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(Number(page))) : 1;
  const parsedSize = Number.isFinite(pageSize) ? Math.trunc(Number(pageSize)) : 20;
  const safePageSize = Math.min(Math.max(parsedSize, 1), 100);
  const offset = (safePage - 1) * safePageSize;

  const filters: string[] = [];
  const params: Array<string | number> = [];

  const rawQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (rawQuery) {
    const normalized = sanitizeLikeQuery(rawQuery);
    const wildcard = `%${normalized}%`;
    filters.push(
      `(
        LOWER(bg.name) LIKE ? ESCAPE '!'
        OR LOWER(bg.remote_id) LIKE ? ESCAPE '!'
        OR LOWER(bg.invite_code) LIKE ? ESCAPE '!'
        OR LOWER(u.name) LIKE ? ESCAPE '!'
        OR LOWER(u.email) LIKE ? ESCAPE '!'
      )`,
    );
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const [countRows] = await db.query<(RowDataPacket & { total: number })[]>(
    `
      SELECT COUNT(*) AS total
      FROM bot_groups bg
      INNER JOIN users u ON u.id = bg.user_id
      ${whereClause}
    `,
    params,
  );

  const total = Number(countRows?.[0]?.total ?? 0);

  const [rows] = await db.query<AdminGroupRow[]>(
    `
      SELECT
        bg.*,
        u.name AS user_name,
        u.email AS user_email,
        bi.name AS instance_name,
        bi.phone AS instance_phone
      FROM bot_groups bg
      INNER JOIN users u ON u.id = bg.user_id
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      ${whereClause}
      ORDER BY bg.created_at DESC, bg.id DESC
      LIMIT ?
      OFFSET ?
    `,
    [...params, safePageSize, offset],
  );

  const groups = rows
    .map(mapRowToSummary)
    .sort((left, right) => {
      if (left.isVip !== right.isVip) return left.isVip ? -1 : 1;
      return licenseExpiryMillis(right.licenseExpiresAt) - licenseExpiryMillis(left.licenseExpiresAt);
    });
  const hasMore = offset + groups.length < total;

  return {
    groups,
    total,
    page: safePage,
    pageSize: safePageSize,
    hasMore,
  };
};

export const getAdminGroupOwnerRow = async (
  groupId: number,
): Promise<AdminGroupUserRow | null> => {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return null;
  }

  await ensureUserTable();
  await ensureBotGroupTable();
  const db = getDb();

  const [rows] = await db.query<AdminGroupUserRow[]>(
    `
      SELECT
        bg.user_id,
        u.name AS user_name,
        u.email AS user_email
      FROM bot_groups bg
      INNER JOIN users u ON u.id = bg.user_id
      WHERE bg.id = ?
      LIMIT 1
    `,
    [groupId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
};

export const getAdminGroupWithUser = async (
  groupId: number,
): Promise<{ group: BotGroup; user: { id: number; name: string; email: string | null } } | null> => {
  const ownerRow = await getAdminGroupOwnerRow(groupId);
  if (!ownerRow) {
    return null;
  }

  const group = await getGroupByIdForUser(ownerRow.user_id, groupId);
  if (!group) {
    return null;
  }

  return {
    group,
    user: {
      id: ownerRow.user_id,
      name: ownerRow.user_name ?? "Usuário sem nome",
      email: ownerRow.user_email ?? null,
    },
  };
};
