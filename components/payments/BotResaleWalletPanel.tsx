"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Collapse, ProgressBar, Spinner } from "react-bootstrap";

import styles from "components/payments/BotResalePayments.module.css";
import { formatCurrency } from "lib/format";
import type { BotResalePaymentReadiness } from "lib/bot-resale-payments";
import type { BotResaleWalletSummary } from "lib/bot-resale-wallet";

type WalletPayload = {
  wallet: BotResaleWalletSummary;
  readiness: BotResalePaymentReadiness;
  paymentMode: "split" | "wallet";
};

const BotResaleWalletPanel = () => {
  const [payload, setPayload] = useState<WalletPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "danger"; message: string } | null>(null);

  const loadWallet = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/user/bot-resale/wallet", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível carregar a carteira.");
      }
      setPayload(data as WalletPayload);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bot-resale:wallet-updated"));
      }
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao carregar carteira.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const handleWithdraw = async () => {
    if (!payload?.wallet.canWithdraw) {
      return;
    }
    setWithdrawing(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/user/bot-resale/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível solicitar o saque.");
      }
      setFeedback({
        type: "success",
        message: data.message ?? "Saque registrado com sucesso.",
      });
      await loadWallet();
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao solicitar saque.",
      });
    } finally {
      setWithdrawing(false);
    }
  };

  const wallet = payload?.wallet;
  const readiness = payload?.readiness;
  const salesProgress = wallet
    ? Math.min(100, Math.round((wallet.approvedSalesCount / wallet.minSalesForWithdrawal) * 100))
    : 0;
  const modeLabel = payload?.readiness.payoutMode === "manual"
    ? "Manual"
    : payload?.paymentMode === "split"
      ? "Automático"
      : "Carteira";

  return (
    <Card className={`border-0 shadow-sm ${styles.compactCard}`}>
      <Card.Body className="d-flex flex-column gap-2">
        <div className="d-flex justify-content-between align-items-center gap-2">
          <div className="d-flex align-items-center gap-2 flex-wrap min-w-0">
            <Card.Title as="h2" className="h6 mb-0">
              Carteira de afiliados
            </Card.Title>
            {payload?.paymentMode ? (
              <Badge bg={payload.paymentMode === "split" ? "success" : "primary"}>{modeLabel}</Badge>
            ) : null}
          </div>
          <Button
            variant="outline-secondary"
            size="sm"
            className={styles.walletToggle}
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
          >
            {expanded ? "Ocultar" : "Detalhes"}
          </Button>
        </div>

        {loading ? (
          <div className="d-flex align-items-center gap-2 text-secondary small">
            <Spinner animation="border" size="sm" />
            Carregando...
          </div>
        ) : wallet ? (
          <div className={styles.walletStats}>
            <div className={styles.walletStat}>
              <span className={styles.walletStatLabel}>Comissões</span>
              <strong className={`${styles.walletStatValue} ${styles.walletStatValueLarge}`}>
                {formatCurrency(wallet.balance)}
              </strong>
            </div>
            <div className={styles.walletStat}>
              <span className={styles.walletStatLabel}>Site</span>
              <strong className={styles.walletStatValue}>{formatCurrency(wallet.siteBalance)}</strong>
            </div>
            <div className={styles.walletStat}>
              <span className={styles.walletStatLabel}>Concluídas</span>
              <strong className={styles.walletStatValue}>
                {wallet.approvedSalesCount}/{wallet.minSalesForWithdrawal}
              </strong>
            </div>
          </div>
        ) : (
          <Alert variant="warning" className="mb-0 py-2 small">
            Não foi possível carregar a carteira.
          </Alert>
        )}

        <Collapse in={expanded}>
          <div className={styles.walletCollapsedBody}>
            {readiness?.message ? (
              <Alert variant="info" className="mb-2 py-2 small">
                {readiness.message}
              </Alert>
            ) : null}

            {feedback ? (
              <Alert variant={feedback.type} className="mb-2 py-2 small" onClose={() => setFeedback(null)} dismissible>
                {feedback.message}
              </Alert>
            ) : null}

            {wallet ? (
              <>
                <div className="mb-2">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <small className="text-secondary">Saque liberado</small>
                    <small className="text-secondary">{salesProgress}%</small>
                  </div>
                  <ProgressBar now={salesProgress} variant={wallet.canWithdraw ? "success" : "primary"} />
                </div>

                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => void handleWithdraw()}
                    disabled={!wallet.canWithdraw || withdrawing}
                  >
                    {withdrawing ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Processando...
                      </>
                    ) : (
                      "Sacar"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => void loadWallet()}
                    disabled={loading || withdrawing}
                  >
                    Atualizar
                  </Button>
                  {!wallet.canWithdraw && wallet.withdrawBlockedReason ? (
                    <small className="text-secondary">{wallet.withdrawBlockedReason}</small>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </Collapse>
      </Card.Body>
    </Card>
  );
};

export default BotResaleWalletPanel;
