import { NextResponse } from "next/server";

import { getAdminMobileSettings } from "lib/admin-mobile";
import { getAdminSiteSettings } from "lib/admin-site";

const fallbackSlidesFromSite = async () => {
  try {
    const site = await getAdminSiteSettings();
    const slides = [];

    if (site.heroTitle || site.heroSubtitle) {
      slides.push({
        id: "hero",
        title: site.heroTitle || site.siteName || "Bem-vindo",
        description:
          site.heroSubtitle ??
          "Gerencie sua operação com notificações instantâneas e acompanhamento em tempo real.",
        buttonLabel: "Próximo",
        imageUrl: site.heroImageUrl ?? null,
      });
    }

    if (Array.isArray(site.features) && site.features.length > 0) {
      const [first] = site.features;
      slides.push({
        id: "features",
        title: first?.title ?? "Automação poderosa",
        description:
          first?.description ??
          "Automatize processos, receba alertas e mantenha seus clientes engajados com rapidez.",
        buttonLabel: "Continuar",
        imageUrl: null,
      });
    }

    slides.push({
      id: "cta",
      title: site.ctaTitle ?? "Pronto para começar?",
      description:
        site.ctaDescription ??
        "Faça login e acompanhe tudo em um só lugar, com suporte especializado quando precisar.",
      buttonLabel: "Começar",
      imageUrl: null,
    });

    return slides;
  } catch {
    return [
      {
        id: "welcome",
        title: "BotAdmin Painel",
        description:
          "Controle seu bot, receba notificações e converse com clientes em qualquer lugar.",
        buttonLabel: "Próximo",
        imageUrl: null,
      },
      {
        id: "automation",
        title: "Automação 24/7",
        description:
          "Configure regras, monitore grupos e mantenha sua operação rodando mesmo fora do computador.",
        buttonLabel: "Próximo",
        imageUrl: null,
      },
      {
        id: "start",
        title: "Tudo pronto",
        description: "Faça login e aproveite todos os recursos do aplicativo.",
        buttonLabel: "Começar",
        imageUrl: null,
      },
    ];
  }
};

const resolveBaseUrl = (mobile: Awaited<ReturnType<typeof getAdminMobileSettings>>) => {
  const candidates = [
    mobile.serverUrl,
    process.env.NEXT_PUBLIC_CAP_SERVER_URL,
    process.env.APP_URL,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};

const ensureAbsoluteUrl = (value: string | null, baseUrl: string | null) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (!baseUrl || !baseUrl.trim()) {
    return value;
  }
  try {
    const normalizedBase = baseUrl.endsWith("/")
      ? baseUrl
      : `${baseUrl}/`;
    return new URL(
      value.startsWith("/")
        ? value
        : `/${value}`,
      normalizedBase,
    ).toString();
  } catch {
    return value;
  }
};

export async function GET() {
  try {
    const mobile = await getAdminMobileSettings();
    const baseUrl = resolveBaseUrl(mobile);
    let slides = mobile.onboardingSlides.map((slide) => ({
      id: slide.id,
      title: slide.title,
      description: slide.description,
      buttonLabel: slide.buttonLabel ?? null,
      imageUrl: ensureAbsoluteUrl(slide.imageUrl ?? null, baseUrl),
    }));

    if (!slides.length) {
      const fallbackSlides = await fallbackSlidesFromSite();
      slides = fallbackSlides.map((slide) => ({
        ...slide,
        imageUrl: ensureAbsoluteUrl(slide.imageUrl ?? null, baseUrl),
      }));
    }

    return NextResponse.json({
      enabled: !!mobile.onboardingEnabled,
      revision: mobile.onboardingRevision,
      slides,
    });
  } catch (error) {
    console.error("[mobile-onboarding] failed to load onboarding payload", error);
    return NextResponse.json(
      { enabled: false, slides: [], revision: null },
      { status: 200 },
    );
  }
}
