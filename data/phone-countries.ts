export type PhoneCountry = {
  code: string;
  label: string;
  dialCode: string;
  defaultTimezone: string;
  alternateTimezones?: string[];
};

export const PHONE_COUNTRIES: PhoneCountry[] = [
  {
    code: "BR",
    label: "Brasil",
    dialCode: "+55",
    defaultTimezone: "America/Sao_Paulo",
    alternateTimezones: ["America/Manaus", "America/Belem", "America/Fortaleza", "America/Bahia", "America/Rio_Branco"],
  },
  {
    code: "PT",
    label: "Portugal",
    dialCode: "+351",
    defaultTimezone: "Europe/Lisbon",
    alternateTimezones: ["Atlantic/Madeira", "Atlantic/Azores"],
  },
  {
    code: "US",
    label: "Estados Unidos",
    dialCode: "+1",
    defaultTimezone: "America/New_York",
    alternateTimezones: ["America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu"],
  },
  {
    code: "ES",
    label: "Espanha",
    dialCode: "+34",
    defaultTimezone: "Europe/Madrid",
    alternateTimezones: ["Atlantic/Canary"],
  },
  {
    code: "MX",
    label: "México",
    dialCode: "+52",
    defaultTimezone: "America/Mexico_City",
    alternateTimezones: ["America/Monterrey", "America/Cancun", "America/Tijuana"],
  },
  {
    code: "AR",
    label: "Argentina",
    dialCode: "+54",
    defaultTimezone: "America/Argentina/Buenos_Aires",
  },
];

const SORTED_COUNTRIES = [...PHONE_COUNTRIES].sort(
  (a, b) => b.dialCode.replace(/\D/g, "").length - a.dialCode.replace(/\D/g, "").length,
);

export const findCountryByDialCode = (dialCode: string): PhoneCountry | null => {
  const normalized = dialCode.trim();
  if (!normalized) {
    return null;
  }
  return SORTED_COUNTRIES.find((country) => country.dialCode === normalized) ?? null;
};

export const matchCountryByPhoneDigits = (digits: string): PhoneCountry | null => {
  const normalized = digits.replace(/[^0-9]/g, "");
  if (!normalized) {
    return null;
  }
  return SORTED_COUNTRIES.find((country) =>
    normalized.startsWith(country.dialCode.replace(/\D/g, "")),
  ) ?? null;
};

export const inferDefaultTimezoneFromDialCode = (dialCode: string): string | null => {
  const country = findCountryByDialCode(dialCode);
  return country?.defaultTimezone ?? null;
};
