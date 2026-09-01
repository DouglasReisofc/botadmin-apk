import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Badge, Card, CardBody, Col, Container, Row } from "react-bootstrap";
import {
  IconBrandWhatsapp,
  IconChartBar,
  IconLink,
  IconRobot,
  IconSettingsAutomation,
  IconSparkles,
} from "@tabler/icons-react";

import { getAdminSiteSettings } from "lib/admin-site";
import { getPublicAppBaseUrl } from "lib/meta";
import PublicPageShell from "components/site/PublicPageShell";

const TITLE = "Robô de afiliados para Shopee e Mercado Livre no WhatsApp";
const DESCRIPTION =
  "Use o BotAdmin como robô de afiliados para divulgar links da Shopee, Mercado Livre e outras lojas em grupos e status do WhatsApp, com automação, comandos e painel de gestão.";
const MERCADO_LIVRE_LOGO = "/images/affiliates/mercado-livre-logo.png";
const SHOPEE_LOGO = "/images/affiliates/shopee-logo.png";

const jsonLdString = (payload: unknown): string =>
  JSON.stringify(payload).replace(/</g, "\\u003c");

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicAppBaseUrl();
  const canonical = new URL("/robo-afiliados", baseUrl).toString();

  return {
    title: TITLE,
    description: DESCRIPTION,
    keywords: [
      "robô de afiliados",
      "bot de afiliados",
      "robô afiliado shopee",
      "robô afiliado mercado livre",
      "bot whatsapp afiliados",
      "automação whatsapp afiliados",
      "divulgar links de afiliado no whatsapp",
    ],
    alternates: { canonical },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
      },
    },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: canonical,
      siteName: "BotAdmin",
      type: "website",
      images: [
        {
          url: new URL(MERCADO_LIVRE_LOGO, baseUrl).toString(),
          width: 1200,
          height: 630,
          alt: "Robô de afiliados para Mercado Livre e Shopee",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [new URL(MERCADO_LIVRE_LOGO, baseUrl).toString()],
    },
  };
}

const AffiliateRobotPage = async () => {
  const settings = await getAdminSiteSettings();
  const baseUrl = getPublicAppBaseUrl();
  const siteName = settings.siteName ?? "BotAdmin";
  const pageUrl = new URL("/robo-afiliados", baseUrl).toString();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        name: TITLE,
        description: DESCRIPTION,
        url: pageUrl,
        about: ["robô de afiliados", "Shopee", "Mercado Livre", "WhatsApp"],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${pageUrl}#software`,
        name: "BotAdmin para afiliados",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: pageUrl,
        description: DESCRIPTION,
        featureList: [
          "Automação de mensagens em grupos do WhatsApp",
          "Divulgação de links de afiliado",
          "Campanhas para grupos e status",
          "Comandos e painel administrativo",
          "Suporte a operações com Shopee e Mercado Livre",
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        mainEntity: [
          {
            "@type": "Question",
            name: "O BotAdmin serve como robô de afiliados?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Sim. O BotAdmin pode ser usado para organizar grupos, divulgar ofertas, automatizar comandos e operar rotinas de afiliados no WhatsApp.",
            },
          },
          {
            "@type": "Question",
            name: "Posso usar com Shopee e Mercado Livre?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Sim. A página de afiliados do BotAdmin foi preparada para operações com lojas como Shopee e Mercado Livre, incluindo divulgação por grupos e campanhas.",
            },
          },
        ],
      },
    ],
  };

  return (
    <PublicPageShell
      logoUrl={settings.logoUrl}
      siteName={siteName}
      activePath="/robo-afiliados"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <section className="public-inner-section">
        <Container>
          <Row className="align-items-center gy-5">
            <Col lg={6}>
              <Badge bg="warning" text="dark" className="mb-3 text-uppercase">
                Robô de afiliados
              </Badge>
              <h1 className="display-5 fw-bold mb-3">
                Robô de afiliados para divulgar ofertas no WhatsApp
              </h1>
              <p className="lead text-secondary mb-4">
                Use o BotAdmin para operar grupos de ofertas, divulgar links de afiliado, automatizar campanhas e
                manter sua comunidade organizada enquanto trabalha com Shopee, Mercado Livre e outras lojas.
              </p>
              <div className="d-flex flex-wrap gap-3">
                <Link href="/sign-up" className="btn btn-primary btn-lg rounded-pill">
                  Criar conta
                </Link>
                <Link href="/grupos-oficiais" className="btn btn-outline-success btn-lg rounded-pill">
                  Testar no grupo oficial
                </Link>
              </div>
            </Col>
            <Col lg={6}>
              <Card className="border-0 shadow-sm">
                <CardBody className="p-4 p-lg-5">
                  <div className="d-flex align-items-center justify-content-center gap-4 flex-wrap mb-4">
                    <Image
                      src={SHOPEE_LOGO}
                      alt="Logo Shopee"
                      width={220}
                      height={124}
                      style={{ width: "min(45%, 220px)", height: "auto" }}
                    />
                    <Image
                      src={MERCADO_LIVRE_LOGO}
                      alt="Logo Mercado Livre"
                      width={220}
                      height={124}
                      style={{ width: "min(45%, 220px)", height: "auto" }}
                    />
                  </div>
                  <div className="rounded bg-light border p-4">
                    <h2 className="h5 fw-bold mb-3">Para afiliados que vendem por grupos</h2>
                    <p className="text-secondary mb-0">
                      Organize grupos de WhatsApp, publique campanhas, direcione usuários para ofertas e mantenha
                      comandos úteis para administradores e participantes.
                    </p>
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </section>

      <section className="py-10">
        <Container>
          <header className="text-center mb-6">
            <h2 className="fw-bold mb-3">Como o robô ajuda afiliados</h2>
            <p className="text-secondary mb-0">
              O foco é dar estrutura para quem usa WhatsApp como canal de divulgação e relacionamento.
            </p>
          </header>
          <Row className="gy-4">
            {[
              {
                icon: IconLink,
                title: "Divulgação de ofertas",
                text: "Use grupos, status e campanhas para divulgar links de afiliado de forma organizada.",
              },
              {
                icon: IconBrandWhatsapp,
                title: "Grupos de WhatsApp",
                text: "Gerencie comunidades de ofertas com regras, boas-vindas, bloqueios e comandos rápidos.",
              },
              {
                icon: IconSettingsAutomation,
                title: "Automação operacional",
                text: "Reduza trabalho manual com respostas, menus, comandos, moderação e rotinas programadas.",
              },
              {
                icon: IconChartBar,
                title: "Operação comercial",
                text: "Mantenha a divulgação mais consistente para quem trabalha com Shopee, Mercado Livre e catálogos.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Col lg={3} md={6} key={item.title}>
                  <Card className="h-100 border-0 shadow-sm">
                    <CardBody className="p-4">
                      <div className="text-primary mb-3">
                        <Icon size={30} />
                      </div>
                      <h3 className="h5 fw-bold mb-2">{item.title}</h3>
                      <p className="text-secondary mb-0">{item.text}</p>
                    </CardBody>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Container>
      </section>

      <section className="public-inner-section">
        <Container>
          <Row className="align-items-center gy-5">
            <Col lg={5}>
              <Badge bg="primary" className="mb-3 text-uppercase">
                Shopee e Mercado Livre
              </Badge>
              <h2 className="fw-bold mb-3">Um robô para quem vive de afiliados</h2>
              <p className="text-secondary mb-0">
                Quem pesquisa por robô de afiliados normalmente quer uma ferramenta para divulgar produtos, manter
                grupos ativos e transformar o WhatsApp em uma central de ofertas. Essa é a proposta desta estrutura.
              </p>
            </Col>
            <Col lg={7}>
              <Row className="gy-4">
                {[
                  "Comandos para orientar participantes e administradores.",
                  "Campanhas para grupos e status do WhatsApp.",
                  "Painel para conectar instâncias e organizar grupos.",
                  "Moderação automática para proteger comunidades de ofertas.",
                  "Página pública otimizada para buscas sobre robô de afiliados.",
                  "Base preparada para ampliar operações com catálogos e lojas parceiras.",
                ].map((item) => (
                  <Col md={6} key={item}>
                    <div className="d-flex gap-2 bg-white border rounded p-3 h-100">
                      <IconSparkles size={18} className="text-primary mt-1 flex-shrink-0" />
                      <span>{item}</span>
                    </div>
                  </Col>
                ))}
              </Row>
            </Col>
          </Row>
        </Container>
      </section>

      <section className="py-10">
        <Container>
          <Card className="border-0 shadow-sm">
            <CardBody className="p-5 d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-4">
              <div>
                <div className="text-primary mb-2">
                  <IconRobot size={34} />
                </div>
                <h2 className="h3 fw-bold mb-2">Comece com o BotAdmin para afiliados</h2>
                <p className="text-secondary mb-0">
                  Crie sua conta, conecte o WhatsApp e use o robô para organizar sua operação de ofertas.
                </p>
              </div>
              <Link href="/sign-up" className="btn btn-primary btn-lg rounded-pill flex-shrink-0">
                Ativar robô de afiliados
              </Link>
            </CardBody>
          </Card>
        </Container>
      </section>
    </PublicPageShell>
  );
};

export default AffiliateRobotPage;
