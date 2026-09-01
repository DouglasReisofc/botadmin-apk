"use client";

import { FormEvent, useState } from "react";
import type { CSSProperties } from "react";

type Preview = {
  name: string;
  description?: string | null;
  memberCount: number;
  avatarUrl?: string | null;
};

export default function InternalGroupInviteClient({
  token,
  preview,
}: {
  token: string;
  preview: Preview;
}) {
  const nextPath = `/g/${encodeURIComponent(token)}`;
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [form, setForm] = useState({ name: "", email: "", whatsappNumber: "", password: "", identifier: "" });

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = mode === "login"
        ? { identifier: form.identifier.trim(), password: form.password, remember: true }
        : { name: form.name.trim(), email: form.email.trim(), whatsappNumber: form.whatsappNumber.trim(), password: form.password, nextPath };
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Não foi possível concluir.");
      if (data.pendingVerification && data.verificationToken) {
        if (data.verification?.mode === "user_sends_code") {
          // This verification mode requires the WhatsApp deep-link/poller used
          // by the full signup screen. Keep the invite intent and hand off
          // without losing the group token.
          window.location.assign(`/sign-up?next=${encodeURIComponent(nextPath)}`);
          return;
        }
        setVerificationToken(String(data.verificationToken));
        setVerificationCode("");
        setNotice(data.message || "Enviamos um código para o seu WhatsApp.");
        return;
      }
      window.location.assign(nextPath);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };

  const submitVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !verificationToken) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ verificationToken, verificationCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Código inválido.");
      window.location.assign(nextPath);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Código inválido.");
    } finally {
      setBusy(false);
    }
  };

  const submitForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const identifier = form.identifier.trim();
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ identifier }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Não foi possível solicitar a recuperação.");
      setNotice(data.message || "Se a conta existir, enviaremos as instruções de recuperação.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível solicitar a recuperação.");
    } finally {
      setBusy(false);
    }
  };

  const image = preview.avatarUrl || "/android-chrome-192x192.png";
  return (
    <main style={{ minHeight: "100dvh", background: "#fff", display: "grid", gridTemplateRows: "64px minmax(0, 1fr) 56px", fontFamily: "Arial, sans-serif", color: "#111b21", colorScheme: "light" }}>
      <header style={{ background: "#fff", display: "flex", alignItems: "center", gap: 12, padding: "8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left))", boxShadow: "0 1px 2px rgba(17,27,33,.12)", zIndex: 1 }}>
        <img src={image} alt="" width={44} height={44} style={{ borderRadius: "50%", objectFit: "cover", background: "#d9fdd3", flex: "0 0 auto" }} />
        <div style={{ minWidth: 0 }}><strong style={{ display: "block", color: "#111b21", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview.name}</strong><span style={{ color: "#667781", fontSize: 13 }}>Grupo BotAdmin · {preview.memberCount} membros</span></div>
      </header>
      <section style={{ position: "relative", minHeight: 0, display: "grid", placeItems: "center", padding: "16px max(12px, env(safe-area-inset-right)) 16px max(12px, env(safe-area-inset-left))", background: "#fff", overflow: "hidden" }}>
        <div style={{ color: "#667781", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13 }}>Você recebeu um convite para este grupo</div>
        <div style={{ position: "absolute", inset: 0, background: "#fff", display: "grid", placeItems: "center", padding: "12px max(12px, env(safe-area-inset-right)) 12px max(12px, env(safe-area-inset-left))", overflow: "auto", overscrollBehavior: "contain" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="invite-title" style={{ width: "min(460px, calc(100vw - 24px))", maxHeight: "calc(100% - 24px)", display: "flex", flexDirection: "column", boxSizing: "border-box", background: "#fff", border: "1px solid #e2e8eb", borderRadius: 20, padding: "clamp(16px, 5vw, 24px)", boxShadow: "0 14px 44px rgba(17,27,33,.14)" }}>
            <div style={{ overflowY: "auto", minHeight: 0, padding: "4px 2px 8px" }}>
            <div style={{ textAlign: "center" }}><img src={image} alt={preview.name} width={76} height={76} style={{ borderRadius: "50%", objectFit: "cover", background: "#d9fdd3" }} /><h1 id="invite-title" style={{ margin: "14px 0 6px", fontSize: 23, lineHeight: 1.2, color: "#111b21", overflowWrap: "anywhere" }}>{preview.name}</h1><div style={{ maxHeight: 96, overflowY: "auto", padding: "9px 11px", border: "1px solid #e5ecef", borderRadius: 10, background: "#f8fafb", color: "#667781", lineHeight: 1.45, textAlign: "left", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{preview.description || "Converse com os membros neste grupo privado."}</div></div>
            <div style={{ display: "flex", gap: 8, margin: "20px 0 16px" }}><button type="button" onClick={() => { setMode("login"); setError(null); setNotice(null); }} style={{ flex: 1, border: 0, borderBottom: `2px solid ${mode === "login" ? "#008069" : "#ddd"}`, background: "transparent", padding: 10, color: "#008069", fontWeight: 700 }}>Entrar</button><button type="button" onClick={() => { setMode("signup"); setError(null); setNotice(null); }} style={{ flex: 1, border: 0, borderBottom: `2px solid ${mode === "signup" ? "#008069" : "#ddd"}`, background: "transparent", padding: 10, color: "#008069", fontWeight: 700 }}>Criar conta</button></div>
            {verificationToken ? <form onSubmit={submitVerification}><label style={{ display: "block", color: "#3b4a54", fontSize: 13 }}>Código recebido no WhatsApp</label><input required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} inputMode="numeric" style={inputStyle} autoFocus /><button disabled={busy} style={primaryButton}>{busy ? "Validando…" : "Entrar no grupo"}</button></form> : mode === "forgot" ? <form onSubmit={submitForgotPassword}><label style={labelStyle}>E-mail ou WhatsApp<input required value={form.identifier} onChange={(event) => update("identifier", event.target.value)} style={inputStyle} autoComplete="username" autoFocus /></label><button disabled={busy} style={primaryButton}>{busy ? "Enviando…" : "Enviar recuperação"}</button><button type="button" onClick={() => { setMode("login"); setError(null); setNotice(null); }} style={secondaryButton}>Voltar para entrar</button></form> : <form onSubmit={submit}>
              {mode === "login" ? <label style={labelStyle}>E-mail ou WhatsApp<input required value={form.identifier} onChange={(event) => update("identifier", event.target.value)} style={inputStyle} autoComplete="username" /></label> : <><label style={labelStyle}>Nome<input required value={form.name} onChange={(event) => update("name", event.target.value)} style={inputStyle} autoComplete="name" /></label><label style={labelStyle}>WhatsApp<input required value={form.whatsappNumber} onChange={(event) => update("whatsappNumber", event.target.value)} style={inputStyle} autoComplete="tel" /></label><label style={labelStyle}>E-mail<input required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} style={inputStyle} autoComplete="email" /></label></>}
              <label style={labelStyle}>Senha<input required minLength={6} type="password" value={form.password} onChange={(event) => update("password", event.target.value)} style={inputStyle} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label><button disabled={busy} style={primaryButton}>{busy ? "Aguarde…" : mode === "login" ? "Entrar e abrir conversa" : "Criar conta e entrar"}</button>{mode === "login" && <button type="button" onClick={() => { setMode("forgot"); setError(null); setNotice(null); }} style={linkButton}>Esqueci minha senha</button>}
            </form>}
            {notice && <p style={{ color: "#087f5b", fontSize: 13, margin: "12px 0 0" }}>{notice}</p>}{error && <p style={{ color: "#b42318", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}
            <small style={{ display: "block", marginTop: 16, textAlign: "center", color: "#86939a" }}>A conversa será aberta automaticamente depois da autenticação.</small>
            </div>
          </div>
        </div>
      </section>
      <footer style={{ background: "#fff", display: "grid", placeItems: "center", color: "#667781", fontSize: 13, borderTop: "1px solid #eef1f2" }}>Mensagens do grupo aparecerão aqui</footer>
    </main>
  );
}

const labelStyle: CSSProperties = { display: "block", color: "#3b4a54", fontSize: 13, marginBottom: 10 };
const inputStyle: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, border: "1px solid #c9d4d9", borderRadius: 10, padding: "12px 13px", fontSize: 15, lineHeight: 1.2, background: "#fff", color: "#111b21", colorScheme: "light", outline: "none" };
const primaryButton: CSSProperties = { position: "sticky", bottom: 0, zIndex: 2, width: "100%", border: 0, borderRadius: 10, padding: "13px 14px", marginTop: 4, background: "#00a884", color: "#fff", fontWeight: 700, cursor: "pointer", boxShadow: "0 -8px 16px rgba(255,255,255,.96)" };
const secondaryButton: CSSProperties = { width: "100%", border: "1px solid #c9d4d9", borderRadius: 10, padding: "11px 14px", marginTop: 8, background: "#fff", color: "#008069", fontWeight: 700, cursor: "pointer" };
const linkButton: CSSProperties = { display: "block", margin: "10px auto 0", border: 0, background: "transparent", color: "#008069", fontSize: 13, fontWeight: 700, cursor: "pointer" };
