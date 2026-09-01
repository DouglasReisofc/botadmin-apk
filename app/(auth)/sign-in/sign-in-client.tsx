"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import {
  Alert,
  Button,
  Form,
  FormCheck,
  FormControl,
  FormLabel,
  InputGroup,
} from "react-bootstrap";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconBrandGoogleFilled,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";

import styles from "../auth.module.css";

type Brand = { logoUrl: string | null; siteName: string };

const SignInClient = ({
  brand,
  nextPath = "/dashboard/user",
}: {
  brand?: Brand;
  nextPath?: string;
}) => {
  const router = useRouter();
  const [formState, setFormState] = useState({
    identifier: "",
    password: "",
    remember: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRedirecting, startTransition] = useTransition();

  useEffect(() => {
    router.prefetch("/dashboard/admin");
    router.prefetch("/dashboard/partner");
    router.prefetch("/dashboard/user");
    router.prefetch("/forgot-password");
  }, [router]);

  const toggleShowPassword = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  const handleRememberChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const checked = event.currentTarget.checked;
      setFormState((prev) => ({ ...prev, remember: checked }));
      if (checked) localStorage.setItem("sb-login-remember", "1");
      else localStorage.removeItem("sb-login-remember");
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("sb-login-remember") === "1") {
      setFormState((prev) => ({ ...prev, remember: true }));
    }
  }, []);

  const goToForgotPassword = useCallback(() => {
    startTransition(() => {
      router.push("/forgot-password");
    });
  }, [router, startTransition]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || isRedirecting) return;
    setError(null);
    setIsSubmitting(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: formState.identifier.trim(),
          password: formState.password,
          remember: Boolean(formState.remember),
        }),
        credentials: "same-origin",
        signal: controller.signal,
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.message ?? "Não foi possível realizar o login.");
        return;
      }

      const destination = data.user.role === "admin"
        ? "/dashboard/admin"
        : data.user.partnerRole
          ? "/dashboard/partner"
          : nextPath;
      window.location.assign(destination);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          "Tempo limite no login. Verifique a conexão e tente novamente.",
        );
      } else {
        console.error("Login error", err);
        setError("Ocorreu um erro inesperado. Tente novamente.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  };

  const updateField =
    (field: "identifier" | "password") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const siteName = brand?.siteName?.trim() || "BotAdmin";

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>Bem-vindo de volta</h1>
      <p className={styles.subtitle}>
        Ainda não tem conta?
        <Link
          href={`/sign-up?next=${encodeURIComponent(nextPath)}`}
          className={styles.switchPill}
        >
          Criar conta
        </Link>
      </p>

      {error ? (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <Form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <FormLabel htmlFor="signinIdentifierInput">
            E-mail ou WhatsApp <span className="text-danger">*</span>
          </FormLabel>
          <FormControl
            type="text"
            id="signinIdentifierInput"
            autoComplete="username"
            value={formState.identifier}
            onChange={updateField("identifier")}
            placeholder="nome@seuemail.com ou +5599999999999"
            required
          />
        </div>

        <div className={styles.field}>
          <FormLabel htmlFor="formSignInPassword">Senha</FormLabel>
          <InputGroup>
            <FormControl
              type={showPassword ? "text" : "password"}
              id="formSignInPassword"
              value={formState.password}
              onChange={updateField("password")}
              placeholder="Sua senha de acesso"
              required
              autoComplete="current-password"
            />
            <Button
              variant="outline-secondary"
              onClick={toggleShowPassword}
              type="button"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              disabled={isSubmitting || isRedirecting}
              className="d-flex align-items-center"
            >
              {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </Button>
          </InputGroup>
        </div>

        <div className={styles.metaRow}>
          <FormCheck
            label="Lembrar de mim"
            type="checkbox"
            checked={formState.remember}
            onChange={handleRememberChange}
            disabled={isSubmitting}
          />
          <button
            type="button"
            className={styles.linkBtn}
            onClick={goToForgotPassword}
            disabled={isSubmitting || isRedirecting}
          >
            Esqueci minha senha
          </button>
        </div>

        <button
          type="submit"
          className={styles.submit}
          disabled={isSubmitting || isRedirecting}
        >
          {isSubmitting ? (
            <span className="d-inline-flex align-items-center gap-2 justify-content-center">
              <span
                className="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
              />
              Entrando...
            </span>
          ) : (
            "Entrar"
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
          Continuar com Google
        </Button>
      </div>

      <p className={styles.legal}>
        Ao continuar no {siteName}, você concorda com os{" "}
        <Link href="/termos" target="_blank" rel="noreferrer">
          Termos de uso
        </Link>{" "}
        e a{" "}
        <Link href="/privacidade" target="_blank" rel="noreferrer">
          Política de privacidade
        </Link>
        .
      </p>
    </div>
  );
};

export default SignInClient;
