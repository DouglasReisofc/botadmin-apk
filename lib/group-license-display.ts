const GROUP_LICENSE_SOURCE_LABELS: Record<string, string> = {
  bot_resale: "Venda do perfil",
  profile_plan: "Plano do perfil",
  base_plan: "Plano base",
  group_purchase: "Compra legada do grupo",
  group_transfer: "Transferência legada de grupo",
};

const AUTO_PROFILE_GROUP_LICENSE_SOURCES = new Set(["profile_plan", "base_plan"]);

export const isAutoProfileGroupLicenseSource = (value: string | null | undefined): boolean => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return AUTO_PROFILE_GROUP_LICENSE_SOURCES.has(normalized);
};

export const formatGroupLicenseSource = (value: string | null | undefined): string => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return "Origem não definida";
  }
  return GROUP_LICENSE_SOURCE_LABELS[normalized] ?? normalized;
};

export const isGroupLicenseFuture = (
  expiresAt: string | null | undefined,
  now = Date.now(),
): boolean => {
  if (!expiresAt) {
    return false;
  }
  const ts = new Date(expiresAt).getTime();
  return Number.isFinite(ts) && ts > now;
};

export type GroupLicenseStatusSummary = {
  isActive: boolean;
  expiresAt: string | null;
  planName: string | null;
  sourceLabel: string;
  statusLabel: string;
  statusVariant: "success" | "warning" | "secondary";
};

export const buildGroupLicenseStatusSummary = (
  metadata:
    | {
        licenseExpiresAt?: string | null;
        licensePlanName?: string | null;
        licenseSource?: string | null;
      }
    | null
    | undefined,
  now = Date.now(),
): GroupLicenseStatusSummary => {
  const autoProfileLicense = isAutoProfileGroupLicenseSource(metadata?.licenseSource);
  const expiresAt = autoProfileLicense ? null : metadata?.licenseExpiresAt ?? null;
  const isActive = isGroupLicenseFuture(expiresAt, now);

  return {
    isActive,
    expiresAt,
    planName: metadata?.licensePlanName ?? null,
    sourceLabel: formatGroupLicenseSource(metadata?.licenseSource),
    statusLabel: isActive ? "Licença vigente" : expiresAt ? "Licença vencida" : "Sem licença",
    statusVariant: isActive ? "success" : expiresAt ? "warning" : "secondary",
  };
};
