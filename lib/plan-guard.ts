import type { BotInstance } from "types/bot-instances";
import type { BotGroup } from "types/bot-groups";
import type { PlanGuardViolation, PlanGuardTemplateType, PlanGuardViolationReason } from "types/plan-guard";
import { isInstanceProfileLicenseActive } from "lib/bot-instances";
import { formatDateTime } from "lib/format";
import {
  getDefaultPlanGuardCaption,
  getDefaultPlanGuardSettings,
  getPlanGuardSettings,
} from "lib/plan-guard-settings";
import { getAppBaseUrl } from "lib/meta";

const toTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.getTime();
};

const getResourceLabels = (type: PlanGuardTemplateType) => {
  const labels = {
    plan: {
      type: "plano",
      addonLabel: "plano",
    },
    instance: {
      type: "perfil",
      addonLabel: "perfil",
    },
    group: {
      type: "grupo",
      addonLabel: "grupo",
    },
  } as const;
  return labels[type];
};

export type PlanGuardEvaluationResult = PlanGuardViolation | null;

export const evaluatePlanGuard = async (params: {
  userId: number;
  instance: BotInstance;
  group?: BotGroup | null;
}): Promise<PlanGuardEvaluationResult> => {
  const { instance } = params;
  const now = Date.now();

  if (instance.purpose === "admin_system") {
    return null;
  }
  if (isInstanceProfileLicenseActive(instance.expiresAt, now)) {
    return null;
  }

  const instanceExpiryTs = toTimestamp(instance.expiresAt);
  return {
    type: "instance",
    reason:
      instanceExpiryTs !== null && instanceExpiryTs <= now
        ? "instance_addon_expired"
        : "instance_addon_missing",
    planName: null,
    planExpiresAt: null,
    instance: {
      id: instance.id,
      name: instance.name ?? instance.phone ?? null,
      index: null,
      expiresAt: instance.expiresAt,
      addonExpiresAt: instance.expiresAt,
    },
  };
};

export type PlanGuardRenderVariables = {
  caption: string;
  imageUrl: string | null;
  imagePath: string | null;
  siteUrl: string | null;
  replacements: Record<string, string>;
};

const formatExpiryLabel = (
  expiresAt: string | null,
  now = Date.now(),
): { text: string; date: string } => {
  if (!expiresAt) {
    return { text: "sem data registrada", date: "" };
  }
  const ts = toTimestamp(expiresAt);
  if (ts === null) {
    return { text: "sem data registrada", date: "" };
  }
  const formatted = formatDateTime(expiresAt);
  const verb = ts >= now ? "expira em" : "venceu em";
  return { text: `${verb} ${formatted}`, date: formatted ?? "" };
};

const buildViolationContext = (violation: PlanGuardViolation): {
  sourceLabel: string;
  coverageLabel: string;
  expiryText: string;
  expiryDate: string;
} => {
  const now = Date.now();

  switch (violation.type) {
    case "plan": {
      const expiry = formatExpiryLabel(violation.planExpiresAt, now);
      return {
        sourceLabel: "plano principal",
        coverageLabel: "plano principal",
        expiryText: expiry.text,
        expiryDate: expiry.date,
      };
    }
    case "instance": {
      const isAddonIssue =
        violation.reason === "instance_addon_expired" || violation.reason === "instance_addon_missing";
      const sourceLabel = isAddonIssue ? "instância" : "plano principal";
      if (violation.reason === "instance_addon_missing") {
        return {
          sourceLabel,
          coverageLabel: sourceLabel,
          expiryText: "instância vencida",
          expiryDate: "",
        };
      }
      const addonExpiry = violation.instance?.addonExpiresAt ?? null;
      const expiry = formatExpiryLabel(addonExpiry ?? violation.planExpiresAt ?? null, now);
      return {
        sourceLabel,
        coverageLabel: sourceLabel,
        expiryText: expiry.text,
        expiryDate: expiry.date,
      };
    }
	    case "group": {
	      const isAddonIssue =
	        violation.reason === "group_addon_expired" || violation.reason === "group_addon_missing";
	      const sourceLabel = isAddonIssue ? "perfil" : "plano principal";
	      if (violation.reason === "group_addon_missing") {
	        return {
	          sourceLabel,
	          coverageLabel: sourceLabel,
	          expiryText: "perfil vencido",
	          expiryDate: "",
	        };
      }
      const addonExpiry = violation.group?.addonExpiresAt ?? null;
      const expiry = formatExpiryLabel(addonExpiry ?? violation.planExpiresAt ?? null, now);
      return {
        sourceLabel,
        coverageLabel: sourceLabel,
        expiryText: expiry.text,
        expiryDate: expiry.date,
      };
    }
    default:
      return {
        sourceLabel: "plano",
        coverageLabel: "plano",
        expiryText: "sem data registrada",
        expiryDate: "",
      };
  }
};

const replaceTemplateVariables = (template: string, replacements: Record<string, string>): string => {
  return template.replace(/{{\s*([^\s{}]+)\s*}}/g, (_, token: string) => {
    const key = token.trim();
    return replacements[key] ?? "";
  });
};

export const buildPlanGuardMessage = async (params: {
  violation: PlanGuardViolation;
  instance: BotInstance;
  group?: BotGroup | null;
  senderName?: string | null;
}): Promise<PlanGuardRenderVariables> => {
  const { violation, instance, group } = params;
  const settings = await getPlanGuardSettings().catch(() => getDefaultPlanGuardSettings());

  const templateSettings = settings.templates[violation.type];
  const captionTemplate = templateSettings?.caption ?? getDefaultPlanGuardCaption(violation.type);
  const imageUrl = templateSettings?.imageUrl ?? null;
  const imagePath = templateSettings?.imagePath ?? null;
  const siteUrl = settings.siteUrl ?? getAppBaseUrl();

  const contextInfo = buildViolationContext(violation);
  const resourceLabels = getResourceLabels(violation.type);

  const replacements: Record<string, string> = {
    tipo: resourceLabels.type,
    resourceType: resourceLabels.type,
    nome: violation.type === "plan"
      ? violation.planName ?? "seu plano"
      : violation.type === "instance"
        ? violation.instance?.name ?? instance.name ?? instance.phone ?? "instância"
        : violation.group?.name ?? group?.name ?? "grupo",
    resourceName: "",
    nomePlano: violation.planName ?? "seu plano",
    planName: violation.planName ?? "seu plano",
    nomeInstancia: violation.instance?.name ?? instance.name ?? instance.phone ?? "instância",
    instanceName: violation.instance?.name ?? instance.name ?? instance.phone ?? "instância",
    nomeGrupo: violation.group?.name ?? group?.name ?? "grupo",
    groupName: violation.group?.name ?? group?.name ?? "grupo",
    origem: contextInfo.sourceLabel,
    coverageSource: contextInfo.coverageLabel,
    vencimento: contextInfo.expiryText,
    dataVencimento: contextInfo.expiryDate,
    expiresAt: contextInfo.expiryDate,
    siteUrl: siteUrl ?? "",
  };
  replacements.resourceName = replacements.nome;

  const caption = replaceTemplateVariables(captionTemplate, replacements).replace(/\n{3,}/g, "\n\n").trim();

  return {
    caption,
    imageUrl,
    imagePath,
    siteUrl,
    replacements,
  };
};
