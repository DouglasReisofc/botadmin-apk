import type { Metadata } from "next";

import { getAdminSiteSettings } from "lib/admin-site";
import { getPublicAppBaseUrl } from "lib/meta";
import {
  getPublishedUsefulLinkBanners,
  getPublishedUsefulLinks,
} from "lib/useful-links";
import UsefulLinksContent from "components/links/UsefulLinksContent";

const FALLBACK_TITLE = "Links úteis do Bot Admin";
const FALLBACK_DESCRIPTION =
  "Acesse rapidamente os grupos oficiais, páginas e materiais importantes do Bot Admin.";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicAppBaseUrl();

  try {
    const settings = await getAdminSiteSettings();
    const siteName = settings.siteName ?? "Bot Admin";
    const title = `${siteName} | Links úteis`;
    const description =
      settings.seoDescription ?? settings.tagline ?? FALLBACK_DESCRIPTION;
    const canonical = new URL("/linksuteis", baseUrl).toString();

    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        url: canonical,
        siteName,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
      },
    };
  } catch (error) {
    console.error("Failed to load useful links metadata", error);
    return {
      title: FALLBACK_TITLE,
      description: FALLBACK_DESCRIPTION,
      openGraph: {
        title: FALLBACK_TITLE,
        description: FALLBACK_DESCRIPTION,
        url: new URL("/linksuteis", baseUrl).toString(),
        siteName: "Bot Admin",
        type: "website",
      },
      twitter: {
        card: "summary",
        title: FALLBACK_TITLE,
        description: FALLBACK_DESCRIPTION,
      },
    };
  }
}

const UsefulLinksPage = async () => {
  const [settings, links, banners] = await Promise.all([
    getAdminSiteSettings(),
    getPublishedUsefulLinks(),
    getPublishedUsefulLinkBanners(),
  ]);

  const logoUrl = settings.logoUrl;
  const siteName = settings.siteName ?? "Bot Admin";
  const heroTitle = settings.heroTitle ?? FALLBACK_TITLE;
  const heroSubtitle =
    settings.tagline ?? settings.heroSubtitle ?? FALLBACK_DESCRIPTION;

  return (
    <UsefulLinksContent
      siteName={siteName}
      heroTitle={heroTitle}
      heroSubtitle={heroSubtitle}
      logoUrl={logoUrl ?? null}
      links={links}
      banners={banners}
    />
  );
};

export default UsefulLinksPage;
