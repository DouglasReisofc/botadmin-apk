import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, ArrowUpRight } from "lucide-react";
import { PANEL_MODULES } from "../../lib/panel-modules";
import "./panel-modules.css";

export function usePanelModules(userId: number | undefined, scope: "user" | "admin") {
  const [enabled, setEnabled] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (!userId) return;
    const current = ++generation.current;
    setLoading(true); setError(""); setEnabled([]);
    try {
      const response = await fetch(`/api/user/panel-modules?scope=${scope}`, { credentials: "include", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Falha ao carregar módulos.");
      if (current === generation.current) setEnabled(Array.isArray(data.enabled) ? data.enabled.filter((id: unknown) => typeof id === "string" && (PANEL_MODULES[scope] as readonly string[]).includes(id)) : []);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Falha ao carregar módulos."); }
    finally { if (current === generation.current) setLoading(false); }
  }, [scope, userId]);
  useEffect(() => { void load(); const currentGeneration = generation; return () => { currentGeneration.current++; }; }, [load]);
  const toggle = async (id: string, next: boolean) => {
    if (busy.current || loading) return;
    busy.current = true; setSaving(id); setError("");
    const current = generation.current;
    try {
      const response = await fetch("/api/user/panel-modules", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, module: id, enabled: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Falha ao salvar módulo.");
      if (current === generation.current) setEnabled(previous => next ? [...new Set([...previous, id])] : previous.filter(item => item !== id));
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Falha ao salvar módulo."); }
    finally { busy.current = false; if (current === generation.current) setSaving(null); }
  };
  return { enabled, loading, error, saving, toggle, reload: load, visible: (id: string) => !(PANEL_MODULES[scope] as readonly string[]).includes(id) || enabled.includes(id) };
}

type CatalogItem = { id: string; label: string; description: string; icon: typeof LayoutGrid };
export function PanelModules({ items, state, onOpen }: { items: CatalogItem[]; state: ReturnType<typeof usePanelModules>; onOpen: (id: string) => void }) {
  return <section className="panel-modules"><header><LayoutGrid size={26} /><div><h1>Módulos</h1><p>Escolha os atalhos que aparecem no seu menu.</p></div></header>
    <p className="panel-modules-note">Suas permissões continuam as mesmas. Ocultar um módulo não apaga dados nem interrompe automações.</p>
    {state.error && <div role="alert" className="panel-modules-error">{state.error}<button type="button" onClick={() => void state.reload()}>Tentar novamente</button></div>}
    {state.loading ? <p role="status">Carregando módulos…</p> : <div className="panel-modules-grid">{items.map(item => { const Icon = item.icon; const active = state.enabled.includes(item.id); return <article key={item.id} className={active ? "is-enabled" : ""}><div className="panel-module-art"><Icon size={48} strokeWidth={1.5} /></div><div className="panel-module-copy"><h2>{item.label}</h2><p>{item.description}</p></div><footer><button type="button" className="panel-module-switch" role="switch" aria-checked={active} aria-label={`Mostrar ${item.label} no menu`} disabled={state.saving !== null} onClick={() => void state.toggle(item.id, !active)}><span className="panel-module-track"><i /></span>{state.saving === item.id ? "Salvando…" : active ? "Ativado" : "Desativado"}</button>{active && <button className="panel-module-open" type="button" onClick={() => onOpen(item.id)} aria-label={`Abrir ${item.label}`}><ArrowUpRight size={18} />Abrir</button>}</footer></article>; })}</div>}
  </section>;
}
