import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  CheckSquare,
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Tag,
  Ticket,
  Trash2,
  Trophy,
  WandSparkles,
  X,
} from "lucide-react";

import { absoluteMediaUrl, api, type JsonRecord } from "./api";
import InfoTip from "./InfoTip";

const listOf = (value: unknown, keys: string[] = []) => {
  if (Array.isArray(value)) return value as JsonRecord[];
  if (!value || typeof value !== "object") return [];
  const record = value as JsonRecord;
  for (const key of keys)
    if (Array.isArray(record[key])) return record[key] as JsonRecord[];
  return [];
};
const text = (value: unknown, fallback = "") =>
  value === null || value === undefined ? fallback : String(value);
const money = (value: unknown) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (value: unknown) => {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      });
};

function Notice({
  error,
  notice,
  onClose,
}: {
  error: string;
  notice: string;
  onClose?: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div
      className={
        error
          ? "module-error commerce-message"
          : "inline-notice success commerce-message"
      }
    >
      <b>{error ? "Não foi possível concluir." : "Concluído"}</b>
      <span>{error || notice}</span>
      {onClose && <button onClick={onClose}>Fechar</button>}
    </div>
  );
}

type RaffleDraft = {
  title: string;
  description: string;
  price: string;
  numbersTotal: string;
  winnersCount: string;
  groupIds: string;
  announcementMessage: string;
  finalMessage: string;
  announcementMentionAll: boolean;
};
const raffleDraft = (item?: JsonRecord | null): RaffleDraft => ({
  title: text(item?.title),
  description: text(item?.description),
  price: text(item?.price, "0"),
  numbersTotal: text(item?.numbersTotal, "100"),
  winnersCount: text(item?.winnersCount, "1"),
  groupIds: listOf(item, ["groups"])
    .map((group) => text(group.id))
    .filter(Boolean)
    .join(", "),
  announcementMessage: text(
    (item?.announcement as JsonRecord | undefined)?.message,
  ),
  finalMessage: text((item?.finalization as JsonRecord | undefined)?.message),
  announcementMentionAll: Boolean(
    (item?.announcement as JsonRecord | undefined)?.mentionAll,
  ),
});

function RaffleEditor({
  item,
  groups,
  busy,
  onClose,
  onSave,
}: {
  item?: JsonRecord | null;
  groups: JsonRecord[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: RaffleDraft) => void;
}) {
  const [draft, setDraft] = useState(() => raffleDraft(item));
  const update = <K extends keyof RaffleDraft>(key: K, value: RaffleDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const selectedGroups = new Set(
    draft.groupIds
      .split(/[,\s]+/)
      .map(Number)
      .filter((value) => value > 0),
  );
  const toggleGroup = (id: number, checked: boolean) => {
    const next = new Set(selectedGroups);
    if (checked) next.add(id);
    else next.delete(id);
    update("groupIds", [...next].join(", "));
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="quick-modal commerce-editor-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>{item ? "Editar rifa" : "Nova rifa"}</h2>
              <InfoTip label={item ? "Editar rifa" : "Nova rifa"}>
                Defina prêmio, quantidade de números, ganhadores e mensagens da rifa.
              </InfoTip>
            </div>
            <small>
              Configuração completa de números, divulgação e sorteio.
            </small>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="commerce-editor-scroll">
          <div className="commerce-form-grid">
            <label className="wide">
              Título
              <input
                autoFocus
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Ex.: Rifa de lançamento"
              />
            </label>
            <label>
              Valor por número
              <input
                inputMode="decimal"
                value={draft.price}
                onChange={(event) =>
                  update("price", event.target.value.replace(/[^0-9,.]/g, ""))
                }
              />
            </label>
            <label>
              Quantidade de números
              <input
                inputMode="numeric"
                value={draft.numbersTotal}
                onChange={(event) =>
                  update("numbersTotal", event.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <label>
              Quantidade de ganhadores
              <input
                inputMode="numeric"
                value={draft.winnersCount}
                onChange={(event) =>
                  update("winnersCount", event.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <fieldset className="raffle-group-picker wide">
              <legend>Grupos vinculados</legend>
              <small>
                Selecione onde a divulgação e o resultado serão enviados.
              </small>
              {groups.length ? (
                <div>
                  {groups.map((group, index) => {
                    const id = Number(group.id || 0);
                    return (
                      <label key={text(group.id, String(index))}>
                        <input
                          type="checkbox"
                          checked={selectedGroups.has(id)}
                          onChange={(event) =>
                            toggleGroup(id, event.target.checked)
                          }
                        />
                        <span>
                          <b>{text(group.name || group.title, "Grupo")}</b>
                          <small>
                            {text(
                              group.instanceName ||
                                (group.participantCount &&
                                  `${group.participantCount} participantes`),
                              `Grupo #${id}`,
                            )}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p>
                  Nenhum grupo disponível neste momento. Você ainda pode criar a
                  rifa e vincular grupos depois.
                </p>
              )}
            </fieldset>
            <label className="wide">
              Descrição
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </label>
            <label className="wide">
              Mensagem de divulgação
              <textarea
                rows={3}
                value={draft.announcementMessage}
                onChange={(event) =>
                  update("announcementMessage", event.target.value)
                }
                placeholder="Mensagem enviada aos grupos vinculados"
              />
            </label>
            <label className="commerce-check wide">
              <input
                type="checkbox"
                checked={draft.announcementMentionAll}
                onChange={(event) =>
                  update("announcementMentionAll", event.target.checked)
                }
              />{" "}
              Mencionar participantes na divulgação
            </label>
            <label className="wide">
              Mensagem do resultado
              <textarea
                rows={3}
                value={draft.finalMessage}
                onChange={(event) => update("finalMessage", event.target.value)}
                placeholder="Use uma mensagem clara para anunciar os ganhadores"
              />
            </label>
          </div>
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <span />
          <button
            className="primary-button"
            disabled={
              busy ||
              !draft.title.trim() ||
              Number(draft.numbersTotal) < 1 ||
              Number(draft.winnersCount) < 1
            }
            onClick={() => onSave(draft)}
          >
            <CheckSquare />{" "}
            {busy ? "Salvando…" : item ? "Salvar alterações" : "Criar rifa"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function PaymentSettingsModal({
  current,
  busy,
  onClose,
  onSave,
}: {
  current: JsonRecord | null;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: JsonRecord) => void;
}) {
  const settings = (current?.settings || current || {}) as JsonRecord;
  const [provider, setProvider] = useState(
    text(settings.activeProvider, "mercadopago_pix"),
  );
  const [credential, setCredential] = useState("");
  const [showCredential, setShowCredential] = useState(false);
  const providerData =
    provider === "polopag_pix"
      ? (settings.poloPag as JsonRecord | undefined)
      : (settings.mercadoPago as JsonRecord | undefined);
  // The API has returned both `isConfigured` and `configured` over time;
  // accepting either keeps the edit action usable after a deployment where
  // the payment settings payload is still in the older shape.
  const providerConfigured = Boolean(
    providerData?.isConfigured ||
      providerData?.configured ||
      (settings.configured &&
        text(settings.activeProvider, "") === provider),
  );
  const [expiration, setExpiration] = useState(
    text(providerData?.pixExpirationMinutes, "30"),
  );
  useEffect(() => {
    setExpiration(text(providerData?.pixExpirationMinutes, "30"));
  }, [provider, providerData?.pixExpirationMinutes]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="quick-modal payment-settings-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Credenciais de pagamento</h2>
              <InfoTip label="Credenciais de pagamento">
                Os dados ficam protegidos e são usados apenas para criar cobranças no provedor escolhido.
              </InfoTip>
            </div>
            <small>
              Escolha a plataforma que receberá novas vendas e rifas.
            </small>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="quick-form">
          <label>
            Plataforma
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="mercadopago_pix">Mercado Pago · Pix</option>
              <option value="polopag_pix">PoloPag · Pix</option>
            </select>
          </label>
          <label>
            {provider === "polopag_pix" ? "Chave da API" : "Access Token"}
            <span className="protected-input">
              <input
                type={showCredential ? "text" : "password"}
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={
                  providerData?.credentialMask
                    ? `Configurada: ${text(providerData.credentialMask)}`
                    : "Informe a credencial"
                }
              />
              <button
                type="button"
                onClick={() => setShowCredential((current) => !current)}
                aria-label={
                  showCredential ? "Ocultar credencial" : "Mostrar credencial"
                }
              >
                {showCredential ? <EyeOff /> : <Eye />}
              </button>
            </span>
          </label>
          <label>
            Validade do Pix em minutos
            <input
              inputMode="numeric"
              value={expiration}
              onChange={(event) =>
                setExpiration(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
          <p className="settings-muted">
            Deixe a credencial vazia para manter a chave já cadastrada. A outra
            plataforma será desativada para novos recebimentos.
          </p>
          {provider === "mercadopago_pix" && (
            <a
              className="payment-credentials-link"
              href={text(
                settings.mercadoPagoCredentialsUrl ||
                  (settings.links as JsonRecord | undefined)
                    ?.mercadoPagoCredentials,
                "https://www.mercadopago.com.br/developers/panel/app",
              )}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink /> Obter credenciais no Mercado Pago
            </a>
          )}
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={
              busy || (!credential.trim() && !providerConfigured)
            }
            onClick={() =>
              onSave({
                provider,
                credential: credential.trim(),
                pixExpirationMinutes: Number(expiration) || 30,
              })
            }
          >
            {busy ? "Salvando…" : "Salvar credenciais"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function RafflesWorkspace() {
  const [items, setItems] = useState<JsonRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<JsonRecord | null | undefined>(
    undefined,
  );
  const [payment, setPayment] = useState<JsonRecord | null>(null);
  const [groups, setGroups] = useState<JsonRecord[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [raffles, paymentResult, groupResult] = await Promise.all([
        api.raffles(),
        api.rafflePaymentSettings(),
        api.botGroups().catch(() => ({ groups: [] })),
      ]);
      const next = listOf(raffles, ["raffles"]);
      setItems(next);
      setPayment(paymentResult);
      setGroups(listOf(groupResult, ["groups", "items"]));
      setSelectedId((current) =>
        current && next.some((item) => text(item.id) === current)
          ? current
          : next[0]?.id
            ? text(next[0].id)
            : null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as rifas.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  const open = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    setError("");
    try {
      const result = await api.raffle(id);
      setDetail((result.raffle || result) as JsonRecord);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível abrir a rifa.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (selectedId) void open(selectedId);
    else setDetail(null);
  }, [selectedId, open]);
  const run = async (
    action: () => Promise<unknown>,
    success: string,
    closeEditor = false,
    reopenSelected = true,
  ): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(success);
      if (closeEditor) setEditor(undefined);
      await load();
      if (reopenSelected && selectedId) await open(selectedId);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível concluir.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = (draft: RaffleDraft) => {
    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      price: Number(draft.price.replace(",", ".")) || 0,
      numbersTotal: Number(draft.numbersTotal) || 100,
      winnersCount: Number(draft.winnersCount) || 1,
      groupIds: draft.groupIds
        .split(/[,\s]+/)
        .map(Number)
        .filter((value) => value > 0),
      announcement: {
        message: draft.announcementMessage,
        mentionAll: draft.announcementMentionAll,
      },
      finalization: { message: draft.finalMessage },
    };
    return run(
      () =>
        editor?.id
          ? api.updateRaffle(text(editor.id), payload)
          : api.createRaffle(payload),
      editor?.id ? "Rifa atualizada." : "Rifa criada.",
      true,
    );
  };
  const status = text(detail?.status, "draft").toLowerCase();
  const paymentPayload =
    payment?.settings && typeof payment.settings === "object"
      ? (payment.settings as JsonRecord)
      : payment || {};
  const configured = Boolean(
    paymentPayload.configured || paymentPayload.isConfigured,
  );
  return (
    <main
      className={`module commerce-workspace raffles-workspace ${selectedId ? "has-selection" : ""}`}
    >
      <header className="module-header">
        <div className="module-title">
          <span>
            <Ticket />
          </span>
          <div>
            <h1>Rifas</h1>
            <p>Reservas, vendas, sorteios e grupos vinculados.</p>
          </div>
        </div>
        <div>
          <button onClick={() => void load()}>
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
          <button
            className="secondary-button payment-shortcut"
            onClick={() => setPaymentOpen(true)}
          >
            <BadgeDollarSign />{" "}
            {configured ? "Recebimento ativo" : "Configurar pagamento"}
          </button>
          <button className="primary-action" onClick={() => setEditor(null)}>
            <Plus /> Nova rifa
          </button>
        </div>
      </header>
      <div className="commerce-master-detail">
        <aside className="commerce-directory">
          <div className="commerce-directory-heading">
            <b>Suas rifas</b>
            <span>{items.length}</span>
          </div>
          {items.length ? (
            items.map((item) => (
              <button
                className={selectedId === text(item.id) ? "selected" : ""}
                key={text(item.id)}
                onClick={() => setSelectedId(text(item.id))}
              >
                <span className="commerce-item-icon">
                  <Ticket />
                </span>
                <span>
                  <b>{text(item.title, "Rifa")}</b>
                  <small>
                    {Number(item.soldCount || 0)}/
                    {Number(item.numbersTotal || 0)} vendidos ·{" "}
                    {money(item.price)}
                  </small>
                </span>
                <em className={text(item.status)}>
                  {text(item.status, "draft")}
                </em>
              </button>
            ))
          ) : (
            <div className="module-state">
              <Ticket />
              <b>Nenhuma rifa criada</b>
              <p>Use “Nova rifa” para começar.</p>
            </div>
          )}
        </aside>
        <section className="commerce-detail">
          {detail ? (
            <>
              <header className="commerce-detail-header">
                <button
                  className="commerce-mobile-back"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft />
                </button>
                <span className="commerce-item-icon">
                  <Ticket />
                </span>
                <div>
                  <h2>{text(detail.title, "Rifa")}</h2>
                  <p>{text(detail.description, "Sem descrição")}</p>
                </div>
                <span className={`state-pill ${status}`}>{status}</span>
                <button
                  className="icon-button"
                  onClick={() => setEditor(detail)}
                  title="Editar rifa"
                >
                  <Settings />
                </button>
              </header>
              <Notice
                error={error}
                notice={notice}
                onClose={() => {
                  setError("");
                  setNotice("");
                }}
              />
              <div className="commerce-detail-scroll">
                <div className="commerce-metrics">
                  <article>
                    <small>Arrecadação</small>
                    <strong>
                      {money(
                        Number(detail.soldCount || 0) *
                          Number(detail.price || 0),
                      )}
                    </strong>
                  </article>
                  <article>
                    <small>Números vendidos</small>
                    <strong>
                      {Number(detail.soldCount || 0)}/
                      {Number(detail.numbersTotal || 0)}
                    </strong>
                  </article>
                  <article>
                    <small>Reservados</small>
                    <strong>{Number(detail.reservedCount || 0)}</strong>
                  </article>
                  <article>
                    <small>Ganhadores</small>
                    <strong>{Number(detail.winnersCount || 1)}</strong>
                  </article>
                </div>
                <section className="settings-card commerce-actions-card">
                  <h3>Gerenciar rifa</h3>
                  <div className="commerce-actions">
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api.updateRaffleStatus(
                              text(detail.id),
                              ["active", "selling"].includes(status)
                                ? "draft"
                                : "active",
                            ),
                          ["active", "selling"].includes(status)
                            ? "Rifa pausada."
                            : "Rifa ativada.",
                        )
                      }
                    >
                      {["active", "selling"].includes(status)
                        ? "Pausar vendas"
                        : "Ativar vendas"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || !Number(detail.soldCount || 0)}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Sortear agora e anunciar o resultado nos grupos vinculados?",
                          )
                        )
                          void run(
                            () => api.drawRaffle(text(detail.id), true),
                            "Sorteio realizado e resultado anunciado.",
                          );
                      }}
                    >
                      <Trophy /> Sortear e anunciar
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || !Number(detail.reservedCount || 0)}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Liberar todas as reservas pendentes desta rifa?",
                          )
                        )
                          void run(
                            () =>
                              api.releaseRaffleReservations(text(detail.id)),
                            "Reservas liberadas.",
                          );
                      }}
                    >
                      Liberar reservas
                    </button>
                    <button
                      className="secondary-button danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm("Excluir esta rifa definitivamente?")
                        ) {
                          setSelectedId(null);
                          setDetail(null);
                          void run(
                            () => api.deleteRaffle(text(detail.id)),
                            "Rifa excluída.",
                            false,
                            false,
                          );
                        }
                      }}
                    >
                      <Trash2 /> Excluir
                    </button>
                  </div>
                </section>
                <section className="settings-card raffle-detail-card">
                  <h3>Configuração</h3>
                  <div className="commerce-field-list">
                    <span>
                      <small>Valor por número</small>
                      <b>{money(detail.price)}</b>
                    </span>
                    <span>
                      <small>Grupos vinculados</small>
                      <b>{listOf(detail, ["groups"]).length || "Nenhum"}</b>
                    </span>
                    <span>
                      <small>Criada em</small>
                      <b>{date(detail.createdAt)}</b>
                    </span>
                    <span>
                      <small>Última atualização</small>
                      <b>{date(detail.updatedAt)}</b>
                    </span>
                  </div>
                </section>
                {listOf(detail, ["winners"]).length > 0 && (
                  <section className="settings-card raffle-winners">
                    <h3>Ganhadores</h3>
                    {listOf(detail, ["winners"]).map((winner, index) => (
                      <div key={text(winner.id, String(index))}>
                        <Trophy />
                        <span>
                          <b>
                            {text(
                              winner.customerName || winner.name,
                              "Ganhador",
                            )}
                          </b>
                          <small>Número {text(winner.number, "—")}</small>
                        </span>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            </>
          ) : (
            <div className="module-state">
              <Ticket />
              <b>Selecione uma rifa</b>
              <p>Os detalhes e ações aparecerão aqui.</p>
            </div>
          )}
          {loading && (
            <div className="commerce-loading">
              <RefreshCw className="spin" /> Atualizando…
            </div>
          )}
        </section>
      </div>
      {editor !== undefined && (
        <RaffleEditor
          item={editor}
          groups={groups}
          busy={busy}
          onClose={() => setEditor(undefined)}
          onSave={(draft) => void save(draft)}
        />
      )}
      {paymentOpen && (
        <PaymentSettingsModal
          current={payment}
          busy={busy}
          onClose={() => setPaymentOpen(false)}
          onSave={(payload) =>
            void run(
              () => api.saveRafflePaymentSettings(payload),
              "Credenciais de pagamento atualizadas.",
            ).then((ok) => {
              if (ok) setPaymentOpen(false);
            })
          }
        />
      )}
    </main>
  );
}

const AFFILIATE_PLATFORMS = [
  { id: "shopee", label: "Shopee", shortLabel: "Shopee" },
  {
    id: "mercadolivre",
    label: "Mercado Livre",
    shortLabel: "Mercado Livre",
  },
] as const;
type AffiliateProvider = (typeof AFFILIATE_PLATFORMS)[number]["id"];
const affiliateProviderLabel = (provider: string) =>
  AFFILIATE_PLATFORMS.find((item) => item.id === provider)?.label || provider;

function AffiliateInfo({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`affiliate-info ${open ? "open" : ""}`}>
      <button
        type="button"
        aria-label={`Informação: ${hint}`}
        title={hint}
        onClick={() => setOpen((value) => !value)}
      >
        <Info />
      </button>
      <span className="affiliate-info-popover" role="tooltip">{hint}</span>
    </span>
  );
}

function AffiliateFieldLabel({ label, hint }: { label: string; hint: string }) {
  return <span className="affiliate-field-label">{label}<AffiliateInfo hint={hint} /></span>;
}
function AffiliateProviderModal({
  current,
  busy,
  onClose,
  onSave,
}: {
  current?: JsonRecord | null;
  busy: boolean;
  onClose: () => void;
  onSave: (provider: AffiliateProvider, payload: JsonRecord) => void;
}) {
  const [provider, setProvider] = useState<AffiliateProvider>(
    text(current?.provider, "shopee") === "mercadolivre"
      ? "mercadolivre"
      : "shopee",
  );
  const [accountName, setAccountName] = useState(text(current?.accountName));
  const [appId, setAppId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [appToken, setAppToken] = useState("");
  const existingConnectionId = Number(
    current?.selectedConnectionId ||
      current?.id ||
      (listOf(current, ["accounts", "connections"]).find((item) =>
        Boolean(item.selected),
      )?.id || 0),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="quick-modal affiliate-editor-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>
                {current ? "Editar conta afiliada" : "Conectar conta afiliada"}
              </h2>
              <InfoTip label="Conta afiliada">
                Conecte a conta da plataforma para gerar links e acompanhar produtos automaticamente.
              </InfoTip>
            </div>
            <small>
              Credenciais ficam protegidas e não são exibidas novamente.
            </small>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="quick-form">
          <label>
            Plataforma
            <select
              disabled={Boolean(current)}
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value as AffiliateProvider)
              }
            >
              <option value="shopee">Shopee</option>
              <option value="mercadolivre">Mercado Livre</option>
            </select>
          </label>
          <label>
            Nome da conta
            <input
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder="Ex.: Conta principal"
            />
          </label>
          <label>
            App ID
            <input
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              placeholder={current ? "Deixe vazio para manter" : "App ID"}
            />
          </label>
          <label>
            Client Secret
            <input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={
                current ? "Deixe vazio para manter" : "Client Secret"
              }
            />
          </label>
          <label>
            App Token
            <input
              type="password"
              value={appToken}
              onChange={(event) => setAppToken(event.target.value)}
              placeholder="Opcional"
            />
          </label>
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={
              busy ||
              !accountName.trim() ||
              (Boolean(current) &&
                existingConnectionId <= 0 &&
                (!appId.trim() || !clientSecret.trim()))
            }
            onClick={() =>
              onSave(provider, {
                action: "save_credentials",
                accountName: accountName.trim(),
                ...(appId.trim() ? { appId: appId.trim() } : {}),
                ...(clientSecret.trim()
                  ? { clientSecret: clientSecret.trim() }
                  : {}),
                ...(appToken.trim() ? { appToken: appToken.trim() } : {}),
                ...(existingConnectionId > 0
                  ? { connectionId: existingConnectionId }
                  : {}),
                select: true,
              })
            }
          >
            {busy ? "Salvando…" : "Salvar conta"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AffiliateLinkModal({
  current,
  busy,
  onClose,
  onSave,
}: {
  current?: (JsonRecord & { _provider?: AffiliateProvider }) | null;
  busy: boolean;
  onClose: () => void;
  onSave: (provider: AffiliateProvider, payload: JsonRecord) => void;
}) {
  const [provider, setProvider] = useState<AffiliateProvider>(
    current?._provider || "shopee",
  );
  const [url, setUrl] = useState(text(current?.affiliateUrl || current?.url));
  const [note, setNote] = useState(text(current?.note));
  const [title, setTitle] = useState(text(current?.title));
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="quick-modal affiliate-editor-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>
                {current ? "Editar produto afiliado" : "Novo produto afiliado"}
              </h2>
              <InfoTip label="Produto afiliado">
                Salve o link completo, imagem e dados que serão usados nas mensagens de divulgação.
              </InfoTip>
            </div>
            <small>
              Salve o link completo para usar nas divulgações automáticas.
            </small>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="quick-form">
          <label>
            Plataforma
            <select
              disabled={Boolean(current)}
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value as AffiliateProvider)
              }
            >
              <option value="shopee">Shopee</option>
              <option value="mercadolivre">Mercado Livre</option>
            </select>
          </label>
          <label>
            Link afiliado
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
          {current && (
            <label>
              Título
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          )}
          <label>
            Observação
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={busy || !url.trim()}
            onClick={() =>
              onSave(provider, {
                affiliateUrl: url.trim(),
                note: note.trim(),
                ...(current ? { title: title.trim() } : {}),
              })
            }
          >
            {busy
              ? "Salvando…"
              : current
                ? "Salvar alterações"
                : "Adicionar produto"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function affiliateProductKey(item: JsonRecord, index = 0) {
  return text(item.itemId || item.id || item.productId, String(index));
}

function affiliateProductImage(item?: JsonRecord | null) {
  return text(
    item?.imageUrl || item?.thumbnail || item?.image || item?.pictureUrl,
  );
}

function affiliateProductUrl(item?: JsonRecord | null) {
  return text(
    item?.affiliateUrl ||
      item?.productUrl ||
      item?.permalink ||
      item?.url,
  );
}

function AffiliateProductDiscoveryModal({
  provider,
  busy,
  onClose,
  onImport,
}: {
  provider: AffiliateProvider;
  busy: boolean;
  onClose: () => void;
  onImport: (items: JsonRecord[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"standard" | "promotions" | "aggressive">(
    "promotions",
  );
  const [results, setResults] = useState<JsonRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const search = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError("");
    setWarning("");
    try {
      const result = await api.searchAffiliateProducts(provider, {
        query: query.trim(),
        limit: 60,
        mode,
        autoAffiliate: true,
      });
      const products = listOf(result, ["products", "items"]);
      setResults(products);
      setSelected(
        new Set(
          products
            .filter((item) => Boolean(affiliateProductUrl(item)))
            .map((item, index) => affiliateProductKey(item, index)),
        ),
      );
      setWarning(text(result.warning));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível buscar os produtos.",
      );
    } finally {
      setLoading(false);
    }
  };
  const importItems = results
    .filter((item, index) => selected.has(affiliateProductKey(item, index)))
    .map((item, index) => ({
      itemId: affiliateProductKey(item, index),
      affiliateUrl: affiliateProductUrl(item),
      title: text(item.title),
      productUrl: text(item.productUrl || item.permalink || item.url),
      imageUrl: affiliateProductImage(item),
      categoryId: text(item.categoryId),
      priceAmount: Number(item.priceAmount || item.price || 0) || null,
      priceFormatted: text(item.priceFormatted),
      currencyId: text(item.currencyId),
      commissionRate: text(item.commissionRate),
      ratingStar: text(item.ratingStar),
      available: item.available !== false,
    }));
  return (
    <div className="modal-backdrop">
      <section className="quick-modal affiliate-discovery-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Buscar produtos · {affiliateProviderLabel(provider)}</h2>
              <InfoTip label="Buscar produtos">
                Pesquise na plataforma selecionada, marque os itens desejados e importe apenas sua seleção.
              </InfoTip>
            </div>
            <small>
              O sistema gera o link afiliado e importa somente os itens
              selecionados.
            </small>
          </div>
          <button onClick={onClose} disabled={busy}>
            <X />
          </button>
        </header>
        <div className="affiliate-discovery-controls">
          <label>
            Produto, nicho ou categoria
            <span>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search();
                }}
                placeholder="Ex.: eletrônicos em promoção"
              />
              <button
                className="primary-button"
                onClick={() => void search()}
                disabled={loading || !query.trim()}
              >
                <Search /> {loading ? "Buscando…" : "Buscar"}
              </button>
            </span>
          </label>
          <label>
            Estratégia
            <select
              value={mode}
              onChange={(event) =>
                setMode(
                  event.target.value as
                    | "standard"
                    | "promotions"
                    | "aggressive",
                )
              }
            >
              <option value="standard">Busca direta</option>
              <option value="promotions">Priorizar promoções</option>
              <option value="aggressive">Garimpo amplo</option>
            </select>
          </label>
        </div>
        {error && <div className="module-error">{error}</div>}
        {warning && <div className="inline-notice">{warning}</div>}
        <div className="affiliate-discovery-list">
          {results.map((item, index) => {
            const key = affiliateProductKey(item, index);
            const checked = selected.has(key);
            return (
              <label key={key} className={checked ? "selected" : ""}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                />
                <span className="affiliate-discovery-image">
                  {affiliateProductImage(item) ? (
                    <img
                      src={absoluteMediaUrl(affiliateProductImage(item))}
                      alt=""
                    />
                  ) : (
                    <ImageIcon />
                  )}
                </span>
                <span>
                  <b>{text(item.title, "Produto encontrado")}</b>
                  <small>
                    {text(
                      item.priceFormatted,
                      item.price ? money(item.price) : "Preço não informado",
                    )}
                  </small>
                  <small>
                    {affiliateProductUrl(item)
                      ? "Link afiliado pronto"
                      : "Sem link afiliado válido"}
                  </small>
                </span>
              </label>
            );
          })}
          {!loading && !results.length && (
            <div className="module-state compact">
              <Search />
              <b>Pesquise para selecionar produtos</b>
            </div>
          )}
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          {importItems.length > 0 && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => onImport(importItems)}
            >
              <Plus /> Importar {importItems.length} produto(s)
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

const previewTokens = (product: JsonRecord | null, provider: AffiliateProvider) => ({
  titulo: text(product?.title, "Produto em destaque"),
  descricao: text(product?.description || product?.note, "Oferta selecionada para você"),
  preco_formatado: text(product?.priceFormatted, "R$ 99,90"),
  preco_antigo_formatado: text(product?.oldPriceFormatted, "R$ 129,90"),
  preco_parcelado: text(product?.installmentsFormatted, "em até 10x"),
  avaliacao: text(product?.ratingStar, "4,8"),
  vendidos: text(product?.soldQuantity, "100+"),
  estoque: text(product?.availableQuantity, "disponível"),
  frete: text(product?.shippingText, "Frete grátis"),
  garantia: text(product?.warrantyText, "Compra protegida"),
  condicao: text(product?.condition, "Novo"),
  cupom: text(product?.coupon, "Consulte no link"),
  cupom_detalhes: text(product?.couponDetails),
  plataforma: affiliateProviderLabel(provider),
});

function renderAffiliatePreviewText(
  template: JsonRecord,
  product: JsonRecord | null,
  provider: AffiliateProvider,
) {
  const tokens = previewTokens(product, provider);
  return listOf(template, ["items"])
    .filter((item) => item.enabled !== false && text(item.text).trim())
    .map((item) => text(item.text))
    .join("\n")
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) =>
      text(tokens[key as keyof typeof tokens]),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function AffiliateMessageTemplateModal({
  provider,
  current,
  sample,
  busy,
  onClose,
  onSave,
}: {
  provider: AffiliateProvider;
  current: JsonRecord;
  sample: JsonRecord | null;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: JsonRecord) => void;
}) {
  const [items, setItems] = useState<JsonRecord[]>(() => {
    const stored = listOf(current, ["items"]).map((item) => ({ ...item }));
    return stored.length
      ? stored
      : [
          { key: "title", label: "Título", hint: "Nome do produto", text: "🛍️ {{titulo}}", enabled: true },
          { key: "price", label: "Preço", hint: "Preço e condição", text: "💰 {{preco_formatado}} · {{condicao}}", enabled: true },
          { key: "shipping", label: "Benefício", hint: "Frete, avaliação ou cupom", text: "⭐ {{avaliacao}} · {{frete}}", enabled: true },
          { key: "link", label: "Chamada", hint: "Orientação para abrir a oferta", text: "Confira a oferta no botão abaixo.", enabled: true },
        ];
  });
  const [buttonLabel, setButtonLabel] = useState(
    text(current.buttonLabel, "Acessar oferta"),
  );
  const [footerText, setFooterText] = useState(
    text(current.footerText, "Oferta automática de afiliado"),
  );
  const [providerTitle, setProviderTitle] = useState(
    text(current.providerTitle, affiliateProviderLabel(provider)),
  );
  const [preview, setPreview] = useState(true);
  const previewSample = sample || {
    title: "Produto em destaque",
    description: "Oferta selecionada para você",
    priceFormatted: "R$ 99,90",
    affiliateUrl: "https://mercadolivre.com.br/oferta",
  };
  const draft = useMemo(
    () => ({ items, buttonLabel, footerText, providerTitle }),
    [items, buttonLabel, footerText, providerTitle],
  );
  return (
    <div className="modal-backdrop">
      <section className="quick-modal affiliate-template-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Mensagem · {affiliateProviderLabel(provider)}</h2>
              <InfoTip label="Mensagem de afiliado">
                Personalize o texto, rodapé e botão. A prévia mostra exatamente o formato da divulgação.
              </InfoTip>
            </div>
          </div>
          <button onClick={onClose} disabled={busy}>
            <X />
          </button>
        </header>
        <div className="affiliate-template-body">
          <div className="affiliate-template-editor">
            <div className="affiliate-template-fields">
              <label>
                Identificação da plataforma
                <input
                  value={providerTitle}
                  onChange={(event) => setProviderTitle(event.target.value)}
                />
              </label>
              <label>
                Texto do botão
                <input
                  value={buttonLabel}
                  onChange={(event) => setButtonLabel(event.target.value)}
                />
              </label>
              <label className="wide">
                Rodapé pequeno
                <input
                  value={footerText}
                  onChange={(event) => setFooterText(event.target.value)}
                />
              </label>
            </div>
            <div className="affiliate-template-items">
              {items.map((item, index) => (
                <article key={text(item.key, String(index))}>
                  <label className="toggle-line">
                    <input
                      type="checkbox"
                      checked={item.enabled !== false}
                      onChange={(event) =>
                        setItems((currentItems) =>
                          currentItems.map((currentItem, itemIndex) =>
                            itemIndex === index
                              ? { ...currentItem, enabled: event.target.checked }
                              : currentItem,
                          ),
                        )
                      }
                    />
                    <span>
                      <b>{text(item.label, "Trecho")}</b>
                      <small>{text(item.hint)}</small>
                    </span>
                  </label>
                  <textarea
                    rows={3}
                    value={text(item.text)}
                    disabled={item.enabled === false}
                    onChange={(event) =>
                      setItems((currentItems) =>
                        currentItems.map((currentItem, itemIndex) =>
                          itemIndex === index
                            ? { ...currentItem, text: event.target.value }
                            : currentItem,
                        ),
                      )
                    }
                  />
                </article>
              ))}
            </div>
          </div>
          {preview && (
            <aside className="affiliate-native-preview">
              <span>Prévia no WhatsApp</span>
              <article>
                <div className="affiliate-native-media">
                  {affiliateProductImage(previewSample) ? (
                    <img
                      src={absoluteMediaUrl(affiliateProductImage(previewSample))}
                      alt="Prévia do produto"
                    />
                  ) : (
                    <ImageIcon />
                  )}
                </div>
                <b>{providerTitle || affiliateProviderLabel(provider)}</b>
                <p>
                  {renderAffiliatePreviewText(draft, previewSample, provider) ||
                    "Ative ao menos um trecho da mensagem."}
                </p>
                <small>{footerText}</small>
                <button>
                  <ExternalLink /> {buttonLabel || "Acessar oferta"}
                </button>
              </article>
            </aside>
          )}
        </div>
        <footer>
          <button
            className="secondary-button affiliate-preview-button"
            onClick={() => setPreview((value) => !value)}
          >
            <Eye /> {preview ? "Ocultar prévia" : "Visualizar prévia"}
          </button>
          <span />
          <button className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={busy || !items.some((item) => item.enabled !== false)}
            onClick={() => onSave(draft)}
          >
            <CheckSquare /> {busy ? "Salvando…" : "Salvar mensagem"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AffiliateDispatchRow({
  provider,
  item,
  busy,
  onUpdate,
  onDelete,
}: {
  provider: AffiliateProvider;
  item: JsonRecord;
  busy: boolean;
  onUpdate: (payload: JsonRecord) => void;
  onDelete: () => void;
}) {
  const [delay, setDelay] = useState(text(item.delayMinutes, "30"));
  useEffect(() => setDelay(text(item.delayMinutes, "30")), [item.delayMinutes]);
  return (
    <article className="affiliate-dispatch-row">
      <div>
        <b>{text(item.groupName, `Grupo ${text(item.groupId)}`)}</b>
        <small>
          {affiliateProviderLabel(provider)} · último envio {date(item.lastSentAt)}
        </small>
        {Boolean(item.lastError) && (
          <small className="commerce-danger">{text(item.lastError)}</small>
        )}
      </div>
      <label>
        Intervalo base
        <span>
          <input
            type="number"
            min={1}
            max={1440}
            value={delay}
            onChange={(event) => setDelay(event.target.value)}
          />
          min
        </span>
      </label>
      <label className="toggle-line compact">
        <input
          type="checkbox"
          checked={item.categoryRotationEnabled !== false}
          disabled={busy}
          onChange={(event) =>
            onUpdate({ categoryRotationEnabled: event.target.checked })
          }
        />
        <span>Alternar categorias</span>
      </label>
      <label className="toggle-line compact">
        <input
          type="checkbox"
          checked={item.enabled !== false}
          disabled={busy}
          onChange={(event) => onUpdate({ enabled: event.target.checked })}
        />
        <span>Envio ativo</span>
      </label>
      <button
        className="secondary-button"
        disabled={busy || Number(delay) === Number(item.delayMinutes)}
        onClick={() => onUpdate({ delayMinutes: Number(delay) })}
      >
        <CheckSquare /> Aplicar
      </button>
      <button className="icon-danger" disabled={busy} onClick={onDelete}>
        <Trash2 />
      </button>
    </article>
  );
}

const AFFILIATE_CATEGORY_PRESETS = [
  { key: "eletronicos", label: "Eletrônicos", hint: "Celulares, notebooks, TVs e acessórios." },
  { key: "eletrodomesticos", label: "Eletrodomésticos", hint: "Cozinha, limpeza e utilidades elétricas." },
  { key: "games", label: "Games", hint: "Consoles, jogos e acessórios gamer." },
  { key: "moda", label: "Moda", hint: "Roupas, calçados e acessórios." },
  { key: "beleza", label: "Beleza", hint: "Perfumes, maquiagem e skincare." },
  { key: "saude", label: "Saúde", hint: "Suplementos e cuidados pessoais." },
  { key: "casa", label: "Casa e decoração", hint: "Organização, móveis e decoração." },
  { key: "ferramentas", label: "Ferramentas", hint: "Ferramentas elétricas e manuais." },
  { key: "automotivo", label: "Automotivo", hint: "Acessórios e equipamentos para carros." },
  { key: "bebes", label: "Bebês", hint: "Cuidados, brinquedos e acessórios infantis." },
  { key: "pet", label: "Pet", hint: "Ração, brinquedos e cuidados para pets." },
  { key: "smart_home", label: "Smart home", hint: "Câmeras, lâmpadas e casa inteligente." },
] as const;

function AffiliateCredentialsPanel({
  provider,
  account,
  resolver,
  busy,
  onEditAccount,
  onSaveResolver,
  onResolverAction,
}: {
  provider: AffiliateProvider;
  account: JsonRecord;
  resolver: JsonRecord;
  busy: boolean;
  onEditAccount: () => void;
  onSaveResolver: (payload: JsonRecord) => void;
  onResolverAction: (payload: JsonRecord, success: string) => void;
}) {
  const [cookie, setCookie] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [tag, setTag] = useState("");
  const [sampleUrl, setSampleUrl] = useState("");
  useEffect(() => {
    setCookie("");
    setCsrfToken("");
    setTag(text(resolver.tag));
    setSampleUrl(text(resolver.sampleUrl));
  }, [resolver]);
  const connected = Boolean(
    account.connected || account.isConfigured || listOf(account, ["accounts", "connections"]).length,
  );
  return (
    <section className="settings-card affiliate-credentials-card">
      <div className="settings-card-heading">
        <div>
          <h3>Conta e credenciais · {affiliateProviderLabel(provider)} <AffiliateInfo hint="Cada plataforma usa os próprios dados. Valores secretos ficam protegidos e não são exibidos novamente." /></h3>
        </div>
        <span className={`state-pill ${connected ? "active" : "inactive"}`}>
          {connected ? "Conta conectada" : "Configuração pendente"}
        </span>
      </div>
      <div className="affiliate-credential-summary">
        <div>
          <b>{text(account.accountName, connected ? "Conta selecionada" : "Nenhuma conta selecionada")}</b>
          <small>
            {connected
              ? "A conta selecionada será usada na criação e atualização dos links."
              : "Conecte uma conta para liberar a busca automática."}
          </small>
        </div>
        <button className="secondary-button" onClick={onEditAccount} disabled={busy}>
          <Settings /> {connected ? "Editar credenciais" : "Conectar conta"}
        </button>
      </div>
      {provider === "mercadolivre" && (
        <div className="affiliate-ml-resolver">
          <div className="affiliate-subsection-heading">
            <div>
              <b>Cookies do Mercado Livre <AffiliateInfo hint="Opcional: permite resolver links e atualizar ofertas com a sessão escolhida." /></b>
            </div>
            <span className={`state-pill ${resolver.enabled ? "active" : "inactive"}`}>
              {resolver.enabled ? "Resolvedor ativo" : "Resolvedor pausado"}
            </span>
          </div>
          <label>
            <AffiliateFieldLabel label="Cookie da sessão" hint="Cole o cookie completo da sessão do Mercado Livre. Ele fica armazenado de forma protegida." />
            <textarea
              rows={2}
              value={cookie}
              onChange={(event) => setCookie(event.target.value)}
              placeholder={resolver.hasCookie ? "Cookie salvo (preencha somente para substituir)" : "Cole aqui o cookie completo da sessão"}
              autoComplete="off"
            />
          </label>
          <div className="commerce-form-grid affiliate-resolver-grid">
            <label>
              <AffiliateFieldLabel label="Token CSRF (opcional)" hint="Algumas sessões exigem o token CSRF; deixe vazio quando não for necessário." />
              <input value={csrfToken} onChange={(event) => setCsrfToken(event.target.value)} placeholder="Deixe vazio se não usar" />
            </label>
            <label>
              <AffiliateFieldLabel label="Tag afiliada" hint="Tag usada para gerar seus links de afiliado." />
              <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Sua tag do Mercado Livre" />
            </label>
            <label className="wide">
              <AffiliateFieldLabel label="URL para validar (opcional)" hint="Cole uma URL de produto para testar se o cookie consegue resolver a oferta." />
              <input value={sampleUrl} onChange={(event) => setSampleUrl(event.target.value)} placeholder="https://mercadolivre.com.br/..." />
            </label>
          </div>
          <div className="affiliate-resolver-actions">
            <button
              className="primary-button"
              disabled={busy || !cookie.trim()}
              onClick={() => onSaveResolver({ action: "save", cookie: cookie.trim(), csrfToken: csrfToken.trim() || null, tag: tag.trim() || null, sampleUrl: sampleUrl.trim() || null })}
            >
              <CheckSquare /> Salvar cookie
            </button>
            <button
              className="secondary-button"
              disabled={busy || !resolver.hasCookie}
              onClick={() => onResolverAction({ action: "validate", sampleUrl: sampleUrl.trim() || null }, "Cookie validado.")}
            >
              <Eye /> Validar
            </button>
            <button
              className="secondary-button"
              disabled={busy || !resolver.hasCookie}
              onClick={() => onResolverAction({ action: "set_enabled", enabled: !resolver.enabled }, resolver.enabled ? "Resolvedor pausado." : "Resolvedor ativado.")}
            >
              {resolver.enabled ? "Pausar resolvedor" : "Ativar resolvedor"}
            </button>
            <button
              className="text-danger-button"
              disabled={busy || !resolver.hasCookie}
              onClick={() => {
                if (window.confirm("Remover o cookie salvo do Mercado Livre?")) onResolverAction({ action: "clear" }, "Cookie removido.");
              }}
            >
              <Trash2 /> Remover
            </button>
          </div>
          <small className="affiliate-resolver-status">
            {text(resolver.lastValidatedAt ? `Última validação: ${date(resolver.lastValidatedAt)}` : resolver.message, resolver.hasCookie ? "Cookie salvo de forma protegida." : "Nenhum cookie salvo.")}
          </small>
        </div>
      )}
      {provider === "shopee" && (
        <div className="affiliate-provider-hint">
          <Info /> <span>App ID, Client Secret e App Token ficam em “Editar credenciais”.</span>
        </div>
      )}
    </section>
  );
}

function AffiliateCategorySelector({
  provider,
  value,
  onChange,
}: {
  provider: AffiliateProvider;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const selected = new Set(value);
  const knownCategoryKeys = new Set<string>(AFFILIATE_CATEGORY_PRESETS.map((item) => item.key));
  const allSelected = AFFILIATE_CATEGORY_PRESETS.every((item) => selected.has(item.key));
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(AFFILIATE_CATEGORY_PRESETS.map((item) => item.key).filter((key) => next.has(key)));
  };
  return (
    <div className="affiliate-category-selector">
      <div className="affiliate-subsection-heading">
        <div>
          <b>Categorias para busca automática <AffiliateInfo hint={`Selecione categorias reais. ${provider === "mercadolivre" ? "O Mercado Livre usa a categoria para refinar a busca." : "A Shopee combina a categoria com a busca de tendências."}`} /></b>
        </div>
        <div className="affiliate-category-actions">
          <button type="button" onClick={() => onChange(AFFILIATE_CATEGORY_PRESETS.map((item) => item.key))}>
            {allSelected ? "Todas selecionadas" : "Selecionar todas"}
          </button>
          <button type="button" onClick={() => onChange([])} disabled={!value.length}>Limpar</button>
        </div>
      </div>
      <label className="affiliate-category-select-label">
        <span>Adicionar categoria</span>
        <select
          aria-label="Adicionar categoria"
          value=""
          onChange={(event) => {
            const key = event.target.value;
            if (!key || selected.has(key)) return;
            onChange([...value.filter((item) => knownCategoryKeys.has(item)), key]);
          }}
        >
          <option value="">Selecione uma categoria…</option>
          {AFFILIATE_CATEGORY_PRESETS.filter((item) => !selected.has(item.key)).map((item) => (
            <option key={item.key} value={item.key}>{item.label}</option>
          ))}
        </select>
      </label>
      <div className="affiliate-category-grid" role="group" aria-label={`Categorias da ${affiliateProviderLabel(provider)}`}>
        {AFFILIATE_CATEGORY_PRESETS.map((item) => (
          <button
            type="button"
            key={item.key}
            aria-pressed={selected.has(item.key)}
            className={selected.has(item.key) ? "selected" : ""}
            onClick={() => toggle(item.key)}
          >
            <span className="affiliate-category-check">{selected.has(item.key) ? "✓" : ""}</span>
            <span><b>{item.label}</b><small>{item.hint}</small></span>
          </button>
        ))}
      </div>
      {!value.length && <small className="affiliate-category-empty">Sem categorias: o sistema usará tendências gerais.</small>}
    </div>
  );
}

function AffiliateAutomationPanel({
  provider,
  config,
  busy,
  onSaveConfig,
}: {
  provider: AffiliateProvider;
  config: JsonRecord;
  busy: boolean;
  onSaveConfig: (payload: JsonRecord) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [refreshExisting, setRefreshExisting] = useState(true);
  const [discoverNew, setDiscoverNew] = useState(true);
  const [limit, setLimit] = useState("50");
  const [interval, setInterval] = useState("45");
  const [terms, setTerms] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    setEnabled(config.enabled === true);
    setRefreshExisting(config.refreshExisting !== false);
    setDiscoverNew(config.discoverNew !== false);
    setLimit(text(config.targetImportLimit, "50"));
    setInterval(text(config.intervalMinutes, "45"));
    setTerms(
      Array.isArray(config.discoveryTerms)
        ? config.discoveryTerms.map(String).join("\n")
        : text(config.discoveryTerms),
    );
    setCategories(
      Array.isArray(config.discoveryCategories)
        ? config.discoveryCategories.map(String)
        : text(config.discoveryCategories)
            .split(/[\s,]+/)
            .map((item) => item.trim())
            .filter(Boolean),
    );
  }, [config]);
  return (
    <div className="affiliate-automation-layout affiliate-products-automation">
      <section className="settings-card affiliate-auto-card">
        <div className="settings-card-heading">
          <div>
            <h3>Busca e atualização automática <AffiliateInfo hint="Descubra novos produtos e atualize preço, imagem e disponibilidade sem intervenção manual." /></h3>
          </div>
          <label className="toggle-line compact">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>{enabled ? "Ativa" : "Pausada"}</span>
          </label>
        </div>
        <div className="affiliate-auto-options">
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={refreshExisting}
              onChange={(event) => setRefreshExisting(event.target.checked)}
            />
            <span>
              <b>Atualizar cadastrados <AffiliateInfo hint="Atualiza preço, imagem, disponibilidade e link dos produtos já salvos." /></b>
            </span>
          </label>
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={discoverNew}
              onChange={(event) => setDiscoverNew(event.target.checked)}
            />
            <span>
              <b>Buscar produtos novos <AffiliateInfo hint="Importa automaticamente produtos novos até o limite definido." /></b>
            </span>
          </label>
        </div>
        <div className="commerce-form-grid affiliate-auto-fields">
          <label>
            Executar a cada (minutos)
            <input
              type="number"
              min={10}
              max={720}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
          </label>
          <label>
            Limite de produtos
            <input
              type="number"
              min={10}
              max={2000}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
          <label className="wide">
            <AffiliateFieldLabel label="Termos de descoberta" hint="Opcional: adicione um nicho por linha para complementar as categorias selecionadas." />
            <textarea
              rows={4}
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
              placeholder="Um nicho por linha: eletrônicos, beleza, casa…"
            />
          </label>
        </div>
        <AffiliateCategorySelector provider={provider} value={categories} onChange={setCategories} />
        <button
          className="primary-button affiliate-save-auto"
          disabled={busy || (enabled && !refreshExisting && !discoverNew)}
          onClick={() =>
            onSaveConfig({
              enabled,
              refreshExisting,
              discoverNew,
              targetImportLimit: Number(limit),
              intervalMinutes: Number(interval),
              discoveryTerms: terms,
              discoveryCategories: categories,
            })
          }
        >
          <CheckSquare /> Salvar automação
        </button>
      </section>
    </div>
  );
}

function AffiliateDispatchSettingsModal({
  provider,
  dispatches,
  groups,
  sample,
  template,
  busy,
  onProviderChange,
  onCreateDispatch,
  onUpdateDispatch,
  onDeleteDispatch,
  onTemplate,
  onClose,
}: {
  provider: AffiliateProvider;
  dispatches: Partial<Record<AffiliateProvider, JsonRecord[]>>;
  groups: JsonRecord[];
  sample: JsonRecord | null;
  template: JsonRecord;
  busy: boolean;
  onProviderChange: (provider: AffiliateProvider) => void;
  onCreateDispatch: (provider: AffiliateProvider, payload: JsonRecord) => void;
  onUpdateDispatch: (provider: AffiliateProvider, id: string, payload: JsonRecord) => void;
  onDeleteDispatch: (provider: AffiliateProvider, id: string) => void;
  onTemplate: () => void;
  onClose: () => void;
}) {
  const previewText = renderAffiliatePreviewText(template, sample || { title: "Produto de exemplo", price: "R$ 99,90", affiliateUrl: "https://mercadolivre.com.br/oferta" }, provider);
  const [groupId, setGroupId] = useState("");
  const [dispatchDelay, setDispatchDelay] = useState("30");
  const currentDispatches = dispatches[provider] || [];
  const availableGroups = groups.filter((group) => text(group.status, "active") === "active" && !currentDispatches.some((item) => Number(item.groupId) === Number(group.id)));
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="quick-modal affiliate-dispatch-settings-modal">
        <header>
          <div className="modal-heading-line">
            <h2>Configurações de envio</h2>
            <InfoTip label="Configurações de envio">
              Escolha grupos, intervalo e regras de rotação. O sistema varia os envios para evitar padrão robótico.
            </InfoTip>
          </div>
          <button onClick={onClose} disabled={busy}><X /></button>
        </header>
        <div className="affiliate-settings-platforms" role="tablist">
          {AFFILIATE_PLATFORMS.map((item) => <button key={item.id} role="tab" aria-selected={provider === item.id} className={provider === item.id ? "active" : ""} onClick={() => onProviderChange(item.id)}><Tag /> {item.label}</button>)}
        </div>
        <div className="affiliate-dispatch-settings-scroll">
          <div className="affiliate-dispatch-preview-bar">
            <div><b>Prévia da mensagem</b><small>Confira o card antes de ativar qualquer envio.</small></div>
            <button className="secondary-button" onClick={onTemplate}><WandSparkles /> Editar mensagem e prévia</button>
          </div>
          <article className="affiliate-dispatch-preview-card">
            <div className="affiliate-native-media">
              {affiliateProductImage(sample) ? <img src={absoluteMediaUrl(affiliateProductImage(sample))} alt="Prévia do produto" /> : <ImageIcon />}
            </div>
            <div><b>{text(template.providerTitle, affiliateProviderLabel(provider))}</b><p>{previewText || "Configure a mensagem para visualizar aqui."}</p><small>{text(template.footerText, "Oferta automática de afiliado")}</small><button><ExternalLink /> {text(template.buttonLabel, "Acessar oferta")}</button></div>
          </article>
          <section className="settings-card affiliate-dispatch-card">
            <div className="settings-card-heading"><div><h3>Regras de envio por grupo</h3><p className="settings-muted">O intervalo base é variado automaticamente para evitar padrão robótico.</p></div></div>
            <div className="affiliate-new-dispatch">
              <label>Grupo<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Selecione um grupo conectado</option>{availableGroups.map((group) => <option key={text(group.id)} value={text(group.id)}>{text(group.name, `Grupo ${text(group.id)}`)}</option>)}</select></label>
              <label>Intervalo base<span><input type="number" min={1} max={1440} value={dispatchDelay} onChange={(event) => setDispatchDelay(event.target.value)} /> min</span></label>
              <button className="primary-button" disabled={busy || !groupId} onClick={() => onCreateDispatch(provider, { groupId: Number(groupId), delayMinutes: Number(dispatchDelay), enabled: true, categoryRotationEnabled: true })}><Plus /> Ativar grupo</button>
            </div>
            <div className="affiliate-dispatch-list">{currentDispatches.map((item) => <AffiliateDispatchRow key={text(item.id)} provider={provider} item={item} busy={busy} onUpdate={(payload) => onUpdateDispatch(provider, text(item.id), payload)} onDelete={() => onDeleteDispatch(provider, text(item.id))} />)}{!currentDispatches.length && <div className="module-state compact"><Send /><b>Nenhum grupo com envio automático</b><p>Adicione um grupo acima para começar.</p></div>}</div>
          </section>
        </div>
        <footer className="affiliate-settings-footer"><span /><button className="primary-button" onClick={onClose}>Concluir</button></footer>
      </section>
    </div>
  );
}

function AffiliateSettingsModal({
  provider,
  configs,
  providers,
  resolver,
  busy,
  onProviderChange,
  onSaveConfig,
  onEditAccount,
  onSaveResolver,
  onResolverAction,
  onClose,
}: {
  provider: AffiliateProvider;
  configs: Partial<Record<AffiliateProvider, JsonRecord>>;
  providers: JsonRecord[];
  resolver: JsonRecord;
  busy: boolean;
  onProviderChange: (provider: AffiliateProvider) => void;
  onSaveConfig: (provider: AffiliateProvider, payload: JsonRecord) => void;
  onEditAccount: () => void;
  onSaveResolver: (payload: JsonRecord) => void;
  onResolverAction: (payload: JsonRecord, success: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="quick-modal affiliate-settings-modal">
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Configurações de produtos</h2>
              <InfoTip label="Configurações de produtos">
                Configure credenciais, categorias e a busca automática da plataforma selecionada.
              </InfoTip>
            </div>
          </div>
          <button onClick={onClose} disabled={busy}>
            <X />
          </button>
        </header>
        <div className="affiliate-settings-platforms" role="tablist">
          {AFFILIATE_PLATFORMS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={provider === item.id}
              className={provider === item.id ? "active" : ""}
              onClick={() => onProviderChange(item.id)}
            >
              <Tag /> {item.label}
            </button>
          ))}
        </div>
        <div className="affiliate-settings-scroll">
          <AffiliateCredentialsPanel provider={provider} account={providers.find((item) => text(item.provider) === provider) || { provider }} resolver={resolver} busy={busy} onEditAccount={onEditAccount} onSaveResolver={onSaveResolver} onResolverAction={onResolverAction} />
          <AffiliateAutomationPanel
            provider={provider}
            config={configs[provider] || {}}
            busy={busy}
            onSaveConfig={(payload) => onSaveConfig(provider, payload)}
          />
        </div>
        <footer className="affiliate-settings-footer">
          <span />
          <button className="primary-button" onClick={onClose}>
            Concluir
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AffiliatesWorkspace() {
  const [tab, setTab] = useState<"products" | "accounts">("products");
  const [provider, setProvider] = useState<AffiliateProvider>("shopee");
  const [providers, setProviders] = useState<JsonRecord[]>([]);
  const [links, setLinks] = useState<
    Array<JsonRecord & { _provider: AffiliateProvider }>
  >([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    new Set(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [configs, setConfigs] = useState<
    Partial<Record<AffiliateProvider, JsonRecord>>
  >({});
  const [dispatches, setDispatches] = useState<
    Partial<Record<AffiliateProvider, JsonRecord[]>>
  >({});
  const [groups, setGroups] = useState<JsonRecord[]>([]);
  const [templates, setTemplates] = useState<
    Partial<Record<AffiliateProvider, JsonRecord>>
  >({});
  const [mlResolver, setMlResolver] = useState<JsonRecord>({});
  const [providerEditor, setProviderEditor] = useState<
    JsonRecord | null | undefined
  >(undefined);
  const [linkEditor, setLinkEditor] = useState<
    (JsonRecord & { _provider: AffiliateProvider }) | null | undefined
  >(undefined);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [providerResult, shopee, mercado, shopeeConfig, mercadoConfig, shopeeDispatches, mercadoDispatches, groupResult, shopeeTemplate, mercadoTemplate, resolverResult] = await Promise.all([
        api.affiliateProviders(),
        api.affiliateLinks("shopee"),
        api.affiliateLinks("mercadolivre"),
        api.affiliateAutoSync("shopee"),
        api.affiliateAutoSync("mercadolivre"),
        api.affiliateGroupDispatches("shopee"),
        api.affiliateGroupDispatches("mercadolivre"),
        api.botGroups(),
        api.affiliateMessageTemplate("shopee"),
        api.affiliateMessageTemplate("mercadolivre"),
        api.affiliateMlResolver().catch(() => ({ resolver: {} })),
      ]);
      setProviders(listOf(providerResult, ["providers"]));
      setLinks([
        ...listOf(shopee, ["links"]).map((item) => ({
          ...item,
          _provider: "shopee" as const,
        })),
        ...listOf(mercado, ["links"]).map((item) => ({
          ...item,
          _provider: "mercadolivre" as const,
        })),
      ]);
      setConfigs({
        shopee: (shopeeConfig.config as JsonRecord) || {},
        mercadolivre: (mercadoConfig.config as JsonRecord) || {},
      });
      setDispatches({
        shopee: listOf(shopeeDispatches, ["dispatches", "items"]),
        mercadolivre: listOf(mercadoDispatches, ["dispatches", "items"]),
      });
      setGroups(listOf(groupResult, ["groups", "items"]));
      setTemplates({
        shopee: (shopeeTemplate.template as JsonRecord) || {},
        mercadolivre: (mercadoTemplate.template as JsonRecord) || {},
      });
      setMlResolver((resolverResult.resolver as JsonRecord) || {});
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os afiliados.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(success);
      setProviderEditor(undefined);
      setLinkEditor(undefined);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível concluir.",
      );
    } finally {
      setBusy(false);
    }
  };
  const providerLinks = links.filter((item) => item._provider === provider);
  const filtered = providerLinks.filter((item) =>
    `${text(item.title)} ${text(item.note)} ${text(item.affiliateUrl)} ${item._provider}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const selectedVisible = filtered.filter((item, index) =>
    selectedProducts.has(
      `${item._provider}:${affiliateProductKey(item, index)}`,
    ),
  );
  const allVisibleSelected =
    filtered.length > 0 && selectedVisible.length === filtered.length;
  const toggleProduct = (item: JsonRecord & { _provider: AffiliateProvider }, index: number) => {
    const key = `${item._provider}:${affiliateProductKey(item, index)}`;
    setSelectedProducts((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelectedProducts((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        filtered.forEach((item, index) =>
          next.delete(`${item._provider}:${affiliateProductKey(item, index)}`),
        );
      } else {
        filtered.forEach((item, index) =>
          next.add(`${item._provider}:${affiliateProductKey(item, index)}`),
        );
      }
      return next;
    });
  };
  const removeSelectedProducts = async () => {
    const byProvider = new Map<AffiliateProvider, string[]>();
    selectedProducts.forEach((key) => {
      const split = key.indexOf(":");
      if (split <= 0) return;
      const currentProvider = key.slice(0, split) as AffiliateProvider;
      const itemId = key.slice(split + 1);
      const list = byProvider.get(currentProvider) || [];
      list.push(itemId);
      byProvider.set(currentProvider, list);
    });
    if (!byProvider.size || !window.confirm("Excluir os produtos selecionados?")) return;
    await run(
      async () => {
        for (const [currentProvider, itemIds] of byProvider)
          await api.deleteAffiliateLinks(currentProvider, itemIds);
        setSelectedProducts(new Set());
      },
      "Produtos selecionados excluídos.",
    );
  };
  const saveAffiliateConfig = (currentProvider: AffiliateProvider, payload: JsonRecord) =>
    void run(
      async () => {
        const result = await api.saveAffiliateAutoSync(currentProvider, payload);
        setConfigs((current) => ({
          ...current,
          [currentProvider]: (result.config as JsonRecord) || payload,
        }));
      },
      `Automação da ${affiliateProviderLabel(currentProvider)} salva.`,
    );
  const saveMlResolver = (payload: JsonRecord) =>
    void run(
      async () => {
        const result = await api.saveAffiliateMlResolver(payload);
        setMlResolver((result.resolver as JsonRecord) || {});
      },
      "Cookie do Mercado Livre salvo.",
    );
  const runMlResolverAction = (payload: JsonRecord, success: string) =>
    void run(
      async () => {
        const result = await api.saveAffiliateMlResolver(payload);
        setMlResolver((result.resolver as JsonRecord) || {});
      },
      success,
    );
  const createAffiliateDispatch = (
    currentProvider: AffiliateProvider,
    payload: JsonRecord,
  ) =>
    void run(
      async () => {
        await api.createAffiliateGroupDispatch(currentProvider, payload);
      },
      `Envio da ${affiliateProviderLabel(currentProvider)} ativado no grupo.`,
    );
  const updateAffiliateDispatch = (
    currentProvider: AffiliateProvider,
    id: string,
    payload: JsonRecord,
  ) =>
    void run(
      async () => {
        await api.updateAffiliateGroupDispatch(currentProvider, id, payload);
      },
      "Regra de envio atualizada.",
    );
  const deleteAffiliateDispatch = (
    currentProvider: AffiliateProvider,
    id: string,
  ) => {
    if (!window.confirm("Remover a regra de envio deste grupo?")) return;
    void run(
      async () => {
        await api.deleteAffiliateGroupDispatch(currentProvider, id);
      },
      "Regra de envio removida.",
    );
  };
  return (
    <main className="module affiliates-workspace">
      <header className="module-header">
        <div className="module-title">
          <span>
            <Tag />
          </span>
          <div>
            <h1>Afiliados</h1>
            <p>Contas, links de produtos e divulgação integrada.</p>
          </div>
        </div>
        <div>
          <button onClick={() => void load()}>
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
          <button
            className="primary-action"
            onClick={() =>
              tab === "products" ? setLinkEditor(null) : setProviderEditor(null)
            }
          >
            <Plus /> {tab === "products" ? "Novo produto" : "Conectar conta"}
          </button>
        </div>
      </header>
      <div className="module-tabs commerce-tabs">
        <button
          className={tab === "products" ? "active" : ""}
          onClick={() => setTab("products")}
        >
          <Tag /> Produtos
        </button>
        <button
          className={tab === "accounts" ? "active" : ""}
          onClick={() => setTab("accounts")}
        >
          <Settings /> Contas conectadas
        </button>
      </div>
      <Notice
        error={error}
        notice={notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
      />
      {tab === "products" ? (
        <>
          <div className="affiliate-platform-toolbar">
            <div className="affiliate-platform-switch" role="tablist" aria-label="Plataforma de produtos">
              {AFFILIATE_PLATFORMS.map((item) => {
                const count = links.filter((link) => link._provider === item.id).length;
                return (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={provider === item.id}
                    className={provider === item.id ? "active" : ""}
                    onClick={() => {
                      setProvider(item.id);
                      setSelectedProducts(new Set());
                    }}
                  >
                    <Tag /> {item.label} <small>{count}</small>
                  </button>
                );
              })}
            </div>
            <label className="commerce-search affiliate-search-field">
              <Search />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Pesquisar em ${affiliateProviderLabel(provider)}`}
              />
              <span>{filtered.length} produto(s)</span>
            </label>
            <div className="affiliate-product-toolbar-actions">
              <button
                className="secondary-button"
                onClick={toggleAllVisible}
                disabled={!filtered.length}
              >
                <CheckSquare /> {allVisibleSelected ? "Limpar seleção" : "Selecionar todos"}
              </button>
              {selectedProducts.size > 0 && (
                <button
                  className="secondary-button danger-text"
                  onClick={() => void removeSelectedProducts()}
                  disabled={busy}
                >
                  <Trash2 /> Excluir ({selectedProducts.size})
                </button>
              )}
              <button
                className="secondary-button"
                onClick={() => setLinkEditor(null)}
              >
                <Plus /> Link manual
              </button>
              <button
                className="primary-button"
                onClick={() => setDiscoveryOpen(true)}
              >
                <Search /> Buscar produtos
              </button>
            </div>
          </div>
          <div className="affiliate-products-heading">
            <div>
              <b>{affiliateProviderLabel(provider)}</b>
              <small>Produtos usados nas divulgações automáticas</small>
            </div>
            <button
              className="secondary-button"
              onClick={() => void run(
                () => api.refreshAffiliateProducts(provider),
                "Produtos sincronizados.",
              )}
              disabled={busy}
            >
              <RefreshCw /> Sincronizar produtos
            </button>
            <button
              className="secondary-button affiliate-settings-shortcut"
              title="Configurar produtos, categorias e credenciais"
              aria-label="Configurar produtos, categorias e credenciais"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings />
            </button>
            <button
              className="secondary-button affiliate-settings-shortcut"
              title="Configurar envios automáticos"
              aria-label="Configurar envios automáticos"
              onClick={() => setDispatchOpen(true)}
            >
              <Send />
            </button>
          </div>
          {filtered.length ? (
            <div className="affiliate-product-grid">
              {filtered.map((item, index) => {
                const itemId = affiliateProductKey(item, index);
                const image = text(item.imageUrl || item.thumbnail);
                const active = item.isActive !== false && item.active !== false;
                const selectionKey = `${item._provider}:${itemId}`;
                const checked = selectedProducts.has(selectionKey);
                return (
                  <article
                    key={`${item._provider}:${itemId}`}
                    className={checked ? "selected" : ""}
                  >
                    <label className="affiliate-product-check" title="Selecionar produto">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProduct(item, index)}
                      />
                    </label>
                    <div className="affiliate-product-image">
                      {image ? (
                        <img src={absoluteMediaUrl(image)} alt="" />
                      ) : (
                        <Tag />
                      )}
                    </div>
                    <div>
                      <span className="provider-pill">
                        {affiliateProviderLabel(item._provider)}
                      </span>
                      <h3>{text(item.title, "Produto afiliado")}</h3>
                      <p>
                        {text(item.note, text(item.affiliateUrl, "Link salvo"))}
                      </p>
                    </div>
                    <span
                      className={`state-pill ${active ? "active" : "inactive"}`}
                    >
                      {active ? "Ativo" : "Pausado"}
                    </span>
                    <div className="affiliate-product-actions">
                      <button
                        title="Abrir link"
                        onClick={() =>
                          window.open(
                            text(item.affiliateUrl || item.productUrl),
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        <ExternalLink />
                      </button>
                      <button
                        title="Editar"
                        onClick={() => setLinkEditor(item)}
                      >
                        <Settings />
                      </button>
                      <button
                        title={active ? "Pausar" : "Ativar"}
                        onClick={() =>
                          void run(
                            () =>
                              api.updateAffiliateLink(item._provider, itemId, {
                                isActive: !active,
                              }),
                            active ? "Produto pausado." : "Produto ativado.",
                          )
                        }
                      >
                        <CheckSquare />
                      </button>
                      <button
                        title="Excluir"
                        onClick={() => {
                          if (window.confirm("Excluir este produto afiliado?"))
                            void run(
                              () =>
                                api.deleteAffiliateLink(item._provider, itemId),
                              "Produto excluído.",
                            );
                        }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="module-state">
              <Tag />
              <b>Nenhum produto afiliado</b>
              <p>Adicione o primeiro link para começar.</p>
            </div>
          )}
        </>
      ) : providers.length ? (
        <div className="affiliate-account-list">
          {providers.map((provider, index) => {
            const key = text(provider.provider, `conta-${index}`);
            const accounts = listOf(provider, ["accounts", "connections"]);
            return (
              <article key={key}>
                <span className="commerce-item-icon">
                  <Tag />
                </span>
                <div>
                  <h3>{text(provider.label || provider.name, key)}</h3>
                  <p>
                    {accounts.length
                      ? `${accounts.length} conta(s) conectada(s)`
                      : text(
                          provider.accountName,
                          "Credenciais ainda não configuradas",
                        )}
                  </p>
                </div>
                <span
                  className={`state-pill ${provider.connected || provider.isConfigured ? "active" : "inactive"}`}
                >
                  {provider.connected || provider.isConfigured
                    ? "Conectada"
                    : "Pendente"}
                </span>
                <button onClick={() => setProviderEditor(provider)}>
                  <Settings /> Editar
                </button>
                <button
                  onClick={() =>
                    void run(
                      () =>
                        api.updateAffiliateProvider(key, { action: "refresh" }),
                      "Credenciais atualizadas.",
                    )
                  }
                >
                  <RefreshCw /> Atualizar
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm("Desconectar esta conta afiliada?"))
                      void run(
                        () => api.deleteAffiliateProvider(key),
                        "Conta desconectada.",
                      );
                  }}
                >
                  <X /> Desconectar
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="module-state">
          <Tag />
          <b>Nenhuma conta conectada</b>
          <p>Conecte Shopee ou Mercado Livre para sincronizar produtos.</p>
        </div>
      )}
      {providerEditor !== undefined && (
        <AffiliateProviderModal
          current={providerEditor}
          busy={busy}
          onClose={() => setProviderEditor(undefined)}
          onSave={(provider, payload) =>
            void run(
              () => api.updateAffiliateProvider(provider, payload),
              "Conta afiliada salva.",
            )
          }
        />
      )}
      {linkEditor !== undefined && (
        <AffiliateLinkModal
          current={linkEditor}
          busy={busy}
          onClose={() => setLinkEditor(undefined)}
          onSave={(provider, payload) =>
            void run(
              () =>
                linkEditor
                  ? api.updateAffiliateLink(
                      provider,
                      text(linkEditor.itemId || linkEditor.id),
                      payload,
                    )
                  : api.createAffiliateLink(provider, payload),
              linkEditor ? "Produto atualizado." : "Produto adicionado.",
            )
          }
        />
      )}
      {settingsOpen && (
        <AffiliateSettingsModal
          provider={provider}
          configs={configs}
          providers={providers}
          resolver={mlResolver}
          busy={busy}
          onProviderChange={setProvider}
          onSaveConfig={saveAffiliateConfig}
          onEditAccount={() => {
            setSettingsOpen(false);
            setProviderEditor(providers.find((item) => text(item.provider) === provider) || { provider });
          }}
          onSaveResolver={saveMlResolver}
          onResolverAction={runMlResolverAction}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {dispatchOpen && (
        <AffiliateDispatchSettingsModal
          provider={provider}
          dispatches={dispatches}
          groups={groups}
          sample={providerLinks[0] || null}
          template={templates[provider] || {}}
          busy={busy}
          onProviderChange={setProvider}
          onCreateDispatch={createAffiliateDispatch}
          onUpdateDispatch={updateAffiliateDispatch}
          onDeleteDispatch={deleteAffiliateDispatch}
          onTemplate={() => setTemplateOpen(true)}
          onClose={() => setDispatchOpen(false)}
        />
      )}
      {templateOpen && (
        <AffiliateMessageTemplateModal
          provider={provider}
          current={templates[provider] || {}}
          sample={providerLinks[0] || null}
          busy={busy}
          onClose={() => setTemplateOpen(false)}
          onSave={(payload) =>
            void run(
              async () => {
                const result = await api.saveAffiliateMessageTemplate(
                  provider,
                  payload,
                );
                setTemplates((current) => ({
                  ...current,
                  [provider]: (result.template as JsonRecord) || payload,
                }));
              },
              "Mensagem e prévia salvas.",
            ).then(() => setTemplateOpen(false))
          }
        />
      )}
      {discoveryOpen && (
        <AffiliateProductDiscoveryModal
          provider={provider}
          busy={busy}
          onClose={() => setDiscoveryOpen(false)}
          onImport={(entries) =>
            void run(
              () => api.importAffiliateProducts(provider, entries),
              `${entries.length} produto(s) importado(s).`,
            ).then(() => setDiscoveryOpen(false))
          }
        />
      )}
    </main>
  );
}

export function PaymentsWorkspace() {
  const [charges, setCharges] = useState<JsonRecord[]>([]);
  const [purchases, setPurchases] = useState<JsonRecord[]>([]);
  const [historyTab, setHistoryTab] = useState<"purchases" | "charges">(
    "purchases",
  );
  const [settings, setSettings] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [chargeResult, purchaseResult, settingsResult] = await Promise.all([
        api.charges(),
        api.purchases(),
        api.rafflePaymentSettings(),
      ]);
      setCharges(listOf(chargeResult, ["charges", "payments", "items"]));
      setPurchases(listOf(purchaseResult, ["purchases", "items"]));
      setSettings(settingsResult);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os pagamentos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const paymentSettings = (settings?.settings || settings || {}) as JsonRecord;
  const configured = Boolean(
    paymentSettings.configured || paymentSettings.isConfigured,
  );
  const historyItems = historyTab === "purchases" ? purchases : charges;
  const filtered = historyItems.filter((item) =>
    `${text(item.categoryName)} ${text(item.customerName)} ${text(item.description)} ${text(item.planName)} ${text(item.status)} ${text(item.provider)} ${text(item.id)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const save = async (payload: JsonRecord) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.saveRafflePaymentSettings(payload);
      setNotice("Credenciais de pagamento atualizadas.");
      setSettingsOpen(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar as credenciais.",
      );
    } finally {
      setBusy(false);
    }
  };
  const paid = charges.filter((item) =>
    ["approved", "paid", "completed"].includes(text(item.status).toLowerCase()),
  );
  const received = paid.reduce(
    (total, item) => total + Number(item.amount || 0),
    0,
  );
  return (
    <main className="module payments-workspace">
      <header className="module-header">
        <div className="module-title">
          <span>
            <BadgeDollarSign />
          </span>
          <div>
            <h1>Pagamentos</h1>
            <p>Credenciais, cobranças e histórico financeiro.</p>
          </div>
        </div>
        <div>
          <button onClick={() => void load()}>
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
          <button
            className="primary-action"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />{" "}
            {configured ? "Editar credenciais" : "Configurar recebimento"}
          </button>
        </div>
      </header>
      <Notice
        error={error}
        notice={notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
      />
      <div className="commerce-metrics payment-metrics">
        <article>
          <small>Total recebido</small>
          <strong>{money(received)}</strong>
        </article>
        <article>
          <small>Pagamentos aprovados</small>
          <strong>{paid.length}</strong>
        </article>
        <article>
          <small>Pagamentos pendentes</small>
          <strong>
            {
              charges.filter((item) =>
                ["pending", "in_process"].includes(
                  text(item.status).toLowerCase(),
                ),
              ).length
            }
          </strong>
        </article>
        <article>
          <small>Plataforma ativa</small>
          <strong>
            {text(paymentSettings.activeProvider, "Não configurada")
              .replace("mercadopago_pix", "Mercado Pago")
              .replace("polopag_pix", "PoloPag")}
          </strong>
        </article>
      </div>
      <section className="settings-card payment-provider-card">
        <div>
          <span className={`commerce-item-icon ${configured ? "active" : ""}`}>
            <BadgeDollarSign />
          </span>
          <div>
            <h3>
              {configured
                ? "Recebimento configurado"
                : "Configure seu recebimento"}
            </h3>
            <p>
              {configured
                ? "Pronto para receber novas vendas, renovações e rifas."
                : "Cadastre uma plataforma para gerar cobranças dentro do painel."}
            </p>
          </div>
        </div>
        <button
          className="secondary-button"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings /> {configured ? "Editar" : "Configurar"}
        </button>
      </section>
      <section className="settings-card payment-history">
        <div className="settings-card-heading">
          <div>
            <h2>Histórico de pagamentos</h2>
            <p className="settings-muted">
              Compras e cobranças atualizadas automaticamente pelo servidor.
            </p>
          </div>
          <label className="commerce-search compact">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar cobrança"
            />
          </label>
        </div>
        <div className="module-tabs payment-history-tabs">
          <button
            className={historyTab === "purchases" ? "active" : ""}
            onClick={() => setHistoryTab("purchases")}
          >
            Compras ({purchases.length})
          </button>
          <button
            className={historyTab === "charges" ? "active" : ""}
            onClick={() => setHistoryTab("charges")}
          >
            Cobranças ({charges.length})
          </button>
        </div>
        {filtered.length ? (
          <div className="payment-table">
            <div className="payment-table-head">
              <span>{historyTab === "purchases" ? "Compra" : "Cobrança"}</span>
              <span>
                {historyTab === "purchases" ? "Cliente" : "Plataforma"}
              </span>
              <span>Data</span>
              <span>Valor</span>
              <span>{historyTab === "purchases" ? "Detalhes" : "Status"}</span>
            </div>
            {filtered.map((item, index) => (
              <article key={text(item.id, String(index))}>
                <span>
                  <b>
                    {text(
                      historyTab === "purchases"
                        ? item.categoryName
                        : item.description || item.planName,
                      `${historyTab === "purchases" ? "Compra" : "Cobrança"} #${text(item.id, String(index + 1))}`,
                    )}
                  </b>
                  <small>
                    {text(
                      historyTab === "purchases"
                        ? item.description || item.productDetails
                        : item.externalId || item.reference,
                      `#${text(item.id, "—")}`,
                    )}
                  </small>
                </span>
                <span>
                  {text(
                    historyTab === "purchases"
                      ? item.customerName || item.customerWhatsapp
                      : item.provider,
                    "—",
                  )}
                </span>
                <span>
                  {date(
                    historyTab === "purchases"
                      ? item.purchasedAt
                      : item.createdAt || item.updatedAt,
                  )}
                </span>
                <strong>
                  {money(
                    historyTab === "purchases"
                      ? item.categoryPrice || item.amount
                      : item.amount,
                  )}
                </strong>
                {historyTab === "purchases" ? (
                  <em className="state-pill active">Concluída</em>
                ) : (
                  <em
                    className={`state-pill ${text(item.status).toLowerCase()}`}
                  >
                    {text(item.status, "pendente")}
                  </em>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="module-state">
            <BadgeDollarSign />
            <b>Nenhuma cobrança encontrada</b>
            <p>As cobranças aparecerão aqui automaticamente.</p>
          </div>
        )}
      </section>
      {settingsOpen && (
        <PaymentSettingsModal
          current={settings}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onSave={(payload) => void save(payload)}
        />
      )}
    </main>
  );
}
