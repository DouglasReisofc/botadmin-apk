export interface AdminHomepageFeature {
  title: string;
  description: string;
}

export interface AdminSiteFaviconAssets {
  rootPath: string | null;
  svgUrl: string | null;
  icoUrl: string | null;
  png16Url: string | null;
  png32Url: string | null;
  png48Url: string | null;
  png96Url: string | null;
  appleTouchIconUrl: string | null;
  androidChrome192Url: string | null;
  androidChrome512Url: string | null;
  manifestUrl: string | null;
}

export interface AdminPanelBanner {
  id: number;
  title: string;
  subtitle: string | null;
  linkUrl: string | null;
  mediaUrl: string;
  mediaPath?: string | null;
  order: number;
  isActive: boolean;
}

export interface AdminTestGroupLink {
  title: string;
  url: string;
}

export interface AdminOfficialGroupLink {
  id: string;
  groupId: number | null;
  instanceId: number;
  remoteId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  inviteLink: string | null;
  inviteUpdatedAt: string | null;
  isActive: boolean;
  order: number;
}

export interface AdminOfficialGroupCandidate {
  groupId: number;
  instanceId: number;
  instanceName: string;
  instancePhone: string;
  userName: string;
  remoteId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  inviteLink: string | null;
  status: string;
  updatedAt: string;
}

export interface AdminSiteSettings {
  siteName: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  faviconAssets: AdminSiteFaviconAssets | null;
  mobileAppIconUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  supportUrl: string | null;
  supportChannel: "chat" | "whatsapp";
  supportWhatsappNumber: string | null;
  userPanelBanners: AdminPanelBanner[];
  testGroups: AdminTestGroupLink[];
  officialGroups: AdminOfficialGroupLink[];
  officialGroupInstanceId: number | null;
  officialGroupJid: string | null;
  officialGroupInviteLink: string | null;
  officialGroupInviteUpdatedAt: string | null;
  emailVerificationEnabled: boolean;
  emailVerificationApiKeys: string[];
  heroBadge: string | null;
  heroTitle: string | null;
  heroSubtitle: string | null;
  heroButtonLabel: string | null;
  heroButtonUrl: string | null;
  heroSecondaryButtonLabel: string | null;
  heroSecondaryButtonUrl: string | null;
  heroImageUrl: string | null;
  featuresTitle: string | null;
  featuresSubtitle: string | null;
  features: AdminHomepageFeature[];
  workflowTitle: string | null;
  workflowDescription: string | null;
  workflowBullets: string[];
  workflowImageUrl: string | null;
  ctaTitle: string | null;
  ctaDescription: string | null;
  ctaButtonLabel: string | null;
  ctaButtonUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoImageUrl: string | null;
  footerText: string | null;
  seoKeywords: string[];
  seoHighlightKeywords: string[];
  termsContent: string;
  updatedAt: string | null;
}

export interface AdminSiteSettingsPayload {
  siteName: string;
  tagline: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  supportUrl: string | null;
  supportChatMode: "chat" | "whatsapp";
  supportWhatsappNumber: string | null;
  userPanelBanners: AdminPanelBanner[];
  testGroups: AdminTestGroupLink[];
  officialGroups: AdminOfficialGroupLink[];
  officialGroupInstanceId: number | null;
  officialGroupJid: string | null;
  emailVerificationEnabled: boolean;
  emailVerificationApiKeys: string[];
  heroBadge: string | null;
  heroTitle: string | null;
  heroSubtitle: string | null;
  heroButtonLabel: string | null;
  heroButtonUrl: string | null;
  heroSecondaryButtonLabel: string | null;
  heroSecondaryButtonUrl: string | null;
  featuresTitle: string | null;
  featuresSubtitle: string | null;
  features: AdminHomepageFeature[];
  workflowTitle: string | null;
  workflowDescription: string | null;
  workflowBullets: string[];
  ctaTitle: string | null;
  ctaDescription: string | null;
  ctaButtonLabel: string | null;
  ctaButtonUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  footerText: string | null;
  seoKeywords: string[];
  seoHighlightKeywords: string[];
  termsContent: string | null;
}
