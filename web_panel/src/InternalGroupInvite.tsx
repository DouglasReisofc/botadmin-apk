import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";

import { absoluteMediaUrl, api, type JsonRecord, type SessionUser } from "./api";
import { LocalLoginScreen } from "./App";

type InvitePreview = {
  name: string;
  description?: string | null;
  memberCount: number;
  avatarUrl?: string | null;
};

const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const toPreview = (value: JsonRecord | undefined): InvitePreview | null => {
  if (!value) return null;
  const name = text(value.name, "Grupo BotAdmin");
  const avatarRaw = text(value.avatarUrl);
  return {
    name,
    description: text(value.description) || null,
    memberCount: Math.max(0, Number(value.memberCount || 0)),
    avatarUrl: avatarRaw ? absoluteMediaUrl(avatarRaw) : null,
  };
};

export default function InternalGroupInviteRoute({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const joinedRef = useRef(false);
  const redirectPath = useMemo(() => `/g/${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.internalGroupInvitePreview(token),
      api.session(),
    ])
      .then(([previewResult, sessionResult]) => {
        if (!active) return;
        setPreview(toPreview(previewResult.preview));
        setSession(sessionResult.user || null);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Este convite não está disponível.");
        setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!session || !preview || joinedRef.current) return;
    joinedRef.current = true;
    setJoining(true);
    setError("");
    void api
      .joinInternalGroup(token)
      .then((result) => {
        const groupId = Number(result.group?.id || 0);
        if (!groupId) throw new Error("Não foi possível abrir o grupo.");
        window.location.replace(
          `/dashboard/react/?section=internalGroups&internalGroupId=${encodeURIComponent(String(groupId))}&invite=1`,
        );
      })
      .catch((cause) => {
        joinedRef.current = false;
        setJoining(false);
        setError(cause instanceof Error ? cause.message : "Não foi possível entrar neste grupo.");
      });
  }, [preview, retryNonce, session, token]);

  if (loading) {
    return (
      <main className="invite-route-state" aria-live="polite">
        <RefreshCw className="spin" />
        <span>Carregando convite…</span>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="invite-route-state invite-route-error">
        <h1>Convite indisponível</h1>
        <p>{error || "Este link expirou, foi revogado ou não existe mais."}</p>
        <a href="/">Voltar para o BotAdmin</a>
      </main>
    );
  }

  if (!session) return <LocalLoginScreen redirectPath={redirectPath} />;

  const avatar = preview.avatarUrl || "/images/brand/botadmin-logo.webp";
  return (
    <main className="invite-route-state">
      <img className="invite-route-avatar" src={avatar} alt="" />
      <CheckCircle2 className="invite-route-check" />
      <h1>{joining ? `Entrando em ${preview.name}…` : preview.name}</h1>
      <p>{joining ? "Você será levado diretamente para a conversa." : error}</p>
      {error && <button className="primary-button" onClick={() => { joinedRef.current = false; setError(""); setRetryNonce((value) => value + 1); }}>Tentar novamente</button>}
    </main>
  );
}
