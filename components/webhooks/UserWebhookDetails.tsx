"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Form, Modal, Table } from "react-bootstrap";
import Image from "next/image";
import ActionFeedbackOverlay, {
  type ActionFeedback,
  type ActionFeedbackDetails,
} from "components/common/ActionFeedbackOverlay";
import { IconUserCircle } from "@tabler/icons-react";

import { formatDate } from "lib/format";
import type {
  UserWebhookDetails,
  WebhookEventSummary,
  WebhookTestResult,
} from "types/webhooks";

type Props = {
  webhook: UserWebhookDetails;
  events: WebhookEventSummary[];
  variant?: "page" | "credentials" | "endpoint";
};

type Feedback = ActionFeedback | null;

type FormState = {
  verifyToken: string;
  appId: string;
  businessAccountId: string;
  phoneNumberId: string;
  accessToken: string;
};

const copyToClipboard = async (value: string) => {
  if (!navigator?.clipboard) {
    throw new Error("Clipboard API indisponível");
  }

  await navigator.clipboard.writeText(value);
};

const mapWebhookToFormState = (webhook: UserWebhookDetails): FormState => ({
  verifyToken: webhook.verifyToken,
  appId: webhook.appId ?? "",
  businessAccountId: webhook.businessAccountId ?? "",
  phoneNumberId: webhook.phoneNumberId ?? "",
  accessToken: webhook.accessToken ?? "",
});

const UserWebhookDetails = ({ webhook, events, variant = "page" }: Props) => {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [currentWebhook, setCurrentWebhook] = useState<UserWebhookDetails>(webhook);
  const [formState, setFormState] = useState<FormState>(mapWebhookToFormState(webhook));
  const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const headingText =
    variant === "credentials"
      ? "Credenciais da Meta/WhatsApp"
      : variant === "endpoint"
        ? "Webhook e tokens públicos"
        : "Configuração do webhook";
  const descriptionText =
    variant === "endpoint"
      ? "Use estas informações para registrar o endpoint e confirmar o Verify Token diretamente no painel da Meta."
      : "Configure os dados exigidos pela documentação oficial da Meta para receber notificações e realizar ações com a Cloud API do WhatsApp. Preencha o identificador do aplicativo, as contas vinculadas e o token de acesso permanente fornecido pelo Business Manager.";

  useEffect(() => {
    setCurrentWebhook(webhook);
    setFormState(mapWebhookToFormState(webhook));
  }, [webhook]);

  const handleDismissFeedback = useCallback(() => {
    setFeedback(null);
  }, []);

  const handleCloseTestModal = useCallback(() => {
    setIsTestModalOpen(false);
  }, []);

  const testResultEntries = useMemo(() => {
    if (!testResult) {
      return [] as Array<{ label: string; value: string }>;
    }

    const entries: Array<{ label: string; value: string }> = [];

    if (testResult.displayPhoneNumber) {
      entries.push({ label: "Número exibido", value: testResult.displayPhoneNumber });
    }

    if (testResult.verifiedName) {
      entries.push({ label: "Nome verificado", value: testResult.verifiedName });
    }

    entries.push({ label: "Phone Number ID", value: testResult.phoneNumberId });
    entries.push({ label: "Business Account ID", value: testResult.businessAccountId });

    if (testResult.profile?.email) {
      entries.push({ label: "E-mail cadastrado", value: testResult.profile.email });
    }

    if (testResult.profile?.website) {
      entries.push({ label: "Site", value: testResult.profile.website });
    }

    if (testResult.profile?.vertical) {
      entries.push({ label: "Segmento", value: testResult.profile.vertical });
    }

    if (testResult.profile?.about) {
      entries.push({ label: "Descrição", value: testResult.profile.about });
    }

    return entries;
  }, [testResult]);

  const profilePictureUrl = testResult?.profile?.profilePictureUrl ?? null;
  const profileAbout = testResult?.profile?.about ?? null;

  const captureDetails = useCallback(
    (overrides?: Partial<ActionFeedbackDetails>): ActionFeedbackDetails => ({
      Endpoint: (overrides?.Endpoint as string) ?? currentWebhook.endpoint,
      "Verify Token": (overrides?.["Verify Token"] as string) ?? formState.verifyToken,
      "App ID": (overrides?.["App ID"] as string) ?? formState.appId,
      "WhatsApp Business Account ID":
        (overrides?.["WhatsApp Business Account ID"] as string) ?? formState.businessAccountId,
      "Phone Number ID": (overrides?.["Phone Number ID"] as string) ?? formState.phoneNumberId,
      "Access Token": (overrides?.["Access Token"] as string) ?? formState.accessToken,
      ...(overrides ?? {}),
    }),
    [
      currentWebhook.endpoint,
      formState.accessToken,
      formState.appId,
      formState.businessAccountId,
      formState.phoneNumberId,
      formState.verifyToken,
    ]
  );

  const handleCopy = async (label: string, value: string) => {
    setIsCopying(true);
    setFeedback(null);

    try {
      await copyToClipboard(value);
      setFeedback({ type: "success", message: `${label} copiado para a área de transferência.` });
    } catch (error) {
      console.error("Erro ao copiar", error);
      setFeedback({
        type: "danger",
        message: "Não foi possível copiar o valor. Copie manualmente.",
      });
    } finally {
      setIsCopying(false);
    }
  };

  const handleFieldChange = (field: keyof FormState) =>
    (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      setFormState((previous) => ({ ...previous, [field]: target.value }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/webhooks/meta/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          verifyToken: formState.verifyToken,
          appId: formState.appId || null,
          businessAccountId: formState.businessAccountId || null,
          phoneNumberId: formState.phoneNumberId || null,
          accessToken: formState.accessToken || null,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload?.message ?? "Não foi possível salvar as configurações do webhook.";
        throw new Error(message);
      }

      if (payload?.webhook) {
        setCurrentWebhook(payload.webhook);
        setFormState(mapWebhookToFormState(payload.webhook));
      }

      const latestWebhook = payload?.webhook ?? {
        endpoint: currentWebhook.endpoint,
        verifyToken: formState.verifyToken,
        appId: formState.appId,
        businessAccountId: formState.businessAccountId,
        phoneNumberId: formState.phoneNumberId,
        accessToken: formState.accessToken,
      };

      setFeedback({
        type: "success",
        message: payload?.message ?? "Configurações atualizadas com sucesso.",
        details: captureDetails({
          Endpoint: latestWebhook.endpoint,
          "Verify Token": latestWebhook.verifyToken,
          "App ID": latestWebhook.appId ?? "",
          "WhatsApp Business Account ID": latestWebhook.businessAccountId ?? "",
          "Phone Number ID": latestWebhook.phoneNumberId ?? "",
          "Access Token": latestWebhook.accessToken ?? "",
        }),
      });
    } catch (error) {
      console.error("Erro ao atualizar webhook", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as configurações do webhook.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTest = async () => {
    setFeedback(null);
    setIsTesting(true);
    setTestResult(null);
    setIsTestModalOpen(false);

    try {
      const response = await fetch("/api/webhooks/meta/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          verifyToken: formState.verifyToken,
          appId: formState.appId || null,
          businessAccountId: formState.businessAccountId || null,
          phoneNumberId: formState.phoneNumberId || null,
          accessToken: formState.accessToken || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as WebhookTestResult | null;

      if (!response.ok) {
        const message =
          payload?.message ?? "Não foi possível testar a configuração do webhook.";
        throw new Error(message);
      }

      const normalizedResult: WebhookTestResult = {
        message:
          payload?.message ?? "Webhook configurado e comunicação validada com sucesso.",
        phoneNumberId:
          payload?.phoneNumberId ?? formState.phoneNumberId ?? currentWebhook.phoneNumberId ?? "",
        businessAccountId:
          payload?.businessAccountId ??
          formState.businessAccountId ??
          currentWebhook.businessAccountId ??
          "",
        displayPhoneNumber: payload?.displayPhoneNumber ?? null,
        verifiedName: payload?.verifiedName ?? null,
        profile: payload?.profile ?? null,
      };

      setTestResult(normalizedResult);
      setIsTestModalOpen(true);
    } catch (error) {
      console.error("Erro ao testar webhook", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível testar a configuração do webhook.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <>
      <ActionFeedbackOverlay feedback={feedback} onClose={handleDismissFeedback} />

      <Modal show={isTestModalOpen && !!testResult} onHide={handleCloseTestModal} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Teste da comunicação com a Meta</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {testResult ? (
            <div className="d-flex flex-column gap-4">
              <div className="d-flex flex-column flex-lg-row gap-4 align-items-start">
                <div className="ratio ratio-1x1" style={{ maxWidth: "160px", minWidth: "140px" }}>
                  {profilePictureUrl ? (
                    <Image
                      src={profilePictureUrl}
                      alt="Foto do perfil conectada ao número testado"
                      width={160}
                      height={160}
                      className="w-100 h-100 rounded border object-fit-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="d-flex flex-column align-items-center justify-content-center bg-light border rounded w-100 h-100">
                      <IconUserCircle size={64} strokeWidth={1.5} className="text-secondary" />
                      <small className="mt-2 text-secondary">Sem foto disponível</small>
                    </div>
                  )}
                </div>

                <div className="d-flex flex-column gap-2 flex-grow-1">
                  <p className="mb-0 text-secondary">{testResult.message}</p>

                  {testResult.profile?.email || testResult.profile?.website ? (
                    <div className="d-flex flex-wrap gap-2">
                      {testResult.profile?.email ? (
                        <Badge bg="primary" className="text-uppercase fw-semibold">
                          {testResult.profile.email}
                        </Badge>
                      ) : null}
                      {testResult.profile?.website ? (
                        <Badge bg="info" text="dark" className="fw-semibold">
                          {testResult.profile.website}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}

                  {profileAbout ? (
                    <Card className="border-0 bg-light">
                      <Card.Body>
                        <h6 className="fw-semibold mb-2">Descrição do perfil</h6>
                        <p className="mb-0 text-secondary">{profileAbout}</p>
                      </Card.Body>
                    </Card>
                  ) : null}
                </div>
              </div>

              {testResultEntries.length > 0 ? (
                <Table bordered hover responsive className="mb-0">
                  <tbody>
                    {testResultEntries.map(({ label, value }) => (
                      <tr key={label}>
                        <th scope="row" className="w-50 align-top text-nowrap">{label}</th>
                        <td className="text-break">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </div>
          ) : (
            <p className="mb-0 text-secondary">
              Execute um teste de comunicação para visualizar os dados retornados pela Meta.
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseTestModal}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>

      <div className="d-flex flex-column gap-4">
        <Card>
        <Card.Header>
          <Card.Title as="h2" className="h5 mb-0">
            {headingText}
          </Card.Title>
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-3">
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <p className="text-secondary mb-0">
              {descriptionText}
            </p>

            <Form.Group controlId="webhook-endpoint">
              <Form.Label>Endpoint</Form.Label>
              <div className="d-flex gap-2 flex-column flex-lg-row">
                <Form.Control value={currentWebhook.endpoint} readOnly />
                <Button
                  variant="outline-primary"
                  disabled={isCopying}
                  onClick={() => handleCopy("Endpoint", currentWebhook.endpoint)}
                >
                  Copiar endpoint
                </Button>
              </div>
              <Form.Text>
                Cadastre esta URL no painel de Webhooks da Meta para receber os eventos na sua conta.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="webhook-verify-token">
              <Form.Label>Verify Token</Form.Label>
              <div className="d-flex gap-2 flex-column flex-lg-row">
                <Form.Control
                  value={formState.verifyToken}
                  onChange={handleFieldChange("verifyToken")}
                  placeholder="Token definido para a verificação do webhook"
                  disabled={isSubmitting}
                  required
                />
                <Button
                  variant="outline-primary"
                  disabled={isCopying}
                  onClick={() => handleCopy("Verify Token", formState.verifyToken)}
                >
                  Copiar verify token
                </Button>
              </div>
              <Form.Text>
                Este valor deve ser informado quando a Meta solicitar o <code>hub.verify_token</code>
                durante a validação do webhook.
              </Form.Text>
            </Form.Group>

            <Form.Group controlId="webhook-app-id">
              <Form.Label>ID do aplicativo (App ID)</Form.Label>
              <Form.Control
                value={formState.appId}
                onChange={handleFieldChange("appId")}
                placeholder="Ex.: 123456789012345"
                disabled={isSubmitting}
              />
            </Form.Group>

            <div className="row g-3">
              <div className="col-md-6">
                <Form.Group controlId="webhook-business-account">
                  <Form.Label>WhatsApp Business Account ID</Form.Label>
                  <Form.Control
                    value={formState.businessAccountId}
                    onChange={handleFieldChange("businessAccountId")}
                    placeholder="Identificador da conta do WhatsApp Business"
                    disabled={isSubmitting}
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group controlId="webhook-phone-number-id">
                  <Form.Label>Phone Number ID</Form.Label>
                  <Form.Control
                    value={formState.phoneNumberId}
                    onChange={handleFieldChange("phoneNumberId")}
                    placeholder="ID do número configurado na Cloud API"
                    disabled={isSubmitting}
                  />
                </Form.Group>
              </div>
            </div>

            <Form.Group controlId="webhook-access-token">
              <Form.Label>Access Token</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={formState.accessToken}
                onChange={handleFieldChange("accessToken")}
                placeholder="Token permanente gerado no Business Manager"
                disabled={isSubmitting}
              />
              <Form.Text>
                Necessário para enviar mensagens e consultar a API oficial do WhatsApp.
              </Form.Text>
            </Form.Group>

            <div className="d-flex justify-content-end gap-2">
              <Button
                type="button"
                variant="outline-secondary"
                disabled={isSubmitting || isTesting}
                onClick={handleTest}
              >
                {isTesting ? "Testando..." : "Testar comunicação"}
              </Button>
              <Button type="submit" disabled={isSubmitting || isTesting}>
                {isSubmitting ? "Salvando..." : "Salvar configurações"}
              </Button>
            </div>
          </Form>

          <div className="bg-light rounded p-3">
            <p className="mb-1 fw-semibold">Referência rápida</p>
            <p className="text-secondary mb-2">
              1. Cadastre o endpoint acima na Meta Cloud API.
              <br />
              2. Preencha o Verify Token para concluir a verificação.
              <br />
              3. Informe App ID, Phone Number ID e Access Token para enviar mensagens com a API.
            </p>
            <a
              href="https://developers.facebook.com/docs/graph-api/webhooks"
              target="_blank"
              rel="noreferrer"
              className="fw-semibold"
            >
              Abrir documentação completa de Webhooks da Meta
            </a>
          </div>

          <div className="text-secondary small">
            Atualizado em {formatDate(currentWebhook.updatedAt)}.
            {currentWebhook.lastEventAt && (
              <>
                {" "}
                Último evento recebido em {formatDate(currentWebhook.lastEventAt)}.
              </>
            )}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title as="h2" className="h5 mb-0">
            Histórico de eventos recentes
          </Card.Title>
        </Card.Header>
        <Card.Body>
          {events.length === 0 ? (
            <p className="text-secondary mb-0">
              Ainda não recebemos notificações da Meta para este webhook.
            </p>
          ) : (
            <div className="table-responsive">
              <Table hover responsive className="mb-0">
                <thead>
                  <tr>
                    <th className="text-secondary">Evento</th>
                    <th className="text-secondary">Recebido em</th>
                    <th className="text-secondary">Resumo</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const preview = event.payload.slice(0, 120);
                    const suffix = event.payload.length > 120 ? "…" : "";

                    return (
                      <tr key={event.id}>
                        <td>
                          {event.eventType ? (
                            <Badge bg="light" text="dark">
                              {event.eventType}
                            </Badge>
                          ) : (
                            <span className="text-secondary">-</span>
                          )}
                        </td>
                        <td>{formatDate(event.receivedAt)}</td>
                        <td>
                          <code className="d-block text-break">
                            {preview}
                            {suffix}
                          </code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
    </>
  );
};

export default UserWebhookDetails;
