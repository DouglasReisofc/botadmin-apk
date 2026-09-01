import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { ensureBotAdCampaignStatusPostTable, getDb } from "lib/db";
import { listBotAdCampaignsForUser } from "lib/bot-ad-campaigns";
import {
  requestWhatsappStatusSync,
  resolveWhatsappStatusPreviews,
} from "lib/whatsapp-status-sync";
import {
  cleanupExpiredWhatsappStatusMessages,
  listActiveWhatsappReceivedStatusesForUser,
} from "lib/whatsapp-conversations";

type StatusPostRow = {
  id: number;
  post_id: string;
  campaign_id: number;
  target_id: number | null;
  instance_id: number;
  message_id: string | null;
  delete_at: Date | string | null;
  deleted_at: Date | string | null;
  payload_json: string | null;
  error_message: string | null;
  created_at: Date | string;
  instance_name: string | null;
};

const parseJson = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const mapStatusConfigForClient = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const mentions = Array.isArray(record.mentions)
    ? record.mentions
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
        .slice(0, 256)
    : Array.isArray(record.Mentions)
      ? record.Mentions
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, 256)
      : [];
  const allowReshare =
    typeof record.allowReshare === "boolean"
      ? record.allowReshare
      : typeof record.allow_reshare === "boolean"
        ? record.allow_reshare
        : null;
  if (mentions.length === 0 && allowReshare === null) {
    return null;
  }
  return {
    mentions,
    allowReshare,
  };
};

const mapStatusContentSnapshot = (value: Record<string, unknown> | null) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const snapshot = value.snapshot as Record<string, unknown> | undefined;
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const statusTypeRaw = typeof snapshot.statusType === "string" ? snapshot.statusType.toLowerCase().trim() : "";
  const type: "text" | "image" | "video" | "document" =
    statusTypeRaw === "video"
      ? "video"
      : statusTypeRaw === "image"
        ? "image"
        : statusTypeRaw === "document"
          ? "document"
          : "text";
  const text = typeof snapshot.text === "string" ? snapshot.text : "";
  const caption = typeof snapshot.caption === "string" ? snapshot.caption : "";
  const media = snapshot.media as Record<string, unknown> | undefined;
  const mediaUrl =
    typeof media?.url === "string"
      ? media.url
      : typeof media?.path === "string"
        ? media.path
        : "";
  const config = mapStatusConfigForClient(snapshot.config ?? value.config);

  if (!text && !caption && !mediaUrl) {
    return null;
  }

  return {
    id: typeof value.contentId === "string" ? value.contentId : `snapshot-${Date.now()}`,
    type,
    text,
    caption,
    mediaUrl,
    config,
  };
};

const mapContentForClient = (
  content: {
    id?: string;
    statusType?: "text" | "image" | "video" | "document";
    type?: "text" | "image" | "video" | "document" | "status";
    text?: string | null;
    caption?: string | null;
    media?: {
      url?: string | null;
      path?: string | null;
    } | null;
    mediaUrl?: string;
    config?: Record<string, unknown> | null;
  } | null,
) => {
  if (!content) {
    return null;
  }

  const type = content.statusType ?? content.type ?? "text";
  const mediaUrl = content.media?.url ?? content.media?.path ?? content.mediaUrl ?? "";
  return {
    id: content.id ?? `status-${Date.now()}`,
    type,
    text: content.text ?? "",
    caption: content.caption ?? "",
    mediaUrl,
    config: mapStatusConfigForClient(content.config),
  };
};

const mapStatusContentPreview = (
  content: {
    id?: string;
    type?: string;
    statusType?: "text" | "image" | "video" | "document";
    text?: string | null;
    caption?: string | null;
    media?: {
      url?: string | null;
      path?: string | null;
    } | null;
  } | null | undefined,
) => {
  if (!content || content.type !== "status") {
    return null;
  }
  return {
    id: content.id ?? `content-${Date.now()}`,
    statusType: content.statusType ?? "text",
    text: content.text ?? "",
    caption: content.caption ?? "",
    mediaUrl: content.media?.url ?? content.media?.path ?? "",
  };
};

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const rawInstanceId = request.nextUrl.searchParams.get("instanceId");
    const scopedInstanceId =
      rawInstanceId && rawInstanceId.trim()
        ? Number(rawInstanceId.trim())
        : null;

    if (rawInstanceId && (!Number.isFinite(scopedInstanceId) || Number(scopedInstanceId) <= 0)) {
      return NextResponse.json({ message: "Instância inválida." }, { status: 400 });
    }

    await ensureBotAdCampaignStatusPostTable();
    if (typeof scopedInstanceId === "number" && Number.isFinite(scopedInstanceId)) {
      try {
        const sync = await requestWhatsappStatusSync(user.id, scopedInstanceId);
        // Give the on-demand HistorySync webhook a short bounded window to be
        // persisted before this same page load reads the status feed.
        if (sync.requested) {
          await new Promise((resolve) => setTimeout(resolve, 1_200));
        }
      } catch (syncError) {
        // Existing stored statuses remain available if the linked phone is
        // temporarily offline or declines an on-demand history request.
        console.warn("[bot-status] on-demand status sync failed", {
          userId: user.id,
          instanceId: scopedInstanceId,
          error: syncError,
        });
      }
    }
    const receivedStatusesPromise = listActiveWhatsappReceivedStatusesForUser(
      user.id,
      scopedInstanceId,
      { limit: 120, maxAgeHours: 24 },
    ).then((statuses) =>
      typeof scopedInstanceId === "number"
        ? resolveWhatsappStatusPreviews(user.id, scopedInstanceId, statuses)
        : statuses,
    );
    void cleanupExpiredWhatsappStatusMessages(30).catch((cleanupError) => {
      console.warn("[bot-status] failed to cleanup expired WhatsApp statuses", cleanupError);
    });
    const campaigns = await listBotAdCampaignsForUser(user.id);
    const statusCampaigns = campaigns.filter((campaign) =>
      campaign.targets.some((target) => target.type === "status"),
    );
    const scopedStatusCampaigns =
      typeof scopedInstanceId === "number" && Number.isFinite(scopedInstanceId)
        ? statusCampaigns.filter((campaign) =>
            campaign.targets.some(
              (target) => target.type === "status" && target.instanceId === scopedInstanceId,
            ),
          )
        : statusCampaigns;
    const campaignMap = new Map(scopedStatusCampaigns.map((campaign) => [campaign.numericId, campaign]));

    const db = getDb();
    const [rows] = await db.query<StatusPostRow[]>(
      `
        SELECT
          sp.*,
          bi.name AS instance_name
        FROM bot_ad_campaign_status_posts sp
        INNER JOIN bot_ad_campaigns c ON c.id = sp.campaign_id
        LEFT JOIN bot_instances bi ON bi.id = sp.instance_id
        WHERE c.user_id = ?
          AND c.deleted_at IS NULL
          AND sp.deleted_at IS NULL
          AND (? IS NULL OR sp.instance_id = ?)
        ORDER BY sp.created_at DESC
        LIMIT 160
      `,
      [user.id, scopedInstanceId, scopedInstanceId],
    );

    const posts = rows.map((row) => {
      const campaign = campaignMap.get(row.campaign_id) ?? null;
      const payload = parseJson(row.payload_json);
      const payloadContentId =
        typeof payload?.contentId === "string" ? payload.contentId : null;
      const statusContents =
        campaign?.contents.filter((content) => content.type === "status") ?? [];
      const snapshotContent = mapStatusContentSnapshot(payload);
      const content =
        statusContents.find((entry) => entry.id === payloadContentId) ??
        statusContents[0] ??
        snapshotContent ??
        null;

      return {
        id: row.post_id,
        numericId: row.id,
        campaignId: campaign?.id ?? null,
        campaignName: campaign?.name ?? "Status",
        campaignScheduleKind: campaign?.schedule?.kind ?? null,
        instanceId: row.instance_id,
        instanceName: row.instance_name ?? `Instância ${row.instance_id}`,
        messageId: row.message_id,
        createdAt: toIso(row.created_at),
        deleteAt: toIso(row.delete_at),
        errorMessage: row.error_message,
        content: mapContentForClient(content),
      };
    });

    const receivedStatuses = await receivedStatusesPromise;

    return NextResponse.json({
      posts,
      receivedStatuses,
      campaigns: scopedStatusCampaigns.map((campaign) => {
        const statusContents = campaign.contents
          .map((content) => mapStatusContentPreview(content))
          .filter((content): content is NonNullable<ReturnType<typeof mapStatusContentPreview>> => Boolean(content));

        return {
          id: campaign.id,
          numericId: campaign.numericId,
          name: campaign.name,
          status: campaign.status,
          scheduleKind: campaign.schedule.kind,
          nextRunAt: campaign.nextRunAt,
          instanceIds: Array.from(
            new Set(campaign.targets.filter((target) => target.type === "status").map((target) => target.instanceId)),
          ),
          contentCount: statusContents.length,
          statusContents: statusContents.slice(0, 8),
          options: campaign.options ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("Failed to load bot status feed", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os status." },
      { status: 500 },
    );
  }
}
