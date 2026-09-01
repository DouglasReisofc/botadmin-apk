"use client";

import type { ChangeEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import SimpleBar from "simplebar-react";
import { ListGroup, Button, Modal, Offcanvas, Form, Stack } from "react-bootstrap";

import Flex from "components/common/Flex";
import { IconCircleFilled, IconSettings } from "@tabler/icons-react";
import type { UserNotification } from "types/notifications";
import {
  DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
  DEFAULT_NOTIFICATION_VOICE,
  NOTIFICATION_VOICE_OPTIONS,
  NOTIFICATION_VOICE_ID_SET,
} from "data/notification-audio";

interface NotificationProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: UserNotification[];
  onMarkAllRead: () => Promise<void>;
  onRefresh: () => Promise<void>;
  openNotificationId?: number | null;
  onClearAll?: () => Promise<void>;
  onNotificationClick?: (notification: UserNotification) => Promise<boolean> | boolean;
  viewerRole?: "admin" | "user";
}

type AudioSpeechMode = "browser" | "api";

type AudioSettings = {
  soundsEnabled: boolean;
  ttsEnabled: boolean;
  speechMode: AudioSpeechMode;
  speechVoice: string;
  purchaseTemplate: string;
  balanceTemplate: string;
  raffleTemplate: string;
  planTemplate: string;
};

const AUDIO_SETTINGS_STORAGE_KEY = "notification-audio-settings";
const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  soundsEnabled: true,
  ttsEnabled: true,
  speechMode: "api",
  speechVoice: DEFAULT_NOTIFICATION_VOICE,
  purchaseTemplate: DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  balanceTemplate: DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  raffleTemplate: DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  planTemplate: DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
};

const normalizeAudioSettings = (raw: unknown): AudioSettings => {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_AUDIO_SETTINGS;
  }

  const value = raw as Partial<AudioSettings>;
  const raffleRaw = (value as Record<string, unknown>).raffleTemplate;
  const planRaw = (value as Record<string, unknown>).planTemplate;
  return {
    soundsEnabled: value.soundsEnabled !== false,
    ttsEnabled: value.ttsEnabled !== false,
    speechMode: value.speechMode === "browser" ? "browser" : "api",
    speechVoice:
      typeof value.speechVoice === "string" && value.speechVoice.trim()
        ? NOTIFICATION_VOICE_ID_SET.has(value.speechVoice.trim())
          ? value.speechVoice.trim()
          : DEFAULT_AUDIO_SETTINGS.speechVoice
        : DEFAULT_AUDIO_SETTINGS.speechVoice,
    purchaseTemplate:
      typeof value.purchaseTemplate === "string" && value.purchaseTemplate.trim()
        ? value.purchaseTemplate.trim()
        : DEFAULT_AUDIO_SETTINGS.purchaseTemplate,
    balanceTemplate:
      typeof value.balanceTemplate === "string" && value.balanceTemplate.trim()
        ? value.balanceTemplate.trim()
        : DEFAULT_AUDIO_SETTINGS.balanceTemplate,
    raffleTemplate:
      typeof raffleRaw === "string" && raffleRaw.trim()
        ? raffleRaw.trim()
        : DEFAULT_AUDIO_SETTINGS.raffleTemplate,
    planTemplate:
      typeof planRaw === "string" && planRaw.trim()
        ? planRaw.trim()
        : DEFAULT_AUDIO_SETTINGS.planTemplate,
  };
};

const formatDate = (iso: string) => {
  try {
    const date = new Date(iso);
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(date);
  } catch {
    return iso;
  }
};

const NoficationList: React.FC<NotificationProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAllRead,
  onRefresh,
  openNotificationId,
  onClearAll,
  onNotificationClick,
  viewerRole = "user",
}) => {
  const isAdmin = viewerRole === "admin";
  const hasUnread = useMemo(
    () => notifications.some((notification) => !notification.isRead),
    [notifications],
  );

  const [selectedNotification, setSelectedNotification] = useState<UserNotification | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState(false);
  const [isSavingAudio, setIsSavingAudio] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);


  useEffect(() => {
    if (!isOpen) {
      setIsAudioSettingsOpen(false);
    }
  }, [isOpen]);

  // Carrega as preferências salvas quando o componente é montado
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setAudioSettings(normalizeAudioSettings(parsed));
    } catch {
      // ignore parse/storage errors
    }
  }, []);

  const persistSettings = useCallback((settings: AudioSettings, options?: { syncServer?: boolean }) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // ignore storage errors
      }
      window.dispatchEvent(new CustomEvent("notifications:audio-settings", { detail: settings }));
    }

    if (options?.syncServer !== false) {
      void fetch("/api/notifications/audio-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      }).catch(() => {
        // ignore sync errors; local state already updated
      });
    }
    return settings;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const applyState = (settings: AudioSettings, options?: { syncServer?: boolean }) => {
      if (cancelled) {
        return;
      }
      setAudioSettings(persistSettings(settings, options));
    };

    const readStoredSettings = (): AudioSettings => {
      try {
        const stored = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : null;
        return normalizeAudioSettings(parsed);
      } catch {
        return DEFAULT_AUDIO_SETTINGS;
      }
    };

    applyState(readStoredSettings(), { syncServer: false });

    const syncRemoteSettings = async () => {
      try {
        const response = await fetch("/api/notifications/audio-settings", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = await response.json().catch(() => null);
        const remote = normalizeAudioSettings((payload as { settings?: unknown } | null)?.settings);
        applyState(remote, { syncServer: false });
      } catch {
        // ignore fetch failures
      }
    };

    void syncRemoteSettings();

    return () => {
      cancelled = true;
    };
  }, [persistSettings]);

  const handleAudioToggle = useCallback(
    (field: "soundsEnabled" | "ttsEnabled") => (event: ChangeEvent<HTMLInputElement>) => {
      const { checked } = event.target;

      setAudioSettings((previous) =>
        persistSettings(
          normalizeAudioSettings({
            ...previous,
            [field]: checked,
          }),
        ),
      );
    },
    [persistSettings],
  );

  const handleModeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value === "browser" ? "browser" : "api";
      setAudioSettings((previous) =>
        persistSettings(
          normalizeAudioSettings({
            ...previous,
            speechMode: value,
          }),
        ),
      );
    },
    [persistSettings],
  );

  const handleVoiceChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value.trim();
      setAudioSettings((previous) =>
        persistSettings(
          normalizeAudioSettings({
            ...previous,
            speechVoice: value,
          }),
        ),
      );
    },
    [persistSettings],
  );

  const handleTemplateChange = useCallback(
    (field: "purchaseTemplate" | "balanceTemplate" | "raffleTemplate" | "planTemplate") =>
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        const raw = event.target.value;
        const trimmed = raw.slice(0, 160);
        setAudioSettings((previous) =>
          persistSettings(
            normalizeAudioSettings({
              ...previous,
              [field]: trimmed,
            }),
          ),
        );
      },
    [persistSettings],
  );

  const sampleTemplate = isAdmin ? audioSettings.planTemplate : audioSettings.purchaseTemplate;

  const handleNotificationClick = useCallback(
    async (notification: UserNotification) => {
      if (onNotificationClick) {
        try {
          const handled = await onNotificationClick(notification);
          if (handled) {
            return;
          }
        } catch (error) {
          console.error("Failed to handle notification click", error);
        }
      }

      setSelectedNotification(notification);
      setIsDetailOpen(true);

      if (notification.isRead) {
        return;
      }

      setIsMarkingRead(true);
      try {
        await fetch("/api/notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notificationIds: [notification.id] }),
        });

        setSelectedNotification({ ...notification, isRead: true });
        await onRefresh();
      } catch (error) {
        console.error("Failed to mark notification as read", error);
      } finally {
        setIsMarkingRead(false);
      }
    },
    [onRefresh, onNotificationClick],
  );

  const handleDetailClose = useCallback(() => {
    setIsDetailOpen(false);
    setSelectedNotification(null);
  }, []);

  // Autoabrir uma notificação específica quando solicitado externamente
  useEffect(() => {
    if (!openNotificationId) return;
    const candidate = notifications.find((n) => n.id === openNotificationId);
    if (candidate) {
      void handleNotificationClick(candidate);
    }
  }, [openNotificationId, notifications, handleNotificationClick]);

  return (
    <>
      <Offcanvas placement="end" show={isOpen} onHide={onClose}>
        <div className="sticky-top bg-white">
          <Offcanvas.Header closeButton className="align-items-start gap-3">
            <Flex justifyContent="between" className="w-100">
              <div>
                <h5 className="mb-0">Notificações</h5>
                <small className="text-secondary">
                  Acompanhe novas vendas, recargas e comunicados importantes por aqui.
                </small>
              </div>
              <Button
                variant="outline-secondary"
                size="sm"
                className="d-flex align-items-center justify-content-center p-1"
                type="button"
                onClick={() => setIsAudioSettingsOpen(true)}
                aria-label="Configurações de som"
              >
                <IconSettings size={16} />
              </Button>
            </Flex>
          </Offcanvas.Header>
        </div>

        <div className="px-4 pb-4">
          <Button
            variant="ghost"
            className="w-100 mb-3"
            onClick={() => {
              void onMarkAllRead();
            }}
            disabled={!hasUnread}
            type="button"
          >
            Marcar todas como lidas
          </Button>

          <Button
            variant="ghost"
            className="w-100 mb-3"
            onClick={() => { if (onClearAll) void onClearAll(); }}
            type="button"
          >
            Limpar notificações
          </Button>

          <SimpleBar style={{ maxHeight: 480 }}>
            <ListGroup variant="flush" className="border rounded-3">
              {notifications.length === 0 ? (
                <ListGroup.Item className="py-5 text-center text-secondary">
                  Nenhuma notificação por aqui ainda.
                </ListGroup.Item>
              ) : (
                notifications.map((notification) => (
                  <ListGroup.Item
                    key={notification.id}
                    action
                    onClick={() => {
                      void handleNotificationClick(notification);
                    }}
                    className="py-4 px-4 border-bottom d-flex flex-column gap-2"
                  >
                    <Flex justifyContent="between" alignItems="center">
                      <div className="d-flex flex-column">
                        <strong className="text-truncate">{notification.title}</strong>
                        <small className="text-secondary">{formatDate(notification.createdAt)}</small>
                      </div>
                      {!notification.isRead && (
                        <IconCircleFilled size={10} className="text-primary" />
                      )}
                    </Flex>
                    <p className="mb-0 text-secondary" style={{ whiteSpace: "pre-line" }}>
                      {notification.message}
                    </p>
                  </ListGroup.Item>
                ))
              )}
            </ListGroup>
          </SimpleBar>
        </div>
      </Offcanvas>

      <Modal show={isDetailOpen && Boolean(selectedNotification)} onHide={handleDetailClose} centered>
        <Modal.Header closeButton>
          <Modal.Title>{selectedNotification?.title ?? "Notificação"}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedNotification && (
            <div className="d-flex flex-column gap-3">
              <small className="text-secondary">
                Recebida em {formatDate(selectedNotification.createdAt)}
              </small>
              <p className="mb-0" style={{ whiteSpace: "pre-line" }}>
                {selectedNotification.message}
              </p>

              {/* Detalhes rápidos por tipo */}
              {(() => {
                const t = selectedNotification.type;
                const m = (selectedNotification.metadata || {}) as Record<string, any>;
                if (t === "bot_purchase") {
                  return (
                    <div className="border rounded-3 p-3">
                      <div><strong>Categoria:</strong> {m.categoryName || m.category || "-"}</div>
                      {m.amount != null && (
                        <div><strong>Valor:</strong> {String(m.amount)}</div>
                      )}
                      {(m.customerName || m.customerWhatsapp) && (
                        <div><strong>Cliente:</strong> {m.customerName || m.customerWhatsapp}</div>
                      )}
                      <div className="mt-2">
                        <a className="btn btn-sm btn-outline-primary" href="/dashboard/user/compras">Ver vendas</a>
                      </div>
                    </div>
                  );
                }
                if (t === "bot_sale") {
                  return (
                    <div className="border rounded-3 p-3">
                      {m.amount != null && (
                        <div><strong>Valor:</strong> {String(m.amount)}</div>
                      )}
                      {m.paymentMethod && (
                        <div><strong>Pagamento:</strong> {String(m.paymentMethod)}</div>
                      )}
                      {(m.customer || m.customerName) && (
                        <div><strong>Cliente:</strong> {m.customer || m.customerName}</div>
                      )}
                      <div className="mt-2">
                        <a className="btn btn-sm btn-outline-primary" href="/dashboard/user/pagamentos/historico">Ver pagamentos</a>
                      </div>
                    </div>
                  );
                }
                if (t === "customer_balance_credit") {
                  return (
                    <div className="border rounded-3 p-3">
                      {(m.customerName || m.customerWhatsapp) && (
                        <div><strong>Cliente:</strong> {m.customerName || m.customerWhatsapp}</div>
                      )}
                      {m.amount != null && (
                        <div><strong>Crédito:</strong> {String(m.amount)}</div>
                      )}
                      {m.customerBalance != null && (
                        <div><strong>Saldo agora:</strong> {String(m.customerBalance)}</div>
                      )}
                      <div className="mt-2">
                        <a className="btn btn-sm btn-outline-primary" href="/dashboard/user/clientes">Ver clientes</a>
                      </div>
                    </div>
                  );
                }
                if (t === "support_opened") {
                  const whatsappId = typeof m.whatsappId === "string" ? m.whatsappId : "";
                  const userId = typeof m.userId === "number" ? m.userId : undefined;
                  const targetRoute = typeof m.route === "string"
                    ? m.route
                    : "/dashboard/user/conversas";
                  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (!whatsappId) {
                      event.preventDefault();
                      return;
                    }
                    try {
                      sessionStorage.setItem(
                        "support:target-thread",
                        JSON.stringify({ whatsappId, userId: userId ?? null }),
                      );
                    } catch {}
                  };
                  return (
                    <div className="border rounded-3 p-3">
                      {(m.customerName || m.whatsappId) && (
                        <div><strong>Cliente:</strong> {m.customerName || m.whatsappId}</div>
                      )}
                      <div className="mt-2">
                        <a
                          className="btn btn-sm btn-outline-primary"
                          href={targetRoute}
                          onClick={onClick}
                        >
                          Abrir conversa
                        </a>
                      </div>
                    </div>
                  );
                }
                if (t === "support_inbound") {
                  const whatsappId = typeof m.whatsappId === "string" ? m.whatsappId : "";
                  const userId = typeof m.userId === "number" ? m.userId : undefined;
                  const targetRoute = typeof m.route === "string"
                    ? m.route
                    : "/dashboard/user/conversas";
                  const preview = typeof m.preview === "string" ? m.preview : notification.message;
                  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (!whatsappId) {
                      event.preventDefault();
                      return;
                    }
                    try {
                      sessionStorage.setItem(
                        "support:target-thread",
                        JSON.stringify({ whatsappId, userId: userId ?? null }),
                      );
                    } catch {}
                  };
                  return (
                    <div className="border rounded-3 p-3">
                      {preview && <div className="mb-2">{preview}</div>}
                      <div className="mt-2">
                        <a
                          className="btn btn-sm btn-outline-primary"
                          href={targetRoute}
                          onClick={onClick}
                        >
                          Abrir suporte
                        </a>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleDetailClose} disabled={isMarkingRead}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={isAudioSettingsOpen} onHide={() => setIsAudioSettingsOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Configurações de áudio</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Stack gap={3}>
            <Form.Check
              type="switch"
              id="notifications-sound-toggle"
              label={(
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Som de notificações</span>
                  <small className="text-secondary">
                    Toque curto para vendas, mensagens e alertas gerais.
                  </small>
                </div>
              )}
              checked={audioSettings.soundsEnabled}
              onChange={handleAudioToggle("soundsEnabled")}
            />
            <Form.Check
              type="switch"
              id="notifications-tts-toggle"
              label={(
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Notificações por voz</span>
                  <small className="text-secondary">
                    Leia em voz alta compras e recargas com uma frase curta e personalizável.
                  </small>
                </div>
              )}
              checked={audioSettings.ttsEnabled}
              onChange={handleAudioToggle("ttsEnabled")}
            />

            <Form.Group controlId="notifications-voice-mode">
              <Form.Label className="fw-semibold mb-1">Tipo de voz</Form.Label>
              <Form.Select
                value={audioSettings.speechMode}
                onChange={handleModeChange}
                disabled={!audioSettings.ttsEnabled}
              >
                <option value="api">Voz narrada (API StoreZap)</option>
                <option value="browser">Voz do navegador (TTS local)</option>
              </Form.Select>
              <Form.Text className="text-secondary">
                A voz narrada usa o serviço em nuvem com os timbres abaixo. A voz do navegador depende do dispositivo.
              </Form.Text>
            </Form.Group>

            {audioSettings.speechMode === "api" && (
              <Form.Group controlId="notifications-voice-choice">
                <Form.Label className="fw-semibold mb-1">Escolha a voz</Form.Label>
                <Form.Select
                  value={audioSettings.speechVoice}
                  onChange={handleVoiceChange}
                  disabled={!audioSettings.ttsEnabled}
                >
                  {NOTIFICATION_VOICE_OPTIONS.map((voice) => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-secondary">
                  Essas vozes utilizam o endpoint local de TTS (/api/tts).
                </Form.Text>
                <div className="mt-2">
                  <Button
                    variant="outline-primary"
                    size="sm"
                    disabled={!audioSettings.ttsEnabled || sampleLoading}
                    onClick={async () => {
                      setSampleLoading(true);
                      try {
                        const phrase = sampleTemplate
                          .replaceAll("{{customer_name}}", "Cliente do bot")
                          .replaceAll("{{category_name}}", "produto")
                          .replaceAll("{{raffle_name}}", "Rifa Especial")
                          .replaceAll("{{ticket_quantity}}", "3")
                          .replaceAll("{{ticket_numbers}}", "12, 34, 56")
                          .replaceAll("{{ticket_numbers_phrase}}", " com os números 12, 34, 56")
                          .replaceAll("{{buyer_name}}", "João")
                          .replaceAll("{{plan_name}}", "Plano Premium")
                          .replaceAll("{{amount}}", "R$ 100,00")
                          .replaceAll("{{balance}}", "R$ 150,00")
                          .replaceAll("{{balance_text}}", "Saldo atual: R$ 150,00")
                          .replaceAll("{{bot_name}}", "StoreBot");

                        if (audioSettings.speechMode === "browser") {
                          const u = new SpeechSynthesisUtterance(phrase);
                          window.speechSynthesis.speak(u);
                        } else {
                          const url = new URL("/api/tts", window.location.origin);
                          url.searchParams.set("texto", phrase);
                          url.searchParams.set("voz", audioSettings.speechVoice || DEFAULT_NOTIFICATION_VOICE);
                          const r = await fetch(url.toString(), { cache: "no-store" });
                          const blob = await r.blob();
                          const obj = URL.createObjectURL(blob);
                          const a = new Audio(obj);
                          a.onended = () => URL.revokeObjectURL(obj);
                          await a.play();
                        }
                      } catch {}
                      setSampleLoading(false);
                    }}
                  >
                    {sampleLoading ? "Tocando..." : "Ouvir prévia"}
                  </Button>
                </div>
              </Form.Group>
            )}

            {!isAdmin && (
              <Form.Group controlId="notifications-voice-template-purchase">
                <Form.Label className="fw-semibold mb-1">Frase rápida para vendas de produtos</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={audioSettings.purchaseTemplate}
                  onChange={handleTemplateChange("purchaseTemplate")}
                  disabled={!audioSettings.ttsEnabled}
                />
                <Form.Text className="text-secondary">
                  Use {"{{customer_name}}"}, {"{{category_name}}"} e {"{{bot_name}}"} para montar a frase.
                </Form.Text>
              </Form.Group>
            )}

            {!isAdmin && (
              <Form.Group controlId="notifications-voice-template-raffle">
                <Form.Label className="fw-semibold mb-1">Frase para compras de rifas</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={audioSettings.raffleTemplate}
                  onChange={handleTemplateChange("raffleTemplate")}
                  disabled={!audioSettings.ttsEnabled}
                />
                <Form.Text className="text-secondary">
                  Variáveis disponíveis: {"{{customer_name}}"}, {"{{raffle_name}}"}, {"{{ticket_quantity}}"}, {"{{ticket_numbers}}"}, {"{{ticket_numbers_phrase}}"} e {"{{bot_name}}"}.
                </Form.Text>
              </Form.Group>
            )}

            {isAdmin && (
              <Form.Group controlId="notifications-voice-template-plan">
                <Form.Label className="fw-semibold mb-1">Frase para novas assinaturas</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={audioSettings.planTemplate}
                  onChange={handleTemplateChange("planTemplate")}
                  disabled={!audioSettings.ttsEnabled}
                />
                <Form.Text className="text-secondary">
                  Variáveis disponíveis: {"{{buyer_name}}"}, {"{{plan_name}}"}, {"{{amount}}"} e {"{{bot_name}}"}.
                </Form.Text>
              </Form.Group>
            )}

            <Form.Group controlId="notifications-voice-template-balance">
              <Form.Label className="fw-semibold mb-1">
                {isAdmin ? "Frase para créditos adicionados" : "Frase rápida para créditos"}
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={audioSettings.balanceTemplate}
                onChange={handleTemplateChange("balanceTemplate")}
                disabled={!audioSettings.ttsEnabled}
              />
              <Form.Text className="text-secondary">
                Variáveis disponíveis: {"{{customer_name}}"}, {"{{amount}}"}, {"{{balance}}"}, {"{{balance_text}}"} e {"{{bot_name}}"}.
              </Form.Text>
            </Form.Group>
          </Stack>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="primary"
            onClick={async () => {
              setIsSavingAudio(true);
              try { await persistSettings(audioSettings, { syncServer: true }); } catch {}
              setTimeout(() => setIsSavingAudio(false), 600);
            }}
          >
            {isSavingAudio ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="outline-secondary" onClick={() => setIsAudioSettingsOpen(false)}>
            Fechar
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default NoficationList;
