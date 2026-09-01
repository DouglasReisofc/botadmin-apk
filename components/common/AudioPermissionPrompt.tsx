"use client";

import { useCallback, useEffect, useState } from "react";

type AudioStatus = {
  permission: boolean;
  primed: boolean;
  pending: boolean;
};

const AudioPermissionPrompt = () => {
  const [need, setNeed] = useState(false);
  const [status, setStatus] = useState<AudioStatus>({ permission: false, primed: false, pending: false });

  useEffect(() => {
    const onRequired = () => setNeed(true);
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<AudioStatus>).detail;
      if (!detail) return;
      setStatus(detail);
      if (detail.permission && detail.primed) {
        setNeed(false);
      }
    };
    window.addEventListener("notifications:audio-permission-required", onRequired);
    window.addEventListener("notifications:audio-status", onStatus as EventListener);
    return () => {
      window.removeEventListener("notifications:audio-permission-required", onRequired);
      window.removeEventListener("notifications:audio-status", onStatus as EventListener);
    };
  }, []);

  const request = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent("notifications:prime-audio"));
    } catch {}
  }, []);

  if (!need) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 1100,
        background: "#1f2937",
        color: "#fff",
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: "0 12px 28px rgba(0,0,0,.35)",
        display: "flex",
        gap: 12,
        alignItems: "center",
        maxWidth: 360,
      }}
      role="dialog"
      aria-live="polite"
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Habilitar sons</div>
        <div style={{ fontSize: 13, opacity: .9 }}>
          Clique em “Ativar” para permitir sons e TTS em tempo real.
        </div>
      </div>
      <button
        type="button"
        onClick={request}
        disabled={status.pending}
        style={{
          background: "#22c55e",
          color: "#0b2",
          colorScheme: "green",
          color: "#fff",
          border: "none",
          padding: "8px 12px",
          borderRadius: 8,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {status.pending ? "Ativando…" : "Ativar"}
      </button>
      <button
        type="button"
        onClick={() => setNeed(false)}
        style={{
          background: "transparent",
          border: "none",
          color: "#cbd5e1",
          fontSize: 18,
          padding: 4,
          marginLeft: 4,
          cursor: "pointer",
        }}
        aria-label="Fechar aviso"
      >
        ×
      </button>
    </div>
  );
};

export default AudioPermissionPrompt;

