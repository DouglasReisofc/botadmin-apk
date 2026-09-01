export type SubscriptionPlan = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  addonInstancePrice: number;
  addonGroupPrice: number;
  groupLimit: number;
  instanceLimit: number;
  allowFlows: boolean;
  storageQuotaGb: number;
  durationDays: number;
  isActive: boolean;
  /** Feature flags/limits exposed to partner and client entitlement checks. */
  features: Record<string, boolean | number>;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionPlanPayload = {
  name: string;
  description?: string | null;
  price: number;
  addonInstancePrice: number;
  addonGroupPrice: number;
  groupLimit: number;
  instanceLimit: number;
  allowFlows: boolean;
  storageQuotaGb: number;
  durationDays: number;
  isActive: boolean;
  features?: Record<string, boolean | number>;
};

export type UserPlanStatus = {
  planId: number | null;
  subscriptionId: number | null;
  plan: SubscriptionPlan | null;
  status: 'inactive' | 'pending' | 'active' | 'expired' | 'cancelled';
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  autoRenewPlan: boolean;
  isTrial: boolean;
  trialEndsAt: string | null;
  trialDurationHours: number | null;
};

export type PlanAddonType = 'instance' | 'group';

export type PlanAddonSelection = {
  type: PlanAddonType;
  quantity: number;
};

export type UserPlanAddon = {
  id: number;
  userId: number;
  subscriptionId: number | null;
  type: PlanAddonType;
  quantity: number;
  purchasedAt: string;
  expiresAt: string | null;
  autoRenew: boolean;
  metadata: Record<string, unknown> | null;
};

export type UserPlanLimits = {
  instanceLimit: number;
  groupLimit: number;
};

export type PlanCheckoutPayload = {
  planId: number;
  provider: 'mercadopago_pix' | 'mercadopago_checkout' | 'polopag_pix';
  addons?: PlanAddonSelection[];
};

export type PlanCheckoutAddonLine = {
  type: PlanAddonType;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type PlanCheckoutBreakdown = {
  baseAmount: number;
  addonsTotal: number;
  totalAmount: number;
  addons: PlanCheckoutAddonLine[];
  proxyAmount?: number;
  proxyLabel?: string;
};

export type PlanCheckoutResponse = {
  paymentId: string;
  providerPaymentId: string;
  provider: 'mercadopago_pix' | 'mercadopago_checkout' | 'polopag_pix';
  amount: number;
  breakdown: PlanCheckoutBreakdown;
  ticketUrl: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  expiresAt: string | null;
};
