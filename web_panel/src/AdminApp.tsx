import {
  Activity,
  AlertTriangle,
  Bot,
  Bell,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CloudDownload,
  CreditCard,
  Edit3,
  Eye,
  ExternalLink,
  Headphones,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogIn,
  LogOut,
  Megaphone,
  MoreVertical,
  Pause,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Server,
  Settings,
  Smartphone,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { adminApi } from "./api";
import type { JsonRecord, SessionUser } from "./api";
import {
  AdminAffiliatesWorkspace,
  AdvancedEmpty,
  AdminDashboardWorkspace,
  AdminFirebaseWorkspace,
  AdminGroupsWorkspace,
  AdminMegaWorkspace,
  AdminMobileWorkspace,
  AdminNotificationsWorkspace,
  AdminServersWorkspace,
  AdminSiteWorkspace,
  AdminTutorialsWorkspace,
  AdminUsefulLinksWorkspace,
} from "./AdminAdvancedWorkspaces";

type AdminSection =
  | "dashboard"
  | "support"
  | "users"
  | "servers"
  | "instances"
  | "botinterage"
  | "mega"
  | "groups"
  | "campaigns"
  | "plans"
  | "partners"
  | "payments"
  | "affiliates"
  | "settings"
  | "site"
  | "firebase"
  | "aplicativo"
  | "notificacoes"
  | "linksuteis"
  | "tutoriais";

type IconComponent = typeof Headphones;

type AdminRailSection =
  | "dashboard"
  | "support"
  | "users"
  | "infrastructure"
  | "bot"
  | "campaigns"
  | "business"
  | "settings";

type AdminRailItem = {
  id: AdminRailSection;
  label: string;
  icon: IconComponent;
  sections: AdminSection[];
};

export type AdminNavItem = {
  id: AdminSection;
  label: string;
  subtitle: string;
  icon: IconComponent;
};

export const ADMIN_NAV: AdminNavItem[] = [
  { id: "support", label: "Suporte", subtitle: "Atendimentos em tempo real", icon: Headphones },
  { id: "users", label: "Usuários", subtitle: "Contas, planos e acesso", icon: Users },
  { id: "instances", label: "Perfis", subtitle: "Instâncias WhatsApp", icon: UserCheck },
  { id: "plans", label: "Planos", subtitle: "Assinaturas e limites", icon: ShieldCheck },
  { id: "partners", label: "Parceiros", subtitle: "Masters, revendedores e créditos", icon: UserPlus },
  { id: "payments", label: "Pagamentos", subtitle: "Pix, checkout e split", icon: CircleDollarSign },
  { id: "campaigns", label: "Campanhas", subtitle: "Envios administrativos", icon: Megaphone },
  { id: "botinterage", label: "BotInterage", subtitle: "IA e integrações", icon: Bot },
  { id: "settings", label: "Config", subtitle: "Site, app e serviços", icon: Settings },
  { id: "dashboard", label: "Painel", subtitle: "Indicadores e resumo da plataforma", icon: LayoutDashboard },
  { id: "servers", label: "Servidores", subtitle: "Hosts e limites de sessão", icon: Server },
  { id: "mega", label: "Mega downloader", subtitle: "Credenciais e sessão Mega.NZ", icon: CloudDownload },
  { id: "groups", label: "Grupos do bot", subtitle: "Grupos vinculados aos usuários", icon: Users },
  { id: "affiliates", label: "Afiliados", subtitle: "Provedores e OAuth", icon: CreditCard },
  { id: "site", label: "Config. do site", subtitle: "Identidade visual e conteúdo público", icon: Settings },
  { id: "firebase", label: "Firebase", subtitle: "Push e credenciais", icon: Activity },
  { id: "aplicativo", label: "Aplicativo", subtitle: "APK, assinatura e atualização", icon: Smartphone },
  { id: "notificacoes", label: "Notificações", subtitle: "SMTP, modelos e cobranças", icon: Bell },
  { id: "linksuteis", label: "Links úteis", subtitle: "Banners e atalhos oficiais", icon: Link2 },
  { id: "tutoriais", label: "Tutoriais", subtitle: "Materiais de apoio", icon: BookOpen },
];

const ADMIN_RAIL_NAV: AdminRailItem[] = [
  { id: "dashboard", label: "Painel", icon: LayoutDashboard, sections: ["dashboard"] },
  { id: "support", label: "Suporte", icon: Headphones, sections: ["support"] },
  { id: "users", label: "Usuários", icon: Users, sections: ["users"] },
  { id: "infrastructure", label: "Infraestrutura", icon: Server, sections: ["instances", "servers"] },
  { id: "bot", label: "Bot", icon: Bot, sections: ["botinterage", "mega", "groups"] },
  { id: "campaigns", label: "Campanhas", icon: Megaphone, sections: ["campaigns"] },
  { id: "business", label: "Negócios", icon: CreditCard, sections: ["plans", "partners", "payments", "affiliates"] },
  { id: "settings", label: "Configurações", icon: Settings, sections: ["site", "firebase", "aplicativo", "notificacoes", "linksuteis", "tutoriais", "settings"] },
];

const adminNav = (id: AdminSection): AdminNavItem =>
  ADMIN_NAV.find((item) => item.id === id) || ADMIN_NAV[0];

const sectionFromUrl = (): AdminSection => {
  const value = new URLSearchParams(window.location.search).get("section");
  if (ADMIN_NAV.some((item) => item.id === value)) return value as AdminSection;
  const stored = window.localStorage.getItem("botadmin.admin.section");
  return ADMIN_NAV.some((item) => item.id === stored) ? stored as AdminSection : "dashboard";
};

const text = (value: unknown, fallback = "—") => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value);
};

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const listValue = (value: unknown): JsonRecord[] =>
  Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object")
    : [];

const dateTime = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? text(value)
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const money = (value: unknown) =>
  numberValue(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const initials = (value: unknown) => {
  const parts = text(value, "BA").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]).join("").toUpperCase() || "BA";
};

const asError = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir a operação.";

const statusLabel = (value: unknown) => {
  const normalized = text(value, "desconhecido").toLowerCase();
  if (normalized.includes("conect")) return "Conectado";
  if (normalized.includes("aguardando")) return "Aguardando";
  if (normalized.includes("ativo")) return "Ativo";
  if (normalized.includes("suspend") || normalized.includes("bloque")) return "Bloqueado";
  return text(value, "Desconhecido");
};

const recordId = (record: JsonRecord) => text(record.id || record.userId || record.profileId || record.instanceId, "");

const recordTitle = (record: JsonRecord, fallback = "Registro") =>
  text(record.name || record.title || record.groupName || record.email, fallback);

const recordSubtitle = (record: JsonRecord) =>
  text(record.email || record.phone || record.whatsappNumber || record.description, "Sem detalhes");

function Toast({ message, success, onClose }: { message: string; success: boolean; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className={`admin-toast ${success ? "admin-toast--success" : "admin-toast--error"}`} role="status">
      {success ? <Check size={17} /> : <AlertTriangle size={17} />}
      <span>{message}</span>
      <button type="button" aria-label="Fechar aviso" onClick={onClose}><X size={15} /></button>
    </div>
  );
}

export function AdminModal({
  title,
  subtitle,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className={`admin-modal ${wide ? "admin-modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="admin-modal__header">
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button type="button" className="admin-icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button>
        </header>
        <div className="admin-modal__body">{children}</div>
        {footer ? <footer className="admin-modal__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function AdminPanelHeader({
  item,
  onRefresh,
  refreshing,
  actions,
}: {
  item: AdminNavItem;
  onRefresh: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
}) {
  const Icon = item.icon;
  return (
    <header className="admin-panel-header">
      <div className="admin-panel-header__title">
        <span className="admin-panel-header__icon"><Icon size={21} /></span>
        <div><h1>{item.label}</h1><p>{item.subtitle}</p></div>
      </div>
      <div className="admin-panel-header__actions">
        {actions}
        <button type="button" className="admin-icon-button" onClick={onRefresh} aria-label="Atualizar">
          <RefreshCw size={18} className={refreshing ? "admin-spin" : ""} />
        </button>
      </div>
    </header>
  );
}

export function AdminSearchBar({ value, onChange, placeholder = "Pesquisar" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="admin-search">
      <Search size={17} />
      <input value={value} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} />
      {value ? <button type="button" aria-label="Limpar busca" onClick={() => onChange("")}><X size={15} /></button> : null}
    </label>
  );
}

export function AdminStatusPill({ value, tone }: { value: unknown; tone?: "success" | "danger" | "warning" | "neutral" }) {
  const normalized = tone || (String(value).toLowerCase().includes("ativo") || String(value).toLowerCase().includes("conect") ? "success" : String(value).toLowerCase().includes("bloque") || String(value).toLowerCase().includes("venc") ? "danger" : "warning");
  return <span className={`admin-pill admin-pill--${normalized}`}>{statusLabel(value)}</span>;
}

export function AdminRecordCard({
  record,
  selected,
  onSelect,
  actions,
  extra,
}: {
  record: JsonRecord;
  selected?: boolean;
  onSelect?: () => void;
  actions?: ReactNode;
  extra?: ReactNode;
}) {
  const title = recordTitle(record);
  return (
    <article className={`admin-record-card ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <span className="admin-avatar">{initials(title)}</span>
      <div className="admin-record-card__main">
        <div className="admin-record-card__line"><strong>{title}</strong>{record.status || record.isActive !== undefined ? <AdminStatusPill value={record.status || (record.isActive ? "Ativo" : "Bloqueado")} /> : null}</div>
        <span>{recordSubtitle(record)}</span>
        {extra}
      </div>
      {actions ? <div className="admin-record-card__actions" onClick={(event) => event.stopPropagation()}>{actions}</div> : null}
    </article>
  );
}

function ConfirmModal({ title, message, confirmLabel, danger = false, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AdminModal title={title} subtitle="Confirme esta ação para continuar." onClose={onCancel} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onCancel}>Cancelar</button><button type="button" className={`admin-button ${danger ? "admin-button--danger" : "admin-button--primary"}`} onClick={onConfirm}>{confirmLabel}</button></>}>
      <div className="admin-confirm"><AlertTriangle size={28} /><p>{message}</p></div>
    </AdminModal>
  );
}

function SupportWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [threads, setThreads] = useState<JsonRecord[]>([]);
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [messages, setMessages] = useState<JsonRecord[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [userEditor, setUserEditor] = useState<JsonRecord | null | undefined>(undefined);
  const [balanceUser, setBalanceUser] = useState<JsonRecord | null>(null);
  const [planUser, setPlanUser] = useState<JsonRecord | null>(null);
  const [userConfirm, setUserConfirm] = useState<{ user: JsonRecord; action: "toggle" | "revoke" } | null>(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.supportThreads();
      const next = listValue(response.threads);
      setThreads(next);
      const compact = window.matchMedia("(max-width: 980px)").matches;
      setSelected((current) => current && next.some((item) => recordId(item) === recordId(current)) ? current : compact ? null : next[0] || null);
    } catch (error) {
      onToast(asError(error), false);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    const user = (selected.user && typeof selected.user === "object" ? selected.user : selected) as JsonRecord;
    const thread = (selected.thread && typeof selected.thread === "object" ? selected.thread : selected) as JsonRecord;
    const userId = numberValue(user.id || selected.userId);
    const whatsappId = text(thread.whatsappId || selected.whatsappId || "__admin__", "__admin__");
    let cancelled = false;
    setLoadingConversation(true);
    void adminApi.supportConversation(userId, whatsappId).then((response) => {
      if (!cancelled) setMessages(listValue(response.messages));
    }).catch((error) => {
      if (!cancelled) onToast(asError(error), false);
    }).finally(() => { if (!cancelled) setLoadingConversation(false); });
    return () => { cancelled = true; };
  }, [onToast, selected]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return threads.filter((entry) => {
      const user = (entry.user && typeof entry.user === "object" ? entry.user : entry) as JsonRecord;
      const thread = (entry.thread && typeof entry.thread === "object" ? entry.thread : entry) as JsonRecord;
      const matchesFilter = filter === "with_active" ? user.hasActiveSubscription === true : filter === "without_active" ? user.hasActiveSubscription !== true : filter === "open" ? text(thread.status || entry.status, "open") === "open" : filter === "closed" ? text(thread.status || entry.status) === "closed" : filter === "human" ? thread.isHuman === true : filter === "bot" ? thread.isHuman !== true : filter === "active" ? user.isActive !== false : filter === "inactive" ? user.isActive === false : true;
      return matchesFilter && (!needle || JSON.stringify(entry).toLocaleLowerCase("pt-BR").includes(needle));
    });
  }, [filter, query, threads]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim() || sending) return;
    const user = (selected.user && typeof selected.user === "object" ? selected.user : selected) as JsonRecord;
    const thread = (selected.thread && typeof selected.thread === "object" ? selected.thread : selected) as JsonRecord;
    const userId = numberValue(user.id || selected.userId);
    const whatsappId = text(thread.whatsappId || selected.whatsappId || "__admin__", "__admin__");
    const value = draft.trim();
    const optimistic = { id: `local-${Date.now()}`, direction: "outbound", senderRole: "admin", text: value, timestamp: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setSending(true);
    try {
      await adminApi.sendSupportMessage({ userId, to: whatsappId, mode: "text", text: value });
      onToast("Mensagem enviada.", true);
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setDraft(value);
      onToast(asError(error), false);
    } finally { setSending(false); }
  };

  const toggleThread = async () => {
    if (!selected) return;
    const user = (selected.user && typeof selected.user === "object" ? selected.user : selected) as JsonRecord;
    const thread = (selected.thread && typeof selected.thread === "object" ? selected.thread : selected) as JsonRecord;
    const userId = numberValue(user.id || selected.userId);
    const whatsappId = text(thread.whatsappId || selected.whatsappId || "__admin__", "__admin__");
    const open = text(thread.status || selected.status, "open") === "open";
    try {
      await adminApi.supportThreadAction(userId, whatsappId, { action: open ? "close" : "reopen" });
      setSelected((current) => current ? { ...current, status: open ? "closed" : "open", thread: { ...((current.thread || {}) as JsonRecord), status: open ? "closed" : "open" } } : current);
      onToast(open ? "Atendimento fechado." : "Atendimento reaberto.", true);
      void loadThreads();
    } catch (error) { onToast(asError(error), false); }
  };

  const setHandlingMode = async () => {
    if (!selected) return;
    const user = (selected.user && typeof selected.user === "object" ? selected.user : selected) as JsonRecord;
    const thread = (selected.thread && typeof selected.thread === "object" ? selected.thread : selected) as JsonRecord;
    const userId = numberValue(user.id || selected.userId);
    const whatsappId = text(thread.whatsappId || selected.whatsappId || "__admin__", "__admin__");
    const isHuman = thread.isHuman === true || text(thread.handlingMode) === "human";
    try {
      await adminApi.supportThreadAction(userId, whatsappId, { handlingMode: isHuman ? "bot" : "human" });
      setSelected((current) => current ? { ...current, thread: { ...((current.thread || {}) as JsonRecord), isHuman: !isHuman, handlingMode: isHuman ? "bot" : "human" } } : current);
      onToast(isHuman ? "Atendimento devolvido ao bot." : "Atendimento assumido pelo suporte.", true);
      void loadThreads();
    } catch (error) { onToast(asError(error), false); }
  };

  const runUserAction = async () => {
    if (!userConfirm) return;
    const { user, action } = userConfirm;
    try {
      await adminApi.user(recordId(user), action === "toggle" ? { isActive: user.isActive !== true } : { revokeSessions: true });
      onToast(action === "toggle" ? "Status do usuário atualizado." : "Sessões encerradas.", true);
      setUserConfirm(null);
      void loadThreads();
    } catch (error) { onToast(asError(error), false); }
  };

  const impersonateSupportUser = async (user: JsonRecord) => {
    try {
      await adminApi.impersonateUser(recordId(user));
      onToast("Sessão de suporte iniciada. Abrindo painel do usuário…", true);
      window.location.assign("/dashboard/user");
    } catch (error) { onToast(asError(error), false); }
  };

  return (
    <div className={`admin-support-workspace ${selected ? "has-selection" : "no-selection"}`}>
      <section className="admin-support-list">
        <header className="admin-support-list-header"><div><h1>Atendimentos</h1><p>Conversas de suporte dos usuários</p></div><button type="button" className="admin-icon-button" onClick={() => void loadThreads()} aria-label="Atualizar atendimentos"><RefreshCw size={19} /></button></header>
        <div className="admin-workspace-toolbar"><AdminSearchBar value={query} onChange={setQuery} placeholder="Pesquisar por nome, e-mail ou WhatsApp" /><div className="admin-filter-chips">{[["all", "Todos"], ["with_active", "Assinatura ativa"], ["without_active", "Sem assinatura"], ["open", "Abertos"], ["closed", "Fechados"], ["human", "Humano"], ["bot", "Bot"]].map(([value, label]) => <button type="button" key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
        {loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando atendimentos…</div> : filtered.length === 0 ? <div className="admin-empty"><Headphones size={28} /><strong>Nenhum atendimento encontrado</strong><span>Novas conversas de suporte aparecerão aqui.</span></div> : <div className="admin-record-list">{filtered.map((entry, index) => {
          const user = (entry.user && typeof entry.user === "object" ? entry.user : entry) as JsonRecord;
          const thread = (entry.thread && typeof entry.thread === "object" ? entry.thread : entry) as JsonRecord;
          return <AdminRecordCard key={`${recordId(user)}-${text(thread.whatsappId, index.toString())}`} record={{ ...user, title: recordTitle(user, `Usuário #${recordId(user)}`), email: user.email || user.whatsappNumber, status: thread.status === "closed" ? "Fechado" : "Aberto" }} selected={recordId(((selected?.user && typeof selected.user === "object" ? selected.user : selected) || {}) as JsonRecord) === recordId(user)} onSelect={() => setSelected(entry)} extra={<small>{text(thread.lastMessagePreview || entry.lastMessagePreview, "Sem mensagens")}</small>} actions={<details className="admin-more"><summary aria-label="Ações do usuário"><MoreVertical size={17} /></summary><div className="admin-more__menu"><button type="button" onClick={() => setUserEditor(user)}><Edit3 size={15} />Editar usuário</button><button type="button" onClick={() => setPlanUser(user)}><ShieldCheck size={15} />Plano e slots</button><button type="button" onClick={() => setBalanceUser(user)}><CircleDollarSign size={15} />Saldo</button><button type="button" onClick={() => window.location.assign(`/dashboard/admin?section=instances&userId=${encodeURIComponent(recordId(user))}`)}><Server size={15} />Gerenciar perfis</button><button type="button" onClick={() => void impersonateSupportUser(user)}><LogIn size={15} />Entrar como usuário</button><button type="button" onClick={() => setUserConfirm({ user, action: "toggle" })}>{user.isActive === false ? <><Check size={15} />Ativar conta</> : <><Pause size={15} />Bloquear conta</>}</button><button type="button" onClick={() => setUserConfirm({ user, action: "revoke" })}><LogOut size={15} />Encerrar sessões</button></div></details>} />;
        })}</div>}
      </section>
      <section className="admin-support-chat">
        {!selected ? <div className="admin-empty admin-empty--chat"><Headphones size={40} /><strong>Selecione um atendimento</strong><span>Escolha uma conversa na lista para responder.</span></div> : <>
          <header className="admin-chat-header"><button type="button" className="admin-icon-button admin-chat-back" onClick={() => setSelected(null)} aria-label="Voltar para atendimentos"><ChevronLeft size={20} /></button><div className="admin-chat-user"><span className="admin-avatar admin-avatar--large">{initials(recordTitle((selected.user || selected) as JsonRecord))}</span><div><strong>{recordTitle((selected.user || selected) as JsonRecord, "Usuário")}</strong><span>{text((selected.user as JsonRecord | undefined)?.email || selected.email || selected.whatsappId)}</span></div></div><div className="admin-chat-actions"><button type="button" className="admin-button admin-button--ghost" onClick={() => void setHandlingMode()}>{((selected.thread as JsonRecord | undefined)?.isHuman === true || text((selected.thread as JsonRecord | undefined)?.handlingMode) === "human") ? <><Bot size={16} />Bot</> : <><Headphones size={16} />Humano</>}</button><button type="button" className="admin-button admin-button--ghost" onClick={toggleThread}>{text((selected.thread as JsonRecord | undefined)?.status || selected.status, "open") === "open" ? <><Pause size={16} />Fechar</> : <><Check size={16} />Reabrir</>}</button><button type="button" className="admin-icon-button" onClick={() => void loadThreads()} aria-label="Atualizar atendimento"><RefreshCw size={18} /></button></div></header>
          <div className="admin-chat-messages">{loadingConversation ? <div className="admin-loading"><Activity className="admin-spin" size={20} />Carregando conversa…</div> : messages.length === 0 ? <div className="admin-empty"><span>Nenhuma mensagem neste atendimento.</span></div> : messages.map((message, index) => <div className={`admin-chat-bubble ${text(message.direction) === "outbound" ? "is-outbound" : ""}`} key={String(message.id || index)}><p>{text(message.text, message.messageType === "text" ? "" : "Mídia recebida")}</p><time>{dateTime(message.timestamp || message.createdAt)}</time></div>)}</div>
          <form className="admin-chat-composer" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="Digite uma mensagem" disabled={sending} /><button type="submit" className="admin-send-button" disabled={!draft.trim() || sending} aria-label="Enviar"><Send size={18} /></button></form>
        </>}
      </section>
      {userEditor !== undefined ? <UserEditor user={userEditor} onClose={() => setUserEditor(undefined)} onSaved={() => void loadThreads()} onToast={onToast} /> : null}
      {balanceUser ? <UserBalanceEditor user={balanceUser} onClose={() => setBalanceUser(null)} onSaved={() => void loadThreads()} onToast={onToast} /> : null}
      {planUser ? <UserPlanEditor user={planUser} onClose={() => setPlanUser(null)} onSaved={() => void loadThreads()} onToast={onToast} /> : null}
      {userConfirm ? <ConfirmModal title={userConfirm.action === "toggle" ? "Alterar status da conta?" : "Encerrar sessões?"} message={userConfirm.action === "toggle" ? "O acesso do usuário será atualizado imediatamente." : "Todas as sessões abertas desse usuário serão encerradas."} confirmLabel="Confirmar" danger={userConfirm.action === "revoke"} onCancel={() => setUserConfirm(null)} onConfirm={() => void runUserAction()} /> : null}
    </div>
  );
}

type UserFormState = { name: string; email: string; whatsappNumber: string; password: string; role: string; isActive: boolean };
const emptyUserForm: UserFormState = { name: "", email: "", whatsappNumber: "", password: "", role: "user", isActive: true };

function UserEditor({ user, onClose, onSaved, onToast }: { user: JsonRecord | null; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [form, setForm] = useState<UserFormState>(() => ({ ...emptyUserForm, ...(user ? { name: text(user.name, ""), email: text(user.email, ""), whatsappNumber: text(user.whatsappNumber, ""), role: text(user.role, "user"), isActive: user.isActive !== false } : {}) }));
  const [saving, setSaving] = useState(false);
  const change = (key: keyof UserFormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.name.trim().length < 2 || !form.email.includes("@") || (!user && form.password.length < 6)) { onToast("Informe nome, e-mail válido e senha com pelo menos 6 caracteres.", false); return; }
    setSaving(true);
    try {
      if (user) await adminApi.user(recordId(user), { name: form.name.trim(), email: form.email.trim(), whatsappNumber: form.whatsappNumber.trim(), role: form.role, isActive: form.isActive, ...(form.password ? { password: form.password } : {}) });
      else await adminApi.createUser({ name: form.name.trim(), email: form.email.trim(), whatsappNumber: form.whatsappNumber.trim(), password: form.password, role: form.role, isActive: form.isActive });
      onToast(user ? "Usuário atualizado." : "Usuário criado.", true); onSaved(); onClose();
    } catch (error) { onToast(asError(error), false); } finally { setSaving(false); }
  };
  return <AdminModal title={user ? "Editar usuário" : "Novo usuário"} subtitle="Dados de acesso e permissões básicas." onClose={onClose} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="admin-user-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button></>}><form id="admin-user-form" className="admin-form" onSubmit={submit}><label>Nome<input value={form.name} onChange={(event) => change("name", event.currentTarget.value)} autoFocus /></label><label>E-mail<input type="email" value={form.email} onChange={(event) => change("email", event.currentTarget.value)} /></label><label>WhatsApp<input value={form.whatsappNumber} onChange={(event) => change("whatsappNumber", event.currentTarget.value)} placeholder="+55…" /></label><label>Senha {user ? <small>(deixe vazia para manter)</small> : null}<input type="password" value={form.password} onChange={(event) => change("password", event.currentTarget.value)} /></label><label>Papel<select value={form.role} onChange={(event) => change("role", event.currentTarget.value)}><option value="user">Usuário</option><option value="admin">Administrador</option></select></label><label className="admin-toggle-row"><span>Conta ativa</span><button type="button" className={`admin-switch ${form.isActive ? "is-on" : ""}`} aria-pressed={form.isActive} onClick={() => change("isActive", !form.isActive)}><i /></button></label></form></AdminModal>;
}

function UserBalanceEditor({ user, onClose, onSaved, onToast }: { user: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [balance, setBalance] = useState(String(user.balance ?? user.creditBalance ?? "0"));
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(balance.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) { onToast("Informe um saldo válido.", false); return; }
    setSaving(true);
    try { await adminApi.user(recordId(user), { balance: value }); onToast("Saldo atualizado.", true); onSaved(); onClose(); }
    catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };
  return <AdminModal title={`Saldo de ${recordTitle(user)}`} subtitle="Atualize o saldo administrativo sem alterar a assinatura." onClose={onClose} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="admin-balance-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar saldo"}</button></>}><form id="admin-balance-form" className="admin-form" onSubmit={submit}><label>Saldo<input inputMode="decimal" value={balance} onChange={(event) => setBalance(event.currentTarget.value)} autoFocus /></label></form></AdminModal>;
}

function UserPlanEditor({ user, onClose, onSaved, onToast }: { user: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<JsonRecord[]>([]);
  const [planId, setPlanId] = useState("");
  const [status, setStatus] = useState("active");
  const [slots, setSlots] = useState("0");
  useEffect(() => {
    let cancelled = false;
    void adminApi.userPlan(recordId(user)).then((response) => {
      if (cancelled) return;
      const current = (response.status || response.subscription || {}) as JsonRecord;
      setPlans(listValue(response.plans));
      setPlanId(current.planId == null ? "" : String(current.planId));
      setStatus(text(current.status, "active"));
      const profileSlots = (response.profileSlots || {}) as JsonRecord;
      setSlots(String(profileSlots.quantity ?? user.profileSlots ?? 0));
    }).catch((error) => { if (!cancelled) onToast(asError(error), false); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onToast, user]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const quantity = Number(slots);
    if (!Number.isInteger(quantity) || quantity < 0) { onToast("Informe uma quantidade de slots válida.", false); return; }
    setSaving(true);
    try {
      await adminApi.userPlan(recordId(user), { planId: planId ? Number(planId) : null, status, profileSlotQuantity: quantity }, "PUT");
      onToast("Plano e slots atualizados.", true); onSaved(); onClose();
    } catch (error) { onToast(asError(error), false); } finally { setSaving(false); }
  };
  return <AdminModal title={`Plano de ${recordTitle(user)}`} subtitle="Ajuste assinatura, status e slots de perfil manualmente." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="admin-user-plan-form" className="admin-button admin-button--primary" disabled={saving || loading}>{saving ? "Salvando…" : "Salvar plano"}</button></>}><form id="admin-user-plan-form" className="admin-form admin-form--grid" onSubmit={submit}>{loading ? <div className="admin-loading admin-form__full"><Activity className="admin-spin" size={20} />Carregando plano…</div> : <><label>Plano<select value={planId} onChange={(event) => setPlanId(event.currentTarget.value)}><option value="">Sem plano</option>{plans.map((plan) => <option key={recordId(plan)} value={recordId(plan)}>{recordTitle(plan)} · {money(plan.price)}</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.currentTarget.value)}><option value="active">Ativo</option><option value="trialing">Período de teste</option><option value="past_due">Em atraso</option><option value="canceled">Cancelado</option></select></label><label>Slots de perfil<input type="number" min="0" step="1" value={slots} onChange={(event) => setSlots(event.currentTarget.value)} /></label><p className="admin-form-help"><ShieldCheck size={15} />A alteração é registrada no servidor e refletida no painel do usuário.</p></>}</form></AdminModal>;
}

function UsersWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [users, setUsers] = useState<JsonRecord[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<JsonRecord | null | undefined>(undefined);
  const [balanceUser, setBalanceUser] = useState<JsonRecord | null>(null);
  const [planUser, setPlanUser] = useState<JsonRecord | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ user: JsonRecord; action: "delete" | "toggle" | "revoke" | "resetMenus" } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (quiet = false) => { if (quiet) setRefreshing(true); else setLoading(true); try { const response = await adminApi.users({ page: 1, pageSize: 100, query, status: filter === "active" || filter === "inactive" ? filter : undefined, plan: filter === "with_active" || filter === "without_active" ? filter : undefined }); setUsers(listValue(response.users)); } catch (error) { onToast(asError(error), false); } finally { setLoading(false); setRefreshing(false); } }, [filter, onToast, query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);
  const runConfirm = async () => { if (!confirm) return; const { user, action } = confirm; try { if (action === "delete") await adminApi.deleteUser(recordId(user)); else if (action === "toggle") await adminApi.user(recordId(user), { isActive: user.isActive !== true }); else if (action === "resetMenus") await adminApi.user(recordId(user), { resetMenuTexts: true }); else await adminApi.user(recordId(user), { revokeSessions: true }); onToast(action === "delete" ? "Usuário excluído." : action === "toggle" ? "Status atualizado." : action === "resetMenus" ? "Menus restaurados." : "Sessões encerradas.", true); setConfirm(null); void load(true); } catch (error) { onToast(asError(error), false); } };
  const cleanup = async () => { try { const response = await adminApi.cleanupUsers({ confirmation: "LIMPAR-CADASTROS-VAZIOS" }); onToast(text(response.message, "Limpeza concluída."), true); setCleanupOpen(false); void load(true); } catch (error) { onToast(asError(error), false); } };
  const impersonate = async (user: JsonRecord) => { try { const response = await adminApi.impersonateUser(recordId(user)); if (response.sessionCookie) document.cookie = String(response.sessionCookie); onToast("Sessão de suporte iniciada. Abrindo painel do usuário…", true); window.location.assign("/dashboard/user"); } catch (error) { onToast(asError(error), false); } };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[1]} onRefresh={() => void load(true)} refreshing={refreshing} actions={<><button type="button" className="admin-button admin-button--ghost" onClick={() => setCleanupOpen(true)}><Trash2 size={16} />Limpar vazios</button><button type="button" className="admin-button admin-button--primary" onClick={() => setEditor(null)}><Plus size={17} />Novo usuário</button></>} /><div className="admin-toolbar"><AdminSearchBar value={query} onChange={setQuery} placeholder="Pesquisar por nome, e-mail ou WhatsApp" /><select value={filter} onChange={(event) => setFilter(event.currentTarget.value)}><option value="all">Todos</option><option value="active">Conta ativa</option><option value="inactive">Conta bloqueada</option><option value="with_active">Assinatura ativa</option><option value="without_active">Sem assinatura</option></select><span className="admin-toolbar__count">{users.length} carregados</span></div>{loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando usuários…</div> : users.length === 0 ? <div className="admin-empty"><Users size={30} /><strong>Nenhum usuário encontrado</strong><span>Altere os filtros ou cadastre uma conta.</span></div> : <div className="admin-record-list admin-record-list--table">{users.map((user) => <AdminRecordCard key={recordId(user)} record={{ ...user, title: recordTitle(user, `Usuário #${recordId(user)}`), status: user.isActive === false ? "Bloqueado" : user.hasActiveSubscription ? "Assinatura ativa" : "Ativo" }} extra={<small>{money(user.balance)} · {text(user.role, "user")} · criado {dateTime(user.createdAt)}</small>} actions={<><button type="button" className="admin-icon-button" title="Editar" onClick={() => setEditor(user)}><Edit3 size={16} /></button><button type="button" className="admin-icon-button" title="Entrar como usuário" onClick={() => void impersonate(user)}><LogIn size={16} /></button><details className="admin-more"><summary aria-label="Mais ações"><MoreVertical size={17} /></summary><div className="admin-more__menu"><button type="button" onClick={() => setBalanceUser(user)}><CircleDollarSign size={15} />Saldo</button><button type="button" onClick={() => setPlanUser(user)}><ShieldCheck size={15} />Plano e slots</button><button type="button" onClick={() => window.location.assign(`/dashboard/admin?section=instances&userId=${encodeURIComponent(recordId(user))}`)}><Server size={15} />Gerenciar perfis</button><button type="button" onClick={() => setConfirm({ user, action: "resetMenus" })}><RotateCw size={15} />Restaurar menus</button><button type="button" onClick={() => setConfirm({ user, action: "toggle" })}>{user.isActive === false ? <><Check size={15} />Ativar</> : <><Pause size={15} />Desativar</>}</button><button type="button" onClick={() => setConfirm({ user, action: "revoke" })}><LogOut size={15} />Encerrar sessões</button><button type="button" className="is-danger" onClick={() => setConfirm({ user, action: "delete" })}><Trash2 size={15} />Excluir</button></div></details></>} />)}</div>}{editor !== undefined ? <UserEditor user={editor} onClose={() => setEditor(undefined)} onSaved={() => void load(true)} onToast={onToast} /> : null}{balanceUser ? <UserBalanceEditor user={balanceUser} onClose={() => setBalanceUser(null)} onSaved={() => void load(true)} onToast={onToast} /> : null}{planUser ? <UserPlanEditor user={planUser} onClose={() => setPlanUser(null)} onSaved={() => void load(true)} onToast={onToast} /> : null}{cleanupOpen ? <ConfirmModal title="Limpar cadastros vazios?" message="Somente contas sem dados mínimos serão removidas. Esta operação é permanente e exige confirmação administrativa." confirmLabel="Limpar" danger onCancel={() => setCleanupOpen(false)} onConfirm={() => void cleanup()} /> : null}{confirm ? <ConfirmModal title={confirm.action === "delete" ? "Excluir usuário?" : confirm.action === "toggle" ? "Alterar status do usuário?" : confirm.action === "resetMenus" ? "Restaurar menus?" : "Encerrar sessões?"} message={confirm.action === "delete" ? `A conta ${recordTitle(confirm.user)} será removida permanentemente.` : confirm.action === "toggle" ? "O acesso ao painel será atualizado imediatamente." : confirm.action === "resetMenus" ? "Os textos dos menus dos grupos deste usuário voltarão aos padrões do BotAdmin." : "Todas as sessões abertas desse usuário serão encerradas."} confirmLabel={confirm.action === "delete" ? "Excluir" : "Confirmar"} danger={confirm.action === "delete" || confirm.action === "revoke"} onCancel={() => setConfirm(null)} onConfirm={() => void runConfirm()} /> : null}</div>;
}

function ProfileRenewalEditor({ profile, onClose, onSaved, onToast }: { profile: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [days, setDays] = useState("30");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload: JsonRecord = {};
    if (expiresAt.trim()) {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) { onToast("Informe uma validade válida.", false); return; }
      payload.expiresAt = parsed.toISOString();
    } else {
      const value = Number(days);
      if (!Number.isInteger(value) || value <= 0) { onToast("Informe uma quantidade de dias válida.", false); return; }
      payload.extendDays = value;
    }
    setSaving(true);
    try { await adminApi.profile(recordId(profile), payload); onToast("Perfil renovado.", true); onSaved(); onClose(); }
    catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };
  return <AdminModal title={`Renovar ${recordTitle(profile)}`} subtitle="A validade é atualizada no servidor sem desconectar a instância." onClose={onClose} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="profile-renew-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Renovar perfil"}</button></>}><form id="profile-renew-form" className="admin-form admin-form--grid" onSubmit={submit}><label>Adicionar dias rápidos<select value={days} onChange={(event) => { setDays(event.currentTarget.value); setExpiresAt(""); }}><option value="30">+30 dias</option><option value="90">+90 dias</option><option value="180">+180 dias</option><option value="365">+365 dias</option></select></label><label>Ou definir validade<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.currentTarget.value)} /></label></form></AdminModal>;
}

const profileIdForRenewal = (profile: JsonRecord) => profile.profileId || profile.profile_id || profile.id;

function CreateInstanceEditor({ onClose, onSaved, onToast }: { onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [users, setUsers] = useState<JsonRecord[]>([]); const [servers, setServers] = useState<JsonRecord[]>([]); const [userId, setUserId] = useState(""); const [serverId, setServerId] = useState(""); const [phone, setPhone] = useState(""); const [name, setName] = useState(""); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  useEffect(() => { let cancelled = false; void Promise.all([adminApi.users({ page: 1, pageSize: 100 }), adminApi.botServers()]).then(([userResponse, serverResponse]) => { if (cancelled) return; setUsers(listValue(userResponse.users || userResponse)); setServers(listValue(serverResponse.servers || serverResponse)); }).catch((error) => { if (!cancelled) onToast(asError(error), false); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [onToast]);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!userId || !serverId || !phone.trim()) { onToast("Selecione o usuário, o servidor e informe o número.", false); return; } setSaving(true); try { await adminApi.createInstance({ userId: Number(userId), serverId: Number(serverId), phone: phone.trim(), ...(name.trim() ? { name: name.trim() } : {}) }); onToast("Instância criada com sucesso.", true); onSaved(); onClose(); } catch (error) { onToast(asError(error), false); } finally { setSaving(false); } };
  return <AdminModal title="Nova instância" subtitle="Crie o slot no usuário e servidor; a conexão do WhatsApp é feita depois pelo pareamento." onClose={onClose} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="new-instance-form" className="admin-button admin-button--primary" disabled={saving || loading}>{saving ? "Criando…" : "Criar instância"}</button></>}><form id="new-instance-form" className="admin-form admin-form--grid" onSubmit={submit}>{loading ? <div className="admin-loading admin-form__full"><Activity className="admin-spin" size={20} />Carregando usuários e servidores…</div> : <><label>Usuário<select value={userId} onChange={(event) => setUserId(event.currentTarget.value)} required><option value="">Selecione um usuário</option>{users.map((user) => <option value={recordId(user)} key={recordId(user)}>{recordTitle(user)} · {text(user.email, "sem e-mail")}</option>)}</select></label><label>Servidor<select value={serverId} onChange={(event) => setServerId(event.currentTarget.value)} required><option value="">Selecione um servidor</option>{servers.map((server) => <option value={recordId(server)} key={recordId(server)}>{recordTitle(server)} · {text(server.baseUrl, "URL não informada")}</option>)}</select></label><label>Número WhatsApp<input value={phone} onChange={(event) => setPhone(event.currentTarget.value)} placeholder="5511999999999" inputMode="tel" required /></label><label>Nome do perfil (opcional)<input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Perfil principal" /></label></>}</form></AdminModal>;
}

function AdminInstanceProxyEditor({ instance, onClose, onSaved, onToast }: { instance: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const instanceId = instance.instanceId || instance.instance_id || instance.id || instance.profileId || instance.profile_id;
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [protocol, setProtocol] = useState("socks5");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasUsername, setHasUsername] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [lastCheck, setLastCheck] = useState<JsonRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!instanceId) {
      setLoading(false);
      onToast("Instância sem identificador válido.", false);
      return () => { cancelled = true; };
    }
    void adminApi.instanceProxy(String(instanceId)).then((response) => {
      if (cancelled) return;
      const proxy = (response.proxy || {}) as JsonRecord;
      setEnabled(proxy.enabled === true);
      setProtocol(["http", "https", "socks4", "socks4a", "socks5", "socks5h"].includes(String(proxy.protocol)) ? String(proxy.protocol) : "socks5");
      setHost(text(proxy.host, ""));
      setPort(proxy.port ? String(proxy.port) : "");
      setHasUsername(proxy.hasUsername === true);
      setHasPassword(proxy.hasPassword === true);
      setLastCheck(proxy.lastError ? { error: proxy.lastError } : proxy.resolvedIp ? proxy : null);
    }).catch((error) => { if (!cancelled) onToast(asError(error), false); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [instanceId, onToast]);

  const payload = (): JsonRecord => ({
    enabled,
    protocol,
    host: host.trim(),
    port: Number(port),
    username: username.trim(),
    password,
    preserveUsername: !username.trim() && hasUsername,
    preservePassword: !password && hasPassword,
  });

  const test = async () => {
    if (!instanceId || testing || saving) return;
    setTesting(true);
    try {
      const response = await adminApi.testInstanceProxy(String(instanceId), payload());
      const check = response.check && typeof response.check === "object" ? response.check as JsonRecord : null;
      setLastCheck(check);
      onToast(check ? `Proxy válido. IP público: ${text(check.resolvedIp, "confirmado")}.` : "Proxy desativado.", true);
    } catch (error) { setLastCheck({ error: asError(error) }); onToast(asError(error), false); }
    finally { setTesting(false); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!instanceId || saving || loading) return;
    if (enabled && (!host.trim() || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) {
      onToast("Informe host/IP e uma porta válida entre 1 e 65535.", false);
      return;
    }
    setSaving(true);
    try {
      const response = await adminApi.saveInstanceProxy(String(instanceId), payload());
      onToast(text(response.message, "Proxy salvo e aplicado com reinício seguro."), true);
      onSaved();
      onClose();
    } catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };

  return <AdminModal title={`Proxy — ${recordTitle(instance)}`} subtitle="Teste a rota antes de salvar. A aplicação reinicia somente o transporte e preserva o pareamento do WhatsApp." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="admin-button admin-button--ghost" onClick={() => void test()} disabled={loading || testing || saving}>{testing ? "Testando…" : "Testar agora"}</button><button type="submit" className="admin-button admin-button--primary" form="admin-instance-proxy-form" disabled={loading || saving}>{saving ? "Salvando…" : "Salvar e reiniciar"}</button></>}><form id="admin-instance-proxy-form" className="admin-form admin-form--grid" onSubmit={save}>{loading ? <div className="admin-loading admin-form__full"><Activity className="admin-spin" size={20} />Carregando configuração…</div> : <><label className="admin-toggle-row admin-form__full"><span><strong>Usar proxy nesta instância</strong><small>Desativado mantém a conexão direta.</small></span><button type="button" className={`admin-switch ${enabled ? "is-on" : ""}`} aria-pressed={enabled} onClick={() => setEnabled((value) => !value)}><i /></button></label><label>Protocolo<select value={protocol} onChange={(event) => setProtocol(event.currentTarget.value)} disabled={!enabled}><option value="http">HTTP / CONNECT</option><option value="https">HTTPS / CONNECT seguro</option><option value="socks4">SOCKS4</option><option value="socks4a">SOCKS4A</option><option value="socks5">SOCKS5</option><option value="socks5h">SOCKS5H (DNS pelo proxy)</option></select></label><label>Host ou IP<input value={host} onChange={(event) => setHost(event.currentTarget.value)} placeholder="ex.: 2001:db8::10 ou proxy.exemplo.com" disabled={!enabled} /></label><label>Porta<input value={port} onChange={(event) => setPort(event.currentTarget.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="59100" disabled={!enabled} /></label><label>Usuário (opcional)<input value={username} onChange={(event) => setUsername(event.currentTarget.value)} placeholder={hasUsername ? "Já configurado" : "Sem autenticação"} disabled={!enabled} autoComplete="off" /></label><label>Senha (opcional)<input value={password} onChange={(event) => setPassword(event.currentTarget.value)} placeholder={hasPassword ? "Já configurada" : "Sem autenticação"} type="password" disabled={!enabled} autoComplete="new-password" /></label>{lastCheck ? <div className={`admin-form-help admin-form__full ${lastCheck.error ? "is-error" : ""}`}><ShieldCheck size={16} />{lastCheck.error ? text(lastCheck.error, "Falha no teste") : <>Rota validada: {text(lastCheck.resolvedIp, "IP confirmado")}{lastCheck.countryName ? ` · ${text(lastCheck.countryName, "")}` : ""}{lastCheck.regionName ? ` · ${text(lastCheck.regionName, "")}` : ""}{lastCheck.latencyMs ? ` · ${text(lastCheck.latencyMs, "") } ms` : ""}</>}</div> : null}<p className="admin-form-help admin-form__full"><ShieldCheck size={15} />Aceitamos host DNS, IPv4 e IPv6 (com ou sem colchetes), portas 1–65535 e autenticação opcional. O teste também valida o túnel do WhatsApp Web.</p></>}</form></AdminModal>;
}

function InstancesWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [instances, setInstances] = useState<JsonRecord[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "connected" | "disconnected" | "expired" | "active">("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [renewing, setRenewing] = useState<JsonRecord | null>(null);
  const [confirm, setConfirm] = useState<{ instance: JsonRecord; action: string } | null>(null);
  const [pairing, setPairing] = useState<JsonRecord | null>(null);
  const [proxyEditing, setProxyEditing] = useState<JsonRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [nativeButtonsEnabled, setNativeButtonsEnabled] = useState<boolean | null>(null);
  const [nativeButtonsBusy, setNativeButtonsBusy] = useState(false);
  const [bulkAction, setBulkAction] = useState(false);
  const userIdFilter = useMemo(() => new URLSearchParams(window.location.search).get("userId") || "", []);
  const load = useCallback(async (quiet = false) => { if (quiet) setRefreshing(true); else setLoading(true); try { const response = await adminApi.instances(userIdFilter || undefined); const source = listValue(response.profiles).length ? listValue(response.profiles) : listValue(response.instances); setInstances(source); } catch (error) { onToast(asError(error), false); } finally { setLoading(false); setRefreshing(false); } }, [onToast, userIdFilter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { let cancelled = false; void adminApi.nativeButtons().then((response) => { if (cancelled) return; const summary = (response.summary || response) as JsonRecord; const enabled = Number(summary.totalInstances || 0) > 0 && Number(summary.enabledInstances || 0) === Number(summary.totalInstances || 0); setNativeButtonsEnabled(enabled); }).catch(() => { if (!cancelled) setNativeButtonsEnabled(null); }); return () => { cancelled = true; }; }, []);
  const runAction = async () => {
    if (!confirm) return;
    try {
      const instanceId = confirm.instance.instanceId || confirm.instance.instance_id || confirm.instance.id;
      const profileId = confirm.instance.profileId || confirm.instance.profile_id || confirm.instance.id;
      if (!instanceId) throw new Error("Perfil sem identificador de instância.");
      if (confirm.action === "purge") await adminApi.instancePurge(String(instanceId));
      else if (confirm.action === "pair") {
        const response = await adminApi.instancePair(String(instanceId));
        setPairing(response);
        onToast("Dados de pareamento gerados.", true);
        setConfirm(null);
        return;
      } else if (confirm.action === "deleteProfile") await adminApi.deleteInstance(String(instanceId));
      else if (confirm.action === "deleteLegacyProfile") await adminApi.deleteProfile(String(profileId));
      else await adminApi.instanceAction(String(instanceId), confirm.action);
      onToast(confirm.action === "deleteProfile" ? "Perfil excluído." : "Ação executada com sucesso.", true);
      setConfirm(null);
      void load(true);
    } catch (error) { onToast(asError(error), false); }
  };
  const statusFor = (instance: JsonRecord) => String(instance.sessionStatus || instance.connectionStatus || instance.status || "").toLowerCase();
  const isConnected = (instance: JsonRecord) => ["conectado", "connected", "online", "ativo", "active"].some((value) => statusFor(instance).includes(value));
  const isExpired = (instance: JsonRecord) => { const expires = instance.expiresAt || instance.expires_at; if (!expires) return false; const parsed = new Date(String(expires)); return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now(); };
  const matchesFilter = (instance: JsonRecord) => filter === "all" || (filter === "connected" && isConnected(instance)) || (filter === "disconnected" && !isConnected(instance)) || (filter === "expired" && isExpired(instance)) || (filter === "active" && !isExpired(instance));
  const filtered = instances.filter((instance) => matchesFilter(instance) && (!query.trim() || JSON.stringify(instance).toLowerCase().includes(query.trim().toLowerCase())));
  const syncWebhooks = async () => { setBulkAction(true); try { const response = await adminApi.syncAllInstanceWebhooks(); onToast(text(response.message, "Webhooks sincronizados."), true); } catch (error) { onToast(asError(error), false); } finally { setBulkAction(false); } };
  const purgeDisconnected = async () => { if (!window.confirm("Remover as sessões desconectadas preservando os perfis dos usuários?")) return; setBulkAction(true); try { const response = await adminApi.purgeDisconnectedInstances(); onToast(text(response.message, "Sessões desconectadas removidas."), true); await load(true); } catch (error) { onToast(asError(error), false); } finally { setBulkAction(false); } };
  const toggleNativeButtons = async () => { if (nativeButtonsEnabled === null) return; setNativeButtonsBusy(true); try { const response = await adminApi.nativeButtons(!nativeButtonsEnabled); const summary = (response.summary || response) as JsonRecord; const total = Number(summary.totalInstances || 0); const enabled = total > 0 && Number(summary.enabledInstances || 0) === total; setNativeButtonsEnabled(enabled); onToast(text(response.message, "Botões nativos atualizados."), true); } catch (error) { onToast(asError(error), false); } finally { setNativeButtonsBusy(false); } };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[2]} onRefresh={() => void load(true)} refreshing={refreshing} actions={<><button type="button" className="admin-button admin-button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} />Nova instância</button>{userIdFilter ? <button type="button" className="admin-button admin-button--ghost" onClick={() => window.location.assign("/dashboard/admin?section=instances")}><X size={16} />Todos os perfis</button> : null}<button type="button" className="admin-button admin-button--ghost" onClick={() => void syncWebhooks()} disabled={bulkAction}><RefreshCw size={15} />{bulkAction ? "Processando…" : "Sincronizar webhooks"}</button><button type="button" className="admin-button admin-button--ghost" onClick={() => void purgeDisconnected()} disabled={bulkAction}><Trash2 size={15} />Limpar desconectadas</button></>} /><div className="admin-toolbar"><AdminSearchBar value={query} onChange={setQuery} placeholder="Pesquisar perfil, telefone ou e-mail" /><select aria-label="Filtrar perfis" value={filter} onChange={(event) => setFilter(event.currentTarget.value as typeof filter)}><option value="all">Todos os perfis</option><option value="connected">Conectados</option><option value="disconnected">Desconectados</option><option value="active">Assinatura ativa</option><option value="expired">Assinatura vencida</option></select><span className="admin-toolbar__count">{filtered.length} perfis{userIdFilter ? ` do usuário #${userIdFilter}` : ""}</span></div>{nativeButtonsEnabled !== null ? <div className="admin-inline-setting"><span><strong>Botões nativos</strong><small>Ativar componentes interativos globalmente nas instâncias.</small></span><button type="button" className={`admin-switch ${nativeButtonsEnabled ? "is-on" : ""}`} aria-pressed={nativeButtonsEnabled} onClick={() => void toggleNativeButtons()} disabled={nativeButtonsBusy}><i /></button></div> : null}{loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando perfis…</div> : filtered.length === 0 ? <div className="admin-empty"><Server size={30} /><strong>Nenhum perfil encontrado</strong><span>Altere a pesquisa ou o filtro para consultar os perfis disponíveis.</span></div> : <div className="admin-record-list">{filtered.map((instance) => { const profile = recordTitle(instance, `Perfil #${recordId(instance)}`); return <AdminRecordCard key={recordId(instance)} record={{ ...instance, title: profile, email: instance.userEmail || instance.phone, status: instance.sessionStatus || (isExpired(instance) ? "Vencido" : "Ativo") }} extra={<small>{text(instance.userName, "Usuário")} · expira {dateTime(instance.expiresAt || instance.expires_at)} · servidor {text(instance.serverName)}</small>} actions={<details className="admin-more"><summary aria-label="Ações do perfil"><MoreVertical size={17} /></summary><div className="admin-more__menu"><button type="button" onClick={() => setRenewing(instance)}><RotateCw size={15} />Renovar perfil</button><button type="button" onClick={() => { void adminApi.impersonateUser(String(instance.userId || instance.user_id)).then(() => window.location.assign("/dashboard/user")).catch((error) => onToast(asError(error), false)); }}><LogIn size={15} />Entrar como usuário</button><button type="button" onClick={() => setProxyEditing(instance)}><ShieldCheck size={15} />Configurar proxy</button><button type="button" onClick={() => setConfirm({ instance, action: "connect" })}><UserCheck size={15} />Conectar</button><button type="button" onClick={() => setConfirm({ instance, action: "restart" })}><RefreshCw size={15} />Reiniciar</button><button type="button" onClick={() => setConfirm({ instance, action: "logout" })}><LogOut size={15} />Desconectar</button><button type="button" onClick={() => setConfirm({ instance, action: "pair" })}><KeyRound size={15} />Gerar pareamento</button><button type="button" className="is-danger" onClick={() => setConfirm({ instance, action: "purge" })}><Trash2 size={15} />Remover sessão</button><button type="button" className="is-danger" onClick={() => setConfirm({ instance, action: "deleteProfile" })}><Trash2 size={15} />Excluir perfil completo</button></div></details>} />; })}</div>}{createOpen ? <CreateInstanceEditor onClose={() => setCreateOpen(false)} onSaved={() => void load(true)} onToast={onToast} /> : null}{proxyEditing ? <AdminInstanceProxyEditor instance={proxyEditing} onClose={() => setProxyEditing(null)} onSaved={() => void load(true)} onToast={onToast} /> : null}{renewing ? <ProfileRenewalEditor profile={{ ...renewing, id: profileIdForRenewal(renewing) }} onClose={() => setRenewing(null)} onSaved={() => void load(true)} onToast={onToast} /> : null}{pairing ? <AdminModal title="Pareamento do perfil" subtitle="Use o QR Code ou o código exibido para conectar o número no WhatsApp." onClose={() => setPairing(null)} footer={<button type="button" className="admin-button admin-button--primary" onClick={() => setPairing(null)}>Concluir</button>}><div className="admin-pairing-result">{text(pairing.qrCode || pairing.qr || pairing.qrData, "").startsWith("data:image/") ? <img src={text(pairing.qrCode || pairing.qr || pairing.qrData)} alt="QR Code para pareamento" /> : null}<strong>{text(pairing.code || pairing.pairingCode || pairing.pairing_code, "QR Code gerado")}</strong><pre>{JSON.stringify(pairing, null, 2)}</pre></div></AdminModal> : null}{confirm ? <ConfirmModal title={`${confirm.action === "purge" ? "Remover sessão" : confirm.action === "deleteProfile" ? "Excluir perfil completo" : "Executar ação"} — ${recordTitle(confirm.instance)}`} message={confirm.action === "purge" ? "A sessão e os dados do servidor serão removidos; o perfil permanece disponível para nova conexão." : confirm.action === "deleteProfile" ? "O perfil, a instância, conversas e mídias associadas serão removidos definitivamente." : "A ação será enviada ao servidor administrativo e poderá alterar a conexão do WhatsApp."} confirmLabel={confirm.action === "deleteProfile" ? "Excluir tudo" : "Executar"} danger={confirm.action === "purge" || confirm.action === "logout" || confirm.action === "deleteProfile"} onCancel={() => setConfirm(null)} onConfirm={() => void runAction()} /> : null}</div>;
}

const PLAN_FEATURES = [
  ["conversas", "Conversas WhatsApp"],
  ["grupos_botadmin", "Grupos BotAdmin"],
  ["status", "Status"],
  ["status_programado", "Status programado"],
  ["transmissao", "Transmissões"],
  ["bot_interage", "BotInterage"],
  ["antilink", "Antilink"],
  ["boas_vindas", "Boas-vindas"],
  ["download_media", "Download de mídias"],
  ["midia_persistente", "Mídias persistentes"],
  ["multi_perfil", "Múltiplos perfis"],
  ["api", "API REST"],
  ["suporte_prioritario", "Suporte prioritário"],
  ["revenda", "Programa de revenda"],
] as const;
type PlanFormState = { name: string; description: string; price: string; durationDays: string; instanceLimit: string; groupLimit: string; storageQuotaGb: string; addonInstancePrice: string; addonGroupPrice: string; allowFlows: boolean; isActive: boolean; features: Record<string, boolean> };
const defaultPlanFeatures = Object.fromEntries(PLAN_FEATURES.map(([key]) => [key, !["api", "suporte_prioritario", "revenda"].includes(key)]));
const emptyPlanForm: PlanFormState = { name: "", description: "", price: "", durationDays: "30", instanceLimit: "1", groupLimit: "1", storageQuotaGb: "1", addonInstancePrice: "0", addonGroupPrice: "0", allowFlows: true, isActive: true, features: defaultPlanFeatures };
function PlanEditor({ plan, onClose, onSaved, onToast }: { plan: JsonRecord | null; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [form, setForm] = useState<PlanFormState>(() => { const stored = plan?.features && typeof plan.features === "object" && !Array.isArray(plan.features) ? plan.features as JsonRecord : {}; return { ...emptyPlanForm, ...(plan ? { name: text(plan.name, ""), description: text(plan.description, ""), price: String(plan.price ?? ""), durationDays: String(plan.durationDays ?? 30), instanceLimit: String(plan.instanceLimit ?? 1), groupLimit: String(plan.groupLimit ?? 1), storageQuotaGb: String(plan.storageQuotaGb ?? 1), addonInstancePrice: String(plan.addonInstancePrice ?? 0), addonGroupPrice: String(plan.addonGroupPrice ?? 0), allowFlows: plan.allowFlows !== false, isActive: plan.isActive !== false, features: Object.fromEntries(PLAN_FEATURES.map(([key]) => [key, stored[key] === undefined ? defaultPlanFeatures[key] : stored[key] === true])) } : {}) }; });
  const [saving, setSaving] = useState(false);
  const change = <K extends keyof PlanFormState>(key: K, value: PlanFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); const price = Number(form.price.replace(",", ".")); const duration = Number(form.durationDays); if (form.name.trim().length < 2 || !Number.isFinite(price) || price < 0 || !Number.isInteger(duration) || duration <= 0) { onToast("Informe nome, preço e duração válidos.", false); return; } setSaving(true); const payload = { name: form.name.trim(), description: form.description.trim(), price, durationDays: duration, instanceLimit: Number(form.instanceLimit), groupLimit: Number(form.groupLimit), storageQuotaGb: Number(form.storageQuotaGb), addonInstancePrice: Number(form.addonInstancePrice.replace(",", ".")), addonGroupPrice: Number(form.addonGroupPrice.replace(",", ".")), allowFlows: form.allowFlows, isActive: form.isActive, features: form.features }; try { if (plan) await adminApi.updatePlan(recordId(plan), payload); else await adminApi.createPlan(payload); onToast(plan ? "Plano atualizado." : "Plano criado.", true); onSaved(); onClose(); } catch (error) { onToast(asError(error), false); } finally { setSaving(false); } };
  return <AdminModal title={plan ? "Editar plano" : "Novo plano"} subtitle="Defina preço, duração, limites e recursos liberados." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="admin-plan-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar plano"}</button></>}><form id="admin-plan-form" className="admin-form admin-form--grid" onSubmit={submit}><label>Nome<input value={form.name} onChange={(event) => change("name", event.currentTarget.value)} autoFocus /></label><label>Preço (R$)<input inputMode="decimal" value={form.price} onChange={(event) => change("price", event.currentTarget.value)} /></label><label>Duração (dias)<input type="number" min="1" value={form.durationDays} onChange={(event) => change("durationDays", event.currentTarget.value)} /></label><label>Limite de perfis<input type="number" min="0" value={form.instanceLimit} onChange={(event) => change("instanceLimit", event.currentTarget.value)} /></label><label>Limite de grupos<input type="number" min="0" value={form.groupLimit} onChange={(event) => change("groupLimit", event.currentTarget.value)} /></label><label>Storage (GB)<input type="number" min="0" value={form.storageQuotaGb} onChange={(event) => change("storageQuotaGb", event.currentTarget.value)} /></label><label>Adicional por perfil<input inputMode="decimal" value={form.addonInstancePrice} onChange={(event) => change("addonInstancePrice", event.currentTarget.value)} /></label><label>Adicional por grupo<input inputMode="decimal" value={form.addonGroupPrice} onChange={(event) => change("addonGroupPrice", event.currentTarget.value)} /></label><label className="admin-form__full">Descrição<textarea value={form.description} onChange={(event) => change("description", event.currentTarget.value)} rows={3} /></label><label className="admin-toggle-row admin-form__full"><span>Permitir fluxos</span><button type="button" className={`admin-switch ${form.allowFlows ? "is-on" : ""}`} aria-pressed={form.allowFlows} onClick={() => change("allowFlows", !form.allowFlows)}><i /></button></label><label className="admin-toggle-row admin-form__full"><span>Plano ativo</span><button type="button" className={`admin-switch ${form.isActive ? "is-on" : ""}`} aria-pressed={form.isActive} onClick={() => change("isActive", !form.isActive)}><i /></button></label><fieldset className="admin-form__full admin-permissions"><legend>Recursos liberados</legend>{PLAN_FEATURES.map(([key, label]) => <label className="admin-toggle-row" key={key}><span>{label}</span><button type="button" className={`admin-switch ${form.features[key] ? "is-on" : ""}`} aria-pressed={form.features[key] === true} onClick={() => setForm((current) => ({ ...current, features: { ...current.features, [key]: !current.features[key] } }))}><i /></button></label>)}</fieldset></form></AdminModal>;
}
type TrialFormState = {
  enabled: boolean;
  planId: string;
  durationAmount: string;
  durationUnit: "hours" | "days";
  modalTitle: string;
  modalMessage: string;
  modalSteps: string[];
  modalImageUrl: string;
  modalImageFile: File | null;
  removeModalImage: boolean;
  whatsappMessage: string;
  whatsappMediaUrl: string;
  whatsappMediaFile: File | null;
  removeWhatsappMedia: boolean;
};

const trialDraft = (settings: JsonRecord): TrialFormState => {
  const duration = (settings.duration && typeof settings.duration === "object" ? settings.duration : {}) as JsonRecord;
  const modal = (settings.modal && typeof settings.modal === "object" ? settings.modal : {}) as JsonRecord;
  const whatsapp = (settings.whatsapp && typeof settings.whatsapp === "object" ? settings.whatsapp : {}) as JsonRecord;
  const steps = Array.isArray(modal.steps) ? modal.steps.map((step) => String(step ?? "")).slice(0, 3) : [];
  while (steps.length < 3) steps.push("");
  return {
    enabled: settings.enabled === true,
    planId: text(settings.planId, ""),
    durationAmount: String(duration.amount ?? 24),
    durationUnit: duration.unit === "days" ? "days" : "hours",
    modalTitle: text(modal.title, "Comece seu teste gratuito"),
    modalMessage: text(modal.message, "Explore todos os recursos do BotAdmin sem compromisso."),
    modalSteps: steps,
    modalImageUrl: text(modal.imageUrl, ""), modalImageFile: null, removeModalImage: false,
    whatsappMessage: text(whatsapp.message, "Seu teste gratuito foi ativado!"),
    whatsappMediaUrl: text(whatsapp.mediaUrl, ""), whatsappMediaFile: null, removeWhatsappMedia: false,
  };
};

function TrialSettingsEditor({ settings, plans, onClose, onSaved, onToast }: { settings: JsonRecord; plans: JsonRecord[]; onClose: () => void; onSaved: (settings: JsonRecord) => void; onToast: (message: string, success?: boolean) => void }) {
  const [form, setForm] = useState<TrialFormState>(() => trialDraft(settings));
  const [saving, setSaving] = useState(false);
  const change = <K extends keyof TrialFormState>(key: K, value: TrialFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const fileChange = (key: "modalImageFile" | "whatsappMediaFile", event: ChangeEvent<HTMLInputElement>) => { const file = event.currentTarget.files?.[0] || null; event.currentTarget.value = ""; setForm((current) => ({ ...current, [key]: file, [key === "modalImageFile" ? "removeModalImage" : "removeWhatsappMedia"]: false })); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(form.durationAmount);
    if (form.enabled && !form.planId) { onToast("Selecione o plano liberado durante o teste.", false); return; }
    if (!Number.isInteger(amount) || amount <= 0) { onToast("Informe uma duração de teste válida.", false); return; }
    setSaving(true);
    try {
      const payload = new FormData();
      payload.append("enabled", String(form.enabled)); if (form.planId) payload.append("planId", form.planId);
      payload.append("durationAmount", String(amount)); payload.append("durationUnit", form.durationUnit); payload.append("modalTitle", form.modalTitle.trim()); payload.append("modalMessage", form.modalMessage.trim());
      form.modalSteps.forEach((step, index) => payload.append(`modalStep${index + 1}`, step.trim()));
      if (form.removeModalImage) payload.append("removeModalImage", "true"); else if (form.modalImageFile) payload.append("modalImage", form.modalImageFile);
      payload.append("whatsappMessage", form.whatsappMessage.trim()); if (form.removeWhatsappMedia) payload.append("removeWhatsappMedia", "true"); else if (form.whatsappMediaFile) payload.append("whatsappMedia", form.whatsappMediaFile);
      const response = await adminApi.planTrial(payload); onSaved((response.settings || response) as JsonRecord); onToast("Configurações de teste gratuito atualizadas.", true); onClose();
    } catch (error) { onToast(asError(error), false); } finally { setSaving(false); }
  };
  return <AdminModal title="Teste gratuito automático" subtitle="Defina o plano, duração e mensagens exibidas para novos cadastros." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="trial-settings-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar teste gratuito"}</button></>}><form id="trial-settings-form" className="admin-form admin-form--grid" onSubmit={submit}><label className="admin-toggle-row admin-form__full"><span>Ativar teste para novos usuários</span><button type="button" className={`admin-switch ${form.enabled ? "is-on" : ""}`} aria-pressed={form.enabled} onClick={() => change("enabled", !form.enabled)}><i /></button></label><label>Plano liberado<select value={form.planId} onChange={(event) => change("planId", event.currentTarget.value)} disabled={!form.enabled}><option value="">Selecione um plano</option>{plans.map((plan) => <option key={recordId(plan)} value={recordId(plan)}>{recordTitle(plan)} · {text(plan.durationDays, "—")} dias</option>)}</select></label><label>Duração<input type="number" min="1" step="1" value={form.durationAmount} onChange={(event) => change("durationAmount", event.currentTarget.value)} /></label><label>Unidade<select value={form.durationUnit} onChange={(event) => change("durationUnit", event.currentTarget.value === "days" ? "days" : "hours")}><option value="hours">Horas</option><option value="days">Dias</option></select></label><label className="admin-form__full">Título do modal<input value={form.modalTitle} maxLength={160} onChange={(event) => change("modalTitle", event.currentTarget.value)} required /></label><label className="admin-form__full">Mensagem principal<textarea rows={3} maxLength={2000} value={form.modalMessage} onChange={(event) => change("modalMessage", event.currentTarget.value)} /></label><fieldset className="admin-form__full admin-permissions"><legend>Passos exibidos no modal</legend>{form.modalSteps.map((step, index) => <label key={index}>Passo {index + 1}<input value={step} maxLength={260} onChange={(event) => setForm((current) => ({ ...current, modalSteps: current.modalSteps.map((entry, entryIndex) => entryIndex === index ? event.currentTarget.value : entry) }))} placeholder={["Conecte sua instância", "Cadastre seu grupo", "Ative um comando"][index]} /></label>)}</fieldset><label>Imagem do modal<input type="file" accept="image/*" onChange={(event) => fileChange("modalImageFile", event)} />{form.modalImageUrl && !form.removeModalImage ? <small>Imagem atual disponível · <button type="button" className="admin-inline-link" onClick={() => change("removeModalImage", true)}>remover</button></small> : null}</label><label className="admin-form__full">Mensagem automática no WhatsApp<textarea rows={3} maxLength={2000} value={form.whatsappMessage} onChange={(event) => change("whatsappMessage", event.currentTarget.value)} /></label><label>Mídia da mensagem<input type="file" accept="image/*,video/*" onChange={(event) => fileChange("whatsappMediaFile", event)} />{form.whatsappMediaUrl && !form.removeWhatsappMedia ? <small>Mídia atual disponível · <button type="button" className="admin-inline-link" onClick={() => change("removeWhatsappMedia", true)}>remover</button></small> : null}</label></form></AdminModal>;
}

function PlansWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [plans, setPlans] = useState<JsonRecord[]>([]); const [loading, setLoading] = useState(true); const [editor, setEditor] = useState<JsonRecord | null | undefined>(undefined); const [confirm, setConfirm] = useState<JsonRecord | null>(null); const [trial, setTrial] = useState<JsonRecord | null>(null);
  const load = useCallback(async () => { setLoading(true); try { const response = await adminApi.plans(); setPlans(listValue(response.plans)); } catch (error) { onToast(asError(error), false); } finally { setLoading(false); } }, [onToast]);
  useEffect(() => { void load(); }, [load]);
  const remove = async () => { if (!confirm) return; try { await adminApi.deletePlan(recordId(confirm)); onToast("Plano excluído.", true); setConfirm(null); void load(); } catch (error) { onToast(asError(error), false); } };
  const toggle = async (plan: JsonRecord) => { try { await adminApi.updatePlan(recordId(plan), { name: plan.name, description: plan.description, price: Number(plan.price || 0), durationDays: Number(plan.durationDays || 30), instanceLimit: Number(plan.instanceLimit || 0), groupLimit: Number(plan.groupLimit || 0), storageQuotaGb: Number(plan.storageQuotaGb || 0), addonInstancePrice: Number(plan.addonInstancePrice || 0), addonGroupPrice: Number(plan.addonGroupPrice || 0), allowFlows: plan.allowFlows !== false, isActive: plan.isActive === false, features: plan.features && typeof plan.features === "object" ? plan.features : {} }); onToast(plan.isActive === false ? "Plano ativado." : "Plano desativado.", true); void load(); } catch (error) { onToast(asError(error), false); } };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[3]} onRefresh={() => void load()} actions={<><button type="button" className="admin-button admin-button--ghost" onClick={() => { void adminApi.planTrial().then((response) => setTrial((response.settings || response) as JsonRecord)).catch((error) => onToast(asError(error), false)); }}><Zap size={16} />Teste gratuito</button><button type="button" className="admin-button admin-button--primary" onClick={() => setEditor(null)}><Plus size={17} />Novo plano</button></>} />{loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando planos…</div> : plans.length === 0 ? <div className="admin-empty"><ShieldCheck size={30} /><strong>Nenhum plano cadastrado</strong><span>Crie o primeiro plano de assinatura.</span></div> : <div className="admin-card-grid">{plans.map((plan) => <article className="admin-info-card" key={recordId(plan)}><div className="admin-info-card__head"><span className="admin-avatar"><ShieldCheck size={18} /></span><div><strong>{recordTitle(plan)}</strong><AdminStatusPill value={plan.isActive === false ? "Desativado" : "Ativo"} /></div><details className="admin-more"><summary aria-label="Ações do plano"><MoreVertical size={17} /></summary><div className="admin-more__menu"><button type="button" onClick={() => setEditor(plan)}><Pencil size={15} />Editar</button><button type="button" onClick={() => void toggle(plan)}>{plan.isActive === false ? <><Check size={15} />Ativar</> : <><Pause size={15} />Desativar</>}</button><button type="button" className="is-danger" onClick={() => setConfirm(plan)}><Trash2 size={15} />Excluir</button></div></details></div><strong className="admin-info-card__price">{money(plan.price)} <small>/ {text(plan.durationDays, "30")} dias</small></strong><dl><div><dt>Perfis</dt><dd>{text(plan.instanceLimit, "0")}</dd></div><div><dt>Grupos</dt><dd>{text(plan.groupLimit, "0")}</dd></div><div><dt>Storage</dt><dd>{text(plan.storageQuotaGb, "0")} GB</dd></div></dl><p>{text(plan.description, "Sem descrição cadastrada.")}</p></article>)}</div>}{editor !== undefined ? <PlanEditor plan={editor} onClose={() => setEditor(undefined)} onSaved={() => void load()} onToast={onToast} /> : null}{trial ? <TrialSettingsEditor settings={trial} plans={plans} onClose={() => setTrial(null)} onSaved={(next) => setTrial(next)} onToast={onToast} /> : null}{confirm ? <ConfirmModal title="Excluir plano?" message={`O plano ${recordTitle(confirm)} será removido e não poderá ser vendido novamente.`} confirmLabel="Excluir" danger onCancel={() => setConfirm(null)} onConfirm={() => void remove()} /> : null}</div>;
}

type PartnerFormState = { accountMode: "new" | "existing"; selectedUserId: string; name: string; email: string; whatsappNumber: string; password: string; role: string; commissionRate: string; initialCredits: string; creditUnitPrice: string; manualPaymentsEnabled: boolean; allowChildManualPayments: boolean; manualPixKey: string; manualInstructions: string; permissions: Record<string, boolean> };
const PARTNER_PERMISSIONS = [
  ["manage_partners", "Gerenciar parceiros"],
  ["grant_credits", "Adicionar créditos"],
  ["manage_customers", "Cadastrar clientes"],
  ["activate_customers", "Ativar e renovar clientes"],
  ["view_financial", "Visualizar financeiro"],
  ["support_users", "Atender usuários"],
] as const;
const defaultPartnerPermissions = (role: string): Record<string, boolean> => {
  const normalized = role.toLowerCase();
  const all = Object.fromEntries(PARTNER_PERMISSIONS.map(([key]) => [key, false]));
  if (normalized === "master" || normalized === "owner") {
    for (const [key] of PARTNER_PERMISSIONS) all[key] = true;
  } else if (normalized === "reseller") {
    for (const key of ["manage_customers", "activate_customers", "view_financial"]) all[key] = true;
  } else if (normalized === "support") {
    all.support_users = true;
  }
  return all;
};
const emptyPartnerForm: PartnerFormState = { accountMode: "new", selectedUserId: "", name: "", email: "", whatsappNumber: "", password: "", role: "reseller", commissionRate: "20", initialCredits: "0", creditUnitPrice: "29.90", manualPaymentsEnabled: false, allowChildManualPayments: false, manualPixKey: "", manualInstructions: "", permissions: defaultPartnerPermissions("reseller") };
function PartnerEditor({ partner, onClose, onSaved, onToast }: { partner: JsonRecord | null; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [form, setForm] = useState<PartnerFormState>(() => {
    const role = text(partner?.role, "reseller");
    const storedPermissions = partner?.permissions && typeof partner.permissions === "object" && !Array.isArray(partner.permissions)
      ? Object.fromEntries(Object.entries(partner.permissions as JsonRecord).map(([key, value]) => [key, value === true]))
      : {};
    return { ...emptyPartnerForm, permissions: { ...defaultPartnerPermissions(role), ...storedPermissions }, ...(partner ? { accountMode: "existing", selectedUserId: text(partner.userId || partner.id, ""), name: text(partner.name, ""), email: text(partner.email, ""), whatsappNumber: text(partner.whatsappNumber, ""), role, commissionRate: String(partner.commissionRate ?? 20), creditUnitPrice: String(partner.creditUnitPrice ?? 29.9), manualPaymentsEnabled: partner.manualPaymentsEnabled === true, allowChildManualPayments: partner.allowChildManualPayments === true, manualPixKey: text(partner.manualPixKey, ""), manualInstructions: text(partner.manualInstructions, "") } : {}) };
  });
  const [saving, setSaving] = useState(false); const [existingQuery, setExistingQuery] = useState(""); const [existingUsers, setExistingUsers] = useState<JsonRecord[]>([]); const [existingLoading, setExistingLoading] = useState(false); const change = (key: keyof PartnerFormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => { if (partner || form.accountMode !== "existing") return; let cancelled = false; setExistingLoading(true); const timer = window.setTimeout(() => { void adminApi.users({ page: 1, pageSize: 100, query: existingQuery.trim() }).then((response) => { if (!cancelled) setExistingUsers(listValue(response.users)); }).catch(() => { if (!cancelled) setExistingUsers([]); }).finally(() => { if (!cancelled) setExistingLoading(false); }); }, 180); return () => { cancelled = true; window.clearTimeout(timer); }; }, [existingQuery, form.accountMode, partner]);
  useEffect(() => { if (!partner) return; let cancelled = false; void adminApi.partnerFinance(undefined, numberValue(partner.userId || partner.id)).then((response) => { if (cancelled) return; const settings = (response.settings || response.finance || {}) as JsonRecord; setForm((current) => ({ ...current, creditUnitPrice: String(settings.creditUnitPrice ?? current.creditUnitPrice), manualPaymentsEnabled: settings.manualPaymentsEnabled === true, allowChildManualPayments: settings.allowChildManualPayments === true, manualPixKey: text(settings.manualPixKey, current.manualPixKey), manualInstructions: text(settings.manualInstructions, current.manualInstructions) })); }).catch(() => { /* financial values may be unavailable for legacy partners; keep summary values */ }); return () => { cancelled = true; }; }, [partner]);
  const submit = async (event: FormEvent) => { event.preventDefault(); const existing = !partner && form.accountMode === "existing"; if (existing && !form.selectedUserId) { onToast("Selecione uma conta existente.", false); return; } if (!partner && !existing && (form.name.trim().length < 2 || !form.email.includes("@") || form.password.length < 6)) { onToast("Informe nome, e-mail e senha com pelo menos 6 caracteres.", false); return; } const commission = Number(form.commissionRate.replace(",", ".")); const creditPrice = Number(form.creditUnitPrice.replace(",", ".")); if (!Number.isFinite(commission) || commission < 0 || commission > 100 || !Number.isFinite(creditPrice) || creditPrice < 0) { onToast("Informe comissão e valor de crédito válidos.", false); return; } setSaving(true); try { const userId = partner ? numberValue(partner.userId || partner.id) : existing ? Number(form.selectedUserId) : undefined; let created: JsonRecord | undefined; if (partner || existing) { await adminApi.partner({ action: "member", userId, ...(form.name.trim() ? { name: form.name.trim() } : {}), ...(form.email.trim() ? { email: form.email.trim() } : {}), whatsappNumber: form.whatsappNumber.trim(), role: form.role, status: partner?.status === "suspended" ? "suspended" : "active", commissionRate: commission, permissions: form.permissions }); } else { const response = await adminApi.partner({ action: "create_member", name: form.name.trim(), email: form.email.trim(), whatsappNumber: form.whatsappNumber.trim(), password: form.password, role: form.role, permissions: form.permissions, commissionRate: commission, initialCredits: Number(form.initialCredits) }); created = (response.member || {}) as JsonRecord; } const targetId = userId || numberValue(created?.userId || created?.id); if (targetId) await adminApi.partnerFinance({ creditUnitPrice: creditPrice, manualPaymentsEnabled: form.manualPaymentsEnabled, allowChildManualPayments: form.allowChildManualPayments, manualPixKey: form.manualPixKey.trim(), manualInstructions: form.manualInstructions.trim() }, targetId); onToast(partner ? "Parceiro atualizado." : "Parceiro criado.", true); onSaved(); onClose(); } catch (error) { onToast(asError(error), false); } finally { setSaving(false); } };
  return <AdminModal title={partner ? "Editar parceiro" : "Adicionar parceiro"} subtitle="Masters, revendedores e suporte usam o mesmo controle de acesso." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="admin-partner-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar parceiro"}</button></>}><form id="admin-partner-form" className="admin-form admin-form--grid" onSubmit={submit}>{!partner ? <div className="admin-segmented admin-segmented--inner admin-form__full"><button type="button" className={form.accountMode === "new" ? "is-active" : ""} onClick={() => setForm((current) => ({ ...current, accountMode: "new", selectedUserId: "" }))}><UserPlus size={15} />Nova conta</button><button type="button" className={form.accountMode === "existing" ? "is-active" : ""} onClick={() => setForm((current) => ({ ...current, accountMode: "existing" }))}><Search size={15} />Conta existente</button></div> : null}{!partner && form.accountMode === "existing" ? <><label className="admin-form__full">Buscar conta existente<input value={existingQuery} onChange={(event) => setExistingQuery(event.currentTarget.value)} placeholder="Nome, e-mail, WhatsApp ou ID" autoFocus /></label><label className="admin-form__full">Conta cadastrada<select value={form.selectedUserId} onChange={(event) => setForm((current) => ({ ...current, selectedUserId: event.currentTarget.value }))} disabled={existingLoading}><option value="">{existingLoading ? "Buscando…" : "Selecione uma conta"}</option>{existingUsers.map((user) => <option key={recordId(user)} value={recordId(user)}>{recordTitle(user, `Usuário #${recordId(user)}`)} · {text(user.email || user.whatsappNumber, "")}</option>)}</select></label></> : <><label>Nome<input value={form.name} onChange={(event) => change("name", event.currentTarget.value)} autoFocus /></label><label>E-mail<input type="email" value={form.email} onChange={(event) => change("email", event.currentTarget.value)} disabled={Boolean(partner)} /></label><label>WhatsApp<input value={form.whatsappNumber} onChange={(event) => change("whatsappNumber", event.currentTarget.value)} /></label>{!partner ? <label>Senha inicial<input type="password" value={form.password} onChange={(event) => change("password", event.currentTarget.value)} /></label> : null}</>}<label>Papel<select value={form.role} onChange={(event) => { const role = event.currentTarget.value; setForm((current) => ({ ...current, role, permissions: partner ? current.permissions : defaultPartnerPermissions(role) })); }}><option value="master">Master</option><option value="reseller">Revendedor</option><option value="support">Suporte</option></select></label><label>Comissão (%)<input inputMode="decimal" value={form.commissionRate} onChange={(event) => change("commissionRate", event.currentTarget.value)} /></label>{!partner && form.accountMode === "new" ? <label>Créditos iniciais<input type="number" min="0" value={form.initialCredits} onChange={(event) => change("initialCredits", event.currentTarget.value)} /></label> : null}<label>Valor do crédito (R$)<input inputMode="decimal" value={form.creditUnitPrice} onChange={(event) => change("creditUnitPrice", event.currentTarget.value)} /></label><label className="admin-toggle-row"><span>Pagamento manual</span><button type="button" className={`admin-switch ${form.manualPaymentsEnabled ? "is-on" : ""}`} aria-pressed={form.manualPaymentsEnabled} onClick={() => change("manualPaymentsEnabled", !form.manualPaymentsEnabled)}><i /></button></label><label className="admin-toggle-row"><span>Manual para subordinados</span><button type="button" className={`admin-switch ${form.allowChildManualPayments ? "is-on" : ""}`} aria-pressed={form.allowChildManualPayments} onClick={() => change("allowChildManualPayments", !form.allowChildManualPayments)}><i /></button></label><label className="admin-form__full">Pix para pagamento manual<input value={form.manualPixKey} onChange={(event) => change("manualPixKey", event.currentTarget.value)} /></label><label className="admin-form__full">Instruções<textarea rows={3} value={form.manualInstructions} onChange={(event) => change("manualInstructions", event.currentTarget.value)} /></label><fieldset className="admin-form__full admin-permissions"><legend>Permissões específicas</legend>{PARTNER_PERMISSIONS.map(([key, label]) => <label className="admin-toggle-row" key={key}><span>{label}</span><button type="button" className={`admin-switch ${form.permissions[key] ? "is-on" : ""}`} aria-pressed={form.permissions[key] === true} onClick={() => setForm((current) => ({ ...current, permissions: { ...current.permissions, [key]: !current.permissions[key] } }))}><i /></button></label>)}</fieldset></form></AdminModal>;
}

function ManualPartnerPayments({ onClose, onToast }: { onClose: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [requests, setRequests] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.partnerManualPayments();
      setRequests(listValue(response.requests));
    } catch (error) {
      onToast(asError(error), false);
    } finally {
      setLoading(false);
    }
  }, [onToast]);
  useEffect(() => { void load(); }, [load]);
  const review = async (request: JsonRecord, action: "approve" | "reject") => {
    const publicId = text(request.publicId || request.id, "");
    if (!publicId || busyId) return;
    setBusyId(publicId);
    try {
      await adminApi.reviewManualPayment({ action, publicId });
      onToast(action === "approve" ? "Pagamento aprovado e créditos liberados." : "Pagamento rejeitado.", true);
      await load();
    } catch (error) {
      onToast(asError(error), false);
    } finally {
      setBusyId(null);
    }
  };
  return <AdminModal title="Pagamentos manuais" subtitle="Revise os comprovantes enviados por masters e revendedores." onClose={onClose} wide footer={<button type="button" className="admin-button admin-button--primary" onClick={onClose}>Fechar</button>}>
    {loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando pagamentos…</div> : requests.length === 0 ? <div className="admin-empty admin-empty--small"><Receipt size={28} /><strong>Nenhum comprovante pendente</strong><span>Os pagamentos manuais enviados aparecerão aqui.</span></div> : <div className="admin-manual-payments">{requests.map((request, index) => {
      const id = text(request.publicId || request.id, String(index));
      const status = text(request.status, "pending").toLowerCase();
      const pending = status === "pending";
      const proofUrl = text(request.proofUrl || request.proof_url, "");
      return <article className="admin-manual-payment" key={id}><div className="admin-manual-payment__main"><strong>{text(request.buyerName || request.buyerEmail, "Cliente")}</strong><span>{text(request.credits, "0")} créditos · {money(request.totalAmount || request.amount)}</span><small>{text(request.buyerEmail, "")} · {dateTime(request.createdAt || request.created_at)}</small>{proofUrl && proofUrl !== "—" ? <a href={proofUrl} target="_blank" rel="noreferrer">Abrir comprovante <ExternalLink size={13} /></a> : <small>Comprovante não informado</small>}</div><div className="admin-manual-payment__actions">{pending ? <><button type="button" className="admin-button admin-button--primary" disabled={busyId === id} onClick={() => void review(request, "approve")}><Check size={15} />Aprovar</button><button type="button" className="admin-button admin-button--danger" disabled={busyId === id} onClick={() => void review(request, "reject")}><X size={15} />Rejeitar</button></> : <AdminStatusPill value={status === "approved" ? "Aprovado" : "Rejeitado"} tone={status === "approved" ? "success" : "danger"} />}</div></article>;
    })}</div>}
  </AdminModal>;
}

type PartnerFinanceForm = { creditUnitPrice: string; manualPaymentsEnabled: boolean; allowChildManualPayments: boolean; manualPixKey: string; manualInstructions: string; proxySalesMode: "manual" | "automatic"; proxyMonthlyPrice: string; allowCustomerProxy: boolean; proxySalesInstructions: string };

function PartnerFinanceEditor({ partner, onClose, onSaved, onToast }: { partner: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const userId = numberValue(partner.userId || partner.id);
  const [form, setForm] = useState<PartnerFinanceForm>({ creditUnitPrice: "29.90", manualPaymentsEnabled: false, allowChildManualPayments: false, manualPixKey: "", manualInstructions: "", proxySalesMode: "manual", proxyMonthlyPrice: "0", allowCustomerProxy: true, proxySalesInstructions: "" });
  const [planCosts, setPlanCosts] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const change = <K extends keyof PartnerFinanceForm>(key: K, value: PartnerFinanceForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => { let cancelled = false; if (!userId) { setLoading(false); setError("Parceiro inválido."); return () => { cancelled = true; }; } void adminApi.partnerFinance(undefined, userId).then((response) => { if (cancelled) return; const settings = (response.settings || {}) as JsonRecord; setForm({ creditUnitPrice: String(settings.creditUnitPrice ?? 29.9), manualPaymentsEnabled: settings.manualPaymentsEnabled === true, allowChildManualPayments: settings.allowChildManualPayments === true, manualPixKey: text(settings.manualPixKey, ""), manualInstructions: text(settings.manualInstructions, ""), proxySalesMode: settings.proxySalesMode === "automatic" ? "automatic" : "manual", proxyMonthlyPrice: String(settings.proxyMonthlyPrice ?? 0), allowCustomerProxy: settings.allowCustomerProxy !== false, proxySalesInstructions: text(settings.proxySalesInstructions, "") }); setPlanCosts(listValue(response.planCosts)); }).catch((cause) => { if (!cancelled) setError(asError(cause)); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [userId]);
  const save = async (event: FormEvent) => { event.preventDefault(); const credit = Number(form.creditUnitPrice.replace(",", ".")); const proxy = Number(form.proxyMonthlyPrice.replace(",", ".")); if (!Number.isFinite(credit) || credit <= 0 || !Number.isFinite(proxy) || proxy < 0) { onToast("Informe valores financeiros válidos.", false); return; } const costs = planCosts.map((item) => ({ planId: numberValue(item.planId || item.id), creditCost: Math.max(1, Math.floor(Number(String(item.__creditCost ?? item.creditCost ?? 1).replace(",", ".")))) })).filter((item) => item.planId > 0); setSaving(true); try { await adminApi.partnerFinance({ creditUnitPrice: credit, manualPaymentsEnabled: form.manualPaymentsEnabled, allowChildManualPayments: form.allowChildManualPayments, manualPixKey: form.manualPixKey.trim() || null, manualInstructions: form.manualInstructions.trim() || null, proxySalesMode: form.proxySalesMode, proxyMonthlyPrice: proxy, allowCustomerProxy: form.allowCustomerProxy, proxySalesInstructions: form.proxySalesInstructions.trim() || null, planCosts: costs }, userId); onToast("Regras financeiras do parceiro atualizadas.", true); onSaved(); onClose(); } catch (cause) { onToast(asError(cause), false); } finally { setSaving(false); } };
  return <AdminModal title={`Financeiro — ${recordTitle(partner)}`} subtitle="Créditos, planos, pagamentos manuais, comissão e proxy ficam isolados por parceiro." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="partner-finance-form" className="admin-button admin-button--primary" disabled={saving || loading}>{saving ? "Salvando…" : "Salvar regras"}</button></>}><form id="partner-finance-form" className="admin-form admin-form--grid" onSubmit={save}>{loading ? <div className="admin-loading admin-form__full"><Activity className="admin-spin" size={21} />Carregando regras financeiras…</div> : error ? <div className="admin-form-help admin-form__full"><AlertTriangle size={16} />{error}</div> : <><label>Valor de cada crédito (R$)<input inputMode="decimal" value={form.creditUnitPrice} onChange={(event) => change("creditUnitPrice", event.currentTarget.value)} /></label><label>Modo de venda de proxy<select value={form.proxySalesMode} onChange={(event) => change("proxySalesMode", event.currentTarget.value as PartnerFinanceForm["proxySalesMode"])}><option value="manual">Venda manual pelo parceiro</option><option value="automatic">Cobrança automática no cliente</option></select></label><label>Preço mensal do proxy (R$)<input inputMode="decimal" value={form.proxyMonthlyPrice} onChange={(event) => change("proxyMonthlyPrice", event.currentTarget.value)} /></label><label className="admin-toggle-row"><span>Permitir cliente escolher proxy</span><button type="button" className={`admin-switch ${form.allowCustomerProxy ? "is-on" : ""}`} aria-pressed={form.allowCustomerProxy} onClick={() => change("allowCustomerProxy", !form.allowCustomerProxy)}><i /></button></label><label className="admin-toggle-row"><span>Pagamento manual habilitado</span><button type="button" className={`admin-switch ${form.manualPaymentsEnabled ? "is-on" : ""}`} aria-pressed={form.manualPaymentsEnabled} onClick={() => change("manualPaymentsEnabled", !form.manualPaymentsEnabled)}><i /></button></label><label className="admin-toggle-row"><span>Permitir manual para subordinados</span><button type="button" className={`admin-switch ${form.allowChildManualPayments ? "is-on" : ""}`} aria-pressed={form.allowChildManualPayments} onClick={() => change("allowChildManualPayments", !form.allowChildManualPayments)}><i /></button></label><label>Chave Pix<input value={form.manualPixKey} onChange={(event) => change("manualPixKey", event.currentTarget.value)} /></label><label className="admin-form__full">Instruções de pagamento<textarea rows={3} value={form.manualInstructions} onChange={(event) => change("manualInstructions", event.currentTarget.value)} /></label><label className="admin-form__full">Instruções do proxy<textarea rows={3} value={form.proxySalesInstructions} onChange={(event) => change("proxySalesInstructions", event.currentTarget.value)} /></label><fieldset className="admin-form__full admin-permissions"><legend>Custo em créditos por plano</legend>{planCosts.length === 0 ? <p className="admin-form-help">Nenhum plano retornado pelo servidor.</p> : <div className="admin-plan-cost-list">{planCosts.map((item, index) => <label key={recordId(item) || index}><span>{recordTitle(item, `Plano #${item.planId}`)} <small>{text(item.durationDays, "—")} dias</small></span><input type="number" min="1" step="1" value={String(item.__creditCost ?? item.creditCost ?? 1)} onChange={(event) => setPlanCosts((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, __creditCost: event.currentTarget.value } : entry))} /></label>)}</div>}</fieldset></>}</form></AdminModal>;
}

function PartnersWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [partners, setPartners] = useState<JsonRecord[]>([]); const [loading, setLoading] = useState(true); const [editor, setEditor] = useState<JsonRecord | null | undefined>(undefined); const [financePartner, setFinancePartner] = useState<JsonRecord | null>(null); const [creditPartner, setCreditPartner] = useState<JsonRecord | null>(null); const [creditAmount, setCreditAmount] = useState(""); const [manualPaymentsOpen, setManualPaymentsOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const response = await adminApi.partners(); setPartners(listValue(response.members)); } catch (error) { onToast(asError(error), false); } finally { setLoading(false); } }, [onToast]); useEffect(() => { void load(); }, [load]);
  const grant = async (event: FormEvent) => { event.preventDefault(); if (!creditPartner || Number(creditAmount) <= 0) return; try { await adminApi.partner({ action: "grant_credits", resellerUserId: numberValue(creditPartner.userId || creditPartner.id), credits: Number(creditAmount), idempotencyKey: `react-admin-${Date.now()}` }); onToast("Créditos adicionados.", true); setCreditPartner(null); setCreditAmount(""); void load(); } catch (error) { onToast(asError(error), false); } };
  const toggleStatus = async (partner: JsonRecord) => { try { await adminApi.partner({ action: "member", userId: numberValue(partner.userId || partner.id), role: text(partner.role, "reseller"), status: partner.status === "active" ? "suspended" : "active", commissionRate: numberValue(partner.commissionRate), permissions: partner.permissions || {} }); onToast("Acesso atualizado.", true); void load(); } catch (error) { onToast(asError(error), false); } };
  const enter = async (partner: JsonRecord) => { try { const response = await adminApi.impersonateUser(numberValue(partner.userId || partner.id)); if (response.sessionCookie) document.cookie = String(response.sessionCookie); window.location.assign("/dashboard/partner"); } catch (error) { onToast(asError(error), false); } };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[4]} onRefresh={() => void load()} actions={<><button type="button" className="admin-button admin-button--ghost" onClick={() => setManualPaymentsOpen(true)}><Receipt size={16} />Pagamentos manuais</button><button type="button" className="admin-button admin-button--primary" onClick={() => setEditor(null)}><Plus size={17} />Adicionar</button></>} /><div className="admin-partner-note"><Zap size={17} /><span>Controle centralizado de papéis, créditos, comissão, proxy e pagamento manual por parceiro.</span></div>{loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando parceiros…</div> : partners.length === 0 ? <div className="admin-empty"><Users size={30} /><strong>Nenhum parceiro cadastrado</strong><span>Adicione um master, revendedor ou usuário de suporte.</span></div> : <div className="admin-record-list">{partners.map((partner) => <AdminRecordCard key={recordId(partner)} record={{ ...partner, title: recordTitle(partner), email: partner.email, status: partner.status === "suspended" ? "Suspenso" : text(partner.role, "reseller") }} extra={<small>{text(partner.creditBalance, "0")} créditos · {numberValue(partner.commissionRate).toFixed(1)}% comissão</small>} actions={<details className="admin-more"><summary aria-label="Ações do parceiro"><MoreVertical size={17} /></summary><div className="admin-more__menu"><button type="button" onClick={() => setEditor(partner)}><Pencil size={15} />Editar papel</button><button type="button" onClick={() => setFinancePartner(partner)}><CircleDollarSign size={15} />Financeiro e planos</button><button type="button" onClick={() => setCreditPartner(partner)}><Zap size={15} />Adicionar créditos</button><button type="button" onClick={() => void enter(partner)}><LogIn size={15} />Entrar no painel</button><button type="button" onClick={() => void toggleStatus(partner)}>{partner.status === "active" ? <><Pause size={15} />Suspender</> : <><Check size={15} />Reativar</>}</button></div></details>} />)}</div>}{editor !== undefined ? <PartnerEditor partner={editor} onClose={() => setEditor(undefined)} onSaved={() => void load()} onToast={onToast} /> : null}{financePartner ? <PartnerFinanceEditor partner={financePartner} onClose={() => setFinancePartner(null)} onSaved={() => void load()} onToast={onToast} /> : null}{creditPartner ? <AdminModal title={`Créditos para ${recordTitle(creditPartner)}`} subtitle={`Saldo atual: ${text(creditPartner.creditBalance, "0")} créditos`} onClose={() => setCreditPartner(null)} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={() => setCreditPartner(null)}>Cancelar</button><button type="submit" form="credit-form" className="admin-button admin-button--primary">Adicionar</button></>}><form id="credit-form" className="admin-form" onSubmit={grant}><label>Quantidade de créditos<input type="number" min="1" value={creditAmount} onChange={(event) => setCreditAmount(event.currentTarget.value)} autoFocus /></label></form></AdminModal> : null}{manualPaymentsOpen ? <ManualPartnerPayments onClose={() => setManualPaymentsOpen(false)} onToast={onToast} /> : null}</div>;
}

type PaymentCard = { provider: string; label: string; data: JsonRecord };
const PAYMENT_PROVIDERS = [
  { provider: "mercadopago", label: "Mercado Pago Pix" },
  { provider: "polopag", label: "PoloPag Pix" },
  { provider: "mercadopago/checkout", label: "Mercado Pago Checkout" },
  { provider: "mercadopago/marketplace", label: "Mercado Pago Marketplace / Split" },
] as const;

const CHECKOUT_PAYMENT_TYPES = [
  ["credit_card", "Crédito"],
  ["debit_card", "Débito"],
  ["ticket", "Boleto"],
  ["bank_transfer", "Transferência"],
  ["atm", "ATM"],
  ["account_money", "Saldo Mercado Pago"],
] as const;

function PaymentConfigEditor({ card, onClose, onSaved, onReveal, onToast }: { card: PaymentCard; onClose: () => void; onSaved: () => void; onReveal: () => void; onToast: (message: string, success?: boolean) => void }) {
  const isPolo = card.provider === "polopag";
  const isCheckout = card.provider === "mercadopago/checkout";
  const isMarketplace = card.provider === "mercadopago/marketplace";
  const [active, setActive] = useState(card.data.isActive === true);
  const [displayName, setDisplayName] = useState(text(card.data.displayName, card.label));
  const [credential, setCredential] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [webhook, setWebhook] = useState(text(card.data.webhookUrl || card.data.notificationUrl, ""));
  const [expiration, setExpiration] = useState(text(card.data.pixExpirationMinutes, "30"));
  const [amounts, setAmounts] = useState(Array.isArray(card.data.amountOptions) ? card.data.amountOptions.join(", ") : "");
  const [instructions, setInstructions] = useState(text(card.data.instructions, ""));
  const [marketplaceClientId, setMarketplaceClientId] = useState(text(card.data.marketplaceClientId, ""));
  const [marketplaceClientSecret, setMarketplaceClientSecret] = useState("");
  const [paymentTypes, setPaymentTypes] = useState<Set<string>>(() => new Set(Array.isArray(card.data.allowedPaymentTypes) ? card.data.allowedPaymentTypes.map(String) : []));
  const [pixCheckout, setPixCheckout] = useState(Array.isArray(card.data.allowedPaymentMethods) && card.data.allowedPaymentMethods.includes("pix"));
  const [clearCredential, setClearCredential] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasCredential = card.data.isConfigured === true || card.data.hasAccessToken === true || card.data.hasApiKey === true;
  const togglePaymentType = (key: string) => setPaymentTypes((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isMarketplace) {
      if (!clearCredential && (!marketplaceClientId.trim() || (!marketplaceClientSecret.trim() && card.data.credentialFields && typeof card.data.credentialFields === "object" && (card.data.credentialFields as JsonRecord).marketplaceClientSecret !== true))) {
        onToast("Informe o Client ID e o Client Secret do Mercado Pago.", false);
        return;
      }
    } else {
      if (!displayName.trim()) { onToast("Informe o nome do método de pagamento.", false); return; }
      if (active && clearCredential) { onToast("Desative o método antes de remover a credencial.", false); return; }
      if (active && !hasCredential && !credential.trim()) { onToast("Informe a credencial para ativar este método.", false); return; }
      if (isCheckout && active && paymentTypes.size === 0 && !pixCheckout) { onToast("Selecione ao menos uma forma de pagamento.", false); return; }
    }
    const amountOptions = amounts.split(/[,;\n]+/).map((entry) => Number(entry.trim().replace(/[^0-9.-]/g, ""))).filter((value) => Number.isFinite(value) && value > 0);
    const pixExpirationMinutes = Number.parseInt(expiration, 10);
    if (!isCheckout && !isMarketplace && (!Number.isInteger(pixExpirationMinutes) || pixExpirationMinutes <= 0)) { onToast("Informe uma expiração de Pix válida.", false); return; }
    const payload: JsonRecord = isMarketplace
      ? { marketplaceClientId: marketplaceClientId.trim(), ...(marketplaceClientSecret.trim() ? { marketplaceClientSecret: marketplaceClientSecret.trim() } : {}), clearMarketplaceCredentials: clearCredential }
      : {
          isActive: active,
          displayName: displayName.trim(),
          clearCredential,
          amountOptions,
          ...(credential.trim() ? { [isPolo ? "apiKey" : "accessToken"]: credential.trim() } : {}),
          ...(isPolo ? { webhookUrl: webhook.trim() } : { notificationUrl: webhook.trim() }),
          ...(!isPolo && publicKey.trim() ? { publicKey: publicKey.trim() } : {}),
          ...(!isPolo && !isCheckout && pixKey.trim() ? { pixKey: pixKey.trim() } : {}),
          ...(!isCheckout ? { pixExpirationMinutes, instructions: instructions.trim() } : {}),
          ...(isCheckout ? { allowedPaymentTypes: Array.from(paymentTypes), allowedPaymentMethods: pixCheckout ? ["pix"] : [], ...(marketplaceClientId.trim() ? { marketplaceClientId: marketplaceClientId.trim() } : {}), ...(marketplaceClientSecret.trim() ? { marketplaceClientSecret: marketplaceClientSecret.trim() } : {}) } : {}),
        };
    setSaving(true);
    try {
      await adminApi.paymentConfig(card.provider, payload);
      onToast(clearCredential ? "Credencial removida com segurança." : "Configuração de pagamento salva.", true);
      onSaved();
      onClose();
    } catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };
  return <AdminModal title={`Editar ${card.label}`} subtitle="Credenciais sensíveis permanecem protegidas no servidor." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="payment-config-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : clearCredential ? "Remover credencial" : "Salvar"}</button></>}>
    <form id="payment-config-form" className="admin-form admin-form--grid" onSubmit={submit}>
      {isMarketplace ? <>
        <label>Marketplace Client ID<input value={marketplaceClientId} onChange={(event) => setMarketplaceClientId(event.currentTarget.value)} autoFocus /></label>
        <label>Marketplace Client Secret <small>(deixe vazio para manter)</small><input type="password" value={marketplaceClientSecret} onChange={(event) => setMarketplaceClientSecret(event.currentTarget.value)} autoComplete="new-password" /></label>
        <p className="admin-form-help admin-form__full"><ExternalLink size={15} />Redirect URI: {text(card.data.redirectUri, "/api/payments/mercadopago/oauth/callback")}</p>
      </> : <>
        <label className="admin-toggle-row admin-form__full"><span>Método ativo</span><button type="button" className={`admin-switch ${active ? "is-on" : ""}`} aria-pressed={active} onClick={() => setActive((value) => !value)}><i /></button></label>
        <label>Nome exibido<input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} autoFocus /></label>
        <label>{isPolo ? "Nova chave da API" : "Novo access token"} <small>(deixe vazio para manter)</small><span className="admin-input-action"><input type="password" value={credential} onChange={(event) => setCredential(event.currentTarget.value)} autoComplete="new-password" /><button type="button" className="admin-icon-button" onClick={onReveal} aria-label="Visualizar credenciais"><Eye size={16} /></button></span></label>
        {!isPolo ? <label>Nova public key <small>(deixe vazio para manter)</small><input type="password" value={publicKey} onChange={(event) => setPublicKey(event.currentTarget.value)} autoComplete="new-password" /></label> : null}
        {!isPolo && !isCheckout ? <label>Nova chave Pix <small>(deixe vazio para manter)</small><input type="password" value={pixKey} onChange={(event) => setPixKey(event.currentTarget.value)} autoComplete="new-password" /></label> : null}
        <label>Webhook / URL de notificação<input value={webhook} onChange={(event) => setWebhook(event.currentTarget.value)} /></label>
        <label className="admin-form__full">Valores sugeridos<input value={amounts} onChange={(event) => setAmounts(event.currentTarget.value)} placeholder="10, 25, 50" /><small>Separe os valores por vírgula.</small></label>
        {!isCheckout ? <><label>Expiração do Pix (min)<input type="number" min="1" value={expiration} onChange={(event) => setExpiration(event.currentTarget.value)} /></label><label className="admin-form__full">Instruções ao cliente<textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.currentTarget.value)} /></label></> : <fieldset className="admin-form__full admin-permissions"><legend>Formas aceitas no checkout</legend>{CHECKOUT_PAYMENT_TYPES.map(([key, label]) => <label className="admin-toggle-row" key={key}><span>{label}</span><button type="button" className={`admin-switch ${paymentTypes.has(key) ? "is-on" : ""}`} aria-pressed={paymentTypes.has(key)} onClick={() => togglePaymentType(key)}><i /></button></label>)}<label className="admin-toggle-row"><span>Pix</span><button type="button" className={`admin-switch ${pixCheckout ? "is-on" : ""}`} aria-pressed={pixCheckout} onClick={() => setPixCheckout((value) => !value)}><i /></button></label></fieldset>}
        {isCheckout ? <><label>Marketplace Client ID <small>(opcional)</small><input value={marketplaceClientId} onChange={(event) => setMarketplaceClientId(event.currentTarget.value)} /></label><label>Marketplace Client Secret <small>(deixe vazio para manter)</small><input type="password" value={marketplaceClientSecret} onChange={(event) => setMarketplaceClientSecret(event.currentTarget.value)} autoComplete="new-password" /></label></> : null}
      </>}
      <label className="admin-toggle-row admin-form__full"><span>{isMarketplace ? "Remover credenciais Marketplace" : "Remover credencial salva"}</span><button type="button" className={`admin-switch ${clearCredential ? "is-on" : ""}`} aria-pressed={clearCredential} onClick={() => setClearCredential((value) => !value)}><i /></button></label>
    </form>
  </AdminModal>;
}

function PaymentsWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [cards, setCards] = useState<PaymentCard[]>([]);
  const [history, setHistory] = useState<JsonRecord[]>([]);
  const [mode, setMode] = useState<"config" | "history">("config");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editing, setEditing] = useState<PaymentCard | null>(null);
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState<JsonRecord | null>(null);
  const [revealProvider, setRevealProvider] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled(PAYMENT_PROVIDERS.map((item) => adminApi.paymentConfig(item.provider)));
      setCards(PAYMENT_PROVIDERS.map((item, index) => ({ ...item, data: results[index].status === "fulfilled" ? ((results[index] as PromiseFulfilledResult<JsonRecord>).value.config as JsonRecord || (results[index] as PromiseFulfilledResult<JsonRecord>).value) : { error: asError((results[index] as PromiseRejectedResult).reason) } })));
    } catch (error) { onToast(asError(error), false); }
    finally { setLoading(false); }
  }, [onToast]);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try { const response = await adminApi.paymentHistory(); setHistory(listValue(response.events)); }
    catch (error) { onToast(asError(error), false); }
    finally { setHistoryLoading(false); }
  }, [onToast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (mode === "history") void loadHistory(); }, [loadHistory, mode]);
  const credentialProvider = (provider: string) => provider === "polopag" ? "polopag_pix" : provider === "mercadopago/checkout" || provider === "mercadopago/marketplace" ? "mercadopago_checkout" : "mercadopago_pix";
  const reveal = async () => { if (!password.trim() || !revealProvider) return; try { const response = await adminApi.revealPaymentCredentials({ provider: credentialProvider(revealProvider), password }); const credentials = response.credentials; setRevealed(credentials && typeof credentials === "object" ? credentials as JsonRecord : response); setRevealProvider(""); setPassword(""); onToast("Credenciais liberadas temporariamente.", true); } catch (error) { onToast(asError(error), false); } };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[5]} onRefresh={() => void (mode === "history" ? loadHistory() : load())} /><div className="admin-segmented" role="tablist" aria-label="Pagamentos"><button type="button" className={mode === "config" ? "is-active" : ""} onClick={() => setMode("config")} role="tab" aria-selected={mode === "config"}><Settings size={16} />Configurações</button><button type="button" className={mode === "history" ? "is-active" : ""} onClick={() => setMode("history")} role="tab" aria-selected={mode === "history"}><Receipt size={16} />Histórico</button></div>{mode === "history" ? (historyLoading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando histórico…</div> : history.length === 0 ? <div className="admin-empty"><Receipt size={30} /><strong>Nenhuma venda registrada</strong><span>Vendas e confirmações aparecerão aqui.</span></div> : <div className="admin-record-list">{history.map((event, index) => <AdminRecordCard key={recordId(event) || index} record={{ ...event, title: text(event.customerName, `Venda #${recordId(event)}`), email: event.customerEmail, status: event.status }} extra={<small>{text(event.planName || event.message, "Sem detalhes")} · {money(event.amount)} · {dateTime(event.createdAt)}</small>} />)}</div>) : loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando métodos…</div> : <div className="admin-card-grid">{cards.map((card) => <article className="admin-info-card" key={card.provider}><div className="admin-info-card__head"><span className="admin-avatar"><CreditCard size={18} /></span><div><strong>{card.label}</strong><AdminStatusPill value={card.data.isActive ? "Ativo" : "Não configurado"} /></div><button type="button" className="admin-icon-button" onClick={() => setEditing(card)} title="Editar"><Pencil size={16} /></button><button type="button" className="admin-icon-button" onClick={() => setRevealProvider(card.provider)} title="Visualizar credenciais"><Eye size={16} /></button></div><dl><div><dt>Nome exibido</dt><dd>{text(card.data.displayName, "Não definido")}</dd></div><div><dt>Webhook</dt><dd className="admin-break-word">{text(card.data.notificationUrl || card.data.webhookUrl || card.data.redirectUri, "Padrão do sistema")}</dd></div><div><dt>Credencial</dt><dd>{card.data.hasAccessToken || card.data.hasApiKey || card.data.isConfigured ? "Configurada e protegida" : "Não configurada"}</dd></div></dl></article>)}</div>}{editing ? <PaymentConfigEditor card={editing} onClose={() => setEditing(null)} onSaved={() => void load()} onReveal={() => { setRevealProvider(editing.provider); setEditing(null); }} onToast={onToast} /> : null}{revealProvider ? <AdminModal title="Confirmar credenciais" subtitle="Digite a senha do administrador para revelar os dados deste método." onClose={() => setRevealProvider("")} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={() => setRevealProvider("")}>Cancelar</button><button type="button" className="admin-button admin-button--primary" onClick={() => void reveal()}>Confirmar</button></>}><form className="admin-form" onSubmit={(event) => { event.preventDefault(); void reveal(); }}><label>Senha administrativa<input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoFocus /></label></form></AdminModal> : null}{revealed ? <AdminModal title="Credenciais protegidas" subtitle="Não compartilhe estes dados. O modal pode ser fechado a qualquer momento." onClose={() => setRevealed(null)} footer={<button type="button" className="admin-button admin-button--primary" onClick={() => setRevealed(null)}>Fechar</button>}><pre className="admin-secret-block">{JSON.stringify(revealed, null, 2)}</pre></AdminModal> : null}</div>;
}

type CampaignDraft = { name: string; description: string; templateId: string; scheduledAt: string };
function CampaignsWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [campaigns, setCampaigns] = useState<JsonRecord[]>([]); const [templates, setTemplates] = useState<JsonRecord[]>([]); const [hasCredentials, setHasCredentials] = useState(false); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<JsonRecord | null>(null); const [detail, setDetail] = useState<JsonRecord | null>(null); const [editor, setEditor] = useState(false); const [draft, setDraft] = useState<CampaignDraft>({ name: "", description: "", templateId: "", scheduledAt: "" }); const [saving, setSaving] = useState(false); const [working, setWorking] = useState(false);
  const campaignId = (item: JsonRecord | null) => text(item?.campaignId || item?.id, "");
  const load = useCallback(async () => { setLoading(true); try { const [campaignResponse, templateResponse] = await Promise.all([adminApi.campaignsAdmin(), adminApi.metaTemplates()]); const list = listValue(campaignResponse.campaigns); setCampaigns(list); setTemplates(listValue(templateResponse.templates)); setHasCredentials(templateResponse.hasCredentials === true); setSelected((current) => current ? list.find((item) => campaignId(item) === campaignId(current)) || null : list[0] || null); } catch (error) { onToast(asError(error), false); } finally { setLoading(false); } }, [onToast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = campaignId(selected); if (!id) { setDetail(null); return; } let cancelled = false; void adminApi.campaignDetail(id).then((response) => { if (!cancelled) setDetail((response.campaign || response) as JsonRecord); }).catch((error) => { if (!cancelled) onToast(asError(error), false); }); return () => { cancelled = true; }; }, [onToast, selected]);
  const create = async (event: FormEvent) => { event.preventDefault(); if (!hasCredentials) { onToast("Configure as credenciais Meta antes de criar uma campanha.", false); return; } if (draft.name.trim().length < 2 || !draft.templateId) { onToast("Informe nome e modelo da campanha.", false); return; } setSaving(true); try { const response = await adminApi.createCampaign({ name: draft.name.trim(), description: draft.description.trim() || null, templateId: draft.templateId, scheduledAt: draft.scheduledAt || null }); const next = (response.campaign || {}) as JsonRecord; onToast("Campanha criada.", true); setEditor(false); setDraft({ name: "", description: "", templateId: "", scheduledAt: "" }); await load(); if (campaignId(next)) setSelected(next); } catch (error) { onToast(asError(error), false); } finally { setSaving(false); } };
  const action = async (kind: "start" | "send") => { const id = campaignId(selected); if (!id || working) return; setWorking(true); try { const response = await adminApi.campaignAction(id, kind); const next = (response.campaign || {}) as JsonRecord; setCampaigns((current) => current.map((item) => campaignId(item) === id ? { ...item, ...next } : item)); setSelected((current) => current ? { ...current, ...next } : current); setDetail((current) => current ? { ...current, ...next } : current); onToast(text(response.message, kind === "start" ? "Campanha colocada na fila." : "Processamento iniciado."), true); } catch (error) { onToast(asError(error), false); } finally { setWorking(false); } };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[6]} onRefresh={() => void load()} refreshing={loading} actions={<button type="button" className="admin-button admin-button--primary" onClick={() => setEditor(true)}><Plus size={16} />Nova campanha</button>} />{loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando campanhas…</div> : <div className="admin-campaign-layout"><section className="admin-subpanel admin-campaign-list"><header><div><h2>Campanhas</h2><p>{campaigns.length} cadastrada(s)</p></div><Megaphone size={19} /></header>{campaigns.length === 0 ? <AdvancedEmpty icon={Megaphone} title="Nenhuma campanha" message="Crie uma campanha Meta para iniciar envios administrativos." action={<button type="button" className="admin-button admin-button--primary" onClick={() => setEditor(true)}><Plus size={15} />Criar campanha</button>} /> : <div className="admin-mini-list">{campaigns.map((campaign, index) => <button type="button" className={`admin-mini-row admin-mini-row--button ${campaignId(selected) === campaignId(campaign) ? "is-selected" : ""}`} key={campaignId(campaign) || index} onClick={() => setSelected(campaign)}><span className="admin-avatar"><Megaphone size={16} /></span><div><strong>{recordTitle(campaign, "Campanha")}</strong><small>{text(campaign.status, "draft")} · {text(campaign.stats && typeof campaign.stats === "object" ? (campaign.stats as JsonRecord).pendingContacts : 0, "0")} pendentes</small></div><AdminStatusPill value={text(campaign.status, "draft")} /></button>)}</div>}</section><section className="admin-subpanel admin-campaign-detail">{selected ? <><header><div><h2>{recordTitle(selected, "Campanha")}</h2><p>{text(selected.description, "Sem descrição")}</p></div><AdminStatusPill value={text(selected.status, "draft")} /></header><dl className="admin-detail-list"><div><dt>Modelo Meta</dt><dd>{text(selected.templateId, "Não informado")}</dd></div><div><dt>Agendamento</dt><dd>{dateTime(selected.scheduledAt)}</dd></div><div><dt>Contatos pendentes</dt><dd>{text((selected.stats as JsonRecord | undefined)?.pendingContacts, "0")}</dd></div><div><dt>Último erro</dt><dd>{text(detail?.lastError || selected.lastError, "Nenhum")}</dd></div></dl><div className="admin-form-actions"><button type="button" className="admin-button admin-button--ghost" onClick={() => void action("start")} disabled={working || !["draft", "paused"].includes(text(selected.status))}><Zap size={15} />{working ? "Processando…" : "Colocar na fila"}</button><button type="button" className="admin-button admin-button--primary" onClick={() => void action("send")} disabled={working || !["queued", "sending"].includes(text(selected.status))}><Send size={15} />Processar agora</button></div>{detail && Array.isArray(detail.contacts) ? <div className="admin-campaign-contacts"><h3>Destinatários ({detail.contacts.length})</h3><div className="admin-mini-list">{(detail.contacts as JsonRecord[]).slice(0, 80).map((contact, index) => <div className="admin-mini-row" key={recordId(contact) || index}><span className="admin-avatar">{initials(contact.name || contact.phone)}</span><div><strong>{text(contact.name || contact.phone, "Contato")}</strong><small>{text(contact.status, "pending")}</small></div><AdminStatusPill value={text(contact.status, "pending")} /></div>)}</div></div> : null}</> : <AdvancedEmpty icon={Megaphone} title="Selecione uma campanha" message="Os detalhes e ações aparecerão aqui." />}</section></div>}{editor ? <AdminModal title="Nova campanha" subtitle="Crie um envio usando um modelo aprovado pela Meta." onClose={() => setEditor(false)} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={() => setEditor(false)}>Cancelar</button><button type="submit" form="campaign-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Criando…" : "Criar campanha"}</button></>}><form id="campaign-form" className="admin-form" onSubmit={create}><label>Nome<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))} autoFocus required /></label><label>Descrição<textarea rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.currentTarget.value }))} /></label><label>Modelo Meta<select value={draft.templateId} onChange={(event) => setDraft((current) => ({ ...current, templateId: event.currentTarget.value }))} required><option value="">{templates.length ? "Selecione um modelo" : "Nenhum modelo encontrado"}</option>{templates.map((template) => <option key={text(template.templateId || template.id)} value={text(template.templateId || template.id)}>{recordTitle(template, text(template.templateId, "Modelo"))}</option>)}</select></label><label>Agendar para <small>(opcional)</small><input type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft((current) => ({ ...current, scheduledAt: event.currentTarget.value }))} /></label>{!hasCredentials ? <p className="admin-form-help"><AlertTriangle size={15} />Configure as credenciais Meta na seção BotInterage antes de criar.</p> : null}</form></AdminModal> : null}</div>;
}

function BotInterageConfigEditor({ initial, onClose, onSaved, onToast }: { initial: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [enabled, setEnabled] = useState(initial.enabled !== false && initial.isActive !== false);
  const [provider, setProvider] = useState(text(initial.provider, "gemini"));
  const [model, setModel] = useState(text(initial.model, "gemini-2.0-flash"));
  const [apiKey, setApiKey] = useState("");
  const [listenAudio, setListenAudio] = useState(initial.listenAudio === true || initial.ouviraudiobotinterage === true);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try { await adminApi.botInterageSettings({ enabled, provider, model, listenAudio, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }); onToast("Configuração do BotInterage salva.", true); onSaved(); onClose(); }
    catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };
  return <AdminModal title="Configurar BotInterage" subtitle="Ativação, provedor e recursos de áudio ficam sincronizados com o painel Flutter." onClose={onClose} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="botinterage-config-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar configuração"}</button></>}><form id="botinterage-config-form" className="admin-form admin-form--grid" onSubmit={submit}><label className="admin-toggle-row admin-form__full"><span>BotInterage ativo</span><button type="button" className={`admin-switch ${enabled ? "is-on" : ""}`} aria-pressed={enabled} onClick={() => setEnabled((value) => !value)}><i /></button></label><label>Provedor<select value={provider} onChange={(event) => setProvider(event.currentTarget.value)}><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="chatgpt_system">ChatGPT do sistema</option></select></label><label>Modelo<input value={model} onChange={(event) => setModel(event.currentTarget.value)} /></label><label>Nova chave de API <small>(opcional, mantém a atual)</small><input type="password" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} autoComplete="new-password" /></label><label className="admin-toggle-row"><span>Ouvir e responder áudio</span><button type="button" className={`admin-switch ${listenAudio ? "is-on" : ""}`} aria-pressed={listenAudio} onClick={() => setListenAudio((value) => !value)}><i /></button></label></form></AdminModal>;
}

function BotInterageTtsWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [config, setConfig] = useState<JsonRecord>({});
  const [users, setUsers] = useState<JsonRecord[]>([]);
  const [voices, setVoices] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configResponse, usersResponse, voicesResponse] = await Promise.allSettled([
        adminApi.botInterageTts(),
        adminApi.botInterageTtsUsers(),
        adminApi.botInterageTtsVoices(),
      ]);
      if (configResponse.status === "fulfilled") setConfig((configResponse.value.config || configResponse.value) as JsonRecord);
      if (usersResponse.status === "fulfilled") setUsers(listValue(usersResponse.value.users || usersResponse.value.allowedUsers));
      if (voicesResponse.status === "fulfilled") setVoices(listValue(voicesResponse.value.voices));
      const failed = [configResponse, usersResponse, voicesResponse].find((result) => result.status === "rejected");
      if (failed?.status === "rejected") onToast(asError(failed.reason), false);
    } finally { setLoading(false); }
  }, [onToast]);
  useEffect(() => { void load(); }, [load]);
  const addUser = async (event: FormEvent) => {
    event.preventDefault();
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) { onToast("Informe um ID de usuário válido.", false); return; }
    setAdding(true);
    try { await adminApi.addBotInterageTtsUser(id); setUserId(""); onToast("Usuário autorizado para TTS.", true); void load(); }
    catch (error) { onToast(asError(error), false); }
    finally { setAdding(false); }
  };
  const removeUser = async (item: JsonRecord) => {
    const id = item.userId || item.id;
    if (!id) return;
    try { await adminApi.removeBotInterageTtsUser(id as string); onToast("Permissão TTS removida.", true); void load(); }
    catch (error) { onToast(asError(error), false); }
  };
  return <><section className="admin-subpanel admin-tts-panel"><header><div><h2>API privada de TTS</h2><p>Vozes clonadas, voz padrão e permissões de áudio do BotInterage.</p></div><button type="button" className="admin-button admin-button--ghost" onClick={() => setEditorOpen(true)}><Settings size={16} />Configurar</button></header>{loading ? <div className="admin-loading admin-loading--small"><Activity className="admin-spin" size={19} />Carregando TTS…</div> : <><div className="admin-tts-summary"><AdminStatusPill value={config.enabled ? "Ativo" : "Inativo"} /><span>Endpoint: {text(config.baseUrl, "Não configurado")}</span><span>Voz padrão: {text(config.defaultVoiceId, "Automática")}</span><span>Token: {config.hasToken ? "Configurado" : "Pendente"}</span></div><div className="admin-tts-grid"><div><h3>Vozes disponíveis</h3>{voices.length === 0 ? <p className="admin-form-help">Nenhuma voz retornada. Ative a API e sincronize um token válido.</p> : <div className="admin-mini-list">{voices.map((voice, index) => <div className="admin-mini-row" key={recordId(voice) || text(voice.voiceId, String(index))}><span className="admin-avatar"><Headphones size={16} /></span><div><strong>{text(voice.name || voice.voiceId, "Voz")}</strong><small>{text(voice.voiceId)}{voice.slug ? ` · !tts ${text(voice.slug)}` : ""}</small></div><a className="admin-icon-button" href={`/api/admin/botinterage-tts/preview?voiceId=${encodeURIComponent(text(voice.voiceId))}&text=${encodeURIComponent("Olá, esta é uma prévia da voz do BotInterage.")}`} target="_blank" rel="noreferrer" aria-label="Ouvir prévia"><Headphones size={16} /></a></div>)}</div>}</div><div><h3>Usuários autorizados</h3><form className="admin-inline-form" onSubmit={addUser}><input inputMode="numeric" value={userId} onChange={(event) => setUserId(event.currentTarget.value)} placeholder="ID do usuário" /><button type="submit" className="admin-button admin-button--primary" disabled={adding}><Plus size={15} />Liberar</button></form>{users.length === 0 ? <p className="admin-form-help">Nenhuma permissão específica cadastrada.</p> : <div className="admin-mini-list">{users.map((item, index) => <div className="admin-mini-row" key={recordId(item) || index}><span className="admin-avatar">{initials(recordTitle(item, "U"))}</span><div><strong>{recordTitle(item, `Usuário #${item.userId || item.id}`)}</strong><small>{text(item.email || item.userId)}</small></div><button type="button" className="admin-icon-button" onClick={() => void removeUser(item)} aria-label="Remover permissão"><Trash2 size={15} /></button></div>)}</div>}</div></div></>}</section>{editorOpen ? <TtsConfigEditor initial={config} onClose={() => setEditorOpen(false)} onSaved={() => void load()} onToast={onToast} /> : null}</>;
}

function TtsConfigEditor({ initial, onClose, onSaved, onToast }: { initial: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const [enabled, setEnabled] = useState(initial.enabled !== false);
  const [baseUrl, setBaseUrl] = useState(text(initial.baseUrl, "https://tts.botadmin.shop"));
  const [defaultVoiceId, setDefaultVoiceId] = useState(text(initial.defaultVoiceId));
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (clearToken && token.trim()) { onToast("Escolha entre limpar o token ou informar um novo token.", false); return; }
    setSaving(true);
    try { await adminApi.botInterageTts({ enabled, baseUrl: baseUrl.trim(), defaultVoiceId: defaultVoiceId.trim(), ...(clearToken ? { clearToken: true } : token.trim() ? { token: token.trim() } : {}) }); onToast("Configuração TTS salva.", true); onSaved(); onClose(); }
    catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };
  return <AdminModal title="Configurar API TTS" subtitle="As credenciais permanecem protegidas e o token vazio mantém o valor atual." onClose={onClose} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Cancelar</button><button type="submit" form="tts-config-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar configuração"}</button></>}><form id="tts-config-form" className="admin-form admin-form--grid" onSubmit={submit}><label className="admin-toggle-row admin-form__full"><span>API TTS ativa</span><button type="button" className={`admin-switch ${enabled ? "is-on" : ""}`} aria-pressed={enabled} onClick={() => setEnabled((value) => !value)}><i /></button></label><label className="admin-form__full">URL base<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} required /></label><label>voice_id padrão<input value={defaultVoiceId} onChange={(event) => setDefaultVoiceId(event.currentTarget.value)} placeholder="Opcional" /></label><label>Token novo <small>(vazio mantém)</small><input type="password" value={token} onChange={(event) => { setToken(event.currentTarget.value); setClearToken(false); }} autoComplete="new-password" /></label><label className="admin-toggle-row admin-form__full"><span>Limpar token atual</span><button type="button" className={`admin-switch ${clearToken ? "is-on" : ""}`} aria-pressed={clearToken} onClick={() => { setClearToken((value) => !value); setToken(""); }}><i /></button></label></form></AdminModal>;
}

function BotInterageWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [integrations, setIntegrations] = useState<JsonRecord[]>([]); const [allowedUsers, setAllowedUsers] = useState<JsonRecord[]>([]); const [systemConfig, setSystemConfig] = useState<JsonRecord>({}); const [loading, setLoading] = useState(true); const [userId, setUserId] = useState(""); const [configOpen, setConfigOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const [integrationResponse, usersResponse, configResponse] = await Promise.all([adminApi.botInterage(), adminApi.botInterageUsers(), adminApi.botInterageSettings()]); setIntegrations(listValue(integrationResponse.integrations)); setAllowedUsers(listValue(usersResponse.users || usersResponse.allowedUsers)); setSystemConfig((configResponse.config || configResponse) as JsonRecord); } catch (error) { onToast(asError(error), false); } finally { setLoading(false); } }, [onToast]);
  useEffect(() => { void load(); }, [load]);
  const add = async (event: FormEvent) => { event.preventDefault(); if (!userId.trim()) return; try { await adminApi.addBotInterageUser(userId.trim()); onToast("Usuário autorizado.", true); setUserId(""); void load(); } catch (error) { onToast(asError(error), false); } };
  const remove = async (id: unknown) => { try { await adminApi.removeBotInterageUser(id as string); onToast("Usuário removido da autorização.", true); void load(); } catch (error) { onToast(asError(error), false); } };
  const currentConfig = { ...(integrations[0] || {}), ...systemConfig };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[7]} onRefresh={() => void load()} actions={<button type="button" className="admin-button admin-button--ghost" onClick={() => setConfigOpen(true)}><Settings size={16} />Sistema</button>} /><div className="admin-two-column"><section className="admin-subpanel"><header><div><h2>Integrações</h2><p>Provedores configurados no BotInterage.</p></div><Bot size={20} /></header>{loading ? <div className="admin-loading"><Activity className="admin-spin" size={20} />Carregando…</div> : integrations.length === 0 ? <div className="admin-empty admin-empty--small"><Bot size={25} /><span>Nenhuma integração cadastrada.</span></div> : integrations.map((item, index) => <AdminRecordCard key={recordId(item) || index} record={{ ...item, title: recordTitle(item, "Integração"), email: text(item.provider, "Provedor"), status: item.hasKey || item.isConfigured ? "Pronto" : "Sem chave" }} extra={<small>{text(item.model, "Modelo padrão")} · atualizado {dateTime(item.updatedAt)}</small>} actions={<button type="button" className="admin-icon-button" onClick={() => setConfigOpen(true)} aria-label="Configurar integração"><Pencil size={16} /></button>} />)}</section><section className="admin-subpanel"><header><div><h2>Usuários autorizados</h2><p>Controle quem pode usar as integrações de IA.</p></div><ShieldCheck size={20} /></header><form className="admin-inline-form" onSubmit={add}><input value={userId} onChange={(event) => setUserId(event.currentTarget.value)} placeholder="ID do usuário" /><button type="submit" className="admin-button admin-button--primary"><Plus size={16} />Adicionar</button></form>{allowedUsers.length === 0 ? <div className="admin-empty admin-empty--small"><Users size={25} /><span>Nenhum usuário autorizado.</span></div> : <div className="admin-mini-list">{allowedUsers.map((item, index) => <div className="admin-mini-row" key={recordId(item) || index}><span className="admin-avatar">{initials(recordTitle(item))}</span><div><strong>{recordTitle(item, `Usuário #${recordId(item)}`)}</strong><small>{text(item.email || item.userId)}</small></div><button type="button" className="admin-icon-button" onClick={() => void remove(item.userId || item.id)} aria-label="Remover"><Trash2 size={16} /></button></div>)}</div>}</section></div><BotInterageTtsWorkspace onToast={onToast} />{configOpen ? <BotInterageConfigEditor initial={currentConfig} onClose={() => setConfigOpen(false)} onSaved={() => void load()} onToast={onToast} /> : null}</div>;
}

function SystemInstanceEditor({ initial, onClose, onSaved, onToast }: { initial: JsonRecord; onClose: () => void; onSaved: () => void; onToast: (message: string, success?: boolean) => void }) {
  const instance = initial.instance && typeof initial.instance === "object" ? initial.instance as JsonRecord : {};
  const servers = listValue(initial.servers);
  const [name, setName] = useState(text(instance.name, "BotAdmin Verificações"));
  const [phone, setPhone] = useState(text(instance.phone, ""));
  const [serverId, setServerId] = useState(text(instance.serverId || servers[0]?.id, ""));
  const [saving, setSaving] = useState(false);
  const [pairing, setPairing] = useState<JsonRecord | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!phone.trim()) { onToast("Informe o número da instância operacional.", false); return; }
    if (!instance.id && !serverId) { onToast("Selecione o servidor da instância.", false); return; }
    setSaving(true);
    try {
      const response = await adminApi.systemInstance({ name: name.trim(), phone: phone.trim(), ...(serverId ? { serverId: Number(serverId) } : {}) }, instance.id ? "PUT" : "POST");
      onToast(instance.id ? "Instância operacional atualizada." : "Instância operacional criada.", true);
      onSaved();
      if (!instance.id) setPairing((response.data || {}) as JsonRecord);
    } catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };
  const pair = async () => {
    setSaving(true);
    try {
      const response = await adminApi.systemInstancePair();
      setPairing((response.data || response) as JsonRecord);
      onToast("Dados de pareamento gerados.", true);
    } catch (error) { onToast(asError(error), false); }
    finally { setSaving(false); }
  };
  const pairingCode = text(pairing?.code || pairing?.pairingCode || pairing?.phoneCode, "");
  const qr = text(pairing?.qrCode || pairing?.qr || pairing?.qrUrl, "");
  return <AdminModal title="Instância operacional" subtitle="Número usado nas confirmações do BotAdmin. A sessão não é desconectada ao salvar o nome." onClose={onClose} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={onClose}>Fechar</button><button type="button" className="admin-button admin-button--ghost" onClick={() => void pair()} disabled={saving || !instance.id}><KeyRound size={16} />Gerar pareamento</button><button type="submit" form="system-instance-form" className="admin-button admin-button--primary" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button></>}><form id="system-instance-form" className="admin-form admin-form--grid" onSubmit={save}><label>Nome exibido<input value={name} onChange={(event) => setName(event.currentTarget.value)} autoFocus /></label><label>Número do WhatsApp<input value={phone} onChange={(event) => setPhone(event.currentTarget.value)} placeholder="+55…" /></label>{!instance.id ? <label>Servidor<select value={serverId} onChange={(event) => setServerId(event.currentTarget.value)}><option value="">Selecione</option>{servers.map((server) => <option key={recordId(server)} value={recordId(server)}>{recordTitle(server, `Servidor #${recordId(server)}`)}</option>)}</select></label> : null}</form>{pairing ? <div className="admin-pairing-result"><strong>Pareamento</strong>{pairingCode ? <code>{pairingCode}</code> : null}{qr ? <a href={qr} target="_blank" rel="noreferrer">Abrir QR Code <ExternalLink size={13} /></a> : null}<pre>{JSON.stringify(pairing, null, 2)}</pre></div> : null}</AdminModal>;
}

const settingCards = [
  { key: "site", label: "Site e identidade", description: "Logo, nome, SEO e grupos oficiais", icon: LayoutDashboard },
  { key: "smtp", label: "SMTP e e-mails", description: "Redefinição de senha e notificações", icon: Send },
  { key: "firebase", label: "Firebase", description: "Push notifications e credenciais", icon: Activity },
  { key: "mobile", label: "Aplicativo", description: "Versão, pacote e atualização", icon: ExternalLink },
  { key: "whatsapp", label: "Verificação WhatsApp", description: "Regra de confirmação de cadastro", icon: ShieldCheck },
  { key: "system", label: "Instância do sistema", description: "Número usado nas confirmações", icon: Server },
  { key: "push", label: "Push e notificações", description: "Dispositivos inscritos para avisos", icon: Bell },
] as const;

function SettingsWorkspace({ onToast }: { onToast: (message: string, success?: boolean) => void }) {
  const [snapshot, setSnapshot] = useState<Record<string, JsonRecord>>({}); const [loading, setLoading] = useState(true); const [editing, setEditing] = useState<typeof settingCards[number] | null>(null); const [systemEditorOpen, setSystemEditorOpen] = useState(false); const [smtpTestOpen, setSmtpTestOpen] = useState(false); const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const load = useCallback(async () => { setLoading(true); try { const result = await adminApi.settingsSnapshot(); setSnapshot(result as Record<string, JsonRecord>); } catch (error) { onToast(asError(error), false); } finally { setLoading(false); } }, [onToast]); useEffect(() => { void load(); }, [load]);
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!editing) return; const formElement = event.currentTarget; const form = new FormData(formElement); const payload: JsonRecord = {}; form.forEach((value, key) => { if (key === "isActive" || key === "enabled") payload[key] = value === "on"; else payload[key] = String(value); }); formElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((input) => { payload[input.name] = input.checked; }); const endpoint = editing.key === "site" ? adminApi.siteSettings : editing.key === "smtp" ? adminApi.smtpSettings : editing.key === "firebase" ? adminApi.firebaseSettings : editing.key === "mobile" ? adminApi.mobileSettings : editing.key === "whatsapp" ? adminApi.whatsappVerification : adminApi.systemInstance; try { await endpoint(payload); onToast("Configuração salva.", true); setEditing(null); void load(); } catch (error) { onToast(asError(error), false); } };
  const sendSmtpTest = async (event: FormEvent) => { event.preventDefault(); if (!smtpTestEmail.includes("@")) { onToast("Informe um e-mail válido para o teste.", false); return; } try { const response = await adminApi.smtpTest(smtpTestEmail.trim()); onToast(text(response.message, "Teste SMTP enviado."), true); setSmtpTestOpen(false); setSmtpTestEmail(""); } catch (error) { onToast(asError(error), false); } };
  return <div className="admin-module"><AdminPanelHeader item={ADMIN_NAV[8]} onRefresh={() => void load()} actions={<button type="button" className="admin-button admin-button--ghost" onClick={() => setSmtpTestOpen(true)}><Send size={16} />Testar SMTP</button>} />{loading ? <div className="admin-loading"><Activity className="admin-spin" size={22} />Carregando configurações…</div> : <div className="admin-card-grid">{settingCards.map((card) => { const Icon = card.icon; const data = snapshot[card.key] || {}; const source = (data.config || data.settings || data.instance || data) as JsonRecord; const subscriberCount = Array.isArray(data.subscribers) ? data.subscribers.length : 0; const readOnly = card.key === "push"; return <article className="admin-info-card" key={card.key}><div className="admin-info-card__head"><span className="admin-avatar"><Icon size={18} /></span><div><strong>{card.label}</strong><span>{card.description}</span></div>{readOnly ? <span className="admin-readonly-badge">Somente leitura</span> : card.key === "system" ? <button type="button" className="admin-icon-button" onClick={() => setSystemEditorOpen(true)} aria-label="Gerenciar instância operacional"><Pencil size={16} /></button> : <button type="button" className="admin-icon-button" onClick={() => setEditing(card)} aria-label={`Editar ${card.label}`}><Pencil size={16} /></button>}</div><dl><div><dt>{card.key === "push" ? "Inscritos" : "Status"}</dt><dd>{card.key === "push" ? subscriberCount : <AdminStatusPill value={source.isActive === false || source.enabled === false ? "Desativado" : "Configurado"} />}</dd></div><div><dt>Atualizado</dt><dd>{dateTime(source.updatedAt)}</dd></div></dl></article>; })}</div>}{editing ? <AdminModal title={`Editar ${editing.label}`} subtitle={editing.description} onClose={() => setEditing(null)} wide footer={<><button type="button" className="admin-button admin-button--ghost" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" form="settings-form" className="admin-button admin-button--primary">Salvar</button></>}><form id="settings-form" className="admin-form admin-form--grid" onSubmit={save}>{Object.entries(((snapshot[editing.key] || {}).config || (snapshot[editing.key] || {}).settings || (snapshot[editing.key] || {}).instance || snapshot[editing.key] || {}) as JsonRecord).filter(([key, value]) => !/(secret|token|password|privateKey|accessKey)/i.test(key) && ["object", "function"].indexOf(typeof value) < 0).slice(0, 18).map(([key, value]) => <label key={key}>{key}<input name={key} defaultValue={typeof value === "boolean" ? undefined : String(value ?? "")} type={typeof value === "boolean" ? "checkbox" : "text"} defaultChecked={typeof value === "boolean" ? value : undefined} /></label>)}<p className="admin-form-help"><KeyRound size={15} />Credenciais sensíveis permanecem protegidas; use a área específica de pagamentos para revelação autenticada.</p></form></AdminModal> : null}{systemEditorOpen ? <SystemInstanceEditor initial={snapshot.system || {}} onClose={() => setSystemEditorOpen(false)} onSaved={() => void load()} onToast={onToast} /> : null}{smtpTestOpen ? <AdminModal title="Testar SMTP" subtitle="O servidor enviará uma mensagem real para confirmar a entrega." onClose={() => setSmtpTestOpen(false)} footer={<><button type="button" className="admin-button admin-button--ghost" onClick={() => setSmtpTestOpen(false)}>Cancelar</button><button type="submit" form="smtp-test-form" className="admin-button admin-button--primary">Enviar teste</button></>}><form id="smtp-test-form" className="admin-form" onSubmit={sendSmtpTest}><label>E-mail de destino<input type="email" value={smtpTestEmail} onChange={(event) => setSmtpTestEmail(event.currentTarget.value)} autoFocus required /></label></form></AdminModal> : null}</div>;
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<AdminSection>(sectionFromUrl);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [toast, setToast] = useState("");
  const [toastSuccess, setToastSuccess] = useState(false);
  const onToast = useCallback((message: string, success = false) => {
    setToast(message);
    setToastSuccess(success);
    window.setTimeout(() => setToast(""), 4500);
  }, []);
  useEffect(() => {
    const onPopState = () => setSection(sectionFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const changeSection = (next: AdminSection) => {
    setMobileMenuOpen(false);
    window.localStorage.setItem("botadmin.admin.section", next);
    if (next === section) return;
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.pushState({}, "", url.toString());
  };
  const activeRail = ADMIN_RAIL_NAV.find((item) => item.sections.includes(section)) || ADMIN_RAIL_NAV[0];
  const railMenu = activeRail.sections.map(adminNav);
  const normalizedSearch = menuSearch.trim().toLocaleLowerCase("pt-BR");
  const visibleMenu = normalizedSearch
    ? ADMIN_NAV.filter((item) => `${item.label} ${item.subtitle}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch))
    : railMenu;
  const content = section === "dashboard" ? <AdminDashboardWorkspace nav={adminNav("dashboard")} onToast={onToast} />
    : section === "servers" ? <AdminServersWorkspace nav={adminNav("servers")} onToast={onToast} />
    : section === "mega" ? <AdminMegaWorkspace nav={adminNav("mega")} onToast={onToast} />
    : section === "groups" ? <AdminGroupsWorkspace nav={adminNav("groups")} onToast={onToast} />
    : section === "affiliates" ? <AdminAffiliatesWorkspace nav={adminNav("affiliates")} onToast={onToast} />
    : section === "site" ? <AdminSiteWorkspace nav={adminNav("site")} onToast={onToast} />
    : section === "firebase" ? <AdminFirebaseWorkspace nav={adminNav("firebase")} onToast={onToast} />
    : section === "aplicativo" ? <AdminMobileWorkspace nav={adminNav("aplicativo")} onToast={onToast} />
    : section === "notificacoes" ? <AdminNotificationsWorkspace nav={adminNav("notificacoes")} onToast={onToast} />
    : section === "linksuteis" ? <AdminUsefulLinksWorkspace nav={adminNav("linksuteis")} onToast={onToast} />
    : section === "tutoriais" ? <AdminTutorialsWorkspace nav={adminNav("tutoriais")} onToast={onToast} />
    : section === "support" ? <SupportWorkspace onToast={onToast} />
    : section === "users" ? <UsersWorkspace onToast={onToast} />
    : section === "instances" ? <InstancesWorkspace onToast={onToast} />
    : section === "plans" ? <PlansWorkspace onToast={onToast} />
    : section === "partners" ? <PartnersWorkspace onToast={onToast} />
    : section === "payments" ? <PaymentsWorkspace onToast={onToast} />
    : section === "campaigns" ? <CampaignsWorkspace onToast={onToast} />
    : section === "botinterage" ? <BotInterageWorkspace onToast={onToast} />
    : <SettingsWorkspace onToast={onToast} />;
  return <div className="admin-app-shell">
    <aside className="admin-rail">
      <div className="admin-rail__brand"><img src="/images/brand/botadmin-logo.webp" alt="BotAdmin" /><span>Bot<span>Admin</span></span></div>
      <nav>{ADMIN_RAIL_NAV.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={activeRail.id === item.id ? "is-active" : ""} onClick={() => changeSection(item.sections[0])} title={item.label} aria-label={item.label}><Icon size={19} /><span>{item.label}</span></button>; })}</nav>
      <button type="button" className="admin-rail__logout" onClick={onLogout} title="Sair" aria-label="Sair"><LogOut size={18} /></button>
    </aside>
    <div className="admin-main">
      <header className="admin-mobile-header"><button type="button" className="admin-icon-button" onClick={() => setMobileMenuOpen(true)} aria-label="Abrir menu"><MoreVertical size={21} /></button><div className="admin-mobile-header__brand"><img src="/images/brand/botadmin-logo.webp" alt="BotAdmin" /><strong>Bot<span>Admin</span></strong></div><span className="admin-mobile-header__role">Administrador</span></header>
      {mobileMenuOpen ? <div className="admin-mobile-drawer-backdrop" role="presentation" onClick={() => setMobileMenuOpen(false)}><aside className="admin-mobile-drawer" onClick={(event) => event.stopPropagation()}><header><strong>Painel administrativo</strong><button type="button" className="admin-icon-button" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar"><X size={18} /></button></header>{ADMIN_RAIL_NAV.map((railItem) => <section className="admin-mobile-drawer__group" key={railItem.id}><h2>{railItem.label}</h2>{railItem.sections.map((sectionId) => { const item = adminNav(sectionId); const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "is-active" : ""} onClick={() => changeSection(item.id)}><Icon size={18} /><span><strong>{item.label}</strong><small>{item.subtitle}</small></span><ChevronRight size={16} /></button>; })}</section>)}<button type="button" className="admin-mobile-drawer__logout" onClick={onLogout}><LogOut size={17} />Sair da conta</button></aside></div> : null}
      <div className={`admin-workspace-body ${section === "support" ? "is-full-width" : ""}`}>
        {section !== "support" ? <section className="admin-section-pane"><header><div className="admin-section-pane__brand"><img src="/images/brand/botadmin-logo.webp" alt="BotAdmin" /><span>Bot<span>Admin</span></span></div><h2>{activeRail.label}</h2></header><label className="admin-section-search"><Search size={15} /><input value={menuSearch} onChange={(event) => setMenuSearch(event.currentTarget.value)} placeholder="Buscar no painel admin" />{menuSearch ? <button type="button" onClick={() => setMenuSearch("")} aria-label="Limpar busca"><X size={14} /></button> : null}</label><div className="admin-section-list">{visibleMenu.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "is-active" : ""} onClick={() => changeSection(item.id)}><span className="admin-section-list__icon"><Icon size={18} /></span><span><strong>{item.label}</strong><small>{item.subtitle}</small></span><ChevronRight size={15} /></button>; })}</div></section> : null}
        <main className="admin-content">{content}</main>
      </div>
      <nav className="admin-bottom-nav">{["dashboard", "support", "users", "instances", "campaigns"].map((sectionId) => { const item = adminNav(sectionId as AdminSection); const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "is-active" : ""} onClick={() => changeSection(item.id)}><Icon size={19} /><span>{item.label}</span></button>; })}<button type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Mais seções"><MoreVertical size={20} /><span>Mais</span></button></nav>
    </div>
    <Toast message={toast} success={toastSuccess} onClose={() => setToast("")} />
  </div>;
}

function AdminAccessDenied({ reason, onLogin }: { reason: string; onLogin: () => void }) {
  return <main className="admin-access"><ShieldCheck size={42} /><h1>Acesso administrativo necessário</h1><p>{reason}</p><button type="button" className="admin-button admin-button--primary" onClick={onLogin}><LogIn size={17} />Entrar como administrador</button></main>;
}

export function AdminApp() {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined); const [error, setError] = useState("");
  useEffect(() => { let cancelled = false; void apiSession().then((user) => { if (!cancelled) setSession(user); }).catch((cause) => { if (!cancelled) { setError(asError(cause)); setSession(null); } }); return () => { cancelled = true; }; }, []);
  const logout = async () => { try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } finally { window.location.assign("/sign-in"); } };
  if (session === undefined) return <main className="admin-boot"><Activity className="admin-spin" size={26} /><span>Carregando painel administrativo…</span></main>;
  if (!session) return <AdminAccessDenied reason={error || "Faça login para acessar os recursos administrativos."} onLogin={() => window.location.assign(`/sign-in?next=${encodeURIComponent("/dashboard/admin")}`)} />;
  if (session.role !== "admin") return <AdminAccessDenied reason="Sua conta não possui permissão de administrador." onLogin={() => window.location.assign("/dashboard/user")} />;
  return <AdminShell onLogout={() => void logout()} />;
}

async function apiSession(): Promise<SessionUser | null> {
  const response = await fetch("/api/auth/session", { credentials: "include", headers: { Accept: "application/json" } });
  const payload = (await response.json().catch(() => ({}))) as { user?: SessionUser | null; message?: string };
  if (!response.ok) throw new Error(payload.message || `Erro ${response.status}`);
  return payload.user || null;
}
