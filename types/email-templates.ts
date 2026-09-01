export type EmailTemplateKey =
  | "plan_payment_confirmation"
  | "user_registration"
  | "bot_sale_notification"
  | "generic_notification";

export type AdminEmailTemplate = {
  key: EmailTemplateKey | string;
  name: string;
  subject: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  footerText: string | null;
  updatedAt: string;
};

export type AdminEmailTemplateUpdatePayload = {
  subject: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  footerText?: string | null;
};
