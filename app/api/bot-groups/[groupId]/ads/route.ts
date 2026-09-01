import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";
import type { BotGroupAd } from "types/bot-groups";

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim", "on"].includes(trimmed)) return true;
    if (["false", "0", "no", "nao", "não", "off"].includes(trimmed)) return false;
  }
  return undefined;
};

const parseTimesInput = (value: unknown): string[] => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
      .slice(0, 20);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
      .slice(0, 20);
  }
  return [];
};

const parseMediaInput = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const path = typeof source.path === "string" ? source.path.trim() : "";
  const url = typeof source.url === "string" ? source.url.trim() : "";

  if (!path && !url) {
    return null;
  }

  const media: Record<string, unknown> = {};
  if (path) {
    media.path = path;
  }
  if (url) {
    media.url = url;
  }
  if (typeof source.mediaType === "string") {
    media.mediaType = source.mediaType.trim();
  } else if (typeof source.type === "string") {
    media.mediaType = source.type.trim();
  }
  if (typeof source.mimeType === "string") {
    media.mimeType = source.mimeType.trim();
  } else if (typeof source.mimetype === "string") {
    media.mimeType = source.mimetype.trim();
  }
  if (typeof source.fileName === "string") {
    media.fileName = source.fileName.trim();
  }
  if (typeof source.caption === "string") {
    media.caption = source.caption.trim();
  }
  return media;
};

const ensureAuthorizedGroup = async (groupId: number) => {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  }

  const group = await getGroupByIdForUser(user.id, groupId);
  if (!group) {
    return { error: NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 }) };
  }

  return { userId: user.id, group };
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const auth = await ensureAuthorizedGroup(groupId);
  if ("error" in auth) {
    return auth.error;
  }

  try {
    const settings = await getGroupSettings(groupId);
    return NextResponse.json({ ads: settings.ads ?? [] });
  } catch (error) {
    console.error("Failed to load bot group ads", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os anúncios do grupo." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const auth = await ensureAuthorizedGroup(groupId);
  if ("error" in auth) {
    return auth.error;
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
  }

  const settings = await getGroupSettings(groupId);
  const currentAds = Array.isArray(settings.ads) ? settings.ads : [];
  const ADS_LIMIT = 20;
  if (currentAds.length >= ADS_LIMIT) {
    return NextResponse.json(
      { message: `Limite de ${ADS_LIMIT} anúncios atingido.` },
      { status: 400 },
    );
  }

  const mentionAll = normalizeBoolean(payload.mentionAll ?? payload.mention_all);
  const enabled = normalizeBoolean(payload.enabled);
  const scheduleTypeRaw = typeof payload.scheduleType === "string" ? payload.scheduleType : payload.schedule_type;
  const scheduleType =
    typeof scheduleTypeRaw === "string" && scheduleTypeRaw.trim().toLowerCase() === "times"
      ? "times"
      : "frequency";

  const frequency =
    scheduleType === "frequency" && typeof payload.frequency === "string"
      ? payload.frequency.trim()
      : "";

  const times = scheduleType === "times" ? parseTimesInput(payload.times ?? payload.horarios) : [];

  const media = parseMediaInput(payload.media);

  const nowIso = new Date().toISOString();
  const adCandidate: Partial<BotGroupAd> & Record<string, unknown> = {
    id: randomUUID(),
    enabled: enabled ?? true,
    caption: typeof payload.caption === "string" ? payload.caption : "",
    mentionAll: mentionAll ?? false,
    scheduleType,
    frequency,
    times,
    media: media as unknown as BotGroupAd["media"],
    responseButtons: (
      payload.responseButtons ??
      payload.buttonTemplate ??
      payload.buttonsTemplate ??
      payload.buttons ??
      null
    ) as BotGroupAd["responseButtons"],
    interactiveButtons: Array.isArray(
      payload.interactiveButtons ?? payload.interactive_buttons,
    )
      ? ((payload.interactiveButtons ??
          payload.interactive_buttons) as BotGroupAd["interactiveButtons"])
      : null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const updatedAdsPayload = [...currentAds, adCandidate];

  try {
    const updatedSettings = await upsertGroupSettings(groupId, { ads: updatedAdsPayload as BotGroupAd[] });
    const created = updatedSettings.ads.find((entry) => entry.id === adCandidate.id) ?? null;
    return NextResponse.json(
      {
        message: "Anúncio criado com sucesso.",
        ad: created,
        ads: updatedSettings.ads,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create bot group ad", error);
    return NextResponse.json(
      { message: "Não foi possível criar o anúncio." },
      { status: 500 },
    );
  }
}
