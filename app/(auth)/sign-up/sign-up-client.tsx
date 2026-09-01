"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  FormCheck,
  FormControl,
  FormLabel,
} from "react-bootstrap";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBrandGoogleFilled, IconExternalLink } from "@tabler/icons-react";

import styles from "../auth.module.css";

type SignUpFormState = {
  name: string;
  email: string;
  whatsappNumber: string;
  password: string;
  verificationCode: string;
  acceptTerms: boolean;
};

const initialFormState: SignUpFormState = {
  name: "",
  email: "",
  whatsappNumber: "",
  password: "",
  verificationCode: "",
  acceptTerms: false,
};

type Brand = { logoUrl: string | null; siteName: string };
type VerificationChallenge = {
  mode: "user_sends_code" | "send_code";
  token: string;
  code?: string;
  messageToSend?: string;
  whatsappUrl?: string;
  targetWhatsappNumber?: string;
  whatsappNumber?: string;
  instructions?: string;
  supportText?: string;
  expiresAt?: string;
};

const SignUpClient = ({
  brand,
  nextPath = "/dashboard/user",
}: {
  brand?: Brand;
  nextPath?: string;
}) => {
  const router = useRouter();
  const [formState, setFormState] = useState(initialFormState);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(
    null,
  );
  const [verificationPhone, setVerificationPhone] = useState<string | null>(
    null,
  );
  const [verificationChallenge, setVerificationChallenge] =
    useState<VerificationChallenge | null>(null);
  const [isWaitingWebhook, setIsWaitingWebhook] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref") ?? params.get("indicacao") ?? "";
    const normalized = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    setReferralCode(normalized || null);
  }, []);

  useEffect(() => {
    if (
      !verificationToken ||
      verificationChallenge?.mode !== "user_sends_code"
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled) return;
      setIsWaitingWebhook(true);
      try {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verificationToken,
            referralCode,
          }),
        });
        const data = await response.json().catch(() => ({}));

        if (cancelled) return;
        if (response.status === 202 && data.pendingVerification) {
          timer = window.setTimeout(poll, 2500);
          return;
        }
        if (!response.ok) {
          setError(
            data.message ??
              "Não foi possível confirmar automaticamente. Chame o suporte.",
          );
          setIsWaitingWebhook(false);
          return;
        }

        const destination =
          data.user?.role === "admin" ? "/dashboard/admin" : nextPath;
        router.replace(destination ?? "/dashboard/user");
        router.refresh();
      } catch (err) {
        console.error("Register verification polling error", err);
        if (!cancelled) {
          timer = window.setTimeout(poll, 3500);
        }
      }
    };

    timer = window.setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [nextPath, referralCode, router, verificationChallenge?.mode, verificationToken]);

  const updateField =
    <K extends keyof SignUpFormState>(field: K) =>
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      const value =
        field === "acceptTerms"
          ? (event.target as HTMLInputElement).checked
          : event.target.value;
      setFormState((prev) => ({ ...prev, [field]: value }));
    };

  const handleConfirmVerification = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (verificationChallenge?.mode === "user_sends_code") {
      return;
    }

    if (!verificationToken || !formState.verificationCode.trim()) {
      setError("Informe o código recebido no WhatsApp.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationToken,
          verificationCode: formState.verificationCode,
          referralCode,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível confirmar o WhatsApp.");
        setIsSubmitting(false);
        return;
      }
      const destination =
        data.user?.role === "admin" ? "/dashboard/admin" : nextPath;
      setIsSubmitting(false);
      router.replace(destination ?? "/dashboard/user");
      router.refresh();
    } catch (err) {
      console.error("Register confirmation error", err);
      setError("Ocorreu um erro inesperado. Tente novamente.");
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!formState.acceptTerms) {
      setError(
        "É necessário aceitar os termos de uso e a política de privacidade.",
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formState.name,
          email: formState.email,
          whatsappNumber: formState.whatsappNumber,
          password: formState.password,
          nextPath,
          referralCode,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível concluir o cadastro.");
        setIsSubmitting(false);
        return;
      }

      if (data.pendingVerification && data.verificationToken) {
        const challenge = (data.verification ?? {}) as Partial<VerificationChallenge>;
        const challengeMode =
          challenge.mode === "send_code" ? "send_code" : "user_sends_code";
        setVerificationToken(data.verificationToken);
        setVerificationPhone(
          data.whatsappNumber ?? challenge.whatsappNumber ?? null,
        );
        setVerificationChallenge({
          mode: challengeMode,
          token: data.verificationToken,
          code: challenge.code,
          messageToSend: challenge.messageToSend,
          whatsappUrl: challenge.whatsappUrl,
          targetWhatsappNumber: challenge.targetWhatsappNumber,
          whatsappNumber: data.whatsappNumber ?? challenge.whatsappNumber,
          instructions: challenge.instructions,
          supportText: challenge.supportText,
          expiresAt: challenge.expiresAt ?? data.expiresAt,
        });
        setNotice(challengeMode === "send_code" ? data.message ?? null : null);
        setIsSubmitting(false);
        return;
      }

      const destination =
        data.user?.role === "admin" ? "/dashboard/admin" : nextPath;
      setIsSubmitting(false);
      if (data.whatsappVerificationDeferred && data.message) {
        setNotice(data.message);
        window.setTimeout(() => {
          router.replace(destination ?? "/dashboard/user");
          router.refresh();
        }, 1800);
        return;
      }

      router.replace(destination ?? "/dashboard/user");
      router.refresh();
    } catch (err) {
      console.error("Register error", err);
      setError("Ocorreu um erro inesperado. Tente novamente.");
      setIsSubmitting(false);
    }
  };

  const siteName = brand?.siteName?.trim() || "BotAdmin";
  const userSendsCode = verificationChallenge?.mode === "user_sends_code";
  const verificationQrCodeUrl =
    userSendsCode && verificationChallenge?.whatsappUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=190x190&margin=8&data=${encodeURIComponent(
          verificationChallenge.whatsappUrl,
        )}`
      : null;

  return (
    <>
      <div className={styles.card}>
        <h1 className={styles.title}>Criar conta</h1>
        <p className={styles.subtitle}>
          Já possui acesso?
          <Link
            href={`/sign-in?next=${encodeURIComponent(nextPath)}`}
            className={styles.switchPill}
          >
            Entrar
          </Link>
        </p>

        {error && !verificationToken ? (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        ) : null}
        {notice && !verificationToken ? (
          <Alert variant="success" className="mb-3">
            {notice}
          </Alert>
        ) : null}

        <Form onSubmit={handleSubmit}>
          <div className={styles.row2}>
            <div className={styles.field}>
              <FormLabel htmlFor="signUpName">Nome completo</FormLabel>
              <FormControl
                id="signUpName"
                value={formState.name}
                onChange={updateField("name")}
                placeholder="Nome e sobrenome"
                disabled={Boolean(verificationToken)}
                required
              />
            </div>
            <div className={styles.field}>
              <FormLabel htmlFor="signUpEmail">E-mail</FormLabel>
              <FormControl
                type="email"
                id="signUpEmail"
                value={formState.email}
                onChange={updateField("email")}
                placeholder="nome@seuemail.com"
                disabled={Boolean(verificationToken)}
                required
              />
            </div>
          </div>

          <div className={styles.row2}>
            <div className={styles.field}>
              <FormLabel htmlFor="signUpWhatsapp">WhatsApp</FormLabel>
              <FormControl
                id="signUpWhatsapp"
                value={formState.whatsappNumber}
                onChange={updateField("whatsappNumber")}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                disabled={Boolean(verificationToken)}
              />
            </div>
            <div className={styles.field}>
              <FormLabel htmlFor="signUpPassword">Senha</FormLabel>
              <FormControl
                type="password"
                id="signUpPassword"
                value={formState.password}
                onChange={updateField("password")}
                placeholder="Crie uma senha forte"
                minLength={6}
                disabled={Boolean(verificationToken)}
                required
              />
            </div>
          </div>

          {!verificationToken ? (
            <FormCheck
              className="mb-3"
              id="signUpTerms"
              checked={formState.acceptTerms}
              onChange={updateField("acceptTerms")}
              label={
                <span>
                  Concordo com os{" "}
                  <Link href="/termos" target="_blank" rel="noreferrer">
                    termos de uso
                  </Link>{" "}
                  e a{" "}
                  <Link href="/privacidade" target="_blank" rel="noreferrer">
                    política de privacidade
                  </Link>
                  .
                </span>
              }
            />
          ) : null}

          <button
            type="submit"
            className={styles.submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="d-inline-flex align-items-center gap-2 justify-content-center">
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                  aria-hidden="true"
                />
                Criando conta...
              </span>
            ) : (
              "Criar conta"
            )}
          </button>
        </Form>

        <div className={styles.divider}>ou continue com</div>
        <div className={styles.socialRow}>
          <Button
            href={`/api/auth/google?next=${encodeURIComponent(nextPath)}`}
            variant="outline-secondary"
            className={styles.socialBtn}
          >
            <IconBrandGoogleFilled size={18} />
            Criar conta com Google
          </Button>
        </div>

        <p className={styles.legal}>
          Ao criar conta no {siteName}, seus dados são usados apenas para
          acesso e operação do painel.
        </p>
      </div>

      {verificationToken ? (
        <div
          className={styles.verificationOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="signupWhatsappTitle"
        >
          <Form
            className={styles.verificationDialog}
            onSubmit={handleConfirmVerification}
          >
            <div className={styles.verificationHeader}>
              <div className={styles.verificationHeaderIcon} aria-hidden="true">
                ✓
              </div>
              <div>
                <h2 id="signupWhatsappTitle">
                  Confirmar cadastro via WhatsApp
                </h2>
                <p>
                  {userSendsCode
                    ? "Vamos validar o WhatsApp que enviar a mensagem."
                    : "Digite o código recebido para liberar o painel."}
                </p>
              </div>
            </div>
            <div className={styles.verificationBody}>
              {error ? (
                <Alert variant="danger" className="mb-3">
                  {error}
                </Alert>
              ) : null}
              {notice && !userSendsCode ? (
                <Alert variant="success" className="mb-3">
                  {notice}
                </Alert>
              ) : null}
              {userSendsCode ? (
                <>
                  <div className={styles.verificationTarget}>
                    <span aria-hidden="true">wa</span>
                    <strong>
                      {verificationChallenge?.targetWhatsappNumber}
                    </strong>
                  </div>
                  <div className={styles.verificationCard}>
                    <div
                      className={styles.verificationIcon}
                      aria-hidden="true"
                    >
                      ✓
                    </div>
                    <div className={styles.verificationCode}>
                      {verificationChallenge?.code}
                    </div>
                  </div>
                  {verificationQrCodeUrl ? (
                    <div className={styles.verificationQrWrap}>
                      <img
                        src={verificationQrCodeUrl}
                        alt="QR Code para confirmar pelo WhatsApp"
                        width={190}
                        height={190}
                      />
                      <span>Escaneie com o celular</span>
                    </div>
                  ) : null}
                  {notice ? (
                    <div className={styles.verificationWaiting}>{notice}</div>
                  ) : isWaitingWebhook ? (
                    <div className={styles.verificationWaiting}>
                      Aguardando confirmação do WhatsApp...
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-muted mb-3">
                    Digite o código enviado para{" "}
                    <strong>{verificationPhone ?? "seu WhatsApp"}</strong>
                    .
                  </p>
                  <FormLabel htmlFor="signUpVerificationCode">
                    Código recebido
                  </FormLabel>
                  <FormControl
                    id="signUpVerificationCode"
                    value={formState.verificationCode}
                    onChange={(event) => {
                      const value = event.target.value
                        .replace(/\D+/g, "")
                        .slice(0, 8);
                      setFormState((prev) => ({
                        ...prev,
                        verificationCode: value,
                      }));
                    }}
                    placeholder="Digite os 6 dígitos"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                  />
                </>
              )}
            </div>
            <div className={styles.verificationFooter}>
              <Button
                variant="outline-secondary"
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setVerificationToken(null);
                  setVerificationPhone(null);
                  setVerificationChallenge(null);
                  setIsWaitingWebhook(false);
                  setNotice(null);
                  setError(null);
                  setFormState((prev) => ({ ...prev, verificationCode: "" }));
                }}
              >
                Corrigir dados
              </Button>
              {userSendsCode ? (
                <a
                  className={styles.verificationPrimaryLink}
                  href={verificationChallenge?.whatsappUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!verificationChallenge?.whatsappUrl}
                  onClick={(event) => {
                    if (!verificationChallenge?.whatsappUrl) {
                      event.preventDefault();
                    }
                  }}
                >
                  <span>Confirmar pelo WhatsApp</span>
                  <IconExternalLink size={18} stroke={2.3} aria-hidden="true" />
                </a>
              ) : (
                <Button variant="primary" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Confirmando..." : "Confirmar e entrar"}
                </Button>
              )}
            </div>
          </Form>
        </div>
      ) : null}
    </>
  );
};

export default SignUpClient;
