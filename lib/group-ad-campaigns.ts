import { getGroupSettings } from "./bot-group-settings";
import { listGroupsForUser } from "./bot-groups";

import type { BotAdCampaign, BotAdCampaignContent, GroupAdCampaignMeta } from "types/bot-ad-campaigns";
import type { BotGroup, BotGroupAd } from "types/bot-groups";

const sanitizeTimes = (raw?: string[] | null) => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => /^([0-2]?\d):([0-5]\d)$/.test(entry))
    .map((entry) => (entry.length === 4 ? `0${entry}` : entry))
    .filter((entry) => {
      if (!entry) return false;
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
};

const parseFrequencyMinutes = (token?: string | null) => {
  if (typeof token !== "string") {
    return 1440;
  }
  const match = token.trim().toLowerCase().match(/^(\d+)([mhd])$/);
  if (!match) {
    return 1440;
  }
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 1440;
  }
  const unit = match[2];
  if (unit === "m") return value;
  if (unit === "h") return value * 60;
  return value * 1440;
};

const resolveMediaType = (media?: BotGroupAd["media"] | null) => {
  const type = media?.mediaType?.toLowerCase();
  if (type === "image" || type === "video" || type === "audio" || type === "document" || type === "sticker") {
    return type;
  }
  const mime = media?.mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf") || mime.startsWith("application/")) return "document";
  return "image";
};

const convertAdContent = (ad: BotGroupAd): BotAdCampaignContent | null => {
  if (ad.media) {
    const mediaType = resolveMediaType(ad.media);
    return {
      id: `group-ad-content:${ad.id}`,
      type: mediaType === "document" ? "document" : (mediaType as "image" | "video" | "audio" | "document"),
      caption: ad.caption ?? "",
      fileName: ad.media.fileName ?? null,
      mimeType: ad.media.mimeType ?? null,
      media: {
        mediaType,
        path: ad.media.path ?? null,
        url: ad.media.url ?? null,
        fileName: ad.media.fileName ?? null,
        mimeType: ad.media.mimeType ?? null,
        caption: ad.caption ?? "",
      },
      mentionAll: ad.mentionAll ?? false,
    };
  }
  const text = ad.caption?.trim() ?? "";
  if (!text) {
    return null;
  }
  return {
    id: `group-ad-content:${ad.id}`,
    type: "text",
    text,
    mentionAll: ad.mentionAll ?? false,
    mentions: [],
  };
};

const convertGroupAdToCampaign = (ad: BotGroupAd, group: BotGroup, minutesFallback = 1440) => {
  const id = `group-ad:${group.id}:${ad.id}`;
  const sanitizedTimes = sanitizeTimes(ad.times);
  const schedule =
    ad.scheduleType === "times" && sanitizedTimes.length > 0
      ? ({
          kind: "window",
          atTimes: sanitizedTimes,
        } as BotAdCampaign["schedule"])
      : ({
          kind: "recurring",
          everyMinutes: parseFrequencyMinutes(ad.frequency) || minutesFallback,
        } as BotAdCampaign["schedule"]);

  const content = convertAdContent(ad);

  const campaign: BotAdCampaign = {
    id,
    numericId: -1,
    userId: group.userId,
    name: ad.caption?.trim() ? ad.caption.trim().slice(0, 40) : `Anúncio · ${group.name}`,
    description: null,
    status: "running",
    schedule,
    timezone: null,
    startAt: ad.createdAt ?? null,
    endAt: null,
    lastRunAt: ad.lastSentAt ?? null,
    nextRunAt: null,
    contents: content ? [content] : [],
    targets: [
      {
        id: `group-ad-target:${group.id}:${ad.id}`,
        type: "group",
        instanceId: group.instanceId,
        groupId: group.id,
        remoteId: group.remoteId,
        mentionAll: ad.mentionAll ?? false,
        mentions: [],
      },
    ],
    options: null,
    createdAt: ad.createdAt ?? new Date().toISOString(),
    updatedAt: ad.updatedAt ?? ad.createdAt ?? new Date().toISOString(),
  };

  const meta: GroupAdCampaignMeta = {
    campaignId: id,
    adId: ad.id,
    groupId: group.id,
    groupName: group.name,
    instanceId: group.instanceId,
    instancePhone: group.instancePhone,
    remoteId: group.remoteId,
  };

  return { campaign, meta };
};

export const listGroupAdsAsCampaigns = async (
  userId: number,
  options?: { groups?: BotGroup[] },
): Promise<{ campaigns: BotAdCampaign[]; meta: GroupAdCampaignMeta[] }> => {
  const groups = options?.groups ?? (await listGroupsForUser(userId));
  if (!groups.length) {
    return { campaigns: [], meta: [] };
  }

  const campaigns: BotAdCampaign[] = [];
  const meta: GroupAdCampaignMeta[] = [];

  for (const group of groups) {
    try {
      const settings = await getGroupSettings(group.id);
      const ads = Array.isArray(settings.ads) ? settings.ads : [];
      for (const ad of ads) {
        const conversion = convertGroupAdToCampaign(ad, group);
        if (!conversion.campaign.contents.length) {
          continue;
        }
        campaigns.push({ ...conversion.campaign, numericId: campaigns.length * -1 - 1 });
        meta.push(conversion.meta);
      }
    } catch (error) {
      console.error("[group-ad-campaigns] Failed to convert group ads", { groupId: group.id, error });
    }
  }

  return { campaigns, meta };
};
