"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Stack,
} from "react-bootstrap";
import * as TablerIcons from "@tabler/icons-react";

import type { UsefulLink, UsefulLinkBanner } from "types/useful-links";
import FloatingAlert, { FloatingAlertFeedback } from "components/common/FloatingAlert";

type InputEvent =
  ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

type Feedback = FloatingAlertFeedback;

type LinkFormState = {
  id: number | null;
  title: string;
  description: string;
  url: string;
  buttonLabel: string;
  icon: string;
  order: number;
  isActive: boolean;
  removeImage: boolean;
  file: File | null;
  isSubmitting: boolean;
  feedback: Feedback;
};

type BannerFormState = {
  id: number | null;
  title: string;
  subtitle: string;
  linkUrl: string;
  order: number;
  isActive: boolean;
  file: File | null;
  isSubmitting: boolean;
  feedback: Feedback;
};

const ICON_CHOICES = [
  { value: "IconBrandWhatsapp", label: "WhatsApp" },
  { value: "IconBrandInstagram", label: "Instagram" },
  { value: "IconBrandTelegram", label: "Telegram" },
  { value: "IconExternalLink", label: "Link externo" },
  { value: "IconLink", label: "Link" },
  { value: "IconUsers", label: "Comunidade" },
  { value: "IconMessageCircle", label: "Suporte" },
  { value: "IconBook", label: "Documentação" },
  { value: "IconVideo", label: "Vídeo" },
  { value: "IconStars", label: "Destaque" },
];

const resolveIconComponent = (iconName: string) => {
  if (!iconName) {
    return null;
  }
  const component = (TablerIcons as Record<string, unknown>)[iconName];
  if (!component || typeof component !== "function") {
    return null;
  }
  return component as typeof TablerIcons.IconLink;
};

const createInitialLinkState = (link?: UsefulLink): LinkFormState => ({
  id: link?.id ?? null,
  title: link?.title ?? "",
  description: link?.description ?? "",
  url: link?.url ?? "",
  buttonLabel: link?.buttonLabel ?? "Acessar",
  icon: link?.icon ?? "",
  order: link?.order ?? 0,
  isActive: link?.isActive ?? true,
  removeImage: false,
  file: null,
  isSubmitting: false,
  feedback: null,
});

const createInitialBannerState = (banner?: UsefulLinkBanner): BannerFormState => ({
  id: banner?.id ?? null,
  title: banner?.title ?? "",
  subtitle: banner?.subtitle ?? "",
  linkUrl: banner?.linkUrl ?? "",
  order: banner?.order ?? 0,
  isActive: banner?.isActive ?? true,
  file: null,
  isSubmitting: false,
  feedback: null,
});

type Props = {
  links: UsefulLink[];
  banners: UsefulLinkBanner[];
};

const getEventValue = (event: InputEvent): string => {
  const target =
    event.currentTarget ??
    ((event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) ?? null);
  return target?.value ?? "";
};

const AdminUsefulLinksManager = ({ links, banners }: Props) => {
  const [linkItems, setLinkItems] = useState<UsefulLink[]>(() =>
    [...links].sort((a, b) => a.order - b.order || a.id - b.id),
  );
  const [bannerItems, setBannerItems] = useState<UsefulLinkBanner[]>(() =>
    [...banners].sort((a, b) => a.order - b.order || a.id - b.id),
  );

  const [linkModalState, setLinkModalState] = useState<LinkFormState>(() =>
    createInitialLinkState(),
  );
  const [bannerModalState, setBannerModalState] = useState<BannerFormState>(() =>
    createInitialBannerState(),
  );
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isBannerModalOpen, setIsBannerModalOpen] = useState(false);
  const [alert, setAlert] = useState<Feedback>(null);

  const openLinkModal = (link?: UsefulLink) => {
    setLinkModalState(createInitialLinkState(link));
    setIsLinkModalOpen(true);
  };

  const closeLinkModal = () => {
    setIsLinkModalOpen(false);
    setLinkModalState((prev) => ({ ...prev, file: null, isSubmitting: false, feedback: null }));
  };

  const openBannerModal = (banner?: UsefulLinkBanner) => {
    setBannerModalState(createInitialBannerState(banner));
    setIsBannerModalOpen(true);
  };

  const closeBannerModal = () => {
    setIsBannerModalOpen(false);
    setBannerModalState((prev) => ({ ...prev, file: null, isSubmitting: false, feedback: null }));
  };

  const handleLinkInputChange = (
    field: keyof Pick<LinkFormState, "title" | "description" | "url" | "buttonLabel" | "icon">
  ) => (event: InputEvent) => {
    const value = getEventValue(event);
    setLinkModalState((prev) => ({ ...prev, [field]: value }));
  };

  const handleLinkOrderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(getEventValue(event));
    setLinkModalState((prev) => ({ ...prev, order: Number.isFinite(value) ? value : 0 }));
  };

  const handleLinkActiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextChecked = Boolean(event.currentTarget?.checked);
    setLinkModalState((prev) => ({ ...prev, isActive: nextChecked }));
  };

  const handleLinkImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget?.files?.[0] ?? null;
    setLinkModalState((prev) => ({ ...prev, file, removeImage: false }));
  };

  const handleLinkRemoveImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const checked = Boolean(event.currentTarget?.checked);
    setLinkModalState((prev) => ({
      ...prev,
      removeImage: checked,
      file: checked ? null : prev.file,
    }));
  };

  const handleSubmitLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLinkModalState((prev) => ({ ...prev, isSubmitting: true, feedback: null }));

    const formData = new FormData();
    formData.set("title", linkModalState.title.trim());
    formData.set("description", linkModalState.description.trim());
    formData.set("url", linkModalState.url.trim());
    formData.set("buttonLabel", linkModalState.buttonLabel.trim() || "Acessar");
    formData.set("icon", linkModalState.icon.trim());
    formData.set("order", String(linkModalState.order));
    formData.set("isActive", linkModalState.isActive ? "true" : "false");
    formData.set("removeImage", linkModalState.removeImage ? "true" : "false");

    if (linkModalState.file) {
      formData.set("image", linkModalState.file);
    }

    const isEditing = Boolean(linkModalState.id);
    const endpoint = isEditing
      ? `/api/admin/useful-links/links/${linkModalState.id}`
      : "/api/admin/useful-links/links";
    const method = isEditing ? "PUT" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível salvar o link útil.");
      }

      const savedLink: UsefulLink = payload.link;
      setLinkItems((previous) => {
        const existingIndex = previous.findIndex((item) => item.id === savedLink.id);
        if (existingIndex === -1) {
          return [...previous, savedLink].sort((a, b) => a.order - b.order || a.id - b.id);
        }
        const copy = [...previous];
        copy[existingIndex] = savedLink;
        return copy.sort((a, b) => a.order - b.order || a.id - b.id);
      });

      setLinkModalState(createInitialLinkState());
      setAlert({ type: "success", message: payload?.message ?? "Link salvo com sucesso." });
      closeLinkModal();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível salvar o link útil.";
      setLinkModalState((prev) => ({
        ...prev,
        isSubmitting: false,
        feedback: { type: "danger", message },
      }));
    }
  };

  const handleDeleteLink = async (link: UsefulLink) => {
    const confirmed = window.confirm(`Remover o link "${link.title}"?`);
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/useful-links/links/${link.id}`, {
        method: "DELETE",
      });

      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : { message: null };

      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível remover o link útil.");
      }

      setLinkItems((previous) => previous.filter((item) => item.id !== link.id));
      setAlert({ type: "success", message: payload?.message ?? "Link removido." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível remover o link útil.";
      setAlert({ type: "danger", message });
    }
  };

  const handleBannerInputChange = (
    field: keyof Pick<BannerFormState, "title" | "subtitle" | "linkUrl">
  ) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = getEventValue(event);
    setBannerModalState((prev) => ({ ...prev, [field]: value }));
  };

  const handleBannerOrderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(getEventValue(event));
    setBannerModalState((prev) => ({ ...prev, order: Number.isFinite(value) ? value : 0 }));
  };

  const handleBannerActiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextChecked = Boolean(event.currentTarget?.checked);
    setBannerModalState((prev) => ({ ...prev, isActive: nextChecked }));
  };

  const handleBannerFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget?.files?.[0] ?? null;
    setBannerModalState((prev) => ({ ...prev, file }));
  };

  const handleSubmitBanner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBannerModalState((prev) => ({ ...prev, isSubmitting: true, feedback: null }));

    const formData = new FormData();
    formData.set("title", bannerModalState.title.trim());
    formData.set("subtitle", bannerModalState.subtitle.trim());
    formData.set("linkUrl", bannerModalState.linkUrl.trim());
    formData.set("order", String(bannerModalState.order));
    formData.set("isActive", bannerModalState.isActive ? "true" : "false");

    if (bannerModalState.file) {
      formData.set("media", bannerModalState.file);
    }

    const isEditing = Boolean(bannerModalState.id);
    const endpoint = isEditing
      ? `/api/admin/useful-links/banners/${bannerModalState.id}`
      : "/api/admin/useful-links/banners";
    const method = isEditing ? "PUT" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível salvar o banner.");
      }

      const savedBanner: UsefulLinkBanner = payload.banner;
      setBannerItems((previous) => {
        const existingIndex = previous.findIndex((item) => item.id === savedBanner.id);
        if (existingIndex === -1) {
          return [...previous, savedBanner].sort((a, b) => a.order - b.order || a.id - b.id);
        }
        const copy = [...previous];
        copy[existingIndex] = savedBanner;
        return copy.sort((a, b) => a.order - b.order || a.id - b.id);
      });

      setBannerModalState(createInitialBannerState());
      setAlert({ type: "success", message: payload?.message ?? "Banner salvo com sucesso." });
      closeBannerModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar o banner.";
      setBannerModalState((prev) => ({
        ...prev,
        isSubmitting: false,
        feedback: { type: "danger", message },
      }));
    }
  };

  const handleDeleteBanner = async (banner: UsefulLinkBanner) => {
    const confirmed = window.confirm(`Remover o banner "${banner.title}"?`);
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/useful-links/banners/${banner.id}`, {
        method: "DELETE",
      });

      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : { message: null };

      if (!response.ok) {
        throw new Error(payload?.message ?? "Não foi possível remover o banner.");
      }

      setBannerItems((previous) => previous.filter((item) => item.id !== banner.id));
      setAlert({ type: "success", message: payload?.message ?? "Banner removido." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível remover o banner.";
      setAlert({ type: "danger", message });
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      <FloatingAlert feedback={alert} onClose={() => setAlert(null)} />

      <section>
        <div className="d-flex align-items-center justify-content-between mb-3">
          <div>
            <h2 className="h5 mb-1">Banners destacados</h2>
            <p className="text-secondary mb-0">
              Gerencie os banners exibidos no topo da página de links úteis. Cada banner pode ter um hyperlink e aceita imagens ou GIFs animados.
            </p>
          </div>
          <Button variant="primary" onClick={() => openBannerModal()}>
            Adicionar banner
          </Button>
        </div>

        {bannerItems.length === 0 ? (
          <Card className="border-dashed text-center py-5">
            <Card.Body>
              <p className="text-secondary mb-0">
                Nenhum banner cadastrado. Clique em &ldquo;Adicionar banner&rdquo; para criar o primeiro.
              </p>
            </Card.Body>
          </Card>
        ) : (
          <Row className="g-4">
            {bannerItems.map((banner) => (
              <Col key={banner.id} md={6} xl={4}>
                <Card className="h-100 shadow-sm border-0">
                  {banner.mediaUrl ? (
                    <div className="ratio ratio-16x9 bg-light position-relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={banner.mediaUrl}
                        alt={banner.title}
                        className="w-100 h-100 object-fit-cover rounded-top"
                      />
                    </div>
                  ) : (
                    <div className="ratio ratio-16x9 bg-light rounded-top" />
                  )}
                  <Card.Body>
                    <div className="d-flex align-items-start justify-content-between mb-3">
                      <div>
                        <Card.Title className="h6 mb-1">{banner.title}</Card.Title>
                        {banner.subtitle && (
                          <Card.Text className="text-secondary small mb-0">{banner.subtitle}</Card.Text>
                        )}
                      </div>
                      <Stack direction="horizontal" gap={1}>
                        <Badge bg={banner.isActive ? "success" : "secondary"}>
                          {banner.isActive ? "Ativo" : "Inativo"}
                        </Badge>
                        <Badge bg="outline-secondary" text="dark">
                          ordem {banner.order}
                        </Badge>
                      </Stack>
                    </div>
                    {banner.linkUrl && (
                      <Card.Text className="text-muted small mb-3">
                        <strong>Link:</strong> {banner.linkUrl}
                      </Card.Text>
                    )}
                    <div className="d-flex gap-2">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => openBannerModal(banner)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => handleDeleteBanner(banner)}
                      >
                        Remover
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </section>

      <section>
        <div className="d-flex align-items-center justify-content-between mb-3">
          <div>
            <h2 className="h5 mb-1">Links úteis</h2>
            <p className="text-secondary mb-0">
              Cadastre atalhos com ícones, botões personalizados e uploads de imagem para destacar comunidades, páginas e materiais importantes.
            </p>
          </div>
          <Button variant="primary" onClick={() => openLinkModal()}>
            Adicionar link
          </Button>
        </div>

        {linkItems.length === 0 ? (
          <Card className="border-dashed text-center py-5">
            <Card.Body>
              <p className="text-secondary mb-0">
                Nenhum link cadastrado. Clique em &ldquo;Adicionar link&rdquo; para começar.
              </p>
            </Card.Body>
          </Card>
        ) : (
          <Row className="g-4">
            {linkItems.map((link) => {
              const IconComponent = resolveIconComponent(link.icon ?? "");
              return (
                <Col key={link.id} md={6} xl={4}>
                  <Card className="h-100 shadow-sm border-0">
                    {link.imageUrl ? (
                      <div className="ratio ratio-16x9 bg-light position-relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={link.imageUrl}
                          alt={link.title}
                          className="w-100 h-100 object-fit-cover rounded-top"
                        />
                      </div>
                    ) : (
                      <div className="ratio ratio-16x9 bg-light rounded-top d-flex align-items-center justify-content-center text-secondary">
                        <span className="small">Sem imagem</span>
                      </div>
                    )}
                    <Card.Body>
                      <div className="d-flex align-items-start justify-content-between mb-3">
                        <div>
                          <Card.Title className="h6 mb-1">{link.title}</Card.Title>
                          {link.description && (
                            <Card.Text className="text-secondary small mb-0">
                              {link.description}
                            </Card.Text>
                          )}
                        </div>
                        <Stack direction="horizontal" gap={1}>
                          <Badge bg={link.isActive ? "success" : "secondary"}>
                            {link.isActive ? "Ativo" : "Inativo"}
                          </Badge>
                          <Badge bg="outline-secondary" text="dark">
                            ordem {link.order}
                          </Badge>
                        </Stack>
                      </div>
                      <Card.Text className="text-muted small mb-2">
                        <strong>Destino:</strong> {link.url}
                      </Card.Text>
                      <div className="d-flex align-items-center gap-2 mb-3">
                        {IconComponent ? (
                          <IconComponent size={18} strokeWidth={1.6} />
                        ) : (
                          <span className="text-muted small">Sem ícone</span>
                        )}
                        <Badge bg="primary" className="text-uppercase">
                          {link.buttonLabel}
                        </Badge>
                      </div>
                      <div className="d-flex gap-2">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => openLinkModal(link)}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="outline-danger"
                          size="sm"
                          onClick={() => handleDeleteLink(link)}
                        >
                          Remover
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

      <Modal show={isLinkModalOpen} onHide={closeLinkModal} size="lg">
        <Form onSubmit={handleSubmitLink}>
          <Modal.Header closeButton>
            <Modal.Title>{linkModalState.id ? "Editar link" : "Adicionar link"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="d-flex flex-column gap-3">
              {linkModalState.feedback ? (
                <Alert
                  variant={linkModalState.feedback.type === "success" ? "success" : "danger"}
                  onClose={() => setLinkModalState((prev) => ({ ...prev, feedback: null }))}
                  dismissible
                >
                  {linkModalState.feedback.message}
                </Alert>
              ) : null}

              <Row className="g-3">
                <Col md={8}>
                  <Form.Group controlId="link-title">
                    <Form.Label>Título</Form.Label>
                    <Form.Control
                      type="text"
                      value={linkModalState.title}
                      onChange={handleLinkInputChange("title")}
                      required
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="link-order">
                    <Form.Label>Ordem</Form.Label>
                    <Form.Control
                      type="number"
                      value={linkModalState.order}
                      onChange={handleLinkOrderChange}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group controlId="link-description">
                <Form.Label>Descrição</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={linkModalState.description}
                  onChange={handleLinkInputChange("description")}
                />
              </Form.Group>

              <Row className="g-3">
                <Col md={8}>
                  <Form.Group controlId="link-url">
                    <Form.Label>URL de destino</Form.Label>
                    <Form.Control
                      type="url"
                      inputMode="url"
                      value={linkModalState.url}
                      onChange={handleLinkInputChange("url")}
                      required
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="link-button-label">
                    <Form.Label>Texto do botão</Form.Label>
                    <Form.Control
                      type="text"
                      value={linkModalState.buttonLabel}
                      onChange={handleLinkInputChange("buttonLabel")}
                      required
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row className="g-3">
                <Col md={6}>
                  <Form.Group controlId="link-icon">
                    <Form.Label>Ícone (Tabler icons)</Form.Label>
                    <Form.Select
                      value={ICON_CHOICES.some((option) => option.value === linkModalState.icon) ? linkModalState.icon : ""}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (value) {
                          setLinkModalState((prev) => ({ ...prev, icon: value }));
                        }
                      }}
                    >
                      <option value="">Escolher</option>
                      {ICON_CHOICES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Text>
                      Ou informe manualmente o nome do componente abaixo.
                    </Form.Text>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group controlId="link-icon-manual">
                    <Form.Label>Ícone personalizado</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="Ex.: IconBrandWhatsapp"
                      value={linkModalState.icon}
                      onChange={handleLinkInputChange("icon")}
                    />
                    <Form.Text>
                      Utilize nomes válidos do pacote <code>@tabler/icons-react</code>.
                    </Form.Text>
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group controlId="link-image">
                <Form.Label>Imagem ou GIF (opcional)</Form.Label>
                <Form.Control type="file" accept="image/*" onChange={handleLinkImageChange} />
                <Form.Text className="d-block">
                  Formatos suportados: PNG, JPG, WebP ou GIF animado. A imagem é exibida acima do botão.
                </Form.Text>
                {linkModalState.id && (
                  <Form.Check
                    type="switch"
                    id="link-remove-image"
                    label="Remover imagem atual"
                    className="mt-2"
                    checked={linkModalState.removeImage}
                    onChange={handleLinkRemoveImageChange}
                  />
                )}
              </Form.Group>

              <Form.Check
                type="switch"
                id="link-active"
                label="Link ativo"
                checked={linkModalState.isActive}
                onChange={handleLinkActiveChange}
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={closeLinkModal} disabled={linkModalState.isSubmitting}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={linkModalState.isSubmitting}>
              {linkModalState.isSubmitting ? "Salvando..." : "Salvar link"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={isBannerModalOpen} onHide={closeBannerModal}>
        <Form onSubmit={handleSubmitBanner}>
          <Modal.Header closeButton>
            <Modal.Title>{bannerModalState.id ? "Editar banner" : "Adicionar banner"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="d-flex flex-column gap-3">
              {bannerModalState.feedback ? (
                <Alert
                  variant={bannerModalState.feedback.type === "success" ? "success" : "danger"}
                  onClose={() => setBannerModalState((prev) => ({ ...prev, feedback: null }))}
                  dismissible
                >
                  {bannerModalState.feedback.message}
                </Alert>
              ) : null}

              <Row className="g-3">
                <Col md={8}>
                  <Form.Group controlId="banner-title">
                    <Form.Label>Título</Form.Label>
                    <Form.Control
                      type="text"
                      value={bannerModalState.title}
                      onChange={handleBannerInputChange("title")}
                      required
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="banner-order">
                    <Form.Label>Ordem</Form.Label>
                    <Form.Control
                      type="number"
                      value={bannerModalState.order}
                      onChange={handleBannerOrderChange}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group controlId="banner-subtitle">
                <Form.Label>Subtítulo (opcional)</Form.Label>
                <Form.Control
                  type="text"
                  value={bannerModalState.subtitle}
                  onChange={handleBannerInputChange("subtitle")}
                />
              </Form.Group>

              <Form.Group controlId="banner-linkUrl">
                <Form.Label>URL (opcional)</Form.Label>
                <Form.Control
                  type="url"
                  inputMode="url"
                  value={bannerModalState.linkUrl}
                  onChange={handleBannerInputChange("linkUrl")}
                  placeholder="https://..."
                />
              </Form.Group>

              <Form.Group controlId="banner-file">
                <Form.Label>Imagem ou GIF</Form.Label>
                <Form.Control type="file" accept="image/*" onChange={handleBannerFileChange} />
                <Form.Text className="d-block">
                  Envie a mídia que será exibida no topo da página. Recomendamos proporção 16:9.
                </Form.Text>
              </Form.Group>

              <Form.Check
                type="switch"
                id="banner-active"
                label="Banner ativo"
                checked={bannerModalState.isActive}
                onChange={handleBannerActiveChange}
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={closeBannerModal} disabled={bannerModalState.isSubmitting}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={bannerModalState.isSubmitting}>
              {bannerModalState.isSubmitting ? "Salvando..." : "Salvar banner"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
};

export default AdminUsefulLinksManager;
