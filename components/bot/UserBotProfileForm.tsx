"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Image, Row, Spinner } from "react-bootstrap";

import {
  coerceMetaProfileVertical,
  DEFAULT_META_PROFILE_VERTICAL,
  META_PROFILE_VERTICAL_OPTIONS,
} from "lib/meta-profile-verticals";

import type { MetaBusinessProfile } from "types/meta";

const MAX_WEBSITES = 2;

const mapProfileToFormState = (profile: MetaBusinessProfile | null) => ({
  about: profile?.about ?? "",
  address: profile?.address ?? "",
  description: profile?.description ?? "",
  email: profile?.email ?? "",
  vertical: coerceMetaProfileVertical(profile?.vertical ?? undefined, DEFAULT_META_PROFILE_VERTICAL),
  websites: profile?.websites ?? [],
  profilePictureUrl: profile?.profilePictureUrl ?? null,
});

interface UserBotProfileFormProps {
  profile: MetaBusinessProfile | null;
  hasWebhookCredentials: boolean;
  apiBase?: string;
  phoneNumber?: string | null;
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type ProfileFormState = ReturnType<typeof mapProfileToFormState>;

const UserBotProfileForm = ({ profile, hasWebhookCredentials, apiBase, phoneNumber }: UserBotProfileFormProps) => {
  const profileEndpoint = apiBase ?? "/api/meta/profile";
  const photoEndpoint = `${profileEndpoint}/photo`;
  const [formState, setFormState] = useState<ProfileFormState>(() => mapProfileToFormState(profile));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [photoFeedback, setPhotoFeedback] = useState<Feedback>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  useEffect(() => {
    setFormState(mapProfileToFormState(profile));
  }, [profile]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return () => {};
    }

    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photoFile]);

  const websitePlaceholders = useMemo(
    () =>
      formState.websites.length > 0
        ? formState.websites
        : Array.from({ length: MAX_WEBSITES }).map(() => ""),
    [formState.websites],
  );

  const handleChange = (field: keyof ProfileFormState, value: string | string[]) => {
    setFormState((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasWebhookCredentials) {
      setFeedback({
        type: "danger",
        message: "Configure primeiro o webhook da Meta para atualizar o perfil.",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const sanitizedWebsites = formState.websites
      .map((website) => website.trim())
      .filter((website) => website.length > 0);

    const response = await fetch(profileEndpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        about: formState.about,
        address: formState.address,
        description: formState.description,
        email: formState.email,
        vertical: formState.vertical,
        websites: sanitizedWebsites,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Erro ao salvar o perfil." }));
      setFeedback({ type: "danger", message: error.message ?? "Não foi possível salvar o perfil." });
      setIsSubmitting(false);
      return;
    }

    const data = await response.json().catch(() => null);

    if (data?.profile) {
      setFormState(mapProfileToFormState(data.profile));
    }

    setFeedback({ type: "success", message: data?.message ?? "Perfil atualizado com sucesso." });
    setIsSubmitting(false);
  };

  const handleWebsiteChange = (index: number, value: string) => {
    setFormState((previous) => {
      const websites = Array.from({ length: MAX_WEBSITES }, (_, siteIndex) => {
        if (siteIndex === index) {
          return value;
        }

        return previous.websites[siteIndex] ?? "";
      });

      return { ...previous, websites };
    });
  };

  const handleUploadPhoto = async () => {
    if (!hasWebhookCredentials) {
      setPhotoFeedback({
        type: "danger",
        message: "Configure primeiro o webhook da Meta para atualizar a foto.",
      });
      return;
    }

    if (!photoFile) {
      setPhotoFeedback({ type: "danger", message: "Selecione uma imagem para enviar." });
      return;
    }

    setIsUploadingPhoto(true);
    setPhotoFeedback(null);

    const formData = new FormData();
    formData.set("photo", photoFile);

    const response = await fetch(photoEndpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Erro ao atualizar a foto." }));
      setPhotoFeedback({
        type: "danger",
        message: error.message ?? "Não foi possível enviar a imagem.",
      });
      setIsUploadingPhoto(false);
      return;
    }

    const data = await response.json().catch(() => null);

    if (data?.profile) {
      setFormState(mapProfileToFormState(data.profile));
      setPhotoFile(null);
    }

    setPhotoFeedback({ type: "success", message: data?.message ?? "Foto atualizada com sucesso." });
    setIsUploadingPhoto(false);
  };

  const handleRemovePhoto = async () => {
    if (!hasWebhookCredentials) {
      setPhotoFeedback({
        type: "danger",
        message: "Configure primeiro o webhook da Meta para remover a foto.",
      });
      return;
    }

    setIsUploadingPhoto(true);
    setPhotoFeedback(null);

    const response = await fetch(photoEndpoint, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Erro ao remover a foto." }));
      setPhotoFeedback({
        type: "danger",
        message: error.message ?? "Não foi possível remover a imagem.",
      });
      setIsUploadingPhoto(false);
      return;
    }

    const data = await response.json().catch(() => null);

    if (data?.profile) {
      setFormState(mapProfileToFormState(data.profile));
    }

    setPhotoFile(null);
    setPhotoFeedback({ type: "success", message: data?.message ?? "Foto removida com sucesso." });
    setIsUploadingPhoto(false);
  };

  return (
    <div className="d-flex flex-column gap-4">
      <Card>
        <Card.Body>
          <Card.Title as="h2" className="h5">
            Informações do perfil
          </Card.Title>
          <Card.Text className="text-secondary mb-4">
            Personalize os dados comerciais exibidos quando seus clientes abrem a conversa no WhatsApp.
          </Card.Text>
          {phoneNumber?.trim() && (
            <Alert variant="info">
              Número configurado: <strong>{phoneNumber.trim()}</strong>. Esse é o contato utilizado pelo bot administrativo para confirmações e mensagens automáticas.
            </Alert>
          )}

          {!hasWebhookCredentials && (
            <Alert variant="warning">
              Configure o webhook da Meta em <strong>Webhook &gt; Credenciais</strong> para liberar a edição do
              perfil do WhatsApp.
            </Alert>
          )}

          {feedback && <Alert variant={feedback.type}>{feedback.message}</Alert>}

          <Form onSubmit={handleSubmit}>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="botProfileAbout">
                  <Form.Label>Sobre</Form.Label>
                  <Form.Control
                    value={formState.about}
                    maxLength={139}
                    placeholder="Mensagem curta exibida no status do WhatsApp"
                    onChange={(event) => handleChange("about", event.target.value)}
                    disabled={!hasWebhookCredentials || isSubmitting}
                  />
                  <Form.Text className="text-secondary">Máximo de 139 caracteres.</Form.Text>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group controlId="botProfileEmail">
                  <Form.Label>E-mail</Form.Label>
                  <Form.Control
                    type="email"
                    value={formState.email}
                    maxLength={128}
                    placeholder="email@empresa.com"
                    onChange={(event) => handleChange("email", event.target.value)}
                    disabled={!hasWebhookCredentials || isSubmitting}
                    autoComplete="email"
                    inputMode="email"
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group controlId="botProfileAddress">
                  <Form.Label>Endereço</Form.Label>
                  <Form.Control
                    value={formState.address}
                    maxLength={256}
                    placeholder="Rua, número, cidade"
                    onChange={(event) => handleChange("address", event.target.value)}
                    disabled={!hasWebhookCredentials || isSubmitting}
                  />
                  <Form.Text className="text-secondary">Máximo de 256 caracteres.</Form.Text>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group controlId="botProfileVertical">
                  <Form.Label>Segmento</Form.Label>
                  <Form.Select
                    value={formState.vertical ?? "UNDEFINED"}
                    onChange={(event) => handleChange("vertical", event.target.value)}
                    disabled={!hasWebhookCredentials || isSubmitting}
                  >
                    {META_PROFILE_VERTICAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col xs={12}>
                <Form.Group controlId="botProfileDescription">
                  <Form.Label>Descrição</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={formState.description}
                    maxLength={512}
                    placeholder="Fale um pouco sobre seu negócio"
                    onChange={(event) => handleChange("description", event.target.value)}
                    disabled={!hasWebhookCredentials || isSubmitting}
                  />
                  <Form.Text className="text-secondary">Máximo de 512 caracteres.</Form.Text>
                </Form.Group>
              </Col>

              <Col xs={12}>
                <Form.Group controlId="botProfileWebsites">
                  <Form.Label>Sites e redes sociais</Form.Label>
                  <Row className="g-2">
                    {websitePlaceholders.map((_, index) => (
                      <Col md={6} key={index}>
                        <Form.Control
                          value={formState.websites[index] ?? ""}
                          placeholder="https://www.seusite.com"
                          onChange={(event) => handleWebsiteChange(index, event.target.value)}
                          disabled={!hasWebhookCredentials || isSubmitting}
                          maxLength={256}
                          inputMode="url"
                        />
                      </Col>
                    ))}
                  </Row>
                  <Form.Text className="text-secondary">
                    Informe até {MAX_WEBSITES} URLs. Uma linha por endereço.
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-end mt-4">
              <Button type="submit" disabled={!hasWebhookCredentials || isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Salvando...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Card.Title as="h2" className="h5">
            Foto do perfil
          </Card.Title>
          <Card.Text className="text-secondary mb-4">
            Atualize a imagem exibida no cabeçalho da conversa do WhatsApp. Utilize arquivos quadrados de até 5 MB.
          </Card.Text>

          {photoFeedback && <Alert variant={photoFeedback.type}>{photoFeedback.message}</Alert>}

          <Row className="g-4 align-items-center">
            <Col sm="auto">
              <div className="position-relative">
                <Image
                  roundedCircle
                  width={96}
                  height={96}
                  src={photoPreview ?? formState.profilePictureUrl ?? "/images/avatar/avatar-fallback.jpg"}
                  alt="Pré-visualização da foto do perfil"
                  style={{ objectFit: "cover" }}
                />
              </div>
            </Col>
            <Col>
              <Form.Group controlId="botProfilePhoto" className="d-flex flex-column gap-2">
                <Form.Control
                  type="file"
                  accept="image/*"
                  onChange={(event) => setPhotoFile((event.target as HTMLInputElement).files?.[0] ?? null)}
                  disabled={!hasWebhookCredentials || isUploadingPhoto}
                />

                <div className="d-flex gap-2">
                  <Button
                    variant="primary"
                    onClick={handleUploadPhoto}
                    disabled={!hasWebhookCredentials || isUploadingPhoto || !photoFile}
                  >
                    {isUploadingPhoto && photoFile ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" /> Enviando...
                      </>
                    ) : (
                      "Enviar foto"
                    )}
                  </Button>
                  <Button
                    variant="outline-danger"
                    onClick={handleRemovePhoto}
                    disabled={!hasWebhookCredentials || isUploadingPhoto || (!formState.profilePictureUrl && !photoPreview)}
                  >
                    {isUploadingPhoto && !photoFile ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" /> Removendo...
                      </>
                    ) : (
                      "Remover foto"
                    )}
                  </Button>
                </div>
              </Form.Group>
            </Col>
          </Row>
        </Card.Body>
      </Card>
    </div>
  );
};

export default UserBotProfileForm;
