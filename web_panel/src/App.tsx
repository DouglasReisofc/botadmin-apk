import * as React from "react";
import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  Bell,
  BellRing,
  Bot,
  CarFront,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  ContactRound,
  Coins,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Image,
  LockKeyhole,
  KeyRound,
  LogOut,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  PawPrint,
  Phone,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Flag,
  Lightbulb,
  ShoppingBag,
  Smile,
  Tag,
  Ticket,
  Trophy,
  UserPlus,
  AppWindow,
  Star,
  SunMoon,
  List,
  UsersRound,
  Webhook,
  Workflow,
  X,
} from "lucide-react";
import {
  absoluteMediaUrl,
  api,
  type BotInstance,
  type ChatMessage,
  type ConversationAction,
  type ConversationThread,
  type GiphyMediaItem,
  type JsonRecord,
  type SessionUser,
  type SweepstakeGroupSnapshot,
  type SweepstakeSummary,
} from "./api";
import ProductionBroadcastWorkspace from "./BroadcastWorkspace";
import InfoTip from "./InfoTip";
import {
  AffiliatesWorkspace,
  PaymentsWorkspace,
  RafflesWorkspace,
} from "./CommerceWorkspaces";

const textOf = (value: unknown, fallback = "") =>
  value === null || value === undefined ? fallback : String(value);
const profileAboutText = (value: unknown) => {
  const text = textOf(value).trim();
  if (!text) return "";
  // Some Wuzapi versions expose the transport state as `status` in the same
  // envelope as the profile fields. It is not the WhatsApp recado/about.
  return /^(connected|conectado|connecting|conectando|reconnecting|reconectando|disconnected|desconectado|offline|online|logged[_ ]?in|aguardando[_ ]?(qr|pareamento)|inicializando|initializing)$/i.test(text)
    ? ""
    : text;
};
const fullPhoneText = (value: unknown, fallback = "Número não informado") => {
  const raw = textOf(value).trim();
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : raw || fallback;
};
const connectedInstance = (value: unknown) => {
  const status = String(value || "").toLocaleLowerCase("pt-BR");
  return /connected|conectado|conectada|online|pairing/.test(status) &&
    !/desconect|logged.?out/.test(status);
};

type Section =
  | "conversations"
  | "internalGroups"
  | "broadcasts"
  | "profiles"
  | "status"
  | "media"
  | "channels"
  | "communities"
  | "calls"
  | "groups"
  | "flows"
  | "raffles"
  | "store"
  | "affiliates"
  | "campaigns"
  | "payments"
  | "api"
  | "webhooks"
  | "settings";
type Filter =
  | "all"
  | "unread"
  | "private"
  | "groups"
  | "internal"
  | "channels"
  | "communities"
  | "archived";
type ConversationUiAction =
  | ConversationAction
  | "refresh"
  | "copy-id"
  | "copy-link"
  | "rotate-link"
  | "group-links"
  | "wallpaper"
  | "details"
  | "group-settings"
  | "toggle-bot";
type MessageUiAction =
  | "info"
  | "react"
  | "edit"
  | "pin"
  | "unpin"
  | "delete"
  | "interactive_reply"
  | "poll_vote";
type DirectoryAction =
  | "new-internal"
  | "join-internal"
  | "switch-profile"
  | "renew-profile"
  | "new-profile"
  | "new-conversation"
  | "support"
  | "theme"
  | "settings"
  | "download-app"
  | "favorites"
  | "resync"
  | "select"
  | "lists"
  | "mark-all-read"
  | "logout";

const sectionAliases: Record<string, Section> = {
  conversations: "conversations",
  conversas: "conversations",
  internalgroups: "internalGroups",
  broadcasts: "broadcasts",
  transmission: "broadcasts",
  transmissao: "broadcasts",
  profiles: "profiles",
  instances: "profiles",
  status: "status",
  media: "media",
  channels: "channels",
  communities: "communities",
  calls: "calls",
  groups: "groups",
  flows: "flows",
  tools: "flows",
  raffles: "raffles",
  store: "store",
  affiliates: "affiliates",
  campaigns: "campaigns",
  payments: "payments",
  apirest: "api",
  api: "api",
  webhooks: "webhooks",
  settings: "settings",
};

const initialSection = (): Section => {
  const value =
    new URLSearchParams(location.search).get("section")?.trim().toLowerCase() ||
    "";
  return sectionAliases[value] || "conversations";
};

type DashboardHistoryState = {
  __botadminDashboard?: true;
  view?: "directory" | "chat";
  section?: Section;
  threadKey?: string;
};

const readDashboardHistoryState = (): DashboardHistoryState => {
  const state = history.state;
  return state && typeof state === "object"
    ? (state as DashboardHistoryState)
    : {};
};

const writeDashboardHistory = (
  entry: Omit<DashboardHistoryState, "__botadminDashboard">,
  mode: "push" | "replace",
) => {
  const url = new URL(location.href);
  if (entry.section) url.searchParams.set("section", entry.section);
  const state: DashboardHistoryState = {
    ...readDashboardHistoryState(),
    __botadminDashboard: true,
    ...entry,
  };
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") history.pushState(state, "", target);
  else history.replaceState(state, "", target);
};

const persistSectionInUrl = (section: Section) => {
  const current = readDashboardHistoryState();
  writeDashboardHistory(
    {
      section,
      view: current.view === "chat" ? "chat" : "directory",
      ...(current.view === "chat" && current.threadKey
        ? { threadKey: current.threadKey }
        : {}),
    },
    "replace",
  );
};

const API_ORIGIN = "https://botadmin.shop";
const DIRECTORY_PAGE_SIZE = 40;
const brandLogo = `${API_ORIGIN}/images/brand/botadmin-logo.webp`;
const emptyLogo = `${API_ORIGIN}/images/brand/messages-empty-logo.png`;
const normalizePublicLink = (value: string) => {
  try {
    const url = new URL(value, API_ORIGIN);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname))
      url.hostname = "botadmin.shop";
    if (!url.protocol || !["http:", "https:"].includes(url.protocol))
      return value;
    return url.toString();
  } catch {
    return value;
  }
};

const copyText = async (value: string) => {
  const text = value.trim();
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the legacy selection API on browsers that block clipboard
    // access until a user gesture or when running from an insecure context.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
};

const navigation: Array<{
  section: Section;
  label: string;
  icon: typeof MessageCircle;
  dot?: boolean;
  dividerBefore?: boolean;
}> = [
  { section: "conversations", label: "Conversas", icon: MessageCircle },
  { section: "internalGroups", label: "Grupos BotAdmin", icon: UsersRound },
  { section: "broadcasts", label: "Transmissão", icon: RadioTower },
  { section: "profiles", label: "Perfis", icon: ContactRound, dot: true },
  { section: "status", label: "Status", icon: CircleDashed, dot: true },
  { section: "media", label: "Mídias", icon: Image, dot: true },
  {
    section: "calls",
    label: "Chamadas",
    icon: Phone,
    dot: true,
    dividerBefore: true,
  },
  { section: "flows", label: "Fluxos", icon: Workflow, dot: true },
  { section: "raffles", label: "Rifas", icon: Ticket },
  { section: "store", label: "Loja", icon: ShoppingBag },
  { section: "affiliates", label: "Afiliados", icon: Tag },
  { section: "payments", label: "Pagamentos", icon: BadgeDollarSign },
  { section: "api", label: "API REST", icon: Webhook },
];

const sectionMeta: Record<
  Section,
  { title: string; subtitle: string; icon: typeof MessageCircle }
> = {
  conversations: {
    title: "Conversas",
    subtitle: "Mensagens do WhatsApp e BotAdmin em tempo real.",
    icon: MessageCircle,
  },
  internalGroups: {
    title: "Grupos BotAdmin",
    subtitle: "Grupos privados criados dentro do BotAdmin.",
    icon: UsersRound,
  },
  broadcasts: {
    title: "Transmissão",
    subtitle: "Listas, modelos, agendamentos e acompanhamento dos envios.",
    icon: RadioTower,
  },
  profiles: {
    title: "Perfis WhatsApp",
    subtitle: "Instâncias, conexão e gerenciamento de perfis.",
    icon: ContactRound,
  },
  status: {
    title: "Status",
    subtitle: "Conteúdo, programação e status dos seus contatos.",
    icon: CircleDashed,
  },
  media: {
    title: "Mídias persistentes",
    subtitle: "Biblioteca de imagens, vídeos, áudios e documentos.",
    icon: Image,
  },
  channels: {
    title: "Canais",
    subtitle: "Acompanhe canais em uma área separada.",
    icon: RadioTower,
  },
  communities: {
    title: "Comunidades",
    subtitle: "Organize comunidades e seus grupos.",
    icon: UsersRound,
  },
  calls: {
    title: "Chamadas",
    subtitle: "Histórico e recursos de chamadas.",
    icon: Phone,
  },
  groups: {
    title: "Gerenciamento de grupos",
    subtitle: "Regras, automações e proteção dos grupos.",
    icon: ShieldCheck,
  },
  flows: {
    title: "Fluxos",
    subtitle: "Automações visuais e respostas inteligentes.",
    icon: Workflow,
  },
  raffles: {
    title: "Rifas e sorteios",
    subtitle: "Crie, acompanhe e sorteie participantes.",
    icon: Ticket,
  },
  store: {
    title: "Loja",
    subtitle: "Catálogo, pedidos e atendimento comercial.",
    icon: ShoppingBag,
  },
  affiliates: {
    title: "Afiliados",
    subtitle: "Links, campanhas e resultados de afiliados.",
    icon: Tag,
  },
  campaigns: {
    title: "Campanhas",
    subtitle: "Campanhas automáticas e acompanhamento dos envios.",
    icon: RadioTower,
  },
  payments: {
    title: "Pagamentos",
    subtitle: "Cobranças e integrações de pagamento.",
    icon: BadgeDollarSign,
  },
  api: {
    title: "API REST e webhooks",
    subtitle: "Integrações e eventos do seu painel.",
    icon: Webhook,
  },
  webhooks: {
    title: "Webhooks",
    subtitle: "Eventos e integrações em tempo real.",
    icon: Webhook,
  },
  settings: {
    title: "Configurações",
    subtitle: "Preferências, conta e segurança.",
    icon: Settings,
  },
};

const initials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "BA";
const dateValue = (thread: ConversationThread) =>
  new Date(
    thread.lastMessageAt ||
      thread.lastActivity ||
      thread.updatedAt ||
      thread.createdAt ||
      0,
  ).getTime() || 0;
const formatThreadTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const difference = Math.round((start - day) / 86_400_000);
  if (difference <= 0)
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  if (difference === 1) return "Ontem";
  if (difference < 7)
    return date.toLocaleDateString("pt-BR", { weekday: "long" });
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: date.getFullYear() === now.getFullYear() ? undefined : "2-digit",
  });
};
const threadTypeLabel = (thread: ConversationThread) =>
  thread.chatType === "internal_group"
    ? "BOTADMIN"
    : String(thread.chatType || "").includes("channel")
      ? "Canal"
      : String(thread.chatType || "").includes("communit")
        ? "Comunidade"
        : String(thread.chatType || "").includes("group")
          ? "Grupo"
        : "";
const isGroupThread = (thread: ConversationThread) =>
  thread.chatType === "internal_group" ||
  String(thread.chatType || "").includes("group") ||
  String(thread.chatType || "").includes("communit") ||
  normalizeChatIdentity(thread.chatJid).endsWith("@g.us");
const canManageGroupThread = (thread: ConversationThread) =>
  isGroupThread(thread) &&
  (thread.chatType === "internal_group"
    ? Boolean(thread.canManage)
    : Boolean(thread.linkedGroupId) || thread.instanceIsAdmin !== false);
const cacheKey = (name: string, userId: number) =>
  `botadmin.react.${userId}.${name}`;
const makeClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const failedAvatarUrls = new Set<string>();

function Avatar({
  name,
  src,
  small = false,
}: {
  name: string;
  src?: string | null;
  small?: boolean;
}) {
  const url = absoluteMediaUrl(src);
  const [failed, setFailed] = useState(() =>
    Boolean(url && failedAvatarUrls.has(url)),
  );
  useEffect(() => {
    setFailed(Boolean(url && failedAvatarUrls.has(url)));
  }, [url]);
  return (
    <div className={`avatar ${small ? "avatar--small" : ""}`}>
      <span>{initials(name)}</span>
      {url && !failed && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            failedAvatarUrls.add(url);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <img src={brandLogo} alt="BotAdmin" />
      {!compact && (
        <span>
          Bot <b>Admin</b>
        </span>
      )}
    </div>
  );
}

function Loader() {
  return (
    <div className="boot">
      <Brand />
      <div className="boot-caption">Carregando seu painel…</div>
      <div className="boot-track">
        <i />
      </div>
    </div>
  );
}

type LocalAuthMode = "login" | "signup" | "forgot";
type LocalSignupVerification = {
  token: string;
  mode: "user_sends_code" | "send_code";
  code?: string;
  whatsappUrl?: string;
  targetWhatsappNumber?: string;
  whatsappNumber?: string | null;
  instructions?: string;
};

const safeAuthNext = () => {
  const requested = new URLSearchParams(window.location.search).get("next") || "";
  return requested.startsWith("/") && !requested.startsWith("//")
    ? requested
    : "/dashboard/react/";
};

export function LocalLoginScreen({ redirectPath }: { redirectPath?: string } = {}) {
  const resetToken =
    new URLSearchParams(window.location.search).get("token")?.trim() || "";
  const [mode, setMode] = useState<LocalAuthMode>(() => {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/sign-up") return "signup";
    if (pathname === "/forgot-password" || pathname === "/reset-password")
      return "forgot";
    return "login";
  });
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [verification, setVerification] =
    useState<LocalSignupVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetStep, setResetStep] = useState<"request" | "verify" | "done">(
    resetToken ? "verify" : "request",
  );
  const authNext = redirectPath || safeAuthNext();

  const clearFeedback = () => {
    setError("");
    setNotice("");
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("botadmin.pending-signup-verification");
      if (!raw) return;
      const pending = JSON.parse(raw) as LocalSignupVerification;
      if (!pending?.token || !pending.mode) return;
      setMode("signup");
      setVerification(pending);
      setNotice("Retomamos a confirmação do seu cadastro.");
    } catch {
      sessionStorage.removeItem("botadmin.pending-signup-verification");
    }
  }, []);

  const selectMode = (next: LocalAuthMode) => {
    if (busy) return;
    setMode(next);
    setVerification(null);
    setVerificationCode("");
    setResetStep(resetToken ? "verify" : "request");
    clearFeedback();
  };

  const finishAuth = useCallback(() => {
    sessionStorage.removeItem("botadmin.pending-signup-verification");
    window.location.assign(authNext);
  }, [authNext]);

  useEffect(() => {
    if (!verification || verification.mode !== "user_sends_code") return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await api.register({ verificationToken: verification.token });
        if (cancelled) return;
        if (result.pendingVerification) {
          timer = window.setTimeout(poll, 2500);
          return;
        }
        finishAuth();
      } catch (cause) {
        if (cancelled) return;
        const status = Number((cause as { status?: number })?.status || 0);
        if (status === 202) {
          timer = window.setTimeout(poll, 2500);
          return;
        }
        setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o cadastro.");
      }
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [finishAuth, verification]);

  const submitLogin = async () => {
    if (!identifier.trim() || !password) return;
    setBusy(true);
    clearFeedback();
    try {
      await api.login(identifier.trim(), password, true);
      finishAuth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar agora.");
      setBusy(false);
    }
  };

  const submitSignup = async () => {
    if (verification) {
      if (verification.mode !== "send_code") return;
      if (!/^\d{6,8}$/.test(verificationCode.trim())) {
        setError("Informe o código recebido no WhatsApp.");
        return;
      }
      setBusy(true);
      clearFeedback();
      try {
        await api.register({
          verificationToken: verification.token,
          verificationCode: verificationCode.trim(),
        });
        finishAuth();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Código inválido ou expirado.");
        setBusy(false);
      }
      return;
    }
    if (!name.trim() || !email.trim() || !password || !acceptTerms) return;
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setBusy(true);
    clearFeedback();
    try {
      const result = await api.register({
        name: name.trim(),
        email: email.trim(),
        whatsappNumber: whatsappNumber.trim(),
        password,
        nextPath: authNext,
      });
      if (result.pendingVerification && result.verificationToken) {
        const challenge = result.verification || {};
        const pending: LocalSignupVerification = {
          token: result.verificationToken,
          mode: challenge.mode === "send_code" ? "send_code" : "user_sends_code",
          code: challenge.code,
          whatsappUrl: challenge.whatsappUrl,
          targetWhatsappNumber: challenge.targetWhatsappNumber,
          whatsappNumber: result.whatsappNumber || challenge.whatsappNumber,
          instructions: challenge.instructions,
        };
        setVerification(pending);
        sessionStorage.setItem(
          "botadmin.pending-signup-verification",
          JSON.stringify(pending),
        );
        setNotice(
          pending.mode === "send_code"
            ? result.message || "Enviamos um código para o seu WhatsApp."
            : "Envie a mensagem de confirmação pelo WhatsApp. A validação será concluída automaticamente.",
        );
        setBusy(false);
        return;
      }
      setNotice(result.message || "Conta criada com sucesso.");
      window.setTimeout(finishAuth, 450);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir o cadastro.");
      setBusy(false);
    }
  };

  const submitForgot = async () => {
    if (!resetToken && !identifier.trim()) return;
    setBusy(true);
    clearFeedback();
    try {
      if (resetStep === "request") {
        const result = await api.requestPasswordReset(identifier.trim());
        setResetStep("verify");
        setNotice(result.message || "Se a conta existir, enviaremos um código para os canais cadastrados.");
      } else {
        if (!resetToken && !/^\d{6}$/.test(verificationCode.trim())) {
          setError("Informe o código de 6 dígitos recebido.");
          setBusy(false);
          return;
        }
        if (password.length < 6 || password !== passwordConfirmation) {
          setError(password.length < 6 ? "A nova senha deve ter pelo menos 6 caracteres." : "As senhas não coincidem.");
          setBusy(false);
          return;
        }
        const result = await api.resetPassword({
          ...(resetToken
            ? { token: resetToken }
            : {
                identifier: identifier.trim(),
                code: verificationCode.trim(),
              }),
          password,
        });
        setResetStep("done");
        setNotice(result.message || "Senha alterada com sucesso. Você já pode entrar.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível recuperar a senha.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "login") await submitLogin();
    else if (mode === "signup") await submitSignup();
    else await submitForgot();
  };

  const verificationQr = verification?.whatsappUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=170x170&margin=8&data=${encodeURIComponent(verification.whatsappUrl)}`
    : "";
  const forgotDone = mode === "forgot" && resetStep === "done";
  return (
    <main className="local-auth-screen">
      <form className="local-auth-card" onSubmit={submit}>
        <Brand />
        <h1>{mode === "login" ? "Acessar sua conta" : mode === "signup" ? "Criar sua conta" : forgotDone ? "Senha redefinida" : "Recuperar senha"}</h1>
        <p>
          {mode === "login"
            ? "Entre no BotAdmin para continuar."
            : mode === "signup"
              ? "Crie seu acesso para usar o painel BotAdmin."
              : forgotDone
                ? "Sua senha foi alterada. Entre novamente para continuar."
                : resetStep === "request"
                  ? "Informe seu e-mail ou WhatsApp para receber o código."
                  : resetToken
                    ? "Defina sua nova senha para recuperar o acesso."
                    : "Digite o código recebido e defina uma nova senha."}
        </p>
        <div className="local-auth-tabs" role="tablist" aria-label="Acesso">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => selectMode("login")}>Entrar</button>
          <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => selectMode("signup")}>Criar conta</button>
        </div>
        {mode === "login" && (
          <>
            <label>E-mail ou WhatsApp<input autoFocus value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required /></label>
            <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
            <button type="button" className="local-auth-link" onClick={() => selectMode("forgot")}>Esqueci minha senha</button>
          </>
        )}
        {mode === "signup" && (
          <>
            {!verification ? <>
              <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
              <label>WhatsApp <span className="local-auth-optional">(opcional quando não exigido)</span><input value={whatsappNumber} onChange={(event) => setWhatsappNumber(event.target.value)} autoComplete="tel" inputMode="tel" /></label>
              <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
              <label>Senha<input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></label>
              <label className="local-auth-check"><input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} required /><span>Concordo com os <a href="/termos" target="_blank" rel="noreferrer">termos</a> e a <a href="/privacidade" target="_blank" rel="noreferrer">política de privacidade</a>.</span></label>
            </> : verification.mode === "send_code" ? <label>Código recebido no WhatsApp<input autoFocus value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D+/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" required /></label> : <div className="local-auth-verification"><b>Confirme pelo WhatsApp</b><span>{verification.instructions || `Envie a mensagem de confirmação para ${verification.targetWhatsappNumber || "o número indicado"}.`}</span>{verification.code && <code>{verification.code}</code>}{verificationQr && <img src={verificationQr} alt="QR Code de confirmação pelo WhatsApp" width={170} height={170} />}{verification.whatsappUrl && <a className="local-auth-whatsapp-link" href={verification.whatsappUrl} target="_blank" rel="noreferrer">Confirmar pelo WhatsApp <ExternalLink /></a>}</div>}
            {verification && <button type="button" className="local-auth-link" onClick={() => { setVerification(null); setVerificationCode(""); clearFeedback(); }}>Voltar e corrigir cadastro</button>}
            <button type="submit" className="primary-button" disabled={busy || (!verification && !acceptTerms) || (verification?.mode === "user_sends_code")}>{busy ? "Aguarde…" : verification?.mode === "send_code" ? "Confirmar código" : verification ? "Aguardando confirmação…" : "Criar conta"}</button>
          </>
        )}
        {mode === "forgot" && !forgotDone && (
          <>
            {!resetToken && <label>E-mail ou WhatsApp<input autoFocus value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required /></label>}
            {resetStep === "verify" && <>{!resetToken && <label>Código recebido<input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D+/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required /></label>}<label>Nova senha<input autoFocus={Boolean(resetToken)} type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></label><label>Confirmar nova senha<input type="password" minLength={6} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" required /></label></>}
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Aguarde…" : resetStep === "request" ? "Enviar código" : "Redefinir senha"}</button>
          </>
        )}
        {(error || notice) && <div className={error ? "form-error" : "form-notice"} role="status">{error || notice}</div>}
        {mode === "forgot" && <button type="button" className="local-auth-link" onClick={() => selectMode("login")}>Voltar para entrar</button>}
        {forgotDone && <button type="button" className="primary-button" onClick={() => selectMode("login")}>Ir para o login</button>}
        <small className="local-auth-footer">Acesso seguro ao BotAdmin · <button type="button" className="local-auth-link local-auth-home-link" onClick={() => { window.location.assign("/"); }}>Página inicial</button></small>
      </form>
    </main>
  );
}

function safeJsonRead<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeThreads(threads: ConversationThread[]) {
  const deduped = new Map<string, ConversationThread>();
  for (const thread of threads) {
    if (!thread?.chatJid) continue;
    const normalized: ConversationThread = {
      ...thread,
      title:
        thread.title?.trim() ||
        thread.phone?.trim() ||
        thread.chatJid.split("@")[0] ||
        "Conversa",
      lastMessagePreview: thread.lastMessagePreview ?? thread.lastMessage ?? "",
      lastMessageAt: thread.lastMessageAt ?? thread.lastActivity,
    };
    const key = `${normalized.instanceId}:${normalized.chatJid}`;
    const previous = deduped.get(key);
    if (!previous) {
      deduped.set(key, normalized);
      continue;
    }
    // The conversations endpoint can expose the same chat in both `threads`
    // and `conversations`, with one of the records missing preview/avatar or
    // timestamp fields. Keep the record with the newest activity as the base,
    // then fill any fields absent from it with the other record. This avoids a
    // temporary drop to epoch (and the resulting jump to the bottom) during
    // reconciliation.
    const previousIsNewer = dateValue(previous) > dateValue(normalized);
    const primary = previousIsNewer ? previous : normalized;
    const secondary = previousIsNewer ? normalized : previous;
    const merged: ConversationThread = { ...secondary, ...primary };
    for (const [field, value] of Object.entries(secondary)) {
      const current = merged[field as keyof ConversationThread];
      const missing =
        current === undefined ||
        current === null ||
        (typeof current === "string" && current.trim() === "");
      if (missing) {
        (merged as Record<string, unknown>)[field] = value;
      }
    }
    deduped.set(key, merged);
  }
  return [...deduped.values()].sort(
    (a, b) => {
      const pinnedDelta =
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pinnedDelta !== 0) return pinnedDelta;
      const dateDelta = dateValue(b) - dateValue(a);
      if (dateDelta !== 0) return dateDelta;
      const leftId = Number(a.id);
      const rightId = Number(b.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId)
        return rightId - leftId;
      // A deterministic final key prevents equal/missing timestamps from
      // changing order when cache, internal groups and API results arrive in
      // different batches during a page reload.
      return `${a.instanceId}:${a.chatJid}`.localeCompare(
        `${b.instanceId}:${b.chatJid}`,
        "pt-BR",
      );
    },
  );
}

const recentThreadWindow = (
  threads: ConversationThread[],
  instanceId?: number | null,
) => {
  const normalized = normalizeThreads(threads);
  const internal = normalized.filter(
    (thread) => thread.chatType === "internal_group",
  );
  const whatsapp = normalized
    .filter(
      (thread) =>
        thread.chatType !== "internal_group" &&
        (!instanceId || thread.instanceId === instanceId),
    )
    .slice(0, DIRECTORY_PAGE_SIZE);
  return normalizeThreads([...internal, ...whatsapp]);
};

const normalizeChatIdentity = (value: unknown) =>
  String(value ?? "").trim().toLowerCase();

/**
 * A bot group is persisted separately from the WhatsApp conversation index.
 * Join both snapshots before painting the directory so a real WhatsApp group
 * gets the same robot shortcut as the BotAdmin internal groups, including its
 * current active/paused state.
 */
const mergeBotGroupThreads = (
  threads: ConversationThread[],
  rawGroups: unknown,
) => {
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) return threads;
  const byId = new Map<number, JsonRecord>();
  const byRemote = new Map<string, JsonRecord>();
  for (const value of rawGroups) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const group = value as JsonRecord;
    const id = Number(group.id || 0);
    if (Number.isFinite(id) && id > 0) byId.set(id, group);
    const remote = normalizeChatIdentity(group.remoteId || group.remote_id);
    const instanceId = Number(group.instanceId || group.instance_id || 0);
    if (remote) byRemote.set(`${instanceId}:${remote}`, group);
  }
  return threads.map((thread) => {
    if (thread.chatType === "internal_group") return thread;
    const byLinkedId = Number(thread.linkedGroupId || 0);
    const group =
      (byLinkedId > 0 ? byId.get(byLinkedId) : undefined) ||
      byRemote.get(
        `${thread.instanceId}:${normalizeChatIdentity(thread.chatJid)}`,
      );
    if (!group) return thread;
    const status = String(group.status || "").trim().toLowerCase();
    return {
      ...thread,
      linkedGroupId: Number(group.id || thread.linkedGroupId || 0) || null,
      internalBotEnabled:
        status === "active" || status === "ativo" || status === "enabled",
      title: String(group.name || thread.title || "").trim() || thread.title,
      avatarUrl:
        String(group.imageUrl || group.avatarUrl || thread.avatarUrl || "") ||
        null,
      participantsCount: Number(
        group.participantCount ??
          group.participantsCount ??
          thread.participantsCount ??
          0,
      ),
    };
  });
};

const messageKey = (message: ChatMessage) => {
  const messageId = String(message.messageId || "").trim();
  if (messageId) return `message:${messageId}`;
  const clientMessageId = String(message.clientMessageId || "").trim();
  if (clientMessageId) return `client:${clientMessageId}`;
  return `id:${String(message.id)}`;
};

const messageTimeValue = (message: ChatMessage) => {
  const parsed = Date.parse(String(message.createdAt || message.timestamp || ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortMessages = (messages: ChatMessage[]) =>
  [...messages].sort((left, right) => {
    const timeDelta = messageTimeValue(left) - messageTimeValue(right);
    if (timeDelta !== 0) return timeDelta;
    const leftId = Number(left.id);
    const rightId = Number(right.id);
    if (Number.isFinite(leftId) && Number.isFinite(rightId)) return leftId - rightId;
    return messageKey(left).localeCompare(messageKey(right));
  });

/**
 * Merge a recent server window into the local window without throwing away
 * messages already loaded by the upward paginator. This is deliberately
 * idempotent because the WebSocket and the send response can contain the same
 * message at nearly the same time.
 */
const mergeConversationMessages = (
  existing: ChatMessage[],
  incoming: ChatMessage[],
) => {
  const result: ChatMessage[] = [];
  const indexByKey = new Map<string, number>();
  const add = (message: ChatMessage) => {
    const key = messageKey(message);
    const currentIndex = indexByKey.get(key);
    if (currentIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(message);
      return;
    }
    result[currentIndex] = { ...result[currentIndex], ...message };
  };
  for (const message of existing) add(message);
  for (const serverMessage of incoming) {
    const clientId = String(serverMessage.clientMessageId || "").trim();
    const clientIndex = clientId
      ? result.findIndex(
          (message) =>
            Boolean(message.optimistic) &&
            String(message.clientMessageId || "").trim() === clientId,
        )
      : -1;
    if (clientIndex >= 0) {
      result[clientIndex] = {
        ...result[clientIndex],
        ...serverMessage,
        optimistic: false,
      };
      indexByKey.set(messageKey(result[clientIndex]), clientIndex);
      continue;
    }
    const serverText = messageComparableText(serverMessage);
    const serverTime = messageTimeValue(serverMessage);
    const fallbackIndex = serverText
      ? result.findIndex((message) => {
          if (!message.optimistic || messageComparableText(message) !== serverText)
            return false;
          const localTime = messageTimeValue(message);
          return !localTime || !serverTime || Math.abs(localTime - serverTime) <= 30_000;
        })
      : -1;
    if (fallbackIndex >= 0) {
      result[fallbackIndex] = {
        ...result[fallbackIndex],
        ...serverMessage,
        optimistic: false,
      };
      indexByKey.set(messageKey(result[fallbackIndex]), fallbackIndex);
      continue;
    }
    add(serverMessage);
  }
  return sortMessages(result);
};

function Rail({
  section,
  onSelect,
  user,
  activeInstance,
  instanceCount = 0,
  unreadCount = 0,
  onProfileSwitcher,
  onLogout,
}: {
  section: Section;
  onSelect: (section: Section) => void;
  user: SessionUser;
  activeInstance?: BotInstance | null;
  instanceCount?: number;
  unreadCount?: number;
  onProfileSwitcher?: () => void;
  onLogout?: () => void;
}) {
  return (
    <aside className="rail">
      <button
        className="rail-brand"
        aria-label="BotAdmin"
        onClick={() => onSelect("conversations")}
      >
        <Brand compact />
      </button>
      <nav>
        {navigation.map(
          ({ section: item, label, icon: Icon, dot, dividerBefore }) => (
            <React.Fragment key={item}>
              {dividerBefore && (
                <div className="rail-divider" aria-hidden="true" />
              )}
              <button
                className={section === item ? "active" : ""}
                title={label}
                onClick={() => onSelect(item)}
              >
                <Icon size={22} strokeWidth={1.9} />
                {dot && <i className="rail-dot" aria-hidden="true" />}
                {item === "conversations" && unreadCount > 0 && (
                  <b className="rail-badge">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </b>
                )}
                <span>{label}</span>
              </button>
            </React.Fragment>
          ),
        )}
      </nav>
      <button
        className={section === "settings" ? "active" : ""}
        title="Configurações"
        onClick={() => onSelect("settings")}
      >
        <Settings size={22} />
        <span>Configurações</span>
      </button>
      <button title="Sair" onClick={onLogout}>
        <LogOut size={22} />
        <span>Sair</span>
      </button>
      <button
        className="rail-profile"
        title={
          activeInstance
            ? `Perfil ativo: ${activeInstance.name}`
            : "Trocar perfil"
        }
        onClick={onProfileSwitcher}
      >
        <Avatar
          name={activeInstance?.name || user.name}
          src={activeInstance?.avatarUrl || user.avatarUrl}
          small
        />
        <i
          className={
            connectedInstance(activeInstance?.sessionStatus)
              ? "online"
              : "offline"
          }
        />
        {instanceCount > 1 && <b>{instanceCount}</b>}
      </button>
    </aside>
  );
}

const actionLabels: Array<{
  action: ConversationAction;
  label: string;
  icon: typeof MoreVertical;
}> = [
  { action: "read", label: "Marcar como lida", icon: MessageCircle },
  { action: "pin", label: "Fixar conversa", icon: ShieldCheck },
  { action: "archive", label: "Arquivar conversa", icon: Ticket },
  { action: "mute", label: "Silenciar notificações", icon: Bell },
  { action: "clear", label: "Limpar mensagens", icon: X },
  { action: "delete", label: "Apagar conversa", icon: X },
];

function ConversationMenu({
  thread,
  onAction,
  compact = false,
}: {
  thread: ConversationThread;
  onAction: (thread: ConversationThread, action: ConversationUiAction) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const isGroup =
    thread.chatType === "internal_group" ||
    String(thread.chatType || "").includes("group");
  const listItems = actionLabels
    .filter(
      ({ action }) => action !== "mute" || thread.chatType === "internal_group",
    )
    .filter(
      ({ action }) =>
        action !== "clear" ||
        thread.chatType !== "internal_group" ||
        thread.canManage,
    )
    .filter(
      ({ action }) =>
        action !== "delete" || thread.chatType !== "internal_group",
    )
    .map(
      (
        item,
      ): {
        action: ConversationUiAction;
        label: string;
        icon: typeof MoreVertical;
      } => ({
        ...item,
        action:
          item.action === "pin" && thread.pinned
            ? ("unpin" as const)
            : item.action === "archive" && thread.archived
              ? ("unarchive" as const)
              : item.action === "mute" && thread.muted
                ? ("unmute" as const)
                : item.action,
        label:
          item.action === "pin" && thread.pinned
            ? "Desfixar conversa"
            : item.action === "archive" && thread.archived
              ? "Desarquivar conversa"
              : item.action === "mute" && thread.muted
                ? "Ativar notificações"
                : item.label,
      }),
    );
  if (isGroup)
    listItems.push({
      action: "leave",
      label: "Sair do grupo",
      icon: ArrowLeft,
    });
  const headerItems: Array<{
    action: ConversationUiAction;
    label: string;
    icon: typeof MoreVertical;
  }> =
    thread.chatType === "internal_group"
      ? [
          { action: "details", label: "Dados do grupo", icon: UsersRound },
          { action: "group-links", label: "Link do grupo", icon: Paperclip },
          ...(canManageGroupThread(thread)
            ? [
                {
                  action: "toggle-bot" as const,
                  label: thread.internalBotEnabled
                    ? "Desativar robô neste grupo"
                    : "Ativar robô neste grupo",
                  icon: Bot,
                },
                {
                  action: "group-settings" as const,
                  label: "Bot e ativações do grupo",
                  icon: Settings,
                },
                {
                  action: "wallpaper" as const,
                  label: "Plano de fundo",
                  icon: Image,
                },
                {
                  action: "clear" as const,
                  label: "Limpar mensagens para todos",
                  icon: X,
                },
                {
                  action: "delete" as const,
                  label: "Apagar grupo definitivamente",
                  icon: X,
                },
              ]
            : []),
          { action: "leave", label: "Sair do grupo", icon: ArrowLeft },
        ]
      : [
          {
            action: "details",
            label: isGroup ? "Dados do grupo" : "Dados do contato",
            icon: isGroup ? UsersRound : ContactRound,
          },
          ...(isGroup && canManageGroupThread(thread)
            ? [
                {
                  action: "group-settings" as const,
                  label: "Bot e ativações do grupo",
                  icon: Settings,
                },
              ]
            : []),
          { action: "refresh", label: "Atualizar mensagens", icon: RefreshCw },
          {
            action: "copy-id",
            label: "Copiar ID da conversa",
            icon: Paperclip,
          },
          { action: "clear", label: "Limpar mensagens", icon: X },
          { action: "delete", label: "Apagar conversa", icon: X },
          ...(isGroup
            ? [
                {
                  action: "leave" as const,
                  label: "Sair do grupo",
                  icon: ArrowLeft,
                },
              ]
            : []),
        ];
  const items = compact ? headerItems : listItems;

  return (
    <div
      className={`conversation-menu ${compact ? "conversation-menu--compact" : ""}`}
      ref={menuRef}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="conversation-menu-trigger"
        aria-label="Mais opções da conversa"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="conversation-menu-popover" role="menu">
          {items.map(({ action, label, icon: Icon }) => (
            <button
              key={action}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAction(thread, action);
              }}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadList({
  threads,
  selected,
  query,
  filter,
  loading,
  onSelect,
  onAction,
  onLoadMore,
  loadingMore,
  hasMore,
}: {
  threads: ConversationThread[];
  selected: ConversationThread | null;
  query: string;
  filter: Filter;
  loading: boolean;
  onSelect: (thread: ConversationThread) => void;
  onAction: (thread: ConversationThread, action: ConversationUiAction) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  hasMore: boolean;
}) {
  const [contextMenu, setContextMenu] = useState<{
    thread: ConversationThread;
    x: number;
    y: number;
  } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const viewportAnchorRef = useRef<{ key: string; offsetTop: number } | null>(
    null,
  );
  const threadSignatureRef = useRef("");
  const threadPositionsRef = useRef<Map<string, number>>(new Map());
  const reorderFrameRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const filterKeyRef = useRef(`${filter}\u0000${query}`);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return threads.filter((thread) => {
      const type = thread.chatType || "";
      if (filter === "archived" && !thread.archived) return false;
      if (filter !== "archived" && thread.archived) return false;
      if (filter === "unread" && !thread.unreadCount) return false;
      if (filter === "private" && !["private", "pv", "contact"].includes(type))
        return false;
      if (
        filter === "groups" &&
        (type === "internal_group" || !type.includes("group"))
      )
        return false;
      if (filter === "internal" && type !== "internal_group") return false;
      if (filter === "channels" && !type.includes("channel")) return false;
      if (filter === "communities" && !type.includes("communit")) return false;
      if (!needle) return true;
      return `${thread.title} ${thread.phone || ""} ${thread.lastMessagePreview || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(needle);
    });
  }, [threads, query, filter]);
  const threadKey = (thread: ConversationThread) =>
    `${thread.instanceId}:${thread.chatJid}`;
  const rememberViewport = () => {
    const list = listRef.current;
    if (!list) return;
    const scrollTop = list.scrollTop;
    const anchor = Array.from(
      list.querySelectorAll<HTMLElement>("[data-thread-key]"),
    ).find((element) => element.offsetTop + element.offsetHeight > scrollTop + 1);
    if (anchor) {
      viewportAnchorRef.current = {
        key: anchor.dataset.threadKey || "",
        offsetTop: anchor.offsetTop - scrollTop,
      };
    }
  };
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const filterKey = `${filter}\u0000${query}`;
    const filterChanged = filterKey !== filterKeyRef.current;
    if (filterChanged) {
      filterKeyRef.current = filterKey;
      viewportAnchorRef.current = null;
      list.scrollTop = 0;
    }
    const signature = visible.map(threadKey).join("|");
    const previousSignature = threadSignatureRef.current;
    if (loading) {
      // During a reload/profile switch the cache, internal groups and hydrated
      // WhatsApp directory can resolve in different orders. Keep the latest
      // rendered snapshot as the baseline and do not animate those transient
      // snapshots or restore an old scroll anchor.
      if (reorderFrameRef.current !== null) {
        window.cancelAnimationFrame(reorderFrameRef.current);
        reorderFrameRef.current = null;
      }
      if (!loadingRef.current) {
        list.scrollTop = 0;
        viewportAnchorRef.current = null;
      }
      loadingRef.current = true;
      threadSignatureRef.current = signature;
      threadPositionsRef.current = new Map(
        Array.from(list.querySelectorAll<HTMLElement>("[data-thread-key]")).map(
          (element) => [element.dataset.threadKey || "", element.offsetTop],
        ),
      );
      return;
    }
    const wasLoading = loadingRef.current;
    loadingRef.current = false;
    // Treat the first ordered snapshot after a cache/API hydration as a new
    // baseline. It must not run the reorder animation or scroll correction:
    // those are for live directory changes only and otherwise make the recent
    // conversation visibly jump while the page is opening.
    if (wasLoading) {
      threadSignatureRef.current = signature;
      threadPositionsRef.current = new Map(
        Array.from(list.querySelectorAll<HTMLElement>("[data-thread-key]")).map(
          (element) => [element.dataset.threadKey || "", element.offsetTop],
        ),
      );
      if (!viewportAnchorRef.current && visible.length) rememberViewport();
      return;
    }
    if (!filterChanged && previousSignature && signature !== previousSignature) {
      const atTop = list.scrollTop <= 48;
      const anchor = viewportAnchorRef.current;
      if (!atTop && anchor?.key) {
        const currentAnchor = Array.from(
          list.querySelectorAll<HTMLElement>("[data-thread-key]"),
        ).find((element) => element.dataset.threadKey === anchor.key);
        if (currentAnchor) {
          const nextOffset = currentAnchor.offsetTop - list.scrollTop;
          const delta = nextOffset - anchor.offsetTop;
          if (Math.abs(delta) > 0.5) list.scrollTop += delta;
        }
      }
      // FLIP animation makes a conversation moving in the directory visible,
      // while the anchor correction above keeps the user's viewport stable.
      const previousPositions = threadPositionsRef.current;
      const moved: Array<{ element: HTMLElement; delta: number }> = [];
      for (const element of Array.from(
        list.querySelectorAll<HTMLElement>("[data-thread-key]"),
      )) {
        const key = element.dataset.threadKey || "";
        const previousTop = previousPositions.get(key);
        if (previousTop === undefined) continue;
        const delta = previousTop - element.offsetTop;
        if (Math.abs(delta) > 0.5) moved.push({ element, delta });
      }
      if (reorderFrameRef.current !== null)
        window.cancelAnimationFrame(reorderFrameRef.current);
      for (const { element, delta } of moved) {
        element.style.transition = "none";
        element.style.transform = `translateY(${delta}px)`;
      }
      if (moved.length) {
        reorderFrameRef.current = window.requestAnimationFrame(() => {
          for (const { element } of moved) {
            element.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
            element.style.transform = "";
          }
          reorderFrameRef.current = null;
        });
      }
    }
    threadSignatureRef.current = signature;
    threadPositionsRef.current = new Map(
      Array.from(list.querySelectorAll<HTMLElement>("[data-thread-key]")).map(
        (element) => [element.dataset.threadKey || "", element.offsetTop],
      ),
    );
    if (!viewportAnchorRef.current && visible.length) rememberViewport();
  }, [visible, filter, query, loading]);
  useEffect(
    () => () => {
      if (reorderFrameRef.current !== null)
        window.cancelAnimationFrame(reorderFrameRef.current);
    },
    [],
  );

  // A cached directory is valid content, not a loading placeholder. It should
  // stay interactive while the server hydrates newer rows in the background.
  if (loading && !threads.length) {
    return (
      <div className="thread-list" aria-busy="true">
        <div className="list-state" role="status" aria-live="polite">
          <RefreshCw className="spin" />
          Carregando conversas recentes…
        </div>
      </div>
    );
  }

  return (
    <div
      className="thread-list"
      ref={listRef}
      onScroll={() => {
        rememberViewport();
        const list = listRef.current;
        if (
          list &&
          hasMore &&
          !loadingMore &&
          list.scrollHeight - list.scrollTop - list.clientHeight < 280
        ) {
          onLoadMore();
        }
      }}
    >
      {visible.map((thread) => {
        const active =
          selected?.chatJid === thread.chatJid &&
          selected.instanceId === thread.instanceId;
        const time = thread.lastMessageAt || thread.lastActivity;
        return (
          <div
            key={threadKey(thread)}
            data-thread-key={threadKey(thread)}
            className={`thread ${active ? "selected" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              rememberViewport();
              onSelect(thread);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              rememberViewport();
              setContextMenu({ thread, x: event.clientX, y: event.clientY });
            }}
            onPointerDown={(event) => {
              rememberViewport();
              if (event.pointerType !== "touch") return;
              const x = event.clientX;
              const y = event.clientY;
              longPressTimer.current = window.setTimeout(
                () => setContextMenu({ thread, x, y }),
                520,
              );
            }}
            onPointerUp={() => {
              if (longPressTimer.current)
                window.clearTimeout(longPressTimer.current);
            }}
            onPointerCancel={() => {
              if (longPressTimer.current)
                window.clearTimeout(longPressTimer.current);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                rememberViewport();
                onSelect(thread);
              }
            }}
          >
            <Avatar name={thread.title} src={thread.avatarUrl} />
            <div className="thread-copy">
              <div className="thread-title">
                <strong>{thread.title}</strong>
                {threadTypeLabel(thread) && (
                  <em className={`type-${thread.chatType}`}>
                    {threadTypeLabel(thread)}
                  </em>
                )}
                {thread.pinned && (
                  <span className="thread-pin" title="Fixada">
                    ⌖
                  </span>
                )}
              </div>
              <span>
                {thread.lastMessageDirection === "outbound"
                  ? "Você: "
                  : thread.lastMessageSenderName
                    ? `${thread.lastMessageSenderName}: `
                    : ""}
                {thread.lastMessagePreview || "Sem mensagens"}
                {Boolean(thread.linkedGroupId) && (
                  <Bot className="thread-bot" />
                )}
              </span>
            </div>
            <div className="thread-meta">
              <time>{formatThreadTime(time)}</time>
              {canManageGroupThread(thread) && (
                <button
                  className={`thread-bot-button ${thread.internalBotEnabled ? "is-active" : ""}`}
                  title={
                    thread.chatType !== "internal_group" &&
                    thread.internalBotEnabled === undefined
                      ? "Abrir robô e ativações"
                      : thread.internalBotEnabled
                        ? "Configurar robô"
                        : "Ativar robô"
                  }
                  aria-label="Abrir robô e ativações do grupo"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction(thread, "group-settings");
                  }}
                >
                  <Bot />
                </button>
              )}
              <div>
                {thread.hasUnreadMention && Boolean(thread.unreadCount) && (
                  <i>@</i>
                )}
                {Boolean(thread.unreadCount) && (
                  <b>
                    {Number(thread.unreadCount) > 999
                      ? "999+"
                      : thread.unreadCount}
                  </b>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {!visible.length && (
        <div className="list-state">
          {loading ? (
            <>
              <RefreshCw className="spin" />
              Carregando conversas…
            </>
          ) : (
            <>Nenhuma conversa encontrada para essa busca.</>
          )}
        </div>
      )}
      {hasMore && (
        <div className="list-state thread-list-more" aria-live="polite">
          {loadingMore ? (
            <>
              <RefreshCw className="spin" /> Carregando mais conversas…
            </>
          ) : (
            <button type="button" className="ghost-button" onClick={onLoadMore}>
              Carregar mais conversas
            </button>
          )}
        </div>
      )}
      {contextMenu && (
        <div
          className="thread-context-menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 225),
            top: Math.min(contextMenu.y, window.innerHeight - 300),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {[
            {
              action: contextMenu.thread.pinned ? "unpin" : "pin",
              label: contextMenu.thread.pinned ? "Desfixar chat" : "Fixar chat",
            },
            {
              action: contextMenu.thread.archived ? "unarchive" : "archive",
              label: contextMenu.thread.archived
                ? "Desarquivar chat"
                : "Arquivar chat",
            },
            ...(contextMenu.thread.chatType !== "internal_group" ||
            contextMenu.thread.canManage
              ? [{ action: "clear", label: "Limpar mensagens" }]
              : []),
            ...(contextMenu.thread.chatType !== "internal_group"
              ? [{ action: "delete", label: "Apagar conversa" }]
              : []),
            ...(String(contextMenu.thread.chatType || "").includes("group")
              ? [{ action: "leave", label: "Sair do grupo" }]
              : []),
          ].map((item) => (
            <button
              key={item.action}
              onClick={() => {
                setContextMenu(null);
                onAction(contextMenu.thread, item.action as ConversationAction);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Directory({
  threads,
  selected,
  instances,
  selectedInstance,
  query,
  filter,
  loading,
  onQuery,
  onFilter,
  onSelect,
  onAction,
  onLoadMore,
  loadingMore,
  hasMore,
  onDirectoryAction,
}: {
  threads: ConversationThread[];
  selected: ConversationThread | null;
  instances: BotInstance[];
  selectedInstance: number | null;
  query: string;
  filter: Filter;
  loading: boolean;
  onQuery: (value: string) => void;
  onFilter: (filter: Filter) => void;
  onSelect: (thread: ConversationThread) => void;
  onAction: (thread: ConversationThread, action: ConversationUiAction) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  hasMore: boolean;
  onDirectoryAction: (action: DirectoryAction) => void;
}) {
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(
    () =>
      typeof Notification !== "undefined" &&
      Notification.permission === "default",
  );
  // Keep the cached snapshot in the counters and filters while the API
  // hydrates. This avoids a blank directory and keeps the newest known chat
  // usable from the first frame after authentication.
  const directoryThreads = threads;
  const count = (predicate: (thread: ConversationThread) => boolean) =>
    directoryThreads.filter(predicate).length;
  const filters: Array<[Filter, string, number | null]> = [
    ["all", "Tudo", null],
    [
      "unread",
      "Não lidas",
      directoryThreads.reduce(
        (sum, item) => sum + Number(item.unreadCount || 0),
        0,
      ),
    ],
    [
      "private",
      "PV",
      count((item) =>
        ["private", "pv", "contact"].includes(item.chatType || ""),
      ),
    ],
    [
      "groups",
      "Grupos",
      count(
        (item) =>
          (item.chatType || "").includes("group") &&
          item.chatType !== "internal_group",
      ),
    ],
    [
      "internal",
      "BotAdmin",
      count((item) => item.chatType === "internal_group"),
    ],
    [
      "channels",
      "Canais",
      count((item) => (item.chatType || "").includes("channel")),
    ],
    [
      "communities",
      "Comunidades",
      count((item) => (item.chatType || "").includes("communit")),
    ],
    ["archived", "Arquivadas", count((item) => Boolean(item.archived))],
  ];
  return (
    <section className="directory">
      <header className="directory-header">
        <Brand />
        <div className="directory-header-actions">
          <button
            className="desktop-header-action"
            title="Nova conversa"
            onClick={() => onDirectoryAction("new-conversation")}
          >
            <AppWindow size={21} />
          </button>
          <button
            className="desktop-header-action"
            title="Sair"
            onClick={() => onDirectoryAction("logout")}
          >
            <LogOut size={21} />
          </button>
          <div className="header-menu">
            <button
              title="Mais"
              aria-haspopup="menu"
              aria-expanded={headerMenuOpen}
              onClick={() => setHeaderMenuOpen((value) => !value)}
            >
              <MoreVertical size={21} />
            </button>
            {headerMenuOpen && (
              <div className="header-menu-popover full-menu" role="menu">
                {[
                  ...(filter === "internal"
                    ? [
                        {
                          action: "new-internal" as const,
                          label: "Criar grupo BotAdmin",
                          icon: UserPlus,
                        },
                        {
                          action: "join-internal" as const,
                          label: "Entrar com convite",
                          icon: Paperclip,
                        },
                      ]
                    : []),
                  {
                    action: "switch-profile" as const,
                    label:
                      instances.find((item) => item.id === selectedInstance)
                        ?.name || "Trocar perfil",
                    icon: ContactRound,
                    mobileOnly: true,
                  },
                  {
                    action: "renew-profile" as const,
                    label: "Renovar perfil",
                    icon: ShieldCheck,
                    mobileOnly: true,
                  },
                  {
                    action: "new-profile" as const,
                    label: "Novo perfil",
                    icon: Plus,
                    mobileOnly: true,
                  },
                  {
                    action: "new-conversation" as const,
                    label: "Nova conversa",
                    icon: MessageCircle,
                    mobileOnly: true,
                  },
                  {
                    action: "support" as const,
                    label: "Falar com o suporte",
                    icon: ContactRound,
                  },
                  {
                    action: "theme" as const,
                    label: "Tema dark",
                    icon: SunMoon,
                  },
                  {
                    action: "settings" as const,
                    label: "Configurações",
                    icon: Settings,
                  },
                  {
                    action: "download-app" as const,
                    label: "Baixar aplicativo",
                    icon: AppWindow,
                  },
                  {
                    action: "favorites" as const,
                    label: "Mensagens favoritas",
                    icon: Star,
                  },
                  {
                    action: "resync" as const,
                    label: "Resincronizar histórico",
                    icon: RefreshCw,
                  },
                  {
                    action: "select" as const,
                    label: "Selecionar conversas",
                    icon: CheckSquare,
                  },
                  { action: "lists" as const, label: "Listas", icon: List },
                  {
                    action: "mark-all-read" as const,
                    label: "Marcar todas como lidas",
                    icon: MessageCircle,
                  },
                  { action: "logout" as const, label: "Sair", icon: LogOut },
                ].map(({ action, label, icon: Icon, mobileOnly }) => (
                  <button
                    key={action}
                    className={mobileOnly ? "mobile-menu-only" : ""}
                    role="menuitem"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      onDirectoryAction(action);
                    }}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      <label className="search">
        <Search size={20} />
        <input
          placeholder="Pesquisar ou começar uma nova conversa"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <div className="filters">
        {filters.map(([key, label, value]) => (
          <button
            key={key}
            className={filter === key ? "selected" : ""}
            onClick={() => onFilter(key)}
          >
            {label}
            {value === null ? "" : ` ${value}`}
          </button>
        ))}
      </div>
      {noticeVisible && (
        <div className="notification-notice">
          <BellRing />
          <b>Ative notificações reais de novas mensagens.</b>
          <button
            onClick={async () => {
              const permission = await Notification.requestPermission();
              if (permission !== "default") setNoticeVisible(false);
            }}
          >
            Permitir
          </button>
          <button aria-label="Fechar" onClick={() => setNoticeVisible(false)}>
            <X />
          </button>
        </div>
      )}
      <ThreadList
        {...{
          threads: directoryThreads,
          selected,
          query,
          filter,
          loading,
          onSelect,
          onAction,
          onLoadMore,
          loadingMore,
          hasMore,
        }}
      />
      <button
        className="mobile-new-conversation"
        aria-label="Nova conversa"
        onClick={() =>
          onDirectoryAction(
            filter === "internal" ? "new-internal" : "new-conversation",
          )
        }
      >
        <Plus />
      </button>
    </section>
  );
}

function linkify(text: string) {
  const pattern =
    /((?:https?:\/\/|www\.)[^\s<>]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>]*)?)/gi;
  const isUrl = /^(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,})/i;
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    if (!isUrl.test(part)) return part;
    // Keep URL paths, query strings, fragments and balanced parentheses. Only
    // punctuation that clearly terminates a sentence is rendered outside it.
    let trailing = part.match(/[.,;:!?]+$/)?.[0] || "";
    const candidate = trailing ? part.slice(0, -trailing.length) : part;
    const opens = (candidate.match(/\(/g) || []).length;
    const closes = (candidate.match(/\)/g) || []).length;
    if (closes > opens) {
      const extra = candidate.match(/\)+$/)?.[0] || "";
      trailing += extra;
    }
    const raw = trailing ? part.slice(0, -trailing.length) : part;
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return (
      <span key={index}>
        <a href={href} target="_blank" rel="noreferrer">
          {raw}
        </a>
        {trailing}
      </span>
    );
  });
}

type MessageMention = {
  jid: string;
  name?: string | null;
  all?: boolean;
};

const normalizeMentionJidForPanel = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw || /^(?:all|todos?)$/.test(raw)) return null;
  if (raw.endsWith("@g.us") || raw.endsWith("@newsletter")) return null;
  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : null;
};

const mentionLabelKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const mentionDigits = (value: string) => value.replace(/\D/g, "");

const renderMessageBody = (
  body: string,
  message: ChatMessage,
  onMention: (mention: MessageMention) => void,
) => {
  // Keep the match as a split segment so the rendered @mention is not lost
  // when the surrounding text is linkified.
  const mentionPattern = /((?<![\w.+-])@(?:todos?|all|[^\s@()[\]{}<>,.!?;:]+))/giu;
  const rawJids = Array.isArray(message.mentionedJids)
    ? message.mentionedJids
        .map(normalizeMentionJidForPanel)
        .filter((jid): jid is string => Boolean(jid))
    : [];
  const targetEntries = Array.isArray(message.mentionTargets)
    ? message.mentionTargets
        .map((entry) => ({
          jid: normalizeMentionJidForPanel(entry?.jid),
          name: entry?.name?.trim() || null,
        }))
        .filter((entry): entry is { jid: string; name: string | null } => Boolean(entry.jid))
    : [];
  const targets = targetEntries.length
    ? targetEntries
    : rawJids.map((jid) => ({ jid, name: null }));
  const tokenParts = body.split(mentionPattern);
  let mentionIndex = 0;
  return tokenParts.map((part, index) => {
    if (!/^@/u.test(part)) return <React.Fragment key={index}>{linkify(part)}</React.Fragment>;
    const lower = part.toLocaleLowerCase("pt-BR");
    if (/^@(?:all|todos?)$/u.test(lower)) {
      return (
        <span
          className="message-mention message-mention--all"
          key={index}
          title="Menção para todos os membros"
        >
          {part}
        </span>
      );
    }
    const tokenKey = mentionLabelKey(part.slice(1));
    const tokenNumber = mentionDigits(part);
    const target =
      targets.find((entry) => {
        const entryNumber = mentionDigits(entry.jid);
        const entryName = mentionLabelKey(entry.name || "");
        return (
          (tokenNumber && entryNumber.endsWith(tokenNumber)) ||
          (tokenKey && entryName && entryName.includes(tokenKey))
        );
      }) || targets[mentionIndex] || null;
    mentionIndex += 1;
    if (!target) return <React.Fragment key={index}>{part}</React.Fragment>;
    return (
      <button
        type="button"
        className="message-mention"
        key={index}
        title={`Abrir conversa com ${target.name || part.slice(1)}`}
        onClick={() => onMention({ jid: target.jid, name: target.name })}
      >
        {part}
      </button>
    );
  });
};

const mediaString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
    if (
      typeof value === "string" &&
      value.trim() &&
      value.trim() !== "[object Object]"
    )
      return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as JsonRecord;
      const nested = mediaString(
        record.mediaProxyUrl,
        record.proxyUrl,
        record.publicUrl,
        record.localUrl,
        record.mediaUrl,
        record.url,
        record.path,
        record.filePath,
        record.dataUrl,
        record.content,
        record.message,
        record.imageMessage,
        record.videoMessage,
        record.audioMessage,
      );
      if (nested) return nested;
    }
  }
  return "";
};

const textString = (...values: unknown[]): string => {
  for (const value of values) {
    if (
      typeof value === "string" &&
      value.trim() &&
      value.trim() !== "[object Object]"
    )
      return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as JsonRecord;
      const nested = textString(
        record.title,
        record.text,
        record.body,
        record.caption,
        record.label,
        record.conversation,
        record.plainText,
        record.displayText,
        record.selectedDisplayText,
        record.content,
        record.message,
      );
      if (nested) return nested;
    }
  }
  return "";
};

const messageComparableText = (message: ChatMessage) =>
  textString(
    message.text,
    message.body,
    message.caption,
    message.media && typeof message.media === "object"
      ? (message.media as JsonRecord).caption
      : "",
  );

function MessageMedia({ message }: { message: ChatMessage }) {
  const media = message.media || {};
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  // Prefer a public/source URL when the API has one. Protected proxy URLs are
  // retained as a fallback (and remain first for encrypted WhatsApp media).
  const direct = mediaString(
    message.mediaSourceUrl,
    message.mediaUrl,
    media.publicUrl,
    media.localUrl,
    media.mediaUrl,
    media.url,
    message.mediaProxyUrl,
    media.mediaProxyUrl,
    media.proxyUrl,
    message.thumbnailUrl,
    media.headerMedia,
    media.path,
    media.filePath,
  );
  const protectedSource = absoluteMediaUrl(
    mediaString(
      message.mediaProxyUrl,
      message.mediaUrl,
      media.mediaProxyUrl,
      media.proxyUrl,
    ),
  );
  const mime = mediaString(
    message.mediaMimeType,
    message.mimeType,
    media.mimeType,
    media.mimetype,
  );
  const kind = mediaString(
    media.kind,
    media.mediaType,
    media.type,
    message.messageType,
    message.type,
  ).toLowerCase();
  const messageKey = mediaString(message.messageId, message.id);
  const localPreview = /^(blob:|data:)/i.test(direct);
  const recoverable = Boolean(
    !message.optimistic &&
    !localPreview &&
    message.instanceId &&
    message.instanceId > 0 &&
    message.chatJid &&
    !message.chatJid.startsWith("internal:") &&
    messageKey &&
    (direct ||
      ["image", "video", "audio", "sticker", "document", "interactive"].some(
        (type) => kind.includes(type),
      )),
  );
  const mediaEndpoint = recoverable
    ? `/api/bot-instances/${message.instanceId}/whatsapp-conversations/${encodeURIComponent(message.chatJid!)}/messages/${encodeURIComponent(messageKey)}/media${refresh ? "?refresh=1" : ""}`
    : "";
  const mediaRefreshEndpoint =
    recoverable && !refresh
      ? `${mediaEndpoint}${mediaEndpoint.includes("?") ? "&" : "?"}refresh=1`
      : "";
  const fallbackThumbnail = absoluteMediaUrl(
    mediaString(
      message.thumbnailUrl,
      media.thumbnailUrl,
      media.thumbnail,
      media.previewUrl,
    ),
  );
  const directSource = absoluteMediaUrl(direct);
  const hasInteractiveHeader =
    (kind.includes("interactive") || kind.includes("button")) &&
    Boolean(media.headerMedia);
  const visualKind =
    kind.includes("image") ||
    kind === "sticker" ||
    hasInteractiveHeader ||
    mime.startsWith("image") ||
    /\.(jpe?g|png|webp|gif)(\?|$)/i.test(direct);
  // Keep the direct CDN/R2 URL first for a fast paint, but always retain the
  // authenticated recovery endpoints as fallbacks. Browsers request only the
  // first source; the next one is tried after an actual media error, so this
  // does not fan out downloads while a conversation is opening and it also
  // repairs expired WhatsApp URLs without requiring a manual Retry click.
  const mediaSources = Array.from(
    new Set(
      [
        directSource,
        ...(recoverable
          ? [
              absoluteMediaUrl(mediaEndpoint),
              absoluteMediaUrl(mediaRefreshEndpoint),
              protectedSource,
            ]
          : []),
        ...(visualKind || kind.includes("video") ? [fallbackThumbnail] : []),
      ].filter(Boolean),
    ),
  );
  const source = mediaSources[sourceIndex] || "";
  const usingThumbnailFallback =
    Boolean(fallbackThumbnail) &&
    source === fallbackThumbnail &&
    kind.includes("video");
  if (!source) return null;
  const onMediaError = () => {
    if (sourceIndex + 1 < mediaSources.length)
      setSourceIndex((current) => current + 1);
    else setFailed(true);
  };
  if (failed)
    return (
      <button
        className="media-retry"
        onClick={() => {
          setFailed(false);
          setSourceIndex(0);
          setRefresh((current) => !current);
        }}
      >
        <RefreshCw />
        Mídia temporariamente indisponível · tentar novamente
      </button>
    );
  if (visualKind)
    return (
      <img
        className={
          kind === "sticker" ? "message-image sticker" : "message-image"
        }
        src={source}
        alt="Mídia da conversa"
        loading="lazy"
        decoding="async"
        onError={onMediaError}
      />
    );
  if (usingThumbnailFallback)
    return (
      <div className="video-thumbnail-fallback">
        <img
          className="message-image"
          src={source}
          alt="Prévia do vídeo"
          loading="lazy"
          decoding="async"
          onError={onMediaError}
        />
        <span>Prévia do vídeo</span>
      </div>
    );
  // Do not download every historical video/audio while opening a chat. The
  // native player requests the bytes only when the member presses play,
  // keeping the first paint fluid and avoiding a burst of expired-media 502s.
  if (
    kind.includes("video") ||
    mime.startsWith("video") ||
    /\.(mp4|webm|mov)(\?|$)/i.test(direct)
  )
    return (
      <video
        className="message-video"
        controls
        playsInline
        preload="metadata"
        src={source}
        onError={onMediaError}
      />
    );
  if (
    kind.includes("audio") ||
    mime.startsWith("audio") ||
    /\.(mp3|ogg|opus|m4a|wav)(\?|$)/i.test(direct)
  )
    return (
      <audio
        className="message-audio"
        controls
        preload="metadata"
        src={source}
        onError={onMediaError}
      />
    );
  return (
    <a className="document-card" href={source} target="_blank" rel="noreferrer">
      <Paperclip />
      <span>
        {message.fileName || message.mediaFileName || "Abrir documento"}
      </span>
      <Download />
    </a>
  );
}

const fallbackMessageLabel = (message: ChatMessage) => {
  const type = String(message.messageType || message.type || "").toLowerCase();
  if (type.includes("location")) return "📍 Localização";
  if (type.includes("contact")) return "👤 Contato";
  if (type.includes("poll")) return "📊 Enquete";
  if (type.includes("event")) return "📅 Evento";
  if (type.includes("call")) return "📞 Chamada";
  if (type.includes("revoked") || type.includes("deleted"))
    return "🚫 Esta mensagem foi apagada";
  if (type === "unknown") return "Mensagem ainda não suportada pelo WhatsApp";
  return type && type !== "text" ? "Mensagem do WhatsApp" : "";
};

const composerEmojis = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😍",
  "🥰",
  "😘",
  "😎",
  "🤔",
  "😮",
  "😢",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "🙌",
  "💪",
  "🔥",
  "🎉",
  "❤️",
  "💚",
  "💯",
  "✅",
  "❌",
  "👀",
  "🤖",
  "📸",
  "🎵",
  "🎬",
  "📍",
  "🎁",
  "🏆",
  "💰",
  "🚀",
  "🙂",
  "🙃",
  "😉",
  "😌",
  "🤩",
  "🥳",
  "😇",
  "🤗",
  "🤭",
  "🫢",
  "🫣",
  "🤫",
  "🫡",
  "🤐",
  "🤨",
  "😐",
  "😑",
  "😶",
  "🫥",
  "🙄",
  "😏",
  "😣",
  "😥",
  "😮‍💨",
  "🤐",
  "😯",
  "😲",
  "🥱",
  "😴",
  "🤤",
  "😵",
  "🤯",
  "🤠",
  "🥸",
  "😈",
  "👿",
  "👹",
  "👺",
  "💀",
  "☠️",
  "👻",
  "👽",
  "🤖",
  "💩",
  "😺",
  "😸",
  "😹",
  "😻",
  "😼",
  "😽",
  "🙀",
  "😿",
  "😾",
  "🫶",
  "🤝",
  "✌️",
  "🤞",
  "🤟",
  "🤘",
  "🤙",
  "👈",
  "👉",
  "👆",
  "👇",
  "☝️",
  "✋",
  "🤚",
  "🖐️",
  "🖖",
  "👌",
  "🤏",
  "🤌",
  "👊",
  "✊",
  "🤲",
  "🙇",
  "💅",
  "👋",
  "🤍",
  "🖤",
  "💙",
  "💜",
  "💛",
  "🧡",
  "🤎",
  "💔",
  "❣️",
  "💕",
  "💞",
  "💓",
  "💗",
  "💖",
  "💘",
  "💝",
  "💟",
  "💫",
  "💥",
  "💦",
  "💨",
  "💬",
  "💭",
  "⭐",
  "🌟",
  "✨",
  "⚡",
  "☀️",
  "🌈",
  "🌙",
  "🌻",
  "🌹",
  "🌺",
  "🌸",
  "🌼",
  "🍀",
  "🌿",
  "🍎",
  "🍕",
  "🍔",
  "🍟",
  "🍿",
  "🍩",
  "🍪",
  "🍫",
  "🍓",
  "🍉",
  "🍇",
  "🍌",
  "🍍",
  "🥑",
  "☕",
  "🍺",
  "🍻",
  "🍷",
  "🥂",
  "⚽",
  "🏀",
  "🏈",
  "🎾",
  "🏆",
  "🎯",
  "🎮",
  "🎲",
  "🎸",
  "🎤",
  "🎧",
  "🎨",
  "🎥",
  "📱",
  "💻",
  "📷",
  "📚",
  "💡",
  "🔔",
  "🔒",
  "🔑",
  "✅",
  "❎",
  "⚠️",
  "❗",
  "❓",
  "‼️",
  "⁉️",
  "➕",
  "➖",
  "🔴",
  "🟠",
  "🟡",
  "🟢",
  "🔵",
  "🟣",
  "⚫",
  "⚪",
];

// The web picker follows the same category order used by Flutter. The
// catalog is kept in one place so search and category navigation cannot drift
// apart as new emoji are added.
const emojiCategoryItems: Array<{
  label: string;
  icon: typeof MessageCircle;
  emojis: string[];
}> = [
  { label: "Smileys e pessoas", icon: Smile, emojis: composerEmojis.slice(0, 110) },
  {
    label: "Gestos e corpo",
    icon: UsersRound,
    emojis: composerEmojis.slice(105, 155),
  },
  {
    label: "Animais e natureza",
    icon: PawPrint,
    emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐔", "🐧", "🐦", "🦄", "🐝", "🦋", "🐢", "🐠", "🐬", "🐳", "🌸", "🌹", "🌻", "🌈", "🌴", "🍀"],
  },
  {
    label: "Comidas e bebidas",
    icon: ShoppingBag,
    emojis: composerEmojis.slice(155, 190),
  },
  {
    label: "Viagens e lugares",
    icon: CarFront,
    emojis: ["🚗", "🚕", "🚌", "🚓", "🚑", "🚒", "🚲", "✈️", "🚀", "🏠", "🏢", "⛺", "🌋", "🏖️", "🏟️", "🗺️"],
  },
  {
    label: "Objetos",
    icon: Lightbulb,
    emojis: composerEmojis.slice(190, 205),
  },
  {
    label: "Símbolos",
    icon: Coins,
    emojis: composerEmojis.slice(205),
  },
  {
    label: "Bandeiras",
    icon: Flag,
    emojis: ["🇧🇷", "🇺🇸", "🇵🇹", "🇪🇸", "🇫🇷", "🇮🇹", "🇩🇪", "🇬🇧", "🇯🇵", "🇰🇷", "🇨🇦", "🇦🇺"],
  },
];
const recentComposerEmojis = ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🔥", "🎉", "💯"];

// Reactions use the same complete catalog as the composer instead of the old
// six-item shortcut.  The menu is scrollable on small screens, so every
// category (people, animals, food, objects, symbols and flags) remains
// available without pushing actions outside the viewport.
const REACTION_EMOJIS = Array.from(
  new Set([
    ...composerEmojis,
    ...emojiCategoryItems.flatMap((category) => category.emojis),
  ]),
);

type MediaSendOptions = {
  mediaKind?: "sticker" | "gif";
  mediaSource?: string;
  mediaUrl?: string;
  mediaThumbnail?: string;
  isAnimated?: boolean;
};

function Tick({ state }: { state?: string }) {
  if (state === "pending") return <span className="ticks pending">◷</span>;
  if (state === "failed") return <span className="ticks failed">!</span>;
  if (state === "read" || state === "played")
    return <span className="ticks read">✓✓</span>;
  if (state === "delivered") return <span className="ticks">✓✓</span>;
  return <span className="ticks">✓</span>;
}

type SweepstakeDraft = {
  question: string;
  durationValue: number;
  durationUnit: "m" | "h" | "d";
  maxParticipants: number;
  winnersCount: number;
};

function SweepstakeCreateModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: SweepstakeDraft) => void;
}) {
  const [question, setQuestion] = useState("");
  const [durationValue, setDurationValue] = useState("60");
  const [durationUnit, setDurationUnit] = useState<"m" | "h" | "d">("m");
  const [maxParticipants, setMaxParticipants] = useState("100");
  const [winnersCount, setWinnersCount] = useState("1");
  const [error, setError] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const duration = Number(durationValue);
    const limit = Number(maxParticipants);
    const winners = Number(winnersCount);
    if (
      !question.trim() ||
      duration <= 0 ||
      limit <= 0 ||
      winners <= 0 ||
      winners > limit
    ) {
      setError(
        "Preencha os campos corretamente. A quantidade de ganhadores não pode superar os participantes.",
      );
      return;
    }
    onSubmit({
      question: question.trim(),
      durationValue: duration,
      durationUnit,
      maxParticipants: limit,
      winnersCount: winners,
    });
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form className="quick-modal sweepstake-modal" onSubmit={submit}>
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>
                <Trophy /> Novo sorteio
              </h2>
              <InfoTip label="Novo sorteio">
                Crie uma enquete de participação, defina o prazo e a quantidade de ganhadores.
              </InfoTip>
            </div>
            <small>Uma enquete de participação será enviada ao grupo.</small>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
          >
            <X />
          </button>
        </header>
        <div className="quick-form sweepstake-form">
          <label>
            O que será sorteado?
            <input
              autoFocus
              maxLength={160}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ex.: Kit de produtos BotAdmin"
            />
          </label>
          <div className="sweepstake-grid">
            <label>
              Duração
              <input
                inputMode="numeric"
                value={durationValue}
                onChange={(event) =>
                  setDurationValue(event.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <label>
              Unidade
              <select
                value={durationUnit}
                onChange={(event) =>
                  setDurationUnit(event.target.value as "m" | "h" | "d")
                }
              >
                <option value="m">minutos</option>
                <option value="h">horas</option>
                <option value="d">dias</option>
              </select>
            </label>
          </div>
          <label>
            Limite de participantes
            <input
              inputMode="numeric"
              value={maxParticipants}
              onChange={(event) =>
                setMaxParticipants(event.target.value.replace(/\D/g, ""))
              }
            />
            <small>Cada pessoa participa clicando em “Participar”.</small>
          </label>
          <label>
            Quantidade de ganhadores
            <input
              inputMode="numeric"
              value={winnersCount}
              onChange={(event) =>
                setWinnersCount(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="sweepstake-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Enviando…" : "Enviar enquete"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function SweepstakeDetailsModal({
  sweepstake,
  canDraw,
  busy,
  members,
  onClose,
  onRefresh,
  onDraw,
  onCancel,
  onAddMember,
}: {
  sweepstake: SweepstakeSummary;
  canDraw: boolean;
  busy: boolean;
  members: JsonRecord[];
  onClose: () => void;
  onRefresh: () => void;
  onDraw: () => void;
  onCancel: () => void;
  onAddMember: (userId: number) => void;
}) {
  const [memberPicker, setMemberPicker] = useState(false);
  const participantIds = new Set(
    (sweepstake.participants || []).map((person) =>
      String(person.userId || person.jid || ""),
    ),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="quick-modal sweepstake-modal sweepstake-details">
        <header>
          <div>
            <h2>
              <Trophy /> {sweepstake.question}
            </h2>
            <small>
              {sweepstake.participants.length}
              {sweepstake.maxParticipants
                ? `/${sweepstake.maxParticipants}`
                : ""}{" "}
              participantes · {sweepstake.winnersCount} ganhador(es)
            </small>
          </div>
          <div className="sweepstake-header-actions">
            <button
              onClick={onRefresh}
              disabled={busy}
              title="Atualizar participantes"
            >
              <RefreshCw className={busy ? "spin" : ""} />
            </button>
            {canDraw && members.length > 0 && (
              <button
                onClick={() => setMemberPicker((value) => !value)}
                disabled={busy}
                title="Adicionar participante"
              >
                <UserPlus />
              </button>
            )}
            <button onClick={onClose} disabled={busy} aria-label="Fechar">
              <X />
            </button>
          </div>
        </header>
        {memberPicker && (
          <div className="sweepstake-member-picker">
            <b>Adicionar participante</b>
            <div>
              {members.map((member) => {
                const userId = Number(member.userId || member.id || 0);
                const jid = String(
                  member.userId || member.id || member.jid || "",
                );
                const disabled = !userId || participantIds.has(jid);
                return (
                  <button
                    key={jid || String(member.email)}
                    disabled={disabled || busy}
                    onClick={() => {
                      setMemberPicker(false);
                      onAddMember(userId);
                    }}
                  >
                    <Avatar
                      name={String(
                        member.name ||
                          member.displayName ||
                          member.email ||
                          "Membro",
                      )}
                      src={String(member.avatarUrl || "")}
                      small
                    />
                    <span>
                      <b>
                        {String(member.name || member.displayName || "Membro")}
                      </b>
                      <small>
                        {disabled
                          ? "Já participa"
                          : String(
                              member.email ||
                                member.phone ||
                                "Adicionar ao sorteio",
                            )}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="sweepstake-participants">
          {sweepstake.participants.length ? (
            sweepstake.participants.map((person, index) => {
              const identity = String(person.userId || person.jid || index);
              const label =
                person.displayName ||
                person.jid ||
                `Membro ${person.userId || index + 1}`;
              return (
                <div key={identity}>
                  <Avatar name={label} small />
                  <span>
                    <b>{label}</b>
                    <small>
                      {person.joinedAt
                        ? new Date(person.joinedAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Participante confirmado"}
                    </small>
                  </span>
                </div>
              );
            })
          ) : (
            <div className="module-state">
              <Trophy />
              <b>Ainda não há participantes.</b>
            </div>
          )}
        </div>
        <footer className="sweepstake-actions">
          {canDraw && sweepstake.status === "active" ? (
            <>
              <button
                className="secondary-button"
                onClick={onCancel}
                disabled={busy}
              >
                Cancelar sorteio
              </button>
              <button
                className="primary-button"
                onClick={onDraw}
                disabled={busy || !sweepstake.participants.length}
              >
                <Trophy /> Sortear {sweepstake.winnersCount}
              </button>
            </>
          ) : (
            <button className="primary-button" onClick={onClose}>
              Fechar
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function Chat({
  thread,
  messages,
  loading,
  loadingOlder,
  hasOlder,
  onLoadOlder,
  onBack,
  onSend,
  onSendMedia,
  onAction,
  onMessageAction,
  onMention,
}: {
  thread: ConversationThread | null;
  messages: ChatMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  onLoadOlder: () => void;
  onBack: () => void;
  onSend: (text: string) => Promise<void>;
  onSendMedia: (file: File, options?: MediaSendOptions) => Promise<void>;
  onAction: (thread: ConversationThread, action: ConversationUiAction) => void;
  onMessageAction: (
    message: ChatMessage,
    action: MessageUiAction,
    payload?: JsonRecord,
  ) => void | Promise<void>;
  onMention: (mention: MessageMention) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategoryIndex, setEmojiCategoryIndex] = useState(0);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingCancelling, setRecordingCancelling] = useState(false);
  const [recordingDraft, setRecordingDraft] = useState<File | null>(null);
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState("");
  const [recordingError, setRecordingError] = useState("");
  const [giphyKind, setGiphyKind] = useState<"gifs" | "stickers" | null>(
    null,
  );
  const [giphyQuery, setGiphyQuery] = useState("");
  const [giphyItems, setGiphyItems] = useState<GiphyMediaItem[]>([]);
  const [giphyLoading, setGiphyLoading] = useState(false);
  const [giphyError, setGiphyError] = useState("");
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null);
  const [reactionMenuId, setReactionMenuId] = useState<string | null>(null);
  const [messageMenuPlacement, setMessageMenuPlacement] = useState<
    "above" | "below"
  >("below");
  const [sweepstakes, setSweepstakes] =
    useState<SweepstakeGroupSnapshot | null>(null);
  const [sweepstakeBusy, setSweepstakeBusy] = useState(false);
  const [sweepstakeCreateOpen, setSweepstakeCreateOpen] = useState(false);
  const [sweepstakeDetailsOpen, setSweepstakeDetailsOpen] = useState(false);
  const [sweepstakeMembers, setSweepstakeMembers] = useState<JsonRecord[]>([]);
  const [interactivePending, setInteractivePending] = useState<string | null>(
    null,
  );
  const mediaInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recordingPointerActiveRef = useRef(false);
  const recordingCancelledRef = useRef(false);
  const recordingStopActionRef = useRef<"send" | "cancel">("send");
  const recordingStartPointRef = useRef({ x: 0, y: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const previousThread = useRef("");
  const previousMessageKeys = useRef<string[]>([]);
  const scrollMetricsRef = useRef({
    top: 0,
    height: 0,
    atBottom: true,
    initialized: false,
    anchorKey: "",
    anchorOffset: 0,
  });
  const olderRequestRef = useRef(false);
  const applyScrollMetrics = () => {
    const area = messageAreaRef.current;
    if (!area) return;
    const distanceFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
    const areaTop = area.getBoundingClientRect().top;
    let anchorKey = "";
    let anchorOffset = 0;
    for (const bubble of area.querySelectorAll<HTMLElement>(
      "[data-message-key]",
    )) {
      const bounds = bubble.getBoundingClientRect();
      if (bounds.bottom > areaTop + 1) {
        anchorKey = bubble.dataset.messageKey || "";
        anchorOffset = bounds.top - areaTop;
        break;
      }
    }
    scrollMetricsRef.current = {
      top: area.scrollTop,
      height: area.scrollHeight,
      atBottom: distanceFromBottom <= 120,
      initialized: scrollMetricsRef.current.initialized,
      anchorKey,
      anchorOffset,
    };
  };
  useLayoutEffect(() => {
    const key = thread ? `${thread.instanceId}:${thread.chatJid}` : "";
    const area = messageAreaRef.current;
    if (key !== previousThread.current) {
      previousThread.current = key;
      previousMessageKeys.current = [];
      scrollMetricsRef.current = {
        top: 0,
        height: area?.scrollHeight || 0,
        atBottom: true,
        initialized: false,
        anchorKey: "",
        anchorOffset: 0,
      };
      olderRequestRef.current = false;
    }
    if (!area || !thread || !messages.length) {
      previousMessageKeys.current = messages.map(messageKey);
      if (area) applyScrollMetrics();
      return;
    }
    const previousKeys = previousMessageKeys.current;
    const currentKeys = messages.map(messageKey);
    const previousMetrics = scrollMetricsRef.current;
    if (!previousMetrics.initialized) {
      area.scrollTop = area.scrollHeight;
      scrollMetricsRef.current.initialized = true;
    } else if (previousKeys.length && currentKeys.length) {
      const previousFirst = previousKeys[0];
      const previousLast = previousKeys[previousKeys.length - 1];
      const currentFirstIndex = currentKeys.indexOf(previousFirst);
      const currentLastIndex = currentKeys.indexOf(previousLast);
      const prepended = currentFirstIndex > 0 && currentLastIndex >= currentFirstIndex;
      if (previousMetrics.atBottom) {
        area.scrollTop = area.scrollHeight;
      } else if (previousMetrics.anchorKey) {
        const anchor = [...area.querySelectorAll<HTMLElement>("[data-message-key]")]
          .find((bubble) => bubble.dataset.messageKey === previousMetrics.anchorKey);
        if (anchor) {
          const currentOffset =
            anchor.getBoundingClientRect().top - area.getBoundingClientRect().top;
          area.scrollTop += currentOffset - previousMetrics.anchorOffset;
        } else if (prepended) {
          area.scrollTop =
            previousMetrics.top + (area.scrollHeight - previousMetrics.height);
        } else {
          area.scrollTop = Math.min(
            previousMetrics.top,
            Math.max(0, area.scrollHeight - area.clientHeight),
          );
        }
      } else if (prepended) {
        area.scrollTop =
          previousMetrics.top + (area.scrollHeight - previousMetrics.height);
      } else {
        // A realtime refresh or a delivery receipt never steals the user's
        // reading position when they are not at the bottom.
        area.scrollTop = Math.min(
          previousMetrics.top,
          Math.max(0, area.scrollHeight - area.clientHeight),
        );
      }
    }
    previousMessageKeys.current = currentKeys;
    applyScrollMetrics();
  }, [thread, messages]);
  useEffect(() => {
    if (!loadingOlder) olderRequestRef.current = false;
  }, [loadingOlder]);
  useEffect(() => {
    const area = messageAreaRef.current;
    if (
      !area ||
      !hasOlder ||
      loadingOlder ||
      olderRequestRef.current ||
      area.scrollHeight > area.clientHeight + 1
    )
      return;
    olderRequestRef.current = true;
    onLoadOlder();
  }, [hasOlder, loadingOlder, messages.length, onLoadOlder]);
  useEffect(
    () => () => {
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingPreviewUrl) URL.revokeObjectURL(recordingPreviewUrl);
    },
    [recordingPreviewUrl],
  );
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateViewportHeight = () => {
      document.documentElement.style.setProperty(
        "--botadmin-visual-height",
        `${Math.round(viewport.height)}px`,
      );
    };
    updateViewportHeight();
    viewport.addEventListener("resize", updateViewportHeight);
    viewport.addEventListener("scroll", updateViewportHeight);
    return () => {
      viewport.removeEventListener("resize", updateViewportHeight);
      viewport.removeEventListener("scroll", updateViewportHeight);
    };
  }, []);
  useEffect(() => {
    if (!giphyKind) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGiphyLoading(true);
      setGiphyError("");
      void api
        .giphySearch(giphyKind, giphyQuery)
        .then((result) => {
          if (!cancelled) setGiphyItems(result.items || []);
        })
        .catch((cause) => {
          if (!cancelled) {
            setGiphyItems([]);
            setGiphyError(
              cause instanceof Error
                ? cause.message
                : "Não foi possível carregar as mídias.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setGiphyLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [giphyKind, giphyQuery]);
  const isGroupChat = Boolean(
    thread &&
    (thread.chatType === "internal_group" ||
      String(thread.chatType || "").includes("group")),
  );
  const sweepstakeInternal = thread?.chatType === "internal_group";
  const sweepstakeGroupId = thread
    ? sweepstakeInternal
      ? Number(String(thread.chatJid).replace("internal:", ""))
      : Number(thread.linkedGroupId || 0)
    : 0;
  const loadSweepstakes = useCallback(async () => {
    if (!sweepstakeGroupId || !isGroupChat) {
      setSweepstakes(null);
      return;
    }
    setSweepstakeBusy(true);
    try {
      setSweepstakes(
        await api.groupSweepstakes(sweepstakeGroupId, sweepstakeInternal),
      );
    } catch {
      setSweepstakes(null);
    } finally {
      setSweepstakeBusy(false);
    }
  }, [isGroupChat, sweepstakeGroupId, sweepstakeInternal]);
  useEffect(() => {
    setSweepstakeCreateOpen(false);
    setSweepstakeDetailsOpen(false);
    setSweepstakeMembers([]);
    void loadSweepstakes();
  }, [loadSweepstakes]);
  const activeSweepstake = sweepstakes?.active?.[0] || null;
  const createSweepstake = async (draft: SweepstakeDraft) => {
    if (!sweepstakeGroupId || sweepstakeBusy) return;
    setSweepstakeBusy(true);
    try {
      const result = await api.createGroupSweepstake(
        sweepstakeGroupId,
        draft,
        sweepstakeInternal,
      );
      setSweepstakes({
        active: result.active || [],
        history: result.history || [],
      });
      setSweepstakeCreateOpen(false);
    } catch (cause) {
      window.alert(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar o sorteio.",
      );
    } finally {
      setSweepstakeBusy(false);
    }
  };
  const openSweepstakeDetails = async () => {
    if (!activeSweepstake) return;
    setSweepstakeDetailsOpen(true);
    if (sweepstakeInternal && sweepstakeGroupId) {
      try {
        const result = await api.internalGroup(sweepstakeGroupId);
        setSweepstakeMembers(
          Array.isArray((result as unknown as JsonRecord).members)
            ? ((result as unknown as JsonRecord).members as JsonRecord[])
            : [],
        );
      } catch {
        setSweepstakeMembers([]);
      }
    }
  };
  const finalizeSweepstake = async () => {
    if (!activeSweepstake || sweepstakeBusy || !sweepstakeGroupId) return;
    setSweepstakeBusy(true);
    try {
      setSweepstakes(
        await api.finalizeGroupSweepstake(
          sweepstakeGroupId,
          activeSweepstake.id,
          sweepstakeInternal,
        ),
      );
      setSweepstakeDetailsOpen(false);
    } catch (cause) {
      window.alert(
        cause instanceof Error
          ? cause.message
          : "Não foi possível realizar o sorteio.",
      );
    } finally {
      setSweepstakeBusy(false);
    }
  };
  const cancelSweepstake = async () => {
    if (
      !activeSweepstake ||
      sweepstakeBusy ||
      !sweepstakeGroupId ||
      !window.confirm("Cancelar este sorteio e avisar o grupo?")
    )
      return;
    setSweepstakeBusy(true);
    try {
      setSweepstakes(
        await api.cancelGroupSweepstake(
          sweepstakeGroupId,
          activeSweepstake.id,
          sweepstakeInternal,
        ),
      );
      setSweepstakeDetailsOpen(false);
    } catch (cause) {
      window.alert(
        cause instanceof Error
          ? cause.message
          : "Não foi possível cancelar o sorteio.",
      );
    } finally {
      setSweepstakeBusy(false);
    }
  };
  const addSweepstakeMember = async (userId: number) => {
    if (!activeSweepstake || sweepstakeBusy || !sweepstakeGroupId) return;
    setSweepstakeBusy(true);
    try {
      setSweepstakes(
        await api.addGroupSweepstakeParticipant(
          sweepstakeGroupId,
          activeSweepstake.id,
          userId,
        ),
      );
    } catch (cause) {
      window.alert(
        cause instanceof Error
          ? cause.message
          : "Não foi possível adicionar o participante.",
      );
    } finally {
      setSweepstakeBusy(false);
    }
  };
  if (!thread) {
    return (
      <main className="chat empty-pane">
        <img src={emptyLogo} alt="" />
        <h1>WhatsApp Business Web</h1>
        <p>Amplie, organize e gerencie sua conta comercial.</p>
        <div>
          <LockKeyhole size={14} /> Suas mensagens pessoais são protegidas com a
          criptografia de ponta a ponta.
        </div>
      </main>
    );
  }
  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await onSend(text);
  };
  const insertEmoji = (emoji: string) => {
    const input = textareaRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    setDraft(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  const startRecording = async (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      recording ||
      recordingDraft ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      return;
    recordingPointerActiveRef.current = true;
    recordingCancelledRef.current = false;
    recordingStopActionRef.current = "send";
    recordingStartPointRef.current = {
      x: event?.clientX || 0,
      y: event?.clientY || 0,
    };
    setRecordingError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The pointer can be released while the permission prompt is open. Do
      // not start a recorder after that release; it would otherwise leave the
      // microphone running invisibly and create an unexpected audio message.
      if (!recordingPointerActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream);
      recorderChunksRef.current = [];
      recorder.ondataavailable = (dataEvent) => {
        if (dataEvent.data.size) recorderChunksRef.current.push(dataEvent.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        const cancelled =
          recordingCancelledRef.current ||
          recordingStopActionRef.current === "cancel";
        if (cancelled || !blob.size) {
          setRecordingCancelling(false);
          return;
        }
        const file = new File([blob], `audio-${Date.now()}.webm`, {
          type: blob.type || "audio/webm",
        });
        setRecordingDraft(file);
        setRecordingPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(file);
        });
        setRecordingCancelling(false);
      };
      recorderStreamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start(120);
      setRecording(true);
    } catch (cause) {
      recordingPointerActiveRef.current = false;
      setRecording(false);
      setRecordingError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Permita o microfone para gravar áudios."
          : "Não foi possível acessar o microfone.",
      );
    }
  };
  const stopRecording = (cancel = false) => {
    if (!cancel && recordingCancelledRef.current) return;
    recordingPointerActiveRef.current = false;
    recordingCancelledRef.current = cancel;
    recordingStopActionRef.current = cancel ? "cancel" : "send";
    setRecordingCancelling(cancel);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };
  const clearRecordingDraft = () => {
    setRecordingDraft(null);
    setRecordingPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  };
  const sendRecordingDraft = async () => {
    const file = recordingDraft;
    if (!file) return;
    clearRecordingDraft();
    await onSendMedia(file);
  };
  const sendGiphy = async (item: GiphyMediaItem) => {
    if (!giphyKind) return;
    const source =
      giphyKind === "stickers"
        ? item.webpUrl || item.originalUrl || item.previewUrl
        : item.originalUrl || item.mp4Url || item.previewUrl;
    if (!source) return;
    setGiphyLoading(true);
    setGiphyError("");
    try {
      const blob = await api.giphyMedia(source);
      const fallbackType = giphyKind === "stickers" ? "image/webp" : "image/gif";
      const mime = blob.type || fallbackType;
      const extension = mime.includes("webp")
        ? "webp"
        : mime.includes("mp4")
          ? "mp4"
          : mime.includes("gif")
            ? "gif"
            : "bin";
      const file = new File([blob], `giphy-${item.id}.${extension}`, {
        type: mime,
      });
      await onSendMedia(file, {
        mediaKind: giphyKind === "stickers" ? "sticker" : "gif",
        mediaSource: "giphy",
        mediaUrl: source,
        mediaThumbnail: item.previewUrl,
        isAnimated: giphyKind === "gifs",
      });
      setGiphyKind(null);
      setEmojiOpen(false);
      setAttachmentOpen(false);
    } catch (cause) {
      setGiphyError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar esta mídia.",
      );
    } finally {
      setGiphyLoading(false);
    }
  };
  const reactionMap = new Map<string, string[]>();
  for (const message of messages) {
    if (message.messageType !== "reaction" && message.type !== "reaction")
      continue;
    const media = message.media || {};
    const target = String(media.targetMessageId || "");
    const emoji = String(media.emoji || message.text || "");
    if (target && emoji)
      reactionMap.set(target, [...(reactionMap.get(target) || []), emoji]);
  }
  const visibleMessages = messages.filter((message) => {
    if (message.messageType === "reaction" || message.type === "reaction")
      return false;
    if (searchTerm.trim()) {
      const media = message.media || {};
      const haystack = textString(
        message.text,
        message.body,
        message.caption,
        media.body,
        media.caption,
        media.title,
      ).toLocaleLowerCase("pt-BR");
      if (!haystack.includes(searchTerm.trim().toLocaleLowerCase("pt-BR")))
        return false;
    }
    return true;
  });
  return (
    <main className="chat">
      <header className="chat-header">
        <button
          type="button"
          className="mobile-back"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onBack();
          }}
          aria-label="Voltar para conversas"
        >
          <ArrowLeft />
        </button>
        <Avatar name={thread.title} src={thread.avatarUrl} small />
        <button
          className="chat-heading"
          onClick={() => onAction(thread, "details")}
          aria-label="Abrir dados da conversa"
        >
          <strong>
            {thread.title}{" "}
            {thread.chatType === "internal_group" && <em>BOTADMIN</em>}
          </strong>
          <span>
            {thread.chatType === "internal_group"
              ? `${thread.memberCount || 0} membros · Grupo BotAdmin`
              : thread.phone || "toque para dados da conversa"}
          </span>
        </button>
        <div className="chat-actions">
          {searchOpen && (
            <input
              className="chat-search"
              autoFocus
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Pesquisar"
            />
          )}
          <button
            title="Pesquisar"
            onClick={() => {
              setEmojiOpen(false);
              setGiphyKind(null);
              setAttachmentOpen(false);
              setSearchOpen((value) => !value);
              if (searchOpen) setSearchTerm("");
            }}
          >
            <Search />
          </button>
          {canManageGroupThread(thread) && (
            <button
              className={`group-bot-shortcut ${thread.internalBotEnabled ? "is-active" : ""}`}
              title={
                thread.chatType !== "internal_group" &&
                thread.internalBotEnabled === undefined
                  ? "Abrir robô e ativações"
                  : thread.internalBotEnabled
                  ? "Robô ativo · abrir ativações"
                  : "Ativar e configurar robô"
              }
              onClick={() => onAction(thread, "group-settings")}
            >
              <Bot />
              <span>Robô</span>
            </button>
          )}
          <ConversationMenu thread={thread} onAction={onAction} compact />
        </div>
      </header>
      {searchOpen && (
        <div className="chat-search-row">
          <Search />
          <input
            autoFocus
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Pesquisar mensagens"
            aria-label="Pesquisar mensagens"
          />
          <button
            type="button"
            aria-label="Fechar pesquisa de mensagens"
            onClick={() => {
              setSearchOpen(false);
              setSearchTerm("");
            }}
          >
            <X />
          </button>
        </div>
      )}
      <div
        className="message-area"
        ref={messageAreaRef}
        onScroll={() => {
          applyScrollMetrics();
          const area = messageAreaRef.current;
          if (
            area &&
            area.scrollTop <= 180 &&
            hasOlder &&
            !loadingOlder &&
            !olderRequestRef.current
          ) {
            olderRequestRef.current = true;
            onLoadOlder();
          }
        }}
        style={
          thread.chatType === "internal_group" && thread.wallpaperUrl
            ? {
                backgroundImage: `linear-gradient(#efeae2df, #efeae2df), url("${absoluteMediaUrl(thread.wallpaperUrl)}")`,
                backgroundSize: "auto, cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {loadingOlder && (
          <div className="message-history-loader" role="status" aria-live="polite">
            <span>
              <RefreshCw className="spin" />
              Carregando mensagens antigas…
            </span>
          </div>
        )}
        {loading && !messages.length && (
          <div className="message-loading">
            <RefreshCw className="spin" />
            Carregando mensagens…
          </div>
        )}
        {visibleMessages.map((message) => {
          const mine =
            message.isMine === true ||
            message.direction === "outbound" ||
            message.direction === "sent";
          const time = message.createdAt || message.timestamp;
          const media = message.media || {};
          const body = textString(
            message.text,
            message.body,
            message.caption,
            media.body,
            media.caption,
            media.description,
          );
          const title = textString(message.title, media.title, media.header);
          const footer = textString(message.footer, media.footer);
          const fallback = fallbackMessageLabel(message);
          const nestedButtons = Array.isArray(media.buttons)
            ? (media.buttons as Array<{
                id?: string;
                title?: string;
                label?: string;
                type?: string;
                url?: string;
                copyCode?: string;
                phoneNumber?: string;
              }>)
            : [];
          const buttons = message.buttons?.length
            ? message.buttons
            : nestedButtons;
          const reactionEntries = Array.isArray(message.reactions)
            ? message.reactions
            : [];
          const ownReactions = reactionEntries
            .map((entry) =>
              typeof entry === "string"
                ? entry
                : String((entry as JsonRecord).emoji || ""),
            )
            .filter(Boolean);
          const reactions = [
            ...(reactionMap.get(
              String(
                (message as ChatMessage & { messageId?: string }).messageId ||
                  message.id,
              ),
            ) || []),
            ...ownReactions,
          ];
          const renderedMessageKey = String(message.messageId || message.id);
          const canEdit =
            thread.chatType === "internal_group" &&
            mine &&
            Boolean(body) &&
            !message.deleted &&
            !message.optimistic;
          const canDelete =
            !message.optimistic && (mine || Boolean(thread.canManage));
          return (
            <article
              key={messageKey(message)}
              data-message-key={messageKey(message)}
              className={`bubble ${mine ? "outgoing" : "incoming"} ${message.optimistic ? "optimistic" : ""}`}
              onMouseLeave={() => {
                setMessageMenuId((current) =>
                  current === renderedMessageKey ? null : current,
                );
                setReactionMenuId((current) =>
                  current === renderedMessageKey ? null : current,
                );
              }}
            >
              {!message.optimistic && (
                <div className="message-action-wrap">
                  <button
                    className="message-action-trigger"
                    aria-label="Ações da mensagem"
                    aria-expanded={messageMenuId === renderedMessageKey}
                    onClick={(event) => {
                      event.stopPropagation();
                      const triggerBounds = (
                        event.currentTarget as HTMLButtonElement
                      ).getBoundingClientRect();
                      setMessageMenuPlacement(
                        triggerBounds.bottom + 260 > window.innerHeight
                          ? "above"
                          : "below",
                      );
                      setMessageMenuId((current) =>
                        current === renderedMessageKey
                          ? null
                          : renderedMessageKey,
                      );
                      setReactionMenuId(null);
                    }}
                  >
                    ⌄
                  </button>
                  {messageMenuId === renderedMessageKey && (
                    <div
                      className={`message-action-menu message-action-menu--${messageMenuPlacement} message-action-menu--${mine ? "outgoing" : "incoming"}`}
                      role="menu"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setReactionMenuId((current) =>
                            current === renderedMessageKey
                              ? null
                              : renderedMessageKey,
                          );
                        }}
                      >
                        <Smile size={15} /> Reagir
                      </button>
                      {reactionMenuId === renderedMessageKey && (
                        <div className="reaction-choices">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              aria-label={`Reagir com ${emoji}`}
                              onClick={() => {
                                onMessageAction(message, "react", { emoji });
                                setMessageMenuId(null);
                                setReactionMenuId(null);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => {
                            const next = window.prompt("Editar mensagem", body);
                            if (
                              next !== null &&
                              next.trim() &&
                              next.trim() !== body
                            )
                              onMessageAction(message, "edit", {
                                text: next.trim(),
                              });
                            setMessageMenuId(null);
                          }}
                        >
                          <Settings size={15} /> Editar
                        </button>
                      )}
                      <button
                        onClick={() => {
                          onMessageAction(
                            message,
                            message.pinned ? "unpin" : "pin",
                          );
                          setMessageMenuId(null);
                        }}
                      >
                        {message.pinned ? (
                          <>
                            <ShieldCheck size={15} /> Desfixar
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={15} /> Fixar
                          </>
                        )}
                      </button>
                      {canDelete && (
                        <button
                          className="danger-action"
                          onClick={() => {
                            if (
                              window.confirm("Apagar esta mensagem para todos?")
                            )
                              onMessageAction(message, "delete");
                            setMessageMenuId(null);
                          }}
                        >
                          <X size={15} /> Apagar
                        </button>
                      )}
                      {mine && (
                        <button
                          onClick={() => {
                            onMessageAction(message, "info");
                            setMessageMenuId(null);
                          }}
                        >
                          <Eye size={15} /> Informações
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!mine && message.senderName && (
                <strong>
                  {message.isBot ? "🤖 " : ""}
                  {message.senderName}
                </strong>
              )}
              {message.replyTo && (
                <div className="reply">
                  <b>{message.replyTo.senderName || "Mensagem"}</b>
                  <span>{message.replyTo.text || "Mídia"}</span>
                </div>
              )}
              {title && title !== body && (
                <h4 className="message-title">{title}</h4>
              )}
              <MessageMedia message={message} />
              {body && <p>{renderMessageBody(body, message, onMention)}</p>}
              {!body &&
                !mediaString(
                  message.mediaUrl,
                  message.thumbnailUrl,
                  media.url,
                  media.headerMedia,
                  media.path,
                ) &&
                fallback && <p className="message-fallback">{fallback}</p>}
              {footer && <small className="message-footer">{footer}</small>}
              {buttons.length ? (
                <div className="message-buttons">
                  {buttons.map((button, index) => (
                    <button
                      key={button.id || index}
                      disabled={
                        interactivePending ===
                        `${renderedMessageKey}:${button.id || index}`
                      }
                      onClick={() => {
                        const label =
                          button.title || button.label || "Selecionar";
                        if (button.url) {
                          window.open(
                            button.url,
                            "_blank",
                            "noopener,noreferrer",
                          );
                          return;
                        }
                        if (
                          button.type === "cta_copy" ||
                          button.type === "copy"
                        ) {
                          void navigator.clipboard.writeText(
                            String(button.copyCode || label),
                          );
                          return;
                        }
                        if (
                          button.type === "cta_call" ||
                          button.type === "call"
                        ) {
                          window.location.href = `tel:${button.phoneNumber || label}`;
                          return;
                        }
                        const pendingKey = `${renderedMessageKey}:${button.id || index}`;
                        setInteractivePending(pendingKey);
                        const interactiveAction: MessageUiAction =
                          thread.chatType === "internal_group" &&
                          button.id === "join"
                            ? "poll_vote"
                            : "interactive_reply";
                        void Promise.resolve(
                          onMessageAction(message, interactiveAction, {
                            selectedId: button.id || String(index),
                            optionId: button.id || String(index),
                            selectedText: label,
                            title: label,
                          }),
                        ).then(() => {
                          if (interactiveAction === "poll_vote")
                            void loadSweepstakes();
                        });
                      }}
                    >
                      {interactivePending ===
                      `${renderedMessageKey}:${button.id || index}`
                        ? "Enviado ✓"
                        : button.title || button.label || "Selecionar"}
                    </button>
                  ))}
                </div>
              ) : null}
              {reactions.length > 0 && (
                <div className="reaction-badge">
                  {reactions.slice(0, 4).join(" ")}
                </div>
              )}
              <time>
                {message.pinned && (
                  <span className="message-pin" title="Mensagem fixada">
                    📌
                  </span>
                )}
                {message.editedAt && (
                  <span className="message-edited">editada</span>
                )}
                {time
                  ? new Date(time).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
                {mine && <Tick state={message.deliveryState} />}
              </time>
            </article>
          );
        })}
        {!loading && !messages.length && (
          <div className="chat-start">
            <LockKeyhole />
            <b>As mensagens são exibidas com segurança.</b>
            <span>Envie uma mensagem para começar a conversa.</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {activeSweepstake && (
        <button
          className="active-sweepstake-button"
          onClick={() => void openSweepstakeDetails()}
          title="Abrir sorteio ativo"
          aria-label={`Abrir sorteio: ${activeSweepstake.question}`}
        >
          <Trophy />
          <span>{activeSweepstake.participants.length}</span>
        </button>
      )}
      {sweepstakeCreateOpen && (
        <SweepstakeCreateModal
          busy={sweepstakeBusy}
          onClose={() => setSweepstakeCreateOpen(false)}
          onSubmit={(draft) => void createSweepstake(draft)}
        />
      )}
      {sweepstakeDetailsOpen && activeSweepstake && (
        <SweepstakeDetailsModal
          sweepstake={activeSweepstake}
          canDraw={Boolean(thread.canManage || thread.instanceIsAdmin)}
          busy={sweepstakeBusy}
          members={sweepstakeMembers}
          onClose={() => setSweepstakeDetailsOpen(false)}
          onRefresh={() => void loadSweepstakes()}
          onDraw={() => void finalizeSweepstake()}
          onCancel={() => void cancelSweepstake()}
          onAddMember={(userId) => void addSweepstakeMember(userId)}
        />
      )}
      <footer className="composer">
        <div className="composer-attach">
          <button
            title="Anexar"
            aria-expanded={attachmentOpen}
            onClick={() => {
              setEmojiOpen(false);
              setAttachmentOpen((value) => !value);
            }}
          >
            <Plus />
          </button>
          {attachmentOpen && (
            <div className="attachment-menu" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  setAttachmentOpen(false);
                  mediaInput.current?.click();
                }}
              >
                <Image />
                <span>Fotos, vídeos e documentos</span>
              </button>
              {isGroupChat && (
                <button
                  type="button"
                  onClick={() => {
                    setAttachmentOpen(false);
                    setSweepstakeCreateOpen(true);
                  }}
                >
                  <Trophy />
                  <span>Sorteio</span>
                </button>
              )}
              <button type="button" onClick={() => setAttachmentOpen(false)}>
                <X />
                <span>Fechar</span>
              </button>
            </div>
          )}
          <input
            ref={mediaInput}
            type="file"
            hidden
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onSendMedia(file);
            }}
          />
        </div>
        <div className="composer-emoji">
          <button
            title="Emojis"
            aria-expanded={emojiOpen}
            onClick={() => {
              setAttachmentOpen(false);
              setGiphyKind(null);
              setEmojiOpen((value) => !value);
            }}
          >
            <Smile />
          </button>
          {emojiOpen && (
            <div
              className={`emoji-menu ${giphyKind ? "emoji-menu--media-picker" : ""}`}
              onClick={(event) => event.stopPropagation()}
            >
              {!giphyKind ? (
                <>
                  <div className="emoji-category-bar" role="tablist" aria-label="Categorias de emoji">
                    <button
                      type="button"
                      className={emojiCategoryIndex === -1 ? "active" : ""}
                      role="tab"
                      aria-label="Recentes"
                      aria-selected={emojiCategoryIndex === -1}
                      onClick={() => setEmojiCategoryIndex(-1)}
                    >
                      <Clock3 />
                    </button>
                    {emojiCategoryItems.map((category, index) => {
                      const Icon = category.icon;
                      return (
                        <button
                          type="button"
                          key={category.label}
                          className={emojiCategoryIndex === index ? "active" : ""}
                          role="tab"
                          aria-label={category.label}
                          aria-selected={emojiCategoryIndex === index}
                          onClick={() => setEmojiCategoryIndex(index)}
                        >
                          <Icon />
                        </button>
                      );
                    })}
                  </div>
                  <label className="emoji-search">
                    <Search />
                    <input
                      value={emojiSearch}
                      onChange={(event) => setEmojiSearch(event.target.value)}
                      placeholder="Pesquisar emoji"
                      aria-label="Pesquisar emoji"
                    />
                  </label>
                  <div className="emoji-picker-body">
                    {!emojiSearch.trim() && (
                      <>
                        <h4>Recentes</h4>
                        <div className="emoji-grid emoji-grid--recent">
                          {recentComposerEmojis.map((emoji) => (
                            <button type="button" key={`recent-${emoji}`} onClick={() => insertEmoji(emoji)}>
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <h4>
                      {emojiSearch.trim()
                        ? "Resultado da busca"
                        : emojiCategoryIndex < 0
                          ? "Smileys e pessoas"
                          : emojiCategoryItems[emojiCategoryIndex]?.label || "Smileys e pessoas"}
                    </h4>
                    <div className="emoji-grid">
                      {(emojiSearch.trim()
                        ? composerEmojis.filter((emoji) => emoji.includes(emojiSearch.trim()))
                        : emojiCategoryIndex < 0
                          ? emojiCategoryItems[0].emojis
                          : emojiCategoryItems[emojiCategoryIndex]?.emojis || composerEmojis
                      ).map((emoji, index) => (
                        <button type="button" key={`${emoji}-${index}`} onClick={() => insertEmoji(emoji)}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="emoji-picker-bottom-tabs" role="tablist" aria-label="Tipo de conteúdo">
                    <button type="button" className="active" role="tab" aria-selected="true">
                      <Smile />
                      <span>Emoji</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected="false"
                      onClick={() => {
                        setGiphyQuery("");
                        setGiphyError("");
                        setGiphyKind("gifs");
                      }}
                    >
                      <span>GIF</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected="false"
                      onClick={() => {
                        setGiphyQuery("");
                        setGiphyError("");
                        setGiphyKind("stickers");
                      }}
                    >
                      <Image />
                      <span>Figurinhas</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="giphy-picker-heading">
                    <button
                      type="button"
                      aria-label="Voltar para emojis"
                      onClick={() => setGiphyKind(null)}
                    >
                      <ArrowLeft />
                    </button>
                    <strong>{giphyKind === "gifs" ? "GIFs" : "Figurinhas"}</strong>
                    <button
                      type="button"
                      aria-label="Fechar seletor de mídia"
                      onClick={() => {
                        setGiphyKind(null);
                        setEmojiOpen(false);
                      }}
                    >
                      <X />
                    </button>
                  </div>
                  <label className="giphy-search">
                    <Search />
                    <input
                      value={giphyQuery}
                      onChange={(event) => setGiphyQuery(event.target.value)}
                      placeholder="Pesquisar no GIPHY"
                      aria-label="Pesquisar GIFs e figurinhas"
                    />
                  </label>
                  {giphyLoading && !giphyItems.length ? (
                    <div className="giphy-state">
                      <RefreshCw className="spin" /> Carregando…
                    </div>
                  ) : giphyError ? (
                    <div className="giphy-state giphy-state--error">{giphyError}</div>
                  ) : giphyItems.length ? (
                    <div className="giphy-grid">
                      {giphyItems.map((item) => (
                        <button
                          type="button"
                          className={`giphy-item ${giphyKind === "stickers" ? "giphy-item--sticker" : ""}`}
                          key={item.id}
                          title={item.title}
                          disabled={giphyLoading}
                          onClick={() => void sendGiphy(item)}
                        >
                          <img src={absoluteMediaUrl(item.previewUrl)} alt={item.title} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="giphy-state">Nenhuma mídia encontrada.</div>
                  )}
                  <div className="emoji-picker-bottom-tabs" role="tablist" aria-label="Tipo de conteúdo">
                    <button
                      type="button"
                      role="tab"
                      aria-selected="false"
                      onClick={() => {
                        setGiphyKind(null);
                        setEmojiSearch("");
                      }}
                    >
                      <Smile />
                      <span>Emoji</span>
                    </button>
                    <button
                      type="button"
                      className={giphyKind === "gifs" ? "active" : ""}
                      role="tab"
                      aria-selected={giphyKind === "gifs"}
                      onClick={() => setGiphyKind("gifs")}
                    >
                      <span>GIF</span>
                    </button>
                    <button
                      type="button"
                      className={giphyKind === "stickers" ? "active" : ""}
                      role="tab"
                      aria-selected={giphyKind === "stickers"}
                      onClick={() => setGiphyKind("stickers")}
                    >
                      <Image />
                      <span>Figurinhas</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {recordingDraft ? (
          <div className="composer-recording-preview">
            <audio controls src={recordingPreviewUrl} aria-label="Prévia do áudio gravado" />
            <button
              type="button"
              className="composer-recording-cancel"
              title="Descartar áudio"
              aria-label="Descartar áudio"
              onClick={clearRecordingDraft}
            >
              <X />
            </button>
            <button
              type="button"
              className="send"
              title="Enviar áudio"
              aria-label="Enviar áudio"
              onClick={() => void sendRecordingDraft()}
            >
              <Send />
            </button>
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Digite uma mensagem"
              value={draft}
              onPointerDown={() => {
                // A picker aberta nunca deve ficar sobre o teclado.  onFocus
                // não é suficiente: ao tocar novamente em um textarea já
                // focado o navegador não dispara um novo evento de foco.
                setEmojiOpen(false);
                setGiphyKind(null);
                setAttachmentOpen(false);
              }}
              onFocus={() => {
                // The keyboard and the picker are mutually exclusive, just
                // like WhatsApp: focusing the composer always returns to the
                // text-entry state instead of leaving a floating picker over
                // the keyboard.
                setEmojiOpen(false);
                setGiphyKind(null);
                setAttachmentOpen(false);
              }}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            {draft.trim() ? (
              <button type="button" className="send" title="Enviar" onClick={() => void submit()}>
                <Send />
              </button>
            ) : (
              <button
                type="button"
                className={recording ? "recording" : ""}
                title={recording ? "Solte para revisar o áudio" : "Segure para gravar áudio"}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  void startRecording(event);
                }}
                onPointerMove={(event) => {
                  if (!recordingPointerActiveRef.current) return;
                  const deltaY = event.clientY - recordingStartPointRef.current.y;
                  if (deltaY < -76) stopRecording(true);
                }}
                onPointerUp={() => stopRecording(false)}
                onPointerCancel={() => stopRecording(true)}
              >
                <Mic />
                {recording && (
                  <span className="recording-hint">
                    {recordingCancelling ? "Solte para cancelar" : "Solte para revisar"}
                  </span>
                )}
              </button>
            )}
          </>
        )}
        {recordingError && <span className="recording-error">{recordingError}</span>}
      </footer>
    </main>
  );
}

function ConversationDetailsModal({
  value,
  onClose,
  onStartConversation,
}: {
  value: { thread: ConversationThread; data?: JsonRecord };
  onClose: () => void;
  onStartConversation?: (thread: ConversationThread) => void;
}) {
  const group =
    value.data?.group && typeof value.data.group === "object"
      ? (value.data.group as JsonRecord)
      : null;
  const members = Array.isArray(value.data?.members)
    ? (value.data.members as JsonRecord[])
    : [];
  const description = String(group?.description || "").trim();
  const isGroup =
    value.thread.chatType === "internal_group" ||
    String(value.thread.chatType).includes("group");
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="conversation-details"
        role="dialog"
        aria-modal="true"
        aria-label="Dados da conversa"
      >
        <header>
          <div className="modal-heading-line">
            <h2>
              {isGroup ? "Dados do grupo" : "Dados do contato"}
            </h2>
            <InfoTip label="Dados da conversa">
              Consulte informações, participantes e o estado atual desta conversa.
            </InfoTip>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="details-profile">
          <Avatar
            name={value.thread.title}
            src={String(group?.avatarUrl || value.thread.avatarUrl || "")}
          />
          <h3>{String(group?.name || value.thread.title)}</h3>
          {value.thread.phone && <p>{value.thread.phone}</p>}
          {description && <p className="details-description">{description}</p>}
        </div>
        {isGroup && <div className="details-stats">
          <span>
            <b>
              {Number(
                group?.memberCount ||
                  value.thread.memberCount ||
                  members.length ||
                  0,
              )}
            </b>{" "}
            membros
          </span>
          <span>
            <b>{value.thread.pinned ? "Sim" : "Não"}</b> fixada
          </span>
          <span>
            <b>{value.thread.muted ? "Sim" : "Não"}</b> silenciada
          </span>
        </div>}
        {members.length > 0 && (
          <div className="details-members">
            <h4>Participantes</h4>
            {members.slice(0, 100).map((member, index) => (
              <div key={String(member.id || member.userId || index)}>
                <Avatar
                  small
                  name={String(member.name || member.userName || "Membro")}
                  src={String(member.avatarUrl || "")}
                />
                <span>
                  <b>{String(member.name || member.userName || "Membro")}</b>
                  <small>{String(member.role || "membro")}</small>
                </span>
              </div>
            ))}
          </div>
        )}
        {value.thread.chatType === "contact" && onStartConversation && (
          <div className="details-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => onStartConversation(value.thread)}
            >
              <MessageCircle /> Iniciar conversa
            </button>
            {value.thread.phone && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void copyText(value.thread.phone || "")}
              >
                <Copy /> Copiar número
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function QuickDashboardModal({
  type,
  instances,
  activeInstanceId,
  threads,
  onClose,
  onSelectInstance,
  onSelectThread,
  onCreated,
}: {
  type: "profiles" | "new-conversation" | "new-internal" | "join-internal";
  instances: BotInstance[];
  activeInstanceId?: number | null;
  threads: ConversationThread[];
  onClose: () => void;
  onSelectInstance: (id: number) => void;
  onSelectThread: (thread: ConversationThread) => void;
  onCreated: (result?: { inviteUrl?: string; group?: JsonRecord }) => void;
}) {
  const [query, setQuery] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdInvite, setCreatedInvite] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [profileCreatorOpen, setProfileCreatorOpen] = useState(false);
  const [renewingProfile, setRenewingProfile] =
    useState<BotInstance | null>(null);
  const title =
    type === "profiles"
      ? "Trocar perfil"
      : type === "new-conversation"
        ? "Nova conversa"
        : type === "new-internal"
          ? "Criar grupo BotAdmin"
          : "Entrar com convite";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (type === "new-internal") {
        const result = await api.createInternalGroup(
          query.trim(),
          description.trim(),
        );
        const inviteUrl = String(result.inviteUrl || "").trim();
        onCreated(
          inviteUrl
            ? { inviteUrl, group: result.group as JsonRecord | undefined }
            : undefined,
        );
        if (inviteUrl) {
          setCreatedInvite({
            url: normalizePublicLink(inviteUrl),
            name: query.trim(),
          });
          return;
        }
      }
      if (type === "join-internal") {
        const raw = query.trim();
        const token = raw.match(/\/g\/([^/?#]+)/)?.[1] || raw;
        await api.joinInternalGroup(token);
      }
      onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível concluir.",
      );
    } finally {
      setBusy(false);
    }
  };
  const contacts = threads.filter(
    (thread) =>
      thread.chatType !== "internal_group" &&
      !String(thread.chatType || "").includes("channel") &&
      `${thread.title} ${thread.phone || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")),
  );
  if (profileCreatorOpen) {
    return (
      <ProfileCreateModal
        onClose={() => setProfileCreatorOpen(false)}
        onCreated={() => {
          setProfileCreatorOpen(false);
          onCreated();
        }}
      />
    );
  }
  if (renewingProfile) {
    return (
      <ProfileRenewModal
        instance={renewingProfile}
        onClose={() => setRenewingProfile(null)}
        onDone={() => {
          setRenewingProfile(null);
          onCreated();
        }}
      />
    );
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="quick-modal" role="dialog" aria-modal="true">
        <header>
          <div className="modal-heading-line">
            <h2>{title}</h2>
            <InfoTip label={title}>
              Escolha um perfil, inicie uma conversa ou entre em um grupo usando o convite.
            </InfoTip>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        {type === "profiles" && (
          <>
            <div className="quick-profile-summary">
              <span>
                {instances.length} perfil{instances.length === 1 ? "" : "s"}
              </span>
              <small>
                Troque sem sair da tela ou renove diretamente por aqui.
              </small>
            </div>
            <div className="quick-list quick-profile-list">
              {instances.length ? (
                instances.map((instance) => {
                  const selected = activeInstanceId === instance.id;
                  const online = connectedInstance(instance.sessionStatus);
                  return (
                    <div
                      className={`quick-profile-row ${selected ? "selected" : ""}`}
                      key={instance.id}
                    >
                      <button onClick={() => onSelectInstance(instance.id)}>
                        <span className="quick-profile-avatar">
                          <Avatar
                            name={instance.name}
                            src={instance.avatarUrl}
                            small
                          />
                          <i className={online ? "online" : "offline"} />
                        </span>
                        <span>
                          <b>{instance.name}</b>
                          <small>
                            {instance.phone || "Número não informado"} ·{" "}
                            {online ? "conectado" : "desconectado"}
                          </small>
                          <small>
                            {instance.expiresAt
                              ? `Válido até ${dateText(instance.expiresAt)}`
                              : "Validade não informada"}
                          </small>
                        </span>
                        {selected && <CheckSquare className="profile-selected" />}
                      </button>
                      <button
                        className="quick-profile-renew"
                        title={`Renovar ${instance.name}`}
                        aria-label={`Renovar ${instance.name}`}
                        onClick={() => setRenewingProfile(instance)}
                      >
                        <BadgeDollarSign />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="module-state compact">
                  <ContactRound />
                  <b>Nenhum perfil criado</b>
                </div>
              )}
            </div>
            <footer className="quick-profile-footer">
              <button
                className="primary-button"
                onClick={() => setProfileCreatorOpen(true)}
              >
                <Plus /> Novo perfil
              </button>
            </footer>
          </>
        )}
        {type === "new-conversation" && (
          <>
            <label className="quick-search">
              <Search />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar nome ou número"
              />
            </label>
            <div className="quick-list">
              {contacts.slice(0, 100).map((thread) => (
                <button
                  key={`${thread.instanceId}:${thread.chatJid}`}
                  onClick={() => onSelectThread(thread)}
                >
                  <Avatar name={thread.title} src={thread.avatarUrl} small />
                  <span>
                    <b>{thread.title}</b>
                    <small>
                      {thread.phone || threadTypeLabel(thread) || "Conversa"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {(type === "new-internal" || type === "join-internal") && (
          createdInvite && type === "new-internal" ? (
            <div className="quick-created-group">
              <div className="quick-created-icon"><CheckSquare /></div>
              <h3>Grupo criado com sucesso</h3>
              <p>
                Compartilhe este convite para que as pessoas encontrem <b>{createdInvite.name}</b> e entrem diretamente na conversa.
              </p>
              <div className="copy-row">
                <code>{createdInvite.url}</code>
                <button type="button" onClick={() => void copyText(createdInvite.url).then((copied) => setInviteCopied(copied))}>
                  <Copy /> {inviteCopied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={async () => {
                  try {
                    if (navigator.share) {
                      await navigator.share({
                        title: createdInvite.name,
                        text: `Convite para o grupo ${createdInvite.name} no BotAdmin`,
                        url: createdInvite.url,
                      });
                    } else {
                      const copied = await copyText(createdInvite.url);
                      if (copied) setInviteCopied(true);
                    }
                  } catch (cause) {
                    if ((cause as DOMException)?.name !== "AbortError")
                      setError("Não foi possível compartilhar o convite.");
                  }
                }}
              >
                <Send /> Compartilhar convite
              </button>
              <button type="button" className="primary-button" onClick={onClose}>
                Concluir
              </button>
            </div>
          ) : <form className="quick-form" onSubmit={submit}>
            <label>
              {type === "new-internal"
                ? "Nome do grupo"
                : "Link ou código do convite"}
              <input
                autoFocus
                required
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  type === "new-internal"
                    ? "Nome do grupo"
                    : "https://botadmin.shop/g/..."
                }
              />
            </label>
            {type === "new-internal" && (
              <label>
                Descrição
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Descrição opcional"
                />
              </label>
            )}
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button" disabled={busy || !query.trim()}>
              {busy
                ? "Aguarde…"
                : type === "new-internal"
                  ? "Criar grupo"
                  : "Entrar no grupo"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

const arrayFrom = (data: JsonRecord | null) => {
  if (!data) return [];
  for (const value of Object.values(data))
    if (Array.isArray(value)) return value as JsonRecord[];
  return [];
};
const displayValue = (value: unknown, fallback = "Disponível no painel") => {
  if (typeof value === "string" && value.trim() && value !== "[object Object]")
    return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.length ? `${value.length} itens` : fallback;
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    return displayValue(
      record.name ??
        record.title ??
        record.label ??
        record.status ??
        record.state,
      fallback,
    );
  }
  return fallback;
};

const settingsToggleLabels: Array<[string, string, string]> = [
  [
    "autoresposta",
    "Respostas automáticas",
    "Responda comandos e mensagens automaticamente.",
  ],
  [
    "nativeButtons",
    "Botões interativos",
    "Exiba botões de resposta e ações no WhatsApp.",
  ],
  [
    "recoverDeletedMessages",
    "Recuperar mensagens apagadas",
    "Mantenha uma cópia das mensagens removidas.",
  ],
  [
    "keepDeletedChatsInHistory",
    "Manter conversas removidas",
    "Preserve conversas apagadas no histórico.",
  ],
  [
    "persistentMediaStorage",
    "Mídias persistentes",
    "Armazene mídias no R2 para acesso contínuo.",
  ],
  [
    "notifyOnlinePresence",
    "Notificar presença online",
    "Receba eventos de presença dos contatos monitorados.",
  ],
];

const firstArray = (data: JsonRecord | null, keys: string[]) => {
  for (const key of keys)
    if (Array.isArray(data?.[key])) return data?.[key] as JsonRecord[];
  return [];
};
const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
};
const storageSize = (value: unknown) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const amount = bytes / 1024 ** unit;
  return `${amount.toLocaleString("pt-BR", {
    maximumFractionDigits: amount >= 10 || unit === 0 ? 0 : 1,
  })} ${units[unit]}`;
};
const dateText = (value: unknown) => {
  const d = new Date(String(value || ""));
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

function RichModuleWorkspace({
  section,
  selectedInstance,
}: {
  section: Section;
  selectedInstance: number | null;
}) {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const meta = sectionMeta[section];
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result =
        section === "status"
          ? await api.status()
          : section === "affiliates"
            ? await api.affiliate()
            : section === "payments"
              ? await api.charges()
              : section === "media"
                ? await api.mediaPlans()
                : section === "store" && selectedInstance
                  ? await api.store(selectedInstance)
                  : section === "calls" && selectedInstance
                    ? await api.calls(selectedInstance)
                    : {};
      setData(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar esta área.",
      );
    } finally {
      setLoading(false);
    }
  }, [section, selectedInstance]);
  useEffect(() => {
    void load();
  }, [load]);
  const Icon = meta.icon;
  if (loading && !data)
    return (
      <main className="module">
        <ModuleHeader meta={meta} loading onReload={() => void load()} />
        <div className="module-state">
          <RefreshCw className="spin" />
          <b>Carregando {meta.title.toLocaleLowerCase("pt-BR")}…</b>
        </div>
      </main>
    );
  if (error && !data)
    return (
      <main className="module">
        <ModuleHeader meta={meta} onReload={() => void load()} />
        <div className="module-error">
          <b>Não foi possível carregar esta área.</b>
          <span>{error}</span>
          <button onClick={() => void load()}>Tentar novamente</button>
        </div>
      </main>
    );
  const empty = (text: string) => (
    <div className="module-state">
      <span className="large-icon">
        <Icon />
      </span>
      <b>{text}</b>
    </div>
  );
  if (section === "affiliates") {
    const affiliate = (data?.affiliate || {}) as JsonRecord;
    const wallet = (data?.wallet || {}) as JsonRecord;
    const readiness = (data?.readiness || {}) as JsonRecord;
    const history = firstArray(data, ["history", "sales", "commissions"]);
    return (
      <main className="module">
        <ModuleHeader
          meta={meta}
          loading={loading}
          onReload={() => void load()}
        />
        <div className="rich-grid">
          <article className="metric-card">
            <small>Comissão</small>
            <strong>{displayValue(affiliate.commissionPercent, "0")} %</strong>
            <span>sobre vendas aprovadas</span>
          </article>
          <article className="metric-card">
            <small>Carteira</small>
            <strong>{money(wallet.balance ?? wallet.siteBalance)}</strong>
            <span>
              {displayValue(wallet.approvedSalesCount, "0")} vendas aprovadas
            </span>
          </article>
          <article className="metric-card">
            <small>Status de recebimento</small>
            <strong>{readiness.ready ? "Pronto" : "Configurar"}</strong>
            <span>
              {displayValue(readiness.message, "Pagamento disponível")}
            </span>
          </article>
        </div>
        <section className="settings-card rich-card">
          <h2>Seu link de indicação</h2>
          <div className="copy-row">
            <code>
              {displayValue(affiliate.referralLink, "Link ainda não gerado")}
            </code>
            <button
              onClick={() => {
                if (affiliate.referralLink)
                  void navigator.clipboard.writeText(
                    String(affiliate.referralLink),
                  );
              }}
            >
              <Copy /> Copiar
            </button>
          </div>
          <p className="settings-muted">
            Código: {displayValue(affiliate.referralCode, "—")} · Modo:{" "}
            {displayValue(data?.paymentMode, "carteira")}
          </p>
        </section>
        <section className="settings-card rich-card">
          <h2>Histórico de comissões</h2>
          {history.length ? (
            <div className="table-list">
              {history.slice(0, 80).map((item, i) => (
                <div key={String(item.id || i)}>
                  <span>
                    {displayValue(
                      item.description ?? item.customerName ?? item.status,
                      "Venda",
                    )}
                  </span>
                  <b>{money(item.amount ?? item.commission ?? item.value)}</b>
                  <small>{dateText(item.createdAt ?? item.updatedAt)}</small>
                </div>
              ))}
            </div>
          ) : (
            empty("Nenhuma comissão registrada ainda")
          )}
        </section>
      </main>
    );
  }
  if (section === "payments") {
    const charges = firstArray(data, ["charges", "payments", "items"]);
    return (
      <main className="module">
        <ModuleHeader
          meta={meta}
          loading={loading}
          onReload={() => void load()}
        />
        {charges.length ? (
          <div className="table-list charge-list">
            {charges.slice(0, 120).map((item, i) => (
              <article key={String(item.id || i)}>
                <div>
                  <b>{money(item.amount)}</b>
                  <span>
                    {displayValue(
                      item.description ?? item.planName ?? item.provider,
                      "Cobrança",
                    )}
                  </span>
                </div>
                <strong
                  className={`state-pill ${String(item.status || "").toLowerCase()}`}
                >
                  {displayValue(item.status, "pendente")}
                </strong>
                <small>{dateText(item.createdAt ?? item.updatedAt)}</small>
              </article>
            ))}
          </div>
        ) : (
          empty("Nenhuma cobrança encontrada")
        )}
      </main>
    );
  }
  if (section === "status") {
    const posts = firstArray(data, ["posts", "campaigns", "scheduled"]);
    const received = firstArray(data, [
      "receivedStatuses",
      "received",
      "statuses",
    ]);
    const all: JsonRecord[] = [
      ...posts.map((item) => ({ ...item, _kind: "Publicado" }) as JsonRecord),
      ...received.map((item) => ({ ...item, _kind: "Recebido" }) as JsonRecord),
    ];
    return (
      <main className="module">
        <ModuleHeader
          meta={meta}
          loading={loading}
          onReload={() => void load()}
        />
        {all.length ? (
          <div className="data-grid">
            {all.slice(0, 120).map((item, i) => (
              <article key={String(item.id || i)}>
                <span className="data-icon">
                  <CircleDashed />
                </span>
                <div>
                  <h3>
                    {displayValue(
                      item.title ?? item.caption ?? item.text,
                      `Status ${i + 1}`,
                    )}
                  </h3>
                  <p>
                    {displayValue(item._kind)} ·{" "}
                    {dateText(
                      item.createdAt ?? item.publishedAt ?? item.scheduledAt,
                    )}
                  </p>
                </div>
                <MoreVertical />
              </article>
            ))}
          </div>
        ) : (
          empty("Nenhum status publicado ou recebido")
        )}
      </main>
    );
  }
  if (section === "media") {
    const plans = firstArray(data, ["plans"]);
    const storage = (data?.storage || {}) as JsonRecord;
    return (
      <main className="module">
        <ModuleHeader
          meta={meta}
          loading={loading}
          onReload={() => void load()}
        />
        <section className="settings-card rich-card">
          <h2>Armazenamento atual</h2>
          <div className="rich-summary">
            <b>{displayValue(storage.objectCount, "0")} arquivos</b>
            <span>
              {storageSize(storage.usedBytes)} usados ·{" "}
              {storage.hasActivePlan ? "Plano ativo" : "Sem plano ativo"}
            </span>
          </div>
        </section>
        <h2 className="section-label">Planos disponíveis</h2>
        {plans.length ? (
          <div className="rich-grid">
            {plans.map((item, i) => (
              <article className="plan-card" key={String(item.id || i)}>
                <h3>{displayValue(item.name, `Plano ${i + 1}`)}</h3>
                <p>{displayValue(item.description)}</p>
                <strong>
                  {money(item.price)}{" "}
                  <small>/ {displayValue(item.durationDays, "30")} dias</small>
                </strong>
              </article>
            ))}
          </div>
        ) : (
          empty("Nenhum plano disponível")
        )}
      </main>
    );
  }
  if (section === "store") {
    const store = (data?.store || data || {}) as JsonRecord;
    const categories = firstArray(store, ["categories", "categoryList"]);
    const products = firstArray(store, ["products", "items"]);
    return (
      <main className="module">
        <ModuleHeader
          meta={meta}
          loading={loading}
          onReload={() => void load()}
        />
        <section className="settings-card rich-card">
          <div className="settings-card-heading">
            <div>
              <h2>{displayValue(store.name, "Loja")}</h2>
              <p className="settings-muted">
                {displayValue(store.description, "Catálogo de produtos")}
              </p>
            </div>
            <span
              className={`state-pill ${store.enabled ? "active" : "inactive"}`}
            >
              {store.enabled ? "Ativa" : "Desativada"}
            </span>
          </div>
        </section>
        <div className="rich-grid">
          <article className="metric-card">
            <small>Categorias</small>
            <strong>{categories.length}</strong>
          </article>
          <article className="metric-card">
            <small>Produtos</small>
            <strong>{products.length}</strong>
          </article>
        </div>
        {products.length ? (
          <div className="data-grid">
            {products.slice(0, 60).map((item, i) => (
              <article key={String(item.id || i)}>
                <span className="data-icon">
                  <ShoppingBag />
                </span>
                <div>
                  <h3>
                    {displayValue(item.name ?? item.title, `Produto ${i + 1}`)}
                  </h3>
                  <p>
                    {money(item.price)} ·{" "}
                    {displayValue(item.stock, "Estoque não informado")}
                  </p>
                </div>
                <MoreVertical />
              </article>
            ))}
          </div>
        ) : (
          empty("Nenhum produto cadastrado")
        )}
      </main>
    );
  }
  const calls = firstArray(data, ["activeCalls", "Calls", "calls"]);
  return (
    <main className="module">
      <ModuleHeader
        meta={meta}
        loading={loading}
        onReload={() => void load()}
      />
      {calls.length ? (
        <div className="data-grid">
          {calls.map((item, i) => (
            <article key={String(item.id || i)}>
              <span className="data-icon">
                <Phone />
              </span>
              <div>
                <h3>
                  {displayValue(
                    item.name ?? item.phone ?? item.remoteJid,
                    `Chamada ${i + 1}`,
                  )}
                </h3>
                <p>
                  {displayValue(item.status, "Chamada registrada")} ·{" "}
                  {dateText(item.createdAt)}
                </p>
              </div>
              <MoreVertical />
            </article>
          ))}
        </div>
      ) : (
        empty("Nenhuma chamada registrada")
      )}
    </main>
  );
}

function ModuleHeader({
  meta,
  loading = false,
  onReload,
}: {
  meta: { title: string; subtitle: string; icon: typeof MessageCircle };
  loading?: boolean;
  onReload: () => void;
}) {
  const Icon = meta.icon;
  return (
    <header className="module-header">
      <div className="module-title">
        <span>
          <Icon />
        </span>
        <div>
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </div>
      </div>
      <button onClick={onReload} aria-label="Atualizar">
        <RefreshCw className={loading ? "spin" : ""} />
      </button>
    </header>
  );
}

function ApiWorkspace() {
  const [tab, setTab] = useState<"key" | "webhook">("key");
  const [data, setData] = useState<JsonRecord | null>(null);
  const [webhook, setWebhook] = useState<JsonRecord | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState({
    verifyToken: "",
    appId: "",
    businessAccountId: "",
    phoneNumberId: "",
    accessToken: "",
  });
  const load = useCallback(async () => {
    setError("");
    try {
      const [keyResult, webhookResult] = await Promise.all([
        api.apiRest(),
        api.webhookSettings(),
      ]);
      setData(keyResult);
      setWebhook(webhookResult.webhook || null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as integrações.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível concluir.",
      );
    } finally {
      setBusy(false);
    }
  };
  const key = String(data?.apiKey || "");
  const openWebhook = () => {
    setForm({
      verifyToken: String(webhook?.verifyToken || ""),
      appId: String(webhook?.appId || ""),
      businessAccountId: String(webhook?.businessAccountId || ""),
      phoneNumberId: String(webhook?.phoneNumberId || ""),
      accessToken: "",
    });
    setEditorOpen(true);
  };
  return (
    <main className="module api-workspace">
      <header className="module-header">
        <div className="module-title">
          <span>
            <Webhook />
          </span>
          <div>
            <h1>API REST e webhooks</h1>
            <p>Tokens, limites e integração Meta Cloud API.</p>
          </div>
        </div>
        <button onClick={() => void load()} aria-label="Atualizar">
          <RefreshCw />
        </button>
      </header>
      <div className="module-tabs">
        <button
          className={tab === "key" ? "active" : ""}
          onClick={() => setTab("key")}
        >
          <KeyRound /> API REST
        </button>
        <button
          className={tab === "webhook" ? "active" : ""}
          onClick={() => setTab("webhook")}
        >
          <Webhook /> Webhooks
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-success">{notice}</div>}
      {tab === "key" ? (
        <section className="settings-card api-card">
          <h2>Token da API</h2>
          <p className="settings-muted">
            Use esta chave somente em integrações confiáveis.
          </p>
          <div className="secret-field">
            <code>
              {showKey
                ? key
                : key
                  ? `${key.slice(0, 6)}${"•".repeat(18)}${key.slice(-4)}`
                  : "Carregando…"}
            </code>
            <button
              onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? "Ocultar chave" : "Mostrar chave"}
            >
              {showKey ? <EyeOff /> : <Eye />}
            </button>
          </div>
          <div className="api-actions">
            <button
              disabled={!key}
              onClick={() => {
                void navigator.clipboard.writeText(key);
                setNotice("Chave copiada.");
              }}
            >
              <Copy /> Copiar
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Gerar uma nova chave? A chave atual deixará de funcionar.",
                  )
                )
                  void run(
                    () => api.updateApiRest({ action: "rotate" }),
                    "Nova chave gerada.",
                  );
              }}
            >
              <RefreshCw /> Gerar nova
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const value = window.prompt(
                  "Informe a chave personalizada:",
                  "",
                );
                if (value?.trim())
                  void run(
                    () =>
                      api.updateApiRest({
                        action: "set_custom",
                        apiKey: value.trim(),
                      }),
                    "Chave personalizada aplicada.",
                  );
              }}
            >
              <KeyRound /> Personalizar
            </button>
          </div>
          <div className="quota-grid">
            <span>
              <b>{String(data?.requestsUsed ?? 0)}</b> usados hoje
            </span>
            <span>
              <b>{String(data?.remaining ?? 0)}</b> restantes
            </span>
            <span>
              <b>{String(data?.dailyQuota ?? 0)}</b> limite diário
            </span>
          </div>
        </section>
      ) : (
        <section className="settings-card api-card">
          <h2>Meta Cloud API</h2>
          <p className="settings-muted">
            Configure credenciais, verify token e teste a comunicação.
          </p>
          <div className="webhook-summary">
            <span>
              <b>
                {webhook
                  ? `Webhook ${String(webhook.id || "configurado")}`
                  : "Webhook ainda sem configuração"}
              </b>
              <small>
                Verify token: {String(webhook?.verifyToken || "não definido")}
              </small>
              <small>
                Token Meta:{" "}
                {String(
                  webhook?.accessTokenPreview ||
                    (webhook?.accessTokenPresent
                      ? "configurado"
                      : "não definido"),
                )}
              </small>
            </span>
            <i className={webhook ? "online" : ""} />
          </div>
          <div className="api-actions">
            <button onClick={openWebhook}>
              <Settings /> Configurar
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api.testWebhookSettings({
                      verifyToken: webhook?.verifyToken,
                      appId: webhook?.appId,
                      businessAccountId: webhook?.businessAccountId,
                      phoneNumberId: webhook?.phoneNumberId,
                    }),
                  "Comunicação testada.",
                )
              }
            >
              <RefreshCw /> Testar comunicação
            </button>
          </div>
        </section>
      )}
      {editorOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditorOpen(false);
          }}
        >
          <form
            className="quick-modal"
            onSubmit={(event) => {
              event.preventDefault();
              const payload: JsonRecord = {
                verifyToken: form.verifyToken,
                appId: form.appId,
                businessAccountId: form.businessAccountId,
                phoneNumberId: form.phoneNumberId,
              };
              if (form.accessToken.trim())
                payload.accessToken = form.accessToken.trim();
              void run(
                () => api.saveWebhookSettings(payload),
                "Webhook salvo.",
              ).then(() => setEditorOpen(false));
            }}
          >
            <header>
              <h2>Configurar webhook</h2>
              <button type="button" onClick={() => setEditorOpen(false)}>
                <X />
              </button>
            </header>
            <div className="quick-form">
              <label>
                Verify token
                <input
                  required
                  value={form.verifyToken}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      verifyToken: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                App ID
                <input
                  value={form.appId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      appId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Business Account ID
                <input
                  value={form.businessAccountId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      businessAccountId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Phone Number ID
                <input
                  value={form.phoneNumberId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phoneNumberId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Access token
                <input
                  type="password"
                  value={form.accessToken}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      accessToken: event.target.value,
                    }))
                  }
                  placeholder={
                    webhook?.accessTokenPresent
                      ? "Deixe vazio para manter o atual"
                      : "Token da Meta"
                  }
                />
              </label>
              <button className="primary-button" disabled={busy}>
                {busy ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function SettingsWorkspace({
  user,
  onUserChanged,
}: {
  user: SessionUser;
  onUserChanged?: (user: SessionUser) => void;
}) {
  const splitPhone = (value: unknown) => {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return { dialCode: "55", number: "" };
    return digits.length > 11
      ? { dialCode: digits.slice(0, -11), number: digits.slice(-11) }
      : { dialCode: "55", number: digits };
  };
  const initialPhone = splitPhone(user.whatsappNumber);
  const [name, setName] = useState(user.name || "");
  const [email, setEmail] = useState(user.email || "");
  const [dialCode, setDialCode] = useState(initialPhone.dialCode);
  const [phone, setPhone] = useState(initialPhone.number);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // The production API already exposes the authenticated profile through
      // the session endpoint. Using it here keeps the React panel compatible
      // while older deployments still reject GET /api/user/profile with 405.
      const result = await api.session();
      if (!result.user) return;
      const next = result.user;
      const nextPhone = splitPhone(next.whatsappNumber);
      setName(next.name || "");
      setEmail(next.email || "");
      setDialCode(nextPhone.dialCode);
      setPhone(nextPhone.number);
      onUserChanged?.(next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os dados da conta.",
      );
    } finally {
      setLoading(false);
    }
  }, [onUserChanged]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !name.trim() || !email.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload: JsonRecord = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        whatsappDialCode: phone.trim() ? dialCode.trim() : null,
        whatsappNumber: phone.trim() ? phone.replace(/\D/g, "") : null,
      };
      if (password.trim()) payload.password = password.trim();
      const result = await api.updateUserProfile(payload);
      if (result.user) onUserChanged?.(result.user);
      setPassword("");
      setNotice("Dados da conta atualizados.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar os dados da conta.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="module settings-workspace account-settings-workspace">
      <header className="module-header">
        <div className="module-title">
          <span><Settings /></span>
          <div><h1>Configurações</h1></div>
        </div>
        <button onClick={() => void load()} aria-label="Atualizar conta">
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </header>
      {(error || notice) && (
        <div className={error ? "module-error commerce-message" : "inline-notice success commerce-message"}>
          <b>{error ? "Não foi possível concluir." : "Concluído"}</b>
          <span>{error || notice}</span>
          <button onClick={() => { setError(""); setNotice(""); }}>Fechar</button>
        </div>
      )}
      <section className="settings-card account-settings-hero">
        <Avatar name={name || user.name} src={user.avatarUrl} />
        <div><h2>{name || user.name}</h2><p>{email || "E-mail não informado"}</p><small>{user.role || "Usuário"}</small></div>
      </section>
      <form className="settings-card account-settings-form" onSubmit={(event) => void save(event)}>
        <div className="settings-card-heading"><div><h2>Dados do perfil</h2><p className="settings-muted">Atualize os dados usados para acessar e identificar sua conta.</p></div></div>
        <div className="commerce-form-grid">
          <label>Nome completo<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <label>E-mail<input type="email" value={email} maxLength={190} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          <label className="account-phone-field"><span>WhatsApp</span><div><input className="dial-code" value={dialCode} maxLength={5} onChange={(event) => setDialCode(event.target.value.replace(/[^0-9+]/g, ""))} aria-label="DDI" /><input value={phone} maxLength={15} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))} placeholder="DDD + número" autoComplete="tel" /></div></label>
        </div>
        <div className="account-security-section"><div><h3>Senha de acesso</h3><p className="settings-muted">Deixe em branco para manter a senha atual.</p></div><label>Nova senha<input type="password" value={password} minLength={6} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="Mínimo de 6 caracteres" /></label></div>
        <footer><span /> <button className="primary-button" type="submit" disabled={saving || loading || !name.trim() || !email.trim()}>{saving ? "Salvando…" : "Salvar alterações"}</button></footer>
      </form>
    </main>
  );
}

const moduleItemTitle = (section: Section, item: JsonRecord, index = 0) =>
  displayValue(
    item.name ?? item.title ?? item.label,
    `${sectionMeta[section].title} ${index + 1}`,
  );
const moduleItemSubtitle = (section: Section, item: JsonRecord) => {
  if (section === "broadcasts")
    return `${Number(item.contactCount || 0)} contatos · ${displayValue(item.lastRunStatus, "sem envio recente")}`;
  if (section === "flows")
    return `${item.enabled ? "Ativo" : "Pausado"} · ${displayValue(item.triggerType, "gatilho")} ${item.command ? `· !${String(item.command).replace(/^!/, "")}` : ""}`;
  if (section === "raffles")
    return `${displayValue(item.status, "rascunho")} · ${Number(item.soldCount || 0)}/${Number(item.numbersTotal || 0)} vendidos`;
  if (section === "groups")
    return `${Number(item.participantCount || item.participantsCount || 0)} participantes · ${displayValue(item.status, "ativo")}`;
  if (section === "campaigns")
    return `${item.enabled === false ? "Pausada" : "Ativa"} · ${displayValue(item.status ?? item.scheduleType, "campanha")}`;
  return displayValue(
    item.description ?? item.status ?? item.phone ?? item.updatedAt,
  );
};

type GroupActivationDefinition = {
  key: string;
  label: string;
  description: string;
  icon: typeof Bot;
  kind?: "command" | "schedule" | "horapg";
};

const groupActivationCategories: Array<{
  id: string;
  title: string;
  items: GroupActivationDefinition[];
}> = [
  {
    id: "attention",
    title: "Atendimento e IA",
    items: [
      { key: "autoresposta", label: "Auto resposta", description: "Responde gatilhos cadastrados.", icon: MessageCircle },
      { key: "botinterage", label: "BotInterage", description: "A IA conversa dentro do grupo.", icon: Bot },
      { key: "vozbotinterage", label: "IA por voz", description: "Permite respostas em áudio.", icon: Mic },
      { key: "lerimagem", label: "Ler imagem", description: "A IA interpreta imagens recebidas.", icon: Eye },
    ],
  },
  {
    id: "messages",
    title: "Mensagens automáticas",
    items: [
      { key: "bemvindo", label: "Boas-vindas", description: "Recebe automaticamente novos membros.", icon: UserPlus },
      { key: "despedida", label: "Saída", description: "Avisa quando um membro deixa o grupo.", icon: LogOut },
      { key: "horapg", label: "HoraPG", description: "Dispara a mídia nos horários configurados.", icon: RadioTower, kind: "horapg" },
    ],
  },
  {
    id: "control",
    title: "Controle do grupo",
    items: [
      { key: "soadm", label: "Só admin", description: "Restringe comandos críticos aos admins.", icon: ShieldCheck },
      { key: "schedule", label: "Abrir/fechar", description: "Executa os horários automáticos do grupo.", icon: Bell, kind: "schedule" },
      { key: "linkmembro", label: "Link membro", description: "Permite o uso de link por membros.", icon: Paperclip },
    ],
  },
  {
    id: "protection",
    title: "Proteções e punições",
    items: [
      { key: "antilink", label: "Anti-link", description: "Bloqueia links comuns.", icon: ShieldCheck },
      { key: "antilinkgp", label: "Anti-link GP", description: "Bloqueia convites de outros grupos.", icon: ShieldCheck },
      { key: "antipalavras", label: "Anti-palavras", description: "Remove os termos proibidos.", icon: X },
      { key: "banextremo", label: "Ban extremo", description: "Remove usuários por infrações graves.", icon: ShieldCheck },
      { key: "bangringos", label: "Ban gringos", description: "Controla números de DDIs não permitidos.", icon: Phone },
      { key: "antinsfwimagem", label: "Anti-NSFW", description: "Modera imagens sensíveis.", icon: EyeOff },
      { key: "proibirnsfw", label: "Proibir NSFW", description: "Bloqueia mídias sensíveis.", icon: LockKeyhole },
      { key: "moderacaocomia", label: "Moderação IA", description: "Usa IA para apoiar a moderação.", icon: Bot },
    ],
  },
  {
    id: "media",
    title: "Mídia, downloads e bloqueios",
    items: [
      { key: "autosticker", label: "Auto sticker", description: "Cria figurinhas automaticamente.", icon: Smile },
      { key: "autodownloader", label: "Auto download", description: "Baixa links suportados.", icon: Download },
      { key: "antisticker", label: "Anti-sticker", description: "Bloqueia figurinhas.", icon: Smile },
      { key: "antimage", label: "Anti-imagem", description: "Bloqueia imagens.", icon: Image },
      { key: "antvideo", label: "Anti-vídeo", description: "Bloqueia vídeos.", icon: AppWindow },
      { key: "antaudio", label: "Anti-áudio", description: "Bloqueia áudios.", icon: Mic },
      { key: "antdoc", label: "Anti-documento", description: "Bloqueia documentos.", icon: Paperclip },
      { key: "antvcard", label: "Anti-contato", description: "Bloqueia cartões de contato.", icon: ContactRound },
    ],
  },
  {
    id: "utilities",
    title: "Utilidades",
    items: [
      { key: "brincadeiras", label: "Brincadeiras", description: "Libera os comandos de diversão.", icon: Trophy },
    ],
  },
];

const recordValue = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const activationEnabled = (
  settings: JsonRecord | null,
  item: GroupActivationDefinition,
) => {
  if (!settings) return false;
  if (item.kind === "horapg")
    return Boolean(recordValue(settings.horapgConfig).enabled);
  if (item.kind === "schedule") {
    const schedule = recordValue(settings.scheduleConfig);
    return Boolean(schedule.closeEnabled || schedule.openEnabled);
  }
  return Boolean(recordValue(settings.commandToggles)[item.key]);
};

const activationPayload = (
  settings: JsonRecord,
  item: GroupActivationDefinition,
  value: boolean,
): JsonRecord => {
  if (item.kind === "horapg") {
    const current = recordValue(settings.horapgConfig);
    return {
      horapgConfig: {
        ...current,
        enabled: value,
        times:
          Array.isArray(current.times) && current.times.length
            ? current.times
            : ["08:00"],
        timezone: current.timezone || "America/Sao_Paulo",
      },
    };
  }
  if (item.kind === "schedule") {
    const current = recordValue(settings.scheduleConfig);
    return {
      scheduleConfig: {
        ...current,
        closeEnabled: value,
        openEnabled: value,
        closeTimes:
          Array.isArray(current.closeTimes) && current.closeTimes.length
            ? current.closeTimes
            : ["00:00"],
        openTimes:
          Array.isArray(current.openTimes) && current.openTimes.length
            ? current.openTimes
            : ["07:00"],
        timezone: current.timezone || "America/Sao_Paulo",
      },
    };
  }
  const payload: JsonRecord = {
    commandToggles: { [item.key]: value },
  };
  if (item.key === "bemvindo") payload.welcomeEnabled = value;
  if (item.key === "despedida") payload.farewellEnabled = value;
  if (item.key === "antilink") payload.antilink = value;
  if (item.key === "antilinkgp") payload.antilinkGroupInvite = value;
  if (item.key === "banextremo") payload.banExtremo = value;
  if (["soadm", "antipalavras", "bangringos", "antinsfwimagem"].includes(item.key))
    payload.featureFlags = { [item.key]: value };
  return payload;
};

const optimisticActivationSettings = (
  settings: JsonRecord,
  item: GroupActivationDefinition,
  value: boolean,
) => {
  const patch = activationPayload(settings, item, value);
  return {
    ...settings,
    ...patch,
    commandToggles: {
      ...recordValue(settings.commandToggles),
      ...recordValue(patch.commandToggles),
    },
    featureFlags: {
      ...recordValue(settings.featureFlags),
      ...recordValue(patch.featureFlags),
    },
  };
};

const moderationActivationKeys = new Set([
  "antilink",
  "antilinkgp",
  "banextremo",
  "antipalavras",
  "bangringos",
  "antinsfwimagem",
  "proibirnsfw",
  "antisticker",
  "antimage",
  "antvideo",
  "antaudio",
  "antdoc",
  "antvcard",
]);

const activationCommands: Record<string, string[]> = {
  autoresposta: ["!autoresposta", "!addautorepo", "!listaautorepo"],
  botinterage: ["!botinterage", "!promptbot"],
  vozbotinterage: ["!vozbotinterage", "!tts"],
  lerimagem: ["!lerimagem"],
  bemvindo: ["!bemvindo", "!fundobemvindo", "!legendabemvindo"],
  despedida: ["!despedida", "!saida"],
  soadm: ["!soadm"],
  schedule: ["!abrirgp 07:00", "!fechargp 00:00"],
  antilink: ["!antilink"],
  antilinkgp: ["!antilinkgp"],
  banextremo: ["!banextremo"],
  antipalavras: ["!antipalavras"],
  bangringos: ["!bangringos"],
  antinsfwimagem: ["!antinsfwimagem"],
  proibirnsfw: ["!proibirnsfw"],
  moderacaocomia: ["!moderacaocomia"],
  autosticker: ["!autosticker"],
  autodownloader: ["!autodownloader", "!play <termo>"],
  antisticker: ["!antisticker"],
  antimage: ["!antimage"],
  antvideo: ["!antvideo"],
  antaudio: ["!antaudio"],
  antdoc: ["!antidoc"],
  antvcard: ["!antivcard"],
  brincadeiras: ["!brincadeiras"],
};

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
const splitConfigLines = (value: string) =>
  value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

function GroupActivationConfigModal({
  definition,
  settings,
  groupId,
  groupName,
  onClose,
  onSaved,
}: {
  definition: GroupActivationDefinition;
  settings: JsonRecord;
  groupId: number;
  groupName: string;
  onClose: () => void;
  onSaved: (settings: JsonRecord) => void;
}) {
  const key = definition.key;
  const messageConfigKey =
    key === "bemvindo"
      ? "welcomeConfig"
      : key === "despedida"
        ? "farewellConfig"
        : null;
  const messageConfig = recordValue(
    messageConfigKey ? settings[messageConfigKey] : null,
  );
  const scheduleConfig = recordValue(settings.scheduleConfig);
  const horapgConfig = recordValue(settings.horapgConfig);
  const moderationAction = recordValue(
    recordValue(settings.moderationActions)[key],
  );
  const replyConfig = recordValue(messageConfig.replyButtons);
  const initialButtons = Array.isArray(replyConfig.buttons)
    ? (replyConfig.buttons as JsonRecord[])
    : [];
  const [enabled, setEnabled] = useState(
    activationEnabled(settings, definition),
  );
  const [caption, setCaption] = useState(String(messageConfig.caption || ""));
  const [mediaUrl, setMediaUrl] = useState(
    String(messageConfig.mediaUrl || messageConfig.mediaPath || ""),
  );
  const [useProfilePhoto, setUseProfilePhoto] = useState(
    Boolean(messageConfig.useParticipantProfilePhoto),
  );
  const [asSticker, setAsSticker] = useState(Boolean(messageConfig.asSticker));
  const [buttonsEnabled, setButtonsEnabled] = useState(
    Boolean(replyConfig.enabled && initialButtons.length),
  );
  const [buttonLabels, setButtonLabels] = useState(
    initialButtons
      .map((button) => String(button.label || button.title || "").trim())
      .filter(Boolean)
      .join("\n"),
  );
  const [buttonFooter, setButtonFooter] = useState(
    String(replyConfig.footer || ""),
  );
  const [closeEnabled, setCloseEnabled] = useState(
    Boolean(scheduleConfig.closeEnabled),
  );
  const [openEnabled, setOpenEnabled] = useState(
    Boolean(scheduleConfig.openEnabled),
  );
  const [closeTimes, setCloseTimes] = useState(
    stringList(scheduleConfig.closeTimes).join(", ") || "00:00",
  );
  const [openTimes, setOpenTimes] = useState(
    stringList(scheduleConfig.openTimes).join(", ") || "07:00",
  );
  const [closeMessage, setCloseMessage] = useState(
    String(scheduleConfig.closeMessage || ""),
  );
  const [openMessage, setOpenMessage] = useState(
    String(scheduleConfig.openMessage || ""),
  );
  const [times, setTimes] = useState(
    stringList(horapgConfig.times).join(", ") || "08:00",
  );
  const [mentionAll, setMentionAll] = useState(
    Boolean(horapgConfig.mentionAll),
  );
  const [downloaderOnly, setDownloaderOnly] = useState(
    Boolean(recordValue(settings.featureFlags).downloaderOnlyMode),
  );
  const [deleteMessage, setDeleteMessage] = useState(
    moderationAction.deleteMessage === undefined
      ? true
      : Boolean(moderationAction.deleteMessage),
  );
  const [registerInfraction, setRegisterInfraction] = useState(
    moderationAction.registerInfraction === undefined
      ? true
      : Boolean(moderationAction.registerInfraction),
  );
  const [banUser, setBanUser] = useState(
    moderationAction.banUser === undefined
      ? key === "banextremo" || key === "bangringos"
      : Boolean(moderationAction.banUser),
  );
  const [maxInfractions, setMaxInfractions] = useState(
    String(moderationAction.maxInfractions || settings.maxInfractions || 5),
  );
  const [allowedLinks, setAllowedLinks] = useState(
    stringList(settings.allowedLinks).join("\n"),
  );
  const [bannedWords, setBannedWords] = useState(
    stringList(settings.bannedWords).join("\n"),
  );
  const [blacklist, setBlacklist] = useState(
    stringList(settings.blacklist).join("\n"),
  );
  const [aiProvider, setAiProvider] = useState(
    String(settings.aiProvider || "groq"),
  );
  const [aiModel, setAiModel] = useState(String(settings.aiModel || ""));
  const [aiPrompt, setAiPrompt] = useState(String(settings.aiPrompt || ""));
  const [mentionOnly, setMentionOnly] = useState(
    Boolean(recordValue(settings.featureFlags).botInterageMentionOnly),
  );
  const [listenAudio, setListenAudio] = useState(
    Boolean(recordValue(settings.commandToggles).ouviraudiobotinterage),
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const commands = activationCommands[key] || [];
  const isMessageConfig = Boolean(messageConfigKey);
  const resolvedPreview = mediaUrl ? absoluteMediaUrl(mediaUrl) : "";

  const uploadMedia = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !messageConfigKey || uploading) return;
    if (file.size > 16 * 1024 * 1024) {
      setError("A mídia deve ter no máximo 16 MB.");
      return;
    }
    setUploading(true);
    setError("");
    const localPreview = URL.createObjectURL(file);
    setMediaUrl(localPreview);
    setUseProfilePhoto(false);
    try {
      const result = await api.uploadBotGroupMessageMedia(
        groupId,
        key === "bemvindo" ? "welcome" : "farewell",
        file,
      );
      const next = (result.settings || settings) as JsonRecord;
      const nextConfig = recordValue(next[messageConfigKey]);
      setMediaUrl(
        String(nextConfig.mediaUrl || nextConfig.mediaPath || localPreview),
      );
      onSaved(next);
    } catch (cause) {
      setMediaUrl(String(messageConfig.mediaUrl || messageConfig.mediaPath || ""));
      setError(
        cause instanceof Error ? cause.message : "Não foi possível enviar a mídia.",
      );
    } finally {
      URL.revokeObjectURL(localPreview);
      setUploading(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    let payload = activationPayload(settings, definition, enabled);
    if (messageConfigKey) {
      const labels = splitConfigLines(buttonLabels).slice(0, 3);
      const preserved = initialButtons;
      const replyButtons = buttonsEnabled && labels.length
        ? {
            ...replyConfig,
            enabled: true,
            position: String(replyConfig.position || "before_attachments"),
            body: String(replyConfig.body || ""),
            footer: buttonFooter.trim() || null,
            buttons: labels.map((label, index) => ({
              ...(preserved[index] || {}),
              id: String(preserved[index]?.id || `${key}_${index + 1}`),
              type: String(preserved[index]?.type || "quick_reply"),
              label,
              command: String(
                preserved[index]?.command ||
                  label.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
              ),
            })),
          }
        : null;
      const cleanMedia = mediaUrl.startsWith("blob:") ? "" : mediaUrl.trim();
      payload = {
        ...payload,
        [messageConfigKey]: {
          ...messageConfig,
          enabled,
          caption,
          mediaUrl: cleanMedia || null,
          mediaPath:
            cleanMedia && cleanMedia === String(messageConfig.mediaPath || "")
              ? messageConfig.mediaPath
              : cleanMedia
                ? null
                : messageConfig.mediaPath || null,
          useParticipantProfilePhoto: useProfilePhoto,
          asSticker,
          ...(key === "bemvindo" ? { replyButtons } : {}),
        },
      };
    } else if (key === "schedule") {
      payload = {
        scheduleConfig: {
          ...scheduleConfig,
          closeEnabled,
          openEnabled,
          closeTimes: splitConfigLines(closeTimes),
          openTimes: splitConfigLines(openTimes),
          closeMessage: closeMessage.trim() || null,
          openMessage: openMessage.trim() || null,
          timezone: String(scheduleConfig.timezone || "America/Sao_Paulo"),
        },
        commandToggles: { schedule: closeEnabled || openEnabled },
      };
    } else if (key === "horapg") {
      payload = {
        horapgConfig: {
          ...horapgConfig,
          enabled,
          times: splitConfigLines(times),
          mentionAll,
          timezone: String(horapgConfig.timezone || "America/Sao_Paulo"),
        },
        commandToggles: { horapg: enabled },
      };
    } else if (key === "autodownloader") {
      payload = {
        ...payload,
        featureFlags: { downloaderOnlyMode: enabled && downloaderOnly },
      };
    } else if (key === "botinterage") {
      payload = {
        ...payload,
        commandToggles: {
          botinterage: enabled,
          ouviraudiobotinterage: enabled && listenAudio,
        },
        featureFlags: { botInterageMentionOnly: mentionOnly },
        aiProvider,
        aiModel: aiModel.trim() || null,
        aiPrompt: aiPrompt.trim(),
      };
    } else if (moderationActivationKeys.has(key)) {
      payload = {
        ...payload,
        moderationActions: {
          [key]: {
            deleteMessage,
            registerInfraction,
            banUser,
            maxInfractions: Math.max(1, Number(maxInfractions) || 1),
          },
        },
        allowedLinks: splitConfigLines(allowedLinks),
        bannedWords: splitConfigLines(bannedWords),
        blacklist: splitConfigLines(blacklist),
        maxInfractions: Math.max(1, Number(maxInfractions) || 5),
      };
    }
    try {
      const result = await api.updateBotGroupSettings(groupId, payload);
      onSaved((result.settings || { ...settings, ...payload }) as JsonRecord);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar esta configuração.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop activation-config-backdrop">
      <section className={`quick-modal activation-config-modal ${isMessageConfig ? "activation-config-modal--preview" : ""}`} role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>Configurar {definition.label}</h2>
            <small>{groupName}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"><X /></button>
        </header>
        <div className="activation-config-scroll">
          <label className="settings-toggle activation-main-toggle">
            <span><b>Ativar {definition.label}</b><small>{definition.description}</small></span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <i />
          </label>
          {!isMessageConfig && <section className="activation-live-preview" aria-label={`Prévia de ${definition.label}`}>
            <div className="activation-live-preview-heading"><div><b>Prévia no grupo</b><span>Veja como esta ativação aparece na conversa.</span></div><Eye /></div>
            <div className={`activation-preview-bubble ${enabled ? "is-enabled" : "is-disabled"}`}>
              <Avatar name="BotAdmin" small />
              <div><strong>BotAdmin</strong><p>{key === "schedule" ? "Grupo fechado: somente admins podem enviar mensagens." : key === "horapg" ? "Disparo programado do grupo aparecerá aqui." : definition.description}</p><small>{enabled ? "Ativação ligada" : "Ativação desligada"}</small></div>
            </div>
          </section>}
          {isMessageConfig && (
            <div className="message-config-layout">
              <div className="message-config-fields">
                <label className="quick-label">Mensagem
                  <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={6} placeholder={key === "bemvindo" ? "Olá {{pushName}}, seja bem-vindo ao {{nomeGrupo}}!" : "Até logo, {{pushName}}!"} />
                </label>
                <label className="quick-label">Link da mídia
                  <input value={mediaUrl.startsWith("blob:") ? "" : mediaUrl} onChange={(event) => { setMediaUrl(event.target.value); setUseProfilePhoto(false); }} placeholder="https://... (opcional)" />
                </label>
                <div className="message-media-actions">
                  <label className="secondary-button file-action-button">
                    <Image /> {uploading ? "Enviando…" : "Enviar mídia"}
                    <input type="file" accept="image/*,video/*,audio/*,.pdf" disabled={uploading} onChange={(event) => void uploadMedia(event)} />
                  </label>
                  {(mediaUrl || useProfilePhoto) && <button type="button" className="secondary-button" onClick={() => { setMediaUrl(""); setUseProfilePhoto(false); }}>Remover mídia</button>}
                </div>
                <label className="settings-toggle compact-config-toggle">
                  <span><b>Usar foto do participante</b><small>Personaliza a mensagem com a foto de quem entrou.</small></span>
                  <input type="checkbox" checked={useProfilePhoto} onChange={(event) => { setUseProfilePhoto(event.target.checked); if (event.target.checked) setMediaUrl(""); }} /><i />
                </label>
                <label className="settings-toggle compact-config-toggle">
                  <span><b>Enviar como figurinha</b><small>Aplica à imagem configurada ou foto do participante.</small></span>
                  <input type="checkbox" checked={asSticker} onChange={(event) => setAsSticker(event.target.checked)} /><i />
                </label>
                {key === "bemvindo" && (
                  <>
                    <label className="settings-toggle compact-config-toggle">
                      <span><b>Botões interativos</b><small>Exibe até três respostas rápidas na mensagem.</small></span>
                      <input type="checkbox" checked={buttonsEnabled} onChange={(event) => setButtonsEnabled(event.target.checked)} /><i />
                    </label>
                    {buttonsEnabled && <>
                      <label className="quick-label">Texto dos botões
                        <textarea rows={3} value={buttonLabels} onChange={(event) => setButtonLabels(event.target.value)} placeholder={"Um botão por linha\nVer regras\nFalar com admin"} />
                      </label>
                      <label className="quick-label">Rodapé pequeno
                        <input value={buttonFooter} onChange={(event) => setButtonFooter(event.target.value)} placeholder="BotAdmin" />
                      </label>
                    </>}
                  </>
                )}
              </div>
              <div className="message-phone-preview" aria-label="Prévia da mensagem">
                <div className="message-phone-status"><span>11:14</span><span>4G</span></div>
                <div className="message-phone-header"><ArrowLeft /><Avatar name={groupName} small /><b>{groupName}</b></div>
                <div className="message-phone-chat">
                  <article className="message-preview-bubble">
                    <strong>BotAdmin</strong>
                    {useProfilePhoto ? (
                      <div className={`message-preview-media profile-photo ${asSticker ? "as-sticker" : ""}`}><UserPlus /></div>
                    ) : resolvedPreview ? (
                      <img className={`message-preview-image ${asSticker ? "as-sticker" : ""}`} src={resolvedPreview} alt="Mídia da mensagem" />
                    ) : (
                      <div className="message-preview-media"><Image /><span>Adicionar mídia</span></div>
                    )}
                    <p>{caption.trim() || (key === "bemvindo" ? "Olá João, seja bem-vindo ao grupo!" : "Até logo, João!")}</p>
                    {buttonsEnabled && splitConfigLines(buttonLabels).slice(0, 3).map((label) => <button type="button" key={label}>{label}</button>)}
                    {buttonFooter && <small>{buttonFooter}</small>}
                    <time>11:14</time>
                  </article>
                </div>
              </div>
            </div>
          )}
          {key === "schedule" && <div className="activation-form-grid">
            <label className="settings-toggle compact-config-toggle"><span><b>Fechar automaticamente</b><small>Restringe o envio aos admins nos horários definidos.</small></span><input type="checkbox" checked={closeEnabled} onChange={(event) => setCloseEnabled(event.target.checked)} /><i /></label>
            {closeEnabled && <><label className="quick-label">Horários de fechamento<input value={closeTimes} onChange={(event) => setCloseTimes(event.target.value)} placeholder="00:00, 12:00" /></label><label className="quick-label">Mensagem ao fechar<input value={closeMessage} onChange={(event) => setCloseMessage(event.target.value)} placeholder="Grupo fechado. Somente admins podem enviar." /></label></>}
            <label className="settings-toggle compact-config-toggle"><span><b>Abrir automaticamente</b><small>Libera o grupo nos horários definidos.</small></span><input type="checkbox" checked={openEnabled} onChange={(event) => setOpenEnabled(event.target.checked)} /><i /></label>
            {openEnabled && <><label className="quick-label">Horários de abertura<input value={openTimes} onChange={(event) => setOpenTimes(event.target.value)} placeholder="07:00, 18:00" /></label><label className="quick-label">Mensagem ao abrir<input value={openMessage} onChange={(event) => setOpenMessage(event.target.value)} placeholder="Grupo aberto para mensagens." /></label></>}
            <div className="config-timezone"><Clock3 /><span>Fuso: America/Sao_Paulo</span></div>
          </div>}
          {key === "horapg" && <div className="activation-form-grid">
            <label className="quick-label">Horários<input value={times} onChange={(event) => setTimes(event.target.value)} placeholder="08:00, 12:00, 19:00" /></label>
            <label className="settings-toggle compact-config-toggle"><span><b>Mencionar todos</b><small>Inclui os membros no disparo programado.</small></span><input type="checkbox" checked={mentionAll} onChange={(event) => setMentionAll(event.target.checked)} /><i /></label>
            <div className="config-timezone"><Clock3 /><span>Fuso: America/Sao_Paulo</span></div>
          </div>}
          {key === "autodownloader" && <label className="settings-toggle compact-config-toggle"><span><b>Grupo usado só para downloads</b><small>Texto comum vira uma busca com opções MP3 e MP4.</small></span><input type="checkbox" checked={enabled && downloaderOnly} disabled={!enabled} onChange={(event) => setDownloaderOnly(event.target.checked)} /><i /></label>}
          {key === "botinterage" && <div className="activation-form-grid">
            <label className="settings-toggle compact-config-toggle"><span><b>Responder somente quando chamado</b><small>Responde a menções ou citações do robô.</small></span><input type="checkbox" checked={mentionOnly} onChange={(event) => setMentionOnly(event.target.checked)} /><i /></label>
            <label className="settings-toggle compact-config-toggle"><span><b>Ouvir áudios</b><small>Interpreta notas de voz elegíveis.</small></span><input type="checkbox" checked={listenAudio} onChange={(event) => setListenAudio(event.target.checked)} /><i /></label>
            <label className="quick-label">Integração<select value={aiProvider} onChange={(event) => setAiProvider(event.target.value)}><option value="groq">Groq</option><option value="openai">OpenAI</option><option value="chatgpt_system">ChatGPT Sistema</option></select></label>
            <label className="quick-label">Modelo<input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="Automático" /></label>
            <label className="quick-label full-span">Prompt de comportamento<textarea rows={6} value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Defina como o robô deve falar neste grupo." /></label>
          </div>}
          {moderationActivationKeys.has(key) && <div className="activation-form-grid">
            <label className="settings-toggle compact-config-toggle"><span><b>Apagar mensagem</b><small>Remove o conteúdo que violou a regra.</small></span><input type="checkbox" checked={deleteMessage} onChange={(event) => setDeleteMessage(event.target.checked)} /><i /></label>
            <label className="settings-toggle compact-config-toggle"><span><b>Registrar infração</b><small>Conta reincidências do participante.</small></span><input type="checkbox" checked={registerInfraction} onChange={(event) => setRegisterInfraction(event.target.checked)} /><i /></label>
            <label className="settings-toggle compact-config-toggle"><span><b>Remover participante</b><small>Expulsa ao atingir o limite definido.</small></span><input type="checkbox" checked={banUser} onChange={(event) => setBanUser(event.target.checked)} /><i /></label>
            <label className="quick-label">Limite de infrações<input type="number" min="1" max="100" value={maxInfractions} onChange={(event) => setMaxInfractions(event.target.value)} /></label>
            {key === "antilink" && <label className="quick-label full-span">Links permitidos<textarea rows={4} value={allowedLinks} onChange={(event) => setAllowedLinks(event.target.value)} placeholder="Um domínio ou link por linha" /></label>}
            {key === "antipalavras" && <label className="quick-label full-span">Palavras proibidas<textarea rows={4} value={bannedWords} onChange={(event) => setBannedWords(event.target.value)} placeholder="Uma palavra por linha" /></label>}
            {(key === "banextremo" || key === "bangringos") && <label className="quick-label full-span">Lista bloqueada<textarea rows={4} value={blacklist} onChange={(event) => setBlacklist(event.target.value)} placeholder="Um número por linha" /></label>}
          </div>}
          {!isMessageConfig && key !== "schedule" && key !== "horapg" && key !== "autodownloader" && key !== "botinterage" && !moderationActivationKeys.has(key) && (
            <div className="activation-how-it-works"><ShieldCheck /><div><b>Como funciona</b><p>{definition.description} A alteração é aplicada somente a este grupo e pode ser revertida a qualquer momento.</p></div></div>
          )}
          {commands.length > 0 && <section className="activation-command-help"><div><Bot /><b>Comandos no grupo</b></div><p>Use os comandos abaixo para controlar a função diretamente na conversa.</p><div>{commands.map((command) => <button type="button" key={command} onClick={() => void copyText(command)}><Copy />{command}</button>)}</div></section>}
          {error && <div className="form-error">{error}</div>}
        </div>
        <footer className="activation-config-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="primary-button" onClick={() => void save()} disabled={saving || uploading}>{saving ? "Salvando…" : "Salvar configuração"}</button></footer>
      </section>
    </div>
  );
}

type BotAdvancedMode = "prefixes" | "menus" | "responses" | "ads";
type BotAdvancedResponseDraft = {
  id: string;
  source: JsonRecord;
  triggers: string;
  responseText: string;
  matchMode: "contains" | "equals";
};
type BotAdvancedAdDraft = {
  id: string;
  source: JsonRecord;
  enabled: boolean;
  caption: string;
  mentionAll: boolean;
  scheduleType: "frequency" | "times";
  frequency: string;
  times: string;
};

const botMenuTextFields: Array<[string, string]> = [
  ["main", "Menu principal"],
  ["admin", "Menu de administração"],
  ["comandos", "Comandos"],
  ["outros", "Outros"],
  ["downloads", "Downloads"],
  ["ativacoes", "Ativações"],
  ["jogos", "Jogos e brincadeiras"],
];

const newBotDraftId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function BotAdvancedConfigModal({
  mode,
  settings,
  groupId,
  groupName,
  onClose,
  onSaved,
}: {
  mode: BotAdvancedMode;
  settings: JsonRecord;
  groupId: number;
  groupName: string;
  onClose: () => void;
  onSaved: (settings: JsonRecord) => void;
}) {
  const initialMenuTexts = recordValue(settings.menuTexts);
  const initialResponses = Array.isArray(settings.autoResponses)
    ? settings.autoResponses.map((entry) => {
        const source = recordValue(entry);
        return {
          id: String(source.id || newBotDraftId("response")),
          source,
          triggers: stringList(source.triggers).join(", "),
          responseText: String(source.responseText || ""),
          matchMode: source.matchMode === "contains" ? "contains" : "equals",
        } satisfies BotAdvancedResponseDraft;
      })
    : [];
  const initialAds = Array.isArray(settings.ads)
    ? settings.ads.map((entry) => {
        const source = recordValue(entry);
        const scheduleType = source.scheduleType === "times" ? "times" : "frequency";
        return {
          id: String(source.id || newBotDraftId("ad")),
          source,
          enabled: source.enabled !== false,
          caption: String(source.caption || ""),
          mentionAll: Boolean(source.mentionAll),
          scheduleType,
          frequency: String(source.frequency || "24h"),
          times: stringList(source.times).join(", "),
        } satisfies BotAdvancedAdDraft;
      })
    : [];
  const [prefixes, setPrefixes] = useState(
    stringList(settings.commandPrefixes).join("\n") || "/\n!\n#",
  );
  const [allowWithoutPrefix, setAllowWithoutPrefix] = useState(
    Boolean(settings.allowCommandsWithoutPrefix),
  );
  const [menuTexts, setMenuTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      botMenuTextFields.map(([key]) => [key, stringList(initialMenuTexts[key]).join("\n")]),
    ),
  );
  const [responses, setResponses] = useState<BotAdvancedResponseDraft[]>(initialResponses);
  const [ads, setAds] = useState<BotAdvancedAdDraft[]>(initialAds);
  const [removedAds, setRemovedAds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title =
    mode === "prefixes"
      ? "Configurar prefixos"
      : mode === "menus"
        ? "Menus do robô"
        : mode === "responses"
          ? "Respostas automáticas"
          : "Mensagens programadas";
  const subtitle =
    mode === "prefixes"
      ? "Defina como os comandos serão reconhecidos neste grupo."
      : mode === "menus"
        ? "Edite os textos do menu sem alterar as ativações."
        : mode === "responses"
          ? "Crie respostas com texto e gatilhos claros."
          : "Configure anúncios, horários e menções do grupo.";

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (mode === "prefixes") {
        const nextPrefixes = Array.from(
          new Set(
            splitConfigLines(prefixes)
              .map((entry) => entry.replace(/\s+/g, ""))
              .filter(Boolean),
          ),
        ).slice(0, 10);
        const patch = {
          commandPrefixes: nextPrefixes.length ? nextPrefixes : ["/", "!", "#"],
          allowCommandsWithoutPrefix: allowWithoutPrefix,
        };
        const result = await api.updateBotGroupSettings(groupId, patch);
        onSaved((result.settings || { ...settings, ...patch }) as JsonRecord);
      } else if (mode === "menus") {
        const patch = {
          menuTexts: Object.fromEntries(
            botMenuTextFields.map(([key]) => [key, splitConfigLines(menuTexts[key] || "")]),
          ),
        };
        const result = await api.updateBotGroupSettings(groupId, patch);
        onSaved((result.settings || { ...settings, ...patch }) as JsonRecord);
      } else if (mode === "responses") {
        const patchResponses = responses
          .map((entry) => ({
            ...entry.source,
            id: entry.id,
            triggers: Array.from(new Set(splitConfigLines(entry.triggers).map((value) => value.toLowerCase()))).slice(0, 20),
            responseText: entry.responseText.trim(),
            matchMode: entry.matchMode,
            updatedAt: new Date().toISOString(),
          }))
          .filter(
            (entry) =>
              (Array.isArray(entry.triggers) && entry.triggers.length > 0) &&
              (String(entry.responseText || "").length > 0 || Boolean(recordValue(entry).responseMedia) || Boolean(recordValue(entry).responseVcard)),
          )
          .slice(0, 50);
        const patch = { autoResponses: patchResponses };
        const result = await api.updateBotGroupSettings(groupId, patch);
        onSaved((result.settings || { ...settings, ...patch }) as JsonRecord);
      } else {
        for (const adId of removedAds) {
          if (!adId.startsWith("ad-")) await api.deleteBotGroupAd(groupId, adId);
        }
        const savedAds: JsonRecord[] = [];
        for (const entry of ads) {
          const payload: JsonRecord = {
            caption: entry.caption.trim(),
            enabled: entry.enabled,
            mentionAll: entry.mentionAll,
            scheduleType: entry.scheduleType,
            frequency: entry.scheduleType === "frequency" ? entry.frequency.trim() || "24h" : "",
            times: entry.scheduleType === "times" ? splitConfigLines(entry.times) : [],
          };
          if (!entry.source.id) {
            const result = await api.createBotGroupAd(groupId, { ...payload, media: entry.source.media || null });
            savedAds.push((result.ad || { ...entry.source, ...payload, id: newBotDraftId("ad") }) as JsonRecord);
          } else {
            const result = await api.updateBotGroupAd(groupId, entry.id, payload);
            savedAds.push((result.ad || { ...entry.source, ...payload, id: entry.id }) as JsonRecord);
          }
        }
        const patch = { ads: savedAds };
        onSaved({ ...settings, ...patch });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar esta configuração.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop activation-config-backdrop">
      <section className="quick-modal bot-advanced-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <div className="modal-heading-line"><h2>{title}</h2><InfoTip label={title}>{subtitle} As alterações ficam restritas ao grupo {groupName}.</InfoTip></div>
            <small>{groupName}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"><X /></button>
        </header>
        <div className="bot-advanced-scroll">
          {mode === "prefixes" && <div className="bot-advanced-form">
            <label className="quick-label">Prefixos<textarea rows={4} value={prefixes} onChange={(event) => setPrefixes(event.target.value)} placeholder="Um por linha. Exemplo: /, !, #" /></label>
            <label className="settings-toggle compact-config-toggle"><span><b>Permitir comandos sem prefixo</b><small>Aceita menu, play e comandos sem / ou !.</small></span><input type="checkbox" checked={allowWithoutPrefix} onChange={(event) => setAllowWithoutPrefix(event.target.checked)} /><i /></label>
            <div className="bot-advanced-preview"><Tag /><span>{allowWithoutPrefix ? "Aceita comandos com ou sem prefixo." : "Os comandos precisam começar com um prefixo."}</span></div>
          </div>}
          {mode === "menus" && <div className="bot-advanced-form bot-menu-fields">
            {botMenuTextFields.map(([key, label]) => <label className="quick-label" key={key}>{label}<textarea rows={3} value={menuTexts[key] || ""} onChange={(event) => setMenuTexts((current) => ({ ...current, [key]: event.target.value }))} placeholder="Uma opção por linha" /></label>)}
          </div>}
          {mode === "responses" && <div className="bot-advanced-form">
            <div className="bot-advanced-list-heading"><div><b>Gatilhos e respostas</b><small>O robô responde quando o texto recebido corresponder à regra.</small></div><button type="button" className="secondary-button" onClick={() => setResponses((current) => [...current, { id: newBotDraftId("response"), source: {}, triggers: "", responseText: "", matchMode: "equals" }])}><Plus /> Adicionar</button></div>
            {responses.length === 0 && <div className="bot-advanced-empty"><MessageCircle /><span>Nenhuma resposta configurada. Adicione a primeira regra.</span></div>}
            {responses.map((entry, index) => <article className="bot-advanced-row" key={entry.id}>
              <div className="bot-advanced-row-heading"><b>Resposta {index + 1}</b><button type="button" className="icon-button" aria-label="Remover resposta" onClick={() => setResponses((current) => current.filter((item) => item.id !== entry.id))}><X /></button></div>
              <label className="quick-label">Gatilhos<input value={entry.triggers} onChange={(event) => setResponses((current) => current.map((item) => item.id === entry.id ? { ...item, triggers: event.target.value } : item))} placeholder="oi, olá, bom dia" /></label>
              <label className="quick-label">Resposta<textarea rows={3} value={entry.responseText} onChange={(event) => setResponses((current) => current.map((item) => item.id === entry.id ? { ...item, responseText: event.target.value } : item))} placeholder="Mensagem que o robô enviará" /></label>
              <label className="quick-label">Correspondência<select value={entry.matchMode} onChange={(event) => setResponses((current) => current.map((item) => item.id === entry.id ? { ...item, matchMode: event.target.value === "contains" ? "contains" : "equals" } : item))}><option value="equals">Texto exato</option><option value="contains">Contém o texto</option></select></label>
            </article>)}
          </div>}
          {mode === "ads" && <div className="bot-advanced-form">
            <div className="bot-advanced-list-heading"><div><b>Mensagens programadas</b><small>Até 20 anúncios por grupo, com frequência ou horários definidos.</small></div><button type="button" className="secondary-button" disabled={ads.length >= 20} onClick={() => setAds((current) => [...current, { id: newBotDraftId("ad"), source: {}, enabled: true, caption: "", mentionAll: false, scheduleType: "frequency", frequency: "24h", times: "" }])}><Plus /> Adicionar</button></div>
            {ads.length === 0 && <div className="bot-advanced-empty"><Clock3 /><span>Nenhuma mensagem programada neste grupo.</span></div>}
            {ads.map((entry, index) => <article className="bot-advanced-row" key={entry.id}>
              <div className="bot-advanced-row-heading"><b>Mensagem {index + 1}</b><button type="button" className="icon-button" aria-label="Remover mensagem" onClick={() => { setAds((current) => current.filter((item) => item.id !== entry.id)); setRemovedAds((current) => [...current, entry.id]); }}><X /></button></div>
              <label className="quick-label">Texto<textarea rows={3} value={entry.caption} onChange={(event) => setAds((current) => current.map((item) => item.id === entry.id ? { ...item, caption: event.target.value } : item))} placeholder="Mensagem que será enviada" /></label>
              <div className="bot-advanced-inline-fields"><label className="settings-toggle compact-config-toggle"><span><b>Ativa</b><small>Pausar sem apagar.</small></span><input type="checkbox" checked={entry.enabled} onChange={(event) => setAds((current) => current.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item))} /><i /></label><label className="settings-toggle compact-config-toggle"><span><b>Mencionar todos</b><small>Inclui a menção no envio.</small></span><input type="checkbox" checked={entry.mentionAll} onChange={(event) => setAds((current) => current.map((item) => item.id === entry.id ? { ...item, mentionAll: event.target.checked } : item))} /><i /></label></div>
              <label className="quick-label">Tipo de programação<select value={entry.scheduleType} onChange={(event) => setAds((current) => current.map((item) => item.id === entry.id ? { ...item, scheduleType: event.target.value === "times" ? "times" : "frequency" } : item))}><option value="frequency">A cada intervalo</option><option value="times">Horários fixos</option></select></label>
              {entry.scheduleType === "frequency" ? <label className="quick-label">Intervalo<input value={entry.frequency} onChange={(event) => setAds((current) => current.map((item) => item.id === entry.id ? { ...item, frequency: event.target.value } : item))} placeholder="24h, 6h, 30m" /></label> : <label className="quick-label">Horários<input value={entry.times} onChange={(event) => setAds((current) => current.map((item) => item.id === entry.id ? { ...item, times: event.target.value } : item))} placeholder="08:00, 12:00, 19:00" /></label>}
            </article>)}
          </div>}
          {error && <div className="form-error">{error}</div>}
        </div>
        <footer className="activation-config-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "Salvando…" : "Salvar configuração"}</button></footer>
      </section>
    </div>
  );
}

function BotAdvancedControls({
  settings,
  groupId,
  groupName,
  onSaved,
}: {
  settings: JsonRecord;
  groupId: number;
  groupName: string;
  onSaved: (settings: JsonRecord) => void;
}) {
  const [mode, setMode] = useState<BotAdvancedMode | null>(null);
  const prefixes = stringList(settings.commandPrefixes);
  const autoResponses = Array.isArray(settings.autoResponses) ? settings.autoResponses.length : 0;
  const ads = Array.isArray(settings.ads) ? settings.ads.length : 0;
  return <>
    <section className="bot-advanced-panel">
      <div className="activation-overview-heading"><div><h3>Controles principais</h3><span>Mesma organização do painel Flutter.</span></div><InfoTip label="Controles principais">Prefixos, menus, respostas automáticas e mensagens programadas têm configuração própria e não ficam misturados nas ativações.</InfoTip></div>
      <div className="bot-advanced-grid">
        <button type="button" className="bot-advanced-card" onClick={() => setMode("prefixes")}><Tag /><span><b>Prefixos</b><small>{prefixes.length ? prefixes.slice(0, 4).join(" ") : "/ ! #"}</small></span><ChevronRight /></button>
        <button type="button" className="bot-advanced-card" onClick={() => setMode("menus")}><List /><span><b>Menus do robô</b><small>Editar cards, textos e imagens.</small></span><ChevronRight /></button>
        <button type="button" className="bot-advanced-card" onClick={() => setMode("ads")}><Clock3 /><span><b>Mensagens programadas</b><small>{ads ? `${ads} mensagem(ns) configurada(s).` : "Criar o primeiro ADS do grupo."}</small></span><ChevronRight /></button>
        <button type="button" className="bot-advanced-card" onClick={() => setMode("responses")}><MessageCircle /><span><b>Respostas automáticas</b><small>{autoResponses ? `${autoResponses} resposta(s) configurada(s).` : "Nenhuma resposta configurada."}</small></span><ChevronRight /></button>
      </div>
    </section>
    {mode && <BotAdvancedConfigModal mode={mode} settings={settings} groupId={groupId} groupName={groupName} onClose={() => setMode(null)} onSaved={onSaved} />}
  </>;
}

function BotGroupAutomationModal({
  item,
  onClose,
  onChanged,
}: {
  item: JsonRecord;
  onClose: () => void;
  onChanged: (group?: JsonRecord) => void;
}) {
  const groupId = Number(item.id || 0);
  const [group, setGroup] = useState(item);
  const [settings, setSettings] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [configuring, setConfiguring] =
    useState<GroupActivationDefinition | null>(null);
  const [error, setError] = useState("");
  const botEnabled = ["active", "ativo", "enabled"].includes(
    String(group.status || "").toLowerCase(),
  );
  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError("");
    try {
      const [settingsResult, groupsResult] = await Promise.all([
        api.botGroupSettings(groupId),
        api.botGroups().catch(() => ({ groups: [] })),
      ]);
      setSettings((settingsResult.settings || {}) as JsonRecord);
      const groups = Array.isArray(groupsResult.groups)
        ? (groupsResult.groups as JsonRecord[])
        : [];
      const current = groups.find((candidate) => Number(candidate.id) === groupId);
      if (current) setGroup(current);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as ativações.",
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);
  useEffect(() => {
    void load();
  }, [load]);
  const saveBot = async (value: boolean) => {
    if (saving || !groupId) return;
    const previous = group;
    setGroup((current) => ({
      ...current,
      status: value ? "active" : "disabled",
    }));
    setSaving("bot-status");
    setError("");
    try {
      const result = await api.updateBotGroup(groupId, { active: value });
      const updated = (result.group || {
        ...group,
        status: value ? "active" : "disabled",
      }) as JsonRecord;
      setGroup(updated);
      onChanged(updated);
    } catch (cause) {
      setGroup(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar o robô.",
      );
    } finally {
      setSaving(null);
    }
  };
  const saveActivation = async (
    definition: GroupActivationDefinition,
    value: boolean,
  ) => {
    if (saving || !settings || !groupId) return;
    const previous = settings;
    setSettings(optimisticActivationSettings(settings, definition, value));
    setSaving(definition.key);
    setError("");
    try {
      const result = await api.updateBotGroupSettings(
        groupId,
        activationPayload(settings, definition, value),
      );
      setSettings(
        (result.settings ||
          optimisticActivationSettings(settings, definition, value)) as JsonRecord,
      );
    } catch (cause) {
      setSettings(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar esta ativação.",
      );
    } finally {
      setSaving(null);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="quick-modal group-automation-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Bot do grupo</h2>
              <InfoTip label="Bot do grupo">
                Ative o robô e escolha individualmente quais automações podem operar neste grupo.
              </InfoTip>
            </div>
            <small>{moduleItemTitle("groups", group)}</small>
          </div>
          <button onClick={onClose} aria-label="Fechar"><X /></button>
        </header>
        <div className="group-automation-scroll">
          <section className={`bot-master-control ${botEnabled ? "is-active" : ""}`}>
            <span className="bot-master-icon"><Bot /></span>
            <span>
              <b>Robô no grupo</b>
              <small>
                {loading
                  ? "Consultando o estado do robô…"
                  : botEnabled
                  ? "Bot operando neste grupo."
                  : "Bot pausado neste grupo."}
              </small>
            </span>
            <label className="compact-switch" aria-label="Ativar robô no grupo">
              <input
                type="checkbox"
                checked={botEnabled}
                disabled={saving !== null || loading}
                onChange={(event) => void saveBot(event.target.checked)}
              />
              <i />
            </label>
          </section>
          {settings && <BotAdvancedControls settings={settings} groupId={groupId} groupName={moduleItemTitle("groups", group)} onSaved={(next) => setSettings(next)} />}
          {loading ? (
            <div className="settings-loading"><RefreshCw className="spin" /> Carregando ativações…</div>
          ) : settings ? (
            <div>
              <div className="activation-overview-heading">
                <h3>Ativações do robô</h3>
                <span>Escolha quais recursos ficam ligados neste grupo.</span>
              </div>
              <div className="activation-sections">
                {groupActivationCategories.map((category) => (
                <section className="activation-category" key={category.id}>
                  <div className="activation-category-title">
                    <h3>{category.title}</h3>
                    <InfoTip label={category.title}>
                      Cada função é salva imediatamente e pode ser ligada ou desligada separadamente.
                    </InfoTip>
                  </div>
                  <div className="activation-grid">
                    {category.items.map((definition) => {
                      const active = activationEnabled(settings, definition);
                      const Icon = definition.icon;
                      return (
                        <div
                          className={`activation-tile ${active ? "is-active" : ""}`}
                          key={definition.key}
                        >
                          <Icon />
                          <span>
                            <b>{definition.label}</b>
                            <strong>{active ? "Ligado" : "Desligado"}</strong>
                            <small>{definition.description}</small>
                          </span>
                          <button
                            type="button"
                            className="activation-config-button"
                            title={`Configurar ${definition.label}`}
                            aria-label={`Configurar ${definition.label}`}
                            onClick={() => setConfiguring(definition)}
                          >
                            <Settings />
                          </button>
                          <label className="compact-switch">
                            <input
                              type="checkbox"
                              checked={active}
                              disabled={saving !== null}
                              onChange={(event) =>
                                void saveActivation(definition, event.target.checked)
                              }
                            />
                            <i />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
                ))}
              </div>
            </div>
          ) : null}
          {error && <div className="form-error">{error}</div>}
        </div>
      </section>
      {configuring && settings && (
        <GroupActivationConfigModal
          key={configuring.key}
          definition={configuring}
          settings={settings}
          groupId={groupId}
          groupName={moduleItemTitle("groups", group)}
          onClose={() => setConfiguring(null)}
          onSaved={(next) => setSettings(next)}
        />
      )}
    </div>
  );
}

function ModuleItemDetailsModal({
  section,
  item,
  onClose,
  onChanged,
}: {
  section: Section;
  item: JsonRecord;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = moduleItemTitle(section, item);
  const avatar = String(item.imageUrl || item.avatarUrl || item.mediaUrl || "");
  const fields: Array<[string, unknown]> =
    section === "broadcasts"
      ? [
          ["Descrição", item.description],
          ["Contatos", item.contactCount],
          ["Último envio", item.lastRunStatus],
          ["Atualizada em", dateText(item.updatedAt)],
        ]
      : section === "flows"
        ? [
            [
              "Comando",
              item.command ? `!${String(item.command).replace(/^!/, "")}` : "—",
            ],
            ["Gatilho", item.triggerType],
            ["Escopo", item.scope],
            ["Etapas", Array.isArray(item.nodes) ? item.nodes.length : 0],
            ["Revisão", item.revision],
          ]
        : section === "raffles"
          ? [
              ["Status", item.status],
              ["Valor", money(item.price)],
              ["Números", item.numbersTotal],
              ["Vendidos", item.soldCount],
              ["Disponíveis", item.availableCount],
              ["Ganhadores", item.winnersCount],
            ]
          : section === "groups"
            ? [
                ["Perfil", item.instanceName],
                ["Participantes", item.participantCount],
                ["Situação", item.status],
                ["Descrição", item.description],
                ["ID do grupo", item.remoteId],
              ]
            : [
                [
                  "Status",
                  item.status ?? (item.enabled === false ? "Pausada" : "Ativa"),
                ],
                ["Descrição", item.description],
                ["Atualizada em", dateText(item.updatedAt)],
                ["Identificador", item.id],
              ];
  const toggleFlow = async () => {
    if (section !== "flows" || !item.id || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.updateFlow(String(item.id), {
        enabled: !item.enabled,
        revision: Number(item.revision || 0),
      });
      onChanged();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar o fluxo.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="quick-modal module-item-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>{title}</h2>
              <InfoTip label={sectionMeta[section].title}>
                Consulte os dados deste item e execute somente as ações disponíveis para esta área.
              </InfoTip>
            </div>
            <small>{sectionMeta[section].title}</small>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="module-item-content">
          {avatar && (
            <img
              className="module-item-image"
              src={absoluteMediaUrl(avatar)}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          )}
          <div className="module-detail-list">
            {fields.map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <b>{displayValue(value, "—")}</b>
              </div>
            ))}
          </div>
          {section === "broadcasts" && Boolean(item.lastMessage) && (
            <section className="module-message-preview">
              <small>Última mensagem</small>
              <p>{String(item.lastMessage)}</p>
            </section>
          )}
          {section === "raffles" &&
            Array.isArray(item.winners) &&
            item.winners.length > 0 && (
              <section className="module-message-preview">
                <small>Resultado</small>
                <p>
                  {item.winners
                    .map(
                      (winner) =>
                        `${String((winner as JsonRecord).number || "—")} · ${String((winner as JsonRecord).customerName || "Ganhador")}`,
                    )
                    .join("\n")}
                </p>
              </section>
            )}
          {error && <div className="form-error">{error}</div>}
          {section === "flows" && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void toggleFlow()}
            >
              {busy
                ? "Salvando…"
                : item.enabled
                  ? "Pausar fluxo"
                  : "Ativar fluxo"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ProfileRenewModal({
  instance,
  onClose,
  onDone,
}: {
  instance: BotInstance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [snapshot, setSnapshot] = useState<JsonRecord | null>(null);
  const [planId, setPlanId] = useState(0);
  const [provider, setProvider] = useState("mercadopago_pix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState<JsonRecord | null>(null);
  useEffect(() => {
    void api
      .planMobile()
      .then(setSnapshot)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar os planos.",
        ),
      );
  }, []);
  const plans = firstArray(snapshot, ["plans"]).filter(
    (item) => Number(item.id) > 0 && item.isActive !== false,
  );
  useEffect(() => {
    if (!planId && plans[0]?.id) setPlanId(Number(plans[0].id));
  }, [plans, planId]);
  const submit = async () => {
    if (!planId || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.createPlanCheckout({
        planId,
        provider,
        context: { mode: "instance_renewal", instanceId: instance.id },
      });
      setCheckout((result.checkout || result) as JsonRecord);
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível gerar a renovação.",
      );
    } finally {
      setBusy(false);
    }
  };
  const checkoutUrl = String(
    checkout?.initPoint ||
      checkout?.redirectUrl ||
      checkout?.url ||
      checkout?.paymentUrl ||
      "",
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="quick-modal profile-renew-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Renovar perfil</h2>
              <InfoTip label="Renovar perfil">
                Selecione um plano e gere o pagamento. A validade será atualizada após a confirmação.
              </InfoTip>
            </div>
            <small>
              {instance.name} · {instance.phone || "número não informado"}
            </small>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        {error && <div className="form-error">{error}</div>}
        {checkout ? (
          <div className="profile-checkout-result">
            <b>Pagamento criado</b>
            <p>
              Conclua o pagamento para atualizar a validade do perfil
              automaticamente.
            </p>
            {checkoutUrl && (
              <a
                className="primary-button"
                href={checkoutUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir pagamento
              </a>
            )}
            <button className="secondary-button" onClick={onClose}>
              Fechar
            </button>
          </div>
        ) : (
          <div className="quick-form">
            <label>
              Plano
              <select
                value={planId || ""}
                onChange={(event) => setPlanId(Number(event.target.value))}
              >
                <option value="">Selecione um plano</option>
                {plans.map((plan) => (
                  <option key={String(plan.id)} value={String(plan.id)}>
                    {textOf(plan.name, "Plano")} · {money(plan.price)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Forma de pagamento
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                <option value="mercadopago_pix">Mercado Pago · Pix</option>
                <option value="mercadopago_checkout">
                  Mercado Pago · Checkout
                </option>
                <option value="polopag_pix">PoloPag · Pix</option>
              </select>
            </label>
            <p className="settings-muted">
              A confirmação do pagamento renova somente este perfil e não
              desconecta o WhatsApp.
            </p>
            <button
              className="primary-button"
              disabled={busy || !planId}
              onClick={() => void submit()}
            >
              {busy ? "Gerando pagamento…" : "Gerar pagamento da renovação"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function InstanceProxyModal({
  instance,
  onClose,
  onSaved,
}: {
  instance: BotInstance;
  onClose: () => void;
  onSaved: (proxy: JsonRecord) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [policy, setPolicy] = useState<JsonRecord>({});
  const [enabled, setEnabled] = useState(false);
  const [protocol, setProtocol] = useState("socks5");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasUsername, setHasUsername] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.instanceProxy(instance.id).then((response) => {
      if (cancelled) return;
      const proxy = (response.proxy || {}) as JsonRecord;
      setPolicy((response.policy || {}) as JsonRecord);
      setEnabled(proxy.enabled === true);
      setProtocol(["http", "https", "socks4", "socks4a", "socks5", "socks5h"].includes(String(proxy.protocol)) ? String(proxy.protocol) : "socks5");
      setHost(textOf(proxy.host));
      setPort(proxy.port ? String(proxy.port) : "");
      setHasUsername(proxy.hasUsername === true);
      setHasPassword(proxy.hasPassword === true);
      if (proxy.lastError) setError(textOf(proxy.lastError));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar o proxy."))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [instance.id]);

  const canConfigure = policy.allowCustomerProxy !== false;
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

  const validate = () => {
    if (!enabled) return true;
    if (!host.trim()) {
      setError("Informe o host, IPv4 ou IPv6 do proxy.");
      return false;
    }
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setError("Informe uma porta válida entre 1 e 65535.");
      return false;
    }
    return true;
  };

  const test = async () => {
    if (testing || saving || !validate()) return;
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const response = await api.testInstanceProxy(instance.id, payload());
      const check = response.check && typeof response.check === "object" ? response.check as JsonRecord : null;
      setNotice(check
        ? `Proxy aprovado para o WhatsApp. IP ${textOf(check.resolvedIp, "confirmado")}${check.regionName ? ` · ${textOf(check.regionName)}` : ""}${check.latencyMs ? ` · ${textOf(check.latencyMs)} ms` : ""}.`
        : "Proxy desativado; esta instância usará conexão direta.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "O proxy foi recusado no teste.");
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (saving || testing || !canConfigure || !validate()) return;
    setSaving(true);
    setError("");
    try {
      const response = await api.saveInstanceProxy(instance.id, payload());
      onSaved((response.proxy || {}) as JsonRecord);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o proxy.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="quick-modal instance-proxy-modal" role="dialog" aria-modal="true"><header><div><div className="modal-heading-line"><h2>Proxy da conexão</h2><InfoTip label="Proxy por perfil">O teste confirma a saída pública e o túnel do WhatsApp Web antes de salvar. Ao aplicar, o sistema reinicia somente a conexão e preserva o pareamento.</InfoTip></div><small>{instance.name} · {fullPhoneText(instance.phone)}</small></div><button onClick={onClose} aria-label="Fechar" disabled={saving}><X /></button></header>{loading ? <div className="settings-loading"><RefreshCw className="spin" />Carregando proxy…</div> : <div className="quick-form proxy-form"><label className="proxy-toggle-row"><span><b>Usar proxy</b><small>Desative para voltar à rota direta.</small></span><button type="button" className={`toggle ${enabled ? "active" : ""}`} aria-pressed={enabled} onClick={() => setEnabled((value) => !value)} disabled={!canConfigure}><i /></button></label>{!canConfigure && <div className="form-error">{textOf(policy.instructions, "O responsável comercial não liberou proxy personalizado para esta conta.")}</div>}<div className="proxy-fields"><label>Protocolo<select value={protocol} onChange={(event) => setProtocol(event.target.value)} disabled={!enabled || !canConfigure}><option value="http">HTTP / CONNECT</option><option value="https">HTTPS / CONNECT seguro</option><option value="socks4">SOCKS4</option><option value="socks4a">SOCKS4A</option><option value="socks5">SOCKS5</option><option value="socks5h">SOCKS5H · DNS pelo proxy</option></select></label><label>Host, IPv4 ou IPv6<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="2001:db8::10 ou proxy.exemplo.com" disabled={!enabled || !canConfigure} /></label><label>Porta<input value={port} onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="59100" disabled={!enabled || !canConfigure} /></label><label>Usuário opcional<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={hasUsername ? "Já configurado" : "Sem autenticação"} disabled={!enabled || !canConfigure} autoComplete="off" /></label><label>Senha opcional<input value={password} onChange={(event) => setPassword(event.target.value)} placeholder={hasPassword ? "Já configurada" : "Sem autenticação"} disabled={!enabled || !canConfigure} type="password" autoComplete="new-password" /></label></div>{notice && <div className="inline-notice success">{notice}</div>}{error && <div className="form-error">{error}</div>}<p className="settings-muted">É possível configurar um proxy diferente em cada perfil. São aceitos DNS, IPv4 e IPv6, com ou sem autenticação.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => void test()} disabled={testing || saving || !canConfigure}>{testing ? "Testando…" : "Testar em tempo real"}</button><button className="primary-button" type="button" onClick={() => void save()} disabled={saving || testing || !canConfigure}>{saving ? "Aplicando…" : "Salvar e aplicar"}</button></div></div>}</section></div>;
}

type PairingModalProps = {
  instance: BotInstance;
  onClose: () => void;
  onUpdated?: () => void;
};

function PairingModal({ instance, onClose, onUpdated }: PairingModalProps) {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [mode, setMode] = useState<"auto" | "code" | "qr">("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const started = useRef(false);

  const requestPairing = async (
    requestedMode: "auto" | "code" | "qr",
    allowQrFallback = true,
  ): Promise<void> => {
    if (loading) return;
    setMode(requestedMode);
    setLoading(true);
    setError("");
    setNotice("");
    setData(null);
    try {
      const result = await api.pairInstance(instance.id, requestedMode);
      const next = result.data && typeof result.data === "object"
        ? result.data
        : {};
      const hasPairingValue = Boolean(
        next.alreadyConnected ||
          next.qrCode ||
          next.qr ||
          next.QRCode ||
          next.linkingCode ||
          next.pairingCode ||
          next.code,
      );
      if (!hasPairingValue && requestedMode !== "qr" && allowQrFallback) {
        setLoading(false);
        await requestPairing("qr", false);
        return;
      }
      setData(next);
      if (next.alreadyConnected) {
        setNotice("Esta conexão já está ativa. Para trocar o número, edite a instância e confirme a substituição.");
      } else if (!hasPairingValue) {
        setError("O servidor não retornou um código de pareamento. Tente gerar o QR Code novamente.");
      } else {
        setNotice(requestedMode === "qr" ? "QR Code pronto para leitura no WhatsApp." : "Código de pareamento pronto.");
      }
      onUpdated?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível iniciar o pareamento.";
      const retryable = requestedMode !== "qr" && allowQrFallback &&
        !/autentic|renove|plano|já está ativa|ja está ativa|permissão|permissao/i.test(message);
      if (retryable) {
        setLoading(false);
        await requestPairing("qr", false);
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void requestPairing("auto");
    // The modal intentionally requests once on open; method buttons request
    // again explicitly and are not coupled to parent profile refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  const qrValue = textOf(data?.qrCode || data?.qr || data?.QRCode);
  const qrSrc = qrValue
    ? qrValue.startsWith("data:") || /^https?:\/\//i.test(qrValue)
      ? qrValue
      : /^[A-Za-z0-9+/=]{120,}$/.test(qrValue)
        ? `data:image/png;base64,${qrValue}`
        : absoluteMediaUrl(qrValue)
    : "";
  const linkingCode = textOf(
    data?.linkingCode || data?.pairingCode || data?.LinkingCode || data?.code,
  );

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onClose();
    }}>
      <section className="quick-modal profile-pairing-modal" role="dialog" aria-modal="true" aria-labelledby="profile-pairing-title">
        <header>
          <div>
            <h2 id="profile-pairing-title">Conectar WhatsApp</h2>
            <small>{instance.name} · {fullPhoneText(instance.phone)}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" disabled={loading}><X /></button>
        </header>
        <div className="quick-form pairing-modal-content">
          <div className="pairing-methods" role="group" aria-label="Método de pareamento">
            <button type="button" className={mode === "auto" ? "active" : ""} onClick={() => void requestPairing("auto")} disabled={loading}>
              <KeyRound /> Automático
            </button>
            <button type="button" className={mode === "code" ? "active" : ""} onClick={() => void requestPairing("code")} disabled={loading}>
              <MessageCircle /> Código
            </button>
            <button type="button" className={mode === "qr" ? "active" : ""} onClick={() => void requestPairing("qr")} disabled={loading}>
              <AppWindow /> QR Code
            </button>
          </div>
          {loading && <div className="settings-loading"><RefreshCw className="spin" />Gerando dados de conexão…</div>}
          {!loading && qrSrc && (
            <div className="pairing-result">
              <img src={qrSrc} alt="QR Code para conectar o WhatsApp" />
              <b>Leia este QR Code no WhatsApp</b>
              <small>WhatsApp → Dispositivos conectados → Conectar dispositivo.</small>
            </div>
          )}
          {!loading && linkingCode && !qrSrc && (
            <div className="pairing-result pairing-code-result">
              <span>Código de pareamento</span>
              <code>{linkingCode}</code>
              <small>No WhatsApp, abra Dispositivos conectados e informe este código.</small>
            </div>
          )}
          {!loading && Boolean(data?.alreadyConnected) && !qrSrc && !linkingCode && (
            <div className="pairing-result pairing-connected-result"><CheckSquare /><b>WhatsApp já conectado</b><small>Não é necessário gerar outro código.</small></div>
          )}
          {notice && <div className="inline-notice success">{notice}</div>}
          {error && <div className="form-error">{error}</div>}
          <div className="pairing-modal-actions">
            <button type="button" className="secondary-button" onClick={() => void requestPairing("qr")} disabled={loading}><AppWindow /> Gerar QR Code</button>
            <button type="button" className="primary-button" onClick={() => void requestPairing("code")} disabled={loading}><KeyRound /> Gerar código</button>
          </div>
        </div>
      </section>
    </div>
  );
}

type InstanceIdentityModalProps = {
  instance: BotInstance;
  onClose: () => void;
  onSaved: (result: { instance?: BotInstance; phoneChanged?: boolean; pairingRequired?: boolean }) => void;
};

function InstanceIdentityModal({ instance, onClose, onSaved }: InstanceIdentityModalProps) {
  const [name, setName] = useState(instance.name);
  const [phone, setPhone] = useState(textOf(instance.phone));
  const [confirmNumber, setConfirmNumber] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedPhone = phone.replace(/\D/g, "");
  const currentPhone = textOf(instance.phone).replace(/\D/g, "");
  const numberChanged = normalizedPhone !== currentPhone;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Informe um nome para a instância.");
      return;
    }
    if (normalizedPhone.length < 10 || normalizedPhone.length > 16) {
      setError("Informe um número de WhatsApp válido com DDI.");
      return;
    }
    if (numberChanged && !confirmNumber) {
      setConfirmNumber(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await api.updateInstanceProfile(instance.id, {
        instanceName: trimmedName,
        phone: normalizedPhone,
      });
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a instância.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <form className="quick-modal instance-identity-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="instance-identity-title">
        <header>
          <div>
            <h2 id="instance-identity-title">Editar instância</h2>
            <small>Nome e número usados no próximo pareamento.</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" disabled={saving}><X /></button>
        </header>
        <div className="quick-form">
          <label>Nome da instância<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoFocus /></label>
          <label>Número do WhatsApp<input value={phone} maxLength={24} inputMode="tel" placeholder="5511999999999" onChange={(event) => { setPhone(event.target.value); setConfirmNumber(false); }} /></label>
          {numberChanged && <div className="identity-warning"><b>O número será substituído</b><span>A sessão atual será desconectada e as credenciais antigas serão recicladas. Depois de salvar, um novo código ou QR Code será gerado para o número informado.</span></div>}
          {confirmNumber && numberChanged && <label className="identity-confirm"><input type="checkbox" checked={confirmNumber} onChange={(event) => setConfirmNumber(event.target.checked)} /> <span>Confirmo a desconexão e a geração de um novo pareamento.</span></label>}
          {error && <div className="form-error">{error}</div>}
          <div className="pairing-modal-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando…" : numberChanged && !confirmNumber ? "Continuar" : "Salvar alterações"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ProfilesWorkspace({
  instances,
  onProfilesChanged,
}: {
  instances: BotInstance[];
  onProfilesChanged?: () => void;
}) {
  const [items, setItems] = useState<BotInstance[]>(instances);
  const [selectedId, setSelectedId] = useState<number | null>(
    instances[0]?.id || null,
  );
  const [profile, setProfile] = useState<JsonRecord | null>(null);
  const [proxy, setProxy] = useState<JsonRecord | null>(null);
  const [instanceSettings, setInstanceSettings] = useState<JsonRecord | null>(null);
  const [instanceStorage, setInstanceStorage] = useState<JsonRecord | null>(null);
  const [settingsSaving, setSettingsSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [editingName, setEditingName] = useState("");
  const [editingPushName, setEditingPushName] = useState("");
  const [editingStatusText, setEditingStatusText] = useState("");
  const [profileImageDataUrl, setProfileImageDataUrl] = useState("");
  const [removeProfilePhoto, setRemoveProfilePhoto] = useState(false);
  const profilePhotoInput = useRef<HTMLInputElement>(null);
  const selected = items.find((item) => item.id === selectedId) || null;
  const profileAvatar = textOf(
    profile?.avatarUrl || profile?.profilePictureUrl || selected?.avatarUrl,
  );
  const connected = (value: unknown) => {
    const text = String(value || "").toLowerCase();
    return /connected|conectado|conectada|online|pairing/.test(text) &&
      !/desconect|logged.?out/.test(text);
  };
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.instances();
      setItems(result.instances || []);
      setSelectedId((current) =>
        current && (result.instances || []).some((item) => item.id === current)
          ? current
          : result.instances?.[0]?.id || null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os perfis.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setItems(instances);
    if (!selectedId && instances[0]?.id) setSelectedId(instances[0].id);
  }, [instances, selectedId]);
  useEffect(() => {
    if (!selected) {
      setProfile(null);
      setProxy(null);
      setInstanceSettings(null);
      setInstanceStorage(null);
      setEditingName("");
      setEditingPushName("");
      setEditingStatusText("");
      setProfileImageDataUrl("");
      setRemoveProfilePhoto(false);
      return;
    }
    setEditingName(selected.name);
    setEditingPushName("");
    setEditingStatusText("");
    setProfileImageDataUrl("");
    setRemoveProfilePhoto(false);
    setLoading(true);
    void Promise.all([
      api.instanceProfile(selected.id),
      api.instanceProxy(selected.id),
      api.instanceSettings(selected.id),
    ])
      .then(([profileResult, proxyResult, settingsResult]) => {
        const nextProfile = profileResult.profile || null;
        setProfile(nextProfile);
        setEditingName(textOf(nextProfile?.displayName, selected.name));
        setEditingPushName(textOf(nextProfile?.pushName));
        setEditingStatusText(profileAboutText(nextProfile?.statusText));
        setProxy(proxyResult.proxy || null);
        setInstanceSettings(settingsResult.settings || {});
        setInstanceStorage(settingsResult.storage || null);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar os dados do perfil.",
        ),
      )
      .finally(() => setLoading(false));
  }, [selectedId, selected]);
  const action = async (name: "connect" | "logout" | "restart" | "resync") => {
    if (!selected || busy) return;
    if (name === "connect") {
      setPairOpen(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (name === "resync") await api.resyncHistory(selected.id);
      else await api.instanceAction(selected.id, name);
      setNotice(
        name === "resync"
          ? "Resincronização iniciada em segundo plano."
          : name === "logout"
            ? "Perfil desconectado."
            : name === "restart"
              ? "Perfil reiniciado."
              : "Solicitação de conexão enviada.",
      );
      await reload();
      onProfilesChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível executar a ação no perfil.",
      );
    } finally {
      setBusy(false);
    }
  };
  const profileChanged = Boolean(
    selected &&
      (editingPushName.trim() !== textOf(profile?.pushName).trim() ||
        editingStatusText.trim() !== profileAboutText(profile?.statusText).trim() ||
        profileImageDataUrl ||
        removeProfilePhoto),
  );
  const instanceToggleSource =
    instanceSettings?.commandToggles || instanceSettings?.command_toggles;
  const instanceToggles =
    instanceToggleSource && typeof instanceToggleSource === "object"
      ? (instanceToggleSource as JsonRecord)
      : {};
  const saveProfile = async () => {
    if (!selected || busy || !profileChanged) return;
    setBusy(true);
    setError("");
    try {
      const payload: JsonRecord = {};
      if (editingPushName.trim() !== textOf(profile?.pushName).trim())
        payload.pushName = editingPushName.trim();
      if (editingStatusText.trim() !== profileAboutText(profile?.statusText).trim())
        payload.statusText = editingStatusText.trim();
      if (profileImageDataUrl) payload.imageDataUrl = profileImageDataUrl;
      if (removeProfilePhoto) payload.removePhoto = true;
      const result = await api.updateInstanceProfile(selected.id, payload);
      if (result.profile) setProfile(result.profile);
      setProfileImageDataUrl("");
      setRemoveProfilePhoto(false);
      setNotice("Dados do perfil atualizados.");
      await reload();
      onProfilesChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar o perfil.",
      );
    } finally {
      setBusy(false);
    }
  };
  const toggleInstanceSetting = async (key: string, value: boolean) => {
    if (!selected || settingsSaving) return;
    const previous = instanceSettings;
    setSettingsSaving(key);
    setInstanceSettings((current) => ({
      ...(current || {}),
      commandToggles: {
        ...((current?.commandToggles as JsonRecord) || {}),
        [key]: value,
      },
    }));
    try {
      const result = await api.updateInstanceSettings(selected.id, {
        commandToggles: { [key]: value },
      });
      setInstanceSettings(result.settings || {});
      if (result.storage) setInstanceStorage(result.storage);
    } catch (cause) {
      setInstanceSettings(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar a configuração da instância.",
      );
    } finally {
      setSettingsSaving(null);
    }
  };
  const selectProfilePhoto = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Selecione uma imagem válida para a foto do perfil.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("A foto do perfil deve ter no máximo 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfileImageDataUrl(String(reader.result || ""));
      setRemoveProfilePhoto(false);
    };
    reader.onerror = () => setError("Não foi possível ler a imagem escolhida.");
    reader.readAsDataURL(file);
  };
  const profilePhone = textOf(profile?.jid).trim();
  const selectedPhone = fullPhoneText(
    profilePhone && !/@(?:lid|g\.us)$/i.test(profilePhone)
      ? profilePhone
      : selected?.phone,
  );
  return (
    <main
      className={`module profiles-workspace ${selected ? "has-selection" : ""}`}
    >
      <header className="module-header">
        <div className="module-title">
          <span>
            <ContactRound />
          </span>
          <div>
            <h1>Perfis WhatsApp</h1>
            <p>Conexões, validade e ações de cada número.</p>
          </div>
        </div>
        <div>
          <button onClick={() => void reload()} aria-label="Atualizar perfis">
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
          <button
            className="primary-action"
            onClick={() => setCreateOpen(true)}
          >
            <Plus /> Novo perfil
          </button>
        </div>
      </header>
      <div className="profiles-layout">
        <aside className="profiles-directory">
          <div className="profiles-directory-heading">
            <b>Seus perfis</b>
            <span>{items.length}</span>
          </div>
          {items.length ? (
            items.map((item) => (
              <button
                className={selectedId === item.id ? "selected" : ""}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <Avatar name={item.name} src={item.avatarUrl} small />
                <span>
                  <b>{item.name}</b>
                  <small className="profile-directory-phone">
                    {fullPhoneText(item.phone)}
                  </small>
                </span>
                <i className={connected(item.sessionStatus) ? "online" : ""} />
              </button>
            ))
          ) : (
            <div className="module-state">
              <ContactRound />
              <b>Nenhum perfil criado</b>
              <p>Crie o primeiro para conectar seu WhatsApp.</p>
            </div>
          )}
        </aside>
        <section className="profile-detail">
          {selected ? (
            <>
              <header className="profile-detail-header">
                <button
                  className="profile-mobile-back"
                  onClick={() => setSelectedId(null)}
                  aria-label="Voltar à lista"
                >
                  <ArrowLeft />
                </button>
                <Avatar name={selected.name} src={profileAvatar} small />
                <div>
                  <h2>{selected.name}</h2>
                  <p className="profile-phone-value">{selectedPhone}</p>
                </div>
                <span
                  className={`state-pill ${connected(selected.sessionStatus) ? "active" : "inactive"}`}
                >
                  {connected(selected.sessionStatus)
                    ? "Conectado"
                    : "Desconectado"}
                </span>
                <button
                  type="button"
                  className="secondary-button profile-identity-button"
                  onClick={() => setIdentityOpen(true)}
                  disabled={busy}
                >
                  <Settings /> Editar
                </button>
              </header>
              {error && (
                <div className="module-error">
                  <b>Não foi possível concluir.</b>
                  <span>{error}</span>
                </div>
              )}
              {notice && <div className="inline-notice success">{notice}</div>}
              <section className="settings-card profile-detail-card">
                <div className="settings-card-heading">
                  <div>
                    <h3>Dados do perfil</h3>
                    <p className="settings-muted">
                      Edite a identidade do WhatsApp, o recado e a foto sem
                      perder a conexão.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => void saveProfile()}
                    disabled={busy || !profileChanged}
                  >
                    <CheckSquare /> Salvar
                  </button>
                </div>
                <div className="profile-editor">
                  <div className="profile-photo-editor">
                    <Avatar
                      name={editingName || selected.name}
                      src={
                        removeProfilePhoto
                          ? ""
                          : profileImageDataUrl || profileAvatar
                      }
                    />
                    <div>
                      <b>Foto do WhatsApp</b>
                      <small>JPG, PNG ou WebP de até 5 MB.</small>
                      <span>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy || !connected(selected.sessionStatus)}
                          onClick={() => profilePhotoInput.current?.click()}
                        >
                          <Image /> Alterar foto
                        </button>
                        {(profileAvatar || profileImageDataUrl) && (
                          <button
                            className="secondary-button danger-text"
                            type="button"
                            disabled={busy || !connected(selected.sessionStatus)}
                            onClick={() => {
                              setProfileImageDataUrl("");
                              setRemoveProfilePhoto(true);
                            }}
                          >
                            <X /> Remover
                          </button>
                        )}
                      </span>
                      {!connected(selected.sessionStatus) && (
                        <small>Conecte o perfil para editar foto e recado.</small>
                      )}
                    </div>
                    <input
                      ref={profilePhotoInput}
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        selectProfilePhoto(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </div>
                  <div className="profile-editor-fields">
                    <label className="profile-name-field">
                      Nome exibido no WhatsApp
                      <input
                        value={editingPushName}
                        maxLength={80}
                        disabled={!connected(selected.sessionStatus)}
                        onChange={(event) =>
                          setEditingPushName(event.target.value)
                        }
                      />
                      <small>Nome público associado ao número conectado.</small>
                    </label>
                    <label className="profile-name-field wide">
                      Recado do WhatsApp
                      <textarea
                        rows={3}
                        value={editingStatusText}
                        maxLength={160}
                        disabled={!connected(selected.sessionStatus)}
                        onChange={(event) =>
                          setEditingStatusText(event.target.value)
                        }
                      />
                      <small>{editingStatusText.length}/160 caracteres</small>
                    </label>
                  </div>
                </div>
                <div className="profile-detail-grid">
                  <span>
                    <small>Número conectado</small>
                    <b className="profile-phone-value">{selectedPhone}</b>
                  </span>
                  <span>
                    <small>Status</small>
                    <b>{String(selected.sessionStatus || "desconectado")}</b>
                  </span>
                  <span>
                    <small>Validade</small>
                    <b>
                      {selected.expiresAt
                        ? dateText(selected.expiresAt)
                        : "Sem validade informada"}
                    </b>
                  </span>
                  <span>
                    <small>Servidor</small>
                    <b>
                      {textOf(
                        (selected as BotInstance & JsonRecord).serverName,
                        "Servidor padrão",
                      )}
                    </b>
                  </span>
                  <span>
                    <small>Proxy</small>
                    <b>
                      {proxy?.enabled
                        ? `${textOf(proxy?.host, "Proxy ativo")} · ${textOf(proxy?.regionName, "rota protegida")}`
                        : "Não configurado"}
                    </b>
                  </span>
                </div>
              </section>
              <section className="settings-card profile-actions-card">
                <h3>Ações rápidas</h3>
                <div className="profile-action-grid">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => connected(selected.sessionStatus)
                      ? void action("restart")
                      : setPairOpen(true)}
                  >
                    {connected(selected.sessionStatus) ? (
                      <RefreshCw />
                    ) : (
                      <KeyRound />
                    )}
                    {connected(selected.sessionStatus)
                      ? "Reiniciar conexão"
                      : "Conectar WhatsApp"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || !connected(selected.sessionStatus)}
                    onClick={() => void action("logout")}
                  >
                    <LogOut /> Desconectar
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || !connected(selected.sessionStatus)}
                    onClick={() => void action("resync")}
                  >
                    <RefreshCw /> Resincronizar histórico
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setRenewOpen(true)}
                  >
                    <BadgeDollarSign /> Renovar perfil
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setProxyOpen(true)}
                  >
                    <ShieldCheck /> {proxy?.enabled ? "Editar proxy" : "Adicionar proxy"}
                  </button>
                </div>
              </section>
              <section className="settings-card profile-instance-settings-card">
                <div className="settings-card-heading">
                  <div>
                    <h3>Configurações da instância</h3>
                    <p className="settings-muted">Automações e armazenamento pertencem ao perfil selecionado.</p>
                  </div>
                  {instanceSettings === null && <RefreshCw className="spin" />}
                </div>
                {instanceSettings && (
                  <div className="settings-toggles">
                    {settingsToggleLabels.map(([key, label, description]) => (
                      <label className="settings-toggle" key={key}>
                        <span><b>{label}</b><small>{description}</small></span>
                        <input
                          type="checkbox"
                          checked={Boolean(instanceToggles[key])}
                          disabled={settingsSaving !== null}
                          onChange={(event) => void toggleInstanceSetting(key, event.target.checked)}
                        />
                        <i aria-hidden="true" />
                      </label>
                    ))}
                  </div>
                )}
                {instanceStorage && (
                  <small className="settings-storage">
                    Armazenamento: {storageSize(instanceStorage.usedBytes)} de {storageSize(instanceStorage.quotaBytes)}
                  </small>
                )}
              </section>
              {loading && (
                <div className="settings-loading">
                  <RefreshCw className="spin" /> Atualizando dados…
                </div>
              )}
              <p className="settings-muted profile-safety-note">
                Ações de conexão são idempotentes. O histórico pode ser
                resincronizado sem desconectar o número.
              </p>
            </>
          ) : (
            <div className="module-state profile-empty-detail">
              <ContactRound />
              <b>Selecione um perfil</b>
              <p>
                As configurações e ações aparecerão aqui, mantendo sua lista
                aberta.
              </p>
            </div>
          )}
        </section>
      </div>
      {createOpen && (
        <ProfileCreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void reload();
            onProfilesChanged?.();
          }}
        />
      )}
      {renewOpen && selected && (
        <ProfileRenewModal
          instance={selected}
          onClose={() => setRenewOpen(false)}
          onDone={() => {
            setNotice(
              "Pagamento gerado. A validade será atualizada após a aprovação.",
            );
          }}
        />
      )}
      {proxyOpen && selected && (
        <InstanceProxyModal
          instance={selected}
          onClose={() => setProxyOpen(false)}
          onSaved={(nextProxy) => {
            setProxy(nextProxy);
            setNotice("Proxy salvo e aplicado com reinício seguro da conexão.");
          }}
        />
      )}
      {identityOpen && selected && (
        <InstanceIdentityModal
          instance={selected}
          onClose={() => setIdentityOpen(false)}
          onSaved={(result) => {
            setIdentityOpen(false);
            if (result.instance) {
              setItems((current) => current.map((item) =>
                item.id === selected.id ? { ...item, ...result.instance } : item,
              ));
            }
            setNotice(result.phoneChanged || result.pairingRequired
              ? "Número atualizado. A sessão antiga foi desconectada; gere o novo pareamento para conectar o WhatsApp."
              : "Identidade da instância atualizada.");
            void reload();
            onProfilesChanged?.();
            if (result.phoneChanged || result.pairingRequired) setPairOpen(true);
          }}
        />
      )}
      {pairOpen && selected && (
        <PairingModal
          instance={selected}
          onClose={() => setPairOpen(false)}
          onUpdated={() => {
            void reload();
            onProfilesChanged?.();
          }}
        />
      )}
    </main>
  );
}

// Kept as a compatibility fallback while the production-shaped workspace is
// rendered below. The Flutter-aligned implementation lives in its own module.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyBroadcastWorkspace({
  selectedInstance,
}: {
  selectedInstance: number | null;
}) {
  const [lists, setLists] = useState<JsonRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [media, setMedia] = useState<JsonRecord | null>(null);
  const [typing, setTyping] = useState(true);
  const [minDelay, setMinDelay] = useState("30000");
  const [maxDelay, setMaxDelay] = useState("60000");
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [quietHours, setQuietHours] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [variants, setVariants] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const meta = sectionMeta.broadcasts;
  const loadLists = useCallback(async () => {
    if (!selectedInstance) {
      setLists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.broadcastLists(selectedInstance);
      const next = firstArray(result, ["lists", "items"]);
      setLists(next);
      setSelectedId((current) =>
        current && next.some((item) => String(item.id) === current)
          ? current
          : next[0]?.id
            ? String(next[0].id)
            : null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as listas.",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedInstance]);
  const openList = useCallback(
    async (id: string) => {
      if (!selectedInstance) return;
      setSelectedId(id);
      setLoadingDetail(true);
      setError("");
      try {
        const result = await api.broadcastList(selectedInstance, id);
        setDetail(result);
        const template = firstArray(result, ["templates"])[0];
        if (template) {
          setBody(String(template.body || ""));
          setTemplateName(String(template.name || ""));
          setMedia(
            ((template.payload as JsonRecord | undefined)
              ?.media as JsonRecord) || null,
          );
        } else {
          setBody("");
          setTemplateName("");
          setMedia(null);
        }
      } catch (cause) {
        setDetail(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível abrir a lista.",
        );
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectedInstance],
  );
  useEffect(() => {
    void loadLists();
  }, [loadLists]);
  useEffect(() => {
    if (selectedId) void openList(selectedId);
    else setDetail(null);
  }, [selectedId, openList]);
  const list = (detail?.list || {}) as JsonRecord;
  const contacts = firstArray(detail, ["contacts"]);
  const schedules = firstArray(detail, ["schedules"]);
  const runs = firstArray(detail, ["runs"]);
  const payload = () => {
    const values = variants
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    const minimum = Math.max(30000, Number(minDelay) || 30000);
    return {
      body: body.trim(),
      typingEnabled: typing,
      minDelayMs: minimum,
      maxDelayMs: Math.max(minimum, Number(maxDelay) || 60000),
      ...(media ? { media } : {}),
      ...(values.length > 1 ? { messageVariants: values } : {}),
      ...(quietHours
        ? {
            quietHours: {
              enabled: true,
              start: quietStart,
              end: quietEnd,
              timezone:
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                "America/Sao_Paulo",
            },
          }
        : {}),
    } as JsonRecord;
  };
  const saveTemplate = async () => {
    if (!selectedInstance || !selectedId || (!body.trim() && !media) || busy)
      return;
    setBusy(true);
    try {
      await api.broadcastTemplates(selectedInstance, selectedId, {
        name: templateName.trim() || "Mensagem salva",
        body: body.trim(),
        payload: media ? { media } : {},
      });
      setNotice("Mensagem salva para reutilização.");
      await openList(selectedId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o modelo.",
      );
    } finally {
      setBusy(false);
    }
  };
  const dispatch = async (scheduled: boolean) => {
    if (!selectedInstance || !selectedId || (!body.trim() && !media) || busy)
      return;
    if (scheduled && !scheduledAt) {
      setError("Escolha o horário da transmissão.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = payload();
      if (scheduled) {
        await api.scheduleBroadcast(selectedInstance, selectedId, {
          ...data,
          scheduledAt,
          recurrenceMinutes: Number(recurrence) || undefined,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "America/Sao_Paulo",
        });
        setNotice("Transmissão agendada com sucesso.");
      } else {
        await api.sendBroadcast(selectedInstance, selectedId, data);
        setNotice("Transmissão iniciada em segundo plano.");
      }
      await openList(selectedId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível iniciar a transmissão.",
      );
    } finally {
      setBusy(false);
    }
  };
  const addContacts = async () => {
    if (!selectedInstance || !selectedId) return;
    const raw = window.prompt(
      "Números separados por vírgula ou quebra de linha:",
      "",
    );
    if (!raw?.trim()) return;
    const entries = raw
      .split(/[\n,;]+/)
      .map((phone) => phone.replace(/\D/g, ""))
      .filter(Boolean)
      .map((phone) => ({ phone }));
    if (!entries.length) return;
    setBusy(true);
    try {
      await api.broadcastContacts(selectedInstance, selectedId, {
        contacts: entries,
      });
      setNotice(`${entries.length} contato(s) adicionado(s).`);
      await openList(selectedId);
      await loadLists();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível adicionar os contatos.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteList = async () => {
    if (
      !selectedInstance ||
      !selectedId ||
      !window.confirm("Apagar esta lista, modelos e agendamentos?")
    )
      return;
    setBusy(true);
    try {
      await api.deleteBroadcastList(selectedInstance, selectedId);
      setSelectedId(null);
      setDetail(null);
      setNotice("Lista apagada.");
      await loadLists();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível apagar a lista.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="module broadcast-workspace">
      <header className="module-header">
        <div className="module-title">
          <span>
            <RadioTower />
          </span>
          <div>
            <h1>{meta.title}</h1>
            <p>Listas, modelos, agendamentos e acompanhamento dos envios.</p>
          </div>
        </div>
        <div>
          <button
            onClick={() => void loadLists()}
            aria-label="Atualizar listas"
          >
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
          <button
            className="primary-action"
            onClick={() => setCreateOpen(true)}
            disabled={!selectedInstance}
          >
            <Plus /> Nova lista
          </button>
        </div>
      </header>
      {!selectedInstance ? (
        <div className="module-state">
          <RadioTower />
          <b>Conecte um perfil para usar transmissões.</b>
        </div>
      ) : (
        <div className="broadcast-layout">
          <aside className="broadcast-lists">
            <div className="broadcast-pane-heading">
              <b>Suas listas</b>
              <span>{lists.length}</span>
            </div>
            {loading && !lists.length ? (
              <div className="list-state">
                <RefreshCw className="spin" /> Carregando…
              </div>
            ) : lists.length ? (
              lists.map((item, index) => (
                <button
                  key={String(item.id || index)}
                  className={selectedId === String(item.id) ? "selected" : ""}
                  onClick={() => void openList(String(item.id))}
                >
                  <span className="data-icon">
                    <UsersRound />
                  </span>
                  <span>
                    <b>{String(item.name || `Lista ${index + 1}`)}</b>
                    <small>
                      {Number(item.contactCount || item.contactsCount || 0)}{" "}
                      destinatário(s)
                    </small>
                  </span>
                  <em>{String(item.lastRunStatus || "")}</em>
                </button>
              ))
            ) : (
              <div className="list-state">Nenhuma lista criada.</div>
            )}
          </aside>
          <section className="broadcast-detail">
            {loadingDetail ? (
              <div className="module-state">
                <RefreshCw className="spin" />
                <b>Carregando lista…</b>
              </div>
            ) : !detail ? (
              <div className="module-state">
                <RadioTower />
                <b>Selecione uma lista para abrir a transmissão.</b>
              </div>
            ) : (
              <>
                <header className="broadcast-detail-header">
                  <div>
                    <h2>{String(list.name || "Lista de transmissão")}</h2>
                    <p>
                      {String(list.description || "Sem descrição")} ·{" "}
                      {contacts.length} destinatário(s)
                    </p>
                  </div>
                  <div className="broadcast-detail-actions">
                    <button
                      className="secondary-button"
                      onClick={addContacts}
                      disabled={busy}
                    >
                      <UserPlus /> Contatos
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void deleteList()}
                      disabled={busy}
                    >
                      <X /> Apagar lista
                    </button>
                  </div>
                </header>
                <div className="broadcast-stats">
                  <span>
                    <b>{contacts.length}</b> destinatários
                  </span>
                  <span>
                    <b>
                      {
                        schedules.filter(
                          (item) => String(item.status) === "pending",
                        ).length
                      }
                    </b>{" "}
                    agendamentos
                  </span>
                  <span>
                    <b>{runs.length ? String(runs[0].sent || 0) : "0"}</b>{" "}
                    enviados
                  </span>
                </div>
                <section className="broadcast-composer settings-card">
                  <div className="settings-card-heading">
                    <div>
                      <h3>Mensagem da transmissão</h3>
                      <p className="settings-muted">
                        Salve modelos e use variações para não repetir o mesmo
                        texto.
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => void saveTemplate()}
                      disabled={busy || (!body.trim() && !media)}
                    >
                      <CheckSquare /> Salvar modelo
                    </button>
                  </div>
                  <input
                    className="broadcast-template-name"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="Nome do modelo (opcional)"
                  />
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="Digite a mensagem que será enviada…"
                    rows={5}
                  />
                  <div className="broadcast-composer-row">
                    <label className="secondary-button">
                      <Paperclip />{" "}
                      {media
                        ? String(media.fileName || "Mídia selecionada")
                        : "Adicionar mídia"}
                      <input
                        type="file"
                        hidden
                        accept="image/*,video/*,audio/*"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (!file || !selectedInstance || !selectedId) return;
                          setBusy(true);
                          try {
                            const result = await api.uploadBroadcastMedia(
                              selectedInstance,
                              selectedId,
                              file,
                              file.type.startsWith("video")
                                ? "video"
                                : file.type.startsWith("audio")
                                  ? "audio"
                                  : "image",
                            );
                            setMedia((result.media || result) as JsonRecord);
                            setNotice("Mídia pronta para transmissão.");
                          } catch (cause) {
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "Não foi possível enviar a mídia.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    </label>
                    <label className="settings-inline-toggle">
                      <input
                        type="checkbox"
                        checked={typing}
                        onChange={(event) => setTyping(event.target.checked)}
                      />{" "}
                      Simular digitação
                    </label>
                  </div>
                  <label className="broadcast-label">
                    Variações do mesmo modelo
                    <textarea
                      value={variants}
                      onChange={(event) => setVariants(event.target.value)}
                      rows={2}
                      placeholder="Uma variação por linha (opcional)"
                    />
                  </label>
                  <div className="broadcast-delay-grid">
                    <label>
                      Delay mínimo (ms)
                      <input
                        inputMode="numeric"
                        value={minDelay}
                        onChange={(event) =>
                          setMinDelay(event.target.value.replace(/\D/g, ""))
                        }
                      />
                    </label>
                    <label>
                      Delay máximo (ms)
                      <input
                        inputMode="numeric"
                        value={maxDelay}
                        onChange={(event) =>
                          setMaxDelay(event.target.value.replace(/\D/g, ""))
                        }
                      />
                    </label>
                    <label className="settings-inline-toggle">
                      <input
                        type="checkbox"
                        checked={quietHours}
                        onChange={(event) =>
                          setQuietHours(event.target.checked)
                        }
                      />{" "}
                      Pausa noturna
                    </label>
                    {quietHours && (
                      <>
                        <label>
                          Início
                          <input
                            type="time"
                            value={quietStart}
                            onChange={(event) =>
                              setQuietStart(event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Fim
                          <input
                            type="time"
                            value={quietEnd}
                            onChange={(event) =>
                              setQuietEnd(event.target.value)
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <div className="broadcast-actions">
                    <button
                      className="primary-button"
                      disabled={busy || (!body.trim() && !media)}
                      onClick={() => void dispatch(false)}
                    >
                      <Send /> {busy ? "Processando…" : "Iniciar agora"}
                    </button>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                    />
                    <input
                      className="recurrence-input"
                      inputMode="numeric"
                      value={recurrence}
                      onChange={(event) =>
                        setRecurrence(event.target.value.replace(/\D/g, ""))
                      }
                      placeholder="Recorrência (min)"
                    />
                    <button
                      className="secondary-button"
                      disabled={
                        busy || !scheduledAt || (!body.trim() && !media)
                      }
                      onClick={() => void dispatch(true)}
                    >
                      <RadioTower /> Agendar
                    </button>
                  </div>
                </section>
                <section className="broadcast-history settings-card">
                  <div className="settings-card-heading">
                    <h3>Agendamentos e histórico</h3>
                    <span className="state-pill">
                      {runs.length
                        ? String(runs[0].status || "queued")
                        : "sem envios"}
                    </span>
                  </div>
                  {schedules.length ? (
                    schedules.slice(0, 8).map((item, index) => (
                      <div
                        className="broadcast-history-row"
                        key={String(item.id || index)}
                      >
                        <span>
                          <b>{dateText(item.scheduledFor)}</b>
                          <small>{String(item.body || "Mídia")}</small>
                        </span>
                        <strong>{String(item.status || "pending")}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="settings-muted">
                      Nenhum agendamento nesta lista.
                    </p>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
      )}
      {notice && <div className="inline-notice success">{notice}</div>}
      {error && (
        <div className="module-error">
          <b>Não foi possível concluir.</b>
          <span>{error}</span>
        </div>
      )}
      {createOpen && (
        <ModuleCreateModal
          section="broadcasts"
          selectedInstance={selectedInstance}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void loadLists();
          }}
        />
      )}
    </main>
  );
}

function GenericModuleWorkspace({
  section,
  instances,
  selectedInstance,
  onManageInstance,
  onProfilesChanged,
}: {
  section: Section;
  instances: BotInstance[];
  selectedInstance: number | null;
  onManageInstance?: (id: number) => void;
  onProfilesChanged?: () => void;
}) {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<JsonRecord | null>(null);
  const meta = sectionMeta[section];
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result =
        section === "broadcasts" && selectedInstance
          ? await api.broadcastLists(selectedInstance)
          : section === "status"
            ? await api.status()
            : section === "flows"
              ? await api.flows()
              : section === "raffles"
                ? await api.raffles()
                : section === "calls" && selectedInstance
                  ? await api.calls(selectedInstance)
                  : section === "media"
                    ? await api.mediaPlans()
                    : section === "groups" ||
                        section === "channels" ||
                        section === "communities"
                      ? await api.botGroups()
                      : section === "payments"
                        ? await api.charges()
                        : section === "store" && selectedInstance
                          ? await api.store(selectedInstance)
                          : section === "affiliates"
                            ? await api.affiliate()
                            : section === "campaigns"
                              ? await api.campaigns()
                              : {};
      setData(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível carregar.",
      );
    } finally {
      setLoading(false);
    }
  }, [section, selectedInstance]);
  useEffect(() => {
    void load();
  }, [load]);
  const items = arrayFrom(data).filter((item) => {
    if (section === "channels")
      return String(item.chatType || item.type || "")
        .toLowerCase()
        .includes("channel");
    if (section === "communities")
      return String(item.chatType || item.type || "")
        .toLowerCase()
        .includes("communit");
    if (section === "groups")
      return (
        !String(item.chatType || item.type || "")
          .toLowerCase()
          .includes("channel") &&
        !String(item.chatType || item.type || "")
          .toLowerCase()
          .includes("communit")
      );
    return true;
  });
  const Icon = meta.icon;
  const profileAction = async (
    instance: BotInstance,
    action: "logout" | "restart" | "resync",
  ) => {
    if (profileBusy) return;
    setProfileBusy(instance.id);
    setError("");
    try {
      if (action === "resync") await api.resyncHistory(instance.id);
      else await api.instanceAction(instance.id, action);
      await load();
      onProfilesChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível executar a ação no perfil.",
      );
    } finally {
      setProfileBusy(null);
    }
  };
  const canCreate = ["broadcasts", "flows", "raffles", "profiles"].includes(
    section,
  );
  return (
    <main className="module">
      <header className="module-header">
        <div className="module-title">
          <span>
            <Icon />
          </span>
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>
        </div>
        <div>
          <button onClick={() => void load()} aria-label="Atualizar">
            <RefreshCw className={loading ? "spin" : ""} />
          </button>
          {canCreate && (
            <button
              className="primary-action"
              onClick={() => setCreateOpen(true)}
            >
              <Plus /> {section === "profiles" ? "Novo perfil" : "Novo"}
            </button>
          )}
        </div>
      </header>
      {section === "profiles" && (
        <div className="profile-grid">
          {instances.map((instance) => (
            <article className="profile-card" key={instance.id}>
              <div>
                <Avatar name={instance.name} src={instance.avatarUrl} />
                <span
                  className={
                    instance.sessionStatus === "conectado"
                      ? "status-dot online"
                      : "status-dot"
                  }
                />
              </div>
              <h3>{instance.name}</h3>
              <p>{instance.phone || "Número ainda não informado"}</p>
              <b
                className={
                  instance.sessionStatus === "conectado"
                    ? "connected"
                    : "disconnected"
                }
              >
                {instance.sessionStatus === "conectado"
                  ? "Conectado"
                  : "Desconectado"}
              </b>
              <button onClick={() => onManageInstance?.(instance.id)}>
                Gerenciar perfil
              </button>
              <div className="profile-actions">
                <button
                  disabled={profileBusy === instance.id}
                  onClick={() =>
                    void profileAction(
                      instance,
                      instance.sessionStatus === "conectado"
                        ? "logout"
                        : "restart",
                    )
                  }
                >
                  {profileBusy === instance.id
                    ? "Aguarde…"
                    : instance.sessionStatus === "conectado"
                      ? "Desconectar"
                      : "Reconectar"}
                </button>
                <button
                  disabled={profileBusy === instance.id}
                  onClick={() => void profileAction(instance, "resync")}
                >
                  Resincronizar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {section !== "profiles" && loading && !data && (
        <div className="module-state">
          <RefreshCw className="spin" />
          <b>Carregando {meta.title.toLocaleLowerCase("pt-BR")}…</b>
        </div>
      )}
      {error && (
        <div className="module-error">
          <b>Não foi possível carregar esta área.</b>
          <span>{error}</span>
          <button onClick={() => void load()}>Tentar novamente</button>
        </div>
      )}
      {!loading &&
        !error &&
        section !== "profiles" &&
        (items.length ? (
          <div className="data-grid">
            {items.slice(0, 120).map((item, index) => (
              <article
                key={String(item.id || index)}
                className="actionable-card"
                tabIndex={0}
                role="button"
                onClick={() => setSelectedItem(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedItem(item);
                  }
                }}
              >
                {String(item.imageUrl || item.avatarUrl || "") ? (
                  <Avatar
                    name={moduleItemTitle(section, item, index)}
                    src={String(item.imageUrl || item.avatarUrl || "")}
                    small
                  />
                ) : (
                  <span className="data-icon">
                    <Icon />
                  </span>
                )}
                <div>
                  <h3>{moduleItemTitle(section, item, index)}</h3>
                  <p>{moduleItemSubtitle(section, item)}</p>
                  {section === "groups" && (
                    <span
                      className={`group-bot-status ${String(item.status || "active") === "active" ? "is-active" : ""}`}
                    >
                      <Bot /> {String(item.status || "active") === "active" ? "Robô ativo" : "Robô desligado"}
                    </span>
                  )}
                </div>
                <button
                  className="card-menu-button"
                  aria-label={section === "groups" ? "Configurar robô do grupo" : "Abrir detalhes"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedItem(item);
                  }}
                >
                  <MoreVertical />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="module-state">
            <span className="large-icon">
              <Icon />
            </span>
            <b>Nenhum item encontrado</b>
            <p>
              {canCreate
                ? "Use o botão “Novo” para começar."
                : "Esta área será atualizada em tempo real quando houver dados."}
            </p>
          </div>
        ))}
      {createOpen &&
        (section === "profiles" ? (
          <ProfileCreateModal
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              setCreateOpen(false);
              void load();
              onProfilesChanged?.();
            }}
          />
        ) : (
          <ModuleCreateModal
            section={section}
            selectedInstance={selectedInstance}
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              setCreateOpen(false);
              void load();
            }}
          />
        ))}
      {selectedItem && (
        section === "groups" ? (
          <BotGroupAutomationModal
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onChanged={() => void load()}
          />
        ) : (
          <ModuleItemDetailsModal
            section={section}
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onChanged={() => void load()}
          />
        )
      )}
    </main>
  );
}

function ModuleWorkspace(props: {
  section: Section;
  instances: BotInstance[];
  selectedInstance: number | null;
  user: SessionUser;
  onManageInstance?: (id: number) => void;
  onProfilesChanged?: () => void;
  onUserChanged?: (user: SessionUser) => void;
}) {
  if (props.section === "settings")
    return (
      <SettingsWorkspace
        user={props.user}
        onUserChanged={props.onUserChanged}
      />
    );
  if (props.section === "api" || props.section === "webhooks")
    return <ApiWorkspace />;
  if (props.section === "broadcasts")
    return (
      <ProductionBroadcastWorkspace selectedInstance={props.selectedInstance} />
    );
  if (props.section === "profiles")
    return (
      <ProfilesWorkspace
        instances={props.instances}
        onProfilesChanged={props.onProfilesChanged}
      />
    );
  if (props.section === "raffles") return <RafflesWorkspace />;
  if (props.section === "affiliates") return <AffiliatesWorkspace />;
  if (props.section === "payments") return <PaymentsWorkspace />;
  if (["status", "media", "calls", "store"].includes(props.section))
    return (
      <RichModuleWorkspace
        section={props.section}
        selectedInstance={props.selectedInstance}
      />
    );
  return (
    <GenericModuleWorkspace
      section={props.section}
      instances={props.instances}
      selectedInstance={props.selectedInstance}
      onManageInstance={props.onManageInstance}
      onProfilesChanged={props.onProfilesChanged}
    />
  );
}

function ProfileCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [servers, setServers] = useState<
    Array<{ id: number; name: string; sessionLimit?: number }>
  >([]);
  const [snapshot, setSnapshot] = useState<JsonRecord | null>(null);
  const [serverId, setServerId] = useState("");
  const [name, setName] = useState("");
  const [ddi, setDdi] = useState("55");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState(0);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdInstanceId, setCreatedInstanceId] = useState(0);
  const [checkout, setCheckout] = useState<JsonRecord | null>(null);
  useEffect(() => {
    Promise.all([api.botServers(), api.planMobile()])
      .then(([serverResult, planResult]) => {
        setServers(serverResult.servers || []);
        if (serverResult.servers?.[0])
          setServerId(String(serverResult.servers[0].id));
        setSnapshot(planResult);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar planos e servidores.",
    ),
  );
  }, []);
  const plans = firstArray(snapshot, ["plans"]).filter(
    (item) =>
      Number(item.id) > 0 && item.isActive !== false && item.active !== false,
  );
  const methods = firstArray(snapshot, ["paymentMethods"]);
  const providers = [
    "mercadopago_pix",
    "polopag_pix",
    "mercadopago_checkout",
  ].filter((key) => {
    const item = methods.find((method) => textOf(method.provider) === key);
    return Boolean(
      item &&
      (item.available === true ||
        item.canCharge === true ||
        (item.isActive !== false && item.isConfigured !== false)),
    );
  });
  const profileSlots = (snapshot?.profileSlots || {}) as JsonRecord;
  const freeSlot = Number(profileSlots.available || 0) > 0;
  useEffect(() => {
    if (!planId && plans[0]?.id) setPlanId(Number(plans[0].id));
    if (!provider && providers[0]) setProvider(providers[0]);
  }, [planId, plans, provider, providers]);
  const createCheckout = async (instanceId: number) => {
    if (!planId || !provider) {
      throw new Error(
        "Escolha um plano e uma forma de pagamento para liberar o perfil.",
      );
    }
    const result = await api.createPlanCheckout({
      planId,
      provider,
      context: { mode: "instance_creation", instanceId },
    });
    setCheckout((result.checkout || result) as JsonRecord);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!serverId || !phone.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (createdInstanceId) {
        await createCheckout(createdInstanceId);
        return;
      }
      const result = await api.createInstance({
        serverId: Number(serverId),
        phone: `${ddi.replace(/\D/g, "")}${phone.replace(/\D/g, "")}`,
        name: name.trim() || undefined,
      });
      if (!result.instance?.id)
        throw new Error("Perfil criado sem identificação.");
      if (
        result.requiresProfilePayment ||
        result.requiresInstanceAddonPayment
      ) {
        setCreatedInstanceId(result.instance.id);
        await createCheckout(result.instance.id);
      } else {
        onCreated();
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar o perfil.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="quick-modal module-create-modal" onSubmit={submit}>
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Novo perfil WhatsApp</h2>
              <InfoTip label="Novo perfil WhatsApp">
                Informe o número que será conectado e escolha um plano quando a criação não for gratuita.
              </InfoTip>
            </div>
            <small>Crie o perfil e conecte por QR Code ou código.</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        {checkout ? (
          <div className="profile-checkout-result">
            <b>Perfil criado · pagamento pendente</b>
            <p>
              Conclua o pagamento para liberar este perfil. A confirmação
              atualizará a validade automaticamente.
            </p>
            {Boolean(checkout.qrCodeBase64) && (
              <img
                className="profile-payment-qr"
                src={`data:image/png;base64,${textOf(checkout.qrCodeBase64)}`}
                alt="QR Code Pix"
              />
            )}
            {Boolean(checkout.qrCode) && (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void navigator.clipboard.writeText(textOf(checkout.qrCode))
                }
              >
                <Copy /> Copiar Pix copia e cola
              </button>
            )}
            {Boolean(
              checkout.ticketUrl || checkout.checkoutUrl || checkout.initPoint,
            ) && (
              <a
                className="primary-button"
                href={textOf(
                  checkout.ticketUrl ||
                    checkout.checkoutUrl ||
                    checkout.initPoint,
                )}
                target="_blank"
                rel="noreferrer"
              >
                Abrir pagamento
              </a>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={onCreated}
            >
              Concluir depois
            </button>
          </div>
        ) : (
          <div className="quick-form profile-create-form">
            <label>
              Nome do perfil (opcional)
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Atendimento, Loja, Suporte"
              />
            </label>
            <label>
              WhatsApp (DDI + número)
              <span className="profile-phone-row">
                <input
                  required
                  value={ddi}
                  onChange={(event) =>
                    setDdi(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="55"
                  inputMode="numeric"
                  aria-label="DDI"
                />
                <input
                  required
                  value={phone}
                  onChange={(event) =>
                    setPhone(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="11999999999"
                  inputMode="tel"
                  aria-label="Número do WhatsApp"
                />
              </span>
            </label>
            {servers.length > 1 && (
              <label>
                Servidor
                <select
                  required
                  value={serverId}
                  onChange={(event) => setServerId(event.target.value)}
                >
                  <option value="">Selecione um servidor</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                      {server.sessionLimit
                        ? ` · limite ${server.sessionLimit}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {snapshot ? (
              <section className="profile-payment-block">
                <b>
                  {freeSlot
                    ? "Criação gratuita disponível"
                    : "Pagamento do perfil"}
                </b>
                {freeSlot ? (
                  <p>
                    Você possui um perfil disponível. Nenhum pagamento será
                    necessário.
                  </p>
                ) : (
                  <>
                    <label>
                      Plano do perfil
                      <select
                        value={planId || ""}
                        onChange={(event) =>
                          setPlanId(Number(event.target.value))
                        }
                      >
                        <option value="">Selecione um plano</option>
                        {plans.map((plan) => (
                          <option key={textOf(plan.id)} value={textOf(plan.id)}>
                            {textOf(plan.name, "Plano")} · {money(plan.price)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Forma de pagamento
                      <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value)}
                      >
                        {providers.map((key) => (
                          <option key={key} value={key}>
                            {key === "mercadopago_pix"
                              ? "Mercado Pago · Pix"
                              : key === "polopag_pix"
                                ? "PoloPag · Pix"
                                : "Mercado Pago · Checkout"}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!plans.length && <p>Nenhum plano ativo disponível.</p>}
                    {plans.length > 0 && !providers.length && (
                      <p>Nenhuma forma de pagamento disponível.</p>
                    )}
                  </>
                )}
              </section>
            ) : (
              <div className="settings-loading">
                <RefreshCw className="spin" /> Carregando planos…
              </div>
            )}
            {error && <div className="form-error">{error}</div>}
            <button
              className="primary-button"
              disabled={
                busy ||
                !serverId ||
                !ddi.trim() ||
                !phone.trim() ||
                (!freeSlot && (!planId || !provider))
              }
            >
              {busy
                ? "Criando…"
                : createdInstanceId
                  ? "Gerar pagamento"
                  : freeSlot
                    ? "Criar gratuitamente"
                    : "Criar perfil e pagar"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function InternalGroupLinksModal({
  thread,
  onClose,
  onCopy,
  onRotate,
}: {
  thread: ConversationThread;
  onClose: () => void;
  onCopy: () => void;
  onRotate: () => void;
}) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const id = String(thread.chatJid).replace("internal:", "");
    api
      .internalGroup(id)
      .then((result) =>
        setLink(
          String((result.group as JsonRecord | undefined)?.inviteUrl || ""),
        ),
      )
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar o convite.",
        ),
      )
      .finally(() => setLoading(false));
  }, [thread.chatJid]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="quick-modal link-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Link do grupo</h2>
              <InfoTip label="Link do grupo">
                Copie o convite atual ou gere outro. Ao revogar, o endereço anterior deixa de funcionar.
              </InfoTip>
            </div>
            <small>{thread.title}</small>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="quick-form">
          <p className="settings-muted">
            Compartilhe este endereço para convidar membros. O link antigo pode
            ser revogado a qualquer momento.
          </p>
          {loading ? (
            <div className="settings-loading">
              <RefreshCw className="spin" /> Carregando link…
            </div>
          ) : error ? (
            <div className="form-error">
              Não foi possível carregar o link agora.
            </div>
          ) : (
            <>
              <div className="copy-row">
                <code>{link || "Link privado indisponível"}</code>
                <button
                  disabled={!link}
                  onClick={() => {
                    void copyText(normalizePublicLink(link)).then((copied) => {
                      if (copied) onCopy();
                    });
                  }}
                >
                  <Copy /> Copiar
                </button>
              </div>
              <button
                className="secondary-button"
                disabled={!link}
                onClick={async () => {
                  const publicLink = normalizePublicLink(link);
                  try {
                    if (navigator.share) {
                      await navigator.share({
                        title: thread.title,
                        text: `Convite para o grupo ${thread.title} no BotAdmin`,
                        url: publicLink,
                      });
                      onCopy();
                      return;
                    }
                    if (await copyText(publicLink)) onCopy();
                  } catch (cause) {
                    // Closing/canceling the native share sheet is not an error.
                    if ((cause as DOMException)?.name !== "AbortError") {
                      setError("Não foi possível compartilhar o convite.");
                    }
                  }
                }}
              >
                <Send /> Compartilhar convite
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Revogar o link atual e gerar outro? O endereço antigo deixará de funcionar.",
                    )
                  )
                    onRotate();
                }}
              >
                <RefreshCw /> Revogar e gerar novo link
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function InternalGroupSettingsModal({
  thread,
  onClose,
  onUpdated,
}: {
  thread: ConversationThread;
  onClose: () => void;
  onUpdated: (group: JsonRecord) => void;
}) {
  const groupId = String(thread.chatJid).replace("internal:", "");
  const [group, setGroup] = useState<JsonRecord | null>(null);
  const [botSettings, setBotSettings] = useState<JsonRecord | null>(null);
  const [name, setName] = useState(thread.title);
  const [description, setDescription] = useState("");
  const [botName, setBotName] = useState("BotAdmin");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [configuring, setConfiguring] =
    useState<GroupActivationDefinition | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await api.internalGroup(groupId);
      const next = (result.group || {}) as JsonRecord;
      setGroup(next);
      setName(String(next.name || thread.title));
      setDescription(String(next.description || ""));
      setBotName(String(next.botName || "BotAdmin"));
      const botGroupId = Number(next.botGroupId || 0);
      if (botGroupId) {
        const settingsResult = await api.botGroupSettings(botGroupId);
        setBotSettings((settingsResult.settings || {}) as JsonRecord);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as configurações.",
      );
    }
  }, [groupId, thread.title]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggleValues: Array<[string, string, string]> = [
    [
      "membersCanSend",
      "Permitir novas mensagens",
      "Quando desligado, somente admins podem escrever.",
    ],
    [
      "membersCanAdd",
      "Permitir adicionar membros",
      "Membros poderão convidar novas pessoas.",
    ],
    [
      "approvalRequired",
      "Aprovar novos membros",
      "Entradas por convite ficam pendentes até aprovação.",
    ],
    [
      "adminsCanEdit",
      "Admins podem editar o grupo",
      "Permite que administradores alterem configurações.",
    ],
    [
      "membersCanStartPv",
      "Membros podem iniciar PV",
      "Permite conversar individualmente com outro membro.",
    ],
  ];
  const valueFor = (key: string) => Boolean(group?.[key]);
  const saveCommand = async (
    definition: GroupActivationDefinition,
    value: boolean,
  ) => {
    if (saving || !group?.botGroupId) return;
    const previous = botSettings;
    const currentSettings = botSettings || {};
    setBotSettings(
      optimisticActivationSettings(currentSettings, definition, value),
    );
    setSaving(`command:${definition.key}`);
    setError("");
    try {
      const result = await api.updateBotGroupSettings(
        Number(group.botGroupId),
        activationPayload(currentSettings, definition, value),
      );
      setBotSettings(
        (result.settings ||
          optimisticActivationSettings(
            currentSettings,
            definition,
            value,
          )) as JsonRecord,
      );
      if (definition.key === "bemvindo") {
        const groupResult = await api.updateInternalGroup(groupId, {
          welcomeEnabled: value,
        });
        const nextGroup = (groupResult.group || group) as JsonRecord;
        setGroup(nextGroup);
        onUpdated(nextGroup);
      }
    } catch (cause) {
      setBotSettings(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar a ativação.",
      );
    } finally {
      setSaving(null);
    }
  };
  const saveToggle = async (key: string, value: boolean) => {
    if (saving) return;
    const previous = group;
    setGroup((current) => ({ ...(current || {}), [key]: value }));
    setSaving(key);
    setError("");
    try {
      const result = await api.updateInternalGroup(groupId, { [key]: value });
      const next = (result.group || {}) as JsonRecord;
      setGroup(next);
      onUpdated(next);
      if (key === "botEnabled" && value && next.botGroupId) {
        const settingsResult = await api
          .botGroupSettings(Number(next.botGroupId))
          .catch(() => null);
        if (settingsResult?.settings)
          setBotSettings(settingsResult.settings as JsonRecord);
      }
    } catch (cause) {
      setGroup(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar esta alteração.",
      );
    } finally {
      setSaving(null);
    }
  };
  const saveText = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.updateInternalGroup(groupId, {
        name: name.trim(),
        description: description.trim(),
        botName: botName.trim() || "BotAdmin",
      });
      const next = (result.group || {}) as JsonRecord;
      setGroup(next);
      onUpdated(next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o grupo.",
      );
    } finally {
      setBusy(false);
    }
  };
  const chooseFile = (kind: "wallpaper" | "botAvatar" | "groupAvatar") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || saving) return;
      setSaving(kind);
      setError("");
      try {
        const result =
          kind === "wallpaper"
            ? await api.updateInternalGroupWallpaper(groupId, file)
            : kind === "botAvatar"
              ? await api.updateInternalGroupBotAvatar(groupId, file)
              : await api.updateInternalGroupAvatar(groupId, file);
        const next = (result.group || {}) as JsonRecord;
        setGroup((current) => ({ ...(current || {}), ...next }));
        onUpdated(next);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível atualizar a imagem.",
        );
      } finally {
        setSaving(null);
      }
    };
    input.click();
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="quick-modal internal-settings-modal"
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <div className="modal-heading-line">
              <h2>Configurações do grupo</h2>
              <InfoTip label="Configurações do grupo">
                Altere identidade, plano de fundo, automações e permissões. Toggles são salvos imediatamente.
              </InfoTip>
            </div>
            <small>{thread.title}</small>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="internal-settings-scroll">
          <section
            className={`bot-master-control ${valueFor("botEnabled") ? "is-active" : ""}`}
          >
            <span className="bot-master-icon"><Bot /></span>
            <span>
              <b>Robô no grupo</b>
              <small>
                {valueFor("botEnabled")
                  ? "Bot operando neste grupo."
                  : "Bot pausado neste grupo."}
              </small>
            </span>
            <label className="compact-switch" aria-label="Ativar robô no grupo">
              <input
                type="checkbox"
                checked={valueFor("botEnabled")}
                disabled={saving !== null || !group}
                onChange={(event) =>
                  void saveToggle("botEnabled", event.target.checked)
                }
              />
              <i />
            </label>
          </section>
          {botSettings && <BotAdvancedControls settings={botSettings} groupId={Number(group?.botGroupId || 0)} groupName={thread.title} onSaved={(next) => setBotSettings(next)} />}
          <form className="quick-form" onSubmit={saveText}>
            <label>
              Nome do grupo
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Descrição
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                placeholder="Descrição do grupo"
              />
            </label>
            <button className="primary-button" disabled={busy || !name.trim()}>
              {busy ? "Salvando…" : "Salvar dados"}
            </button>
          </form>
          <section className="settings-card internal-bot-card">
            <div className="settings-card-heading">
              <div>
                <h3>Identidade do robô</h3>
                <p className="settings-muted">
                  Nome e foto que aparecem nas respostas automáticas.
                </p>
              </div>
              <Avatar
                name={String(group?.botName || botName)}
                src={String(group?.botAvatarUrl || "")}
                small
              />
            </div>
            <label className="quick-label">
              Nome do robô
              <input
                value={botName}
                onChange={(event) => setBotName(event.target.value)}
                onBlur={() => {
                  if (botName.trim())
                    void api
                      .updateInternalGroup(groupId, { botName: botName.trim() })
                      .then((result) => {
                        const next = (result.group || {}) as JsonRecord;
                        setGroup(next);
                        onUpdated(next);
                      })
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Não foi possível salvar o nome do robô.",
                        ),
                      );
                }}
              />
            </label>
            <button
              className="secondary-button"
              disabled={saving === "botAvatar"}
              onClick={() => chooseFile("botAvatar")}
            >
              <Image />{" "}
              {saving === "botAvatar" ? "Enviando…" : "Trocar foto do robô"}
            </button>
          </section>
          <section className="settings-card internal-bot-card">
            <div>
              <h3>Plano de fundo</h3>
              <p className="settings-muted">
                A imagem será sincronizada para todos os membros em tempo real.
              </p>
            </div>
            {Boolean(group?.wallpaperUrl) && (
              <img
                className="wallpaper-preview"
                src={absoluteMediaUrl(String(group?.wallpaperUrl))}
                alt="Plano de fundo atual"
              />
            )}
            <div className="api-actions">
              <button
                className="secondary-button"
                disabled={saving === "wallpaper"}
                onClick={() => chooseFile("wallpaper")}
              >
                <Image />{" "}
                {saving === "wallpaper"
                  ? "Enviando…"
                  : "Alterar plano de fundo"}
              </button>
              {Boolean(group?.wallpaperUrl) && (
                <button
                  className="secondary-button"
                  disabled={saving === "wallpaper"}
                  onClick={async () => {
                    setSaving("wallpaper");
                    try {
                      const result =
                        await api.removeInternalGroupWallpaper(groupId);
                      const next = ((result as JsonRecord).group ||
                        {}) as JsonRecord;
                      setGroup((current) => ({
                        ...(current || {}),
                        ...next,
                        wallpaperUrl: null,
                      }));
                      onUpdated(next);
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Não foi possível remover o plano de fundo.",
                      );
                    } finally {
                      setSaving(null);
                    }
                  }}
                >
                  Restaurar padrão
                </button>
              )}
            </div>
          </section>
          {botSettings && (
            <div>
              <div className="activation-overview-heading">
                <h3>Ativações do robô</h3>
                <span>Recursos sincronizados com o BotAdmin.</span>
              </div>
              <div className="activation-sections internal-activation-sections">
                {groupActivationCategories.map((category) => (
                <section className="activation-category" key={category.id}>
                  <div className="activation-category-title">
                    <h3>{category.title}</h3>
                    <InfoTip label={category.title}>
                      As ativações são salvas imediatamente e seguem a mesma lógica do painel Flutter.
                    </InfoTip>
                  </div>
                  <div className="activation-grid">
                    {category.items.map((definition) => {
                      const active = activationEnabled(botSettings, definition);
                      const Icon = definition.icon;
                      return (
                        <div
                          className={`activation-tile ${active ? "is-active" : ""}`}
                          key={definition.key}
                        >
                          <Icon />
                          <span>
                            <b>{definition.label}</b>
                            <strong>{active ? "Ligado" : "Desligado"}</strong>
                            <small>{definition.description}</small>
                          </span>
                          <button
                            type="button"
                            className="activation-config-button"
                            title={`Configurar ${definition.label}`}
                            aria-label={`Configurar ${definition.label}`}
                            onClick={() => setConfiguring(definition)}
                          >
                            <Settings />
                          </button>
                          <label className="compact-switch">
                            <input
                              type="checkbox"
                              checked={active}
                              disabled={saving !== null}
                              onChange={(event) =>
                                void saveCommand(definition, event.target.checked)
                              }
                            />
                            <i />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
                ))}
              </div>
            </div>
          )}
          {Boolean(group?.botGroupId) && !botSettings && !error && (
            <div className="settings-loading">
              <RefreshCw className="spin" /> Carregando ativações…
            </div>
          )}
          <section className="settings-card internal-toggles">
            <h3>Permissões do grupo</h3>
            {toggleValues.map(([key, label, help]) => (
              <label className="settings-toggle" key={key}>
                <span>
                  <b>{label}</b>
                  <small>{help}</small>
                </span>
                <input
                  type="checkbox"
                  checked={valueFor(key)}
                  disabled={saving !== null || !group}
                  onChange={(event) =>
                    void saveToggle(key, event.target.checked)
                  }
                />
                <i />
              </label>
            ))}
          </section>
          {error && <div className="form-error">{error}</div>}
        </div>
      </section>
      {configuring && botSettings && Number(group?.botGroupId || 0) > 0 && (
        <GroupActivationConfigModal
          key={configuring.key}
          definition={configuring}
          settings={botSettings}
          groupId={Number((group || {}).botGroupId || 0)}
          groupName={thread.title}
          onClose={() => setConfiguring(null)}
          onSaved={(next) => setBotSettings(next)}
        />
      )}
    </div>
  );
}

function ModuleCreateModal({
  section,
  selectedInstance,
  onClose,
  onCreated,
}: {
  section: Section;
  selectedInstance: number | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canCreate = ["broadcasts", "flows", "raffles"].includes(section);
  const title =
    section === "broadcasts"
      ? "Nova lista de transmissão"
      : section === "flows"
        ? "Novo fluxo"
        : section === "raffles"
          ? "Novo sorteio"
          : `Novo item em ${sectionMeta[section].title}`;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (section === "broadcasts") {
        if (!selectedInstance)
          throw new Error("Conecte um perfil antes de criar uma lista.");
        await api.createBroadcastList(selectedInstance, {
          name: name.trim(),
          description: description.trim(),
        });
      } else if (section === "flows")
        await api.createFlow({
          name: name.trim(),
          description: description.trim(),
          nodes: [],
          edges: [],
        });
      else if (section === "raffles")
        await api.createRaffle({
          title: name.trim(),
          description: description.trim(),
          winnersCount: 1,
          numbersTotal: 100,
          groupIds: [],
        });
      else
        throw new Error(
          "Esta área ainda não possui criação disponível no backend.",
        );
      onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível criar.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="quick-modal module-create-modal" onSubmit={submit}>
        <header>
          <div className="modal-heading-line">
            <h2>{title}</h2>
            <InfoTip label={title}>
              Preencha os dados básicos. As opções avançadas aparecem somente quando forem necessárias.
            </InfoTip>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="quick-form">
          <label>
            Nome ou título
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                section === "broadcasts"
                  ? "Ex.: Leads de agosto"
                  : "Digite um nome"
              }
              required
            />
          </label>
          <label>
            Descrição
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Opcional"
            />
          </label>
          {!canCreate && (
            <div className="form-error">
              A criação desta área ainda será conectada ao backend. Nenhuma ação
              falsa será executada.
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <button
            className="primary-button"
            disabled={busy || !name.trim() || !canCreate}
          >
            {busy ? "Criando…" : canCreate ? "Criar agora" : "Indisponível"}
          </button>
        </div>
      </form>
    </div>
  );
}

export class DashboardErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="module-error boundary-error">
        <RefreshCw />
        <h2>Não foi possível exibir esta tela</h2>
        <p>
          O painel continua protegido. Tente novamente para recarregar apenas
          esta área.
        </p>
        <button
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </main>
    );
  }
}

export function DashboardApp() {
  const [session, setSession] = useState<SessionUser | null | undefined>(
    undefined,
  );
  const [instances, setInstances] = useState<BotInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<number | null>(null);
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [selected, setSelected] = useState<ConversationThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [section, setSection] = useState<Section>(initialSection);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // Start in the directory-loading state so a stale/empty placeholder cannot
  // flash between authentication and the first ordered conversation snapshot.
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [directoryWidth, setDirectoryWidth] = useState(
    () => Number(localStorage.getItem("botadmin.react.directoryWidth")) || 570,
  );
  const [toast, setToast] = useState("");
  const [toastSuccess, setToastSuccess] = useState(false);
  const [returningToOrigin, setReturningToOrigin] = useState(false);
  const [conversationDetails, setConversationDetails] = useState<{
    thread: ConversationThread;
    data?: JsonRecord;
  } | null>(null);
  const [internalSettingsThread, setInternalSettingsThread] =
    useState<ConversationThread | null>(null);
  const [botSettingsThread, setBotSettingsThread] =
    useState<ConversationThread | null>(null);
  const [internalLinksThread, setInternalLinksThread] =
    useState<ConversationThread | null>(null);
  const [quickModal, setQuickModal] = useState<
    "profiles" | "new-conversation" | "new-internal" | "join-internal" | null
  >(null);
  const [darkTheme, setDarkTheme] = useState(() => {
    const shared = localStorage.getItem("botadmin-theme");
    return shared
      ? shared === "dark"
      : localStorage.getItem("botadmin.react.theme") === "dark";
  });
  const reloadTimer = useRef<number | null>(null);
  const lastDashboardReload = useRef(0);
  const lastMessageReload = useRef(0);
  const directoryRequestRef = useRef(0);
  const threadCursorRef = useRef<string | null>(null);
  const directoryInitialLoadingRef = useRef(true);
  const pendingRealtimeThreadsRef = useRef<Map<string, ConversationThread>>(
    new Map(),
  );
  const threadsRef = useRef<ConversationThread[]>([]);
  const realtimeSequenceRef = useRef(0);
  const messageThreadKeyRef = useRef("");
  const messageRequestIdRef = useRef(0);
  const messageCursorRef = useRef<string | number | null>(null);
  const activeInstanceRef = useRef<number | null>(null);
  const mobileNavTrackRef = useRef<HTMLDivElement>(null);
  const mobileNavDragRef = useRef<{
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const mobileNavIgnoreClickRef = useRef(false);
  useLayoutEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  // A directory hydration request can finish after the read request and bring
  // back the stale badge it received before the conversation was opened. Keep
  // the active conversation authoritative until it is closed, while allowing
  // other threads to retain their unread counters.
  useEffect(() => {
    if (!selected) return;
    const selectedKey = `${selected.instanceId}:${selected.chatJid}`;
    const hasStaleBadge = threads.some(
      (thread) =>
        `${thread.instanceId}:${thread.chatJid}` === selectedKey &&
        (Number(thread.unreadCount || 0) > 0 || thread.hasUnreadMention === true),
    );
    if (!hasStaleBadge) return;
    setThreads((current) =>
      current.map((thread) =>
        `${thread.instanceId}:${thread.chatJid}` === selectedKey
          ? { ...thread, unreadCount: 0, hasUnreadMention: false }
          : thread,
      ),
    );
  }, [selected, threads]);

  // Keep the dashboard in the browser history as a real directory view. A
  // mobile browser/WebView otherwise has no internal entry to return to and
  // its Back button leaves the panel while a chat is open.
  useEffect(() => {
    const initial = readDashboardHistoryState();
    if (!initial.__botadminDashboard) {
      writeDashboardHistory(
        { view: "directory", section: initialSection() },
        "replace",
      );
    }
    const onPopState = () => {
      const next = readDashboardHistoryState();
      if (next.__botadminDashboard && next.view === "chat" && next.threadKey) {
        const thread = threadsRef.current.find(
          (item) => `${item.instanceId}:${item.chatJid}` === next.threadKey,
        );
        if (thread) {
          const targetSection =
            next.section ||
            (thread.chatType === "internal_group"
              ? "internalGroups"
              : "conversations");
          setSection(targetSection);
          setFilter(targetSection === "internalGroups" ? "internal" : "all");
          setSelected(thread);
          setMobileChatOpen(true);
          return;
        }
      }
      if (next.__botadminDashboard && next.section) {
        setSection(next.section);
        setFilter(next.section === "internalGroups" ? "internal" : "all");
      }
      setSelected(null);
      setMobileChatOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openConversation = useCallback(
    (
      thread: ConversationThread,
      options: { section?: Section; replace?: boolean } = {},
    ) => {
      const targetSection =
        options.section ||
        (thread.chatType === "internal_group"
          ? "internalGroups"
          : "conversations");
      const threadKey = `${thread.instanceId}:${thread.chatJid}`;
      const current = readDashboardHistoryState();
      const alreadyOpen =
        current.__botadminDashboard &&
        current.view === "chat" &&
        current.threadKey === threadKey;
      if (!alreadyOpen) {
        writeDashboardHistory(
          { view: "chat", section: targetSection, threadKey },
          options.replace ? "replace" : "push",
        );
      }
      setSection(targetSection);
      setFilter(targetSection === "internalGroups" ? "internal" : "all");
      setSelected(thread);
      setMobileChatOpen(true);
    },
    [],
  );

  const closeConversation = useCallback((replace = false) => {
    const current = readDashboardHistoryState();
    setSelected(null);
    setMobileChatOpen(false);
    if (current.__botadminDashboard && current.view === "chat") {
      if (replace) {
        writeDashboardHistory(
          { view: "directory", section: current.section || "conversations" },
          "replace",
        );
      } else {
        // Let popstate perform the state transition so Android Back, desktop
        // browser Back and the in-app arrow all share exactly the same path.
        history.back();
      }
    }
  }, []);

  const openMentionConversation = useCallback(
    (mention: MessageMention) => {
      if (!selected) return;
      const jid = normalizeMentionJidForPanel(mention.jid);
      if (!jid) {
        setToastSuccess(false);
        setToast("Não foi possível identificar este membro mencionado.");
        return;
      }
      const existing = threadsRef.current.find(
        (item) =>
          item.instanceId === selected.instanceId &&
          normalizeMentionJidForPanel(item.chatJid) === jid,
      );
      const phone = jid.split("@")[0] || "";
      const target =
        existing ||
        normalizeThreads([
          {
            id: `mention:${selected.instanceId}:${jid}`,
            instanceId: selected.instanceId,
            chatJid: jid,
            chatType: "contact",
            title: mention.name?.trim() || (phone ? `+${phone}` : "Contato"),
            phone: phone || null,
            lastMessagePreview: "",
            lastMessageAt: null,
            lastMessageDirection: null,
            lastMessageSenderName: null,
            lastMessageSenderJid: jid,
            unreadCount: 0,
            archived: false,
            pinned: false,
            muted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ])[0];
      if (!target) return;
      if (!existing) setThreads((current) => normalizeThreads([...current, target]));
      setConversationDetails({ thread: target });
    },
    [selected],
  );

  const updateSessionProfile = useCallback((next: SessionUser) => {
    setSession((current) => {
      const merged = current ? { ...current, ...next } : next;
      localStorage.setItem("botadmin.react.last-session", JSON.stringify(merged));
      return merged;
    });
  }, []);
  const returnToOrigin = useCallback(async () => {
    if (returningToOrigin) return;
    setReturningToOrigin(true);
    try {
      const result = await api.returnToImpersonator();
      const target =
        typeof result.redirectTo === "string" && result.redirectTo.trim()
          ? result.redirectTo
          : "/dashboard/admin";
      window.location.assign(target);
    } catch (cause) {
      setReturningToOrigin(false);
      setToastSuccess(false);
      setToast(
        cause instanceof Error
          ? cause.message
          : "Não foi possível retornar ao painel de origem.",
      );
    }
  }, [returningToOrigin]);
  useEffect(() => {
    const active = mobileNavTrackRef.current?.querySelector<HTMLElement>(
      `[data-nav-section="${section}"]`,
    );
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [section]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const checkSession = async (attempt = 0) => {
      try {
        const result = await api.session();
        if (cancelled) return;
        const user = result.user || null;
        setSession(user);
        if (user)
          localStorage.setItem(
            "botadmin.react.last-session",
            JSON.stringify(user),
          );
      } catch (cause) {
        const status = Number((cause as { status?: number })?.status || 0);
        // A gateway blip must not redirect an authenticated user to the
        // public sign-in page. Keep the boot screen while retrying, then use
        // the last verified identity as a safe local shell if the API is
        // still recovering; subsequent calls will continue to retry quietly.
        if (!cancelled && status >= 500 && attempt < 4) {
          retryTimer = window.setTimeout(
            () => void checkSession(attempt + 1),
            Math.min(3000, 500 * 2 ** attempt),
          );
          return;
        }
        if (!cancelled) {
          const cached = safeJsonRead<SessionUser | null>(
            "botadmin.react.last-session",
            null,
          );
          setSession(status >= 500 ? cached : null);
        }
      }
    };
    void checkSession();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, []);

  const loadDashboard = useCallback(
    async (user: SessionUser, quiet = false) => {
      // Never let a realtime refresh race the first directory snapshot. The
      // initial request owns the loading gate until its complete, ordered
      // result is ready; any response from an older request is ignored.
      if (quiet && directoryInitialLoadingRef.current) return;
      const requestId = ++directoryRequestRef.current;
      const threadCache = cacheKey("threads", user.id);
      const internalCache = cacheKey("internal-groups", user.id);
      if (!quiet) {
        const cached = recentThreadWindow(
          safeJsonRead<ConversationThread[]>(threadCache, []),
        );
        if (cached.length) setThreads(cached);
        // Keep the cache in state as a failure fallback, but leave the loading
        // gate closed to the list until API hydration has produced one atomic
        // ordered snapshot. ThreadList therefore never paints stale rows first.
        directoryInitialLoadingRef.current = true;
        threadCursorRef.current = null;
        setHasMoreThreads(false);
        setLoadingThreads(true);
      }
      try {
        const cachedInternal = normalizeThreads(
          safeJsonRead<ConversationThread[]>(internalCache, []),
        );
        const internalPromise = api
          .internalGroups()
          .then((result) => {
            localStorage.setItem(internalCache, JSON.stringify(result));
            return result;
          })
          .catch(() => cachedInternal);
        const botGroupsPromise = quiet
          ? Promise.resolve<JsonRecord[]>([])
          : api
              .botGroups()
              .then((result) =>
                Array.isArray(result.groups) ? (result.groups as JsonRecord[]) : [],
              )
              .catch(() => []);
        const instanceResult = await api.instances();
        if (requestId !== directoryRequestRef.current) return;
        const nextInstances = instanceResult.instances || [];
        setInstances(nextInstances);
        const rememberedId = Number(
          localStorage.getItem(cacheKey("instance", user.id)),
        );
        const activeId = nextInstances.some((item) => item.id === rememberedId)
          ? rememberedId
          : nextInstances[0]?.id || null;
        activeInstanceRef.current = activeId;
        setSelectedInstance((current) =>
          current && nextInstances.some((item) => item.id === current)
            ? current
            : activeId,
        );
        // Resolve the local BotAdmin groups and WhatsApp directory together.
        // Painting one reconciled snapshot avoids the list moving once for each
        // source while a reload is still in progress; a cached snapshot remains
        // visible immediately above when available.
        const [activeResult, internalResult, botGroups] = await Promise.all([
          activeId
            ? api
                .conversations(activeId, {
                  includeContacts: quiet,
                  limit: DIRECTORY_PAGE_SIZE,
                })
                .catch(() => null)
            : Promise.resolve({
                threads: [],
                conversations: [],
                hasMore: false,
                nextCursor: null,
              }),
          internalPromise,
          botGroupsPromise,
        ]);
        if (requestId !== directoryRequestRef.current) return;
        if (activeResult === null) {
          // Keep the last verified WhatsApp directory when its worker is
          // temporarily unavailable; local BotAdmin groups can still update.
          const pending = [...pendingRealtimeThreadsRef.current.values()];
          pendingRealtimeThreadsRef.current.clear();
          setThreads((current) =>
            mergeBotGroupThreads(
              normalizeThreads([
                ...internalResult,
                ...current.filter((thread) => thread.chatType !== "internal_group"),
                ...pending,
              ]),
              botGroups,
            ),
          );
          return;
        }
        const activeThreads =
          "threads" in activeResult ? activeResult.threads || [] : [];
        const activeConversations =
          "conversations" in activeResult
            ? activeResult.conversations || []
            : [];
        const pending = [...pendingRealtimeThreadsRef.current.values()];
        const nextThreads = mergeBotGroupThreads(
          normalizeThreads([
            ...internalResult,
            ...activeThreads,
            ...activeConversations,
            ...pending,
          ]),
          botGroups,
        );
        if (!quiet) {
          threadCursorRef.current = activeResult.nextCursor || null;
          setHasMoreThreads(Boolean(activeResult.hasMore));
        }
        setThreads((current) => {
          const mergedThreads = quiet
            ? normalizeThreads([...current, ...nextThreads])
            : nextThreads;
          localStorage.setItem(threadCache, JSON.stringify(mergedThreads));
          return mergedThreads;
        });
        // The local index already contains the ordered recent conversations.
        // Release the blocking state now; contact/avatar hydration below is a
        // background reconciliation and must never delay the first paint.
        if (!quiet) setLoadingThreads(false);
        if (activeId && !quiet) {
          void api
            .conversations(activeId, {
              includeContacts: true,
              limit: DIRECTORY_PAGE_SIZE,
            })
            .then((directoryResult) => {
              if (
                requestId !== directoryRequestRef.current ||
                activeInstanceRef.current !== activeId
              )
                return;
              const directoryThreads =
                "threads" in directoryResult
                  ? directoryResult.threads || []
                  : [];
              const directoryConversations =
                "conversations" in directoryResult
                  ? directoryResult.conversations || []
                  : [];
              const latePending = [...pendingRealtimeThreadsRef.current.values()];
              threadCursorRef.current = directoryResult.nextCursor || null;
              setHasMoreThreads(Boolean(directoryResult.hasMore));
              const hydrated = mergeBotGroupThreads(
                normalizeThreads([
                  ...internalResult,
                  ...directoryThreads,
                  ...directoryConversations,
                  ...latePending,
                ]),
                botGroups,
              );
              pendingRealtimeThreadsRef.current.clear();
              setThreads((current) => {
                const next = normalizeThreads([...current, ...hydrated]);
                localStorage.setItem(threadCache, JSON.stringify(next));
                return next;
              });
            })
            .catch(() => {
              if (requestId !== directoryRequestRef.current) return;
              const latePending = [...pendingRealtimeThreadsRef.current.values()];
              pendingRealtimeThreadsRef.current.clear();
              if (latePending.length) {
                setThreads((current) =>
                  mergeBotGroupThreads(
                    normalizeThreads([...current, ...latePending]),
                    botGroups,
                  ),
                );
              }
            });
        }
      } catch {
        // A background conversation sync must not cover the already rendered
        // panel with an error toast (for example while the WhatsApp upstream is
        // temporarily unavailable). Cached threads and module data remain usable
        // and the user can retry from the relevant area.
      } finally {
        if (requestId === directoryRequestRef.current) {
          if (!quiet) directoryInitialLoadingRef.current = false;
          if (!directoryInitialLoadingRef.current) setLoadingThreads(false);
        }
      }
    },
    [],
  );

  const loadMoreThreads = useCallback(async () => {
    if (
      !session ||
      !selectedInstance ||
      !hasMoreThreads ||
      loadingMoreThreads ||
      !threadCursorRef.current
    ) {
      return;
    }
    const requestId = directoryRequestRef.current;
    const cursor = threadCursorRef.current;
    setLoadingMoreThreads(true);
    try {
      const result = await api.conversations(selectedInstance, {
        includeContacts: false,
        limit: DIRECTORY_PAGE_SIZE,
        before: cursor,
      });
      if (
        requestId !== directoryRequestRef.current ||
        activeInstanceRef.current !== selectedInstance
      ) {
        return;
      }
      const incoming = result.threads || result.conversations || [];
      setThreads((current) => {
        const next = normalizeThreads([...current, ...incoming]);
        localStorage.setItem(
          cacheKey("threads", session.id),
          JSON.stringify(next),
        );
        return next;
      });
      threadCursorRef.current = result.nextCursor || null;
      setHasMoreThreads(Boolean(result.hasMore));
    } catch {
      // Keep the already rendered directory usable. The scroll sentinel can
      // retry this page on the next pass without replacing the current rows.
    } finally {
      setLoadingMoreThreads(false);
    }
  }, [hasMoreThreads, loadingMoreThreads, selectedInstance, session]);

  const changeInstance = useCallback(
    async (id: number) => {
      if (!session) return;
      const requestId = ++directoryRequestRef.current;
      directoryInitialLoadingRef.current = true;
      threadCursorRef.current = null;
      setHasMoreThreads(false);
      setSelectedInstance(id);
      activeInstanceRef.current = id;
      closeConversation(true);
      setLoadingThreads(true);
      localStorage.setItem(cacheKey("instance", session.id), String(id));
      try {
        const cachedThreads = recentThreadWindow(
          safeJsonRead<ConversationThread[]>(
            cacheKey("threads", session.id),
            [],
          ),
          id,
        );
        const internalCache = cacheKey("internal-groups", session.id);
        const cachedInternal = normalizeThreads(
          safeJsonRead<ConversationThread[]>(internalCache, []),
        );
        if (cachedThreads.length) {
          // Keep the remembered profile's latest local directory visible while
          // the new profile request is in flight. The selected chat is reset,
          // but the list itself should never flash an empty loading screen.
          setThreads(cachedThreads);
        }
        const [result, internal, botGroups] = await Promise.all([
          api
            .conversations(id, {
              includeContacts: false,
              limit: DIRECTORY_PAGE_SIZE,
            })
            .catch(() => ({
              threads: cachedThreads.filter(
                (thread) => thread.chatType !== "internal_group",
              ),
              conversations: [],
              hasMore: false,
              nextCursor: null,
            })),
          api
            .internalGroups()
            .then((groups) => {
              localStorage.setItem(internalCache, JSON.stringify(groups));
              return groups;
            })
            .catch(() => cachedInternal),
          api
            .botGroups()
            .then((response) =>
              Array.isArray(response.groups)
                ? (response.groups as JsonRecord[])
                : [],
            )
            .catch(() => []),
        ]);
        if (requestId !== directoryRequestRef.current) return;
        const next = mergeBotGroupThreads(normalizeThreads([
          ...internal,
          ...(result.threads || result.conversations || []),
        ]), botGroups);
        threadCursorRef.current = result.nextCursor || null;
        setHasMoreThreads(Boolean(result.hasMore));
        setThreads(next);
        localStorage.setItem(
          cacheKey("threads", session.id),
          JSON.stringify(next),
        );
        setLoadingThreads(false);
        void api
          .conversations(id, {
            includeContacts: true,
            limit: DIRECTORY_PAGE_SIZE,
          })
          .then((hydratedResult) => {
            if (
              requestId !== directoryRequestRef.current ||
              activeInstanceRef.current !== id
            )
              return;
            const hydrated = mergeBotGroupThreads(normalizeThreads([
              ...internal,
              ...(hydratedResult.threads || hydratedResult.conversations || []),
            ]), botGroups);
            setThreads(hydrated);
            localStorage.setItem(
              cacheKey("threads", session.id),
              JSON.stringify(hydrated),
            );
          })
          .catch(() => undefined);
      } catch (cause) {
        setToastSuccess(false);
        setToast(
          cause instanceof Error
            ? cause.message
            : "Não foi possível trocar de perfil.",
        );
      } finally {
        if (requestId === directoryRequestRef.current) {
          directoryInitialLoadingRef.current = false;
          setLoadingThreads(false);
        }
      }
    },
    [closeConversation, session],
  );

  useEffect(() => {
    if (session) void loadDashboard(session);
  }, [session, loadDashboard]);

  const loadMessages = useCallback(
    async (thread: ConversationThread, quiet = false) => {
      if (!session) return;
      const threadKey = `${thread.instanceId}:${thread.chatJid}`;
      if (!quiet) {
        messageThreadKeyRef.current = threadKey;
        messageRequestIdRef.current += 1;
        messageCursorRef.current = null;
        setHasOlderMessages(false);
        setLoadingOlderMessages(false);
      } else if (messageThreadKeyRef.current !== threadKey) {
        return;
      }
      const requestId = messageRequestIdRef.current;
      const key = cacheKey(
        `messages.${thread.instanceId}.${encodeURIComponent(thread.chatJid)}`,
        session.id,
      );
      if (!quiet) {
        const cached = mergeConversationMessages(
          [],
          sortMessages(safeJsonRead<ChatMessage[]>(key, []))
            .slice(-50)
            .map((message) => ({
              ...message,
              instanceId: message.instanceId ?? thread.instanceId,
              chatJid: message.chatJid ?? thread.chatJid,
            })),
        );
        setMessages(cached);
        setLoadingMessages(!cached.length);
        // Clear the directory badge optimistically as soon as the chat opens.
        // The request is idempotent and runs in parallel with message loading;
        // this prevents a slow media/history response from leaving a stale
        // unread counter on the conversation list.
        setThreads((current) =>
          current.map((item) =>
            item.instanceId === thread.instanceId &&
            item.chatJid === thread.chatJid
              ? { ...item, unreadCount: 0, hasUnreadMention: false }
              : item,
          ),
        );
        setSelected((current) =>
          current?.instanceId === thread.instanceId &&
          current.chatJid === thread.chatJid
            ? { ...current, unreadCount: 0, hasUnreadMention: false }
            : current,
        );
        void api.conversationAction(thread, "read").catch(() => undefined);
      }
      try {
        const result = await api.messages(thread, {
          limit: 50,
          warm: true,
        });
        if (
          messageThreadKeyRef.current !== threadKey ||
          messageRequestIdRef.current !== requestId
        )
          return;
        const serverMessages = (result.messages || []).map((message) => ({
          ...message,
          // The API intentionally omits conversation context from each row;
          // attach it here so encrypted WhatsApp media can use the recovery
          // endpoint without exposing the raw mmg.whatsapp.net URL.
          instanceId: message.instanceId ?? thread.instanceId,
          chatJid: message.chatJid ?? thread.chatJid,
        }));
        setMessages((current) => {
          const next = mergeConversationMessages(current, serverMessages);
          localStorage.setItem(key, JSON.stringify(next.slice(-100)));
          return next;
        });
        // Internal groups need the last message id to advance the member's
        // read cursor. WhatsApp threads were already marked optimistically
        // above, while this precise idempotent update completes internal
        // group read receipts after the recent window is available.
        if (!quiet && thread.chatType === "internal_group") {
          const latest = sortMessages(serverMessages).at(-1);
          const latestId = latest ? Number(latest.id) : 0;
          if (latestId > 0)
            void api
              .conversationAction(thread, "read", { messageId: latestId })
              .catch(() => undefined);
        }
        // A realtime refresh only reconciles the newest window. It must never
        // move the upward-pagination cursor back to a newer page.
        if (!quiet || messageCursorRef.current === null) {
          setHasOlderMessages(Boolean(result.hasMore));
          messageCursorRef.current =
            thread.chatType === "internal_group"
              ? ("oldestId" in result ? result.oldestId ?? null : null)
              : ("oldestCursor" in result
                  ? result.oldestCursor ?? null
                  : null);
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        // Gateway failures from an unavailable WhatsApp worker are transient;
        // keep the cached conversation visible and avoid exposing technical 502
        // text over the chat. The retry action in the header remains available.
        if (
          !/\b(502|503|504)\b|bad gateway|gateway timeout|temporariamente indisponível/i.test(
            message,
          )
        ) {
          setToastSuccess(false);
          setToast("Não foi possível sincronizar novas mensagens agora.");
        }
      } finally {
        if (
          messageThreadKeyRef.current === threadKey &&
          messageRequestIdRef.current === requestId
        )
          setLoadingMessages(false);
      }
    },
    [session],
  );

  const loadOlderMessages = useCallback(async () => {
    const thread = selected;
    if (
      !thread ||
      !session ||
      !hasOlderMessages ||
      loadingOlderMessages ||
      messageCursorRef.current === null
    )
      return;
    const threadKey = `${thread.instanceId}:${thread.chatJid}`;
    if (messageThreadKeyRef.current !== threadKey) return;
    const cursor = messageCursorRef.current;
    const requestId = messageRequestIdRef.current;
    setLoadingOlderMessages(true);
    try {
      const result = await api.messages(thread, {
        limit: 50,
        warm: true,
        before: cursor,
      });
      if (
        messageThreadKeyRef.current !== threadKey ||
        messageRequestIdRef.current !== requestId
      )
        return;
      const olderMessages = (result.messages || []).map((message) => ({
        ...message,
        instanceId: message.instanceId ?? thread.instanceId,
        chatJid: message.chatJid ?? thread.chatJid,
      }));
      setMessages((current) => mergeConversationMessages(current, olderMessages));
      setHasOlderMessages(Boolean(result.hasMore));
      messageCursorRef.current =
        thread.chatType === "internal_group"
          ? ("oldestId" in result ? result.oldestId ?? null : null)
          : ("oldestCursor" in result ? result.oldestCursor ?? null : null);
      if (!olderMessages.length) setHasOlderMessages(false);
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "";
      // A disconnected WhatsApp worker is recoverable. Keep the pagination
      // cursor and the current window intact; the next upward scroll retries
      // without exposing a technical 502/503 banner over the conversation.
      if (
        !/\b(502|503|504)\b|bad gateway|gateway timeout|temporariamente indisponível/i.test(
          errorMessage,
        )
      ) {
        setToastSuccess(false);
        setToast("Não foi possível carregar mensagens antigas.");
      }
    } finally {
      if (
        messageThreadKeyRef.current === threadKey &&
        messageRequestIdRef.current === requestId
      )
        setLoadingOlderMessages(false);
    }
  }, [hasOlderMessages, loadingOlderMessages, selected, session]);

  const selectedMessageThreadKey = selected
    ? `${selected.instanceId}:${selected.chatJid}`
    : "";
  const selectedThreadRef = useRef<ConversationThread | null>(null);
  useLayoutEffect(() => {
    selectedThreadRef.current = selected;
  }, [selected]);
  useLayoutEffect(() => {
    const thread = selectedThreadRef.current;
    if (thread && selectedMessageThreadKey) {
      void loadMessages(thread);
    } else {
      messageThreadKeyRef.current = "";
      messageRequestIdRef.current += 1;
      messageCursorRef.current = null;
      setMessages([]);
      setHasOlderMessages(false);
      setLoadingMessages(false);
    }
  }, [selectedMessageThreadKey, loadMessages]);

  useEffect(() => {
    if (selected || !threads.length) return;
    const params = new URLSearchParams(location.search);
    const requestedInternalId = params.get("internalGroupId");
    if (!requestedInternalId) return;
    const requested = threads.find(
      (thread) => thread.chatJid === `internal:${requestedInternalId}`,
    );
    if (requested) {
      openConversation(requested, { section: "internalGroups", replace: true });
    }
  }, [openConversation, selected, threads]);

  useEffect(() => {
    if (!session) return;
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let closed = false;
    let attempt = 0;
    const sequenceKey = cacheKey("realtime-sequence", session.id);
    const storedSequence = Number(localStorage.getItem(sequenceKey) || 0);
    realtimeSequenceRef.current = Number.isFinite(storedSequence)
      ? Math.max(0, storedSequence)
      : 0;
    const connect = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const after = realtimeSequenceRef.current;
      socket = new WebSocket(
        `${scheme}://${location.host}/ws/whatsapp${after > 0 ? `?after=${after}` : ""}`,
      );
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            type?: string;
            eventType?: string;
            chatJid?: string;
            instanceId?: number;
            messageId?: string | null;
            sequenceId?: number;
            payload?: JsonRecord;
            message?: JsonRecord;
            thread?: JsonRecord;
          };
          if (payload.type === "ping") {
            socket?.send(JSON.stringify({ type: "pong" }));
            return;
          }
          const sequenceId = Number(payload.sequenceId || 0);
          if (payload.type !== "hello" && sequenceId > 0) {
            // Backlog polling and Redis fan-out can deliver the same event more
            // than once. Advance the cursor before touching React state so a
            // duplicate can never reorder the directory twice.
            if (sequenceId <= realtimeSequenceRef.current) return;
            realtimeSequenceRef.current = sequenceId;
            localStorage.setItem(sequenceKey, String(sequenceId));
          }
          const now = Date.now();
          const selectedThread = selectedThreadRef.current;
          if (
            selectedThread &&
            payload.chatJid === selectedThread.chatJid &&
            (!payload.instanceId ||
              payload.instanceId === selectedThread.instanceId) &&
            now - lastMessageReload.current > 350
          ) {
            lastMessageReload.current = now;
            void loadMessages(selectedThread, true);
          }
          const eventType = String(payload.eventType || payload.type || "");
          const eventThread =
            payload.thread ||
            (payload.payload?.thread as JsonRecord | undefined);
          if (
            eventThread &&
            typeof eventThread === "object" &&
            payload.chatJid &&
            payload.instanceId
          ) {
            const isOpenThread = Boolean(
              selectedThread &&
                payload.chatJid === selectedThread.chatJid &&
                payload.instanceId === selectedThread.instanceId,
            );
            const threadPatch: ConversationThread = {
              ...(eventThread as ConversationThread),
              instanceId:
                Number((eventThread as ConversationThread).instanceId) ||
                Number(payload.instanceId),
              chatJid:
                String(
                  (eventThread as ConversationThread).chatJid ||
                    payload.chatJid,
                ),
              title: String(
                (eventThread as ConversationThread).title ||
                  selectedThread?.title ||
                  "Conversa",
              ),
              ...(isOpenThread
                ? { unreadCount: 0, hasUnreadMention: false }
                : {}),
            };
            const threadKey = `${threadPatch.instanceId}:${threadPatch.chatJid}`;
            if (directoryInitialLoadingRef.current) {
              // Preserve events that arrive between the fast directory call
              // and its contact hydration. They are merged into the first
              // atomic paint instead of being overwritten by a stale response.
              pendingRealtimeThreadsRef.current.set(threadKey, threadPatch);
            } else {
              setThreads((current) => {
                const exists = current.some(
                  (thread) =>
                    thread.instanceId === threadPatch.instanceId &&
                    thread.chatJid === threadPatch.chatJid,
                );
                const next = exists
                  ? current.map((thread) =>
                      thread.instanceId === threadPatch.instanceId &&
                      thread.chatJid === threadPatch.chatJid
                        ? { ...thread, ...threadPatch }
                        : thread,
                    )
                  : [...current, threadPatch];
                const normalized = normalizeThreads(next);
                localStorage.setItem(
                  cacheKey("threads", session.id),
                  JSON.stringify(normalized),
                );
                return normalized;
              });
              setSelected((current) =>
                current &&
                current.instanceId === threadPatch.instanceId &&
                current.chatJid === threadPatch.chatJid
                  ? { ...current, ...threadPatch }
                  : current,
              );
            }
          }
          const sameSelectedChat = Boolean(
            selectedThread &&
              payload.chatJid === selectedThread.chatJid &&
              (!payload.instanceId ||
                payload.instanceId === selectedThread.instanceId),
          );
          const eventPayload = payload.payload || {};
          const eventMessage =
            payload.message || (eventPayload.message as JsonRecord | undefined);
          if (
            sameSelectedChat &&
            eventMessage &&
            typeof eventMessage === "object" &&
            (eventType === "conversation.message.upserted" ||
              eventType === "conversation.message.updated" ||
              eventType === "conversation.message.deleted" ||
              eventType === "conversation.reaction.upserted")
          ) {
            const nextMessage = eventMessage as ChatMessage;
            setMessages((current) => {
              const next = mergeConversationMessages(current, [nextMessage]);
              localStorage.setItem(
                cacheKey(
                  `messages.${selectedThread?.instanceId}.${encodeURIComponent(selectedThread?.chatJid || "")}`,
                  session.id,
                ),
                JSON.stringify(next),
              );
              return next;
            });
            if (eventType === "conversation.message.upserted" && selectedThread) {
              const eventMessageId = Number(
                (eventMessage as ChatMessage).id || payload.messageId || 0,
              );
              void api
                .conversationAction(selectedThread, "read", {
                  ...(selectedThread.chatType === "internal_group" &&
                  eventMessageId > 0
                    ? { messageId: eventMessageId }
                    : {}),
                })
                .catch(() => undefined);
            }
          } else if (
            sameSelectedChat &&
            eventType === "conversation.message.deleted" &&
            payload.messageId
          ) {
            const deletedMessageId = String(payload.messageId);
            setMessages((current) =>
              current.map((message) =>
                String(message.messageId || message.id) === deletedMessageId
                  ? {
                      ...message,
                      deleted: true,
                      text: null,
                      body: null,
                      mediaUrl: null,
                      mediaSourceUrl: null,
                      mediaProxyUrl: null,
                    }
                  : message,
              ),
            );
          } else if (sameSelectedChat && eventType === "message.receipt") {
            const receipt =
              eventPayload.receipt && typeof eventPayload.receipt === "object"
                ? (eventPayload.receipt as JsonRecord)
                : {};
            const state = String(
              eventPayload.action ||
                receipt.state ||
                receipt.status ||
                "delivered",
            ).toLowerCase();
            const deliveryState =
              state === "read" || state === "played" || state === "seen"
                ? "read"
                : "delivered";
            if (payload.messageId) {
              const receiptMessageId = String(payload.messageId);
              setMessages((current) =>
                current.map((message) =>
                  String(message.messageId || message.id) === receiptMessageId
                    ? {
                        ...message,
                        deliveryState,
                        receiptSummary: {
                          ...(message.receiptSummary || {}),
                          lastState: deliveryState,
                          recipientName:
                            receipt.recipientName ||
                            receipt.participantName ||
                            receipt.remoteJid ||
                            null,
                          updatedAt:
                            eventPayload.occurredAt ||
                            new Date().toISOString(),
                        },
                      }
                    : message,
                ),
              );
            }
          }
          if (
            eventType === "conversation.message.upserted" ||
            eventType === "conversation.message.updated" ||
            eventType === "conversation.message.deleted" ||
            eventType === "conversation.reaction.upserted" ||
            eventType === "message.receipt"
          ) {
            // Message/reaction/receipt events are complete enough to update
            // the open chat locally. The directory patch above also handles a
            // brand-new chat that was not present in the initial snapshot.
            return;
          }
          // Coalesce bursts from webhook/realtime events. The open chat is
          // refreshed above; the directory only needs a lightweight periodic
          // reconciliation so scrolling and typing are never interrupted.
          if (!eventType.startsWith("instance.") && !eventType.startsWith("internal.group"))
            return;
          if (now - lastDashboardReload.current < 5000) return;
          lastDashboardReload.current = now;
          if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
          reloadTimer.current = window.setTimeout(
            () => void loadDashboard(session, true),
            500,
          );
        } catch {
          /* event malformed */
        }
      };
      socket.onclose = () => {
        if (!closed)
          retry = window.setTimeout(
            connect,
            Math.min(30000, 700 * 2 ** Math.min(attempt++, 6)),
          );
      };
    };
    connect();
    const ping = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "ping" }));
    }, 20000);
    return () => {
      closed = true;
      window.clearInterval(ping);
      if (retry) window.clearTimeout(retry);
      socket?.close();
    };
  }, [session, loadMessages, loadDashboard]);

  // Internal BotAdmin groups have their own SSE channel. This keeps group
  // messages, wallpaper and permission changes instant without polling the
  // WhatsApp worker or reloading the entire directory.
  useEffect(() => {
    if (!session || selected?.chatType !== "internal_group") return;
    const groupId = String(selected.chatJid).replace("internal:", "");
    if (!groupId) return;
    const source = new EventSource(
      `/api/internal-groups/${encodeURIComponent(groupId)}/stream`,
      { withCredentials: true },
    );
    let refreshTimer: number | null = null;
    const refreshMessages = (event?: Event) => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        () => void loadMessages(selected, true),
        80,
      );
      if (event instanceof MessageEvent) {
        try {
          const payload = JSON.parse(String(event.data || "{}")) as {
            messageId?: number | string | null;
          };
          const messageId = Number(payload.messageId || 0);
          if (messageId > 0) {
            setThreads((current) =>
              current.map((item) =>
                item.chatJid === selected.chatJid
                  ? { ...item, unreadCount: 0, hasUnreadMention: false }
                  : item,
              ),
            );
            void api
              .conversationAction(selected, "read", { messageId })
              .catch(() => undefined);
          }
        } catch {
          // The message refresh still runs when a legacy SSE payload has no
          // JSON metadata; the next list response will reconcile receipts.
        }
      }
    };
    source.addEventListener("message.created", refreshMessages);
    source.addEventListener("message.deleted", refreshMessages);
    source.addEventListener("messages.cleared", () => setMessages([]));
    source.addEventListener("group.updated", () => {
      void api
        .internalGroup(groupId)
        .then((result) => {
          const group = (result.group || {}) as JsonRecord;
          const patch: Partial<ConversationThread> = {
            title: String(group.name || selected.title),
            avatarUrl:
              String(group.avatarUrl || selected.avatarUrl || "") || null,
            wallpaperUrl: String(group.wallpaperUrl || "") || null,
            memberCount: Number(group.memberCount || selected.memberCount || 0),
            internalBotEnabled: Boolean(group.botEnabled),
          };
          setThreads((current) =>
            normalizeThreads(
              current.map((item) =>
                item.chatJid === selected.chatJid
                  ? { ...item, ...patch }
                  : item,
              ),
            ),
          );
          setSelected((current) =>
            current?.chatJid === selected.chatJid
              ? { ...current, ...patch }
              : current,
          );
        })
        .catch(() => undefined);
    });
    source.onerror = () => {
      /* reconnect is handled by EventSource itself */
    };
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      source.close();
    };
  }, [session, selected, loadMessages]);

  const sendText = async (text: string) => {
    if (!selected || !session) return;
    const clientMessageId = makeClientId();
    const optimistic: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      text,
      isMine: true,
      direction: "outbound",
      createdAt: new Date().toISOString(),
      deliveryState: "pending",
      optimistic: true,
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await api.sendText(selected, text, clientMessageId);
      setMessages((current) => {
        const serverMessage = (result.message || {}) as ChatMessage;
        const replaced = current.map((item) =>
          item.clientMessageId === clientMessageId
            ? {
                ...optimistic,
                ...serverMessage,
                clientMessageId:
                  serverMessage.clientMessageId || clientMessageId,
                deliveryState: serverMessage.deliveryState || "sent",
                optimistic: false,
              }
            : item,
        );
        if (
          replaced.some(
            (item) =>
              item.clientMessageId === clientMessageId && !item.optimistic,
          )
        )
          return replaced;
        const fallbackIndex = replaced.findIndex(
          (item) => item.optimistic && messageComparableText(item) === text,
        );
        if (fallbackIndex < 0) return replaced;
        return replaced.map((item, index) =>
          index === fallbackIndex
            ? {
                ...item,
                ...serverMessage,
                clientMessageId:
                  serverMessage.clientMessageId || clientMessageId,
                deliveryState: serverMessage.deliveryState || "sent",
                optimistic: false,
              }
            : item,
        );
      });
    } catch (cause) {
      setMessages((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId
            ? { ...item, deliveryState: "failed", optimistic: false }
            : item,
        ),
      );
      setToastSuccess(false);
      setToast(
        cause instanceof Error ? cause.message : "Falha ao enviar a mensagem.",
      );
    }
  };

  const sendMedia = async (file: File, options: MediaSendOptions = {}) => {
    if (!selected || !session) return;
    const clientMessageId = makeClientId();
    const localUrl = URL.createObjectURL(file);
    const mediaType = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document";
    const optimistic: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      instanceId: selected.instanceId,
      chatJid: selected.chatJid,
      text: "",
      mediaUrl: localUrl,
      mediaMimeType: file.type,
      fileName: file.name,
      messageType: options.mediaKind === "sticker" ? "sticker" : mediaType,
      isMine: true,
      direction: "outbound",
      createdAt: new Date().toISOString(),
      deliveryState: "pending",
      optimistic: true,
      media: {
        source: options.mediaSource || null,
        mediaKind: options.mediaKind || null,
        isAnimated: Boolean(options.isAnimated),
      },
    };
    setMessages((current) => [...current, optimistic]);
    let serverMediaConfirmed = false;
    try {
      const result = await api.sendMedia(
        selected,
        file,
        "",
        clientMessageId,
        false,
        options,
      );
      serverMediaConfirmed = Boolean(
        result.message &&
        (result.message.mediaUrl ||
          result.message.media ||
          result.message.mediaProxyUrl),
      );
      setMessages((current) => {
        const serverMessage = (result.message || {}) as ChatMessage;
        const replaced = current.map((item) =>
          item.clientMessageId === clientMessageId
            ? {
                ...optimistic,
                ...serverMessage,
                clientMessageId:
                  serverMessage.clientMessageId || clientMessageId,
                deliveryState: serverMessage.deliveryState || "sent",
                optimistic: false,
              }
            : item,
        );
        if (
          replaced.some(
            (item) =>
              item.clientMessageId === clientMessageId && !item.optimistic,
          )
        )
          return replaced;
        const fallbackIndex = replaced.findIndex(
          (item) => item.optimistic && item.fileName === file.name,
        );
        return fallbackIndex < 0
          ? replaced
          : replaced.map((item, index) =>
              index === fallbackIndex
                ? {
                    ...item,
                    ...serverMessage,
                    clientMessageId:
                      serverMessage.clientMessageId || clientMessageId,
                    deliveryState: serverMessage.deliveryState || "sent",
                    optimistic: false,
                  }
                : item,
            );
      });
    } catch (cause) {
      setMessages((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId
            ? { ...item, deliveryState: "failed", optimistic: false }
            : item,
        ),
      );
      setToastSuccess(false);
      setToast(
        cause instanceof Error ? cause.message : "Falha ao enviar a mídia.",
      );
    } finally {
      // Keep the local preview alive when the server returns 202/without a
      // media URL; the user must still be able to see/retry the failed upload.
      if (serverMediaConfirmed) URL.revokeObjectURL(localUrl);
    }
  };

  const runMessageAction = useCallback(
    async (
      thread: ConversationThread,
      message: ChatMessage,
      action: MessageUiAction,
      payload: JsonRecord = {},
    ) => {
      if (message.optimistic) return;
      const messageKey = String(message.messageId || message.id || "");
      if (!messageKey) return;
      const previous =
        messages.find(
          (item) => String(item.messageId || item.id) === messageKey,
        ) || message;
      const interactiveId =
        action === "interactive_reply"
          ? `interactive-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          : "";
      if (action === "interactive_reply") {
        const text = String(
          payload.selectedText || payload.title || "Selecionar",
        );
        setMessages((current) => [
          ...current,
          {
            id: interactiveId,
            instanceId: thread.instanceId,
            chatJid: thread.chatJid,
            text,
            body: text,
            direction: "outbound",
            isMine: true,
            optimistic: true,
            deliveryState: "pending",
            createdAt: new Date().toISOString(),
            replyTo: message,
          },
        ]);
      }
      if (action === "react") {
        const emoji = String(payload.emoji || "👍");
        setMessages((current) =>
          current.map((item) =>
            String(item.messageId || item.id) === messageKey
              ? {
                  ...item,
                  reactions: [
                    ...(Array.isArray(item.reactions) ? item.reactions : []),
                    { emoji, fromMe: true },
                  ],
                }
              : item,
          ),
        );
      } else if (action === "edit") {
        setMessages((current) =>
          current.map((item) =>
            String(item.messageId || item.id) === messageKey
              ? {
                  ...item,
                  text: String(payload.text || ""),
                  body: String(payload.text || ""),
                  editedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
      } else if (action === "pin" || action === "unpin") {
        setMessages((current) =>
          current.map((item) =>
            String(item.messageId || item.id) === messageKey
              ? { ...item, pinned: action === "pin" }
              : item,
          ),
        );
      } else if (action === "delete") {
        setMessages((current) =>
          current.map((item) =>
            String(item.messageId || item.id) === messageKey
              ? {
                  ...item,
                  deleted: true,
                  text: null,
                  body: null,
                  mediaUrl: null,
                  mediaSourceUrl: null,
                  mediaProxyUrl: null,
                }
              : item,
          ),
        );
      }
      try {
        const result = await api.messageAction(
          thread,
          message,
          action,
          payload,
        );
        if (action === "info") {
          const receipts = Array.isArray(result.receipts)
            ? result.receipts
            : [];
          setToastSuccess(true);
          setToast(
            receipts.length
              ? `${receipts.length} recibo(s) encontrados para esta mensagem.`
              : "Ainda não há recibos de entrega ou leitura.",
          );
        } else if (action === "react") {
          setToastSuccess(true);
          setToast("Reação enviada.");
        }
        if (result.message && typeof result.message === "object") {
          setMessages((current) =>
            current.map((item) =>
              String(item.messageId || item.id) === messageKey
                ? { ...item, ...(result.message as ChatMessage) }
                : item,
            ),
          );
        }
        if (action === "interactive_reply") {
          setMessages((current) =>
            current.map((item) =>
              item.id === interactiveId
                ? { ...item, optimistic: false, deliveryState: "sent" }
                : item,
            ),
          );
          // The internal-group event stream reconciles the response and any bot
          // reply; this quiet refresh also covers clients that joined late.
          if (thread.chatType === "internal_group")
            void loadMessages(thread, true);
        }
      } catch (cause) {
        if (action === "interactive_reply")
          setMessages((current) =>
            current.map((item) =>
              item.id === interactiveId
                ? { ...item, optimistic: false, deliveryState: "failed" }
                : item,
            ),
          );
        setMessages((current) =>
          current.map((item) =>
            String(item.messageId || item.id) === messageKey ? previous : item,
          ),
        );
        setToastSuccess(false);
        setToast(
          cause instanceof Error
            ? cause.message
            : "Não foi possível executar a ação na mensagem.",
        );
      }
    },
    [loadMessages, messages],
  );

  const runConversationAction = useCallback(
    async (thread: ConversationThread, action: ConversationUiAction) => {
      const internalGroupId =
        thread.chatType === "internal_group"
          ? String(thread.chatJid).replace("internal:", "")
          : null;
      if (action === "refresh") {
        if (
          selected?.chatJid === thread.chatJid &&
          selected.instanceId === thread.instanceId
        )
          await loadMessages(thread);
        setToastSuccess(true);
        setToast("Mensagens atualizadas.");
        return;
      }
      if (action === "copy-id") {
        await navigator.clipboard.writeText(thread.chatJid);
        setToastSuccess(true);
        setToast("ID da conversa copiado.");
        return;
      }
      if (action === "details") {
        try {
          const data = internalGroupId
            ? ((await api.internalGroup(
                internalGroupId,
              )) as unknown as JsonRecord)
            : undefined;
          setConversationDetails({ thread, data });
        } catch (cause) {
          setToastSuccess(false);
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível carregar os dados da conversa.",
          );
        }
        return;
      }
      if (action === "group-settings") {
        if (thread.chatType === "internal_group" && canManageGroupThread(thread))
          setInternalSettingsThread(thread);
        else if (
          thread.chatType !== "internal_group" &&
          canManageGroupThread(thread)
        ) {
          if (Number(thread.linkedGroupId || 0) > 0) {
            setBotSettingsThread(thread);
          } else {
            setToastSuccess(true);
            setToast("Preparando o robô deste grupo…");
            try {
              const result = await api.linkBotGroup(thread.instanceId, thread.chatJid);
              const group = (result.group || {}) as JsonRecord;
              const linkedGroupId = Number(group.id || 0);
              if (!linkedGroupId) throw new Error("Não foi possível vincular este grupo ao robô.");
              const linkedThread: ConversationThread = {
                ...thread,
                linkedGroupId,
                title: String(group.name || thread.title),
                avatarUrl: String(group.imageUrl || thread.avatarUrl || "") || null,
                participantsCount: Number(
                  group.participantCount ?? thread.participantsCount ?? 0,
                ),
              };
              setThreads((current) =>
                current.map((item) =>
                  item.chatJid === thread.chatJid && item.instanceId === thread.instanceId
                    ? linkedThread
                    : item,
                ),
              );
              setSelected((current) =>
                current?.chatJid === thread.chatJid && current.instanceId === thread.instanceId
                  ? linkedThread
                  : current,
              );
              setBotSettingsThread(linkedThread);
            } catch (cause) {
              setToastSuccess(false);
              setToast(
                cause instanceof Error
                  ? cause.message
                  : "Não foi possível preparar o robô deste grupo.",
              );
            }
          }
        } else if (isGroupThread(thread)) {
          setToastSuccess(false);
          setToast(
            "Este grupo ainda não está vinculado ao robô BotAdmin ou você não é administrador.",
          );
        }
        return;
      }
      if (action === "group-links") {
        if (thread.chatType === "internal_group")
          setInternalLinksThread(thread);
        return;
      }
      if (action === "toggle-bot") {
        const botGroupId = Number(thread.linkedGroupId || 0);
        const canManage = canManageGroupThread(thread);
        if (!canManage || (thread.chatType === "internal_group" && !internalGroupId) ||
            (thread.chatType !== "internal_group" && !botGroupId)) return;
        try {
          const next = !thread.internalBotEnabled;
          const result = thread.chatType === "internal_group"
            ? await api.updateInternalGroup(internalGroupId as string, {
                botEnabled: next,
              })
            : await api.updateBotGroup(botGroupId, { active: next });
          const group = (result.group || {}) as JsonRecord;
          setThreads((current) =>
            current.map((item) =>
              item.chatJid === thread.chatJid &&
              item.instanceId === thread.instanceId
                ? {
                    ...item,
                    internalBotEnabled: Boolean(
                      group.botEnabled ??
                        (String(group.status || "").toLowerCase() === "active" ? true : next),
                    ),
                  }
                : item,
            ),
          );
          setSelected((current) =>
            current?.chatJid === thread.chatJid &&
            current.instanceId === thread.instanceId
              ? {
                  ...current,
                  internalBotEnabled: Boolean(
                    group.botEnabled ??
                      (String(group.status || "").toLowerCase() === "active" ? true : next),
                  ),
                }
              : current,
          );
          setToastSuccess(true);
          setToast(
            next ? "Robô ativado neste grupo." : "Robô pausado neste grupo.",
          );
        } catch (cause) {
          setToastSuccess(false);
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível atualizar o robô.",
          );
        }
        return;
      }
      if (action === "copy-link") {
        if (!internalGroupId) return;
        try {
          const result = await api.internalGroup(internalGroupId);
          const inviteUrl = String(
            (result.group as JsonRecord | undefined)?.inviteUrl || "",
          );
          if (!inviteUrl)
            throw new Error(
              "O link privado não está disponível para esta conta.",
            );
          if (!(await copyText(normalizePublicLink(inviteUrl))))
            throw new Error("Não foi possível copiar o link para a área de transferência.");
          setToastSuccess(true);
          setToast("Link completo do grupo copiado.");
        } catch (cause) {
          setToastSuccess(false);
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível copiar o link.",
          );
        }
        return;
      }
      if (action === "rotate-link") {
        if (
          !internalGroupId ||
          !window.confirm(
            "Revogar o link atual e gerar um novo? O endereço antigo deixará de funcionar.",
          )
        )
          return;
        try {
          const result = await api.rotateInternalGroupInvite(internalGroupId);
          if (result.inviteUrl)
            if (!(await copyText(normalizePublicLink(result.inviteUrl))))
              throw new Error("Não foi possível copiar o novo link para a área de transferência.");
          setToastSuccess(true);
          setToast("Novo link gerado e copiado.");
        } catch (cause) {
          setToastSuccess(false);
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível redefinir o link.",
          );
        }
        return;
      }
      if (action === "wallpaper") {
        if (!internalGroupId) return;
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*";
        picker.onchange = async () => {
          const file = picker.files?.[0];
          if (!file) return;
          try {
            await api.updateInternalGroupWallpaper(internalGroupId, file);
            setToastSuccess(true);
            setToast("Plano de fundo atualizado para todos os membros.");
            if (selected?.chatJid === thread.chatJid)
              void loadMessages(thread, true);
          } catch (cause) {
            setToastSuccess(false);
            setToast(
              cause instanceof Error
                ? cause.message
                : "Não foi possível atualizar o plano de fundo.",
            );
          }
        };
        picker.click();
        return;
      }
      const destructive =
        action === "clear" || action === "delete" || action === "leave";
      if (destructive) {
        const label =
          action === "clear"
            ? "limpar todas as mensagens desta conversa"
            : action === "delete"
              ? thread.chatType === "internal_group"
                ? "apagar definitivamente este grupo BotAdmin"
                : "apagar esta conversa"
              : "sair deste grupo";
        if (
          !window.confirm(
            `Deseja realmente ${label}? Esta ação não pode ser desfeita.`,
          )
        )
          return;
      }
      try {
        await api.conversationAction(thread, action);
        if (action === "delete" || action === "leave") {
          setThreads((current) =>
            current.filter(
              (item) =>
                !(
                  item.chatJid === thread.chatJid &&
                  item.instanceId === thread.instanceId
                ),
            ),
          );
          if (
            selected?.chatJid === thread.chatJid &&
            selected.instanceId === thread.instanceId
          ) {
            closeConversation(true);
          }
        } else {
          const patch: Partial<ConversationThread> =
            action === "pin"
              ? { pinned: true }
              : action === "unpin"
                ? { pinned: false }
                : action === "archive"
                  ? { archived: true }
                  : action === "unarchive"
                    ? { archived: false }
                    : action === "mute"
                      ? { muted: true }
                      : action === "unmute"
                        ? { muted: false }
                        : action === "read"
                          ? { unreadCount: 0 }
                          : action === "clear"
                            ? {
                                lastMessage: null,
                                lastMessagePreview: "",
                                unreadCount: 0,
                              }
                            : {};
          setThreads((current) =>
            normalizeThreads(
              current.map((item) =>
                item.chatJid === thread.chatJid &&
                item.instanceId === thread.instanceId
                  ? { ...item, ...patch }
                  : item,
              ),
            ),
          );
          if (
            selected?.chatJid === thread.chatJid &&
            selected.instanceId === thread.instanceId
          )
            setSelected((current) =>
              current ? { ...current, ...patch } : current,
            );
          if (action === "clear") setMessages([]);
        }
        const success =
          action === "read"
            ? "Conversa marcada como lida."
            : action === "pin"
              ? "Conversa fixada."
              : action === "unpin"
                ? "Conversa desfixada."
                : action === "archive"
                  ? "Conversa arquivada."
                  : action === "unarchive"
                    ? "Conversa desarquivada."
                    : action === "mute"
                      ? "Notificações silenciadas."
                      : action === "unmute"
                        ? "Notificações ativadas."
                        : action === "clear"
                          ? "Mensagens limpas."
                          : action === "leave"
                            ? "Você saiu do grupo."
                            : "Conversa apagada.";
        setToastSuccess(true);
        setToast(success);
      } catch (cause) {
        setToastSuccess(false);
        setToast(
          cause instanceof Error
            ? cause.message
            : "Não foi possível executar esta ação.",
        );
      }
    },
    [closeConversation, selected, loadMessages],
  );

  const runDirectoryAction = useCallback(
    async (action: DirectoryAction) => {
      if (action === "switch-profile") {
        setQuickModal("profiles");
        return;
      }
      if (action === "new-conversation") {
        setQuickModal("new-conversation");
        return;
      }
      if (action === "new-internal") {
        setQuickModal("new-internal");
        return;
      }
      if (action === "join-internal") {
        setQuickModal("join-internal");
        return;
      }
      if (action === "renew-profile" || action === "new-profile") {
        setSection("profiles");
        persistSectionInUrl("profiles");
        return;
      }
      if (action === "support") {
        const support = threads.find(
          (thread) => thread.isSupport || /suporte/i.test(thread.title),
        );
        if (support) {
          openConversation(support, { section: "conversations" });
        } else {
          setToastSuccess(false);
          setToast(
            "A conversa de suporte ainda não foi iniciada para esta conta.",
          );
        }
        return;
      }
      if (action === "theme") {
        setDarkTheme((current) => {
          const next = current ? "light" : "dark";
          localStorage.setItem("botadmin.react.theme", next);
          localStorage.setItem(
            "botadmin-theme",
            next === "dark" ? "dark" : "clean",
          );
          return !current;
        });
        return;
      }
      if (action === "settings") {
        setSection("settings");
        persistSectionInUrl("settings");
        return;
      }
      if (action === "download-app") {
        window.open(
          "https://botadmin.shop/dashboard/user/baixar-app",
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }
      if (action === "lists") {
        setSection("broadcasts");
        persistSectionInUrl("broadcasts");
        return;
      }
      if (action === "select") {
        setToastSuccess(true);
        setToast("Pressione uma conversa para abrir as ações de organização.");
        return;
      }
      if (action === "favorites") {
        setToastSuccess(false);
        setToast(
          "Abra uma conversa e use a estrela da mensagem para acessar os favoritos.",
        );
        return;
      }
      if (action === "resync") {
        if (
          !selectedInstance ||
          !window.confirm(
            "Resincronizar todo o histórico deste perfil sem desconectá-lo?",
          )
        )
          return;
        try {
          await api.resyncHistory(selectedInstance);
          setToastSuccess(true);
          setToast("Resincronização iniciada em segundo plano.");
        } catch (cause) {
          setToastSuccess(false);
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível resincronizar.",
          );
        }
        return;
      }
      if (action === "mark-all-read") {
        const unread = threads.filter(
          (thread) => Number(thread.unreadCount || 0) > 0,
        );
        try {
          for (let offset = 0; offset < unread.length; offset += 4)
            await Promise.all(
              unread
                .slice(offset, offset + 4)
                .map((thread) => api.conversationAction(thread, "read")),
            );
          setThreads((current) =>
            current.map((thread) => ({ ...thread, unreadCount: 0 })),
          );
          setToastSuccess(true);
          setToast("Todas as conversas foram marcadas como lidas.");
        } catch (cause) {
          setToastSuccess(false);
          setToast(
            cause instanceof Error
              ? cause.message
              : "Não foi possível concluir a leitura.",
          );
        }
        return;
      }
      if (action === "logout") {
        if (!window.confirm("Deseja sair do painel BotAdmin?")) return;
        await api.logout().catch(() => undefined);
        setSession(null);
      }
    },
    [openConversation, selectedInstance, threads],
  );

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = directoryWidth;
    let nextWidth = startWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let frame = 0;
    const move = (nativeEvent: PointerEvent) => {
      cancelAnimationFrame(frame);
      nextWidth = Math.max(
        360,
        Math.min(
          window.innerWidth - 420,
          startWidth + nativeEvent.clientX - startX,
        ),
      );
      frame = requestAnimationFrame(() =>
        setDirectoryWidth(nextWidth),
      );
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      localStorage.setItem(
        "botadmin.react.directoryWidth",
        String(nextWidth),
      );
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  };

  const handleMobileNavPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const track = event.currentTarget;
    mobileNavDragRef.current = {
      startX: event.clientX,
      startScrollLeft: track.scrollLeft,
      moved: false,
    };
    track.setPointerCapture(event.pointerId);
    track.classList.add("is-dragging");
  };
  const handleMobileNavPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mobileNavDragRef.current;
    if (!drag) return;
    const track = event.currentTarget;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 5) drag.moved = true;
    if (drag.moved) {
      event.preventDefault();
      track.scrollLeft = drag.startScrollLeft - delta;
    }
  };
  const handleMobileNavPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget;
    const drag = mobileNavDragRef.current;
    if (drag?.moved) {
      mobileNavIgnoreClickRef.current = true;
      window.setTimeout(() => {
        mobileNavIgnoreClickRef.current = false;
      }, 0);
    }
    mobileNavDragRef.current = null;
    track.classList.remove("is-dragging");
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  };

  if (session === undefined) return <Loader />;
  if (!session) {
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname))
      return <LocalLoginScreen />;
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    location.replace(`https://botadmin.shop/sign-in?next=${next}`);
    return <Loader />;
  }
  const conversationsVisible =
    section === "conversations" || section === "internalGroups";
  const scopedThreads =
    section === "internalGroups"
      ? threads.filter((thread) => thread.chatType === "internal_group")
      : threads;
  return (
    <div
      className={`app-shell ${session.isImpersonated ? "has-impersonation" : ""} ${darkTheme ? "theme-dark" : ""} ${mobileChatOpen ? "chat-open" : ""}`}
      style={
        { "--directory-width": `${directoryWidth}px` } as React.CSSProperties
      }
    >
      {session.isImpersonated && (
        <button
          type="button"
          className="impersonation"
          onClick={() => void returnToOrigin()}
          disabled={returningToOrigin}
          aria-label="Voltar ao painel de origem"
        >
          <ChevronLeft />
          {returningToOrigin ? "Voltando ao painel…" : "Voltar ao painel de origem"}
        </button>
      )}
      <Rail
        section={section}
        user={session}
        activeInstance={
          instances.find((instance) => instance.id === selectedInstance) || null
        }
        instanceCount={instances.length}
        unreadCount={threads.reduce(
          (total, thread) => total + Number(thread.unreadCount || 0),
          0,
        )}
        onProfileSwitcher={() => setQuickModal("profiles")}
        onLogout={() => void runDirectoryAction("logout")}
        onSelect={(next) => {
          if (next !== "conversations" && next !== "internalGroups")
            closeConversation(true);
          setSection(next);
          persistSectionInUrl(next);
          if (next === "internalGroups") setFilter("internal");
        }}
      />
      {conversationsVisible ? (
        <>
          <Directory
            threads={scopedThreads}
            selected={selected}
            instances={instances}
            selectedInstance={selectedInstance}
            query={query}
            filter={section === "internalGroups" ? "internal" : filter}
            loading={loadingThreads}
            onQuery={setQuery}
            onFilter={setFilter}
            onSelect={(thread) => openConversation(thread)}
            onAction={(thread, action) =>
              void runConversationAction(thread, action)
            }
            onLoadMore={() => void loadMoreThreads()}
            loadingMore={loadingMoreThreads}
            hasMore={hasMoreThreads}
            onDirectoryAction={(action) => void runDirectoryAction(action)}
          />
          <div className="splitter" onPointerDown={startResize} />
          <div className={`chat-host ${mobileChatOpen ? "mobile-open" : ""}`}>
            <Chat
              thread={selected}
              messages={messages}
              loading={loadingMessages}
              loadingOlder={loadingOlderMessages}
              hasOlder={hasOlderMessages}
              onLoadOlder={loadOlderMessages}
              onBack={() => closeConversation()}
              onSend={sendText}
              onSendMedia={sendMedia}
              onAction={(thread, action) =>
                void runConversationAction(thread, action)
              }
              onMessageAction={(message, action, payload) =>
                selected
                  ? runMessageAction(selected, message, action, payload)
                  : undefined
              }
              onMention={openMentionConversation}
            />
          </div>
        </>
      ) : (
        <ModuleWorkspace
          section={section}
          instances={instances}
          selectedInstance={selectedInstance}
          user={session}
          onProfilesChanged={() => void loadDashboard(session, true)}
          onUserChanged={updateSessionProfile}
          onManageInstance={(id) => {
            setSelectedInstance(id);
            localStorage.setItem(cacheKey("instance", session.id), String(id));
            setSection("settings");
            persistSectionInUrl("settings");
          }}
        />
      )}
      <nav className="mobile-nav" aria-label="Navegação do painel">
        <div
          className="mobile-nav-track"
          ref={mobileNavTrackRef}
          onPointerDown={handleMobileNavPointerDown}
          onPointerMove={handleMobileNavPointerMove}
          onPointerUp={handleMobileNavPointerEnd}
          onPointerCancel={handleMobileNavPointerEnd}
        >
          {navigation.map(({ section: item, icon: Icon, label }) => (
            <button
              type="button"
              key={item}
              data-nav-section={item}
              className={section === item ? "active" : ""}
              onClick={() => {
                if (mobileNavIgnoreClickRef.current) return;
                if (item !== "conversations" && item !== "internalGroups")
                  closeConversation(true);
                setSection(item);
                persistSectionInUrl(item);
              }}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      {toast && (
        <div className={`toast ${toastSuccess ? "toast--success" : ""}`}>
          <span>{toast}</span>
          <button onClick={() => setToast("")}>
            <X />
          </button>
        </div>
      )}
      {conversationDetails && (
        <ConversationDetailsModal
          value={conversationDetails}
          onClose={() => setConversationDetails(null)}
          onStartConversation={(thread) => {
            setConversationDetails(null);
            openConversation(thread, { section: "conversations" });
          }}
        />
      )}
      {botSettingsThread && botSettingsThread.linkedGroupId && (
        <BotGroupAutomationModal
          item={{
            id: Number(botSettingsThread.linkedGroupId),
            name: botSettingsThread.title,
            imageUrl: botSettingsThread.avatarUrl || "",
            status:
              botSettingsThread.internalBotEnabled === true
                ? "active"
                : botSettingsThread.internalBotEnabled === false
                  ? "disabled"
                  : "loading",
          }}
          onClose={() => setBotSettingsThread(null)}
          onChanged={(group) => {
            const active = group
              ? String(group.status || "").toLowerCase() === "active"
              : true;
            setThreads((current) =>
              current.map((item) =>
                item.chatJid === botSettingsThread.chatJid &&
                item.instanceId === botSettingsThread.instanceId
                  ? { ...item, internalBotEnabled: active }
                  : item,
              ),
            );
            setSelected((current) =>
              current?.chatJid === botSettingsThread.chatJid &&
              current.instanceId === botSettingsThread.instanceId
                ? { ...current, internalBotEnabled: active }
                : current,
            );
          }}
        />
      )}
      {internalSettingsThread && (
        <InternalGroupSettingsModal
          thread={internalSettingsThread}
          onClose={() => setInternalSettingsThread(null)}
          onUpdated={(group) => {
            const patch: Partial<ConversationThread> = {
              title: String(group.name || internalSettingsThread.title),
              avatarUrl: String(
                group.avatarUrl || internalSettingsThread.avatarUrl || "",
              ),
              wallpaperUrl: String(group.wallpaperUrl || "") || null,
              memberCount: Number(
                group.memberCount || internalSettingsThread.memberCount || 0,
              ),
              internalBotEnabled: Boolean(
                group.botEnabled ?? internalSettingsThread.internalBotEnabled,
              ),
            };
            setThreads((current) =>
              normalizeThreads(
                current.map((item) =>
                  item.chatJid === internalSettingsThread.chatJid
                    ? { ...item, ...patch }
                    : item,
                ),
              ),
            );
            setSelected((current) =>
              current?.chatJid === internalSettingsThread.chatJid
                ? { ...current, ...patch }
                : current,
            );
          }}
        />
      )}
      {internalLinksThread && (
        <InternalGroupLinksModal
          thread={internalLinksThread}
          onClose={() => setInternalLinksThread(null)}
          onCopy={() => {
            void runConversationAction(internalLinksThread, "copy-link");
            setInternalLinksThread(null);
          }}
          onRotate={() => {
            void runConversationAction(internalLinksThread, "rotate-link");
            setInternalLinksThread(null);
          }}
        />
      )}
      {quickModal && (
        <QuickDashboardModal
          type={quickModal}
          instances={instances}
          activeInstanceId={selectedInstance}
          threads={threads}
          onClose={() => setQuickModal(null)}
          onSelectInstance={(id) => {
            setQuickModal(null);
            void changeInstance(id);
          }}
          onSelectThread={(thread) => {
            setQuickModal(null);
            openConversation(thread, { section: "conversations" });
          }}
          onCreated={(result) => {
            // Keep the creation modal open when the API returns an invite so
            // the owner can copy/share it immediately. Other quick actions
            // close as soon as their operation completes.
            if (!result?.inviteUrl) setQuickModal(null);
            if (session) void loadDashboard(session);
          }}
        />
      )}
    </div>
  );
}
