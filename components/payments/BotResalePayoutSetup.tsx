"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Row } from "react-bootstrap";
import { useRouter } from "next/navigation";

import styles from "components/payments/BotResalePayments.module.css";
import type {
  BotResaleMercadoPagoAccountSnapshot,
  BotResalePayoutConfig,
  BotResalePayoutMode,
} from "types/payments";

const EMPTY_CONFIG: BotResalePayoutConfig = {
  mode: "automatic",
  isActive: false,
  isConfigured: false,
  hasAccessToken: false,
  pixKey: null,
  recipientFullName: null,
  mercadoPagoAccount: null,
  updatedAt: null,
};

type BotResalePayoutSetupProps = {
  initialConfig?: BotResalePayoutConfig;
};

type Feedback = { type: "success" | "danger"; message: string } | null;

const formatValidatedAt = (value: string | null | undefined): string => {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
  } catch {
    return "-";
  }
};

const BotResalePayoutSetup = ({ initialConfig }: BotResalePayoutSetupProps) => {
  const router = useRouter();
  const [config, setConfig] = useState<BotResalePayoutConfig>(initialConfig ?? EMPTY_CONFIG);
  const [loadingConfig, setLoadingConfig] = useState(!initialConfig);
  const [activeMode, setActiveMode] = useState<BotResalePayoutMode>((initialConfig ?? EMPTY_CONFIG).mode);
  const [accessToken, setAccessToken] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pixKeyConfirm, setPixKeyConfirm] = useState("");
  const [recipientFullName, setRecipientFullName] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("-");
  const [validatedAccount, setValidatedAccount] = useState<BotResaleMercadoPagoAccountSnapshot | null>(
    initialConfig?.mercadoPagoAccount ?? null,
  );
  const [showAccountOverlay, setShowAccountOverlay] = useState(false);

  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
      setValidatedAccount(initialConfig.mercadoPagoAccount ?? null);
      setLoadingConfig(false);
      return;
    }

    const loadConfig = async () => {
      setLoadingConfig(true);
      try {
        const response = await fetch("/api/user/bot-resale/payout-config", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.config) {
          const nextConfig = data.config as BotResalePayoutConfig;
          setConfig(nextConfig);
          setValidatedAccount(nextConfig.mercadoPagoAccount ?? null);
        }
      } finally {
        setLoadingConfig(false);
      }
    };

    void loadConfig();
  }, [initialConfig]);

  useEffect(() => {
    setActiveMode(config.mode);
    setAccessToken("");
    setPixKey(config.pixKey ?? "");
    setPixKeyConfirm("");
    setRecipientFullName(config.recipientFullName ?? "");
    setValidatedAccount(config.mercadoPagoAccount ?? null);
  }, [config]);

  useEffect(() => {
    if (!config.updatedAt) {
      setLastUpdatedLabel("-");
      return;
    }
    setLastUpdatedLabel(formatValidatedAt(config.updatedAt));
  }, [config.updatedAt]);

  const statusBadge = useMemo(() => {
    if (!config.isConfigured) {
      return { variant: "secondary" as const, label: "Pendente" };
    }
    return config.mode === "automatic"
      ? { variant: "success" as const, label: "Automático ativo" }
      : { variant: "primary" as const, label: "Manual ativo" };
  }, [config]);
  const isAutomaticMode = activeMode === "automatic";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    const payload = activeMode === "automatic"
      ? {
          mode: "automatic",
          accessToken: accessToken.trim(),
        }
      : {
          mode: "manual",
          pixKey: pixKey.trim(),
          pixKeyConfirm: pixKeyConfirm.trim(),
          recipientFullName: recipientFullName.trim(),
        };

    try {
      const response = await fetch("/api/user/bot-resale/payout-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível salvar as configurações.");
      }

      if (data.config) {
        setConfig(data.config as BotResalePayoutConfig);
      }

      if (activeMode === "automatic" && data.mercadoPagoAccount) {
        setValidatedAccount(data.mercadoPagoAccount as BotResaleMercadoPagoAccountSnapshot);
        setShowAccountOverlay(true);
      }

      setFeedback({
        type: "success",
        message: data.message ?? "Configurações salvas com sucesso.",
      });
      setAccessToken("");
      setPixKeyConfirm("");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bot-resale:wallet-updated"));
      }
      router.refresh();
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao salvar configurações.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const accountDisplayName = [
    validatedAccount?.nickname,
    [validatedAccount?.firstName, validatedAccount?.lastName].filter(Boolean).join(" ").trim() || null,
  ].find((entry) => entry && entry.trim()) ?? "Conta Mercado Pago";

  return (
    <>
      <Card className={`border-0 shadow-sm ${styles.compactCard}`}>
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <Card.Title as="h2" className="h5 mb-1">
                Como você recebe pelas vendas
              </Card.Title>
              <Card.Text className="text-secondary mb-0 small d-none d-md-block">
                Automático via Mercado Pago ou manual via carteira + saque Pix.
              </Card.Text>
            </div>
            <Badge bg={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>

          <div className={styles.paymentModeSwitchPanel}>
            <div className={styles.paymentModeSwitchCopy}>
              <span>Modo de recebimento</span>
              <strong>{isAutomaticMode ? "Pagamento automático" : "Pagamento manual"}</strong>
              <small>
                {isAutomaticMode
                  ? "O cliente paga via Mercado Pago e a liberação acontece automaticamente."
                  : "A plataforma recebe o Pix, registra na carteira e você solicita saque depois."}
              </small>
            </div>
            <div className={styles.paymentModeSwitchControl}>
              <span className={!isAutomaticMode ? styles.paymentModeLabelActive : ""}>Manual</span>
              <Form.Check
                type="switch"
                id="bot-resale-payout-mode-switch"
                className={styles.paymentModeSwitch}
                checked={isAutomaticMode}
                onChange={(event) => setActiveMode(event.currentTarget.checked ? "automatic" : "manual")}
                aria-label="Alternar pagamento manual ou automático"
              />
              <span className={isAutomaticMode ? styles.paymentModeLabelActive : ""}>Automático</span>
            </div>
          </div>

          {activeMode === "automatic" && validatedAccount ? (
            <div className="d-flex flex-wrap align-items-center gap-2">
              <small className="text-secondary">
                Conta: <strong>{accountDisplayName}</strong>
                {validatedAccount.email ? ` · ${validatedAccount.email}` : ""}
              </small>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={() => setShowAccountOverlay(true)}
              >
                Ver dados
              </Button>
            </div>
          ) : null}

          {feedback ? (
            <Alert variant={feedback.type} className="mb-0 py-2" onClose={() => setFeedback(null)} dismissible>
              {feedback.message}
            </Alert>
          ) : null}

          {loadingConfig ? (
            <div className="text-secondary small">Carregando...</div>
          ) : null}

          <Form onSubmit={handleSubmit}>
            {activeMode === "automatic" ? (
              <Row className="gy-3">
                <Col md={8}>
                  <Form.Group controlId="botResaleAccessToken">
                    <Form.Label>Access token do Mercado Pago</Form.Label>
                    <Form.Control
                      type="password"
                      value={accessToken}
                      onChange={(event) => setAccessToken(event.target.value)}
                      placeholder={config.hasAccessToken ? "Token salvo — deixe em branco para manter" : "APP_USR-..."}
                      required={!config.hasAccessToken}
                    />
                    <Form.Text className="text-secondary">
                      Token de produção com permissão Pix. Validamos ao salvar.
                    </Form.Text>
                  </Form.Group>
                </Col>
              </Row>
            ) : (
              <Row className="gy-3">
                <Col md={6}>
                  <Form.Group controlId="botResalePixKey">
                    <Form.Label>Chave Pix</Form.Label>
                    <Form.Control
                      value={pixKey}
                      onChange={(event) => setPixKey(event.target.value)}
                      placeholder="CPF, e-mail, telefone ou chave aleatória"
                      required
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group controlId="botResalePixKeyConfirm">
                    <Form.Label>Confirmar chave Pix</Form.Label>
                    <Form.Control
                      value={pixKeyConfirm}
                      onChange={(event) => setPixKeyConfirm(event.target.value)}
                      placeholder="Digite a chave novamente"
                      required
                    />
                  </Form.Group>
                </Col>
                <Col md={12}>
                  <Form.Group controlId="botResaleRecipientName">
                    <Form.Label>Nome completo do recebedor</Form.Label>
                    <Form.Control
                      value={recipientFullName}
                      onChange={(event) => setRecipientFullName(event.target.value)}
                      placeholder="Nome exatamente como no banco"
                      required
                    />
                  </Form.Group>
                </Col>
              </Row>
            )}

            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
              <Form.Text className="text-secondary mb-0 small">
                Atualizado: {lastUpdatedLabel}
              </Form.Text>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? "Validando..." : "Salvar"}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Modal show={showAccountOverlay} onHide={() => setShowAccountOverlay(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Conta Mercado Pago validada</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {validatedAccount ? (
            <div>
              <div className={styles.accountField}>
                <span className={styles.accountLabel}>Apelido</span>
                <span className={styles.accountValue}>{validatedAccount.nickname ?? "-"}</span>
              </div>
              <div className={styles.accountField}>
                <span className={styles.accountLabel}>E-mail</span>
                <span className={styles.accountValue}>{validatedAccount.email ?? "-"}</span>
              </div>
              <div className={styles.accountField}>
                <span className={styles.accountLabel}>Nome</span>
                <span className={styles.accountValue}>
                  {[validatedAccount.firstName, validatedAccount.lastName].filter(Boolean).join(" ") || "-"}
                </span>
              </div>
              <div className={styles.accountField}>
                <span className={styles.accountLabel}>ID da conta</span>
                <span className={styles.accountValue}>{validatedAccount.id ?? "-"}</span>
              </div>
              <div className={styles.accountField}>
                <span className={styles.accountLabel}>País / Site</span>
                <span className={styles.accountValue}>
                  {[validatedAccount.countryId, validatedAccount.siteId].filter(Boolean).join(" · ") || "-"}
                </span>
              </div>
              <div className={styles.accountField}>
                <span className={styles.accountLabel}>Validado em</span>
                <span className={styles.accountValue}>{formatValidatedAt(validatedAccount.validatedAt)}</span>
              </div>
            </div>
          ) : (
            <p className="text-secondary mb-0">Nenhum dado da conta disponível.</p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowAccountOverlay(false)}>
            Entendi
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default BotResalePayoutSetup;
