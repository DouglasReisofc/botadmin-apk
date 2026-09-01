import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getGroupSettings, upsertGroupSettings } from "lib/bot-group-settings";

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

const parseTimesInput = (value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
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

const parseMediaInput = (value: unknown): Record<string, unknown> | null | undefined => {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const path = typeof source.path === "string" ? source.path.trim() : "";
  const url = typeof source.url === "string" ? source.url.trim() : "";
  if (!path && !url) {
    return null;
  }
  const media: Record<string, unknown> = {};
  if (path) media.path = path;
  if (url) media.url = url;
  if (typeof source.mediaType === "string") media.mediaType = source.mediaType.trim();
  else if (typeof source.type === "string") media.mediaType = source.type.trim();
  if (typeof source.mimeType === "string") media.mimeType = source.mimeType.trim();
  else if (typeof source.mimetype === "string") media.mimeType = source.mimetype.trim();
  if (typeof source.fileName === "string") media.fileName = source.fileName.trim();
  if (typeof source.caption === "string") media.caption = source.caption.trim();
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ groupId: string; adId: string }> },
) {
  const { groupId: rawGroupId, adId } = await context.params;
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

  try {
    const settings = await getGroupSettings(groupId);
    const currentAds = Array.isArray(settings.ads) ? settings.ads : [];
    if (!currentAds.some((entry) => entry.id === adId)) {
      return NextResponse.json({ message: "Anúncio não encontrado." }, { status: 404 });
    }

    const mentionAll = normalizeBoolean(payload.mentionAll ?? payload.mention_all);
    const enabled = normalizeBoolean(payload.enabled);
    const scheduleTypeRaw = typeof payload.scheduleType === "string" ? payload.scheduleType : payload.schedule_type;
    const timesUpdate = parseTimesInput(payload.times ?? payload.horarios);
    const mediaUpdate = parseMediaInput(payload.media);
    const nowIso = new Date().toISOString();

    const nextAdsPayload = currentAds.map((entry) => {
      if (entry.id !== adId) {
        return entry;
      }
      const patch: Record<string, unknown> = { id: adId, updatedAt: nowIso };
      if (typeof payload.caption === "string") {
        patch.caption = payload.caption;
      }
      if (mentionAll !== undefined) {
        patch.mentionAll = mentionAll;
      }
      if (enabled !== undefined) {
        patch.enabled = enabled;
      }
      if (typeof scheduleTypeRaw === "string") {
        patch.scheduleType = scheduleTypeRaw;
      }
      if (typeof payload.frequency === "string") {
        patch.frequency = payload.frequency;
      }
      if (timesUpdate !== undefined) {
        patch.times = timesUpdate;
      }
      if (mediaUpdate !== undefined) {
        patch.media = mediaUpdate;
      }
      if (
        Object.prototype.hasOwnProperty.call(payload, "responseButtons") ||
        Object.prototype.hasOwnProperty.call(payload, "buttonTemplate") ||
        Object.prototype.hasOwnProperty.call(payload, "buttonsTemplate") ||
        Object.prototype.hasOwnProperty.call(payload, "buttons")
      ) {
        patch.responseButtons =
          payload.responseButtons ??
          payload.buttonTemplate ??
          payload.buttonsTemplate ??
          payload.buttons ??
          null;
      }
      if (
        Object.prototype.hasOwnProperty.call(payload, "interactiveButtons") ||
        Object.prototype.hasOwnProperty.call(payload, "interactive_buttons")
      ) {
        const buttons =
          payload.interactiveButtons ?? payload.interactive_buttons ?? null;
        patch.interactiveButtons = Array.isArray(buttons) ? buttons : null;
      }
      if (payload.resetSentTimes === true || payload.reset_sent_times === true) {
        patch.lastSentAt = null;
        patch.sentTimes = {};
      }
      return { ...entry, ...patch };
    });

    const updatedSettings = await upsertGroupSettings(groupId, { ads: nextAdsPayload });
    const updatedAd = updatedSettings.ads.find((entry) => entry.id === adId) ?? null;

    return NextResponse.json({
      message: "Anúncio atualizado com sucesso.",
      ad: updatedAd,
      ads: updatedSettings.ads,
    });
  } catch (error) {
    console.error("Failed to update bot group ad", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar o anúncio." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string; adId: string }> },
) {
  const { groupId: rawGroupId, adId } = await context.params;
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
    const currentAds = Array.isArray(settings.ads) ? settings.ads : [];
    if (!currentAds.some((entry) => entry.id === adId)) {
      return NextResponse.json({ message: "Anúncio não encontrado." }, { status: 404 });
    }

    const nextAdsPayload = currentAds.filter((entry) => entry.id !== adId);
    const updatedSettings = await upsertGroupSettings(groupId, { ads: nextAdsPayload });

    return NextResponse.json({
      message: "Anúncio removido com sucesso.",
      ads: updatedSettings.ads,
    });
  } catch (error) {
    console.error("Failed to delete bot group ad", error);
    return NextResponse.json(
      { message: "Não foi possível excluir o anúncio." },
      { status: 500 },
    );
  }
}
