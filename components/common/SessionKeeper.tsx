"use client";

import { useEffect, useRef } from "react";
import { clearSupportCacheStorage } from "lib/support-storage";

const STORAGE_KEY = "sb_last_session";

const SessionKeeper = () => {
  const triedRef = useRef(false);

  useEffect(() => {
    const syncSessionState = async () => {
      if (triedRef.current) return;
      triedRef.current = true;
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const hasUser = Boolean(data?.user);
        if (hasUser) {
          // Mantém compatibilidade limpando resquícios antigos
          try { localStorage.removeItem(STORAGE_KEY); } catch {}
          return;
        }

        try {
          localStorage.removeItem(STORAGE_KEY);
          // Sem usuário atual: limpa caches do suporte para evitar resquícios ao trocar de conta
          try { clearSupportCacheStorage(); } catch {}
        } catch {
          // ignore removal failures
        }
      } catch {
        try {
          localStorage.removeItem(STORAGE_KEY);
          try { clearSupportCacheStorage(); } catch {}
        } catch {
          // ignore removal failures
        }
      }
    };

    syncSessionState();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        triedRef.current = false;
        syncSessionState();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return null;
};

export default SessionKeeper;
