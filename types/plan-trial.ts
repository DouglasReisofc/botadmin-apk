export type PlanTrialDurationUnit = "hours" | "days";

export type PlanTrialSettings = {
  enabled: boolean;
  planId: number | null;
  duration: {
    amount: number;
    unit: PlanTrialDurationUnit;
  };
  modal: {
    title: string;
    message: string;
    steps: string[];
    imageUrl: string | null;
    imagePath?: string | null;
  };
  whatsapp: {
    message: string;
    mediaUrl: string | null;
    mediaPath?: string | null;
  };
  updatedAt: string | null;
};

export type PlanTrialActivationContext = "web_signup" | "admin_bot_signup";

export type PlanTrialActivationResult = {
  applied: boolean;
  expiresAt: string | null;
  durationHours: number | null;
  durationLabel: string | null;
  modal?: {
    title: string;
    message: string;
    steps: string[];
    imageUrl: string | null;
  };
  whatsapp?: {
    message: string | null;
    mediaUrl: string | null;
  };
};

export type PlanTrialTemplateVariable = {
  token: string;
  description: string;
};
