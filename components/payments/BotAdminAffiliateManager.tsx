"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Modal, Row, Spinner } from "react-bootstrap";
import {
  IconCopy,
  IconDeviceFloppy,
  IconFile,
  IconHelpCircle,
  IconMusic,
  IconPhoto,
  IconRefresh,
  IconSpeakerphone,
  IconTrash,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";

import styles from "components/payments/BotResalePayments.module.css";
import { formatCurrency, formatDateTime } from "lib/format";

type AffiliatePayload = {
  affiliate: {
    enabled: boolean;
    referralCode: string;
    referralLink: string;
    commissionPercent: number;
    updatedAt: string | null;
    autoShare: BotAdminAffiliateAutoShareConfig;
  };
  wallet: {
    balance: number;
    siteBalance: number;
    approvedSalesCount: number;
    minSalesForWithdrawal: number;
    totalCredited: number;
    totalWithdrawn: number;
  };
  readiness?: {
    ready: boolean;
    message: string | null;
  } | null;
  paymentMode: "split" | "wallet";
  history: Array<{
    id: number;
    type: "commission" | "withdrawal" | "other";
    amount: number;
    status: string;
    planPaymentId: string | null;
    description: string;
    createdAt: string;
  }>;
  groups?: BotAdminAffiliateGroupOption[];
};

const statusLabel = (enabled: boolean) => enabled ? "Afiliados ativo" : "Afiliados inativo";

type BotAdminAffiliateAutoShareConfig = {
  enabled: boolean;
  groupIds: number[];
  mode: "interval" | "scheduled";
  intervalHours: number;
  times: string[];
  groupSchedules: BotAdminAffiliateAutoShareGroupSchedule[];
  messageText: string;
  ctaText: string;
  mediaItems: BotAdminAffiliateAutoShareMediaItem[];
  updatedAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

type BotAdminAffiliateAutoShareGroupSchedule = {
  groupId: number;
  times: string[];
  offsetMinutes: number;
};

type BotAdminAffiliateAutoShareMediaItem = {
  id: string;
  path: string;
  url: string;
  mediaType: "image" | "video" | "audio" | "document";
  mimeType: string | null;
  fileName: string | null;
  createdAt: string;
};

type BotAdminAffiliateGroupOption = {
  id: number;
  name: string;
  instanceName?: string | null;
  instancePhone?: string | null;
  status?: string | null;
  adminsOnly?: boolean;
  locked?: boolean;
};

type AutoShareDraft = {
  enabled: boolean;
  groupIds: number[];
  mode: "interval" | "scheduled";
  intervalHours: string;
  scheduledTimes: string;
  messageText: string;
  ctaText: string;
  mediaItems: BotAdminAffiliateAutoShareMediaItem[];
};

type BotAdminAffiliateManagerProps = {
  groups?: BotAdminAffiliateGroupOption[];
  showAutoShare?: boolean;
  logoUrl?: string | null;
  brandName?: string;
};

const buildAutoShareDraft = (autoShare: BotAdminAffiliateAutoShareConfig | null | undefined): AutoShareDraft => ({
  enabled: Boolean(autoShare?.enabled),
  groupIds: Array.isArray(autoShare?.groupIds) ? autoShare.groupIds : [],
  mode: autoShare?.mode === "scheduled" ? "scheduled" : "interval",
  intervalHours: String(autoShare?.intervalHours ?? 24),
  scheduledTimes: (Array.isArray(autoShare?.times) && autoShare.times.length > 0 ? autoShare.times : ["09:30"]).join(", "),
  messageText: autoShare?.messageText ?? "",
  ctaText: autoShare?.ctaText ?? "Conhecer BotAdmin",
  mediaItems: Array.isArray(autoShare?.mediaItems) ? autoShare.mediaItems : [],
});

const normalizeTimeEntry = (value: string): string | null => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const parseScheduledTimesInput = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/[,\s;]+/)
        .map((entry) => normalizeTimeEntry(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ).slice(0, 8);

const shiftTimeByMinutes = (time: string, offsetMinutes: number): string => {
  const normalized = normalizeTimeEntry(time) ?? "09:30";
  const [hour, minute] = normalized.split(":").map((entry) => Number.parseInt(entry, 10));
  const total = (((hour * 60 + minute + offsetMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const buildGroupSchedulePreview = (
  groupIds: number[],
  times: string[],
): BotAdminAffiliateAutoShareGroupSchedule[] =>
  groupIds.map((groupId, index) => {
    const offsetMinutes = (index * 7) % 60;
    return {
      groupId,
      offsetMinutes,
      times: times.map((time) => shiftTimeByMinutes(time, offsetMinutes)),
    };
  });

const mediaIconByType = {
  image: IconPhoto,
  video: IconVideo,
  audio: IconMusic,
  document: IconFile,
};

const mediaLabelByType = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
};

const BotAdminAffiliateManager = ({
  groups = [],
  showAutoShare = false,
  logoUrl = null,
  brandName = "Bot Admin",
}: BotAdminAffiliateManagerProps) => {
  const [payload, setPayload] = useState<AffiliatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAutoShare, setSavingAutoShare] = useState(false);
  const [uploadingAutoShareMedia, setUploadingAutoShareMedia] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [autoShareDraft, setAutoShareDraft] = useState<AutoShareDraft>(() => buildAutoShareDraft(null));
  const [feedback, setFeedback] = useState<{ type: "success" | "danger"; message: string } | null>(null);

  const loadAffiliate = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/user/bot-resale/affiliate", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível carregar o Bot Admin afiliados.");
      }
      setPayload(data as AffiliatePayload);
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao carregar afiliados.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAffiliate();

    const handleExternalUpdate = () => void loadAffiliate();
    window.addEventListener("bot-admin-affiliate:updated", handleExternalUpdate);
    return () => window.removeEventListener("bot-admin-affiliate:updated", handleExternalUpdate);
  }, [loadAffiliate]);

  useEffect(() => {
    if (payload?.affiliate.autoShare) {
      setAutoShareDraft(buildAutoShareDraft(payload.affiliate.autoShare));
    }
  }, [payload?.affiliate.autoShare]);

  const handleToggleAffiliate = async (enabled: boolean) => {
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/user/bot-resale/affiliate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível atualizar o Bot Admin afiliados.");
      }
      setPayload(data as AffiliatePayload);
      setFeedback({
        type: "success",
        message: enabled ? "Bot Admin afiliados ativado." : "Bot Admin afiliados desativado.",
      });
      window.dispatchEvent(new CustomEvent("bot-admin-affiliate:updated"));
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao atualizar afiliados.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!payload?.affiliate.referralLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payload.affiliate.referralLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFeedback({
        type: "danger",
        message: "Não foi possível copiar automaticamente. Selecione o link e copie manualmente.",
      });
    }
  };

  const toggleAutoShareGroup = (groupId: number) => {
    setAutoShareDraft((current) => {
      const next = new Set(current.groupIds);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return { ...current, groupIds: Array.from(next) };
    });
  };

  const handleAutoShareMediaUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) {
      return;
    }
    setUploadingAutoShareMedia(true);
    setFeedback(null);
    try {
      const uploaded: BotAdminAffiliateAutoShareMediaItem[] = [];
      for (const file of files.slice(0, Math.max(0, 20 - autoShareDraft.mediaItems.length))) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/user/bot-resale/affiliate/media", {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.message ?? "Não foi possível enviar uma das mídias.");
        }
        if (data.media) {
          uploaded.push(data.media as BotAdminAffiliateAutoShareMediaItem);
        }
      }
      if (uploaded.length > 0) {
        setAutoShareDraft((current) => ({
          ...current,
          mediaItems: [...current.mediaItems, ...uploaded].slice(0, 20),
        }));
        setFeedback({
          type: "success",
          message: `${uploaded.length} mídia(s) adicionada(s). Salve a divulgação para ativar a randomização.`,
        });
      }
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao enviar mídia.",
      });
    } finally {
      setUploadingAutoShareMedia(false);
    }
  };

  const removeAutoShareMedia = (mediaItem: BotAdminAffiliateAutoShareMediaItem) => {
    setAutoShareDraft((current) => ({
      ...current,
      mediaItems: current.mediaItems.filter((item) => item.id !== mediaItem.id),
    }));
  };

  const handleSaveAutoShare = async () => {
    setSavingAutoShare(true);
    setFeedback(null);
    try {
      const intervalHours = Math.max(1, Math.min(168, Math.floor(Number(autoShareDraft.intervalHours) || 24)));
      const allowedGroupIds = autoShareDraft.groupIds.filter((groupId) =>
        groups.some((group) => group.id === groupId && (group.status == null || group.status === "active") && !group.adminsOnly),
      );
      const mode = autoShareDraft.mode;
      const scheduledTimes = parseScheduledTimesInput(autoShareDraft.scheduledTimes);
      if (autoShareDraft.enabled && allowedGroupIds.length === 0) {
        throw new Error("Selecione ao menos um grupo aberto para ativar a divulgação automática.");
      }
      if (autoShareDraft.enabled && mode === "scheduled" && scheduledTimes.length === 0) {
        throw new Error("Informe ao menos um horário válido, como 09:30 ou 18:45.");
      }
      const groupSchedules = buildGroupSchedulePreview(allowedGroupIds, scheduledTimes.length > 0 ? scheduledTimes : ["09:30"]);
      const response = await fetch("/api/user/bot-resale/affiliate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoShare: {
            enabled: autoShareDraft.enabled,
            groupIds: allowedGroupIds,
            mode,
            intervalHours,
            times: scheduledTimes.length > 0 ? scheduledTimes : ["09:30"],
            groupSchedules,
            messageText: autoShareDraft.messageText,
            ctaText: autoShareDraft.ctaText,
            mediaItems: autoShareDraft.mediaItems,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message ?? "Não foi possível salvar a divulgação automática.");
      }
      setPayload(data as AffiliatePayload);
      setAutoShareDraft((current) => ({
        ...current,
        groupIds: allowedGroupIds,
        intervalHours: String(intervalHours),
        scheduledTimes: (scheduledTimes.length > 0 ? scheduledTimes : ["09:30"]).join(", "),
      }));
      setFeedback({ type: "success", message: "Divulgação automática do Bot Admin afiliados salva." });
      window.dispatchEvent(new CustomEvent("bot-admin-affiliate:updated"));
    } catch (error) {
      setFeedback({
        type: "danger",
        message: error instanceof Error ? error.message : "Erro ao salvar divulgação automática.",
      });
    } finally {
      setSavingAutoShare(false);
    }
  };

  const history = payload?.history ?? [];
  const affiliate = payload?.affiliate;
  const wallet = payload?.wallet;
  const availableGroups = groups.length > 0 ? groups : payload?.groups ?? [];
  const modeLabel = payload?.paymentMode === "split" ? "Split Mercado Pago" : "Carteira";
  const openGroups = useMemo(
    () =>
      availableGroups
        .filter((group) => (group.status == null || group.status === "active") && !group.adminsOnly)
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [availableGroups],
  );
  const closedGroupCount = useMemo(
    () => availableGroups.filter((group) => (group.status == null || group.status === "active") && group.adminsOnly).length,
    [availableGroups],
  );
  const selectedGroupCount = autoShareDraft.groupIds.filter((groupId) => openGroups.some((group) => group.id === groupId)).length;
  const scheduledTimes = useMemo(() => parseScheduledTimesInput(autoShareDraft.scheduledTimes), [autoShareDraft.scheduledTimes]);
  const schedulePreview = useMemo(
    () => buildGroupSchedulePreview(
      autoShareDraft.groupIds.filter((groupId) => openGroups.some((group) => group.id === groupId)),
      scheduledTimes.length > 0 ? scheduledTimes : ["09:30"],
    ),
    [autoShareDraft.groupIds, openGroups, scheduledTimes],
  );
  const groupNameById = useMemo(
    () => new Map(openGroups.map((group) => [group.id, group.name] as const)),
    [openGroups],
  );
  const updatedLabel = useMemo(() => {
    if (!affiliate?.updatedAt) {
      return "Nunca atualizado";
    }
    return formatDateTime(affiliate.updatedAt);
  }, [affiliate?.updatedAt]);

  return (
    <>
      <Card className={`border-0 shadow-sm ${styles.compactCard}`}>
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div className={styles.botAdminAffiliateHeaderBrand}>
              {logoUrl ? (
                <img src={logoUrl} alt={brandName} className={styles.botAdminAffiliateLogo} />
              ) : (
                <span className={styles.botAdminAffiliateLogoFallback}>
                  <IconSpeakerphone size={20} />
                </span>
              )}
              <div>
                <Card.Title as="h2" className="h5 mb-1">
                  Bot Admin afiliados
                </Card.Title>
                <Card.Text className="text-secondary mb-0 small">
                  Link profissional, comissão por indicação e histórico da carteira.
                </Card.Text>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg={affiliate?.enabled ? "success" : "secondary"}>
                {statusLabel(Boolean(affiliate?.enabled))}
              </Badge>
              <Button size="sm" variant="outline-secondary" onClick={() => setShowHelp(true)}>
                <IconHelpCircle size={16} className="me-1" />
                Explicação
              </Button>
            </div>
          </div>

          {feedback ? (
            <Alert variant={feedback.type} className="mb-0 py-2" onClose={() => setFeedback(null)} dismissible>
              {feedback.message}
            </Alert>
          ) : null}

          {loading && !payload ? (
            <div className="d-flex align-items-center gap-2 text-secondary small">
              <Spinner animation="border" size="sm" />
              Carregando afiliados...
            </div>
          ) : null}

          {payload ? (
            <>
              <Row className="g-2">
                <Col md={3} sm={6}>
                  <div className={styles.walletStat}>
                    <span className={styles.walletStatLabel}>Saldo afiliados</span>
                    <strong className={styles.walletStatValue}>{formatCurrency(wallet?.balance ?? 0)}</strong>
                  </div>
                </Col>
                <Col md={3} sm={6}>
                  <div className={styles.walletStat}>
                    <span className={styles.walletStatLabel}>Comissão</span>
                    <strong className={styles.walletStatValue}>{affiliate?.commissionPercent ?? 0}%</strong>
                  </div>
                </Col>
                <Col md={3} sm={6}>
                  <div className={styles.walletStat}>
                    <span className={styles.walletStatLabel}>Vendas aprovadas</span>
                    <strong className={styles.walletStatValue}>
                      {wallet?.approvedSalesCount ?? 0}/{wallet?.minSalesForWithdrawal ?? 0}
                    </strong>
                  </div>
                </Col>
                <Col md={3} sm={6}>
                  <div className={styles.walletStat}>
                    <span className={styles.walletStatLabel}>Modo</span>
                    <strong className={styles.walletStatValue}>{modeLabel}</strong>
                  </div>
                </Col>
              </Row>

              <div className={styles.affiliateMainPanel}>
                <div className={styles.affiliateSwitchRow}>
                  <div>
                    <strong>Ativar Bot Admin afiliados</strong>
                    <small>
                      Quando ativo, seu link fixo fica pronto para indicação. A renovação por botões no grupo continua
                      separada para o admin renovar grupos vencidos.
                    </small>
                  </div>
                  <Form.Check
                    type="switch"
                    id="bot-admin-affiliate-enabled"
                    checked={Boolean(affiliate?.enabled)}
                    disabled={saving}
                    onChange={(event) => void handleToggleAffiliate(event.currentTarget.checked)}
                    label={saving ? "Salvando..." : affiliate?.enabled ? "Ativo" : "Inativo"}
                  />
                </div>

                <div>
                  <Form.Label htmlFor="bot-admin-affiliate-link" className="fw-semibold">
                    Link fixo de indicação
                  </Form.Label>
                  <InputGroup>
                    <Form.Control
                      id="bot-admin-affiliate-link"
                      value={affiliate?.referralLink ?? ""}
                      readOnly
                      className={styles.affiliateLinkInput}
                    />
                    <Button variant={copied ? "success" : "outline-secondary"} onClick={() => void handleCopy()}>
                      <IconCopy size={18} className="me-1" />
                      {copied ? "Copiado" : "Copiar"}
                    </Button>
                  </InputGroup>
                  <Form.Text className="text-secondary">
                    Código imutável: <strong>{affiliate?.referralCode}</strong> · {updatedLabel}
                  </Form.Text>
                </div>

                {payload.readiness?.message ? (
                  <Alert variant="info" className="mb-0 py-2 small">
                    {payload.readiness.message}
                  </Alert>
                ) : null}

                {showAutoShare ? (
                  <div className={styles.affiliateAutoSharePanel}>
                    <div className={styles.affiliateAutoShareHeader}>
                      <div>
                        <strong>Divulgação automática nos grupos</strong>
                        <small>
                          Envie uma chamada do BotAdmin com botão CTA apontando para o seu link de indicação.
                        </small>
                      </div>
                      <Form.Check
                        type="switch"
                        id="bot-admin-affiliate-auto-share-enabled"
                        checked={autoShareDraft.enabled}
                        disabled={savingAutoShare}
                        onChange={(event) =>
                          setAutoShareDraft((current) => ({ ...current, enabled: event.currentTarget.checked }))
                        }
                        label={autoShareDraft.enabled ? "Ativa" : "Pausada"}
                      />
                    </div>

                    <Row className="g-2">
                      <Col md={8}>
                        <Form.Group controlId="bot-admin-affiliate-auto-share-message">
                          <Form.Label>Mensagem da divulgação</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={4}
                            value={autoShareDraft.messageText}
                            onChange={(event) =>
                              setAutoShareDraft((current) => ({ ...current, messageText: event.target.value.slice(0, 1200) }))
                            }
                            disabled={savingAutoShare}
                            placeholder="Digite a mensagem que será enviada nos grupos."
                          />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group className="mb-2">
                          <Form.Label>Modo de disparo</Form.Label>
                          <div className={styles.affiliateAutoShareModeGrid}>
                            <button
                              type="button"
                              className={autoShareDraft.mode === "interval" ? styles.affiliateAutoShareModeActive : ""}
                              onClick={() => setAutoShareDraft((current) => ({ ...current, mode: "interval" }))}
                              disabled={savingAutoShare}
                            >
                              Intervalo
                            </button>
                            <button
                              type="button"
                              className={autoShareDraft.mode === "scheduled" ? styles.affiliateAutoShareModeActive : ""}
                              onClick={() => setAutoShareDraft((current) => ({ ...current, mode: "scheduled" }))}
                              disabled={savingAutoShare}
                            >
                              Horários
                            </button>
                          </div>
                        </Form.Group>
                        <Form.Group controlId="bot-admin-affiliate-auto-share-cta">
                          <Form.Label>Texto do botão CTA</Form.Label>
                          <Form.Control
                            value={autoShareDraft.ctaText}
                            onChange={(event) =>
                              setAutoShareDraft((current) => ({ ...current, ctaText: event.target.value.slice(0, 40) }))
                            }
                            disabled={savingAutoShare}
                            placeholder="Conhecer BotAdmin"
                          />
                        </Form.Group>
                        {autoShareDraft.mode === "interval" ? (
                          <Form.Group controlId="bot-admin-affiliate-auto-share-interval" className="mt-2">
                            <Form.Label>Intervalo por grupo</Form.Label>
                            <Form.Control
                              type="number"
                              min={1}
                              max={168}
                              value={autoShareDraft.intervalHours}
                              onChange={(event) =>
                                setAutoShareDraft((current) => ({ ...current, intervalHours: event.target.value }))
                              }
                              disabled={savingAutoShare}
                            />
                            <Form.Text>Em horas. Máximo 168.</Form.Text>
                          </Form.Group>
                        ) : (
                          <Form.Group controlId="bot-admin-affiliate-auto-share-times" className="mt-2">
                            <Form.Label>Horários base</Form.Label>
                            <Form.Control
                              value={autoShareDraft.scheduledTimes}
                              onChange={(event) =>
                                setAutoShareDraft((current) => ({ ...current, scheduledTimes: event.target.value }))
                              }
                              onBlur={() =>
                                setAutoShareDraft((current) => ({
                                  ...current,
                                  scheduledTimes: (parseScheduledTimesInput(current.scheduledTimes).length > 0
                                    ? parseScheduledTimesInput(current.scheduledTimes)
                                    : ["09:30"]).join(", "),
                                }))
                              }
                              disabled={savingAutoShare}
                              placeholder="09:30, 15:45, 20:10"
                            />
                            <Form.Text>O sistema desloca alguns minutos por grupo para evitar disparo em massa.</Form.Text>
                          </Form.Group>
                        )}
                      </Col>
                    </Row>

                    <div className={styles.affiliateAutoShareGroupBox}>
                      <div className={styles.affiliateAutoShareGroupHeader}>
                        <strong>Grupos escolhidos</strong>
                        <small>{selectedGroupCount} selecionado(s)</small>
                      </div>
                      {closedGroupCount > 0 ? (
                        <Alert variant="light" className="border mx-2 mt-2 mb-0 small">
                          {closedGroupCount} grupo(s) fechado(s) foram ocultados porque só admins podem enviar mensagens.
                        </Alert>
                      ) : null}
                      {openGroups.length === 0 ? (
                        <Alert variant="light" className="border mb-0">
                          Nenhum grupo aberto e ativo disponível para divulgação.
                        </Alert>
                      ) : (
                        <div className={styles.affiliateAutoShareGroupList}>
                          {openGroups.map((group) => {
                            const checked = autoShareDraft.groupIds.includes(group.id);
                            return (
                            <label
                              key={`bot-admin-auto-share-group-${group.id}`}
                              className={`${styles.affiliateAutoShareGroupItem} ${checked ? styles.affiliateAutoShareGroupItemActive : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleAutoShareGroup(group.id)}
                                disabled={savingAutoShare}
                              />
                              <span>
                                <strong>{group.name}</strong>
                                <small>
                                  {group.instanceName || group.instancePhone
                                    ? [group.instanceName, group.instancePhone].filter(Boolean).join(" · ")
                                    : "Grupo vinculado"}
                                </small>
                              </span>
                              <span
                                className={`${styles.affiliateAutoShareGroupSwitch} ${checked ? styles.affiliateAutoShareGroupSwitchActive : ""}`}
                                aria-hidden="true"
                              >
                                <span />
                              </span>
                            </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {autoShareDraft.mode === "scheduled" ? (
                      <div className={styles.affiliateAutoShareSchedulePreview}>
                        <div className={styles.affiliateAutoShareGroupHeader}>
                          <strong>Agenda escalonada</strong>
                          <small>{schedulePreview.length} grupo(s)</small>
                        </div>
                        {schedulePreview.length === 0 ? (
                          <Alert variant="light" className="border m-2 small">
                            Selecione grupos para visualizar os horários individuais.
                          </Alert>
                        ) : (
                          <div className={styles.affiliateAutoShareScheduleList}>
                            {schedulePreview.map((schedule) => (
                              <div key={`bot-admin-auto-share-schedule-${schedule.groupId}`}>
                                <strong>{groupNameById.get(schedule.groupId) ?? `Grupo ${schedule.groupId}`}</strong>
                                <span>{schedule.times.join(", ")}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className={styles.affiliateAutoShareMediaBox}>
                      <div className={styles.affiliateAutoShareMediaHeader}>
                        <div>
                          <strong>Mídias do anúncio</strong>
                          <small>
                            Cadastre várias mídias. O envio escolhe uma aleatoriamente para variar a divulgação.
                          </small>
                        </div>
                        <Badge bg="light" text="dark">
                          {autoShareDraft.mediaItems.length}/20
                        </Badge>
                      </div>
                      <div className={styles.affiliateAutoShareMediaActions}>
                        <Form.Label
                          htmlFor="bot-admin-affiliate-auto-share-media"
                          className={styles.affiliateAutoShareUploadButton}
                        >
                          {uploadingAutoShareMedia ? (
                            <Spinner animation="border" size="sm" />
                          ) : (
                            <IconUpload size={17} />
                          )}
                          <span>{uploadingAutoShareMedia ? "Enviando..." : "Adicionar mídias"}</span>
                        </Form.Label>
                        <input
                          id="bot-admin-affiliate-auto-share-media"
                          type="file"
                          multiple
                          accept="image/*,video/*,audio/*,application/pdf"
                          className="d-none"
                          onChange={(event) => void handleAutoShareMediaUpload(event)}
                          disabled={uploadingAutoShareMedia || savingAutoShare || autoShareDraft.mediaItems.length >= 20}
                        />
                        <small>Imagens, vídeos, áudios ou documentos. Use mídias leves para preservar desempenho.</small>
                      </div>
                      {autoShareDraft.mediaItems.length > 0 ? (
                        <div className={styles.affiliateAutoShareMediaList}>
                          {autoShareDraft.mediaItems.map((mediaItem) => {
                            const MediaIcon = mediaIconByType[mediaItem.mediaType] ?? IconFile;
                            return (
                              <div key={mediaItem.id} className={styles.affiliateAutoShareMediaItem}>
                                <span className={styles.affiliateAutoShareMediaIcon}>
                                  <MediaIcon size={17} />
                                </span>
                                <div>
                                  <strong>{mediaItem.fileName || mediaLabelByType[mediaItem.mediaType]}</strong>
                                  <small>{mediaLabelByType[mediaItem.mediaType]} · {mediaItem.mimeType || "tipo automático"}</small>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeAutoShareMedia(mediaItem)}
                                  disabled={savingAutoShare || uploadingAutoShareMedia}
                                  aria-label="Remover mídia"
                                >
                                  <IconTrash size={16} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div className={styles.affiliateAutoSharePreview}>
                      <div>
                        <span>Preview do CTA</span>
                        <strong>{autoShareDraft.ctaText || "Conhecer BotAdmin"}</strong>
                        <small>{affiliate?.referralLink}</small>
                      </div>
                      <IconSpeakerphone size={22} />
                    </div>

                    {affiliate?.autoShare.lastRunAt || affiliate?.autoShare.lastError ? (
                      <Alert
                        variant={affiliate.autoShare.lastError ? "warning" : "success"}
                        className="mb-0 py-2 small"
                      >
                        {affiliate.autoShare.lastRunAt ? (
                          <span className="d-block">
                            Última tentativa: {formatDateTime(affiliate.autoShare.lastRunAt)}
                          </span>
                        ) : null}
                        {affiliate.autoShare.lastError ? (
                          <span className="d-block">Último erro: {affiliate.autoShare.lastError}</span>
                        ) : (
                          <span className="d-block">Sem erro registrado no último ciclo.</span>
                        )}
                      </Alert>
                    ) : null}

                    <div className="d-flex justify-content-end">
                      <Button
                        variant="primary"
                        onClick={() => void handleSaveAutoShare()}
                        disabled={savingAutoShare}
                      >
                        {savingAutoShare ? (
                          <Spinner animation="border" size="sm" className="me-2" />
                        ) : (
                          <IconDeviceFloppy size={18} className="me-1" />
                        )}
                        Salvar divulgação
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div id="historico-afiliados" className={styles.affiliateHistoryPanel}>
                <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                  <div>
                    <h3 className="h6 mb-0">Histórico de indicações, pagamentos e comissões</h3>
                    <small className="text-secondary">Últimos movimentos da carteira de afiliados.</small>
                  </div>
                  <Button size="sm" variant="outline-secondary" onClick={() => void loadAffiliate()} disabled={loading}>
                    <IconRefresh size={16} className="me-1" />
                    Atualizar
                  </Button>
                </div>

                {history.length === 0 ? (
                  <Alert variant="light" className="border mb-0">
                    Nenhuma comissão registrada ainda. Compartilhe seu link para começar.
                  </Alert>
                ) : (
                  <div className={styles.affiliateHistoryList}>
                    {history.map((item) => (
                      <div key={item.id} className={styles.affiliateHistoryItem}>
                        <div>
                          <strong>{item.description}</strong>
                          <small>
                            {formatDateTime(item.createdAt)}
                            {item.planPaymentId ? ` · pagamento ${item.planPaymentId}` : ""}
                          </small>
                        </div>
                        <div className="text-end">
                          <strong className={item.type === "withdrawal" ? "text-danger" : "text-success"}>
                            {item.type === "withdrawal" ? "-" : "+"}
                            {formatCurrency(item.amount)}
                          </strong>
                          <small className="text-secondary d-block">{item.status}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </Card.Body>
      </Card>

      <Modal show={showHelp} onHide={() => setShowHelp(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Como funciona o Bot Admin afiliados</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Cada usuário recebe um link fixo de indicação. Quando alguém cria conta e compra pelo link, a venda fica
            vinculada ao afiliado e a comissão aparece na carteira.
          </p>
          <p className="mb-0 text-secondary">
            O toggle desta área ativa o modo afiliado profissional. Já a venda/renovação enviada dentro dos grupos fica
            como recurso de conveniência para o próprio admin renovar grupos vencidos pelos botões do WhatsApp.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowHelp(false)}>
            Entendi
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default BotAdminAffiliateManager;
