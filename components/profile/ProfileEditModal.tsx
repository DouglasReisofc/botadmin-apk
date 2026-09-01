"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import NextImage from "next/image";
import { useRouter } from "next/navigation";

import type { SessionUser } from "types/auth";
import { PHONE_COUNTRIES, inferDefaultTimezoneFromDialCode } from "data/phone-countries";
import { HORAPG_DEFAULT_TIMEZONE } from "resources/horapg";
import { listTimezoneSuggestions, normalizeTimezoneInput } from "lib/timezones";

const TIMEZONE_SUGGESTIONS = listTimezoneSuggestions();

interface ProfileEditModalProps {
  show: boolean;
  onHide: () => void;
  user: SessionUser;
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type FormState = {
  name: string;
  email: string;
  password: string;
  whatsappDialCode: string;
  whatsappNumber: string;
  timezone: string;
};

const initialState: FormState = {
  name: "",
  email: "",
  password: "",
  whatsappDialCode: PHONE_COUNTRIES[0].dialCode,
  whatsappNumber: "",
  timezone: HORAPG_DEFAULT_TIMEZONE,
};

const parseWhatsapp = (value: string | null): { dialCode: string; number: string } => {
  if (!value) {
    return {
      dialCode: PHONE_COUNTRIES[0].dialCode,
      number: "",
    };
  }

  const trimmed = value.trim();
  const matchedCountry = [...PHONE_COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((country) => trimmed.startsWith(country.dialCode));

  if (matchedCountry) {
    const rest = trimmed.slice(matchedCountry.dialCode.length).replace(/[^0-9]/g, "");
    return {
      dialCode: matchedCountry.dialCode,
      number: rest,
    };
  }

  const digits = trimmed.replace(/[^0-9]/g, "");
  return {
    dialCode: PHONE_COUNTRIES[0].dialCode,
    number: digits,
  };
};

const ProfileEditModal = ({ show, onHide, user }: ProfileEditModalProps) => {
  const router = useRouter();
  const [formState, setFormState] = useState<FormState>(initialState);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyHint, setVerifyHint] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!show) {
      return;
    }

    const parsedWhatsapp = parseWhatsapp(user.whatsappNumber ?? null);
    const inferredTimezone = normalizeTimezoneInput(user.timezone ?? null)
      ?? inferDefaultTimezoneFromDialCode(parsedWhatsapp.dialCode)
      ?? HORAPG_DEFAULT_TIMEZONE;
    setFormState({
      name: user.name,
      email: user.email ?? "",
      password: "",
      whatsappDialCode: parsedWhatsapp.dialCode,
      whatsappNumber: parsedWhatsapp.number,
      timezone: inferredTimezone,
    });
    setFeedback(null);
    setAvatarFile(null);
    setRemoveAvatar(false);
    setAvatarPreview(user.avatarUrl ?? "/images/avatar/avatar-fallback.jpg");
  }, [show, user]);

  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  // Edição direta desabilitada; confirmação via WhatsApp

  // Mantido para compatibilidade futura caso reabilitemos edição direta do WhatsApp

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    onHide();
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setFeedback({ type: "danger", message: "Selecione um arquivo de imagem válido." });
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFeedback({ type: "danger", message: "O avatar deve ter no máximo 5 MB." });
      return;
    }

    if (avatarPreview && avatarPreview.startsWith("blob:")) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setRemoveAvatar(false);
    event.target.value = "";
  };

  const handleRemoveAvatar = () => {
    if (avatarPreview && avatarPreview.startsWith("blob:")) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarFile(null);
    setAvatarPreview("/images/avatar/avatar-fallback.jpg");
    setRemoveAvatar(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleConfirmWhatsapp = async () => {
    setVerifyBusy(true);
    setVerifyHint(null);
    setVerifyError(null);

    try {
      const response = await fetch("/api/user/whatsapp/verification", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setVerifyError(data.message ?? "Não foi possível iniciar a verificação agora.");
        setVerifyBusy(false);
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
        setVerifyHint(String(verification.hint));
      }

      if (verification?.whatsappUrl) {
        try {
          window.open(verification.whatsappUrl, "_blank", "noopener,noreferrer");
        } catch {}
        setVerifyBusy(false);
        return;
      }

      if (verification?.message && navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(verification.message);
          setVerifyHint("Mensagem copiada. Cole no WhatsApp do robô administrativo.");
          setVerifyBusy(false);
          return;
        } catch {}
      }

      setVerifyBusy(false);
    } catch (err) {
      console.error("Failed to trigger WhatsApp verification", err);
      setVerifyError("Erro ao se comunicar com o servidor. Tente novamente.");
      setVerifyBusy(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (!formState.name.trim()) {
      setFeedback({ type: "danger", message: "Informe seu nome." });
      return;
    }

    if (!formState.email.trim()) {
      setFeedback({ type: "danger", message: "Informe seu e-mail." });
      return;
    }

    // WhatsApp agora é confirmado via robô; edição direta desativada.

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("name", formState.name.trim());
      formData.append("email", formState.email.trim());

      if (formState.password.trim()) {
        formData.append("password", formState.password.trim());
      }

      if (avatarFile) {
        formData.append("avatar", avatarFile);
      }

      if (removeAvatar && !avatarFile) {
        formData.append("removeAvatar", "true");
      }

      formData.append("timezone", formState.timezone.trim());

      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({
          type: "danger",
          message: data.message ?? "Não foi possível atualizar o perfil.",
        });
        setIsSubmitting(false);
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Perfil atualizado com sucesso." });
      if (data.user && typeof data.user === "object") {
        const nextAvatar = typeof data.user.avatarUrl === "string"
          ? data.user.avatarUrl
          : "/images/avatar/avatar-fallback.jpg";
        if (avatarPreview && avatarPreview.startsWith("blob:")) {
          URL.revokeObjectURL(avatarPreview);
        }
        setAvatarPreview(nextAvatar);
        setAvatarFile(null);
        setRemoveAvatar(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        if (typeof data.user.timezone === "string") {
          setFormState((prev) => ({ ...prev, timezone: data.user.timezone ?? prev.timezone }));
        }
      }
      router.refresh();
      setTimeout(() => {
        setIsSubmitting(false);
        onHide();
      }, 600);
    } catch (error) {
      console.error("Failed to update profile", error);
      setFeedback({
        type: "danger",
        message: "Não foi possível se comunicar com o servidor.",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton={!isSubmitting}>
        <Modal.Title>Editar perfil</Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          {feedback && (
            <Alert
              variant={feedback.type}
              onClose={() => setFeedback(null)}
              dismissible
            >
              {feedback.message}
            </Alert>
          )}
          <div className="d-flex justify-content-center mb-4">
            <div className="d-flex flex-column align-items-center gap-3">
              <NextImage
                src={avatarPreview ?? "/images/avatar/avatar-fallback.jpg"}
                alt={formState.name || user.name}
                width={96}
                height={96}
                className="rounded-circle border"
                style={{ width: "96px", height: "96px", objectFit: "cover" }}
                unoptimized
              />
              <div className="d-flex gap-2">
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                >
                  Alterar avatar
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handleRemoveAvatar}
                  disabled={isSubmitting}
                >
                  Remover
                </Button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="d-none"
              onChange={handleAvatarChange}
            />
          </div>
          <Form.Group className="mb-3" controlId="profileName">
            <Form.Label>Nome</Form.Label>
            <Form.Control
              type="text"
              value={formState.name}
              onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Seu nome completo"
              required
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="profileEmail">
            <Form.Label>E-mail</Form.Label>
            <Form.Control
              type="email"
              value={formState.email}
              onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="nome@gmail.com"
              required
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="profileWhatsapp">
            <Form.Label>WhatsApp</Form.Label>
            {user.whatsappNumber ? (
              <Alert variant="light" className="border">
                WhatsApp confirmado: <strong>{user.whatsappNumber}</strong>.
                <br />
                Use o menu <strong>Painel WhatsApp</strong> para atualizar ou remover o número vinculado.
              </Alert>
            ) : (
              <div className="d-flex flex-column gap-2">
                <Alert variant="warning" className="border mb-0">
                  Confirme seu número pelo robô administrativo. Você pode usar o botão abaixo para iniciar a
                  verificação imediatamente.
                </Alert>
                {verifyHint && (
                  <Alert variant="info" className="mb-0">
                    {verifyHint}
                  </Alert>
                )}
                {verifyError && (
                  <Alert variant="danger" className="mb-0">
                    {verifyError}
                  </Alert>
                )}
                <div className="d-flex gap-2">
                  <Button variant="primary" size="sm" onClick={handleConfirmWhatsapp} disabled={verifyBusy}>
                    {verifyBusy ? "Gerando..." : "Confirmar pelo WhatsApp"}
                  </Button>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    href="/dashboard/user/painel-whatsapp"
                  >
                    Abrir Painel WhatsApp
                  </Button>
                </div>
              </div>
            )}
          </Form.Group>
          <Form.Group className="mb-3" controlId="profileTimezone">
            <Form.Label>Fuso horário</Form.Label>
            <Form.Control
              type="text"
              value={formState.timezone}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, timezone: event.target.value }))
              }
              placeholder="Ex.: America/Sao_Paulo"
              list="timezone-suggestions"
            />
            <Form.Text className="text-secondary">
              Utilize o formato oficial (IANA). Se deixar em branco, aplicaremos o fuso recomendado
              para o seu DDI.
            </Form.Text>
            <datalist id="timezone-suggestions">
              {TIMEZONE_SUGGESTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </datalist>
          </Form.Group>
          <Form.Group controlId="profilePassword" className="mb-0">
            <Form.Label>Senha</Form.Label>
            <Form.Control
              type="password"
              autoComplete="new-password"
              value={formState.password}
              onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="Deixe em branco para manter a atual"
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <span className="d-inline-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" />
                Salvando...
              </span>
            ) : (
              "Salvar alterações"
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default ProfileEditModal;
