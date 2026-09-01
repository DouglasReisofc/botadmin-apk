"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { IconVolume, IconVolumeOff } from "@tabler/icons-react";

type AudioStatus = {
  permission: boolean;
  primed: boolean;
  pending: boolean;
};

type AudioSettings = { soundsEnabled: boolean; ttsEnabled: boolean };
const AUDIO_SETTINGS_STORAGE_KEY = "notification-audio-settings";

const readSettings = (): AudioSettings => {
  try {
    const raw = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Partial<AudioSettings>;
    return {
      soundsEnabled: parsed.soundsEnabled !== false,
      ttsEnabled: parsed.ttsEnabled !== false,
    };
  } catch {
    return { soundsEnabled: true, ttsEnabled: true };
  }
};

const AudioStatusBadge = () => {
  const pathname = usePathname();
  const inDashboard = useMemo(() => pathname?.startsWith("/dashboard") ?? false, [pathname]);

  const [status, setStatus] = useState<AudioStatus>({ permission: false, primed: false, pending: false });
  const [settings, setSettings] = useState<AudioSettings>({ soundsEnabled: true, ttsEnabled: true });
  const [pulse, setPulse] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [permissionRequired, setPermissionRequired] = useState(false);
  const [hasStatus, setHasStatus] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSettings(readSettings());

    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<AudioStatus>).detail;
      if (!detail) return;
      setStatus(detail);
      setHasStatus(true);
      if (detail.permission && detail.primed) {
        setPermissionRequired(false);
      }
    };

    const onPermissionRequired = () => {
      setPermissionRequired(true);
    };

    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent<Partial<AudioSettings>>).detail || {};
      setSettings((prev) => ({
        soundsEnabled: detail.soundsEnabled !== undefined ? Boolean(detail.soundsEnabled) : prev.soundsEnabled,
        ttsEnabled: detail.ttsEnabled !== undefined ? Boolean(detail.ttsEnabled) : prev.ttsEnabled,
      }));
    };

    const onPulse = () => {
      setPulse(true);
      window.setTimeout(() => setPulse(false), 1100);
    };

    const updateAnchor = () => {
      try {
        const el = document.querySelector("[data-audio-badge-anchor]") as HTMLElement | null;
        setAnchor(el ?? null);
      } catch {
        setAnchor(null);
      }
    };

    updateAnchor();

    window.addEventListener("notifications:audio-status", onStatus as EventListener);
    window.addEventListener("notifications:audio-permission-required", onPermissionRequired);
    window.addEventListener("notifications:audio-settings", onSettings as EventListener);
    window.addEventListener("notification:created", onPulse as EventListener);
    window.addEventListener("purchase:created", onPulse as EventListener);
    window.addEventListener("support:message-created", onPulse as EventListener);
    window.addEventListener("resize", updateAnchor);

    return () => {
      window.removeEventListener("notifications:audio-status", onStatus as EventListener);
      window.removeEventListener("notifications:audio-permission-required", onPermissionRequired);
      window.removeEventListener("notifications:audio-settings", onSettings as EventListener);
      window.removeEventListener("notification:created", onPulse as EventListener);
      window.removeEventListener("purchase:created", onPulse as EventListener);
      window.removeEventListener("support:message-created", onPulse as EventListener);
      window.removeEventListener("resize", updateAnchor);
    };
  }, []);

  useEffect(() => {
    if (!anchor) {
      return;
    }

    anchor.style.display = "flex";
    anchor.style.alignItems = "center";
    anchor.style.justifyContent = "center";
    anchor.style.position = "relative";
    anchor.style.width = "0px";
    anchor.style.transition = "width 160ms ease";

    return () => {
      anchor.style.width = "0px";
    };
  }, [anchor]);

  // Mostrar somente quando o som está habilitado nas configurações
  // e o navegador ainda não liberou áudio (permite o clique para ativar).
  const blocked = !(status.permission && status.primed);
  const visible = Boolean(anchor) && inDashboard && settings.soundsEnabled && (permissionRequired || (hasStatus && blocked));

  useEffect(() => {
    if (!anchor) {
      return;
    }
    anchor.style.width = visible ? "40px" : "0px";
    anchor.style.marginRight = visible ? "4px" : "0px";
  }, [anchor, visible]);

  const Icon = status.pending ? IconVolume : IconVolumeOff;

  const handleClick = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent("notifications:prime-audio"));
    } catch {}
  }, []);

  if (!visible || !anchor) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes badgePulse { 0%{ transform:scale(1); } 50%{ transform:scale(1.12);} 100%{ transform:scale(1);} }
      `}</style>
      <button
        type="button"
        onClick={handleClick}
        title={status.pending ? "Ativando sons…" : "Clique para ativar sons"}
        aria-label={status.pending ? "Ativando sons" : "Ativar sons"}
        disabled={status.pending}
        style={{
          background: "rgba(30,41,59,0.92)",
          border: "1px solid rgba(148,163,184,0.32)",
          backdropFilter: "saturate(160%) blur(6px)",
          WebkitBackdropFilter: "saturate(160%) blur(6px)",
          borderRadius: "999px",
          width: 34,
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 18px rgba(0,0,0,.18)",
          animation: pulse ? "badgePulse 1.1s ease-in-out" : undefined,
          color: status.pending ? "#a3e635" : "#fbbf24",
          cursor: status.pending ? "progress" : "pointer",
          userSelect: "none",
          borderWidth: 1,
          borderStyle: "solid",
        }}
      >
        <Icon size={16} stroke={2.2} />
      </button>
    </>,
    anchor,
  );
};

export default AudioStatusBadge;
