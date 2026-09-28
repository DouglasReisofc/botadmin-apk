import { randomInt } from "node:crypto";
import type { BotGroupAd, BotGroupAdMessageVariant } from "types/bot-groups";

const mediaIdentity = (media: BotGroupAdMessageVariant["media"]): string | null => {
  if (!media || typeof media !== "object") return null;
  const source = media as Record<string, unknown>;
  const ref = [source.path, source.url, source.fileName]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined;
  if (!ref) return null;
  const kind = typeof source.mediaType === "string" ? source.mediaType.trim().toLowerCase() : "";
  return `${kind}:${ref.trim().split("?")[0]}`;
};

export const chooseScheduledAdMessage = (
  ad: BotGroupAd,
): { message: BotGroupAdMessageVariant; index: number } => {
  const snapshots: BotGroupAdMessageVariant[] = [
    {
      caption: ad.caption ?? "",
      media: ad.media ?? null,
      responseButtons: ad.responseButtons ?? null,
      interactiveButtons: ad.interactiveButtons ?? null,
    },
    ...(ad.messageVariants?.length ? ad.messageVariants : (ad.captionVariations ?? []).map((caption) => ({ caption, media: ad.media ?? null, responseButtons: ad.responseButtons ?? null, interactiveButtons: ad.interactiveButtons ?? null }))),
  ].filter((entry) =>
    Boolean(entry.caption?.trim()) || Boolean(entry.media) || Boolean(entry.interactiveButtons?.length) || Boolean(entry.responseButtons?.buttons.length),
  );
  if (snapshots.length === 0) {
    return {
      message: {
        caption: "",
        media: null,
        responseButtons: null,
        interactiveButtons: null,
      },
      index: -1,
    };
  }
  if (snapshots.length === 1) return { message: snapshots[0], index: 0 };
  const previous = ad.lastVariationIndex ?? -1;
  if (previous < 0 || previous >= snapshots.length) {
    const index = randomInt(snapshots.length);
    return { message: snapshots[index], index };
  }
  const previousMedia = previous >= 0 && previous < snapshots.length
    ? mediaIdentity(snapshots[previous].media)
    : null;
  const candidates = snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .filter(({ index, snapshot }) => {
      if (index === previous) return false;
      // Evita repetir a mesma mídia quando ela foi cadastrada em mais de uma
      // variação. Se não houver outra mídia, a regra de não repetir o índice
      // continua valendo como fallback.
      return previousMedia === null || mediaIdentity(snapshot.media) !== previousMedia;
    });
  const pool = candidates.length > 0
    ? candidates
    : snapshots.map((snapshot, index) => ({ snapshot, index })).filter(({ index }) => index !== previous);
  const selected = pool[randomInt(pool.length)];
  const index = selected.index;
  return { message: selected.snapshot, index };
};

export const chooseScheduledAdVariation = (
  ad: Pick<BotGroupAd, "caption" | "captionVariations" | "lastVariationIndex">,
): { caption: string; index: number } => {
  const captions = [ad.caption, ...(ad.captionVariations ?? [])]
    .map((value) => value.trim()).filter(Boolean);
  if (captions.length === 0) return { caption: "", index: -1 };
  if (captions.length === 1) return { caption: captions[0], index: 0 };
  const previous = ad.lastVariationIndex ?? -1;
  const choice = randomInt(captions.length - 1);
  const index = previous >= 0 && previous < captions.length && choice >= previous
    ? choice + 1 : choice;
  return { caption: captions[index], index };
};
