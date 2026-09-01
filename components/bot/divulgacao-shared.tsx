import type { DivulgacaoGroupCandidate, DivulgacaoInspectionResult } from "types/divulgacao";

const parseNumber = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeText = (value: unknown, fallback = ""): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
};

const firstStringValue = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

export const extractGroupImage = (source?: Record<string, unknown> | null): string | null => {
  if (!source) {
    return null;
  }
  const thumbKeys = ["ProfilePicThumbObj", "profilePicThumbObj", "profilePicThumb", "picThumb"];
  for (const key of thumbKeys) {
    const nested = source[key];
    if (nested && typeof nested === "object") {
      const nestedRecord = nested as Record<string, unknown>;
      const nestedUrl = firstStringValue(
        nestedRecord.eurl,
        nestedRecord.Eurl,
        nestedRecord.url,
        nestedRecord.Url,
        nestedRecord.link,
        nestedRecord.thumb,
      );
      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }
  const directKeys = [
    "imageUrl",
    "image_url",
    "img",
    "image",
    "cover",
    "thumbnail",
    "thumb",
    "avatar",
    "icon",
    "photo",
    "pic",
    "picture",
    "logo",
    "photoUrl",
    "picUrl",
    "ProfilePicThumb",
    "profilePicThumb",
    "ProfilePicUrl",
    "profilePicUrl",
    "ProfilePicture",
    "profilePicture",
  ];
  for (const key of directKeys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

export const normalizeCandidate = (
  record: Record<string, unknown>,
  index: number,
): DivulgacaoGroupCandidate | null => {
  const inviteSource =
    normalizeText(record.whatsappUrl, "") ||
    normalizeText(record.joinUrl, "") ||
    normalizeText(record.link, "") ||
    normalizeText(record.url, "") ||
    normalizeText(record.invite, "") ||
    normalizeText(record.invitelink, "");
  const match = inviteSource.match(/chat\.whatsapp\.com\/([A-Za-z0-9-_]+)/i);
  const inviteCode = match?.[1] ?? inviteSource.split("/").pop();
  if (!inviteSource || !inviteCode) {
    return null;
  }
  const title =
    normalizeText(record.title, "") ||
    normalizeText(record.nome, "") ||
    normalizeText(record.name, "") ||
    normalizeText(record.titulo, `Grupo ${index + 1}`);
  const description =
    normalizeText(record.description, "") ||
    normalizeText(record.detail, "") ||
    normalizeText(record.descricao, "") ||
    normalizeText(record.text, "") ||
    "Grupo público sem descrição informada.";

  const rawCategories = record.categories ?? record.tags ?? record.categorias ?? record.category;
  const categories: string[] = [];
  if (Array.isArray(rawCategories)) {
    rawCategories.forEach((entry) => {
      if (typeof entry === "string" && entry.trim()) {
        categories.push(entry.trim());
      }
    });
  } else if (typeof rawCategories === "string") {
    rawCategories.split(/[;,|]/g).forEach((entry) => {
      if (entry.trim()) {
        categories.push(entry.trim());
      }
    });
  }

  const imageUrl = extractGroupImage(record);

  const language =
    normalizeText(record.language, "") ||
    normalizeText(record.lang, "") ||
    normalizeText(record.idioma, "") ||
    null;
  const region =
    normalizeText(record.region, "") ||
    normalizeText(record.country, "") ||
    normalizeText(record.pais, "") ||
    null;
  const members =
    parseNumber(record.members) ??
    parseNumber(record.memberCount) ??
    parseNumber(record.participants) ??
    null;

  return {
    id: record.id ? String(record.id) : `candidate-${index}-${inviteCode}`,
    title,
    description,
    inviteCode,
    inviteLink: inviteSource,
    imageUrl,
    categories,
    language,
    region,
    members,
    metadata: record,
  };
};

export const buildCandidateFromInspection = (
  inspection: DivulgacaoInspectionResult,
): DivulgacaoGroupCandidate => {
  const raw = (inspection.raw ?? {}) as Record<string, unknown>;
  const title = normalizeText(inspection.groupName, `Grupo ${inspection.inviteCode}`);
  const description =
    normalizeText(raw.Topic, "") ||
    normalizeText(raw.topic, "") ||
    normalizeText(raw.description, "") ||
    normalizeText(raw.Detail, "") ||
    "Grupo importado manualmente.";
  const imageUrl = extractGroupImage(raw);
  const members = typeof inspection.memberCount === "number" ? inspection.memberCount : null;
  return {
    id: `manual-${inspection.inviteCode}`,
    title,
    description,
    inviteCode: inspection.inviteCode,
    inviteLink: inspection.inviteLink,
    imageUrl,
    members,
    metadata: {
      ...raw,
      source: "inspection",
      inspectedAt: inspection.inspectedAt,
    },
  };
};

export const extractInviteLinksFromText = (input: string): { inviteCode: string; inviteLink: string }[] => {
  const results: { inviteCode: string; inviteLink: string }[] = [];
  const seen = new Set<string>();
  const regex = /(https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9-_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    const code = match[2];
    if (!code) {
      continue;
    }
    const raw = match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      continue;
    }
    if (seen.has(normalizedCode.toLowerCase())) {
      continue;
    }
    seen.add(normalizedCode.toLowerCase());
    results.push({ inviteCode: normalizedCode, inviteLink: raw });
  }
  return results;
};

export const normalizeInviteKey = (inviteCode: string): string => inviteCode.trim().toLowerCase();

export const resolveGroupImage = (
  group: { imageUrl?: string | null; metadata?: Record<string, unknown> } & {
    inspection?: DivulgacaoInspectionResult | null;
  },
): string | null => {
  if (typeof group.imageUrl === "string" && group.imageUrl.trim()) {
    return group.imageUrl.trim();
  }
  if (group.inspection?.raw && typeof group.inspection.raw === "object") {
    const fromInspection = extractGroupImage(group.inspection.raw as Record<string, unknown>);
    if (fromInspection) {
      return fromInspection;
    }
  }
  if (group.metadata) {
    const fromMetadata = extractGroupImage(group.metadata);
    if (fromMetadata) {
      return fromMetadata;
    }
  }
  return null;
};
