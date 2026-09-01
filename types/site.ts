export interface SiteFooterLink {
  label: string;
  url: string;
}

export interface SiteSettings {
  siteName: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoImageUrl: string | null;
  seoKeywords: string[];
  footerText: string | null;
  footerLinks: SiteFooterLink[];
  updatedAt: string | null;
}
