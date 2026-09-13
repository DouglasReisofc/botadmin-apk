import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, ArrowUpRight } from "lucide-react";
import { PANEL_MODULES, getPanelModules, type PanelModuleAvailability, type PanelModuleLifecycle } from "../../lib/panel-modules";
import "./panel-modules.css";

export function usePanelModules(userId: number | undefined, scope: "user" | "admin") {
  const [enabled, setEnabled] = useState<string[]>([]);
  const [modules, setModules] = useState<ModuleState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const current = ++generation.current;
    setLoading(true); setError(""); setEnabled([]); setModules([]);
    try {
      const response = await fetch(`/api/user/panel-modules?scope=${scope}`, { credentials: "include", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Falha ao carregar módulos.");
      if (current === generation.current) {
        const catalog = getPanelModules(scope);
        const received = Array.isArray(data.modules) ? data.modules : [];
        const next = catalog.map((definition) => {
          const remote = received.find((item: unknown) => item && typeof item === "object" && (item as { id?: unknown }).id === definition.id) as Partial<ModuleState> | undefined;
          return { ...definition, enabled: Boolean(remote?.enabled), pinned: Boolean(remote?.pinned), order: Number(remote?.order ?? 0), availability: (remote?.availability || "available") as PanelModuleAvailability, canEnable: remote?.canEnable !== false, reason: typeof remote?.reason === "string" ? remote.reason : null };
        });
        const fallbackEnabled = Array.isArray(data.enabled) ? data.enabled.filter((id: unknown) => typeof id === "string" && (PANEL_MODULES[scope] as readonly string[]).includes(id)) : [];
        setModules(next.map((item) => ({ ...item, enabled: received.length ? item.enabled : fallbackEnabled.includes(item.id) })));
        setEnabled(received.length ? next.filter((item) => item.enabled).map((item) => item.id) : fallbackEnabled);
      }
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Falha ao carregar módulos."); }
    finally { if (current === generation.current) setLoading(false); }
  }, [scope, userId]);
  useEffect(() => { void load(); const currentGeneration = generation; return () => { currentGeneration.current++; }; }, [load]);
  const toggle = async (id: string, next: boolean) => {
    if (busy.current || loading) return;
    const moduleState = modules.find((item) => item.id === id);
    if (next && moduleState && !moduleState.canEnable) { setError(moduleState.reason || "Este módulo não pode ser ativado."); return; }
    busy.current = true; setSaving(id); setError("");
    const current = generation.current;
    try {
      const response = await fetch("/api/user/panel-modules", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, module: id, enabled: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Falha ao salvar módulo.");
      if (current === generation.current) {
        setEnabled(previous => next ? [...new Set([...previous, id])] : previous.filter(item => item !== id));
        setModules(previous => previous.map((item) => item.id === id ? { ...item, enabled: next } : item));
      }
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Falha ao salvar módulo."); }
    finally { busy.current = false; if (current === generation.current) setSaving(null); }
  };
  const layout = async (id: string, change: { pinned?: boolean; order?: number }) => {
    if (busy.current || loading) return;
    busy.current = true; setSaving(id); setError("");
    try {
      const response = await fetch("/api/user/panel-modules", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, module: id, action: "layout", ...change }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Falha ao salvar a organização do menu.");
      const nextModules = Array.isArray(data.modules) ? data.modules as ModuleState[] : [];
      if (nextModules.length) { setModules(nextModules); setEnabled(nextModules.filter((item) => item.enabled).map((item) => item.id)); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar a organização do menu."); }
    finally { busy.current = false; setSaving(null); }
  };
  const ordered = (ids: string[]) => {
    const order = new Map(modules.map((item) => [item.id, item]));
    return [...ids].sort((left, right) => {
      const a = order.get(left); const b = order.get(right);
      return Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned)) || Number(a?.order ?? 0) - Number(b?.order ?? 0);
    });
  };
  return { enabled, modules, loading, error, saving, toggle, layout, reload: load, ordered, visible: (id: string) => !(PANEL_MODULES[scope] as readonly string[]).includes(id) || enabled.includes(id) };
}

type ModuleState = { id: string; title: string; description: string; category: string; image: string; route: string; dependencies: string[]; defaultEnabled: boolean; scopes: string[]; lifecycle: string; enabled: boolean; pinned: boolean; order: number; availability: PanelModuleAvailability; canEnable: boolean; reason: string | null };
type CatalogItem = { id: string; label: string; description: string; icon: typeof LayoutGrid; image: string; badge?: string; category?: string };
type GlobalModuleState = { id: string; globalEnabled: boolean; lifecycle: PanelModuleLifecycle; rolloutPercent: number; updatedAt: string | null };
function useModuleGovernance(active: boolean) {
  const [states, setStates] = useState<GlobalModuleState[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!active) return;
    try { const response = await fetch("/api/admin/panel-modules", { credentials: "include", cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "Falha ao carregar governança."); setStates(Array.isArray(data.modules) ? data.modules : []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar governança."); }
  }, [active]);
  useEffect(() => { void reload(); }, [reload]);
  const save = async (id: string, change: { enabled?: boolean; lifecycle?: PanelModuleLifecycle; rolloutPercent?: number }) => {
    setSaving(id); setError("");
    try { const response = await fetch("/api/admin/panel-modules", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: id, ...change }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "Falha ao salvar governança."); if (data.state) setStates((current) => current.map((item) => item.id === id ? data.state : item)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao salvar governança."); }
    finally { setSaving(null); }
  };
  return { states, saving, error, save, reload };
}

export function PanelModules({ items, state, onOpen, scope = "user" }: { items: CatalogItem[]; state: ReturnType<typeof usePanelModules>; onOpen: (id: string) => void; scope?: "user" | "admin" }) {
  const governance = useModuleGovernance(scope === "admin");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => Array.from(new Set(items.map((item) => state.modules.find((module) => module.id === item.id)?.category || item.category || "outros"))), [items, state.modules]);
  const categoryLabels: Record<string, string> = { all: "Todos", automacao: "Automação", vendas: "Vendas", integracoes: "Integrações", comunicacao: "Comunicação", administracao: "Administração", outros: "Outros" };
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      const remote = state.modules.find((module) => module.id === item.id);
      const itemCategory = remote?.category || item.category || "outros";
      return (category === "all" || itemCategory === category) && (!normalized || `${item.label} ${item.description}`.toLocaleLowerCase("pt-BR").includes(normalized));
    });
  }, [category, items, query, state.modules]);
  return <section className="panel-modules"><header><div className="panel-modules-heading-icon"><LayoutGrid size={26} /></div><div><h1>Módulos</h1><p>Ative somente os recursos que sua operação precisa.</p></div></header>
    <p className="panel-modules-note">Suas permissões continuam as mesmas. Ocultar um módulo não apaga dados nem interrompe automações.</p>
    {(state.error || governance.error) && <div role="alert" className="panel-modules-error">{state.error || governance.error}<button type="button" onClick={() => { void state.reload(); if (scope === "admin") void governance.reload(); }}>Tentar novamente</button></div>}
    {!state.loading && <div className="panel-modules-toolbar"><label className="panel-modules-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar módulos" aria-label="Pesquisar módulos" /></label><div className="panel-modules-categories" role="tablist" aria-label="Categorias de módulos"><button type="button" className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>{categoryLabels.all}</button>{categories.map((itemCategory) => <button type="button" key={itemCategory} className={category === itemCategory ? "active" : ""} onClick={() => setCategory(itemCategory)}>{categoryLabels[itemCategory] || itemCategory}</button>)}</div></div>}
    {state.loading ? <p role="status">Carregando módulos…</p> : filteredItems.length ? <div className="panel-modules-grid">{filteredItems.map(item => { const remote = state.modules.find((module) => module.id === item.id); const global = governance.states.find((module) => module.id === item.id); const active = remote?.enabled ?? state.enabled.includes(item.id); const available = remote?.canEnable !== false; const availability = remote?.availability || "available"; return <article key={item.id} className={`${active ? "is-enabled" : ""} ${available ? "" : "is-locked"}`}><div className="panel-module-art"><img src={item.image} alt="" loading="lazy" />{item.badge && <span className="panel-module-badge">{item.badge}</span>}</div><div className="panel-module-copy"><div className="panel-module-title-row"><h2>{item.label}</h2><span className={`panel-module-status status-${availability}`}>{availability === "available" ? (active ? "Ativo" : "Disponível") : availability === "plan_locked" ? "Plano" : availability === "maintenance" ? "Manutenção" : availability === "coming_soon" ? "Em breve" : "Dependência"}</span></div><p>{item.description}</p>{!available && remote?.reason && <small className="panel-module-reason">{remote.reason}</small>}{scope === "admin" && global && <div className="panel-module-governance"><label><span>Disponibilidade global</span><input type="checkbox" checked={global.globalEnabled} disabled={governance.saving === item.id} onChange={(event) => void governance.save(item.id, { enabled: event.target.checked })} /></label><select value={global.lifecycle} disabled={governance.saving === item.id} onChange={(event) => void governance.save(item.id, { lifecycle: event.target.value as PanelModuleLifecycle })} aria-label={`Estado global de ${item.label}`}><option value="active">Ativo</option><option value="beta">Beta</option><option value="maintenance">Manutenção</option><option value="coming_soon">Em breve</option></select></div>}</div><footer><button type="button" className="panel-module-switch" role="switch" aria-checked={active} aria-label={`${active ? "Desativar" : "Ativar"} ${item.label}`} disabled={state.saving !== null || !available} onClick={() => void state.toggle(item.id, !active)}><span className="panel-module-track"><i /></span>{state.saving === item.id ? "Salvando…" : active ? "Ativado" : available ? "Ativar módulo" : "Indisponível"}</button>{active && available && <button className="panel-module-open" type="button" onClick={() => onOpen(item.id)} aria-label={`Abrir ${item.label}`}><ArrowUpRight size={18} />Abrir</button>}{available && <button type="button" className={`panel-module-pin ${remote?.pinned ? "active" : ""}`} onClick={() => void state.layout(item.id, { pinned: !remote?.pinned })} aria-label={remote?.pinned ? `Desafixar ${item.label}` : `Fixar ${item.label}`} title={remote?.pinned ? "Desafixar no menu" : "Fixar no menu"}>⌖</button>}</footer></article>; })}</div> : <div className="panel-modules-empty">Nenhum módulo corresponde à busca.</div>}
    {scope === "admin" && governance.states.length > 0 && <section className="panel-modules-rollout-panel" aria-label="Liberação gradual dos módulos"><h2>Liberação gradual</h2><div>{governance.states.map((module) => { const item = items.find((candidate) => candidate.id === module.id); if (!item) return null; return <label key={module.id}><span>{item.label}</span><input type="range" min="0" max="100" step="5" value={module.rolloutPercent} disabled={governance.saving === module.id} onChange={(event) => void governance.save(module.id, { rolloutPercent: Number(event.target.value) })} /><b>{module.rolloutPercent}%</b></label>; })}</div></section>}
  </section>;
}
