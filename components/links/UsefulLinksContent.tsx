"use client";

import Image from "next/image";
import Link from "next/link";
import { Button, Card, Col, Container, Row } from "react-bootstrap";
import * as TablerIcons from "@tabler/icons-react";

import type { UsefulLink, UsefulLinkBanner } from "types/useful-links";
import PublicPageShell from "components/site/PublicPageShell";
import { BOTADMIN_LOGO_SRC } from "components/brand/BotAdminLogo";
import UsefulLinksCarousel from "./UsefulLinksCarousel";
import styles from "./useful-links.module.scss";

type UsefulLinksContentProps = {
  siteName: string;
  heroTitle: string;
  heroSubtitle: string;
  logoUrl: string | null;
  links: UsefulLink[];
  banners: UsefulLinkBanner[];
};

const mapIconComponent = (iconName: string | null) => {
  if (!iconName) {
    return null;
  }
  const component = (TablerIcons as Record<string, unknown>)[iconName];
  if (!component) {
    return null;
  }
  const type = typeof component;
  if (type !== "function" && type !== "object") {
    return null;
  }
  return component as typeof TablerIcons.IconLink;
};

const renderLinkImage = (link: UsefulLink) => {
  if (!link.imageUrl) {
    return null;
  }

  return (
    <div className={`${styles.linkImageWrapper} position-relative ratio ratio-16x9`}>
      <Image
        src={link.imageUrl}
        alt={link.title}
        fill
        className={styles.linkImage}
        sizes="(max-width: 768px) 100vw, 480px"
        priority={false}
        unoptimized
      />
    </div>
  );
};

const UsefulLinksContent = ({
  siteName,
  heroTitle,
  heroSubtitle,
  logoUrl,
  links,
  banners,
}: UsefulLinksContentProps) => (
  <PublicPageShell
    logoUrl={logoUrl || BOTADMIN_LOGO_SRC}
    siteName={siteName}
    activePath="/linksuteis"
  >
    <div className={`${styles.page} public-links-page`}>
    <Container className={styles.container}>
      <header className={styles.hero}>
        <div className={styles.heroBar}>
          <span className={styles.logoWrapper}>
            <Image
              src={logoUrl || BOTADMIN_LOGO_SRC}
              alt={siteName}
              width={72}
              height={72}
              className={styles.logoImage}
              priority
              unoptimized
            />
          </span>
          <div className={styles.heroInfo}>
            <span className={styles.heroLabel}>Links oficiais</span>
            <span className={styles.heroTagline}>{siteName}</span>
          </div>
        </div>
        <h2 className={`${styles.heroTitle} landing-title`}>{heroTitle}</h2>
        <p className={`${styles.heroSubtitle} text-secondary`}>
          {heroSubtitle}
        </p>
      </header>

      {banners.length > 0 ? (
        <div className={styles.bannerSection}>
          <UsefulLinksCarousel
            banners={banners}
            className={styles.bannerCarousel}
          />
        </div>
      ) : null}

      <section>
        {links.length === 0 ? (
          <Card className="border-0 shadow-sm text-center py-5">
            <Card.Body>
              <h3 className="h5 mb-2">Nenhum link disponível no momento</h3>
              <p className="text-secondary mb-0">
                Assim que novos atalhos forem cadastrados no painel administrativo, eles aparecerão aqui automaticamente.
              </p>
            </Card.Body>
          </Card>
        ) : (
          <Row className={`g-4 ${styles.linksGrid}`}>
            {links.map((link) => {
              const IconComponent = mapIconComponent(link.icon);
              return (
                <Col key={link.id} md={6} lg={4}>
                  <Card className={`h-100 border-0 shadow-sm ${styles.linkCard}`}>
                    {renderLinkImage(link)}
                    <Card.Body className={styles.linkCardBody}>
                      <div>
                        <Card.Title className={styles.linkTitle}>{link.title}</Card.Title>
                        {link.description ? (
                          <Card.Text className="text-secondary mb-0">
                            {link.description}
                          </Card.Text>
                        ) : null}
                      </div>
                      <div className="mt-auto">
                        <Button
                          as="a"
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="primary"
                          size="sm"
                          className={`w-100 d-flex align-items-center justify-content-center ${styles.linkButton}`}
                        >
                          {IconComponent ? (
                            <IconComponent size={18} strokeWidth={1.6} />
                          ) : null}
                          <span>{link.buttonLabel}</span>
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </section>

      <footer className={styles.footer}>
        <p className="mb-1">
          Links oficiais do {siteName}. Compartilhe esta página para divulgar os canais corretos da plataforma.
        </p>
        <Link href="/" className={styles.backLink}>
          ← Voltar para a página inicial
        </Link>
      </footer>
    </Container>
    </div>
  </PublicPageShell>
);

export default UsefulLinksContent;
