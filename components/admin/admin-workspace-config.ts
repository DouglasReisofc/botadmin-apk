export type AdminRailSection =
  | "dashboard"
  | "support"
  | "users"
  | "infrastructure"
  | "bot"
  | "campaigns"
  | "business"
  | "settings";

export type AdminDetailSection =
  | "dashboard"
  | "support"
  | "users"
  | "instances"
  | "servers"
  | "botinterage"
  | "mega"
  | "groups"
  | "campaigns"
  | "plans"
  | "payments"
  | "affiliates"
  | "site"
  | "firebase"
  | "aplicativo"
  | "notificacoes"
  | "linksuteis"
  | "tutoriais";

export type AdminMenuItem = {
  id: AdminDetailSection;
  rail: AdminRailSection;
  title: string;
  subtitle: string;
  animation: string;
};

export const ADMIN_SECTION_STORAGE_KEY = "botadmin.admin.section";
export const ADMIN_RAIL_STORAGE_KEY = "botadmin.admin.rail";
export const ADMIN_MOBILE_VIEW_STORAGE_KEY = "botadmin.admin.mobileView";
export const ADMIN_MOBILE_BREAKPOINT = 980;

export const ADMIN_RAIL_ITEMS: Array<{
  id: AdminRailSection;
  title: string;
  animation: string;
}> = [
  { id: "dashboard", title: "Painel", animation: "/animations/botadmin/AiChatting.json" },
  { id: "support", title: "Suporte", animation: "/animations/botadmin/ChatAnimation.json" },
  { id: "users", title: "Usuários", animation: "/animations/botadmin/GroupChatAnimation.json" },
  { id: "infrastructure", title: "Infraestrutura", animation: "/animations/botadmin/ApiTesting.json" },
  { id: "bot", title: "Bot", animation: "/animations/botadmin/WhatsAppCloudApi.json" },
  { id: "campaigns", title: "Campanhas", animation: "/animations/botadmin/MarketAds.json" },
  { id: "business", title: "Negócios", animation: "/animations/botadmin/GradientDiamond.json" },
  { id: "settings", title: "Configurações", animation: "/animations/botadmin/ApiTesting.json" },
];

export const ADMIN_MENU_ITEMS: AdminMenuItem[] = [
  {
    id: "dashboard",
    rail: "dashboard",
    title: "Painel",
    subtitle: "Indicadores e resumo da plataforma",
    animation: "/animations/botadmin/AiChatting.json",
  },
  {
    id: "support",
    rail: "support",
    title: "Suporte",
    subtitle: "Conversas com lojistas em tempo real",
    animation: "/animations/botadmin/ChatAnimation.json",
  },
  {
    id: "users",
    rail: "users",
    title: "Usuários",
    subtitle: "Contas, planos e permissões",
    animation: "/animations/botadmin/GroupChatAnimation.json",
  },
  {
    id: "instances",
    rail: "infrastructure",
    title: "Instâncias",
    subtitle: "WhatsApps conectados pelos usuários",
    animation: "/animations/botadmin/WhatsAppCloudApi.json",
  },
  {
    id: "servers",
    rail: "infrastructure",
    title: "Servidores",
    subtitle: "Hosts Wuzapi e limites de sessão",
    animation: "/animations/botadmin/ApiTesting.json",
  },
  {
    id: "botinterage",
    rail: "bot",
    title: "BotInterage",
    subtitle: "APIs de IA e TTS autorizadas",
    animation: "/animations/botadmin/AiChatting.json",
  },
  {
    id: "mega",
    rail: "bot",
    title: "Mega downloader",
    subtitle: "Credenciais do autodownloader Mega.NZ",
    animation: "/animations/botadmin/CloudDownload.json",
  },
  {
    id: "groups",
    rail: "bot",
    title: "Grupos do bot",
    subtitle: "Grupos vinculados aos usuários",
    animation: "/animations/botadmin/GroupChatAnimation.json",
  },
  {
    id: "campaigns",
    rail: "campaigns",
    title: "Campanhas",
    subtitle: "Envios em massa com modelos Meta",
    animation: "/animations/botadmin/MarketAds.json",
  },
  {
    id: "plans",
    rail: "business",
    title: "Planos",
    subtitle: "Assinaturas e limites de instâncias",
    animation: "/animations/botadmin/GradientDiamond.json",
  },
  {
    id: "payments",
    rail: "business",
    title: "Pagamentos",
    subtitle: "Pix e confirmações de assinatura",
    animation: "/animations/botadmin/PaymentPending.json",
  },
  {
    id: "affiliates",
    rail: "business",
    title: "Afiliados",
    subtitle: "Provedores e OAuth das plataformas",
    animation: "/animations/botadmin/OnlineShopping.json",
  },
  {
    id: "site",
    rail: "settings",
    title: "Config. do site",
    subtitle: "Identidade visual e conteúdo público",
    animation: "/animations/botadmin/ApiTesting.json",
  },
  {
    id: "firebase",
    rail: "settings",
    title: "Firebase",
    subtitle: "Push notifications e credenciais",
    animation: "/animations/botadmin/ApiTesting.json",
  },
  {
    id: "aplicativo",
    rail: "settings",
    title: "Aplicativo",
    subtitle: "APK Android, ícone e assinatura",
    animation: "/animations/botadmin/CommandsOrange.json",
  },
  {
    id: "notificacoes",
    rail: "settings",
    title: "Notificações",
    subtitle: "SMTP, e-mails e cobranças",
    animation: "/animations/botadmin/ChatAnimation.json",
  },
  {
    id: "linksuteis",
    rail: "settings",
    title: "Links úteis",
    subtitle: "Banners e atalhos oficiais",
    animation: "/animations/botadmin/ApiTesting.json",
  },
  {
    id: "tutoriais",
    rail: "settings",
    title: "Tutoriais",
    subtitle: "Materiais de apoio no painel",
    animation: "/animations/botadmin/ChatAnimation.json",
  },
];

const VALID_DETAIL_SECTIONS = new Set<AdminDetailSection>(
  ADMIN_MENU_ITEMS.map((item) => item.id),
);

export const resolveAdminDetailSection = (
  value: string | null | undefined,
  fallback: AdminDetailSection = "dashboard",
): AdminDetailSection => {
  if (value && VALID_DETAIL_SECTIONS.has(value as AdminDetailSection)) {
    return value as AdminDetailSection;
  }
  return fallback;
};

export const resolveAdminRailSection = (
  detail: AdminDetailSection,
): AdminRailSection => {
  return ADMIN_MENU_ITEMS.find((item) => item.id === detail)?.rail ?? "dashboard";
};

export const isAdminFullWidthSection = (section: AdminDetailSection): boolean =>
  section === "support";

export const isAdminModuleSection = (section: AdminDetailSection): boolean =>
  section !== "dashboard" && section !== "support";

export const getAdminMenuItemsForRail = (rail: AdminRailSection): AdminMenuItem[] =>
  ADMIN_MENU_ITEMS.filter((item) => item.rail === rail);

export const ADMIN_LEGACY_ROUTE_SECTION: Record<string, AdminDetailSection> = {
  "/dashboard/admin": "dashboard",
  "/dashboard/admin/suporte": "support",
  "/dashboard/admin/users": "users",
  "/dashboard/admin/instancias": "instances",
  "/dashboard/admin/servidores": "servers",
  "/dashboard/admin/bot": "botinterage",
  "/dashboard/admin/botinterage": "botinterage",
  "/dashboard/admin/mega": "mega",
  "/dashboard/admin/grupos": "groups",
  "/dashboard/admin/campanhas": "campaigns",
  "/dashboard/admin/planos": "plans",
  "/dashboard/admin/pagamentos": "payments",
  "/dashboard/admin/afiliados": "affiliates",
  "/dashboard/admin/site": "site",
  "/dashboard/admin/firebase": "firebase",
  "/dashboard/admin/aplicativo": "aplicativo",
  "/dashboard/admin/notificacoes": "notificacoes",
  "/dashboard/admin/linksuteis": "linksuteis",
  "/dashboard/admin/tutoriais": "tutoriais",
};

export const resolveLegacyAdminSection = (
  pathname: string,
): AdminDetailSection => {
  return ADMIN_LEGACY_ROUTE_SECTION[pathname] ?? "dashboard";
};