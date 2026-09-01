"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Form,
  Modal,
} from "react-bootstrap";

type CredentialsCompletionPromptProps = {
  needsCompletion: boolean;
  initialEmail: string | null;
};

const MIN_PASSWORD_LENGTH = 6;

const CredentialsCompletionPrompt = ({
  needsCompletion,
  initialEmail,
}: CredentialsCompletionPromptProps) => {
  const router = useRouter();
  const [show, setShow] = useState(needsCompletion);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setShow(needsCompletion);
  }, [needsCompletion]);

  useEffect(() => {
    if (initialEmail && initialEmail !== email) {
      setEmail(initialEmail);
    }
  }, [initialEmail, email]);

  const isPasswordValid = useMemo(
    () => password.trim().length >= MIN_PASSWORD_LENGTH && password === confirmPassword,
    [password, confirmPassword],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setFeedback("Informe um e-mail válido.");
      return;
    }

    if (!isPasswordValid) {
      setFeedback(`Informe uma senha com pelo menos ${MIN_PASSWORD_LENGTH} caracteres e confirme-a corretamente.`);
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password: password.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback(typeof data.message === "string" ? data.message : "Não foi possível salvar seus dados.");
        setSubmitting(false);
        return;
      }

      setShow(false);
      setSubmitting(false);
      setPassword("");
      setConfirmPassword("");
      router.refresh();
    } catch (error) {
      console.error("Failed to finalize credentials", error);
      setFeedback("Não foi possível se comunicar com o servidor. Tente novamente em instantes.");
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} backdrop="static" keyboard={false} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton={false}>
          <Modal.Title>Finalize seu cadastro</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-flex flex-column gap-3">
          <p className="mb-1">
            Identificamos que sua conta ainda não possui e-mail ou senha definidos. Informe um endereço
            de e-mail válido e crie uma nova senha para continuar utilizando o painel.
          </p>
          <p className="text-secondary small mb-3">
            O e-mail será utilizado para receber notificações e recuperar o acesso quando necessário.
          </p>

          {feedback ? (
            <Alert variant="danger" onClose={() => setFeedback(null)} dismissible>
              {feedback}
            </Alert>
          ) : null}

          <Form.Group controlId="completeCredentialsEmail" className="mb-2">
            <Form.Label>E-mail</Form.Label>
            <Form.Control
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nome@gmail.com"
              disabled={submitting}
              required
            />
          </Form.Group>

          <Form.Group controlId="completeCredentialsPassword" className="mb-2">
            <Form.Label>Nova senha</Form.Label>
            <Form.Control
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
              disabled={submitting}
              required
            />
          </Form.Group>

          <Form.Group controlId="completeCredentialsPasswordConfirm">
            <Form.Label>Confirme a senha</Form.Label>
            <Form.Control
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repita a senha"
              isInvalid={confirmPassword.length > 0 && confirmPassword !== password}
              disabled={submitting}
              required
            />
            <Form.Control.Feedback type="invalid">
              As senhas não conferem.
            </Form.Control.Feedback>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button
            type="submit"
            variant="primary"
            className="w-100"
            disabled={submitting}
          >
            {submitting ? "Salvando..." : "Salvar e continuar"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default CredentialsCompletionPrompt;
