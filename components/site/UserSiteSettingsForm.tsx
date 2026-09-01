"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Col, Form, Image, Row, Spinner } from "react-bootstrap";

import type { SiteFooterLink, SiteSettings } from "types/site";

const MAX_FOOTER_LINKS = 5;

const mapSettingsToFormState = (settings: SiteSettings): SiteSettingsFormState => ({
  siteName: settings.siteName ?? "",
  tagline: settings.tagline ?? "",
  seoTitle: settings.seoTitle ?? "",
  seoDescription: settings.seoDescription ?? "",
  seoKeywordsText: settings.seoKeywords.join(", "),
  footerText: settings.footerText ?? "",
  footerLinks: settings.footerLinks.length > 0 ? settings.footerLinks : [{ label: "", url: "" }],
  logoUrl: settings.logoUrl,
  faviconUrl: settings.faviconUrl,
  seoImageUrl: settings.seoImageUrl,
  updatedAt: settings.updatedAt,
});

interface SiteSettingsFormProps {
  settings: SiteSettings;
}

interface Feedback {
  type: "success" | "danger";
  message: string;
}

type FormFooterLink = SiteFooterLink;

type SiteSettingsFormState = {
  siteName: string;
  tagline: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywordsText: string;
  footerText: string;
  footerLinks: FormFooterLink[];
  logoUrl: string | null;
  faviconUrl: string | null;
  seoImageUrl: string | null;
  updatedAt: string | null;
};

const formatUpdatedAt = (value: string | null) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
};

const UserSiteSettingsForm = ({ settings }: SiteSettingsFormProps) => {
  const router = useRouter();
  const [formState, setFormState] = useState<SiteSettingsFormState>(() => mapSettingsToFormState(settings));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [seoImageFile, setSeoImageFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [seoImagePreview, setSeoImagePreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeFavicon, setRemoveFavicon] = useState(false);
  const [removeSeoImage, setRemoveSeoImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setFormState(mapSettingsToFormState(settings));
    setRemoveLogo(false);
    setRemoveFavicon(false);
    setRemoveSeoImage(false);
    setLogoFile(null);
    setFaviconFile(null);
    setSeoImageFile(null);
    setLogoPreview(null);
    setFaviconPreview(null);
    setSeoImagePreview(null);
  }, [settings]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return () => {};
    }

    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!faviconFile) {
      setFaviconPreview(null);
      return () => {};
    }

    const url = URL.createObjectURL(faviconFile);
    setFaviconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [faviconFile]);

  useEffect(() => {
    if (!seoImageFile) {
      setSeoImagePreview(null);
      return () => {};
    }

    const url = URL.createObjectURL(seoImageFile);
    setSeoImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [seoImageFile]);

  const formattedUpdatedAt = useMemo(() => formatUpdatedAt(formState.updatedAt), [formState.updatedAt]);
  const displaySeoImage = removeSeoImage ? null : seoImagePreview ?? formState.seoImageUrl;

  const handleFooterLinkChange = (index: number, field: keyof FormFooterLink, value: string) => {
    setFormState((previous) => {
      const nextLinks = previous.footerLinks.slice(0, MAX_FOOTER_LINKS).map((link, linkIndex) => {
        if (linkIndex === index) {
          return {
            ...link,
            [field]: value,
          };
        }

        return link;
      });

      if (index >= nextLinks.length) {
        nextLinks.push({ label: "", url: "" });
      }

      return {
        ...previous,
        footerLinks: nextLinks,
      };
    });
  };

  const handleAddFooterLink = () => {
    setFormState((previous) => {
      if (previous.footerLinks.length >= MAX_FOOTER_LINKS) {
        return previous;
      }

      return {
        ...previous,
        footerLinks: [...previous.footerLinks, { label: "", url: "" }],
      };
    });
  };

  const handleRemoveFooterLink = (index: number) => {
    setFormState((previous) => {
      const nextLinks = previous.footerLinks.filter((_, linkIndex) => linkIndex !== index);
      return {
        ...previous,
        footerLinks: nextLinks.length > 0 ? nextLinks : [{ label: "", url: "" }],
      };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    setFeedback(null);

    const formData = new FormData();
    formData.set("siteName", formState.siteName);
    formData.set("tagline", formState.tagline);
    formData.set("seoTitle", formState.seoTitle);
    formData.set("seoDescription", formState.seoDescription);
    formData.set("seoKeywords", formState.seoKeywordsText);
    formData.set("footerText", formState.footerText);

    const sanitizedLinks = formState.footerLinks
      .map((link) => ({
        label: link.label.trim(),
        url: link.url.trim(),
      }))
      .filter((link) => link.label || link.url);

    formData.set("footerLinks", JSON.stringify(sanitizedLinks));

    if (logoFile) {
      formData.set("logo", logoFile);
    }

    if (faviconFile) {
      formData.set("favicon", faviconFile);
    }

    if (seoImageFile) {
      formData.set("seoImage", seoImageFile);
    }

    formData.set("removeLogo", String(removeLogo));
    formData.set("removeFavicon", String(removeFavicon));
    formData.set("removeSeoImage", String(removeSeoImage));

    const response = await fetch("/api/site", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Não foi possível salvar as alterações." }));
      setFeedback({ type: "danger", message: error.message ?? "Erro ao salvar as configurações." });
      setIsSubmitting(false);
      return;
    }

    const data = await response.json().catch(() => null);

    if (data?.settings) {
      setFormState(mapSettingsToFormState(data.settings));
      setLogoFile(null);
      setFaviconFile(null);
      setSeoImageFile(null);
      setRemoveLogo(false);
      setRemoveFavicon(false);
      setRemoveSeoImage(false);
      setLogoPreview(null);
      setFaviconPreview(null);
      setSeoImagePreview(null);
      router.refresh();
    }

    setFeedback({
      type: "success",
      message: data?.message ?? "Configurações atualizadas com sucesso.",
    });
    setIsSubmitting(false);
  };

  return (
    <Form onSubmit={handleSubmit} className="d-flex flex-column gap-4">
      <Card>
        <Card.Body>
          <Card.Title as="h2" className="h5">
            Identidade do site
          </Card.Title>
          <Card.Text className="text-secondary">
            Ajuste nome, slogan e arquivos visuais exibidos em seu site.
          </Card.Text>

          <Row className="g-4">
            <Col md={6}>
              <Form.Group controlId="site-name" className="mb-3">
                <Form.Label>Nome do site</Form.Label>
                <Form.Control
                  required
                  type="text"
                  value={formState.siteName}
                  onChange={(event) =>
                    setFormState((previous) => ({ ...previous, siteName: event.target.value }))
                  }
                  maxLength={120}
                />
                <Form.Text>Este nome aparece em diversas áreas públicas do site.</Form.Text>
              </Form.Group>

              <Form.Group controlId="site-tagline" className="mb-3">
                <Form.Label>Slogan</Form.Label>
                <Form.Control
                  type="text"
                  value={formState.tagline}
                  onChange={(event) =>
                    setFormState((previous) => ({ ...previous, tagline: event.target.value }))
                  }
                  maxLength={160}
                />
                <Form.Text>Opcional, exibido em locais como cabeçalho e resultados de busca.</Form.Text>
              </Form.Group>
            </Col>

            <Col md={6}>
              <div className="d-flex flex-column gap-3">
                <Form.Group controlId="site-logo">
                  <Form.Label>Logo</Form.Label>
                  <Form.Control
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(event) => setLogoFile((event.target as HTMLInputElement).files?.[0] ?? null)}
                  />
                  <Form.Check
                    type="switch"
                    id="site-remove-logo"
                    label="Remover logo atual"
                    className="mt-2"
                    checked={removeLogo}
                    onChange={(event) => setRemoveLogo(event.target.checked)}
                    disabled={!formState.logoUrl && !logoFile}
                  />
                  <Form.Text>Formatos aceitos: PNG, JPG, WEBP ou SVG até 5 MB.</Form.Text>
                  {(logoPreview || formState.logoUrl) && (
                    <div className="mt-3">
                      <span className="d-block text-secondary small mb-2">Pré-visualização</span>
                      <Image
                        src={logoPreview ?? formState.logoUrl ?? ""}
                        alt="Logo atual"
                        fluid
                        style={{ maxHeight: 120, objectFit: "contain" }}
                      />
                    </div>
                  )}
                </Form.Group>

                <Form.Group controlId="site-favicon">
                  <Form.Label>Favicon</Form.Label>
                  <Form.Control
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/x-icon"
                    onChange={(event) => setFaviconFile((event.target as HTMLInputElement).files?.[0] ?? null)}
                  />
                  <Form.Check
                    type="switch"
                    id="site-remove-favicon"
                    label="Remover favicon"
                    className="mt-2"
                    checked={removeFavicon}
                    onChange={(event) => setRemoveFavicon(event.target.checked)}
                    disabled={!formState.faviconUrl && !faviconFile}
                  />
                  <Form.Text>Use imagens quadradas (32×32 até 128×128) com até 512 KB.</Form.Text>
                  {(faviconPreview || formState.faviconUrl) && (
                    <div className="mt-3">
                      <span className="d-block text-secondary small mb-2">Pré-visualização</span>
                      <Image
                        src={faviconPreview ?? formState.faviconUrl ?? ""}
                        alt="Favicon atual"
                        fluid
                        style={{ maxHeight: 64, maxWidth: 64, objectFit: "contain" }}
                      />
                    </div>
                  )}
                </Form.Group>
              </div>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Card.Title as="h2" className="h5">
            SEO e metadados
          </Card.Title>
          <Card.Text className="text-secondary">
            Personalize os títulos e descrições exibidos em mecanismos de busca e redes sociais.
          </Card.Text>

          <Form.Group controlId="site-seo-image" className="mb-3">
            <Form.Label>Imagem de pré-visualização (Open Graph)</Form.Label>
            <Form.Control
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = (event.target as HTMLInputElement).files?.[0] ?? null;
                setSeoImageFile(file);
                if (file) {
                  setRemoveSeoImage(false);
                }
              }}
            />
            <Form.Text>
              Use imagens 1200×630 px nos formatos JPG, PNG ou WEBP com até 3 MB.
            </Form.Text>
            <Form.Check
              type="switch"
              id="site-remove-seo-image"
              label="Remover imagem de pré-visualização"
              className="mt-2"
              checked={removeSeoImage}
              onChange={(event) => setRemoveSeoImage(event.target.checked)}
              disabled={!formState.seoImageUrl && !seoImageFile}
            />
            {removeSeoImage && !seoImagePreview && formState.seoImageUrl && (
              <Form.Text className="d-block text-secondary mt-1">
                A imagem atual será removida ao salvar.
              </Form.Text>
            )}
            {displaySeoImage && (
              <div className="mt-3">
                <span className="d-block text-secondary small mb-2">Pré-visualização</span>
                <Image
                  src={displaySeoImage ?? ""}
                  alt="Pré-visualização para redes sociais"
                  fluid
                  style={{ maxHeight: 280, width: "100%", objectFit: "cover" }}
                />
              </div>
            )}
          </Form.Group>

          <Form.Group controlId="site-seo-title" className="mb-3">
            <Form.Label>Título para SEO</Form.Label>
            <Form.Control
              type="text"
              value={formState.seoTitle}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, seoTitle: event.target.value }))
              }
              maxLength={120}
            />
            <Form.Text>Recomendado até 60 caracteres.</Form.Text>
          </Form.Group>

          <Form.Group controlId="site-seo-description" className="mb-3">
            <Form.Label>Descrição</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={formState.seoDescription}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, seoDescription: event.target.value }))
              }
              maxLength={320}
            />
            <Form.Text>Resumo exibido em resultados de busca (até 160 caracteres).</Form.Text>
          </Form.Group>

          <Form.Group controlId="site-seo-keywords" className="mb-0">
            <Form.Label>Palavras-chave</Form.Label>
            <Form.Control
              type="text"
              value={formState.seoKeywordsText}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, seoKeywordsText: event.target.value }))
              }
              placeholder="Digite palavras separadas por vírgula"
            />
            <Form.Text>Use até 12 palavras-chave separadas por vírgula.</Form.Text>
          </Form.Group>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Card.Title as="h2" className="h5">
            Rodapé do site
          </Card.Title>
          <Card.Text className="text-secondary">
            Defina o texto e os links exibidos no rodapé da página inicial.
          </Card.Text>

          <Form.Group controlId="site-footer-text" className="mb-4">
            <Form.Label>Texto do rodapé</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              value={formState.footerText}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, footerText: event.target.value }))
              }
              maxLength={600}
            />
            <Form.Text>Você pode incluir direitos autorais, informações de contato ou mensagem legal.</Form.Text>
          </Form.Group>

          <div className="d-flex flex-column gap-3">
            <div>
              <h3 className="h6 mb-1">Links rápidos</h3>
              <p className="text-secondary mb-2">
                Adicione até {MAX_FOOTER_LINKS} links com título e URL. Somente endereços começando com
                http:// ou https:// são aceitos.
              </p>
            </div>

            {formState.footerLinks.slice(0, MAX_FOOTER_LINKS).map((link, index) => (
              <Row key={index} className="g-3 align-items-end">
                <Col md={5}>
                  <Form.Group controlId={`site-footer-link-label-${index}`}>
                    <Form.Label className="mb-1">Título</Form.Label>
                    <Form.Control
                      type="text"
                      value={link.label}
                      onChange={(event) => handleFooterLinkChange(index, "label", event.target.value)}
                      maxLength={60}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group controlId={`site-footer-link-url-${index}`}>
                    <Form.Label className="mb-1">URL</Form.Label>
                    <Form.Control
                      type="url"
                      value={link.url}
                      onChange={(event) => handleFooterLinkChange(index, "url", event.target.value)}
                      placeholder="https://exemplo.com"
                    />
                  </Form.Group>
                </Col>
                <Col md={1} className="d-flex justify-content-end">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => handleRemoveFooterLink(index)}
                    disabled={formState.footerLinks.length <= 1}
                    aria-label="Remover link do rodapé"
                  >
                    Remover
                  </Button>
                </Col>
              </Row>
            ))}

            <div>
              <Button
                variant="outline-primary"
                onClick={handleAddFooterLink}
                disabled={formState.footerLinks.length >= MAX_FOOTER_LINKS}
              >
                Adicionar link
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      {feedback && (
        <Alert variant={feedback.type} className="mb-0">
          {feedback.message}
        </Alert>
      )}

      <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="text-secondary small">
          {formattedUpdatedAt ? `Última atualização em ${formattedUpdatedAt}` : "Nenhuma atualização registrada."}
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <span className="d-flex align-items-center gap-2">
              <Spinner animation="border" role="status" size="sm" />
              Salvando...
            </span>
          ) : (
            "Salvar alterações"
          )}
        </Button>
      </div>
    </Form>
  );
};

export default UserSiteSettingsForm;
