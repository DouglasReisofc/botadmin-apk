"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Form, InputGroup, Modal, Spinner } from "react-bootstrap";
import { IconCopy, IconHelpCircle, IconLoader2, IconSettings, IconSpeakerphone, IconWallet, IconX } from "@tabler/icons-react";

import styles from "components/payments/BotResalePayments.module.css";
import { formatCurrency } from "lib/format";
import BotAdminAffiliateManager from "components/payments/BotAdminAffiliateManager";
import BotResaleInstanceSalesPanel from "components/payments/BotResaleInstanceSalesPanel";
import BotResalePayoutSetup from "components/payments/BotResalePayoutSetup";
import BotResaleWalletPanel from "components/payments/BotResaleWalletPanel";

type AffiliatePayload = {
  affiliate: {
    enabled: boolean;
    referralCode: string;
    referralLink: string;
    commissionPercent: number;
    updatedAt: string | null;
  };
  wallet: {
    balance: number;
    approvedSalesCount: number;
    totalCredited: number;
    totalWithdrawn: number;
  };
  readiness?: {
    ready: boolean;
    message: string | null;
  } | null;
  instances: Array<{
    id: number;
    name: string;
    phone: string;
    serverName: string;
    licenseSalesEnabled: boolean;
  }>;
  groups?: Array<{
    id: number;
    name: string;
    instanceName?: string | null;
    instancePhone?: string | null;
    status?: string | null;
    adminsOnly?: boolean;
    locked?: boolean;
  }>;
};

type BotAdminAffiliateWalletDropdownProps = {
  triggerClassName?: string;
  triggerIconClassName?: string;
  triggerBalanceClassName?: string;
  triggerBalance?: number | null;
  triggerIconSize?: number;
  triggerLoading?: boolean;
  showTriggerBalance?: boolean;
  triggerTitle?: string;
};

const BotAdminAffiliateWalletDropdown = ({
  triggerClassName,
  triggerIconClassName,
  triggerBalanceClassName,
  triggerBalance,
  triggerIconSize = 20,
  triggerLoading = false,
  showTriggerBalance = false,
  triggerTitle = "Abrir canvas da carteira",
}: BotAdminAffiliateWalletDropdownProps = {}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [payload, setPayload] = useState<AffiliatePayload | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [activeModal, setActiveModal] = useState<"affiliate" | "withdraw" | "settings" | null>(null);

  const loadAffiliate = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setLoading(true);
      setFeedback(null);
    }
    try {
      const response = await fetch("/api/user/bot-resale/affiliate", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível carregar a carteira.");
      }
      setPayload(data as AffiliatePayload);
    } catch (error) {
      if (!options.silent) {
        setFeedback(error instanceof Error ? error.message : "Erro ao carregar carteira.");
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadAffiliate();
  }, [loadAffiliate]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current && !panelRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleWalletUpdated = () => {
      void loadAffiliate({ silent: true });
    };
    const refreshTimer = window.setInterval(() => {
      void loadAffiliate({ silent: true });
    }, 10_000);

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("focus", handleWalletUpdated);
    window.addEventListener("bot-resale:wallet-updated", handleWalletUpdated);
    window.addEventListener("bot-admin-affiliate:updated", handleWalletUpdated);
    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("focus", handleWalletUpdated);
      window.removeEventListener("bot-resale:wallet-updated", handleWalletUpdated);
      window.removeEventListener("bot-admin-affiliate:updated", handleWalletUpdated);
    };
  }, [loadAffiliate, open]);

  const handleCopy = async () => {
    if (!payload?.affiliate.referralLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payload.affiliate.referralLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFeedback("Não foi possível copiar automaticamente. Selecione o link e copie manualmente.");
    }
  };

  const affiliate = payload?.affiliate;
  const wallet = payload?.wallet;
  const triggerBalanceValue = typeof triggerBalance === "number" ? triggerBalance : wallet?.balance ?? 0;
  const hasWalletActivity = Boolean(
    (wallet?.balance ?? 0) > 0 ||
    (wallet?.approvedSalesCount ?? 0) > 0 ||
    (wallet?.totalCredited ?? 0) > 0,
  );

  return (
    <>
      <div className={styles.affiliateWalletCanvasAnchor} ref={panelRef}>
        <button
          type="button"
          className={triggerClassName ?? "btn btn-ghost btn-icon rounded-circle position-relative"}
          onClick={() => {
            setOpen((current) => !current);
            void loadAffiliate();
          }}
          aria-expanded={open}
          aria-label={
            showTriggerBalance
              ? `Abrir canvas da carteira: ${formatCurrency(triggerBalanceValue)}`
              : "Abrir canvas da carteira"
          }
          title={triggerTitle}
        >
          {triggerLoading ? (
            <IconLoader2 size={triggerIconSize} className={triggerIconClassName} />
          ) : (
            <IconWallet size={triggerIconSize} className={triggerIconClassName} />
          )}
          {showTriggerBalance ? (
            <span className={triggerBalanceClassName}>{formatCurrency(triggerBalanceValue)}</span>
          ) : null}
          {!showTriggerBalance && hasWalletActivity ? (
            <span className={styles.walletStatusDot} aria-hidden="true" />
          ) : null}
        </button>

        {open ? <button type="button" className={styles.affiliateCanvasBackdrop} aria-label="Fechar carteira" onClick={() => setOpen(false)} /> : null}

        <div className={`${styles.affiliateCanvasPanel} ${open ? styles.affiliateCanvasPanelOpen : ""}`}>
          <div className={styles.affiliateDropdownHeader}>
            <div>
              <strong>Carteira BotAdmin</strong>
              <small>Saldo, comissões e saques</small>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg={hasWalletActivity ? "success" : "secondary"}>
                {hasWalletActivity ? "Com saldo" : "Zerada"}
              </Badge>
              <button type="button" className={styles.affiliateCanvasClose} onClick={() => setOpen(false)} aria-label="Fechar carteira">
                <IconX size={18} />
              </button>
            </div>
          </div>

          <div className={styles.affiliateDropdownBody}>
            {feedback ? (
              <Alert variant="warning" className="py-2 mb-2 small">
                {feedback}
              </Alert>
            ) : null}

            {loading && !payload ? (
              <div className="d-flex align-items-center gap-2 text-secondary small py-3">
                <Spinner animation="border" size="sm" />
                Carregando carteira...
              </div>
            ) : null}

            {payload ? (
              <>
                <div className={styles.affiliateQuickStats}>
                  <div>
                    <span>Saldo</span>
                    <strong>{formatCurrency(wallet?.balance ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Vendas</span>
                    <strong>{wallet?.approvedSalesCount ?? 0}</strong>
                  </div>
                  <div>
                    <span>Sacado</span>
                    <strong>{formatCurrency(wallet?.totalWithdrawn ?? 0)}</strong>
                  </div>
                </div>

                <div>
                  <label className="form-label small text-secondary mb-1" htmlFor="header-affiliate-link">
                    Link fixo de indicação
                  </label>
                  <InputGroup size="sm">
                    <Form.Control
                      id="header-affiliate-link"
                      value={affiliate?.referralLink ?? ""}
                      readOnly
                      className={styles.affiliateLinkInput}
                    />
                    <Button variant={copied ? "success" : "outline-secondary"} onClick={() => void handleCopy()}>
                      <IconCopy size={16} />
                    </Button>
                  </InputGroup>
                  {copied ? <small className="text-success">Link copiado.</small> : null}
                  <small className="d-block text-secondary mt-1">
                    Ativação, grupos e divulgação automática ficam em Afiliados.
                  </small>
                </div>

                {payload.readiness?.message ? (
                  <Alert variant="info" className="py-2 mb-0 small">
                    {payload.readiness.message}
                  </Alert>
                ) : null}

                <div className="d-flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => setActiveModal("affiliate")}>
                    <IconSpeakerphone size={16} className="me-1" />
                    Divulgação automática
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => setActiveModal("withdraw")}>
                    Saques
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => setActiveModal("settings")}>
                    <IconSettings size={16} className="me-1" />
                    Configurações
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => setShowHelp(true)}>
                    <IconHelpCircle size={16} className="me-1" />
                    Explicação
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <Modal show={showHelp} onHide={() => setShowHelp(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Para que serve o Bot Admin afiliados?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            Esta janela mostra saldo, comissões e o link de indicação para copiar rapidamente.
          </p>
          <p className="mb-0 text-secondary">
            Use Divulgação automática para ativar o modo afiliado, escolher grupos, editar mensagem, mídias e agenda.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowHelp(false)}>
            Entendi
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={activeModal === "affiliate"}
        onHide={() => setActiveModal(null)}
        centered
        size="xl"
        dialogClassName={styles.affiliateSettingsModal}
      >
        <Modal.Header closeButton>
          <Modal.Title>Bot Admin afiliados</Modal.Title>
        </Modal.Header>
        <Modal.Body className={styles.affiliateSettingsModalBody}>
          <BotAdminAffiliateManager
            groups={payload?.groups ?? []}
            showAutoShare
            brandName="Bot Admin"
          />
        </Modal.Body>
      </Modal>

      <Modal
        show={activeModal === "withdraw"}
        onHide={() => setActiveModal(null)}
        centered
        size="lg"
        dialogClassName={styles.affiliateSettingsModal}
      >
        <Modal.Header closeButton>
          <Modal.Title>Carteira e saques</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <BotResaleWalletPanel />
        </Modal.Body>
      </Modal>

      <Modal
        show={activeModal === "settings"}
        onHide={() => setActiveModal(null)}
        centered
        size="xl"
        dialogClassName={styles.affiliateSettingsModal}
      >
        <Modal.Header closeButton>
          <Modal.Title>Configurações de recebimento</Modal.Title>
        </Modal.Header>
        <Modal.Body className={styles.affiliateSettingsModalBody}>
          <BotResalePayoutSetup />
          <BotResaleInstanceSalesPanel instances={payload?.instances ?? []} />
        </Modal.Body>
      </Modal>
    </>
  );
};

export default BotAdminAffiliateWalletDropdown;
