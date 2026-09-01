import { randomUUID } from "node:crypto";

import {
  getBotAdCampaignById,
  listBotAdCampaignsForUser,
  updateBotAdCampaign,
} from "lib/bot-ad-campaigns";
import { createInternalUserRequestHeaders } from "lib/internal-user-request";
import { withRedisLock } from "lib/redis";
import { extractLinks } from "lib/whatsapp";
import { deleteUploadedFile } from "lib/uploads";
import { DEFAULT_COMMAND_ALIASES } from "resources/default-command-aliases";
import { listBotFlowsForUser } from "lib/bot-flows";
import { canonicalizeCommandText } from "lib/commands/text";
import type { BotAdCampaign, BotAdCampaignContent } from "types/bot-ad-campaigns";

const MAX_LINKS_PER_COMMAND = 10;
const MAX_CAMPAIGN_CONTENTS = 25;

const RESERVED_COMMANDS = new Set(
  Object.entries(DEFAULT_COMMAND_ALIASES)
    .flatMap(([command, aliases]) => [command, ...aliases])
    .map((value) => value.toLowerCase()),
);
[
  "envato", "freepik", "filme", "movie", "serie", "series", "sorteio",
  "addrifa", "rifa", "rifas", "cancelarrifa", "comprarrifa", "sortearrifa",
  "statusretry", "renovarplano",
].forEach((value) => RESERVED_COMMANDS.add(value));

export const normalizeStatusCampaignCommand = (value: unknown): string => {
  const normalized = typeof value === "string"
    ? value.trim().replace(/^[!/#$%&.~]+/, "").toLowerCase()
    : "";
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized)) {
    throw new Error("Use de 3 a 32 caracteres: letras, números, _ ou -. Não use espaços.");
  }
  return normalized;
};

export const assertStatusCampaignCommandAvailable = async (params: {
  userId: number;
  campaignId?: string | null;
  command: string;
}): Promise<string> => {
  const command = normalizeStatusCampaignCommand(params.command);
  const canonicalCommand = canonicalizeCommandText(command);
  if (RESERVED_COMMANDS.has(canonicalCommand)) {
    throw new Error(`O comando ${command} já pertence a outra função do BotAdmin.`);
  }
  const [campaigns, flows] = await Promise.all([
    listBotAdCampaignsForUser(params.userId),
    listBotFlowsForUser(params.userId),
  ]);
  const flowCollision = flows.find((flow) => {
    if (canonicalizeCommandText(flow.command) === canonicalCommand) return true;
    return flow.nodes.some((node) =>
      node.kind === "trigger" &&
      node.triggerType === "command" &&
      canonicalizeCommandText(node.triggerValue || node.text || "") === canonicalCommand
    );
  });
  if (flowCollision) {
    throw new Error(`O comando ${command} já está sendo usado pelo fluxo “${flowCollision.name}”.`);
  }
  const collision = campaigns.find((campaign) => {
    if (campaign.id === params.campaignId) return false;
    const configured = campaign.options?.statusCommand;
    return configured?.enabled !== false &&
      canonicalizeCommandText(configured?.command || "") === canonicalCommand;
  });
  if (collision) {
    throw new Error(`O comando ${command} já está sendo usado pela lista “${collision.name}”.`);
  }
  return command;
};

export const findStatusCampaignByCommand = async (params: {
  userId: number;
  instanceId: number;
  command: string;
}): Promise<BotAdCampaign | null> => {
  const command = params.command.trim().toLowerCase();
  if (!command) return null;
  const campaigns = await listBotAdCampaignsForUser(params.userId);
  return campaigns.find((campaign) => {
    const configured = campaign.options?.statusCommand;
    if (!configured?.enabled || configured.command !== command) return false;
    return campaign.targets.some(
      (target) => target.type === "status" && target.instanceId === params.instanceId,
    );
  }) ?? null;
};

export const parseStatusCommandLinks = (value: string): string[] => {
  const links = extractLinks(value)
    .map((entry) => entry.replace(/[),.;]+$/g, ""))
    .filter((entry, index, array) => array.indexOf(entry) === index);
  if (links.length === 0) {
    throw new Error("Envie pelo menos um link válido depois do comando.");
  }
  if (links.length > MAX_LINKS_PER_COMMAND) {
    throw new Error(`Envie no máximo ${MAX_LINKS_PER_COMMAND} links por comando.`);
  }
  return links;
};

type ResolvedMedia = {
  mediaType: "image" | "video";
  url: string;
  path?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  caption?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
};

const internalBaseUrl = (): string => {
  const explicit = process.env.REST_INTERNAL_BASE_URL?.trim() ||
    process.env.INTERNAL_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `http://127.0.0.1:${process.env.PORT?.trim() || "4322"}`;
};

const resolveMedia = async (userId: number, link: string): Promise<ResolvedMedia> => {
  const endpoint = new URL("/api/bot-status/resolve-link", `${internalBaseUrl()}/`);
  endpoint.searchParams.set("url", link);
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      ...createInternalUserRequestHeaders(userId),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  });
  const data = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok || data?.success !== true || !data.result) {
    throw new Error(String(data?.message || `Falha ao resolver a mídia (${response.status}).`));
  }
  return data.result as ResolvedMedia;
};

const queueGeminiCaption = async (params: {
  userId: number;
  campaignId: string;
  contentId: string;
  media: ResolvedMedia;
  provider: "gemini" | "auto" | "chatgpt";
}): Promise<void> => {
  const response = await fetch(new URL("/api/bot-status/enrich", `${internalBaseUrl()}/`), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...createInternalUserRequestHeaders(params.userId),
    },
    body: JSON.stringify({
      mode: "ai",
      provider: params.provider,
      mediaUrl: params.media.url,
      mediaPath: params.media.path || "",
      mimeType: params.media.mimeType || "",
      fileName: params.media.fileName || "",
      campaignId: params.campaignId,
      contentId: params.contentId,
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    throw new Error(String(data?.message || `Gemini HTTP ${response.status}`));
  }
};

const appendContents = async (
  userId: number,
  campaignId: string,
  contents: BotAdCampaignContent[],
): Promise<BotAdCampaign> => {
  const updated = await withRedisLock(
    `status-campaign:${campaignId}`,
    60_000,
    async () => {
      const campaign = await getBotAdCampaignById(userId, campaignId);
      if (!campaign) throw new Error("A lista de status não existe mais.");
      if (campaign.contents.length + contents.length > MAX_CAMPAIGN_CONTENTS) {
        throw new Error(
          `A lista aceita até ${MAX_CAMPAIGN_CONTENTS} conteúdos. Remova itens ou envie menos links.`,
        );
      }
      return updateBotAdCampaign(userId, campaignId, {
        name: campaign.name,
        contents: [...campaign.contents, ...contents],
      });
    },
  );
  if (!updated) throw new Error("A lista está recebendo outro comando. Tente novamente.");
  return updated;
};

export type StatusCommandIngestResult = {
  campaign: BotAdCampaign;
  added: number;
  aiQueued: number;
};

export const ingestStatusCampaignLinks = async (params: {
  userId: number;
  campaignId: string;
  links: string[];
}): Promise<StatusCommandIngestResult> => {
  const campaign = await getBotAdCampaignById(params.userId, params.campaignId);
  if (!campaign) throw new Error("A lista de status não existe mais.");
  if (campaign.contents.length + params.links.length > MAX_CAMPAIGN_CONTENTS) {
    throw new Error(
      `A lista aceita até ${MAX_CAMPAIGN_CONTENTS} conteúdos. Há espaço para ${Math.max(0, MAX_CAMPAIGN_CONTENTS - campaign.contents.length)}.`,
    );
  }

  const resolutionResults = await Promise.allSettled(
    params.links.map((link) => resolveMedia(params.userId, link)),
  );
  const resolved = resolutionResults
    .filter((result): result is PromiseFulfilledResult<ResolvedMedia> => result.status === "fulfilled")
    .map((result) => result.value);
  const failed = resolutionResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    await Promise.all(
      resolved.map((media) => media.path
        ? deleteUploadedFile(media.path).catch(() => undefined)
        : Promise.resolve()),
    );
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error("Não foi possível resolver uma das mídias.");
  }
  const contentPairs = resolved.map((media, index) => {
    const id = randomUUID();
    const content: BotAdCampaignContent = {
      id,
      type: "status",
      statusType: media.mediaType,
      caption: media.caption || media.title || null,
      media: {
        url: media.url,
        path: media.path || null,
        mimeType: media.mimeType || null,
        fileName: media.fileName || null,
        mediaType: media.mediaType,
        caption: media.caption || media.title || null,
      },
      config: null,
      alwaysSendWhenRandomized: false,
    };
    return { content, media, link: params.links[index] };
  });
  let updated: BotAdCampaign;
  try {
    updated = await appendContents(
      params.userId,
      params.campaignId,
      contentPairs.map((entry) => entry.content),
    );
  } catch (error) {
    await Promise.all(
      resolved.map((media) => media.path
        ? deleteUploadedFile(media.path).catch(() => undefined)
        : Promise.resolve()),
    );
    throw error;
  }
  const provider = campaign.options?.statusCommand?.captionProvider || "gemini";
  for (const entry of contentPairs) {
    void queueGeminiCaption({
      userId: params.userId,
      campaignId: params.campaignId,
      contentId: entry.content.id,
      media: entry.media,
      provider,
    }).catch((error) => {
      console.error("[status-command] Falha ao enfileirar legenda", {
        campaignId: params.campaignId,
        contentId: entry.content.id,
        link: entry.link,
        error,
      });
    });
  }
  return { campaign: updated, added: contentPairs.length, aiQueued: contentPairs.length };
};
