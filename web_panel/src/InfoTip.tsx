import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";

/** A compact, keyboard- and touch-friendly explanation for dense forms. */
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`info-tip ${open ? "open" : ""}`}>
      <button
        type="button"
        className="info-tip-trigger"
        aria-label={`Informações: ${label}`}
        aria-expanded={open}
        title={typeof children === "string" ? children : label}
        onClick={() => setOpen((value) => !value)}
      >
        <Info aria-hidden="true" />
      </button>
      <span className="info-tip-popover" role="tooltip">
        <b>{label}</b>
        <span>{children}</span>
      </span>
    </span>
  );
}
