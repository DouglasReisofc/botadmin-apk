export type PlanGuardTemplateType = "plan" | "instance" | "group";

export type PlanGuardTemplate = {
  caption: string;
  imageUrl: string | null;
  imagePath?: string | null;
};

export type PlanGuardSettings = {
  siteUrl: string | null;
  templates: Record<PlanGuardTemplateType, PlanGuardTemplate>;
  updatedAt: string | null;
};

export type PlanGuardViolationReason =
  | "plan_inactive"
  | "instance_addon_expired"
  | "instance_addon_missing"
  | "group_addon_expired"
  | "group_addon_missing";

export type PlanGuardViolation = {
  type: PlanGuardTemplateType;
  reason: PlanGuardViolationReason;
  planName: string | null;
  planExpiresAt: string | null;
  instance?: {
    id: number;
    name: string | null;
    index: number | null;
    expiresAt: string | null;
    addonExpiresAt: string | null;
  };
  group?: {
    id: number;
    name: string | null;
    slot: number | null;
    expiresAt: string | null;
    addonExpiresAt: string | null;
  };
};

export const PLAN_GUARD_TEMPLATE_TYPES: readonly PlanGuardTemplateType[] = [
  "plan",
  "instance",
  "group",
] as const;
