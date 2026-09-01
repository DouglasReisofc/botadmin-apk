"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Spinner, Table } from "react-bootstrap";

import FloatingAlert from "components/common/FloatingAlert";

type PushSubscriber = {
  id: number;
  name: string;
  email: string;
  tokenCount: number;
  platforms: { android: number; ios: number; web: number };
  tokens: Array<{ token: string; platform: string; device_id: string | null; last_seen_at: string }>;
};

type Feedback = { type: "success" | "danger" | "info"; message: string } | null;

const AdminPushNotificationTestCard = () => {
  const [testTitle, setTestTitle] = useState("Notificação de teste");
  const [testBody, setTestBody] = useState("Olá! Esta é uma notificação de teste.");
  const [testToken, setTestToken] = useState("");
  const [testImageUrl, setTestImageUrl] = useState("");
  const [testTargetUrl, setTestTargetUrl] = useState("");
  const [testRecipient, setTestRecipient] = useState<string>("");
  const [sendingTest, setSendingTest] = useState(false);
  const [loadingSubscribers, setLoadingSubscribers] = useState(true);
  const [subscribers, setSubscribers] = useState<PushSubscriber[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadedMedia, setUploadedMedia] = useState<
    | {
        path: string;
        url: string;
        fileName: string;
        mimeType: string | null;
      }
    | null
  >(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadingSubscribers(true);
        const response = await fetch("/api/admin/push/subscribers", { cache: "no-store" });
        if (!mounted) return;
        if (response.ok) {
          const data = await response.json();
          setSubscribers(Array.isArray(data?.subscribers) ? data.subscribers : []);
        } else {
          setSubscribers([]);
        }
      } catch {
        if (mounted) setSubscribers([]);
      } finally {
        if (mounted) setLoadingSubscribers(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedSubscriber = useMemo(() => {
    if (!testRecipient.startsWith("user:")) {
      return null;
    }
    const id = Number.parseInt(testRecipient.split(":")[1] ?? "", 10);
    if (!Number.isFinite(id)) {
      return null;
    }
    return subscribers.find((subscriber) => subscriber.id === id) ?? null;
  }, [subscribers, testRecipient]);

  const handleSendTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setSendingTest(true);

    try {
      const trimmedToken = testToken.trim();
      const trimmedImage = testImageUrl.trim();
      const trimmedTargetUrl = testTargetUrl.trim();

      const payload: Record<string, unknown> = {
        title: testTitle,
        body: testBody,
      };

      if (trimmedToken) {
        payload.tokens = [trimmedToken];
      } else if (testRecipient === "broadcast") {
        payload.broadcast = true;
      } else if (testRecipient.startsWith("user:")) {
        const id = Number.parseInt(testRecipient.split(":")[1] ?? "", 10);
        if (Number.isFinite(id) && id > 0) {
          payload.userId = id;
        }
      }

      if (!payload.broadcast && !payload.userId && !payload.tokens) {
        setFeedback({
          type: "danger",
          message: "Selecione um destinatário ou informe um token de dispositivo.",
        });
        setSendingTest(false);
        return;
      }

      const resolvedImage = uploadedMedia?.url || trimmedImage;
      if (resolvedImage) {
        payload.imageUrl = resolvedImage;
        payload.android = { imageUrl: resolvedImage };
      }

      if (trimmedTargetUrl) {
        payload.targetUrl = trimmedTargetUrl;
      }

      const response = await fetch("/api/notifications/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof json?.message === "string" ? json.message : "Falha ao enviar notificação.",
        );
      }

      setFeedback({
        type: "success",
        message: payload.broadcast
          ? "Notificação enviada para todos os usuários com push ativo."
          : "Notificação enviada com sucesso.",
      });
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro inesperado ao enviar o teste.",
      });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <Card className="mb-5">
      <Card.Header>
        <Card.Title as="h2" className="h5 mb-0">
          Enviar notificação push de teste
        </Card.Title>
        <Card.Subtitle className="text-secondary small mt-1">
          Valide o envio via Firebase para um usuário específico, token individual ou todos os
          dispositivos conectados.
        </Card.Subtitle>
      </Card.Header>
      <Card.Body>
        <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

        <Form onSubmit={handleSendTest} className="d-flex flex-column gap-4">
          <Row className="g-3 align-items-end">
            <Col lg={6}>
              <Form.Group>
                <Form.Label>Destinatário</Form.Label>
                <Form.Select
                  value={testRecipient}
                  onChange={(event) => setTestRecipient(event.currentTarget.value)}
                  disabled={loadingSubscribers}
                >
                  <option value="">Selecione uma opção</option>
                  <option value="broadcast">Todos os usuários (broadcast)</option>
                  {subscribers.map((subscriber) => (
                    <option key={subscriber.id} value={`user:${subscriber.id}`}>
                      {subscriber.name} ({subscriber.email ?? "sem e-mail"}) — {subscriber.tokenCount}{" "}
                      tokens
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-secondary">
                  Escolha um usuário cadastrado com tokens de push ou dispare para todos.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col lg={6}>
              <Form.Group>
                <Form.Label>Token manual (opcional)</Form.Label>
                <Form.Control
                  value={testToken}
                  onChange={(event) => setTestToken(event.currentTarget.value)}
                  placeholder="ExponentPushToken[...] ou token FCM"
                />
                <Form.Text className="text-secondary">
                  Preencha para enviar apenas para um dispositivo específico.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Título</Form.Label>
                <Form.Control
                  value={testTitle}
                  onChange={(event) => setTestTitle(event.currentTarget.value)}
                  maxLength={100}
                  required
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Link/URL de destino</Form.Label>
                <Form.Control
                  value={testTargetUrl}
                  onChange={(event) => setTestTargetUrl(event.currentTarget.value)}
                  placeholder="https://painel.seusite.com"
                />
                <Form.Text className="text-secondary">
                  Opcional. Os apps compatíveis abrirão esse link ao tocar na notificação.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          <Form.Group>
            <Form.Label>Mensagem</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={testBody}
              onChange={(event) => setTestBody(event.currentTarget.value)}
              maxLength={500}
              required
            />
          </Form.Group>

          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Imagem (URL opcional)</Form.Label>
                <Form.Control
                  value={testImageUrl}
                  onChange={(event) => setTestImageUrl(event.currentTarget.value)}
                  placeholder="https://cdn.seusite.com/banner.png"
                  disabled={Boolean(uploadedMedia)}
                />
                <Form.Text className="text-secondary">
                  Informe uma URL pública ou envie um arquivo abaixo.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Enviar arquivo de imagem</Form.Label>
                <Form.Control
                  type="file"
                  accept="image/*"
                  disabled={uploadingMedia}
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) {
                      return;
                    }
                    setFeedback(null);
                    setUploadingMedia(true);
                    try {
                      const formData = new FormData();
                      formData.append("file", file);
                      if (uploadedMedia?.path) {
                        formData.append("previousPath", uploadedMedia.path);
                      }
                      const response = await fetch("/api/admin/notifications/push/upload", {
                        method: "POST",
                        body: formData,
                      });
                      const data = await response.json().catch(() => ({}));
                      if (!response.ok) {
                        throw new Error(
                          typeof data?.message === "string"
                            ? data.message
                            : "Não foi possível enviar a mídia.",
                        );
                      }
                      setUploadedMedia(data.media ?? null);
                      setTestImageUrl("");
                      setFeedback({ type: "success", message: "Mídia enviada com sucesso." });
                    } catch (error) {
                      setFeedback({
                        type: "danger",
                        message:
                          error instanceof Error
                            ? error.message
                            : "Erro inesperado ao enviar a mídia.",
                      });
                    } finally {
                      setUploadingMedia(false);
                      event.currentTarget.value = "";
                    }
                  }}
                />
                <Form.Text className="text-secondary">
                  Aceita PNG, JPG ou WebP. O arquivo será hospedado automaticamente.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          {uploadedMedia ? (
            <div className="border rounded p-3">
              <div className="d-flex flex-column flex-md-row align-items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadedMedia.url}
                  alt="Prévia da notificação"
                  style={{ maxWidth: 180, borderRadius: 8 }}
                />
                <div className="flex-grow-1">
                  <p className="mb-2 small">Arquivo enviado: {uploadedMedia.fileName}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline-danger"
                    disabled={uploadingMedia}
                    onClick={async () => {
                      if (!uploadedMedia) return;
                      setUploadingMedia(true);
                      setMediaError(null);
                      try {
                        await fetch("/api/admin/notifications/push/upload", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ path: uploadedMedia.path }),
                        }).catch(() => {});
                        setFeedback({ type: "info", message: "Mídia removida." });
                      } catch {
                        setFeedback({ type: "danger", message: "Não foi possível remover a mídia." });
                      } finally {
                        setUploadedMedia(null);
                        setUploadingMedia(false);
                      }
                    }}
                  >
                    Remover arquivo
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="d-flex justify-content-end">
            <Button type="submit" disabled={sendingTest}>
              {sendingTest ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" /> Enviando...
                </>
              ) : (
                "Enviar notificação de teste"
              )}
            </Button>
          </div>
        </Form>

        <div className="mt-4">
          <div className="d-flex align-items-center gap-2 mb-2">
            <h3 className="h6 mb-0">Dispositivos com push ativo</h3>
            {loadingSubscribers ? (
              <Spinner animation="border" size="sm" role="status" />
            ) : null}
          </div>
          {subscribers.length === 0 ? (
            <p className="text-secondary small mb-0">
              Nenhum dispositivo com push ativo foi encontrado. Garanta que os apps estejam enviando
              o token FCM para o backend.
            </p>
          ) : selectedSubscriber ? (
            <div className="d-flex flex-column gap-2">
              <p className="text-secondary small mb-0">
                {selectedSubscriber.name} possui {selectedSubscriber.tokenCount} dispositivo(s) com
                push ativo.
              </p>
              <Table responsive size="sm" bordered className="mb-0">
                <thead>
                  <tr>
                    <th>Plataforma</th>
                    <th>Token</th>
                    <th>Último acesso</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSubscriber.tokens.map((token) => (
                    <tr key={token.token}>
                      <td className="text-uppercase small">{token.platform}</td>
                      <td className="text-break small">{token.token}</td>
                      <td className="small">
                        {token.last_seen_at
                          ? new Intl.DateTimeFormat("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            }).format(new Date(token.last_seen_at))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <div className="d-flex flex-wrap gap-3">
              {subscribers.map((subscriber) => (
                <div key={subscriber.id} className="border rounded p-3">
                  <div className="fw-semibold">{subscriber.name}</div>
                  <div className="text-secondary small">{subscriber.email}</div>
                  <div className="small mt-2">
                    Android: {subscriber.platforms.android} • iOS: {subscriber.platforms.ios} • Web:{" "}
                    {subscriber.platforms.web}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default AdminPushNotificationTestCard;
