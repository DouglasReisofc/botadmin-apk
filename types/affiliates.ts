export type AffiliateProviderKey =
  | "mercadolivre"
  | "shopee"
  | "amazon"
  | "magalu"
  | "natura"
  | "shein"
  | "avon";

export type AffiliateConnectionStatus =
  | "not_connected"
  | "connected"
  | "expired"
  | "error"
  | "unavailable";

export type AffiliateProviderSummary = {
  provider: AffiliateProviderKey;
  label: string;
  description: string;
  logoUrl: string | null;
  enabled: boolean;
  supportsOAuth: boolean;
  implemented: boolean;
  status: AffiliateConnectionStatus;
  connected: boolean;
  accountId: string | null;
  accountName: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
  scopes: string[];
  selectedConnectionId: number | null;
  accounts: AffiliateProviderAccountSummary[];
};

export type AffiliateProviderAccountSummary = {
  id: number;
  provider: AffiliateProviderKey;
  accountId: string | null;
  accountName: string | null;
  connected: boolean;
  status: AffiliateConnectionStatus;
  selected: boolean;
  expiresAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
  scopes: string[];
  supportsOAuth: boolean;
};

export type AffiliateOAuthStartResult = {
  provider: AffiliateProviderKey;
  authorizationUrl: string;
  stateExpiresAt: string;
};

export type AffiliateMercadoLivreLink = {
  id: number;
  itemId: string;
  affiliateUrl: string;
  trackedUrl: string | null;
  trackingToken: string | null;
  categoryId: string | null;
  note: string | null;
  couponCode: string | null;
  couponDetails: string | null;
  title: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  priceAmount: number | null;
  priceFormatted: string | null;
  currencyId: string | null;
  commissionRate: string | null;
  ratingStar: string | null;
  available: boolean | null;
  isActive: boolean;
  clickCount: number;
  lastClickAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type AffiliateMlGroupDispatch = {
  id: number;
  groupId: number;
  groupName: string;
  groupStatus: "active" | "disabled" | null;
  groupRemoteId: string;
  instanceId: number;
  enabled: boolean;
  delayMinutes: number;
  categoryRotationEnabled: boolean;
  lastError: string | null;
  lastSentAt: string | null;
  lastItemId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AffiliateMlAutoSyncConfig = {
  provider: "mercadolivre" | "shopee";
  enabled: boolean;
  refreshExisting: boolean;
  discoverNew: boolean;
  targetImportLimit: number;
  intervalMinutes: number;
  discoveryTerms: string[];
  discoveryCategories: string[];
  lastRunAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};
