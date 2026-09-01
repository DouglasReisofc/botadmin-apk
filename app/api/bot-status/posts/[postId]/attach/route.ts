import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { ensureBotAdCampaignStatusPostTable, getDb } from "lib/db";
import {
  createBotAdCampaign,
  getBotAdCampaignById,
  listBotAdCampaignsForUser,
  replaceBotAdCampaignTargets,
  updateBotAdCampaign,
} from "lib/bot-ad-campaigns";
import type { BotAdCampaignContent, BotAdCampaignScheduleConfig, BotAdCampaignTargetInput } from "types/bot-ad-campaigns";

type PostSourceRow = {
  id: number;
  post_id: string;
  campaign_id: number;
  instance_id: number;
  payload_json: string | null;
};

type AttachPayload = {
  campaignId?: string | null;
  create?: {
    name?: string | null;
    instanceId?: number | null;
    scheduleKind?: "recurring" | "window";
    everyMinutes?: number | null;
    times?: string | null;
    timezone?: string | null;
  } | null;
};

type AttachRouteContext = { params: Promise<{ postId: string }> };

const resolvePostId = async (
  context: AttachRouteContext,
  request: Request,
): Promise<string | null> => {
  const params = await Promise.resolve(context.params);
  const fromParams = typeof params?.postId === "string" ? params.postId.trim() : "";
  if (fromParams) {
    return fromParams;
  }
  try {
    const path = new URL(request.url).pathname.split("/").filter(Boolean);
    const attachIndex = path.lastIndexOf("attach");
    const fromPath = attachIndex > 0 ? (path[attachIndex - 1] ?? "").trim() : "";
    return fromPath || null;
  } catch {
    return null;
  }
};

const parseJson = (value: string | null): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const parseStatusConfig = (value: unknown): BotAdCampaignContent["config"] => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const parseStringList = (raw: unknown): string[] | null => {
    if (!Array.isArray(raw)) return null;
    const list = raw
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .slice(0, 256);
    return list.length > 0 ? list : null;
  };
  return {
    deleteAfterMinutes:
      typeof record.deleteAfterMinutes === "number" && Number.isFinite(record.deleteAfterMinutes)
        ? Math.max(1, Math.floor(record.deleteAfterMinutes))
        : null,
    deleteAt: typeof record.deleteAt === "string" ? record.deleteAt : null,
    visibility:
      typeof record.visibility === "string"
        ? (record.visibility.toLowerCase() as NonNullable<BotAdCampaignContent["config"]>["visibility"])
        : null,
    whitelist: parseStringList(record.whitelist),
    blacklist: parseStringList(record.blacklist),
    mentions: parseStringList(record.mentions ?? record.Mentions),
    allowReshare:
      typeof record.allowReshare === "boolean"
        ? record.allowReshare
        : typeof record.allow_reshare === "boolean"
          ? record.allow_reshare
          : null,
  };
};

const parseSnapshotContent = (
  payloadJson: Record<string, unknown> | null,
): BotAdCampaignContent | null => {
  if (!payloadJson) {
    return null;
  }
  const snapshot = payloadJson.snapshot as Record<string, unknown> | undefined;
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const statusTypeRaw = typeof snapshot.statusType === "string" ? snapshot.statusType.trim().toLowerCase() : "text";
  const statusType: BotAdCampaignContent["statusType"] =
    statusTypeRaw === "video"
      ? "video"
      : statusTypeRaw === "image"
        ? "image"
        : statusTypeRaw === "document"
          ? "document"
          : "text";
  const text = typeof snapshot.text === "string" ? snapshot.text : null;
  const caption = typeof snapshot.caption === "string" ? snapshot.caption : null;
  const mediaInput = snapshot.media as Record<string, unknown> | undefined;
  const mediaUrl = typeof mediaInput?.url === "string" ? mediaInput.url : null;
  const mediaPath = typeof mediaInput?.path === "string" ? mediaInput.path : null;
  const mediaMimeType = typeof mediaInput?.mimeType === "string" ? mediaInput.mimeType : null;
  const mediaFileName = typeof mediaInput?.fileName === "string" ? mediaInput.fileName : null;
  const config = parseStatusConfig(snapshot.config ?? payloadJson.config);

  if (!text && !caption && !mediaUrl && !mediaPath) {
    return null;
  }

  return {
    id: typeof payloadJson.contentId === "string" && payloadJson.contentId.trim()
      ? payloadJson.contentId.trim()
      : randomUUID(),
    type: "status",
    statusType,
    text,
    caption,
    media: mediaUrl || mediaPath
      ? {
          url: mediaUrl ?? null,
          path: mediaPath ?? null,
          mimeType: mediaMimeType ?? null,
          fileName: mediaFileName ?? null,
          mediaType: statusType === "video" ? "video" : "image",
        }
      : undefined,
    config,
  };
};

const cloneStatusContent = (content: BotAdCampaignContent): BotAdCampaignContent => {
  if (content.type !== "status") {
    throw new Error("Conteúdo inválido para status.");
  }
  return { ...content, id: randomUUID() };
};

const parseTimes = (value: string | null | undefined) =>
  (value ?? "")
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(entry));

const resolveSchedule = (create: NonNullable<AttachPayload["create"]>): BotAdCampaignScheduleConfig => {
  if (create.scheduleKind === "window") {
    const atTimes = parseTimes(create.times);
    if (!atTimes.length) {
      throw new Error("Informe ao menos um horário válido (HH:MM).");
    }
    return {
      kind: "window",
      atTimes,
      timezone: create.timezone?.trim() || "America/Sao_Paulo",
    };
  }

  return {
    kind: "recurring",
    everyMinutes:
      Number.isFinite(create.everyMinutes) && Number(create.everyMinutes) > 0
        ? Math.max(5, Math.floor(Number(create.everyMinutes)))
        : 1440,
    timezone: create.timezone?.trim() || "America/Sao_Paulo",
  };
};

const findPostByUser = async (userId: number, postId: string): Promise<PostSourceRow | null> => {
  await ensureBotAdCampaignStatusPostTable();
  const db = getDb();
  const [rows] = await db.query<PostSourceRow[]>(
    `
      SELECT sp.id, sp.post_id, sp.campaign_id, sp.instance_id, sp.payload_json
      FROM bot_ad_campaign_status_posts sp
      INNER JOIN bot_ad_campaigns c ON c.id = sp.campaign_id
      WHERE c.user_id = ?
        AND c.deleted_at IS NULL
        AND sp.post_id = ?
      LIMIT 1
    `,
    [userId, postId],
  );
  return rows[0] ?? null;
};

export async function POST(
  request: Request,
  context: AttachRouteContext,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const postId = await resolvePostId(context, request);
    if (!postId) {
      return NextResponse.json({ message: "Status inválido." }, { status: 400 });
    }

    const payload = (await request.json().catch(() => null)) as AttachPayload | null;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const post = await findPostByUser(user.id, postId);
    if (!post) {
      return NextResponse.json({ message: "Status não encontrado." }, { status: 404 });
    }

    const allCampaigns = await listBotAdCampaignsForUser(user.id);
    const payloadJson = parseJson(post.payload_json);
    const sourceCampaign = allCampaigns.find((campaign) => campaign.numericId === post.campaign_id);
    const snapshotContent = parseSnapshotContent(payloadJson);
    if (!sourceCampaign && !snapshotContent) {
      return NextResponse.json({ message: "Campanha de origem não encontrada." }, { status: 404 });
    }
    const contentId = typeof payloadJson?.contentId === "string" ? payloadJson.contentId : null;
    const sourceContent =
      sourceCampaign?.contents.find((content) => content.type === "status" && content.id === contentId) ??
      sourceCampaign?.contents.find((content) => content.type === "status") ??
      snapshotContent;

    if (!sourceContent || sourceContent.type !== "status") {
      return NextResponse.json({ message: "Conteúdo do status não encontrado na campanha de origem." }, { status: 400 });
    }

    const clonedContent = cloneStatusContent(sourceContent);

    if (payload.campaignId) {
      const targetCampaign = await getBotAdCampaignById(user.id, payload.campaignId);
      if (!targetCampaign) {
        return NextResponse.json({ message: "Campanha de destino não encontrada." }, { status: 404 });
      }
      if (!targetCampaign.targets.some((target) => target.type === "status")) {
        return NextResponse.json({ message: "A campanha escolhida não é de status." }, { status: 400 });
      }

      const updated = await updateBotAdCampaign(user.id, payload.campaignId, {
        contents: [...targetCampaign.contents, clonedContent],
      });
      return NextResponse.json({
        message: "Status adicionado na campanha programada com sucesso.",
        campaign: updated,
      });
    }

    const create = payload.create;
    if (!create) {
      return NextResponse.json({ message: "Informe a campanha de destino ou a criação de uma nova." }, { status: 400 });
    }
    const instanceId =
      Number.isFinite(create.instanceId) && Number(create.instanceId) > 0
        ? Number(create.instanceId)
        : post.instance_id;
    const schedule = resolveSchedule(create);
    const name = create.name?.trim() || `Status programado ${new Date().toLocaleString("pt-BR")}`;

    const created = await createBotAdCampaign(user.id, {
      name,
      description: "Criado a partir de um status já publicado.",
      schedule,
      contents: [clonedContent],
      timezone: create.timezone?.trim() || "America/Sao_Paulo",
    });

    const targets: BotAdCampaignTargetInput[] = [
      {
        id: randomUUID(),
        type: "status",
        instanceId,
      },
    ];
    const replaceResult = await replaceBotAdCampaignTargets(user.id, created.id, targets);

    return NextResponse.json({
      message: "Status adicionado em uma nova programação.",
      campaign: { ...created, targets: replaceResult.targets },
    });
  } catch (error) {
    console.error("Failed to attach posted status to campaign", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível vincular o status." },
      { status: 400 },
    );
  }
}
