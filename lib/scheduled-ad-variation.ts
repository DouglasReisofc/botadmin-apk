import { randomInt } from "node:crypto";
import type { BotGroupAd } from "types/bot-groups";

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
