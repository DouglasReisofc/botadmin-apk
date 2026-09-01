import rawCountries from "resources/phone-country-codes.json";

type RawPhoneCountryEntry = {
  country: string;
  dial_code: string;
};

type RawPhoneCountryMap = Record<string, RawPhoneCountryEntry>;

export type PhoneCountry = {
  iso2: string;
  name: string;
  dialCode: string;
};

const sanitizeCountryName = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/\s(of|the)\s/gi, (match) => match.toLowerCase())
    .trim();

const sanitizeDialCode = (value: string): string => value.replace(/\D+/g, "");

const rawMap = rawCountries as RawPhoneCountryMap;

const buildPhoneCountry = (iso2: string, entry: RawPhoneCountryEntry): PhoneCountry | null => {
  const dialCode = sanitizeDialCode(entry?.dial_code ?? "");
  if (!dialCode) {
    return null;
  }
  const name = sanitizeCountryName(entry?.country ?? iso2);
  return {
    iso2,
    name,
    dialCode,
  };
};

export const PHONE_COUNTRIES: PhoneCountry[] = Object.entries(rawMap)
  .map(([iso2, entry]) => buildPhoneCountry(iso2, entry))
  .filter((entry): entry is PhoneCountry => Boolean(entry))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

export const PHONE_COUNTRY_MAP = new Map<string, PhoneCountry>(
  PHONE_COUNTRIES.map((entry) => [entry.iso2, entry]),
);

export const DEFAULT_PHONE_COUNTRY_ISO = "BR";

export const DEFAULT_PHONE_COUNTRY =
  PHONE_COUNTRY_MAP.get(DEFAULT_PHONE_COUNTRY_ISO) ?? PHONE_COUNTRIES[0];

export const findPhoneCountryByIso = (iso2: string | null | undefined): PhoneCountry | null =>
  iso2 ? PHONE_COUNTRY_MAP.get(iso2.toUpperCase()) ?? null : null;

export const formatPhoneCountryLabel = (country: PhoneCountry): string =>
  `+${country.dialCode} · ${country.name} (${country.iso2})`;
