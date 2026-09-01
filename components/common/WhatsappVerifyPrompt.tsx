"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button } from "react-bootstrap";

type Props = {
  user: { id: number; name: string; whatsappNumber: string | null };
};

const LOCAL_DISMISS_KEY = "storebot.whatsappVerifyPrompt.dismissed";

const WhatsappVerifyPrompt = ({ user }: Props) => {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const firstName = useMemo(() => {
    return (user?.name || "").split(/\s+/)[0] || "Olá";
  }, [user?.name]);

  useEffect(() => {
    const alreadyDismissed = typeof window !== "undefined" && localStorage.getItem(LOCAL_DISMISS_KEY) === "1";
    if (!user?.whatsappNumber && !alreadyDismissed) {
      setIsOpen(true);
    }
  }, [user?.whatsappNumber]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_DISMISS_KEY, "1");
    } catch {}
    setIsOpen(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    setHint(null);

    try {
      const response = await fetch("/api/user/whatsapp/verification", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "Não foi possível iniciar a verificação agora.");
        setBusy(false);
        return;
      }

      const verification = data?.verification as
        | {
            whatsappUrl: string | null;
            message: string;
            hint?: string | null;
          }
        | undefined;

      if (verification?.hint) {
        setHint(String(verification.hint));
      }

      if (verification?.whatsappUrl) {
        try {
          window.open(verification.whatsappUrl, "_blank", "noopener,noreferrer");
        } catch {}
        setBusy(false);
        return;
      }

      // Fallback: copiar a mensagem para o clipboard
      if (verification?.message && navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(verification.message);
          setHint("Mensagem copiada. Cole no WhatsApp do robô administrativo.");
          setBusy(false);
          return;
        } catch {}
      }

      setBusy(false);
    } catch (err) {
      console.error("Failed to trigger WhatsApp verification", err);
      setError("Erro ao se comunicar com o servidor. Tente novamente.");
      setBusy(false);
    }
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="position-fixed"
      style={{ right: 16, bottom: 16, zIndex: 1080, maxWidth: 340 }}
      aria-live="polite"
    >
      <div className="shadow-lg rounded border bg-white p-3 d-flex flex-column gap-2">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <div className="fw-semibold">Concluir cadastro</div>
            <div className="text-secondary small">
              {firstName}, confirme seu WhatsApp pelo robô administrativo para finalizar o cadastro.
            </div>
          </div>
          <button type="button" className="btn-close" aria-label="Fechar" onClick={dismiss} />
        </div>

        {hint && (
          <Alert variant="info" className="mb-0 py-2 px-2">
            <small>{hint}</small>
          </Alert>
        )}
        {error && (
          <Alert variant="danger" className="mb-0 py-2 px-2">
            <small>{error}</small>
          </Alert>
        )}

        <div className="d-flex gap-2">
          <Button size="sm" onClick={handleConfirm} disabled={busy}>
            {busy ? "Gerando..." : "Confirmar"}
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={dismiss} disabled={busy}>
            Mais tarde
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WhatsappVerifyPrompt;

