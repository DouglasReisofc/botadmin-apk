import type { AffiliateProviderKey } from "./affiliates";

export type AdminAffiliateProviderSettings = {
  provider: AffiliateProviderKey;
  label: string;
  description: string;
  logoUrl: string | null;
  supportsOAuth: boolean;
  implemented: boolean;
  enabled: boolean;
  runtimeEnabled: boolean;
  appId: string | null;
  clientSecret: string | null;
  appToken: string | null;
  authEndpoint: string | null;
  tokenEndpoint: string | null;
  redirectUri: string | null;
  scopeText: string | null;
  extractorCookieText: string | null;
  updatedAt: string | null;
};

export type AdminAffiliateProviderUpdatePayload = {
  enabled?: boolean;
  appId?: string | null;
  clientSecret?: string | null;
  appToken?: string | null;
  authEndpoint?: string | null;
  tokenEndpoint?: string | null;
  redirectUri?: string | null;
  scopeText?: string | null;
  extractorCookieText?: string | null;
};
