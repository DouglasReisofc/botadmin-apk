"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AdminSystemInstanceStatus = {
  instance?: {
    id: number;
    name: string;
    phone: string;
    sessionStatus: string;
  } | null;
  message?: string;
};

const isConnected = (status: AdminSystemInstanceStatus | null) =>
  status?.instance?.sessionStatus === "conectado";

const AdminSystemInstanceReconnectOverlay = () => {
  const [status, setStatus] = useState<AdminSystemInstanceStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const response = await fetch("/api/admin/system-instance/status", {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as AdminSystemInstanceStatus;
        if (cancelled) return;
        setStatus(response.ok ? data : { instance: null, message: data.message });
        if (response.ok && isConnected(data)) {
          setDismissed(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load admin system instance status", error);
          setStatus({ instance: null, message: "Não foi possível conferir a instância operacional." });
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    };

    void loadStatus();
    const interval = window.setInterval(loadStatus, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (!loaded || dismissed || isConnected(status)) {
    return null;
  }

  const instanceLabel = status?.instance
    ? `${status.instance.name} (${status.instance.phone || "sem número"})`
    : "Instância operacional do painel admin";

  return (
    <div
      className="position-fixed top-0 start-50 translate-middle-x p-3"
      style={{ zIndex: 1080, width: "min(720px, calc(100vw - 24px))" }}
    >
      <div className="alert alert-warning border shadow-sm mb-0 d-flex gap-3 align-items-start">
        <div className="flex-grow-1">
          <div className="fw-semibold mb-1">Reconecte a instância do painel admin</div>
          <div className="small">
            {instanceLabel} está desconectada. Ela é usada para verificar números e enviar códigos de cadastro.
          </div>
          <div className="mt-3 d-flex flex-wrap gap-2">
            <Link href="/dashboard/admin/instancias" className="btn btn-warning btn-sm">
              Abrir instâncias
            </Link>
          </div>
        </div>
        <button
          type="button"
          className="btn-close"
          aria-label="Fechar aviso"
          onClick={() => setDismissed(true)}
        />
      </div>
    </div>
  );
};

export default AdminSystemInstanceReconnectOverlay;
