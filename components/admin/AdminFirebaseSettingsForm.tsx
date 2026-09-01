"use client";

import { useRef, useState } from "react";
import { Button, Card, Col, Form, Modal, Row } from "react-bootstrap";

import FloatingAlert from "components/common/FloatingAlert";

import type { AdminFirebaseSettings } from "lib/admin-firebase";

type Props = {
  initialSettings: AdminFirebaseSettings | null;
};

const AdminFirebaseSettingsForm = ({ initialSettings }: Props) => {
  const [feedback, setFeedback] = useState<null | { type: "success" | "danger"; message: string }>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const openImportModal = () => {
    setImportError(null);
    setShowImportModal(true);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
  };

  const assignFieldValue = (fieldName: string, value: string | null) => {
    if (!value) return;
    const form = formRef.current;
    if (!form) return;
    const element = form.elements.namedItem(fieldName);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const handleImportSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setImportError(null);

    const raw = importValue.trim();
    if (!raw) {
      setImportError("Cole o trecho de configuração do Firebase.");
      return;
    }

    const cleaned = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"))
      .join("\n");

    const extract = (key: string): string | null => {
      const quoted = cleaned.match(
        new RegExp(String.raw`${key}\s*[:=]\s*["'](.+?)["']`, "i"),
      );
      if (quoted && quoted[1]) {
        return quoted[1].trim();
      }
      const bare = cleaned.match(
        new RegExp(String.raw`${key}\s*[:=]\s*([A-Za-z0-9._:-]+)`, "i"),
      );
      return bare && bare[1] ? bare[1].trim() : null;
    };
    const parsed = {
      apiKey: extract("apiKey"),
      authDomain: extract("authDomain"),
      projectId: extract("projectId"),
      storageBucket: extract("storageBucket"),
      messagingSenderId: extract("messagingSenderId"),
      appId: extract("appId"),
      measurementId: extract("measurementId"),
    };

    const hasAny = Object.values(parsed).some((value) => value && value.length > 0);
    if (!hasAny) {
      setImportError("Não foi possível identificar os campos na configuração informada.");
      return;
    }

    assignFieldValue("webApiKey", parsed.apiKey);
    assignFieldValue("webAuthDomain", parsed.authDomain);
    assignFieldValue("webProjectId", parsed.projectId);
    assignFieldValue("webStorageBucket", parsed.storageBucket);
    assignFieldValue("webMessagingSenderId", parsed.messagingSenderId);
    assignFieldValue("webAppId", parsed.appId);
    assignFieldValue("webMeasurementId", parsed.measurementId);

    setFeedback({ type: "success", message: "Campos preenchidos a partir do snippet. Salve para aplicar." });
    setImportValue("");
    setImportError(null);
    setShowImportModal(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/admin/firebase/settings", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "danger", message: data.message ?? "Falha ao salvar as configurações." });
      } else {
        setFeedback({ type: "success", message: data.message ?? "Configurações atualizadas." });
      }
    } catch (_error) {
      setFeedback({ type: "danger", message: "Erro inesperado ao salvar." });
    }
    setIsSubmitting(false);
  };

  return (
    <Card className="mb-5">
      <Card.Header>
        <Card.Title as="h2" className="h5 mb-0">Configurações do Firebase</Card.Title>
      </Card.Header>
      <Card.Body>
        <FloatingAlert feedback={feedback} onClose={() => setFeedback(null)} />

        <Form ref={formRef} onSubmit={handleSubmit} className="d-flex flex-column gap-4">
          <Row className="gy-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Service account JSON (Admin SDK)</Form.Label>
                <Form.Control type="file" name="serviceAccount" accept="application/json" />
                <Form.Text className="text-secondary">Arquivo da conta de serviço (para envios pelo servidor).</Form.Text>
                <div className="mt-2 d-flex gap-2">
                  <Button variant="outline-secondary" size="sm" href="/api/admin/firebase/download?type=service-account">
                    Baixar service-account.json
                  </Button>
                </div>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>google-services.json (Android)</Form.Label>
                <Form.Control type="file" name="googleServices" accept="application/json" />
                <Form.Text className="text-secondary">Arquivo do app Android para push e analytics.</Form.Text>
                <div className="mt-2 d-flex gap-2">
                  <Button variant="outline-secondary" size="sm" href="/api/admin/firebase/download?type=google-services">
                    Baixar google-services.json
                  </Button>
                </div>
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex align-items-center gap-3 mt-2">
            <h5 className="mb-0">App Web</h5>
            <Button variant="outline-secondary" size="sm" onClick={openImportModal}>
              Importar snippet
            </Button>
          </div>
          <Row className="gy-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>API Key</Form.Label>
                <Form.Control name="webApiKey" defaultValue={initialSettings?.webApiKey ?? ""} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Auth Domain</Form.Label>
                <Form.Control name="webAuthDomain" defaultValue={initialSettings?.webAuthDomain ?? ""} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Project ID</Form.Label>
                <Form.Control name="webProjectId" defaultValue={initialSettings?.webProjectId ?? initialSettings?.projectId ?? ""} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Storage Bucket</Form.Label>
                <Form.Control name="webStorageBucket" defaultValue={initialSettings?.webStorageBucket ?? ""} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Messaging Sender ID</Form.Label>
                <Form.Control name="webMessagingSenderId" defaultValue={initialSettings?.webMessagingSenderId ?? ""} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>App ID</Form.Label>
                <Form.Control name="webAppId" defaultValue={initialSettings?.webAppId ?? ""} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Measurement ID</Form.Label>
                <Form.Control name="webMeasurementId" defaultValue={initialSettings?.webMeasurementId ?? ""} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>VAPID Key (Web Push)</Form.Label>
                <Form.Control name="vapidKey" defaultValue={initialSettings?.vapidKey ?? ""} />
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex justify-content-end">
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </Form>

        <Modal show={showImportModal} onHide={closeImportModal} centered>
          <Form onSubmit={handleImportSubmit}>
            <Modal.Header closeButton>
              <Modal.Title>Importar configuração do Firebase</Modal.Title>
            </Modal.Header>
            <Modal.Body className="d-flex flex-column gap-3">
              <p className="mb-0 text-secondary">
                Cole o objeto <code>firebaseConfig</code> fornecido pelo Console do Firebase. Detectaremos automaticamente os campos.
              </p>
              <Form.Control
                as="textarea"
                rows={8}
                value={importValue}
                onChange={(event) => setImportValue(event.target.value)}
                placeholder={`const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  projectId: "...",\n  ...\n};`}
              />
              <FloatingAlert
                feedback={importError ? { type: "danger", message: importError } : null}
                onClose={() => setImportError(null)}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="outline-secondary" onClick={() => setShowImportModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Preencher campos
              </Button>
            </Modal.Footer>
          </Form>
        </Modal>
      </Card.Body>
    </Card>
  );
};

export default AdminFirebaseSettingsForm;
