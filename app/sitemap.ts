import type { MetadataRoute } from "next";

import { getPublicAppBaseUrl } from "lib/meta";
import { getAdminSiteSettings } from "lib/admin-site";
import { getCommandPagePathFromTutorialSlug } from "lib/command-tutorials";
import { getPublicFieldTutorials } from "lib/tutorials";
import { getUsefulLinksLastUpdatedAt } from "lib/useful-links";

export const dynamic = "force-dynamic";

const toDate = (value?: string | null) => {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicAppBaseUrl();

  const [settings, tutorials, usefulLinksUpdatedAt] = await Promise.all([
    getAdminSiteSettings().catch(() => null),
    getPublicFieldTutorials().catch(() => []),
    getUsefulLinksLastUpdatedAt().catch(() => null),
  ]);

  const siteUpdatedAt = toDate(settings?.updatedAt) ?? new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: siteUpdatedAt,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/tutorials`,
      lastModified: siteUpdatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/comandos`,
      lastModified: siteUpdatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/grupos-oficiais`,
      lastModified: siteUpdatedAt,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/robo-afiliados`,
      lastModified: siteUpdatedAt,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/linksuteis`,
      lastModified: usefulLinksUpdatedAt ?? siteUpdatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/termos`,
      lastModified: siteUpdatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/privacidade`,
      lastModified: siteUpdatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  for (const tutorial of tutorials) {
    const commandPath = getCommandPagePathFromTutorialSlug(tutorial.slug);
    if (!commandPath) continue;

    entries.push({
      url: `${baseUrl}${commandPath}`,
      lastModified: toDate(tutorial.updatedAt) ?? siteUpdatedAt,
      changeFrequency: "monthly",
      priority: 0.65,
    });
  }

  for (const tutorial of tutorials.filter((item) => !getCommandPagePathFromTutorialSlug(item.slug))) {
    entries.push({
      url: `${baseUrl}/tutorials/${tutorial.slug}`,
      lastModified: toDate(tutorial.updatedAt) ?? siteUpdatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return entries;
}
