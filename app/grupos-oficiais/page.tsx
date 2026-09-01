import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardBody, Col, Container, Row } from "react-bootstrap";

import { getAdminSiteSettings } from "lib/admin-site";
import { getPublicAppBaseUrl } from "lib/meta";
import PublicPageShell from "components/site/PublicPageShell";

const TITLE = "Grupos oficiais do BotAdmin";
const DESCRIPTION =
  "Entre nos grupos oficiais do BotAdmin para testar comandos, acompanhar novidades e participar da comunidade.";

const jsonLdString = (payload: unknown): string =>
  JSON.stringify(payload).replace(/</g, "\\u003c");

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicAppBaseUrl();
  const canonical = new URL("/grupos-oficiais", baseUrl).toString();

  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: canonical,
      siteName: "BotAdmin",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
    },
  };
}

const OfficialGroupsPage = async () => {
  const settings = await getAdminSiteSettings();
  const baseUrl = getPublicAppBaseUrl();
  const siteName = settings.siteName ?? "BotAdmin";
  const groups = settings.officialGroups.filter((group) => group.isActive);
  const pageUrl = new URL("/grupos-oficiais", baseUrl).toString();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    description: DESCRIPTION,
    url: pageUrl,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: groups.length,
      itemListElement: groups.map((group, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: group.title,
        url: group.inviteLink ?? pageUrl,
        image: group.imageUrl ?? undefined,
        description: group.description ?? DESCRIPTION,
      })),
    },
  };

  return (
    <PublicPageShell
      logoUrl={settings.logoUrl}
      siteName={siteName}
      activePath="/grupos-oficiais"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <section className="public-inner-section">
        <Container>
          <div className="mx-auto text-center" style={{ maxWidth: 820 }}>
            <Badge bg="success" className="mb-3 text-uppercase">
              Grupos oficiais
            </Badge>
            <h1 className="display-5 fw-bold mb-3">Entre nos grupos oficiais do BotAdmin</h1>
            <p className="lead text-secondary mb-0">
              Escolha um grupo disponível para testar comandos, ver o bot funcionando e acompanhar novidades da
              plataforma.
            </p>
          </div>
        </Container>
      </section>

      <section className="py-10">
        <Container>
          {groups.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardBody className="p-5 text-center">
                <h2 className="h4 fw-bold mb-2">Nenhum grupo oficial disponível</h2>
                <p className="text-secondary mb-0">
                  Os grupos selecionados no painel administrativo aparecerão aqui automaticamente.
                </p>
              </CardBody>
            </Card>
          ) : (
            <Row className="gy-4">
              {groups.map((group) => (
                <Col lg={4} md={6} key={group.id}>
                  <Card className="h-100 border-0 shadow-sm text-center">
                    <CardBody className="p-4 d-flex flex-column align-items-center">
                      <div
                        className="rounded-circle border border-3 border-white shadow-sm bg-success-subtle d-flex align-items-center justify-content-center mb-3 overflow-hidden"
                        style={{ width: 96, height: 96 }}
                      >
                        {group.imageUrl ? (
                          <img
                            src={group.imageUrl}
                            alt={group.title}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <span className="display-6 fw-bold text-success">#</span>
                        )}
                      </div>
                      <h2 className="h4 fw-bold mb-3">{group.title}</h2>
                      <div
                        className="w-100 border rounded bg-light text-start text-secondary small p-3 mb-4"
                        style={{
                          maxHeight: 190,
                          overflowY: "auto",
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.55,
                        }}
                      >
                        {group.description ||
                          "Grupo oficial para testar comandos, acompanhar novidades e falar com a comunidade BotAdmin."}
                      </div>
                      {group.inviteLink ? (
                        <a
                          href={group.inviteLink}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-success rounded-pill w-100 mt-auto"
                        >
                          Entrar no grupo
                        </a>
                      ) : (
                        <span className="btn btn-outline-secondary rounded-pill disabled w-100 mt-auto">
                          Link em atualização
                        </span>
                      )}
                    </CardBody>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </Container>
      </section>
    </PublicPageShell>
  );
};

export default OfficialGroupsPage;
