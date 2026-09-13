export type PanelModuleScope = "user" | "admin";
export type PanelModuleLifecycle =
  | "active"
  | "beta"
  | "maintenance"
  | "coming_soon";
export type PanelModuleAvailability =
  | "available"
  | "plan_locked"
  | "dependency_locked"
  | "maintenance"
  | "coming_soon";

export type PanelModuleDefinition = {
  id: string;
  title: string;
  description: string;
  category:
    | "automacao"
    | "vendas"
    | "integracoes"
    | "comunicacao"
    | "administracao";
  image: string;
  route: string;
  dependencies: string[];
  defaultEnabled: boolean;
  scopes: PanelModuleScope[];
  requiresFeature?: string;
  lifecycle: PanelModuleLifecycle;
};

export const PANEL_MODULE_CATALOG: readonly PanelModuleDefinition[] = [
  {
    id: "raffles",
    title: "Rifas e sorteios",
    description: "Crie, acompanhe e sorteie participantes.",
    category: "comunicacao",
    image: "/botadmin-landing/module-raffles.webp",
    route: "raffles",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["user"],
    requiresFeature: "modulo_rifas",
    lifecycle: "active",
  },
  {
    id: "store",
    title: "Loja",
    description: "Catálogo, pedidos e atendimento comercial.",
    category: "vendas",
    image: "/botadmin-landing/module-store.webp",
    route: "store",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["user"],
    requiresFeature: "modulo_loja",
    lifecycle: "active",
  },
  {
    id: "affiliates",
    title: "Afiliados",
    description: "Links, campanhas e resultados de afiliados.",
    category: "vendas",
    image: "/botadmin-landing/module-affiliates.webp",
    route: "affiliates",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["user", "admin"],
    requiresFeature: "modulo_afiliados",
    lifecycle: "active",
  },
  {
    id: "flows",
    title: "Fluxos",
    description: "Automações visuais e respostas inteligentes.",
    category: "automacao",
    image: "/botadmin-landing/module-flows.webp",
    route: "flows",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["user"],
    requiresFeature: "allow_flows",
    lifecycle: "active",
  },
  {
    id: "api",
    title: "API REST",
    description: "Integrações, tokens e eventos em tempo real.",
    category: "integracoes",
    image: "/botadmin-landing/module-api.webp",
    route: "api",
    dependencies: [],
    // A API REST é a única extensão ativada por padrão; os demais módulos são opt-in.
    defaultEnabled: true,
    scopes: ["user"],
    lifecycle: "active",
  },
  {
    id: "broadcasts",
    title: "Transmissão",
    description: "Listas, modelos, agendamentos e acompanhamento dos envios.",
    category: "comunicacao",
    image: "/botadmin-landing/module-campaigns.webp",
    route: "broadcasts",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["user"],
    lifecycle: "active",
  },
  {
    id: "payments",
    title: "Pagamentos",
    description: "Cobranças, planos, créditos e integrações.",
    category: "vendas",
    image: "/botadmin-landing/module-payments.webp",
    route: "payments",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["user", "admin"],
    requiresFeature: "modulo_pagamentos",
    lifecycle: "active",
  },
  {
    id: "campaigns",
    title: "Campanhas",
    description: "Campanhas administrativas e acompanhamento dos envios.",
    category: "comunicacao",
    image: "/botadmin-landing/module-campaigns.webp",
    route: "campaigns",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["admin"],
    lifecycle: "active",
  },
  {
    id: "mega",
    title: "Mega downloader",
    description: "Credenciais e sessão do Mega.NZ.",
    category: "integracoes",
    image: "/botadmin-landing/module-mega.webp",
    route: "mega",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["admin"],
    lifecycle: "active",
  },
  {
    id: "botinterage",
    title: "BotInterage",
    description: "IA, integrações e automações inteligentes.",
    category: "automacao",
    image: "/botadmin-landing/module-botinterage.webp",
    route: "botinterage",
    dependencies: [],
    defaultEnabled: false,
    scopes: ["admin"],
    lifecycle: "active",
  },
] as const;

export const PANEL_MODULES = {
  user: PANEL_MODULE_CATALOG.filter((item) => item.scopes.includes("user")).map(
    (item) => item.id,
  ),
  admin: PANEL_MODULE_CATALOG.filter((item) => item.scopes.includes("admin")).map(
    (item) => item.id,
  ),
} as { readonly user: readonly string[]; readonly admin: readonly string[] };

export const getPanelModule = (
  scope: PanelModuleScope,
  moduleId: string,
): PanelModuleDefinition | null => {
  const item = PANEL_MODULE_CATALOG.find(
    (candidate) => candidate.id === moduleId && candidate.scopes.includes(scope),
  );
  return item
    ? { ...item, dependencies: [...item.dependencies], scopes: [...item.scopes] }
    : null;
};

export const getPanelModules = (
  scope: PanelModuleScope,
): PanelModuleDefinition[] =>
  PANEL_MODULE_CATALOG.filter((item) => item.scopes.includes(scope)).map(
    (item) => ({
      ...item,
      dependencies: [...item.dependencies],
      scopes: [...item.scopes],
    }),
  );

export function validModulePreference(value: unknown): value is {
  scope: PanelModuleScope;
  module: string;
  enabled: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    (input.scope === "user" || input.scope === "admin") &&
    typeof input.enabled === "boolean" &&
    typeof input.module === "string" &&
    Boolean(getPanelModule(input.scope, input.module))
  );
}
