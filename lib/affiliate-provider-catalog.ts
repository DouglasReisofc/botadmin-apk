import type { AffiliateProviderKey } from "types/affiliates";

export type AffiliateProviderCatalogEntry = {
  key: AffiliateProviderKey;
  label: string;
  description: string;
  logoUrl: string | null;
  supportsOAuth: boolean;
  implemented: boolean;
  enabledByDefault: boolean;
  aliases: string[];
  oauthDefaults?: {
    authEndpoint: string;
    tokenEndpoint: string;
    redirectUriPath: string;
    scopeText: string;
  };
};

export const AFFILIATE_PROVIDER_CATALOG: Record<AffiliateProviderKey, AffiliateProviderCatalogEntry> = {
  mercadolivre: {
    key: "mercadolivre",
    label: "Mercado Livre",
    description: "Conecte sua conta para automacao com links e produtos de afiliados.",
    logoUrl: "/affiliates/mercadolivre.svg",
    supportsOAuth: true,
    implemented: true,
    enabledByDefault: true,
    aliases: ["mercadolivre", "meli", "ml", "mercado-livre"],
    oauthDefaults: {
      authEndpoint: "https://auth.mercadolivre.com.br/authorization",
      tokenEndpoint: "https://api.mercadolibre.com/oauth/token",
      redirectUriPath: "/webhook/ml",
      scopeText: "offline_access read write",
    },
  },
  shopee: {
    key: "shopee",
    label: "Shopee",
    description: "Conecte a Open API da Shopee para importar produtos e automatizar disparos de afiliados.",
    logoUrl: "/affiliates/shopee.svg",
    supportsOAuth: false,
    implemented: true,
    enabledByDefault: true,
    aliases: ["shopee", "shop"],
  },
  amazon: {
    key: "amazon",
    label: "Amazon",
    description: "Integracao em preparacao para futuros lancamentos.",
    logoUrl: "/affiliates/amazon.svg",
    supportsOAuth: false,
    implemented: false,
    enabledByDefault: false,
    aliases: ["amazon"],
  },
  magalu: {
    key: "magalu",
    label: "Magalu",
    description: "Integracao em preparacao para futuros lancamentos.",
    logoUrl: "/affiliates/magalu.svg",
    supportsOAuth: false,
    implemented: false,
    enabledByDefault: false,
    aliases: ["magalu", "magazine-luiza", "magazineluiza"],
  },
  natura: {
    key: "natura",
    label: "Natura",
    description: "Integracao em preparacao para futuros lancamentos.",
    logoUrl: "/affiliates/natura.svg",
    supportsOAuth: false,
    implemented: false,
    enabledByDefault: false,
    aliases: ["natura"],
  },
  shein: {
    key: "shein",
    label: "Shein",
    description: "Integracao em preparacao para futuros lancamentos.",
    logoUrl: "/affiliates/shein.svg",
    supportsOAuth: false,
    implemented: false,
    enabledByDefault: false,
    aliases: ["shein"],
  },
  avon: {
    key: "avon",
    label: "Avon",
    description: "Integracao em preparacao para futuros lancamentos.",
    logoUrl: "/affiliates/avon.svg",
    supportsOAuth: false,
    implemented: false,
    enabledByDefault: false,
    aliases: ["avon"],
  },
};

export const AFFILIATE_PROVIDER_ORDER = Object.keys(AFFILIATE_PROVIDER_CATALOG) as AffiliateProviderKey[];

export const resolveAffiliateProviderKey = (providerRaw: string): AffiliateProviderKey | null => {
  const normalized = String(providerRaw || "").trim().toLowerCase();
  if (!normalized) return null;
  for (const provider of AFFILIATE_PROVIDER_ORDER) {
    const entry = AFFILIATE_PROVIDER_CATALOG[provider];
    if (entry.aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return provider;
    }
  }
  return null;
};
