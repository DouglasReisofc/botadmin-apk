"use client";

import { FormEvent, useState } from "react";
import { Alert, Form, FormControl, FormLabel } from "react-bootstrap";
import Link from "next/link";

import styles from "../auth.module.css";

const ResetPasswordClient = ({ token }: { token: string }) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setMessage(null);

    if (!token) {
      setError("Token ausente.");
      return;
    }
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setIsSubmitting(true);
    try {
      const r = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data?.message || "Falha ao redefinir senha.");
      } else {
        setMessage(
          "Senha alterada com sucesso. Faça login com a nova senha.",
        );
      }
    } catch {
      setError("Erro inesperado. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Definir nova senha</h1>
      <p className={styles.subtitle}>
        Escolha uma senha forte para proteger sua conta.
      </p>

      {message ? <Alert variant="success">{message}</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Form onSubmit={onSubmit}>
        <div className={styles.field}>
          <FormLabel htmlFor="newPassword">Nova senha</FormLabel>
          <FormControl
            id="newPassword"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            placeholder="Informe a nova senha"
            autoComplete="new-password"
            required
          />
        </div>
        <div className={styles.field}>
          <FormLabel htmlFor="confirmPassword">Confirmar nova senha</FormLabel>
          <FormControl
            id="confirmPassword"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            placeholder="Repita a nova senha"
            autoComplete="new-password"
            required
          />
        </div>
        <button
          type="submit"
          className={styles.submit}
          disabled={isSubmitting || !token}
        >
          {isSubmitting ? "Salvando..." : "Salvar nova senha"}
        </button>
      </Form>

      <p className={`${styles.legal} mt-3 mb-0`}>
        <Link href="/sign-in" className={styles.switchLink}>
          Ir para o login
        </Link>
      </p>
    </div>
  );
};

export default ResetPasswordClient;
