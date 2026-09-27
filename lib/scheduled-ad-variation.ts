import { randomInt } from "node:crypto";
import type { BotGroupAd, BotGroupAdMessageVariant } from "types/bot-groups";

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
  const choice = randomInt(snapshots.length - 1);
  const index = previous >= 0 && previous < snapshots.length && choice >= previous
    ? choice + 1 : choice;
  return { message: snapshots[index], index };
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
