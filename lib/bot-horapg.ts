import crypto from "crypto";

import type { BotGroupHorapgConfig } from "types/bot-groups";
import { HORAPG_DEFAULT_TIMEZONE, HORAPG_IMAGE_FALLBACK_URL } from "resources/horapg";

const HORAPG_TIMEZONE = process.env.HORAPG_TIMEZONE ?? HORAPG_DEFAULT_TIMEZONE;

export const HORAPG_DEFAULT_IMAGE_URL =
  process.env.HORAPG_DEFAULT_IMAGE_URL ??
  HORAPG_IMAGE_FALLBACK_URL;

const HORAPG_PLATFORMS = [
  "🐯 FORTUNE TIGER",
  "🐉 DRAGON LUCK",
  "🐰 FORTUNE RABBIT",
  "🐭 FORTUNE MOUSE",
  "🐘 GANESHA GOLD",
  "👙 BIKINI",
  "🥊 MUAY THAI",
  "🎪 CIRCUS",
  "🐂 FORTUNE OX",
  "💰 DOUBLE FORTUNE",
  "🐉🐅 DRAGON TIGER LUCK",
  "🧞 GENIE'S WISHES (GÊNIO)",
  "🌳🌲 JUNGLE DELIGHT",
  "🐷 PIGGY GOLD",
  "👑 MIDAS FORTUNE",
  "🌞🌛 SUN & MOON",
  "🦹‍♂️ WILD BANDITO",
  "🔥🕊️ PHOENIX RISES",
  "🛒 SUPERMARKET SPREE",
  "🚢👨‍✈️ CAPTAIN BOUNTY",
  "🎃 MISTER HALLOWEEN",
  "🍀💰 LEPRECHAUN RICHES",
] as const;

export type HorapgScheduleEntry = {
  name: string;
  times: string[];
};

export type HorapgGenerateOptions = {
  baseDate?: Date;
  timezone?: string;
  randomSeed?: string;
  platforms?: readonly string[];
  perPlatformCount?: number;
};

type TimezoneContext = {
  dateIso: string;
  hour: number;
  minute: number;
  clock: string;
};

const getTimezoneContext = (date: Date, timezone: string): TimezoneContext => {
  const formatterDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatterTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const dateParts = formatterDate
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  const timeParts = formatterTime
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  const hour = Number.parseInt(timeParts.hour ?? "0", 10);
  const minute = Number.parseInt(timeParts.minute ?? "0", 10);
  const dateIso = `${dateParts.year ?? "0000"}-${dateParts.month ?? "01"}-${dateParts.day ?? "01"}`;

  return {
    dateIso,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    clock: `${(timeParts.hour ?? "00").padStart(2, "0")}:${(timeParts.minute ?? "00").padStart(2, "0")}`,
  };
};

const createRandom = (seed: string | null | undefined): (() => number) => {
  if (!seed) {
    return Math.random;
  }

  let state = crypto.createHash("sha256").update(seed).digest();
  return () => {
    state = crypto.createHash("sha256").update(state).digest();
    const value = state.readUInt32BE(0);
    return value / 0xffffffff;
  };
};

const randomMinuteToken = (rng: () => number): string => {
  const minute = Math.floor(rng() * 60);
  return minute.toString().padStart(2, "0");
};

export const generateHorapgSchedule = (
  options: HorapgGenerateOptions = {},
): { context: TimezoneContext; entries: HorapgScheduleEntry[]; message: string } => {
  const baseDate = options.baseDate ?? new Date();
  const timezone = options.timezone || HORAPG_TIMEZONE;
  const context = getTimezoneContext(baseDate, timezone);
  const hourToken = context.hour.toString().padStart(2, "0");
  const rng = createRandom(options.randomSeed ?? `${context.dateIso}-${context.clock}`);

  const platforms = options.platforms ?? HORAPG_PLATFORMS;
  const itemsPerPlatform = Number.isFinite(options.perPlatformCount)
    ? Math.max(1, Math.floor(options.perPlatformCount ?? 5))
    : 7;

  const entries: HorapgScheduleEntry[] = platforms.map((name) => {
    const times: string[] = [];
    for (let i = 0; i < itemsPerPlatform; i += 1) {
      const first = `${hourToken}:${randomMinuteToken(rng)}`;
      const second = `${hourToken}:${randomMinuteToken(rng)}`;
      times.push(`${first} - ${second}`);
    }
    return { name, times };
  });

  const header = `🍀 *SUGESTÃO DE HORÁRIOS PAGANTES DAS ${hourToken}* 💰`;
  const body = entries
    .map((entry) => {
      const lines = entry.times.map((time) => `   ${time}`).join("\n");
      return `${entry.name}\n${lines}`;
    })
    .join("\n\n");

  const footer =
    "\nDica: alterne entre os giros entre normal e turbo, se vier um Grande Ganho, PARE e espere a próxima brecha!\n" +
    "🔞 NÃO INDICADO PARA MENORES 🔞\n" +
    "Horários de probabilidades aumentam muito sua chance de lucrar, mas lembrando que não anula a chance de perda.\n" +
    "Jogue com responsabilidade.\n\n" +
    "Sistema Bot Admin";

  return {
    context,
    entries,
    message: `${header}\n\n${body}${footer}`,
  };
};

const TIME_TOKEN_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const normalizeHorapgTimeToken = (value: string): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = TIME_TOKEN_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
};

export const parseHorapgTimesArgument = (input: string | string[]): string[] => {
  const tokens: string[] = [];
  const pushToken = (token: string) => {
    const normalized = normalizeHorapgTimeToken(token);
    if (!normalized || tokens.includes(normalized)) {
      return;
    }
    tokens.push(normalized);
  };

  if (Array.isArray(input)) {
    for (const part of input) {
      if (typeof part !== "string") continue;
      part
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach(pushToken);
    }
  } else if (typeof input === "string") {
    input
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach(pushToken);
  }

  return tokens.slice(0, 12);
};

export const shouldDispatchHorapgAt = (
  config: BotGroupHorapgConfig,
  date: Date,
  options: { timezone?: string } = {},
): { run: boolean; clock: string; context: TimezoneContext } => {
  if (!config.enabled) {
    return { run: false, clock: "", context: getTimezoneContext(date, options.timezone ?? HORAPG_TIMEZONE) };
  }
  const timezone = options.timezone || config.timezone || HORAPG_TIMEZONE;
  const context = getTimezoneContext(date, timezone);
  if (!config.times || config.times.length === 0) {
    return { run: false, clock: context.clock, context };
  }
  const normalizedTimes = config.times.map((token) => normalizeHorapgTimeToken(token)).filter(Boolean);
  if (!normalizedTimes.includes(context.clock)) {
    return { run: false, clock: context.clock, context };
  }
  const sentTimes = config.sentTimes ?? {};
  const lastSentForClock = sentTimes[context.clock];
  if (lastSentForClock === context.dateIso) {
    return { run: false, clock: context.clock, context };
  }
  return { run: true, clock: context.clock, context };
};

export const markHorapgDispatch = (
  config: BotGroupHorapgConfig,
  clock: string,
  context: TimezoneContext,
): BotGroupHorapgConfig => {
  const sentTimes: Record<string, string> = { ...(config.sentTimes ?? {}) };
  sentTimes[clock] = context.dateIso;
  return {
    ...config,
    lastSentAt: new Date().toISOString(),
    sentTimes,
  };
};

export type HorapgTimezoneContext = TimezoneContext;
