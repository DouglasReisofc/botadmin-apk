"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader } from "react-bootstrap";

interface VerificationPayload {
  code: string;
  expiresAt: string;
  message: string;
  whatsappUrl: string | null;
  whatsappNumber: string | null;
}

interface UserWhatsappPanelProps {
  adminNumber: string | null;
  userWhatsapp: string | null;
}

const formatWhatsapp = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
};

const buildWhatsappLink = (number: string | null, message?: string) => {
  const digits = (number ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
};

const UserWhatsappPanel = ({ adminNumber, userWhatsapp }: UserWhatsappPanelProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationPayload | null>(null);
  const [autoRequested, setAutoRequested] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/user/whatsapp/verification", { method: "POST" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message ?? "Não foi possível gerar o código de verificação.");
        setIsLoading(false);
        return;
      }

      const payload = data.verification as VerificationPayload | undefined;
      if (!payload) {
        setError("Resposta inesperada da API. Tente novamente.");
        setIsLoading(false);
        return;
      }

      setVerification(payload);
      setFeedback("Mensagem gerada. Envie-a para o bot administrativo pelo WhatsApp.");
    } catch (requestError) {
      console.error("Failed to generate WhatsApp verification", requestError);
      setError("Não foi possível gerar o código. Tente novamente em instantes.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!verification?.message) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(verification.message);
        setError(null);
        setFeedback("Mensagem copiada para a área de transferência.");
        return;
      }
    } catch {
      /* fallback handled below */
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = verification.message;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setError(null);
      setFeedback("Mensagem copiada para a área de transferência.");
    } catch {
      setError("Não foi possível copiar automaticamente. Copie manualmente a mensagem.");
    }
  };

  const adminFormatted = formatWhatsapp(adminNumber);
  const userFormatted = formatWhatsapp(userWhatsapp);
  const defaultLink = buildWhatsappLink(adminNumber);
  const actionLink = userFormatted
    ? defaultLink
    : verification?.whatsappUrl ?? defaultLink;

  useEffect(() => {
    if (!userFormatted && adminFormatted && !autoRequested) {
      setAutoRequested(true);
      void handleGenerate();
    }
  }, [userFormatted, adminFormatted, autoRequested]);

  return (
    <Card>
      <CardHeader>
        <h2 className="h5 mb-0">Painel WhatsApp</h2>
      </CardHeader>
      <CardBody className="d-flex flex-column gap-3">
        {userFormatted ? (
          <Alert variant="success" className="mb-0">
            Seu WhatsApp confirmado: <strong>{userFormatted}</strong>.
          </Alert>
        ) : (
          <Alert variant="warning" className="mb-0">
            Você ainda não confirmou seu número. Gere a mensagem de ativação e envie ao bot administrativo
            para concluir o processo assim que estiver com o WhatsApp em mãos.
          </Alert>
        )}

        {adminFormatted ? (
          <div className="d-flex flex-wrap gap-2">
            <Button
              as="a"
              variant="success"
              href={actionLink ?? "#"}
              target={actionLink ? "_blank" : undefined}
              rel={actionLink ? "noreferrer" : undefined}
              disabled={!actionLink}
            >
              Abrir bot administrativo
            </Button>
            <Button
              variant="outline-primary"
              disabled={isLoading}
              onClick={handleGenerate}
            >
              {isLoading ? "Gerando código..." : "Gerar mensagem de confirmação"}
            </Button>
          </div>
        ) : (
          <Alert variant="warning" className="mb-0">
            Não conseguimos verificar seu número agora, mas você pode verificar depois dentro do painel.
          </Alert>
        )}

        {feedback && <Alert variant="info" className="mb-0">{feedback}</Alert>}
        {error && <Alert variant="danger" className="mb-0">{error}</Alert>}

        {verification && (
          <div className="rounded border bg-light-subtle p-3 d-flex flex-column gap-2">
            <div className="fw-semibold">Mensagem para enviar</div>
            <div className="text-secondary small">
              Número do bot: <strong>{verification.whatsappNumber ?? adminFormatted ?? "não configurado"}</strong>
            </div>
            <div className="bg-white rounded border p-3">
              <code className="text-break">{verification.message}</code>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <Button variant="outline-secondary" onClick={handleCopy}>
                Copiar mensagem
              </Button>
              {verification.whatsappUrl && (
                <Button as="a" variant="success" href={verification.whatsappUrl} target="_blank" rel="noreferrer">
                  Abrir WhatsApp
                </Button>
              )}
            </div>
            <div className="text-secondary small mb-0">
              Código válido até {new Date(verification.expiresAt).toLocaleString("pt-BR")}.
              O número que enviar a mensagem será vinculado automaticamente.
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export default UserWhatsappPanel;
