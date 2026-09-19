import { useState } from "react";
import { Search, Settings, X, type LucideIcon } from "lucide-react";

export type AutomationDefinition = {
  key: string; label: string; description: string; icon: LucideIcon;
  kind?: "command" | "schedule" | "horapg";
};
export type AutomationCategory = { id: string; title: string; items: AutomationDefinition[] };
const essentials = new Set(["bemvindo", "autoresposta", "antilink", "schedule", "botinterage", "autodownloader"]);
const shortTitles: Record<string, string> = { attention: "Atendimento", messages: "Mensagens", control: "Grupo", protection: "Proteção", media: "Mídias", utilities: "Diversão" };
const friendlyLabels: Record<string, string> = {
  botinterage: "Assistente com IA", vozbotinterage: "Respostas por áudio", lerimagem: "Interpretar imagens",
  horapg: "Mídia por horário", schedule: "Abrir e fechar grupo", soadm: "Comandos só para admins",
  linkmembro: "Links dos membros", antilink: "Bloquear links", antilinkgp: "Bloquear convites de grupos",
  antipalavras: "Bloquear palavras", bangringos: "Restringir países (DDI)", antinsfwimagem: "Moderar imagens sensíveis",
  proibirnsfw: "Bloquear conteúdo adulto", moderacaocomia: "Moderação com IA",
  autosticker: "Criar figurinhas", autodownloader: "Baixar vídeos e músicas",
  antisticker: "Bloquear figurinhas", antimage: "Bloquear imagens", antvideo: "Bloquear vídeos",
  antaudio: "Bloquear áudios", antdoc: "Bloquear documentos", antvcard: "Bloquear contatos",
};
export const normalizeAutomationSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function filterAutomations(categories: AutomationCategory[], view: string, query: string, isActive: (item: AutomationDefinition) => boolean) {
  const words = normalizeAutomationSearch(query).split(/\s+/).filter(Boolean);
  return categories.flatMap(category => category.items.map(item => ({ item, category }))).filter(({ item, category }) => {
    const haystack = normalizeAutomationSearch(`${item.key} ${item.label} ${friendlyLabels[item.key] || ""} ${item.description} ${category.title}`);
    if (words.length) return words.every(word => haystack.includes(word));
    return view === "all" || (view === "essentials" ? essentials.has(item.key) : view === "active" ? isActive(item) : view === category.id);
  });
}

export function AutomationDirectory({ categories, isActive, busy, onConfigure, onToggle, botEnabled }: {
  categories: AutomationCategory[]; isActive: (item: AutomationDefinition) => boolean;
  busy: boolean; botEnabled: boolean;
  onConfigure: (item: AutomationDefinition) => void; onToggle: (item: AutomationDefinition, enabled: boolean) => void;
}) {
  const [view, setView] = useState("essentials");
  const [query, setQuery] = useState("");
  const activeCount = categories.flatMap(category => category.items).filter(isActive).length;
  const visible = filterAutomations(categories, view, query, isActive);
  const filters = [{ id: "essentials", title: "Essenciais" }, { id: "active", title: `Ligadas (${activeCount})` }, ...categories.map(category => ({ id: category.id, title: shortTitles[category.id] || category.title })), { id: "all", title: "Todas" }];
  return <section className="automation-directory" aria-label="Funções do robô">
    <div className="automation-directory-heading"><h3>O que seu robô vai fazer?</h3><span>{activeCount} ligadas{!botEnabled && " · robô pausado"}</span></div>
    <div className="automation-search"><Search size={18} /><input aria-label="Buscar função do robô" placeholder="Buscar função: links, boas-vindas, horários…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Limpar busca de funções" onClick={() => setQuery("")}><X size={17} /></button>}</div>
    <nav className="automation-filters" aria-label="Categorias das funções">{filters.map(filter => <button type="button" key={filter.id} aria-pressed={!query && view === filter.id} onClick={() => { setQuery(""); setView(filter.id); }}>{filter.title}</button>)}</nav>
    <div className="automation-results-summary" role="status">{query ? `${visible.length} resultado(s)` : view === "essentials" ? "Um bom começo para organizar seu grupo" : filters.find(filter => filter.id === view)?.title}</div>
    <div className="automation-result-grid">{visible.map(({ item, category }) => {
      const active = isActive(item);
      const Icon = item.icon;
      const label = friendlyLabels[item.key] || item.label;
      return <article className={`automation-function ${active ? "is-active" : ""}`} key={item.key}>
        <div className="automation-function-top"><span className="automation-function-icon"><Icon size={21} /></span><span className="automation-function-state">{active ? "Ligada" : "Desligada"}</span></div>
        <button type="button" className="automation-function-info" aria-label={`Configurar ${item.label}`} onClick={() => onConfigure(item)}><b>{label}</b><span>{item.description}</span></button>
        <div className="automation-function-actions"><button type="button" onClick={() => onConfigure(item)} aria-label={`Ajustar ${item.label}`}><Settings size={15} />Configurar</button><label className="compact-switch"><input type="checkbox" aria-label={`Ativar ${item.label}`} checked={active} disabled={busy} onChange={event => onToggle(item, event.target.checked)} /><i /></label></div>
        {query && <small className="automation-result-category">{category.title}</small>}
      </article>;
    })}</div>
    {!visible.length && <div className="automation-no-results"><Search size={24} /><b>{view === "active" && !query ? "Nenhuma função ligada ainda" : "Nenhuma função encontrada"}</b><span>{view === "active" && !query ? "Abra Essenciais para escolher por onde começar." : "Tente buscar por links, mensagens, áudio ou horários."}</span><button type="button" onClick={() => { setQuery(""); setView("all"); }}>Ver todas as funções</button></div>}
  </section>;
}
