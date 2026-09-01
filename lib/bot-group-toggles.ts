import type { BotGroupSettings } from "types/bot-groups";

const normalizeToggleValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "nao", "não", "off"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
};

type ToggleSideEffects = {
  commandToggles: Record<string, boolean>;
  topLevel: Partial<Pick<BotGroupSettings, "antilink" | "antilinkGroupInvite" | "banExtremo">>;
  featureFlags: Record<string, boolean>;
};

const applySideEffects = (
  key: string,
  value: boolean,
  sideEffects: ToggleSideEffects,
) => {
  switch (key) {
    case "antilink":
      sideEffects.topLevel.antilink = value;
      break;
    case "antilinkgp":
      sideEffects.topLevel.antilinkGroupInvite = value;
      break;
    case "banextremo":
      sideEffects.topLevel.banExtremo = value;
      break;
    case "antipalavras":
      sideEffects.featureFlags.antipalavras = value;
      break;
    case "bangringos":
      sideEffects.featureFlags.bangringos = value;
      break;
    case "soadm":
      sideEffects.featureFlags.soadm = value;
      break;
    case "antinsfwimagem":
      sideEffects.featureFlags.antinsfwimagem = value;
      break;
    case "proibirnsfw":
      sideEffects.featureFlags.proibirnsfw = value;
      break;
    default:
      break;
  }
};

export const buildCommandToggleUpdate = (
  rawToggles: Record<string, unknown>,
): ToggleSideEffects => {
  const sideEffects: ToggleSideEffects = {
    commandToggles: {},
    topLevel: {},
    featureFlags: {},
  };

  for (const [rawKey, rawValue] of Object.entries(rawToggles ?? {})) {
    const normalizedKey = String(rawKey ?? "").trim().toLowerCase();
    if (!normalizedKey) {
      continue;
    }

    const value = normalizeToggleValue(rawValue);
    if (value === undefined) {
      continue;
    }

    sideEffects.commandToggles[normalizedKey] = value;
    applySideEffects(normalizedKey, value, sideEffects);
  }

  return sideEffects;
};

export const mergeToggleSideEffects = (
  target: Partial<Omit<BotGroupSettings, "groupId" | "createdAt" | "updatedAt">>,
  sideEffects: ToggleSideEffects,
) => {
  if (Object.keys(sideEffects.commandToggles).length > 0) {
    target.commandToggles = sideEffects.commandToggles;
  }

  if (sideEffects.topLevel.antilink !== undefined) {
    target.antilink = sideEffects.topLevel.antilink;
  }
  if (sideEffects.topLevel.antilinkGroupInvite !== undefined) {
    target.antilinkGroupInvite = sideEffects.topLevel.antilinkGroupInvite;
  }
  if (sideEffects.topLevel.banExtremo !== undefined) {
    target.banExtremo = sideEffects.topLevel.banExtremo;
  }

  if (Object.keys(sideEffects.featureFlags).length > 0) {
    target.featureFlags = {
      ...(target.featureFlags ?? {}),
      ...sideEffects.featureFlags,
    };
  }
};
