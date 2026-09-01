import { PHONE_COUNTRIES, matchCountryByPhoneDigits } from "data/phone-countries";
import { HORAPG_DEFAULT_TIMEZONE } from "resources/horapg";

const VALID_TIMEZONE_CACHE = new Map<string, boolean>();

export const isValidTimezone = (value: string): boolean => {
  const cached = VALID_TIMEZONE_CACHE.get(value);
  if (cached !== undefined) {
    return cached;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    VALID_TIMEZONE_CACHE.set(value, true);
    return true;
  } catch {
    VALID_TIMEZONE_CACHE.set(value, false);
    return false;
  }
};

export const normalizeTimezoneInput = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return isValidTimezone(trimmed) ? trimmed : null;
};

export const inferTimezoneFromWhatsapp = (whatsapp: string | null | undefined): string | null => {
  if (!whatsapp) {
    return null;
  }
  const digits = whatsapp.replace(/[^0-9]/g, "");
  if (!digits) {
    return null;
  }
  const country = matchCountryByPhoneDigits(digits);
  return country?.defaultTimezone ?? null;
};

export const listTimezoneSuggestions = (): { value: string; label: string }[] => {
  const suggestions = new Map<string, string>();
  const pushOption = (value: string, label: string) => {
    if (!isValidTimezone(value)) {
      return;
    }
    if (!suggestions.has(value)) {
      suggestions.set(value, label);
    }
  };

  pushOption("UTC", "UTC (Tempo Universal Coordenado)");
  pushOption("America/Sao_Paulo", "UTC-03:00 — Brasília / São Paulo");
  pushOption("America/Maceio", "UTC-03:00 — Nordeste (Maceió)");
  pushOption("America/Fortaleza", "UTC-03:00 — Nordeste (Fortaleza)");
  pushOption("America/Bahia", "UTC-03:00 — Bahia / Salvador");
  pushOption("America/Manaus", "UTC-04:00 — Manaus");
  pushOption("America/Boa_Vista", "UTC-04:00 — Boa Vista / Roraima");
  pushOption("America/Cuiaba", "UTC-04:00 — Cuiabá / Mato Grosso");
  pushOption("America/Rio_Branco", "UTC-05:00 — Rio Branco / Acre");
  pushOption("America/New_York", "UTC-05:00 — Estados Unidos (Nova Iorque)");
  pushOption("Europe/Lisbon", "UTC+00:00 — Portugal (Lisboa)");
  pushOption("Europe/Madrid", "UTC+01:00 — Espanha (Madrid)");
  pushOption("America/Mexico_City", "UTC-06:00 — México (Cidade do México)");
  pushOption("America/Argentina/Buenos_Aires", "UTC-03:00 — Argentina (Buenos Aires)");

  for (const country of PHONE_COUNTRIES) {
    pushOption(country.defaultTimezone, `${country.label} (${country.defaultTimezone})`);
    for (const alt of country.alternateTimezones ?? []) {
      pushOption(alt, `${country.label} (${alt})`);
    }
  }

  return Array.from(suggestions.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
};

export const resolveTimezonePreference = ({
  preferred = [],
  ownerTimezone,
  ownerWhatsapp,
  fallback,
}: {
  preferred?: Array<string | null | undefined>;
  ownerTimezone?: string | null | undefined;
  ownerWhatsapp?: string | null | undefined;
  fallback?: string | null | undefined;
} = {}): string => {
  for (const candidate of preferred) {
    const normalized = normalizeTimezoneInput(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const ownerNormalized = normalizeTimezoneInput(ownerTimezone);
  if (ownerNormalized) {
    return ownerNormalized;
  }

  const inferred = inferTimezoneFromWhatsapp(ownerWhatsapp);
  if (inferred && isValidTimezone(inferred)) {
    return inferred;
  }

  const fallbackNormalized = normalizeTimezoneInput(fallback);
  if (fallbackNormalized) {
    return fallbackNormalized;
  }

  return HORAPG_DEFAULT_TIMEZONE;
};

type DatePartValue = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const buildFormatter = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

export const describeDateInTimezone = (date: Date, timezone: string): DatePartValue => {
  const formatter = buildFormatter(timezone);
  const parts = formatter.formatToParts(date);

  const toNumber = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number.parseInt(value, 10);
  };

  const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  const weekdayLabel = weekdayFormatter.format(date).toLowerCase();
  const weekday = WEEKDAY_INDEX[weekdayLabel.slice(0, 3)] ?? 0;

  return {
    year: toNumber("year"),
    month: toNumber("month"),
    day: toNumber("day"),
    hour: toNumber("hour"),
    minute: toNumber("minute"),
    second: toNumber("second"),
    weekday,
  };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const formatMonthKey = (date: Date, timezone: string): string => {
  const parts = describeDateInTimezone(date, timezone);
  return `${parts.year}-${pad2(parts.month)}`;
};

export const formatWeekKey = (date: Date, timezone: string): string => {
  const parts = describeDateInTimezone(date, timezone);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const weekYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekYear}-W${pad2(weekNumber)}`;
};

const getTimezoneOffsetMinutes = (date: Date, timezone: string): number => {
  // Do not feed a localized string back into `new Date()`: that string is
  // interpreted in the server's own timezone and returns a wrong zero offset
  // whenever the VPS happens to use the same zone as the schedule.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const localClockAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((date.getTime() - localClockAsUtc) / 60000);
};

export const convertTimezoneLocalToUtc = (
  timezone: string,
  date: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
): Date => {
  const hour = Number.isFinite(date.hour) ? Number(date.hour) : 0;
  const minute = Number.isFinite(date.minute) ? Number(date.minute) : 0;
  const second = Number.isFinite(date.second) ? Number(date.second) : 0;

  let seed = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(seed), timezone);
    const nextSeed = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second) + offsetMinutes * 60_000;
    if (Math.abs(nextSeed - seed) < 500) {
      seed = nextSeed;
      break;
    }
    seed = nextSeed;
  }
  return new Date(seed);
};

export const addDaysInTimezone = (reference: Date, timezone: string, days: number): DatePartValue => {
  const { year, month, day } = describeDateInTimezone(reference, timezone);
  const midnight = convertTimezoneLocalToUtc(timezone, {
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    second: 0,
  });
  const candidate = new Date(midnight.getTime() + days * 24 * 60 * 60 * 1000);
  return describeDateInTimezone(candidate, timezone);
};
