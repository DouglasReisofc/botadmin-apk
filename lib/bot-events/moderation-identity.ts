import { normalizeJid } from "../whatsapp";

const PHONE_JID_DOMAINS = new Set(["s.whatsapp.net", "c.us"]);

const stripDeviceSuffix = (value: string): string =>
  value.replace(/:[^@]+(?=@)/, "");

export type TrustedPhoneIdentity = {
  digits: string;
  identifier: string;
};

export const isOpaqueWhatsappIdentity = (
  value: string | null | undefined,
): boolean => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.includes("@lid") || normalized.includes("@hosted.lid");
};

/**
 * Returns a phone identity only when the source is an explicit phone field,
 * a regular WhatsApp phone JID, or a plain E.164-like number. Opaque LIDs must
 * never be interpreted as a country-code-bearing phone number.
 */
export const resolveTrustedPhoneIdentity = (
  candidates: Array<string | null | undefined>,
): TrustedPhoneIdentity | null => {
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw || isOpaqueWhatsappIdentity(raw)) {
      continue;
    }

    const identifier = stripDeviceSuffix(raw);
    const atIndex = identifier.lastIndexOf("@");
    if (atIndex >= 0) {
      const domain = identifier.slice(atIndex + 1).toLowerCase();
      if (!PHONE_JID_DOMAINS.has(domain)) {
        continue;
      }
    }

    const digits = normalizeJid(identifier);
    if (digits.length < 7 || digits.length > 15) {
      continue;
    }

    return { digits, identifier };
  }

  return null;
};

const buildPhoneDigitVariants = (
  value: string | null | undefined,
): Set<string> => {
  const digits = normalizeJid(value);
  const variants = new Set<string>();
  if (!digits) {
    return variants;
  }

  variants.add(digits);
  const withoutLeadingZeroes = digits.replace(/^0+/, "");
  if (withoutLeadingZeroes) {
    variants.add(withoutLeadingZeroes);
  }
  if (digits.length > 11) {
    variants.add(digits.slice(-11));
  }
  if (digits.length > 10) {
    variants.add(digits.slice(-10));
  }
  return variants;
};

export const whatsappPhoneIdentitiesOverlap = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => {
  const leftVariants = buildPhoneDigitVariants(left);
  const rightVariants = buildPhoneDigitVariants(right);
  if (leftVariants.size === 0 || rightVariants.size === 0) {
    return false;
  }
  for (const candidate of leftVariants) {
    if (rightVariants.has(candidate)) {
      return true;
    }
  }
  return false;
};

const ADMIN_IDENTITY_KEYS = [
  "PhoneNumber",
  "phoneNumber",
  "PN",
  "pn",
  "phone",
  "Phone",
  "JID",
  "jid",
  "LID",
  "lid",
  "id",
  "Id",
  "ID",
] as const;

/** Registers every equivalent identity exposed for an administrator. */
export const collectAdminIdentityAliases = (
  value: unknown,
  output = new Set<string>(),
  depth = 0,
): Set<string> => {
  if (value === null || value === undefined || depth > 3) {
    return output;
  }
  if (typeof value === "string" || typeof value === "number") {
    const digits = normalizeJid(String(value));
    if (digits) {
      output.add(digits);
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAdminIdentityAliases(entry, output, depth + 1);
    }
    return output;
  }
  if (typeof value !== "object") {
    return output;
  }

  const record = value as Record<string, unknown>;
  for (const key of ADMIN_IDENTITY_KEYS) {
    if (key in record) {
      collectAdminIdentityAliases(record[key], output, depth + 1);
    }
  }
  return output;
};
