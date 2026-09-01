export type SessionUser = {
  id: number;
  name: string;
  email: string | null;
  role: "admin" | "user";
  isActive: boolean;
  whatsappNumber: string | null;
  timezone: string | null;
  avatarUrl: string | null;
  needsCredentialsCompletion: boolean;
  passwordMissing: boolean;
  isImpersonated: boolean;
  impersonatorUserId: number | null;
  canReturnToAdmin: boolean;
  /** Papel no programa de parceiros, quando a conta possui acesso. */
  partnerRole?: "owner" | "master" | "reseller" | "support" | null;
};
