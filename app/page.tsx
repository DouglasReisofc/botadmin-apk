import Link from "next/link";
import Image from "next/image";
import {
  IconApi,
  IconBrandWhatsapp,
  IconChartBar,
  IconLink,
  IconLock,
  IconQrcode,
  IconSettingsAutomation,
  IconSparkles,
} from "@tabler/icons-react";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getAdminSiteSettings } from "lib/admin-site";
import { getCurrentUser } from "lib/auth";
import { redirect } from "next/navigation";
import { getPublicAppBaseUrl } from "lib/meta";
import { getAllSubscriptionPlans } from "lib/plans";
import { getPartnerPanelAccess } from "lib/reseller-program";
import type { SubscriptionPlan } from "types/plans";
import HeroPhone3D from "components/site/HeroPhone3D";
import LottieAnimation from "components/site/LottieAnimation";
import NativeAppOpenScript from "components/mobile/NativeAppOpenScript";
import PublicBrand from "components/site/PublicBrand";
import ThemeToggle from "components/theme/ThemeToggle";

const DEFAULT_TITLE = "StoreBot | Bot Admin para grupos de WhatsApp";
const DEFAULT_DESCRIPTION =
  "Ative um bot administrador para moderar grupos: boas‑vindas, regras, bloqueio de spam e comandos automáticos com a API oficial da Meta.";
const FALLBACK_OG_IMAGE = "/images/png/dasher-ai.png";
const heroDashboardImage = "/images/png/dasher-ai.png";
const qrScanAnimation = "/animations/whatsapp-qr-scan.json";
const workflowImage = "/images/png/botadmin-workflow.jpg";
const mercadoLivreLogo = "/images/affiliates/mercado-livre-logo.png";
const shopeeLogo = "/images/affiliates/shopee-logo.png";
type BootstrapShellProps = {
  children: ReactNode;
  className?: string;
};

type ColProps = BootstrapShellProps & {
  lg?: number;
  md?: number;
  sm?: number;
};

type BadgeProps = BootstrapShellProps & {
  bg?: string;
  text?: string;
};

const joinClasses = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const Container = ({ children, className }: BootstrapShellProps) => (
  <div className={joinClasses("container", className)}>{children}</div>
);

const Row = ({ children, className }: BootstrapShellProps) => (
  <div className={joinClasses("row", className)}>{children}</div>
);

const Col = ({ children, className, lg, md, sm }: ColProps) => (
  <div
    className={joinClasses(
      lg ? `col-lg-${lg}` : null,
      md ? `col-md-${md}` : null,
      sm ? `col-sm-${sm}` : null,
      !lg && !md && !sm ? "col" : null,
      className,
    )}
  >
    {children}
  </div>
);

const Card = ({ children, className }: BootstrapShellProps) => (
  <div className={joinClasses("card", className)}>{children}</div>
);

const CardBody = ({ children, className }: BootstrapShellProps) => (
  <div className={joinClasses("card-body", className)}>{children}</div>
);

const Badge = ({ children, className, bg, text }: BadgeProps) => (
  <span className={joinClasses("badge", bg ? `bg-${bg}` : null, text ? `text-${text}` : null, className)}>
    {children}
  </span>
);
const FALLBACK_KEYWORDS = [
  "bot whatsapp",
  "bot admin",
  "automação whatsapp",
  "moderador whatsapp",
  "robô de afiliados",
  "bot de afiliados whatsapp",
  "robô afiliado shopee",
  "robô afiliado mercado livre",
  "comandos botadmin",
  "tutoriais botadmin",
  "grupo oficial botadmin",
];

const buildMetadataKeywords = (
  settingsKeywords: string[],
  plans: SubscriptionPlan[],
): string[] => {
  const planKeywords = plans
    .filter((plan) => plan.isActive)
    .slice(0, 10)
    .map((plan) => `plano ${plan.name} bot whatsapp`);
  const baseKeywords = settingsKeywords.length > 0 ? [...settingsKeywords, ...FALLBACK_KEYWORDS] : FALLBACK_KEYWORDS;
  return Array.from(new Set([...baseKeywords, ...planKeywords]));
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

const formatDuration = (days: number): string => {
  if (days >= 30 && days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "mensal" : `${months} meses`;
  }
  return `${days} dias`;
};

const jsonLdString = (payload: unknown): string =>
  JSON.stringify(payload).replace(/</g, "\\u003c");

const isSameOriginAssetUrl = (value: string | null | undefined, appUrl: string): value is string => {
  if (!value) return false;
  if (value.startsWith("/")) return true;

  try {
    return new URL(value).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
};

const buildLandingJsonLd = (params: {
  appUrl: string;
  siteName: string;
  title: string;
  description: string;
  plans: SubscriptionPlan[];
  officialGroupInviteLink?: string | null;
}) => {
  const activePlans = params.plans.filter((plan) => plan.isActive);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${params.appUrl}#organization`,
        name: params.siteName,
        url: params.appUrl,
        ...(params.officialGroupInviteLink ? { sameAs: [params.officialGroupInviteLink] } : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${params.appUrl}#website`,
        name: params.siteName,
        url: params.appUrl,
        description: params.description,
        publisher: { "@id": `${params.appUrl}#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${params.appUrl}#software`,
        name: params.title,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: params.appUrl,
        description: params.description,
        offers: activePlans.map((plan) => ({
          "@type": "Offer",
          name: plan.name,
          description: plan.description || `Plano ${plan.name} para Bot Admin no WhatsApp`,
          price: plan.price,
          priceCurrency: "BRL",
          availability: "https://schema.org/InStock",
          url: `${params.appUrl}#planos`,
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${params.appUrl}#faq`,
        mainEntity: [
          {
            "@type": "Question",
            name: "Onde vejo os tutoriais dos comandos do Bot Admin?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Os comandos ficam documentados nas páginas de comandos e tutoriais, organizados por categoria para facilitar a configuração e o treinamento dos administradores.",
            },
          },
          ...(params.officialGroupInviteLink
            ? [
                {
                  "@type": "Question",
                  name: "Como posso testar o Bot Admin em um grupo do WhatsApp?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "A página inicial do BotAdmin mostra o botão do grupo oficial para entrar no WhatsApp e testar o bot em uma comunidade real.",
                  },
                },
              ]
            : []),
          {
            "@type": "Question",
            name: "Os planos mostram limites de grupos e instâncias?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Sim. Cada plano informa preço, duração, limite de grupos, limite de instâncias WhatsApp e valores de add-ons quando disponíveis.",
            },
          },
        ],
      },
    ],
  };
};

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const appUrl = getPublicAppBaseUrl();
  const metadataBase = new URL(appUrl);

  try {
    const [settings, plans] = await Promise.all([
      getAdminSiteSettings(),
      getAllSubscriptionPlans().catch((error) => {
        console.error("Failed to load plans for landing metadata", error);
        return [] as SubscriptionPlan[];
      }),
    ]);
    const siteName = settings.siteName ?? "StoreBot";
    const title =
      settings.seoTitle ?? (settings.tagline ? `${siteName} – ${settings.tagline}` : DEFAULT_TITLE);
    const description = settings.seoDescription ?? settings.tagline ?? DEFAULT_DESCRIPTION;
    const ogImageUrl =
      settings.seoImageUrl ??
      settings.heroImageUrl ??
      settings.logoUrl ??
      new URL(FALLBACK_OG_IMAGE, appUrl).toString();
    const absoluteOgImage = new URL(ogImageUrl, appUrl).toString();
    const keywords = buildMetadataKeywords(settings.seoKeywords, plans);
    const highlightKeywords =
      settings.seoHighlightKeywords.length > 0 ? settings.seoHighlightKeywords : undefined;
    const ogImages = absoluteOgImage
      ? [
          {
            url: absoluteOgImage,
            width: 1200,
            height: 630,
            alt: siteName,
          },
        ]
      : undefined;

    return {
      metadataBase,
      title,
      description,
      keywords,
      alternates: {
        canonical: appUrl,
      },
      robots: {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          "max-snippet": -1,
          "max-image-preview": "large",
          "max-video-preview": -1,
        },
      },
      openGraph: {
        title,
        description,
        url: appUrl,
        siteName: settings.siteName ?? "StoreBot",
        images: ogImages,
        type: "website",
      },
      twitter: {
        card: ogImages ? "summary_large_image" : "summary",
        title,
        description,
        images: ogImages?.map((image) => image.url),
      },
      other:
        highlightKeywords && highlightKeywords.length > 0
          ? { "data-highlight-keywords": highlightKeywords.join(", ") }
          : undefined,
    };
  } catch (error) {
      console.error("Failed to resolve site metadata", error);
    return {
      metadataBase,
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      keywords: FALLBACK_KEYWORDS,
      alternates: {
        canonical: appUrl,
      },
      robots: {
        index: true,
        follow: true,
      },
      openGraph: {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        url: appUrl,
        siteName: "StoreBot",
        images: [
          {
            url: new URL(FALLBACK_OG_IMAGE, appUrl).toString(),
            width: 1200,
            height: 630,
            alt: "StoreBot",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        images: [new URL(FALLBACK_OG_IMAGE, appUrl).toString()],
      },
    };
  }
}

const FALLBACK_HERO_BADGE = "Bot admin para grupos";
const FALLBACK_HERO_TITLE = "Administre grupos do WhatsApp no piloto automático";
const FALLBACK_HERO_SUBTITLE =
  "Modere conversas, dê boas‑vindas, aplique regras e acione comandos de forma automática com o Bot Admin oficial conectado à API da Meta.";
const FALLBACK_HERO_PRIMARY_CTA = { label: "Criar conta", url: "/sign-up" };
const FALLBACK_HERO_SECONDARY_CTA = { label: "Já sou cliente", url: "/sign-in" };
const FALLBACK_FEATURES_TITLE = "Tudo que você precisa para moderar grupos";
const FALLBACK_FEATURES_SUBTITLE =
  "Defina regras e comandos; o bot monitora mensagens e toma as ações configuradas em tempo real.";
const FALLBACK_FEATURES = [
  {
    title: "Moderação automática",
    description:
      "Boas‑vindas, remoção de spam, palavras proibidas, avisos e banimento automático conforme as regras do grupo.",
  },
  {
    title: "Regras e comandos",
    description:
      "Crie comandos como /regras, /menu e /ajuda; ative modo silêncio, somente admin e mensagens programadas.",
  },
  {
    title: "Relatórios e integrações",
    description:
      "Receba alertas no painel, conecte webhooks e registre ações para auditoria das suas comunidades.",
  },
];
const FALLBACK_CAPABILITIES_TITLE = "Muito além do básico: o que o Bot Admin entrega hoje";
const FALLBACK_CAPABILITIES_SUBTITLE =
  "O painel já chega com recursos para operação profissional de comunidades, suporte e vendas.";
const FALLBACK_CAPABILITY_BLOCKS = [
  {
    title: "Automação e moderação de grupos",
    items: [
      "Antilink, antipalavras e regras automáticas com ações em tempo real.",
      "Comandos personalizados para menu, ajuda, regras e rotinas do grupo.",
      "Autodownloader para links suportados, incluindo vídeos da Shopee.",
    ],
  },
  {
    title: "Controle completo de WhatsApp Web",
    items: [
      "Conexão e pareamento de WhatsApps Web direto no painel.",
      "Sincronização de grupos por instância e vínculo por convite.",
      "Gestão de status operacional para evitar operação no escuro.",
    ],
  },
  {
    title: "Escala comercial e integração",
    items: [
      "Campanhas para grupos e status com fluxo orientado no painel.",
      "API REST para integrar CRM, sistemas próprios e automações externas.",
      "Experiência responsiva para desktop e mobile com onboarding guiado.",
    ],
  },
] as const;
const FALLBACK_WORKFLOW_TITLE = "Como o Bot Admin cuida do seu grupo";
const FALLBACK_WORKFLOW_DESCRIPTION =
  "Você define as regras e comandos. O bot monitora mensagens e aplica as políticas automaticamente, 24/7.";
const FALLBACK_WORKFLOW_BULLETS = [
  "Boas‑vindas automáticas com links e regras",
  "Bloqueio de spam e palavras proibidas",
  "Comandos rápidos: /regras, /menu, /silêncio",
];
const FALLBACK_CTA_TITLE = "Pronto para organizar seus grupos?";
const FALLBACK_CTA_DESCRIPTION =
  "Ative o Bot Admin e mantenha suas comunidades seguras, organizadas e produtivas.";
const FALLBACK_CTA_BUTTON = { label: "Começar agora", url: "/sign-up" };
const FEATURE_ICONS = [IconChartBar, IconSettingsAutomation, IconLock, IconSparkles];
const CAPABILITY_ICONS = [IconSettingsAutomation, IconLock, IconChartBar];

const LandingPage = async () => {
  const user = await getCurrentUser();

  if (user) {
    if (user.role === "admin") redirect("/dashboard/admin");
    redirect(
      (await getPartnerPanelAccess(user.id))
        ? "/dashboard/partner"
        : "/dashboard/user",
    );
  }

  const [settings, plans] = await Promise.all([
    getAdminSiteSettings(),
    getAllSubscriptionPlans().catch((error) => {
      console.error("Failed to load subscription plans on landing page", error);
      return [] as SubscriptionPlan[];
    }),
  ]);
  const activePlans = plans.filter((plan) => plan.isActive);

  const heroBadge = settings.heroBadge ?? FALLBACK_HERO_BADGE;
  const heroTitle = settings.heroTitle ?? FALLBACK_HERO_TITLE;
  const heroSubtitle = settings.heroSubtitle ?? FALLBACK_HERO_SUBTITLE;
  const heroImageSrc = settings.heroImageUrl ? settings.heroImageUrl : heroDashboardImage;
  const heroImageAlt = settings.heroTitle
    ? `Ilustração: ${settings.heroTitle}`
    : "Chatbot StoreBot para WhatsApp";
  const heroPrimaryCta =
    settings.heroButtonLabel && settings.heroButtonUrl
      ? { label: settings.heroButtonLabel, url: settings.heroButtonUrl }
      : FALLBACK_HERO_PRIMARY_CTA;
  const heroSecondaryCta =
    settings.heroSecondaryButtonLabel && settings.heroSecondaryButtonUrl
      ? { label: settings.heroSecondaryButtonLabel, url: settings.heroSecondaryButtonUrl }
      : FALLBACK_HERO_SECONDARY_CTA;

  const featureItems = settings.features.length > 0 ? settings.features : FALLBACK_FEATURES;
  const showFeaturesSection = featureItems.length > 0;
  const featuresTitle = settings.featuresTitle ?? FALLBACK_FEATURES_TITLE;
  const featuresSubtitle = settings.featuresSubtitle ?? FALLBACK_FEATURES_SUBTITLE;

  const workflowImageSrc = settings.workflowImageUrl ? settings.workflowImageUrl : workflowImage;
  const workflowImageAlt = settings.workflowTitle ? `Fluxo: ${settings.workflowTitle}` : "Fluxo do chatbot";
  const workflowTitle = settings.workflowTitle ?? FALLBACK_WORKFLOW_TITLE;
  const workflowDescription = settings.workflowDescription ?? FALLBACK_WORKFLOW_DESCRIPTION;
  const workflowBullets =
    settings.workflowBullets.length > 0 ? settings.workflowBullets : FALLBACK_WORKFLOW_BULLETS;

  const ctaTitle = settings.ctaTitle ?? FALLBACK_CTA_TITLE;
  const ctaDescription = settings.ctaDescription ?? FALLBACK_CTA_DESCRIPTION;
  const ctaButton =
    settings.ctaButtonLabel && settings.ctaButtonUrl
      ? { label: settings.ctaButtonLabel, url: settings.ctaButtonUrl }
      : FALLBACK_CTA_BUTTON;
  const highlightKeywords = settings.seoHighlightKeywords ?? [];
  const hasHighlightKeywords = highlightKeywords.length > 0;
  const siteName = settings.siteName ?? "StoreBot";
  const officialGroups = settings.officialGroups.filter((group) => group.isActive);
  const officialGroupInviteLink = officialGroups.find((group) => group.inviteLink)?.inviteLink ?? settings.officialGroupInviteLink;
  const pageTitle = settings.seoTitle ?? (settings.tagline ? `${siteName} – ${settings.tagline}` : DEFAULT_TITLE);
  const pageDescription = settings.seoDescription ?? settings.tagline ?? DEFAULT_DESCRIPTION;
  const appUrl = getPublicAppBaseUrl();
  const jsonLd = buildLandingJsonLd({
    appUrl,
    siteName,
    title: pageTitle,
    description: pageDescription,
    plans,
    officialGroupInviteLink,
  });

  return (
    <main className="landing-page">
      <NativeAppOpenScript next="/dashboard/user" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <header className="landing-header">
        <Container>
          <nav
            className="landing-header__nav d-flex align-items-center justify-content-between flex-wrap gap-3 py-3"
            aria-label="Navegação principal"
          >
            <PublicBrand logoUrl={settings.logoUrl} siteName={siteName} />
            <div className="landing-header__links d-flex align-items-center flex-wrap gap-2 gap-md-3 small fw-semibold">
              <Link href="/comandos" className="landing-nav-link">
                Comandos
              </Link>
              <Link href="/tutorials" className="landing-nav-link">
                Tutoriais
              </Link>
              <Link href="/grupos-oficiais" className="landing-nav-link">
                Grupos oficiais
              </Link>
              <Link href="/robo-afiliados" className="landing-nav-link">
                Afiliados
              </Link>
              <Link href="#planos" className="landing-nav-link">
                Planos
              </Link>
              <ThemeToggle compact />
              <Link href="/sign-in" className="landing-btn landing-btn--ghost">
                Entrar
              </Link>
              {heroPrimaryCta && (
                <Link href={heroPrimaryCta.url} className="landing-btn landing-btn--neon">
                  Começar
                </Link>
              )}
            </div>
          </nav>
        </Container>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__aurora" aria-hidden="true" />
        <div className="landing-hero__scan" aria-hidden="true" />
        <Container className="landing-hero__container">
          <Row className="align-items-center gy-5">
            <Col lg={6}>
              <div className="landing-hero__copy">
                <div className="landing-hero__badge">
                  <span className="landing-hero__pulse" />
                  {heroBadge}
                </div>
                <h1 className="landing-hero__title">{heroTitle}</h1>
                <p className="landing-hero__subtitle">{heroSubtitle}</p>
                <div className="landing-hero__actions">
                  {heroPrimaryCta && (
                    <Link href={heroPrimaryCta.url} className="landing-btn landing-btn--neon landing-btn--lg">
                      {heroPrimaryCta.label}
                    </Link>
                  )}
                  {heroSecondaryCta && (
                    <Link href={heroSecondaryCta.url} className="landing-btn landing-btn--glass landing-btn--lg">
                      {heroSecondaryCta.label}
                    </Link>
                  )}
                  <Link href="/comandos" className="landing-btn landing-btn--glass landing-btn--lg">
                    Ver comandos
                  </Link>
                </div>
                <div className="landing-hero__stats" aria-label="Destaques do BotAdmin">
                  <div className="landing-stat">
                    <strong>24/7</strong>
                    <span>Robô online</span>
                  </div>
                  <div className="landing-stat">
                    <strong>0.4s</strong>
                    <span>Resposta média</span>
                  </div>
                  <div className="landing-stat">
                    <strong>Auto</strong>
                    <span>Moderação total</span>
                  </div>
                </div>
                {hasHighlightKeywords && (
                  <div className="landing-hero__tags" aria-label="Palavras-chave em destaque">
                    {highlightKeywords.map((keyword) => (
                      <span key={keyword} className="landing-tag">
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Col>
            <Col lg={6} className="text-center">
              <div className="landing-hero__phone-stage">
                <div className="landing-hero__phone-glow" aria-hidden="true" />
                <HeroPhone3D />
              </div>
              <noscript>
                <Image
                  src={heroImageSrc}
                  alt={heroImageAlt}
                  className="rounded-4 shadow-sm"
                  sizes="(max-width: 575px) calc(100vw - 32px), (max-width: 991px) 696px, 50vw"
                  width={1200}
                  height={800}
                  style={{ width: "100%", height: "auto" }}
                />
              </noscript>
            </Col>
          </Row>
        </Container>
      </section>

      <div className="landing-marquee" aria-hidden="true">
        <div className="landing-marquee__track">
          {Array.from({ length: 2 }).map((_, loopIdx) => (
            <div className="landing-marquee__group" key={`mq-${loopIdx}`}>
              <span>Moderação automática</span>
              <span>Antilink</span>
              <span>Boas-vindas</span>
              <span>Comandos</span>
              <span>Afiliados</span>
              <span>QR Code</span>
              <span>Bot 24/7</span>
              <span>WhatsApp</span>
            </div>
          ))}
        </div>
      </div>

      <section className="landing-section landing-section--glass py-10">
        <Container>
          <Row className="align-items-center gy-5">
            <Col lg={6}>
              <Badge bg="primary" className="mb-3 text-uppercase landing-chip">
                API própria do WhatsApp
              </Badge>
              <h2 className="fw-bold mb-3 landing-title">Use o robô com conexão própria por QR Code</h2>
              <p className="text-secondary mb-4 landing-lead">
                O BotAdmin permite conectar instâncias do WhatsApp direto no painel para operar o robô em grupos,
                responder comandos e automatizar rotinas sem depender de configuração manual complexa.
              </p>
              <Row className="gy-3">
                <Col sm={6}>
                  <div className="landing-feature-point d-flex gap-3">
                    <div className="landing-feature-point__icon">
                      <IconQrcode size={26} />
                    </div>
                    <div>
                      <h3 className="h6 fw-bold mb-1">Pareamento por QR</h3>
                      <p className="text-secondary small mb-0">
                        Escaneie o QR Code no celular e vincule a instância para o bot começar a trabalhar.
                      </p>
                    </div>
                  </div>
                </Col>
                <Col sm={6}>
                  <div className="landing-feature-point d-flex gap-3">
                    <div className="landing-feature-point__icon">
                      <IconApi size={26} />
                    </div>
                    <div>
                      <h3 className="h6 fw-bold mb-1">API integrada</h3>
                      <p className="text-secondary small mb-0">
                        Use a estrutura própria do BotAdmin para comandos, automações, grupos e painel administrativo.
                      </p>
                    </div>
                  </div>
                </Col>
              </Row>
            </Col>
            <Col lg={6}>
              <div className="landing-media-panel mx-auto">
                <LottieAnimation
                  path={qrScanAnimation}
                  title="Celular escaneando QR Code do WhatsApp"
                  className="drop-shadow-sm"
                  eager
                />
              </div>
            </Col>
          </Row>
        </Container>
      </section>

      <section className="landing-section py-10">
        <Container>
          <Row className="align-items-center gy-5">
            <Col lg={6}>
              <Badge bg="warning" text="dark" className="mb-3 text-uppercase landing-chip landing-chip--warm">
                Robô para afiliados
              </Badge>
              <h2 className="fw-bold mb-3 landing-title">O BotAdmin também serve para afiliados de lojas</h2>
              <p className="text-secondary mb-4 landing-lead">
                Use o robô para organizar grupos de ofertas, divulgar links de afiliado, automatizar campanhas e
                manter comunidades de WhatsApp mais profissionais para Shopee, Mercado Livre e outras lojas.
              </p>
              <Row className="gy-3 mb-4">
                <Col sm={6}>
                  <div className="landing-feature-point d-flex gap-3">
                    <div className="landing-feature-point__icon">
                      <IconLink size={26} />
                    </div>
                    <div>
                      <h3 className="h6 fw-bold mb-1">Links de afiliado</h3>
                      <p className="text-secondary small mb-0">
                        Estruture a divulgação de ofertas e direcione participantes para produtos e campanhas.
                      </p>
                    </div>
                  </div>
                </Col>
                <Col sm={6}>
                  <div className="landing-feature-point d-flex gap-3">
                    <div className="landing-feature-point__icon landing-feature-point__icon--wa">
                      <IconBrandWhatsapp size={26} />
                    </div>
                    <div>
                      <h3 className="h6 fw-bold mb-1">Grupos de ofertas</h3>
                      <p className="text-secondary small mb-0">
                        Use moderação, boas-vindas, comandos e campanhas para operar grupos de vendas.
                      </p>
                    </div>
                  </div>
                </Col>
              </Row>
              <Link href="/robo-afiliados" className="btn btn-success rounded-pill px-4">
                Ver robô de afiliados
              </Link>
            </Col>
            <Col lg={6}>
              <Card className="landing-card border-0">
                <CardBody className="p-4 p-lg-5">
                  <div className="d-flex align-items-center justify-content-center gap-4 flex-wrap mb-4">
                    <Image
                      src={shopeeLogo}
                      alt="Logo Shopee"
                      width={220}
                      height={124}
                      loading="lazy"
                      sizes="(max-width: 575px) 140px, 220px"
                      style={{ width: "min(45%, 220px)", height: "auto" }}
                    />
                    <Image
                      src={mercadoLivreLogo}
                      alt="Logo Mercado Livre"
                      width={220}
                      height={124}
                      loading="lazy"
                      sizes="(max-width: 575px) 140px, 220px"
                      style={{ width: "min(45%, 220px)", height: "auto" }}
                    />
                  </div>
                  <div className="landing-inset rounded p-4">
                    <h3 className="h5 fw-bold mb-2">Automação para grupos de ofertas</h3>
                    <p className="text-secondary mb-0">
                      O robô ajuda afiliados a manter grupos ativos com ofertas, regras, respostas rápidas e campanhas
                      de divulgação para produtos da Shopee, Mercado Livre e outras lojas parceiras.
                    </p>
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </section>

      {showFeaturesSection && (
        <section className="landing-section landing-section--mesh py-10">
          <Container>
            <header className="text-center mb-6 landing-section-head">
              <span className="landing-kicker">Recursos</span>
              <h2 className="fw-bold mb-3 landing-title">{featuresTitle}</h2>
              {featuresSubtitle && <p className="text-secondary mb-0 landing-lead mx-auto">{featuresSubtitle}</p>}
            </header>
            <Row className="gy-4">
              {featureItems.map((feature, index) => {
                const IconComponent = FEATURE_ICONS[index % FEATURE_ICONS.length];
                return (
                  <Col md={featureItems.length >= 3 ? 4 : 6} key={`${feature.title}-${index}`}>
                    <Card className="h-100 border-0 landing-card landing-card--hover">
                      <CardBody className="p-5">
                        <div className="landing-icon-badge mb-3">
                          <IconComponent size={28} />
                        </div>
                        <h3 className="h4 mb-3">{feature.title}</h3>
                        <p className="text-secondary mb-0">{feature.description}</p>
                      </CardBody>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </Container>
        </section>
      )}

      <section className="landing-section landing-section--glass py-8">
        <Container>
          <Row className="align-items-center gy-4">
            <Col lg={5}>
              <Badge bg="primary" className="mb-3 text-uppercase landing-chip">
                Acesso rapido
              </Badge>
              <h2 className="fw-bold mb-3 landing-title">Comandos e tutoriais do BotAdmin</h2>
              <p className="text-secondary mb-0 landing-lead">
                Consulte a lista publica de comandos ou abra os tutoriais completos para configurar cada recurso com
                explicacao detalhada.
              </p>
            </Col>
            <Col lg={7}>
              <Row className="gy-4">
                <Col md={6}>
                  <Card className="h-100 border-0 landing-card landing-card--hover">
                    <CardBody className="p-4">
                      <div className="landing-icon-badge mb-3">
                        <IconSettingsAutomation size={26} />
                      </div>
                      <h3 className="h5 fw-bold mb-2">Pagina de comandos</h3>
                      <p className="text-secondary mb-4">
                        Veja todos os comandos disponiveis, separados por categoria e com busca por nome ou funcao.
                      </p>
                      <Link href="/comandos" className="btn btn-outline-success btn-sm rounded-pill">
                        Abrir comandos
                      </Link>
                    </CardBody>
                  </Card>
                </Col>
                <Col md={6}>
                  <Card className="h-100 border-0 landing-card landing-card--hover">
                    <CardBody className="p-4">
                      <div className="landing-icon-badge mb-3">
                        <IconChartBar size={26} />
                      </div>
                      <h3 className="h5 fw-bold mb-2">Tutoriais completos</h3>
                      <p className="text-secondary mb-4">
                        Abra os guias publicos com exemplos, explicacoes e materiais cadastrados no painel.
                      </p>
                      <Link href="/tutorials" className="btn btn-outline-success btn-sm rounded-pill">
                        Abrir tutoriais
                      </Link>
                    </CardBody>
                  </Card>
                </Col>
                {officialGroupInviteLink && (
                  <Col md={6}>
                    <Card className="h-100 border-0 landing-card landing-card--hover">
                      <CardBody className="p-4">
                        <div className="landing-icon-badge landing-icon-badge--success mb-3">
                          <IconSparkles size={26} />
                        </div>
                        <h3 className="h5 fw-bold mb-2">Grupo oficial do BotAdmin</h3>
                        <p className="text-secondary mb-4">
                          Entre no grupo oficial para testar comandos, ver respostas do bot e acompanhar novidades.
                        </p>
                        <Link href="/grupos-oficiais" className="btn btn-outline-success btn-sm rounded-pill">
                          Ver grupos oficiais
                        </Link>
                      </CardBody>
                    </Card>
                  </Col>
                )}
              </Row>
            </Col>
          </Row>
        </Container>
      </section>

      {officialGroups.length > 0 && (
        <section id="grupooficial" className="landing-section landing-section--mesh py-10">
          <Container>
            <Row className="align-items-center gy-5">
              <Col lg={5}>
                <Badge bg="success" className="mb-3 text-uppercase landing-chip">
                  Grupo oficial
                </Badge>
                <h2 className="fw-bold mb-3 landing-title">Entre agora mesmo no nosso grupo oficial do BotAdmin</h2>
                <p className="text-secondary mb-4 landing-lead">
                  Teste comandos em um grupo real, acompanhe novidades e escolha um dos grupos oficiais disponíveis
                  quando a comunidade principal estiver cheia.
                </p>
                <Link href="/grupos-oficiais" className="btn btn-success btn-lg rounded-pill">
                  Ver todos os grupos oficiais
                </Link>
              </Col>
              <Col lg={7}>
                <Row className="gy-4">
                  {officialGroups.slice(0, 2).map((group) => {
                    const groupImageUrl = isSameOriginAssetUrl(group.imageUrl, appUrl) ? group.imageUrl : null;

                    return (
                      <Col md={6} key={group.id}>
                        <Card className="h-100 border-0 landing-card landing-card--hover text-center">
                          <CardBody className="p-4 d-flex flex-column align-items-center">
                            <div className="landing-avatar mb-3">
                              {groupImageUrl ? (
                                <img
                                  src={groupImageUrl}
                                  alt={group.title}
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              ) : (
                                <span className="display-6 fw-bold text-success">#</span>
                              )}
                            </div>
                            <h3 className="h5 fw-bold mb-3">{group.title}</h3>
                            <div className="landing-inset w-100 text-start text-secondary small p-3 mb-4">
                              {group.description ||
                                "Grupo oficial para testar comandos, acompanhar novidades e falar com a comunidade BotAdmin."}
                            </div>
                            <Link href="/grupos-oficiais" className="btn btn-outline-success btn-sm rounded-pill mt-auto">
                              Abrir página dos grupos
                            </Link>
                          </CardBody>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>
              </Col>
            </Row>
          </Container>
        </section>
      )}

      <section className="landing-section py-10">
        <Container>
          <header className="text-center mb-6 landing-section-head">
            <span className="landing-kicker">Capacidades</span>
            <h2 className="fw-bold mb-3 landing-title">{FALLBACK_CAPABILITIES_TITLE}</h2>
            <p className="text-secondary mb-0 landing-lead mx-auto">{FALLBACK_CAPABILITIES_SUBTITLE}</p>
          </header>
          <Row className="gy-4">
            {FALLBACK_CAPABILITY_BLOCKS.map((block, index) => {
              const IconComponent = CAPABILITY_ICONS[index % CAPABILITY_ICONS.length];
              return (
                <Col lg={4} md={6} key={block.title}>
                  <Card className="h-100 border-0 landing-card landing-card--hover">
                    <CardBody className="p-5">
                      <div className="landing-icon-badge mb-3">
                        <IconComponent size={28} />
                      </div>
                      <h3 className="h4 mb-3">{block.title}</h3>
                      <ul className="list-unstyled d-flex flex-column gap-2 mb-0">
                        {block.items.map((item) => (
                          <li key={item} className="d-flex align-items-start gap-2 text-secondary">
                            <IconSparkles size={16} className="text-success mt-1 flex-shrink-0" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CardBody>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Container>
      </section>

      <section id="planos" className="landing-section landing-section--mesh py-10">
        <Container>
          <header className="text-center mb-6 landing-section-head">
            <Badge bg="primary" className="mb-3 text-uppercase landing-chip">
              Planos e preços
            </Badge>
            <h2 className="fw-bold mb-3 landing-title">Planos do Bot Admin</h2>
            <p className="text-secondary mb-0 landing-lead mx-auto">
              Compare preço, duração, limite de instâncias e limite de grupos para escolher a estrutura certa da sua
              operação no WhatsApp.
            </p>
          </header>
          <Row className="gy-4">
            {(activePlans.length > 0 ? activePlans : plans).length > 0 ? (
              (activePlans.length > 0 ? activePlans : plans).map((plan) => (
                <Col lg={4} md={6} key={plan.id}>
                  <Card className="h-100 border-0 landing-card landing-card--plan landing-card--hover">
                    <CardBody className="p-5 d-flex flex-column">
                      <div className="d-flex align-items-start justify-content-between gap-3 mb-3">
                        <div>
                          <h3 className="h4 fw-bold mb-1">{plan.name}</h3>
                          <p className="text-secondary small mb-0">{formatDuration(plan.durationDays)}</p>
                        </div>
                        {plan.isActive ? (
                          <Badge bg="success-subtle" text="success">
                            Ativo
                          </Badge>
                        ) : (
                          <Badge bg="secondary-subtle" text="secondary">
                            Indisponível
                          </Badge>
                        )}
                      </div>
                      <div className="display-6 fw-bold mb-3 landing-price">
                        {formatCurrency(plan.price)}
                        <span className="fs-6 text-secondary fw-normal"> / {formatDuration(plan.durationDays)}</span>
                      </div>
                      {plan.description && <p className="text-secondary mb-4">{plan.description}</p>}
                      <ul className="list-unstyled d-flex flex-column gap-2 mb-4">
                        <li className="d-flex gap-2">
                          <IconSparkles size={18} className="text-success mt-1 flex-shrink-0" />
                          <span>{plan.instanceLimit} instância(s) WhatsApp incluída(s)</span>
                        </li>
                        <li className="d-flex gap-2">
                          <IconSparkles size={18} className="text-success mt-1 flex-shrink-0" />
                          <span>1 grupo ativado por licença</span>
                        </li>
                        <li className="d-flex gap-2">
                          <IconSparkles size={18} className="text-success mt-1 flex-shrink-0" />
                          <span>Add-on por instância: {formatCurrency(plan.addonInstancePrice)}</span>
                        </li>
                      </ul>
                    </CardBody>
                  </Card>
                </Col>
              ))
            ) : (
              <Col>
                <Card className="border-0 landing-card">
                  <CardBody className="p-5">
                    <h3 className="h4 fw-bold mb-2">Planos personalizados</h3>
                    <p className="text-secondary mb-0">
                      Os planos ativos serão exibidos aqui com preço e limites assim que forem cadastrados no painel
                      administrativo.
                    </p>
                  </CardBody>
                </Card>
              </Col>
            )}
          </Row>
        </Container>
      </section>

      <section className="landing-section landing-section--glass py-10">
        <Container>
          <Row className="align-items-center gy-6">
            <Col lg={6}>
              <div className="landing-media-frame">
                <Image
                  src={workflowImageSrc}
                  alt={workflowImageAlt}
                  loading="lazy"
                  className="rounded-4"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  width={1200}
                  height={800}
                  style={{ width: "100%", height: "auto" }}
                />
              </div>
            </Col>
            <Col lg={6}>
              <span className="landing-kicker">Como funciona</span>
              <h2 className="fw-bold mb-3 landing-title">{workflowTitle}</h2>
              {workflowDescription && <p className="text-secondary mb-4 landing-lead">{workflowDescription}</p>}
              {workflowBullets.length > 0 && (
                <ul className="list-unstyled d-flex flex-column gap-2 landing-check-list">
                  {workflowBullets.map((bullet, index) => (
                    <li key={`${bullet}-${index}`} className="d-flex align-items-center gap-2">
                      <IconSparkles className="text-success" size={20} /> {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </Col>
          </Row>
        </Container>
      </section>

      <section className="landing-cta py-10">
        <Container>
          <div className="landing-cta__panel">
            <Row className="align-items-center gy-4">
              <Col lg={8}>
                <h2 className="fw-bold mb-2">{ctaTitle}</h2>
                {ctaDescription && <p className="mb-0 opacity-90">{ctaDescription}</p>}
              </Col>
              <Col lg={4} className="text-lg-end">
                {ctaButton && (
                  <Link href={ctaButton.url} className="btn btn-light btn-lg rounded-pill px-4 fw-bold">
                    {ctaButton.label}
                  </Link>
                )}
              </Col>
            </Row>
          </div>
        </Container>
      </section>

      <footer className="landing-footer py-5">
        <Container>
          <Row className="align-items-center gy-3">
            <Col lg={6}>
              <p className="fw-bold mb-2 landing-footer__brand">
                Bot <span>Admin</span>
              </p>
              <p className="text-secondary small mb-0">
                {settings.footerText?.trim() ||
                  "Automação e gestão para grupos do WhatsApp com foco em operação, segurança e suporte ao cliente."}
              </p>
              <p className="text-secondary small mb-0 mt-2">
                © 2026 BotAdmin. Todos os direitos reservados.
              </p>
            </Col>
            <Col lg={6}>
              <div className="d-flex justify-content-lg-end justify-content-start flex-wrap gap-3 small landing-footer__links">
                <Link href="/comandos">Comandos</Link>
                <Link href="/tutorials">Tutoriais</Link>
                <Link href="/grupos-oficiais">Grupos oficiais</Link>
                <Link href="/robo-afiliados">Robô de afiliados</Link>
                <Link href="/termos">Termos de uso</Link>
                <Link href="/privacidade">Política de privacidade</Link>
                <Link href="/sign-in">Entrar</Link>
              </div>
            </Col>
          </Row>
        </Container>
      </footer>
    </main>
  );
};

export default LandingPage;
