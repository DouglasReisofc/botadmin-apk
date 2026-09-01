export const META_PROFILE_VERTICAL_OPTIONS = [
  { value: "OTHER", label: "Outro" },
  { value: "AUTO", label: "Automotivo" },
  { value: "BEAUTY", label: "Beleza" },
  { value: "APPAREL", label: "Moda e vestuário" },
  { value: "EDU", label: "Educação" },
  { value: "ENTERTAIN", label: "Entretenimento" },
  { value: "EVENT_PLAN", label: "Eventos" },
  { value: "FINANCE", label: "Serviços financeiros" },
  { value: "GROCERY", label: "Mercados" },
  { value: "GOVT", label: "Governo" },
  { value: "HOTEL", label: "Hotéis e hospedagem" },
  { value: "HEALTH", label: "Saúde" },
  { value: "NONPROFIT", label: "Organizações sem fins lucrativos" },
  { value: "PROF_SERVICES", label: "Serviços profissionais" },
  { value: "RETAIL", label: "Varejo" },
  { value: "TRAVEL", label: "Viagens" },
  { value: "RESTAURANT", label: "Restaurantes" },
  { value: "ALCOHOL", label: "Bebidas alcoólicas" },
  { value: "ONLINE_GAMBLING", label: "Jogos de azar online" },
  { value: "PHYSICAL_GAMBLING", label: "Jogos de azar presenciais" },
  { value: "OTC_DRUGS", label: "Medicamentos sem prescrição" },
] as const;

export type MetaProfileVerticalOption = (typeof META_PROFILE_VERTICAL_OPTIONS)[number];
export type MetaProfileVerticalValue = MetaProfileVerticalOption["value"];

export const META_PROFILE_VERTICAL_VALUES = new Set<MetaProfileVerticalValue>(
  META_PROFILE_VERTICAL_OPTIONS.map((option) => option.value),
);

export const DEFAULT_META_PROFILE_VERTICAL: MetaProfileVerticalValue = "OTHER";

const META_PROFILE_VERTICAL_ALIASES: Record<string, MetaProfileVerticalValue> = {
  UNDEFINED: "OTHER",
  EDUCATION: "EDU",
  ENTERTAINMENT: "ENTERTAIN",
  EVENT_PLANNING: "EVENT_PLAN",
  FINANCE: "FINANCE",
  GROCERY: "GROCERY",
  GOVERNMENT: "GOVT",
  HOTEL_AND_LODGING: "HOTEL",
  MEDICAL_HEALTH: "HEALTH",
  NON_PROFIT: "NONPROFIT",
  NONPROFIT: "NONPROFIT",
  PROFESSIONAL_SERVICES: "PROF_SERVICES",
  PROF_SERVICES: "PROF_SERVICES",
  PUBLIC_SERVICE: "GOVT",
  SPORTS_RECREATION: "ENTERTAIN",
};

export const normalizeMetaProfileVertical = (
  value: unknown,
): MetaProfileVerticalValue | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const upper = trimmed.toUpperCase();

  if (META_PROFILE_VERTICAL_VALUES.has(upper as MetaProfileVerticalValue)) {
    return upper as MetaProfileVerticalValue;
  }

  const alias = META_PROFILE_VERTICAL_ALIASES[upper];

  return alias ?? null;
};

export const coerceMetaProfileVertical = (
  value: unknown,
  fallback: MetaProfileVerticalValue = DEFAULT_META_PROFILE_VERTICAL,
): MetaProfileVerticalValue => normalizeMetaProfileVertical(value) ?? fallback;
