"use client";

import { useEffect, useMemo, useState } from "react";

export type FloatingAlertKind = "success" | "danger" | "warning" | "info" | "error";

export type FloatingAlertFeedback =
  | { type: FloatingAlertKind; message: string }
  | null
  | undefined;

type FloatingAlertProps = {
  feedback: FloatingAlertFeedback;
  onClose?: () => void;
  durationMs?: number;
};

const typeToClass = (type: FloatingAlertKind): string => {
  switch (type) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "error":
    case "danger":
    default:
      return "danger";
  }
};

const FloatingAlert = ({ feedback, onClose, durationMs = 5000 }: FloatingAlertProps) => {
  const activeFeedback = useMemo(() => {
    if (!feedback) {
      return null;
    }
    const safeType = typeof feedback.type === "string" ? feedback.type : "info";
    return {
      type: typeToClass(safeType as FloatingAlertKind),
      message: feedback.message,
    };
  }, [feedback]);

  const [remainingMs, setRemainingMs] = useState(durationMs);

  useEffect(() => {
    if (!activeFeedback) {
      return () => {};
    }
    setRemainingMs(durationMs);
    if (durationMs <= 0) {
      return () => {};
    }

    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(durationMs - elapsed, 0);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onClose?.();
      }
    }, 200);

    return () => {
      clearInterval(interval);
    };
  }, [activeFeedback, durationMs, onClose]);

  if (!activeFeedback) {
    return null;
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      style={{
        position: "fixed",
        top: "28px",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        zIndex: 2000,
        pointerEvents: "none",
      }}
    >
      <div
        className={`shadow-lg border rounded-3 bg-white alert alert-${activeFeedback.type}`}
        style={{
          width: "min(440px, calc(100vw - 32px))",
          pointerEvents: "auto",
          padding: "16px 18px",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          boxShadow: "0 12px 32px rgba(15, 23, 42, 0.2)",
        }}
        role="alert"
      >
        <button
          type="button"
          aria-label="Fechar notificação"
          onClick={() => onClose?.()}
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            border: "none",
            background: "transparent",
            fontSize: "18px",
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ×
        </button>
        <div>{activeFeedback.message}</div>
        {durationMs > 0 ? (
          <div className="text-secondary small" style={{ alignSelf: "flex-end" }}>
            Fechando em {remainingSeconds}s
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default FloatingAlert;
