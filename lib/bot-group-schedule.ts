import type { BotGroupScheduleConfig } from "types/bot-groups";
import { HORAPG_DEFAULT_TIMEZONE } from "resources/horapg";
import { normalizeHorapgTimeToken } from "lib/bot-horapg";

export type GroupScheduleContext = {
  dateIso: string;
  hour: number;
  minute: number;
  clock: string;
};

const getTimezoneContext = (date: Date, timezone: string): GroupScheduleContext => {
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const dateParts = dateFormatter
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  const timeParts = timeFormatter
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  const hour = Number.parseInt(timeParts.hour ?? "0", 10);
  const minute = Number.parseInt(timeParts.minute ?? "0", 10);

  return {
    dateIso: `${dateParts.year ?? "0000"}-${dateParts.month ?? "01"}-${dateParts.day ?? "01"}`,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    clock: `${(timeParts.hour ?? "00").padStart(2, "0")}:${(timeParts.minute ?? "00").padStart(2, "0")}`,
  };
};

export type GroupScheduleAction = {
  action: "open" | "close";
  clock: string;
  context: GroupScheduleContext;
  overdueMinutes: number;
  run: boolean;
};

// Reconcile the latest desired state, not every missed transition. Looking at
// the previous local calendar day also recovers a missed 23:00 close at 00:10.
export const getLatestGroupScheduleAction = (
  config: BotGroupScheduleConfig,
  date: Date,
  options: { timezone?: string } = {},
): GroupScheduleAction | null => {
  const context = getTimezoneContext(date, options.timezone || config.timezone || HORAPG_DEFAULT_TIMEZONE);
  const currentMinutes = context.hour * 60 + context.minute;
  const previousDate = new Date(`${context.dateIso}T12:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const candidates: GroupScheduleAction[] = [];
  for (const action of ["open", "close"] as const) {
    if (!config[`${action}Enabled`]) continue;
    for (const value of config[`${action}Times`] ?? []) {
      const clock = normalizeHorapgTimeToken(value);
      if (!clock) continue;
      const [hour, minute] = clock.split(":").map(Number);
      const minutes = hour * 60 + minute;
      const isYesterday = minutes > currentMinutes;
      const dateIso = isYesterday ? previousDate.toISOString().slice(0, 10) : context.dateIso;
      candidates.push({
        action, clock, context: { dateIso, hour, minute, clock },
        overdueMinutes: currentMinutes - minutes + (isYesterday ? 1440 : 0),
        run: config[`${action}SentTimes`]?.[clock] !== dateIso,
      });
    }
  }
  // If conflicting schedules use the same minute, closing takes precedence.
  candidates.sort((a, b) => a.overdueMinutes - b.overdueMinutes || (a.action === b.action ? 0 : a.action === "close" ? -1 : 1));
  return candidates[0] ?? null;
};

const shouldRunAt = (
  enabled: boolean,
  times: string[],
  sentTimes: Record<string, string>,
  date: Date,
  timezone: string | null | undefined,
): { run: boolean; clock: string; context: GroupScheduleContext } => {
  const tz = timezone || HORAPG_DEFAULT_TIMEZONE;
  const context = getTimezoneContext(date, tz);
  if (!enabled || !Array.isArray(times) || times.length === 0) {
    return { run: false, clock: context.clock, context };
  }
  const normalizedTimes = times
    .map((token) => normalizeHorapgTimeToken(token ?? ""))
    .filter((token): token is string => Boolean(token));
  const currentMinutes = context.hour * 60 + context.minute;
  const dueTime = normalizedTimes.find((clock) => {
    const [hour, minute] = clock.split(":").map((value) => Number(value));
    const targetMinutes = hour * 60 + minute;
    // The dispatcher runs every few seconds. A small grace window prevents a
    // restart or a slow database cycle from skipping the configured minute,
    // while still avoiding stale catch-up hours later in the day.
    const elapsed = currentMinutes - targetMinutes;
    return elapsed >= 0 && elapsed <= 3;
  });
  if (!dueTime) {
    return { run: false, clock: context.clock, context };
  }
  const lastSent = sentTimes?.[dueTime];
  if (lastSent === context.dateIso) {
    return { run: false, clock: context.clock, context };
  }
  return { run: true, clock: dueTime, context };
};

export const shouldCloseGroupAt = (
  config: BotGroupScheduleConfig,
  date: Date,
  options: { timezone?: string } = {},
) =>
  shouldRunAt(
    config.closeEnabled,
    config.closeTimes,
    config.closeSentTimes ?? {},
    date,
    options.timezone ?? config.timezone,
  );

export const shouldOpenGroupAt = (
  config: BotGroupScheduleConfig,
  date: Date,
  options: { timezone?: string } = {},
) =>
  shouldRunAt(
    config.openEnabled,
    config.openTimes,
    config.openSentTimes ?? {},
    date,
    options.timezone ?? config.timezone,
  );

export const markCloseDispatch = (
  config: BotGroupScheduleConfig,
  clock: string,
  context: GroupScheduleContext,
): BotGroupScheduleConfig => {
  const sentTimes: Record<string, string> = { ...(config.closeSentTimes ?? {}) };
  sentTimes[clock] = context.dateIso;
  return {
    ...config,
    lastCloseAt: new Date().toISOString(),
    closeSentTimes: sentTimes,
  };
};

export const markOpenDispatch = (
  config: BotGroupScheduleConfig,
  clock: string,
  context: GroupScheduleContext,
): BotGroupScheduleConfig => {
  const sentTimes: Record<string, string> = { ...(config.openSentTimes ?? {}) };
  sentTimes[clock] = context.dateIso;
  return {
    ...config,
    lastOpenAt: new Date().toISOString(),
    openSentTimes: sentTimes,
  };
};
