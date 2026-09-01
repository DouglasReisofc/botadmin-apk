"use client";

import { FormEvent, useState } from "react";
import { Alert, Form, FormControl, FormLabel } from "react-bootstrap";
import Link from "next/link";

import styles from "../auth.module.css";

type RecoveryStep = "request" | "verify" | "complete";

const ForgotPasswordClient = () => {
  const [step, setStep] = useState<RecoveryStep>("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    if (isSubmitting) return;
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.message || "Falha ao solicitar redefinição.");
        return;
      }

      setStep("verify");
      setMessage(
        data?.message ||
          "Se a conta existir, enviaremos um código para os canais cadastrados.",
      );
    } catch {
      setError("Não foi possível enviar a solicitação. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetPassword = async () => {
    if (isSubmitting) return;
    setError(null);
    setMessage(null);

    if (code.length !== 6) {
      setError("Informe o código de 6 dígitos recebido.");
      return;
    }
    if (password.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, code, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.message || "Falha ao redefinir senha.");
        return;
      }

      setStep("complete");
      setMessage(data?.message || "Senha alterada com sucesso.");
    } catch {
      setError("Não foi possível redefinir a senha. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === "request") {
      await requestCode();
    } else if (step === "verify") {
      await resetPassword();
    }
  };

  const editIdentifier = () => {
    setStep("request");
    setCode("");
    setPassword("");
    setConfirm("");
    setMessage(null);
    setError(null);
  };

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>
        {step === "complete" ? "Senha redefinida" : "Redefinir senha"}
      </h1>
      <p className={styles.subtitle}>
        {step === "request"
          ? "Informe o e-mail ou WhatsApp da conta para receber o código."
          : step === "verify"
            ? "Digite o código recebido e escolha sua nova senha."
            : "Agora você já pode entrar usando sua nova senha."}
      </p>

      {message ? <Alert variant="success">{message}</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {step === "request" ? (
        <Form onSubmit={onSubmit}>
          <div className={styles.field}>
            <FormLabel htmlFor="recoveryIdentifier">E-mail ou WhatsApp</FormLabel>
            <FormControl
              id="recoveryIdentifier"
              type="text"
              placeholder="seuemail@dominio.com ou WhatsApp"
              value={identifier}
              onChange={(event) => setIdentifier(event.currentTarget.value)}
              required
              autoComplete="username"
              autoFocus
            />
          </div>
          <button type="submit" className={styles.submit} disabled={isSubmitting}>
            {isSubmitting ? "Enviando..." : "Enviar código"}
          </button>
        </Form>
      ) : null}

      {step === "verify" ? (
        <Form onSubmit={onSubmit}>
          <div className={styles.field}>
            <FormLabel htmlFor="recoveryCode">Código recebido</FormLabel>
            <FormControl
              id="recoveryCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) =>
                setCode(event.currentTarget.value.replace(/\D+/g, "").slice(0, 6))
              }
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </div>
          <div className={styles.field}>
            <FormLabel htmlFor="recoveryPassword">Nova senha</FormLabel>
            <FormControl
              id="recoveryPassword"
              type="password"
              minLength={6}
              placeholder="Pelo menos 6 caracteres"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className={styles.field}>
            <FormLabel htmlFor="recoveryPasswordConfirm">Confirmar nova senha</FormLabel>
            <FormControl
              id="recoveryPasswordConfirm"
              type="password"
              minLength={6}
              placeholder="Repita a nova senha"
              value={confirm}
              onChange={(event) => setConfirm(event.currentTarget.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <button type="submit" className={styles.submit} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Redefinir senha"}
          </button>
          <div className={styles.recoveryActions}>
            <button
              type="button"
              className={styles.textButton}
              onClick={requestCode}
              disabled={isSubmitting}
            >
              Reenviar código
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={editIdentifier}
              disabled={isSubmitting}
            >
              Alterar e-mail ou WhatsApp
            </button>
          </div>
        </Form>
      ) : null}

      {step === "complete" ? (
        <Link href="/sign-in" className={styles.submit}>
          Ir para o login
        </Link>
      ) : (
        <p className={`${styles.legal} mt-3 mb-0`}>
          <Link href="/sign-in" className={styles.switchLink}>
            ← Voltar ao login
          </Link>
        </p>
      )}
    </div>
  );
};

export default ForgotPasswordClient;
