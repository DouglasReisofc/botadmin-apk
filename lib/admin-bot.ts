import path from "path";
import { promises as fs } from "fs";

import { formatCurrency, formatDate, formatDateTime } from "lib/format";
import { getAllSubscriptionPlans, getUserPlanStatus } from "lib/plans";
import { getAdminSiteSettings } from "lib/admin-site";
import type { SessionUser } from "types/auth";
import type { PlanAddonSelection, SubscriptionPlan, UserPlanStatus } from "types/plans";
import type { AdminBotConfig } from "types/admin-bot";
import type { BotGroup } from "types/bot-groups";
import type { MetaWebhookCredentials, MetaMessagePayload } from "lib/meta";
import type { BotInstanceAction, BotInstanceStatus } from "types/bot-instances";
import {
  dispatchMetaMessage,
  sendDocumentFromUrl,
  sendInteractiveCtaUrlMessage,
  sendInteractiveReplyButtonsMessage,
  sendMediaMessage,
  sendTextMessage,
  uploadImageFromBase64,
  saveBase64ImageToPublicUrl,
} from "lib/meta";
import { META_INTERACTIVE_BODY_LIMIT, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, META_INTERACTIVE_ROW_TITLE_LIMIT, META_INTERACTIVE_SECTION_TITLE_LIMIT } from "lib/meta-limits";
import { createPlanAddonCheckoutPreference, createPlanAddonPixCharge, createPlanCheckoutPreference, createPlanPixCharge } from "lib/plan-payments";
import { getAdminMercadoPagoCheckoutConfig, getAdminMercadoPagoPixConfig, getAdminPoloPagPixConfig } from "lib/admin-payments";
import { getAdminBotConfig } from "lib/admin-bot-config";
import { UPLOADS_STORAGE_ROOT } from "lib/uploads";
import {
  deleteInstanceForUser,
  getInstanceForUser,
  listInstancesForAdmin,
  performInstanceAction,
  refreshInstanceStatus,
  requestPairingCode,
} from "lib/bot-instances";
import { getActiveBotServers } from "lib/bot-servers";
import {
  listGroupsForUser,
  deleteGroupForUser,
} from "lib/bot-groups";
import { updateAdminBotSessionFlow } from "lib/admin-bot-sessions";

const APP_BASE_URL = (() => {
  const raw = process.env.APP_URL?.trim();
  if (!raw) {
    return "http://botadmin.shop";
  }

  try {
    const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    new URL(normalized);
    return normalized;
  } catch {
    return "http://botadmin.shop";
  }
})();

const MAX_LIST_ROWS = 10;
const MENU_TEXT_LIMIT = 1024;
const BUTTON_TITLE_LIMIT = 20;
// Prefixos de categoria mantidos para dados existentes do painel.
const ADMIN_CATEGORY_ROW_PREFIX = "admin_category_";
const ADMIN_CATEGORY_NEXT_PREFIX = "admin_category_next_";
const ADMIN_CATEGORY_RENAME_PREFIX = "admin_category_rename_";
const ADMIN_CATEGORY_PRICE_PREFIX = "admin_category_price_";
const ADMIN_CATEGORY_SKU_PREFIX = "admin_category_sku_";
const ADMIN_CATEGORY_RENAME_NEXT_PREFIX = "admin_category_rename_next_";
const ADMIN_CATEGORY_PRICE_NEXT_PREFIX = "admin_category_price_next_";
const ADMIN_CATEGORY_SKU_NEXT_PREFIX = "admin_category_sku_next_";
export const ADMIN_PLAN_ROW_PREFIX = "admin_plan_";
export const ADMIN_PLAN_PAY_PIX_PREFIX = "admin_plan_pay_pix_";
export const ADMIN_PLAN_PAY_POLOPAG_PREFIX = "admin_plan_pay_polopag_";
export const ADMIN_PLAN_PAY_CHECKOUT_PREFIX = "admin_plan_pay_checkout_";
export const ADMIN_PLAN_ADDON_ROW_ID = "admin_plan_addon";
export const ADMIN_PLAN_ADDON_TYPE_INSTANCE_ID = "admin_plan_addon_type_instance";
export const ADMIN_PLAN_ADDON_TYPE_GROUP_ID = "admin_plan_addon_type_group";
export const ADMIN_PLAN_ADDON_QUANTITY_PREFIX = "admin_plan_addon_quantity_";
export const ADMIN_PLAN_ADDON_QUANTITY_CUSTOM_PREFIX = "admin_plan_addon_quantity_custom_";
export const ADMIN_PLAN_ADDON_PAY_PIX_PREFIX = "admin_plan_addon_pay_pix_";
export const ADMIN_PLAN_ADDON_PAY_POLOPAG_PREFIX = "admin_plan_addon_pay_polopag_";
export const ADMIN_PLAN_ADDON_PAY_CHECKOUT_PREFIX = "admin_plan_addon_pay_checkout_";
const ADMIN_EXPORT_DIR = path.resolve(UPLOADS_STORAGE_ROOT, "admin-bot");

export type AdminPlanPaymentMethod = "mercadopago_pix" | "polopag_pix" | "mercadopago_checkout";
const PLAN_PAYMENT_METHOD_PRIORITY: readonly AdminPlanPaymentMethod[] = [
  "mercadopago_pix",
  "polopag_pix",
  "mercadopago_checkout",
] as const;

export const ADMIN_MENU_BUTTON_IDS = {
  panel: "admin_menu_panel",
  home: "admin_menu_home",
  subscription: "admin_menu_subscription",
  support: "admin_menu_support",
} as const;

export const ADMIN_SUBSCRIPTION_BUTTON_IDS = {
  renew: "admin_subscription_renew",
  change: "admin_subscription_change",
  details: "admin_subscription_details",
  start: "admin_subscription_start",
} as const;

export const ADMIN_PANEL_LIST_IDS = {
  groups: "admin_panel_groups",
  instances: "admin_panel_instances",
  web: "admin_panel_web",
  back: "admin_panel_back",
} as const;

export const ADMIN_GROUP_ACTION_LIST_IDS = {
  list: "admin_group_action_list",
  create: "admin_group_action_create",
  remove: "admin_group_action_remove",
  back: "admin_group_action_back",
} as const;

export const ADMIN_INSTANCE_LIST_IDS = {
  create: "admin_instance_create",
  back: "admin_instance_back",
} as const;

export const ADMIN_INSTANCE_ROW_PREFIX = "admin_instance_row_";
export const ADMIN_INSTANCE_NEXT_PREFIX = "admin_instance_next_";
export const ADMIN_INSTANCE_CREATE_SERVER_PREFIX = "admin_instance_create_server_";

export const ADMIN_INSTANCE_ACTION_PREFIX = {
  status: "admin_instance_status_",
  reconnect: "admin_instance_reconnect_",
  disconnect: "admin_instance_disconnect_",
  connect: "admin_instance_connect_",
  pair: "admin_instance_pair_",
  delete: "admin_instance_delete_",
  back: "admin_instance_back_",
  confirmDelete: "admin_instance_confirm_delete_",
  cancelDelete: "admin_instance_cancel_delete_",
} as const;

export const ADMIN_GROUP_ROW_PREFIX = "admin_group_row_";
export const ADMIN_GROUP_NEXT_PREFIX = "admin_group_next_";
export const ADMIN_GROUP_DELETE_PREFIX = "admin_group_delete_";
export const ADMIN_GROUP_DELETE_NEXT_PREFIX = "admin_group_delete_next_";
export const ADMIN_GROUP_CONFIRM_DELETE_PREFIX = "admin_group_confirm_delete_";
export const ADMIN_GROUP_CANCEL_DELETE_PREFIX = "admin_group_cancel_delete_";
export const ADMIN_GROUP_CREATE_INSTANCE_PREFIX = "admin_group_create_instance_";
export const ADMIN_GROUP_BUTTON_IDS = {
  back: "admin_group_back",
} as const;
export const ADMIN_GROUP_EDIT_PREFIX = "admin_group_edit_";

export const ADMIN_GROUP_LIST_BACK_ID = "admin_group_list_back";

export const ADMIN_FLOW_BUTTON_IDS = {
  cancel: "admin_flow_cancel",
} as const;

const truncate = (value: string, limit: number) => {
  if (value.length <= limit) {
    return value;
  }

  if (limit <= 1) {
    return value.slice(0, limit);
  }

  return `${value.slice(0, limit - 1)}…`;
};

// Rótulos de listas do WhatsApp exigem texto curto e não vazio.
// Esta sanitização evita títulos/descrições vazios que podem aparecer como "…" no app.
const sanitizeListLabel = (text: unknown, limit: number, fallback = "Opção") => {
  const raw = typeof text === "string" ? text : String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const replaceTokens = (template: string, replacements: Record<string, string>) => {
  return Object.entries(replacements).reduce((text, [token, replacement]) => {
    if (!token) {
      return text;
    }

    const pattern = new RegExp(escapeRegExp(token), "gi");
    return text.replace(pattern, replacement);
  }, template);
};

const DEFAULT_BOT_NAME = "StoreBot";

export const applyConfigTokens = (
  template: string,
  config: AdminBotConfig,
  replacements: Record<string, string>,
) => {
  const botName = config.botName?.trim() || DEFAULT_BOT_NAME;
  if (Object.prototype.hasOwnProperty.call(replacements, "{{bot_name}}")) {
    return replaceTokens(template, replacements);
  }
  return replaceTokens(template, { "{{bot_name}}": botName, ...replacements });
};

export const sendAdminMainMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  config: AdminBotConfig;
  extraInfo?: {
    number?: string | null;
    pushName?: string | null;
    planExpiresAt?: string | Date | null;
    planName?: string | null;
  };
}) => {
  const { webhook, to, user, config, extraInfo } = options;

  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
  const userNumber = (extraInfo?.number ?? "").trim();
  const push = (extraInfo?.pushName ?? "").trim();
  const planRenewLabel = (() => {
    if (!extraInfo?.planExpiresAt) return "Sem plano ativo";
    return typeof extraInfo.planExpiresAt === 'string'
      ? formatDate(extraInfo.planExpiresAt)
      : formatDate(extraInfo.planExpiresAt.toISOString());
  })();

  const planNameLabel = (() => {
    const name = (extraInfo?.planName ?? "").trim();
    return name || "Sem plano ativo";
  })();

  const baseReplacements = {
    "{{user_first_name}}": firstName,
    "{{user_name}}": user.name,
    "{{user_number}}": userNumber,
    "{{push_name}}": push,
    "{{plan_renews_at}}": planRenewLabel,
    "{{plan_name}}": planNameLabel,
  } satisfies Record<string, string>;

  const bodyText = truncate(
    applyConfigTokens(config.menuText, config, baseReplacements),
    MENU_TEXT_LIMIT,
  );

  const buttons: Array<
    | { type: "reply"; reply: { id: string; title: string } }
    | { type: "url"; url: { title: string; link: string } }
  > = [
    {
      type: "reply",
      reply: {
        id: ADMIN_MENU_BUTTON_IDS.panel,
        title: truncate(applyConfigTokens(config.panelButtonText, config, baseReplacements), BUTTON_TITLE_LIMIT),
      },
    },
    {
      type: "reply",
      reply: {
        id: ADMIN_MENU_BUTTON_IDS.subscription,
        title: truncate(applyConfigTokens(config.subscriptionButtonText, config, baseReplacements), BUTTON_TITLE_LIMIT),
      },
    },
  ];

  const supportButtonTitle = truncate(
    applyConfigTokens(config.supportButtonText, config, baseReplacements),
    BUTTON_TITLE_LIMIT,
  );
  buttons.push({
    type: "reply",
    reply: {
      id: ADMIN_MENU_BUTTON_IDS.support,
      title: supportButtonTitle,
    },
  });

  const interactive: Record<string, unknown> = {
    type: "button",
    body: {
      text: bodyText,
    },
    action: {
      buttons,
    },
  };

  const footer = config.menuFooterText?.trim();
  if (footer) {
    interactive.footer = {
      text: truncate(applyConfigTokens(footer, config, baseReplacements), 60),
    };
  }

  // Prefer absolute link built from stored path; fallback to configured URL
  let headerImageLink: string | null = null;
  if (config.menuImagePath) {
    const normalized = config.menuImagePath.replace(/^\/+/, "");
    headerImageLink = `${APP_BASE_URL}/${normalized}`;
  } else if (config.menuImageUrl && !config.menuImageUrl.includes("undefined")) {
    headerImageLink = config.menuImageUrl;
  }

  if (headerImageLink) {
    interactive.header = {
      type: "image",
      image: {
        link: headerImageLink,
      },
    };
  }

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive,
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Menu administrativo enviado para ${to}`,
    failureLog: `Falha ao enviar menu administrativo para ${to}`,
  });
};

export const sendAdminPanelMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  availability?: {
    canManageGroups?: boolean;
    canManageInstances?: boolean;
  };
}) => {
  const { webhook, to, availability } = options;
  const config = await getAdminBotConfig();

  const canManageInstances = availability?.canManageInstances ?? true;
  const canManageGroups = availability?.canManageGroups ?? true;

  const rows: Array<{ id: string; title: string; description?: string }> = [];

  if (canManageGroups) {
    rows.push({
      id: ADMIN_PANEL_LIST_IDS.groups,
      title: truncate(config.panelGroupsRowTitle || "Gerenciar grupos", META_INTERACTIVE_ROW_TITLE_LIMIT),
      description: truncate(config.panelGroupsRowDescription || "Cadastrar, listar e remover grupos.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
    });
  }

  if (canManageInstances) {
    rows.push({
      id: ADMIN_PANEL_LIST_IDS.instances,
      title: truncate(config.panelInstancesRowTitle || "Gerenciar instâncias", META_INTERACTIVE_ROW_TITLE_LIMIT),
      description: truncate(config.panelInstancesRowDescription || "Conectar, parear ou remover suas instâncias.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
    });
  }

  // Link para o painel web
  rows.push({
    id: ADMIN_PANEL_LIST_IDS.web,
    title: truncate(config.panelWebRowTitle || "🌐 Painel web", META_INTERACTIVE_ROW_TITLE_LIMIT),
    description: truncate(config.panelWebRowDescription || "Abra o painel no navegador para gerenciar tudo.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
  });

  rows.push({
    id: ADMIN_PANEL_LIST_IDS.back,
    title: truncate(config.panelBackRowTitle || "Voltar", META_INTERACTIVE_ROW_TITLE_LIMIT),
    description: truncate(config.panelBackRowDescription || "Retornar ao menu principal.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
  });

  const actionableRows = rows.filter((row) => row.id !== ADMIN_PANEL_LIST_IDS.back);
  if (actionableRows.length === 0) {
    await sendTextMessage({
      webhook,
      to,
      text: "Nenhuma ação disponível no momento. Finalize as etapas anteriores para liberar o painel.",
    });
    return;
  }

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: truncate(applyConfigTokens(config.panelHeaderText || "Painel administrativo", config, {}), 60) },
      body: {
        text: truncate(applyConfigTokens(config.panelBodyText || "Escolha o que deseja gerenciar agora.", config, {}), META_INTERACTIVE_BODY_LIMIT),
      },
      action: {
        button: truncate(config.groupActionsButtonText || "Abrir opções", BUTTON_TITLE_LIMIT),
        sections: [
          {
            title: "Painel",
            rows: rows.map((row) => ({
              id: row.id,
              title: sanitizeListLabel(row.title, META_INTERACTIVE_ROW_TITLE_LIMIT, row.title || "Opção"),
              description: row.description
                ? sanitizeListLabel(row.description, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any)
                : undefined,
            })),
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Menu do painel administrativo enviado para ${to}`,
    failureLog: `Falha ao enviar menu do painel administrativo para ${to}`,
  });
};

export const sendAdminInstanceSetupReminder = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  appUrl?: string;
}) => {
  const { webhook, to, appUrl } = options;
  const targetUrl = (appUrl ?? APP_BASE_URL) + "/dashboard/user/configurar-bot";

  await sendInteractiveCtaUrlMessage({
    webhook,
    to,
    bodyText:
      "Você ainda não possui instâncias vinculadas. Abra o painel do StoreBot para cadastrar e parear uma instância antes de continuar.",
    buttonText: "Abrir painel",
    buttonUrl: targetUrl,
    headerText: "Configurar instância",
    footerText: "Depois de parear o número, volte aqui para administrar pelo WhatsApp.",
  });
};

export const sendAdminGroupSetupReminder = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  appUrl?: string;
}) => {
  const { webhook, to, appUrl } = options;
  const targetUrl = (appUrl ?? APP_BASE_URL) + "/dashboard/user/grupos";

  await sendInteractiveCtaUrlMessage({
    webhook,
    to,
    bodyText:
      "Cadastre pelo menos um grupo no painel do StoreBot antes de gerenciar as automações por aqui.",
    buttonText: "Abrir grupos",
    buttonUrl: targetUrl,
    headerText: "Configurar grupos",
    footerText: "Assim que o grupo estiver pronto, volte para continuar pelo WhatsApp.",
  });
};

export const sendAdminWebPanelLink = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;
  const config = await getAdminBotConfig();
  await sendInteractiveCtaUrlMessage({
    webhook,
    to,
    headerText: truncate(config.webPanelHeaderText || "🌐 Painel web", 60),
    bodyText: truncate(
      config.webPanelBodyText ||
        "Gerencie seu StoreBot pelo computador: configure planos, instâncias, grupos e recursos avançados de forma completa.",
      META_INTERACTIVE_BODY_LIMIT,
    ),
    buttonText: truncate(config.webPanelButtonText || "Abrir painel web", BUTTON_TITLE_LIMIT),
    buttonUrl: `${APP_BASE_URL}/dashboard/user`,
  });
};

export const sendAdminGroupActionsMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;
  const config = await getAdminBotConfig();

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: truncate(applyConfigTokens(config.groupActionsHeaderText || "Grupos", config, {}), 60) },
      body: { text: truncate(applyConfigTokens(config.groupActionsBodyText || "O que você deseja fazer com os grupos?", config, {}), META_INTERACTIVE_BODY_LIMIT) },
      action: {
        button: truncate(config.groupActionsButtonText || "Escolher", BUTTON_TITLE_LIMIT),
        sections: [
          {
            title: truncate(config.panelGroupsRowTitle || "Gerenciar grupos", META_INTERACTIVE_SECTION_TITLE_LIMIT),
            rows: [
              { id: ADMIN_GROUP_ACTION_LIST_IDS.list, title: truncate(config.groupActionsListTitle || "Listar grupos", META_INTERACTIVE_ROW_TITLE_LIMIT), description: truncate(config.groupActionsListDesc || "Ver grupos cadastrados.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT) },
              { id: ADMIN_GROUP_ACTION_LIST_IDS.create, title: truncate(config.groupActionsCreateTitle || "Cadastrar grupo", META_INTERACTIVE_ROW_TITLE_LIMIT), description: truncate(config.groupActionsCreateDesc || "Adicionar um novo grupo.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT) },
              { id: ADMIN_GROUP_ACTION_LIST_IDS.remove, title: truncate(config.groupActionsRemoveTitle || "Excluir grupo", META_INTERACTIVE_ROW_TITLE_LIMIT), description: truncate(config.groupActionsRemoveDesc || "Remover um grupo existente.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT) },
              { id: ADMIN_GROUP_ACTION_LIST_IDS.back, title: truncate(config.groupActionsBackTitle || "Voltar", META_INTERACTIVE_ROW_TITLE_LIMIT), description: truncate(config.groupActionsBackDesc || "Retornar ao painel.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT) },
            ].map((row) => ({
              id: row.id,
              title: sanitizeListLabel(row.title, META_INTERACTIVE_ROW_TITLE_LIMIT, row.title),
              description: row.description
                ? sanitizeListLabel(row.description, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any)
                : undefined,
            })),
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Menu de ações de grupos enviado para ${to}`,
    failureLog: `Falha ao enviar menu de ações de grupos para ${to}`,
  });
};

export const sendAdminGroupListMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  page?: number;
}) => {
  const { webhook, to, user } = options;
  const page = options.page ?? 1;
  const groups = await listGroupsForUser(user.id);

  if (groups.length === 0) {
    await sendTextMessage({
      webhook,
      to,
      text: "Nenhum grupo cadastrado até o momento.",
    });
    return { page: 1, totalPages: 1 };
  }

  const itemsPerPage = Math.max(1, MAX_LIST_ROWS - 1);
  const totalPages = Math.max(1, Math.ceil(groups.length / itemsPerPage));
  const sanitized = Math.min(Math.max(page, 1), totalPages);
  const start = (sanitized - 1) * itemsPerPage;
  let slice = groups.slice(start, start + itemsPerPage);
  const hasMore = groups.length > sanitized * itemsPerPage;
  if (hasMore && slice.length >= itemsPerPage) {
    slice = slice.slice(0, Math.max(0, itemsPerPage - 1));
  }

  const rows = slice.map((g) => ({
    id: `${ADMIN_GROUP_ROW_PREFIX}${g.id}`,
    title: sanitizeListLabel(g.name || g.remoteId || "Grupo", META_INTERACTIVE_ROW_TITLE_LIMIT, "Grupo"),
    description: sanitizeListLabel(
      `${g.metadata?.adminsOnly ? "Somente admins" : "Aberto"} · ${g.chatId ?? g.remoteId ?? ""}`,
      META_INTERACTIVE_ROW_DESCRIPTION_LIMIT,
      undefined as any,
    ),
  }));

  if (hasMore) {
    const next = sanitized + 1;
    rows.push({
      id: `${ADMIN_GROUP_NEXT_PREFIX}${next}`,
      title: sanitizeListLabel(`Próxima página (${next}/${totalPages})`, META_INTERACTIVE_ROW_TITLE_LIMIT, "Próxima página"),
      description: sanitizeListLabel("Ver mais grupos", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
    } as any);
  }

  // Voltar
  rows.push({
    id: ADMIN_GROUP_LIST_BACK_ID,
    title: "Voltar",
    description: sanitizeListLabel("Retornar ao menu de grupos", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
  } as any);

  const interactive: Record<string, unknown> = {
    type: "list",
    header: { type: "text", text: "Grupos vinculados" },
    body: { text: `Você possui ${groups.length} grupo(s).` },
    action: {
      button: "Selecionar",
      sections: [
        {
          title: "Grupos",
          rows: rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
        },
      ],
    },
  };

  await dispatchMetaMessage(webhook, { messaging_product: "whatsapp", to, type: "interactive", interactive }, {
    successLog: `Lista de grupos enviada para ${to}`,
    failureLog: `Falha ao enviar lista de grupos para ${to}`,
  });

  return { page: sanitized, totalPages };
};

export const sendAdminGroupCreateInstancePicker = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
}) => {
  const { webhook, to, user } = options;
  const config = await getAdminBotConfig();
  const instances = (await listInstancesForAdmin({ userId: user.id }))
    .filter((i) => i.sessionStatus === "conectado");

  if (instances.length === 0) {
    await sendTextMessage({ webhook, to, text: "Nenhuma instância conectada. Conecte uma instância antes de cadastrar grupos." });
    return;
  }

  if (instances.length === 1) {
    const inst = instances[0];
    await sendAdminGroupCreatePromptForInstance({ webhook, to, instanceId: inst.id });
    return;
  }

  const rows = instances.slice(0, MAX_LIST_ROWS - 1).map((inst) => ({
    id: `${ADMIN_GROUP_CREATE_INSTANCE_PREFIX}${inst.id}`,
    title: sanitizeListLabel(inst.name || inst.phone, META_INTERACTIVE_ROW_TITLE_LIMIT, "Instância"),
    description: sanitizeListLabel(`Número: ${inst.phone}`, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
  }));

  rows.push({ id: ADMIN_GROUP_ACTION_LIST_IDS.back, title: "Voltar", description: "Retornar" } as any);

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: truncate(applyConfigTokens(config.groupSelectInstanceHeaderText || "Selecionar instância", config, {}), 60) },
      body: { text: truncate(applyConfigTokens(config.groupSelectInstanceBodyText || "Escolha a instância para cadastrar o grupo.", config, {}), META_INTERACTIVE_BODY_LIMIT) },
      action: { button: truncate(config.groupSelectInstanceButtonText || "Selecionar", BUTTON_TITLE_LIMIT), sections: [{ title: "Instâncias", rows }] },
    },
  }, {
    successLog: `Picker de instância enviado para ${to}`,
    failureLog: `Falha ao enviar picker de instância para ${to}`,
  });
};

export const sendAdminGroupCreatePromptForInstance = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  instanceId: number;
}) => {
  const { webhook, to, instanceId } = options;
  const config = await getAdminBotConfig();
  const headerText = truncate(applyConfigTokens(config.groupCreateHeaderText, config, {}), 60);
  const bodyText = truncate(applyConfigTokens(config.groupCreateBodyText, config, {}), META_INTERACTIVE_BODY_LIMIT);
  const footerRaw = config.groupCreateFooterText?.trim();
  const footerText = footerRaw ? truncate(applyConfigTokens(footerRaw, config, {}), 60) : undefined;

  await sendInteractiveReplyButtonsMessage({
    webhook,
    to,
    headerText,
    bodyText,
    footerText,
    buttons: [
      { id: ADMIN_FLOW_BUTTON_IDS.cancel, title: truncate(config.groupCreateCancelButtonText, BUTTON_TITLE_LIMIT) },
    ],
  });

  await updateAdminBotSessionFlow(to, { name: "group_create_input", instanceId });
};

export const sendAdminGroupDeletionList = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  page?: number;
}) => {
  const { webhook, to, user } = options;
  const page = options.page ?? 1;
  const groups = await listGroupsForUser(user.id);

  if (groups.length === 0) {
    await sendTextMessage({ webhook, to, text: "Nenhum grupo para excluir." });
    return;
  }

  const perPage = Math.max(1, MAX_LIST_ROWS - 1);
  const totalPages = Math.max(1, Math.ceil(groups.length / perPage));
  const sanitized = Math.min(Math.max(page, 1), totalPages);
  const start = (sanitized - 1) * perPage;
  let slice = groups.slice(start, start + perPage);
  const hasMore = groups.length > sanitized * perPage;
  if (hasMore && slice.length >= perPage) {
    slice = slice.slice(0, Math.max(0, perPage - 1));
  }

  const rows = slice.map((g) => ({
    id: `${ADMIN_GROUP_DELETE_PREFIX}${g.id}`,
    title: sanitizeListLabel(g.name || g.remoteId || "Grupo", META_INTERACTIVE_ROW_TITLE_LIMIT, "Grupo"),
    description: sanitizeListLabel(g.chatId ?? g.remoteId ?? "", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
  }));

  if (hasMore) {
    const next = sanitized + 1;
    rows.push({
      id: `${ADMIN_GROUP_DELETE_NEXT_PREFIX}${next}`,
      title: sanitizeListLabel(`Próxima página (${next}/${totalPages})`, META_INTERACTIVE_ROW_TITLE_LIMIT, "Próxima página"),
      description: sanitizeListLabel("Ver mais grupos", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
    } as any);
  }

  rows.push({ id: ADMIN_GROUP_ACTION_LIST_IDS.back, title: "Voltar", description: "Retornar" } as any);

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Excluir grupo" },
      body: { text: "Selecione o grupo que deseja remover." },
      action: { button: "Selecionar", sections: [{ title: "Grupos", rows }] },
    },
  }, { successLog: `Lista de remoção de grupos enviada para ${to}`, failureLog: `Falha ao enviar lista de remoção de grupos para ${to}` });
};

export const sendAdminGroupDeletionPrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  groupId: number;
}) => {
  const { webhook, to, groupId } = options;
  const config = await getAdminBotConfig();
  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: truncate(applyConfigTokens(config.groupDeletePromptBodyText || "Confirmar exclusão do grupo?", config, {}), META_INTERACTIVE_BODY_LIMIT) },
      action: { buttons: [
        { type: "reply", reply: { id: `${ADMIN_GROUP_CONFIRM_DELETE_PREFIX}${groupId}`, title: truncate(config.groupDeleteConfirmButtonText || "Confirmar", BUTTON_TITLE_LIMIT) } },
        { type: "reply", reply: { id: `${ADMIN_GROUP_CANCEL_DELETE_PREFIX}${groupId}`, title: truncate(config.groupDeleteCancelButtonText || "Cancelar", BUTTON_TITLE_LIMIT) } },
      ]},
    },
  }, { successLog: `Prompt de exclusão enviado para ${to}`, failureLog: `Falha ao enviar prompt de exclusão para ${to}` });
};

export const handleAdminGroupDeletion = async (options: { webhook: MetaWebhookCredentials; to: string; user: SessionUser; groupId: number }) => {
  const { webhook, to, user, groupId } = options;
  try {
    await deleteGroupForUser(user.id, groupId);
    await sendTextMessage({ webhook, to, text: "🗑️ Grupo excluído com sucesso." });
    // Exibe novamente o menu de grupos para continuidade do fluxo
    await sendAdminGroupActionsMenu({ webhook, to });
  } catch (error) {
    console.error("[Admin Bot] Falha ao excluir grupo", error);
    await sendTextMessage({ webhook, to, text: "⚠️ Não foi possível excluir o grupo agora." });
  }
};

const formatInstanceStatusLabel = (status: BotInstanceStatus): string => {
  switch (status) {
    case "conectado":
      return "Conectada";
    case "aguardando_qr":
      return "Aguardando QR";
    case "aguardando_pareamento":
      return "Aguardando pareamento";
    case "inicializando":
      return "Inicializando";
    default:
      return "Desconectada";
  }
};

const buildInstanceStatusHelp = (status: BotInstanceStatus): string[] => {
  switch (status) {
    case "conectado":
      return [
        "✅ Tudo certo. Se algo não responder, toque em ‘🔄 Reconectar’.",
      ];
    case "aguardando_qr":
      return [
        "🧩 Falta parear no WhatsApp.",
        "Toque em ‘🆔 Gerar código’ para receber o código/QR e concluir o pareamento.",
      ];
    case "aguardando_pareamento":
      return [
        "🧩 Falta concluir o pareamento.",
        "Se preferir, gere um novo código com ‘🆔 Gerar código’.",
      ];
    case "inicializando":
      return [
        "⏳ Estamos iniciando a sessão. Aguarde alguns instantes e toque em ‘🔎 Ver status’.",
      ];
    default:
      return [
        "⚠️ A sessão está desconectada.",
        "Use ‘🔌 Conectar’ para iniciar/retomar a sessão ou ‘🆔 Gerar código’ para parear.",
      ];
  }
};

const formatInstancePhone = (phone: string): string => {
  const digits = (phone || "").replace(/\D+/g, "");
  return digits || phone.trim() || "—";
};

const phoneFromJid = (jid: string | null | undefined): string => {
  const raw = typeof jid === "string" ? jid : "";
  const digits = raw.replace(/\D+/g, "");
  return digits || (raw || "");
};

const mapEphemeralLabel = (value: string | null | undefined): string => {
  const v = (value || "").toLowerCase();
  switch (v) {
    case "24h":
      return "24 horas";
    case "7d":
      return "7 dias";
    case "90d":
      return "90 dias";
    default:
      return "Desativado";
  }
};

export const sendAdminGroupDetailsMessage = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  group: BotGroup;
  header?: string | null;
}) => {
  const { webhook, to, group, header } = options;

  const admins = (group.participants || []).filter((p) => p.admin !== "member");
  const ownerDigits = phoneFromJid(group.owner || null);
  const headerImageUrl =
    typeof group.imageUrl === "string" && group.imageUrl.trim().length > 0
      ? group.imageUrl.trim()
      : null;

  const lines: string[] = [];
  if (header) lines.push(header);
  lines.push(
    `📛 Nome: ${group.name}`,
    `🆔 JID: ${group.remoteId}`,
    `👑 Dono: ${formatInstancePhone(ownerDigits)}`,
  );

  const statusParts: string[] = [];
  statusParts.push(group.metadata?.adminsOnly ? "Somente admins" : "Aberto");
  if (group.metadata?.locked) statusParts.push("Config travadas");
  if (group.metadata?.ephemeral) statusParts.push(`Temporárias: ${mapEphemeralLabel(group.metadata.ephemeral)}`);
  lines.push(`🔒 Status: ${statusParts.join(" • ")}`);

  if (admins.length > 0) {
    lines.push("\n👥 Admins:");
    const sample = admins.slice(0, 12); // limita exibição
    for (const p of sample) {
      const phone = formatInstancePhone(phoneFromJid(p.id));
      const badge = p.admin === "superadmin" ? "(Dono)" : p.admin === "admin" ? "(Admin)" : "";
      lines.push(`• ${phone} ${badge}`.trim());
    }
    if (admins.length > sample.length) {
      lines.push(`• +${admins.length - sample.length} outros…`);
    }
  }

  const bodyText = truncate(lines.join("\n"), 1024);

  await sendInteractiveReplyButtonsMessage({
    webhook,
    to,
    headerText: "Detalhes do grupo",
    headerImageUrl,
    bodyText,
    buttons: [
      { id: ADMIN_GROUP_BUTTON_IDS.back, title: "Voltar" },
      { id: `${ADMIN_GROUP_EDIT_PREFIX}${group.id}`, title: "Editar" },
      { id: `${ADMIN_GROUP_DELETE_PREFIX}${group.id}`, title: "Excluir" },
    ],
  });
};

export const sendAdminGroupEditPrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  group: BotGroup;
}) => {
  const { webhook, to, group } = options;
  await sendInteractiveReplyButtonsMessage({
    webhook,
    to,
    headerText: "Editar grupo",
    bodyText: `Envie o novo link do grupo para substituir o atual.\n\nAtual: ${group.inviteLink || "—"}`,
    footerText: "Use um link válido do WhatsApp (chat.whatsapp.com).",
    buttons: [
      { id: ADMIN_FLOW_BUTTON_IDS.cancel, title: "Cancelar" },
    ],
  });
};

export const sendAdminInstanceListMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  page?: number;
}) => {
  const { webhook, to, user } = options;
  const page = options.page ?? 1;
  const instances = await listInstancesForAdmin({ userId: user.id });

  if (instances.length === 0) {
    await sendAdminInstanceCreateServerPicker({ webhook, to });
    return;
  }

  const STATIC_ROWS = 2; // criar nova / voltar
  const maxInstanceRows = Math.max(1, MAX_LIST_ROWS - STATIC_ROWS);
  const totalPages = Math.max(1, Math.ceil(instances.length / maxInstanceRows));
  const sanitized = Math.min(Math.max(page, 1), totalPages);
  const start = (sanitized - 1) * maxInstanceRows;
  let pageItems = instances.slice(start, start + maxInstanceRows);
  const hasMore = instances.length > sanitized * maxInstanceRows;
  if (hasMore && pageItems.length >= maxInstanceRows) {
    pageItems = pageItems.slice(0, Math.max(0, maxInstanceRows - 1));
  }

  const rows = pageItems.map((instance) => ({
    id: `${ADMIN_INSTANCE_ROW_PREFIX}${instance.id}`,
    title: sanitizeListLabel(instance.name || formatInstancePhone(instance.phone), META_INTERACTIVE_ROW_TITLE_LIMIT, "Instância"),
    description: sanitizeListLabel(`${formatInstancePhone(instance.phone)} · ${formatInstanceStatusLabel(instance.sessionStatus)}`, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
  }));

  if (hasMore) {
    const next = sanitized + 1;
    rows.push({
      id: `${ADMIN_INSTANCE_NEXT_PREFIX}${next}`,
      title: sanitizeListLabel(`Próxima página (${next}/${totalPages})`, META_INTERACTIVE_ROW_TITLE_LIMIT, "Próxima página"),
      description: sanitizeListLabel("Ver mais instâncias", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
    } as any);
  }

  rows.push({
    id: ADMIN_INSTANCE_LIST_IDS.create,
    title: "Cadastrar nova instância",
    description: truncate(
      instances.length > pageItems.length
        ? "Crie uma nova instância pelo WhatsApp ou visualize a lista completa no painel."
        : "Crie e pareie uma nova instância diretamente pelo WhatsApp.",
      60,
    ),
  });

  rows.push({
    id: ADMIN_INSTANCE_LIST_IDS.back,
    title: "Voltar",
    description: "Retornar ao painel administrativo.",
  });

  const interactive: Record<string, unknown> = {
    type: "list",
    header: { type: "text", text: "Instâncias do bot" },
    body: {
      text: instances.length === 1
        ? "Você tem 1 instância cadastrada. Escolha para gerenciar."
        : `Você tem ${instances.length} instâncias. Escolha uma para gerenciar.`,
    },
    action: {
      button: "Escolher",
      sections: [
        {
          title: "Minhas instâncias",
          rows: rows.map((row) => ({
            id: row.id,
            title: sanitizeListLabel(row.title, META_INTERACTIVE_ROW_TITLE_LIMIT, row.title),
            description: row.description
              ? sanitizeListLabel(row.description, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any)
              : undefined,
          })),
        },
      ],
    },
  };

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive,
  }, {
    successLog: `Lista de instâncias enviada para ${to}`,
    failureLog: `Falha ao enviar lista de instâncias para ${to}`,
  });
};

export const sendAdminInstanceActionsMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  instanceId: number;
  user: SessionUser;
}) => {
  const { webhook, to, instanceId, user } = options;
  // Busca a instância e garante que o status esteja atualizado ao abrir o menu
  const current = await getInstanceForUser(user.id, instanceId);
  if (!current) {
    await sendTextMessage({
      webhook,
      to,
      text: "Não encontramos esta instância. Atualize a lista e tente novamente.",
    });
    return;
  }

  await refreshInstanceStatus(user.id, instanceId).catch(() => null);
  const instance = (await getInstanceForUser(user.id, instanceId)) ?? current;

  const instanceLabel = instance.name || formatInstancePhone(instance.phone);
  const statusText = formatInstanceStatusLabel(instance.sessionStatus);
  const helpText = buildInstanceStatusHelp(instance.sessionStatus).join("\n");
  const bodyLines = [
    `Instância: ${instanceLabel}`,
    `Número: ${formatInstancePhone(instance.phone)}`,
    `Status: ${statusText}`,
    "",
    helpText,
  ];

  const rows: Array<{ id: string; title: string; description?: string }> = [];
  rows.push({ id: `${ADMIN_INSTANCE_ACTION_PREFIX.status}${instance.id}`, title: "🔎 Ver status", description: "Atualiza o status agora." });
  const status = instance.sessionStatus;
  const isConnected = status === "conectado";
  const isAwaiting = status === "aguardando_qr" || status === "aguardando_pareamento" || status === "inicializando";
  const isDisconnected = !isConnected && !isAwaiting;
  if (isConnected) {
    rows.push({ id: `${ADMIN_INSTANCE_ACTION_PREFIX.reconnect}${instance.id}`, title: "🔄 Reconectar", description: "Reinicia a sessão." });
    rows.push({ id: `${ADMIN_INSTANCE_ACTION_PREFIX.disconnect}${instance.id}`, title: "🚫 Desconectar", description: "Encerra a sessão atual." });
  }
  if (isAwaiting || isDisconnected) {
    rows.push({ id: `${ADMIN_INSTANCE_ACTION_PREFIX.connect}${instance.id}`, title: "🔌 Conectar", description: "Iniciar/retomar a sessão." });
    rows.push({ id: `${ADMIN_INSTANCE_ACTION_PREFIX.pair}${instance.id}`, title: "🆔 Gerar código", description: "Gerar código/QR para parear." });
  }
  rows.push({ id: `${ADMIN_INSTANCE_ACTION_PREFIX.delete}${instance.id}`, title: "🗑️ Excluir instância", description: "Remove esta instância." });
  rows.push({ id: `${ADMIN_INSTANCE_ACTION_PREFIX.back}${instance.id}`, title: "⬅️ Voltar", description: "Retornar à lista." });

  const interactive: Record<string, unknown> = {
    type: "list",
    header: { type: "text", text: "Gerenciar instância" },
    body: { text: truncate(bodyLines.join("\n"), META_INTERACTIVE_BODY_LIMIT) },
    action: {
      button: "Escolher",
      sections: [
        {
          title: instanceLabel.slice(0, META_INTERACTIVE_SECTION_TITLE_LIMIT),
          rows: rows.map((row) => ({
            id: row.id,
            title: truncate(row.title, META_INTERACTIVE_ROW_TITLE_LIMIT),
            description: row.description
              ? truncate(row.description, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT)
              : undefined,
          })),
        },
      ],
    },
  };

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive,
  }, {
    successLog: `Menu de ações da instância enviado para ${to}`,
    failureLog: `Falha ao enviar menu de ações da instância para ${to}`,
  });
};

export const sendAdminInstanceStatusMessage = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  instanceId: number;
}) => {
  const { webhook, to, user, instanceId } = options;
  const status = await refreshInstanceStatus(user.id, instanceId).catch(() => null);
  const instance = await getInstanceForUser(user.id, instanceId);

  if (!instance) {
    await sendTextMessage({
      webhook,
      to,
      text: "Não foi possível localizar a instância solicitada.",
    });
    return;
  }

  const statusLabel = status ? formatInstanceStatusLabel(status) : formatInstanceStatusLabel(instance.sessionStatus);
  const lines = [
    `Instância: ${instance.name || formatInstancePhone(instance.phone)}`,
    `Número: ${formatInstancePhone(instance.phone)}`,
    `Status atual: ${statusLabel}`,
    instance.sessionStatus !== status && status
      ? `Status anterior: ${formatInstanceStatusLabel(instance.sessionStatus)}`
      : null,
  ].filter(Boolean) as string[];

  await sendTextMessage({
    webhook,
    to,
    text: lines.join("\n"),
  });
};

export const sendAdminInstanceCreateServerPicker = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;
  const servers = await getActiveBotServers();
  if (servers.length === 0) {
    await sendTextMessage({ webhook, to, text: "⚠️ Nenhum servidor disponível para criar instâncias. Contate o suporte." });
    return;
  }
  if (servers.length === 1) {
    const server = servers[0];
    await sendInteractiveReplyButtonsMessage({
      webhook,
      to,
      headerText: "Nova instância",
      bodyText: `Servidor: ${server.name}\nEnvie o número do WhatsApp no formato DDI+DDD+Número (ex.: 559295333643).`,
      buttons: [{ id: ADMIN_FLOW_BUTTON_IDS.cancel, title: "Cancelar" }],
    });
    await updateAdminBotSessionFlow(to, { name: "instance_create_phone_input", serverId: server.id });
    return;
  }

  const rows = servers.slice(0, MAX_LIST_ROWS).map((s) => ({
    id: `${ADMIN_INSTANCE_CREATE_SERVER_PREFIX}${s.id}`,
    title: sanitizeListLabel(s.name, META_INTERACTIVE_ROW_TITLE_LIMIT, s.name),
    description: sanitizeListLabel(s.baseUrl, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any),
  }));

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Selecionar servidor" },
      body: { text: "Escolha o servidor onde a instância será criada." },
      action: { button: "Escolher", sections: [{ title: "Servidores", rows }] },
    },
  }, {
    successLog: `Picker de servidor enviado para ${to}`,
    failureLog: `Falha ao enviar picker de servidor para ${to}`,
  });
};

export const sendAdminInstanceCreatePhonePrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  serverId: number;
}) => {
  const { webhook, to, serverId } = options;
  await sendInteractiveReplyButtonsMessage({
    webhook,
    to,
    headerText: "Nova instância",
    bodyText: "Envie o número do WhatsApp no formato DDI+DDD+Número (ex.: 559295333643).",
    buttons: [{ id: ADMIN_FLOW_BUTTON_IDS.cancel, title: "Cancelar" }],
  });
  await updateAdminBotSessionFlow(to, { name: "instance_create_phone_input", serverId });
};

export const sendAdminInstancePairingMessage = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  instanceId: number;
}) => {
  const { webhook, to, user, instanceId } = options;

  try {
    const data = await requestPairingCode(user.id, instanceId);
    if (data.alreadyConnected) {
      await sendTextMessage({
        webhook,
        to,
        text: "Esta conexão já está estabelecida. Não é necessário gerar um novo QR Code.",
      });
      return;
    }

    if (data.linkingCode) {
      await sendInteractiveReplyButtonsMessage({
        webhook,
        to,
        headerText: "Parear instância",
        bodyText: [
          "Siga os passos para parear:",
          "1) Abra o WhatsApp",
          "2) Menu ⋮ (Android) ou Ajustes (iPhone)",
          "3) Aparelhos Conectados > Conectar um aparelho",
          "4) Toque em ‘Inserir código’ e cole o código enviado a seguir.",
        ].join("\n"),
        buttons: [
          { id: `${ADMIN_INSTANCE_ACTION_PREFIX.back}${instanceId}`, title: "⬅️ Voltar" },
        ],
      });
      await sendTextMessage({ webhook, to, text: String(data.linkingCode).trim() });
      // Inicia monitoramento de conexão para enviar prompt de vincular grupo
      monitorInstanceConnectionAndPromptGroup({ webhook, to, user, instanceId }).catch(() => {});
      return;
    }

    if (data.qrCode) {
      await sendTextMessage({
        webhook,
        to,
        text: [
          "Geramos o QR Code para pareamento.",
          "Acesse o painel web para visualizar a imagem e escanear com o WhatsApp.",
          `${APP_BASE_URL}/dashboard/user/configurar-bot`,
        ].join("\n"),
      });
      // Inicia monitoramento de conexão para enviar prompt de vincular grupo
      monitorInstanceConnectionAndPromptGroup({ webhook, to, user, instanceId }).catch(() => {});
      return;
    }

    await sendTextMessage({
      webhook,
      to,
      text: "Não conseguimos gerar o código de pareamento agora. Tente novamente em instantes.",
    });
  } catch (error) {
    console.error("[Admin Bot] Falha ao gerar código de pareamento", error);
    await sendTextMessage({
      webhook,
      to,
      text: "Ocorreu um erro ao tentar gerar o código de pareamento. Tente novamente mais tarde.",
    });
  }
};

// Guarda instâncias com monitor ativo para evitar duplicações/loops
const ADMIN_INSTANCE_MONITOR_LOCK = new Set<number>();

export const monitorInstanceConnectionAndPromptGroup = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  instanceId: number;
  attempts?: number; // default: 12 (~1 min)
  intervalMs?: number; // default: 5000 ms
}) => {
  const { webhook, to, user, instanceId } = options;
  const attempts = Math.max(1, Math.min(options.attempts ?? 12, 60));
  const intervalMs = Math.max(1000, Math.min(options.intervalMs ?? 5000, 30000));

  if (ADMIN_INSTANCE_MONITOR_LOCK.has(instanceId)) return;
  ADMIN_INSTANCE_MONITOR_LOCK.add(instanceId);
  try {
    for (let i = 0; i < attempts; i++) {
      const status = await refreshInstanceStatus(user.id, instanceId).catch(() => null);
      if (status === "conectado") {
        const [instance, config] = await Promise.all([
          getInstanceForUser(user.id, instanceId).catch(() => null),
          getAdminBotConfig(),
        ]);
        const name = (instance?.name || instance?.phone || String(instanceId)).toString();
        const headerText = truncate(applyConfigTokens(config.instanceConnectedHeaderText, config, {}), 60);
        const bodyText = truncate(
          applyConfigTokens(config.instanceConnectedBodyText, config, { "{{instance_name}}": name }),
          META_INTERACTIVE_BODY_LIMIT,
        );
        await sendInteractiveReplyButtonsMessage({
          webhook,
          to,
          headerText,
          bodyText,
          buttons: [
            { id: `${ADMIN_GROUP_CREATE_INSTANCE_PREFIX}${instanceId}`, title: truncate(config.instanceConnectedLinkGroupButtonText, BUTTON_TITLE_LIMIT) },
            { id: ADMIN_FLOW_BUTTON_IDS.cancel, title: truncate(config.instanceConnectedLaterButtonText, BUTTON_TITLE_LIMIT) },
          ],
        });
        break;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  } finally {
    ADMIN_INSTANCE_MONITOR_LOCK.delete(instanceId);
  }
};

export const sendAdminInstanceDeletionPrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  instanceId: number;
  user: SessionUser;
}) => {
  const { webhook, to, instanceId, user } = options;
  const instance = await getInstanceForUser(user.id, instanceId);

  if (!instance) {
    await sendTextMessage({
      webhook,
      to,
      text: "Não encontramos esta instância. Atualize a lista e tente novamente.",
    });
    return;
  }

  const interactive: Record<string, unknown> = {
    type: "button",
    body: {
      text: truncate(
        [
          `Excluir instância ${instance.name || formatInstancePhone(instance.phone)}?`,
          "Atenção: grupos vinculados não são removidos, mas deixarão de aparecer até que uma nova instância seja vinculada.",
          "Esta ação não pode ser desfeita.",
        ].join("\n"),
        META_INTERACTIVE_BODY_LIMIT,
      ),
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: `${ADMIN_INSTANCE_ACTION_PREFIX.confirmDelete}${instance.id}`,
            title: "Confirmar",
          },
        },
        {
          type: "reply",
          reply: {
            id: `${ADMIN_INSTANCE_ACTION_PREFIX.cancelDelete}${instance.id}`,
            title: "Cancelar",
          },
        },
      ],
    },
  };

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive,
  }, {
    successLog: `Confirmação de exclusão da instância enviada para ${to}`,
    failureLog: `Falha ao enviar confirmação de exclusão da instância para ${to}`,
  });
};

export const handleAdminInstanceDeletion = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  instanceId: number;
}) => {
  const { webhook, to, user, instanceId } = options;

  try {
    await deleteInstanceForUser(user.id, instanceId);
    await sendTextMessage({
      webhook,
      to,
      text: "🗑️ Instância excluída com sucesso.",
    });
  } catch (error) {
    console.error("[Admin Bot] Falha ao excluir instância", error);
    await sendTextMessage({
      webhook,
      to,
      text: "⚠️ Não foi possível excluir a instância. Tente novamente mais tarde.",
    });
  }
};

export const handleAdminInstanceSessionAction = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  instanceId: number;
  action: "reconnect" | "disconnect" | "connect";
}) => {
  const { webhook, to, user, instanceId, action } = options;

  const actionMap: Record<typeof action, BotInstanceAction> = {
    reconnect: "restart",
    disconnect: "logout",
    connect: "connect",
  } as const;

  try {
    await performInstanceAction(user.id, instanceId, actionMap[action]);
    const feedback =
      action === "reconnect"
        ? "🔄 Solicitamos a reconexão da instância. Aguarde alguns segundos e verifique o status."
        : action === "connect"
          ? "🔌 Solicitamos a conexão da instância. Aguarde alguns instantes e verifique o status."
          : "🚫 Solicitamos a desconexão da instância. Caso necessário, conecte novamente em seguida.";

    await sendTextMessage({
      webhook,
      to,
      text: feedback,
    });
    // Reexibe o menu de ações da instância
    await sendAdminInstanceActionsMenu({ webhook, to, user, instanceId });
  } catch (error) {
    console.error("[Admin Bot] Falha ao executar ação na instância", error);
    await sendTextMessage({
      webhook,
      to,
      text: "⚠️ Não foi possível executar a ação solicitada. Tente novamente em instantes.",
    });
  }
};

export const sendAdminCategoryActionsMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: "Categorias",
      },
      body: {
        text: "Qual ação deseja executar nas categorias?",
      },
      action: {
        button: "Escolher",
        sections: [
          {
            title: "Gerenciar categorias",
            rows: [
              {
                id: ADMIN_CATEGORY_ACTION_LIST_IDS.list,
                title: "Listar categorias",
                description: "Visualize suas categorias atuais.",
              },
              {
                id: ADMIN_CATEGORY_ACTION_LIST_IDS.rename,
                title: "Alterar nome",
                description: "Atualize o nome de uma categoria.",
              },
              {
                id: ADMIN_CATEGORY_ACTION_LIST_IDS.price,
                title: "Alterar valor",
                description: "Defina um novo preço padrão.",
              },
              {
                id: ADMIN_CATEGORY_ACTION_LIST_IDS.sku,
                title: "Alterar SKU",
                description: "Edite o SKU vinculado.",
              },
              {
                id: ADMIN_CATEGORY_ACTION_LIST_IDS.back,
                title: "Voltar",
                description: "Retornar ao painel administrativo.",
              },
            ].map((row) => ({
              id: row.id,
              title: truncate(row.title, 24),
              description: row.description ? truncate(row.description, 60) : undefined,
            })),
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Menu de ações de categorias enviado para ${to}`,
    failureLog: `Falha ao enviar menu de ações de categorias para ${to}`,
  });
};

const buildCategoryRows = (
  categories: CategorySummary[],
  options?: { rowPrefix?: string },
) =>
  categories.map((category) => {
    const statusLabel = category.isActive ? "Ativa" : "Inativa";
    const priceLabel = formatCurrency(category.price);
    const description = truncate(`${statusLabel} · ${priceLabel}`, 60);
    const prefix = options?.rowPrefix ?? ADMIN_CATEGORY_ROW_PREFIX;

    return {
      id: `${prefix}${category.id}`,
      title: truncate(category.name || "Categoria", 24),
      description,
    };
  });

const buildCategoryListPayload = (
  to: string,
  categories: CategorySummary[],
  page: number,
  options?: {
    rowPrefix?: string;
    headerText?: string;
    bodyText?: string;
    buttonText?: string;
    extraRows?: { id: string; title: string; description?: string }[];
    nextPrefix?: string;
  },
) => {
  const extraRows = options?.extraRows ?? [];
  const itemsPerPage = Math.max(1, MAX_LIST_ROWS - extraRows.length);
  const totalPages = Math.max(1, Math.ceil(categories.length / itemsPerPage));
  const sanitizedPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (sanitizedPage - 1) * itemsPerPage;
  let rowsForPage = categories.slice(startIndex, startIndex + itemsPerPage);
  const hasMore = categories.length > sanitizedPage * itemsPerPage;

  if (hasMore && rowsForPage.length >= itemsPerPage) {
    rowsForPage = rowsForPage.slice(0, Math.max(0, itemsPerPage - 1));
  }

  const rows = buildCategoryRows(rowsForPage, { rowPrefix: options?.rowPrefix });

  if (hasMore) {
    const nextPage = sanitizedPage + 1;
    rows.push({
      id: `${options?.nextPrefix ?? ADMIN_CATEGORY_NEXT_PREFIX}${nextPage}`,
      title: truncate(`Próxima página (${nextPage}/${totalPages})`, 24),
      description: "Ver mais categorias",
    });
  }

  if (extraRows.length > 0) {
    rows.push(...extraRows.map((row) => ({
      id: row.id,
      title: truncate(row.title, 24),
      ...(row.description
        ? { description: truncate(row.description, 60) }
        : {}),
    })));
  }

  const headerText = options?.headerText ?? `Gerenciar categorias (${categories.length})`;
  const bodyText = options?.bodyText ?? "Selecione uma categoria para visualizar detalhes.";
  const buttonText = options?.buttonText ?? "Escolher";

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: truncate(headerText, 60),
      },
      body: {
        text: truncate(bodyText, 1024),
      },
      ...(hasMore
        ? {
            footer: {
              text: "Role até o fim para acessar a próxima página.",
            },
          }
        : {}),
      action: {
        button: truncate(buttonText, BUTTON_TITLE_LIMIT),
        sections: [
          {
            title: truncate("Categorias", 60),
            rows,
          },
        ],
      },
    },
  };

  return { payload, page: sanitizedPage, totalPages };
};

export const sendAdminCategoryList = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  userId: number;
  page: number;
}) => {
  const { webhook, to, userId, page } = options;
  const categories = await getCategoriesForUser(userId);

  if (!categories.length) {
    await sendTextMessage({
      webhook,
      to,
      text: "Nenhuma categoria ativa encontrada. Configure suas categorias pelo painel web para começar a vender.",
    });
    return { page: 1, totalPages: 1 };
  }

  const { payload, page: sanitizedPage, totalPages } = buildCategoryListPayload(to, categories, page);

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Lista administrativa de categorias enviada para ${to}`,
    failureLog: `Falha ao enviar lista administrativa de categorias para ${to}`,
  });

  return { page: sanitizedPage, totalPages };
};

const buildCategorySummaryLines = (category: CategorySummary) => {
  const lines = [
    `Categoria: ${category.name}`,
    `Status: ${category.isActive ? "Ativa" : "Inativa"}`,
    `Preço padrão: ${formatCurrency(category.price)}`,
    `SKU: ${category.sku || "—"}`,
    `Produtos cadastrados: ${category.productCount}`,
    `Atualizado em: ${formatDateTime(category.updatedAt)}`,
  ];

  if (category.description?.trim()) {
    lines.push("", "Descrição:", category.description.trim());
  }

  return lines;
};

const CATEGORY_SELECTION_CONFIG: Record<
  "rename" | "price" | "sku",
  {
    rowPrefix: string;
    header: string;
    body: string;
    button: string;
    nextPrefix: string;
  }
> = {
  rename: {
    rowPrefix: ADMIN_CATEGORY_RENAME_PREFIX,
    header: "Alterar nome",
    body: "Escolha a categoria que deseja renomear.",
    button: "Selecionar",
    nextPrefix: ADMIN_CATEGORY_RENAME_NEXT_PREFIX,
  },
  price: {
    rowPrefix: ADMIN_CATEGORY_PRICE_PREFIX,
    header: "Alterar valor",
    body: "Selecione a categoria para definir um novo valor padrão.",
    button: "Selecionar",
    nextPrefix: ADMIN_CATEGORY_PRICE_NEXT_PREFIX,
  },
  sku: {
    rowPrefix: ADMIN_CATEGORY_SKU_PREFIX,
    header: "Alterar SKU",
    body: "Escolha a categoria para atualizar o SKU.",
    button: "Selecionar",
    nextPrefix: ADMIN_CATEGORY_SKU_NEXT_PREFIX,
  },
};

export const sendAdminCategorySelectionList = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  userId: number;
  mode: keyof typeof CATEGORY_SELECTION_CONFIG;
  page?: number;
}) => {
  const { webhook, to, userId, mode } = options;
  const page = options.page ?? 1;
  const categories = await getCategoriesForUser(userId);

  if (!categories.length) {
    await sendTextMessage({
      webhook,
      to,
      text: "Nenhuma categoria ativa encontrada. Cadastre novas categorias pelo painel web para continuar.",
    });
    return { page: 1, totalPages: 1 };
  }

  const config = CATEGORY_SELECTION_CONFIG[mode];
  const { payload, page: sanitizedPage, totalPages } = buildCategoryListPayload(
    to,
    categories,
    page,
    {
      rowPrefix: config.rowPrefix,
      headerText: `${config.header} (${categories.length})`,
      bodyText: config.body,
      buttonText: config.button,
      extraRows: [
        {
          id: ADMIN_CATEGORY_LIST_BACK_ID,
          title: "Voltar",
          description: "Retornar ao menu anterior.",
        },
      ],
      nextPrefix: config.nextPrefix,
    },
  );

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Lista de seleção de categorias (${mode}) enviada para ${to}`,
    failureLog: `Falha ao enviar lista de seleção de categorias (${mode}) para ${to}`,
  });

  return { page: sanitizedPage, totalPages };
};

export const sendAdminCategoryDetails = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  userId: number;
  categoryId: number;
}) => {
  const { webhook, to, userId, categoryId } = options;
  const category = await getCategoryByIdForUser(userId, categoryId);

  if (!category) {
    await sendTextMessage({
      webhook,
      to,
      text: "Não encontramos essa categoria. Atualize a lista e tente novamente.",
    });
    return;
  }

  const lines = [
    ...buildCategorySummaryLines(category),
    "",
    `Gerencie pelo painel: ${APP_BASE_URL}/dashboard/user/categories`,
  ];

  await sendTextMessage({
    webhook,
    to,
    text: lines.join("\n"),
  });
};

const CATEGORY_PROMPT_CONFIG: Record<
  keyof typeof CATEGORY_SELECTION_CONFIG,
  {
    header: string;
    message: (category: CategorySummary) => string[];
  }
> = {
  rename: {
    header: "Atualizar nome",
    message: (category) => [
      `Categoria selecionada: ${category.name}`,
      `Preço atual: ${formatCurrency(category.price)}`,
      "",
      "Envie agora o novo nome para essa categoria.",
      "Se preferir cancelar, toque no botão abaixo.",
    ],
  },
  price: {
    header: "Atualizar valor",
    message: (category) => [
      `Categoria selecionada: ${category.name}`,
      `Preço atual: ${formatCurrency(category.price)}`,
      "",
      "Envie o novo valor no formato 49,90 ou 49.90.",
      "Para cancelar, toque no botão abaixo.",
    ],
  },
  sku: {
    header: "Atualizar SKU",
    message: (category) => [
      `Categoria selecionada: ${category.name}`,
      `SKU atual: ${category.sku || "—"}`,
      "",
      "Envie o novo SKU (máx. 32 caracteres alfanuméricos).",
      "Use o botão abaixo para cancelar caso necessário.",
    ],
  },
};

export const sendAdminCategoryInputPrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  category: CategorySummary;
  mode: keyof typeof CATEGORY_SELECTION_CONFIG;
}) => {
  const { webhook, to, category, mode } = options;
  const config = CATEGORY_PROMPT_CONFIG[mode];
  const text = truncate(config.message(category).join("\n"), MENU_TEXT_LIMIT);

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: config.header,
      },
      body: {
        text,
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: ADMIN_FLOW_BUTTON_IDS.cancel,
              title: "Cancelar",
            },
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Prompt de atualização (${mode}) enviado para ${to}`,
    failureLog: `Falha ao enviar prompt de atualização (${mode}) para ${to}`,
  });
};

export const sendAdminCategoryUpdateConfirmation = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  category: CategorySummary;
  message?: string;
}) => {
  const { webhook, to, category } = options;
  const lines = [
    options.message ?? "Categoria atualizada com sucesso!",
    "",
    ...buildCategorySummaryLines(category),
  ];

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: "Resumo da categoria",
      },
      body: {
        text: truncate(lines.join("\n"), MENU_TEXT_LIMIT),
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: ADMIN_CATEGORY_BUTTON_IDS.backToActions,
              title: "Voltar",
            },
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Confirmação de atualização de categoria enviada para ${to}`,
    failureLog: `Falha ao enviar confirmação de atualização de categoria para ${to}`,
  });
};

const ensureAdminExportDirectory = async () => {
  await fs.mkdir(ADMIN_EXPORT_DIR, { recursive: true });
  return ADMIN_EXPORT_DIR;
};

const escapeCsvValue = (value: string | number | boolean | null | undefined) => {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = typeof value === "string" ? value : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

const createCustomerCsvFile = async (
  userId: number,
  customers: CustomerSummary[],
) => {
  await ensureAdminExportDirectory();
  const filename = `clientes-${userId}-${Date.now()}.csv`;
  const absolutePath = path.join(ADMIN_EXPORT_DIR, filename);
  const header = [
    "ID",
    "Telefone",
    "Nome",
    "Perfil",
    "Saldo",
    "Bloqueado",
    "Última interação",
    "Criado em",
    "Atualizado em",
  ].join(",");

  const lines = customers.map((customer) => {
    const balance = customer.balance.toFixed(2);
    const lastInteraction = customer.lastInteraction
      ? formatDateTime(customer.lastInteraction)
      : "";
    return [
      customer.id,
      customer.phoneNumber,
      customer.displayName ?? "",
      customer.profileName ?? "",
      balance,
      customer.isBlocked ? "Sim" : "Não",
      lastInteraction,
      formatDateTime(customer.createdAt),
      formatDateTime(customer.updatedAt),
    ].map(escapeCsvValue).join(",");
  });

  const csvContent = [header, ...lines].join("\n");
  await fs.writeFile(absolutePath, csvContent, "utf8");

  const publicPath = path.posix.join("uploads", "admin-bot", filename);
  const fileUrl = `${APP_BASE_URL}/${publicPath}`;

  return { absolutePath, fileUrl, filename };
};

const buildCustomerSummaryLines = (customer: CustomerSummary) => {
  const lines = [
    `Cliente: ${customer.displayName || customer.profileName || customer.phoneNumber}`,
    `Telefone: ${customer.phoneNumber}`,
    `Saldo: ${formatCurrency(customer.balance)}`,
    `Status: ${customer.isBlocked ? "Banido" : "Ativo"}`,
    `Última interação: ${customer.lastInteraction ? formatDateTime(customer.lastInteraction) : "—"}`,
  ];

  return lines;
};

export const sendAdminCustomerActionsMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: "Clientes",
      },
      body: {
        text: "Escolha o que deseja fazer com os clientes.",
      },
      action: {
        button: "Abrir opções",
        sections: [
          {
            title: "Gerenciar clientes",
            rows: [
              {
                id: ADMIN_CUSTOMER_ACTION_LIST_IDS.list,
                title: "Listar clientes",
                description: "Receba um CSV com todos os clientes.",
              },
              {
                id: ADMIN_CUSTOMER_ACTION_LIST_IDS.edit,
                title: "Editar cliente",
                description: "Alterar saldo, nome ou status de um cliente.",
              },
              {
                id: ADMIN_CUSTOMER_ACTION_LIST_IDS.back,
                title: "Voltar",
                description: "Retornar ao painel administrativo.",
              },
            ].map((row) => ({
              id: row.id,
              title: truncate(row.title, 24),
              description: row.description ? truncate(row.description, 60) : undefined,
            })),
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Menu de clientes enviado para ${to}`,
    failureLog: `Falha ao enviar menu de clientes para ${to}`,
  });
};

export const sendAdminCustomerCsv = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  userId: number;
}) => {
  const { webhook, to, userId } = options;
  const customers = await getCustomersForUser(userId);

  if (!customers.length) {
    await sendTextMessage({
      webhook,
      to,
      text: "Nenhum cliente encontrado. Assim que novos clientes interagirem com o seu bot, eles aparecerão aqui.",
    });
    return { count: 0 };
  }

  const { fileUrl, filename } = await createCustomerCsvFile(userId, customers);

  await sendDocumentFromUrl({
    webhook,
    to,
    documentUrl: fileUrl,
    filename,
    caption: `📄 Lista de clientes (${customers.length})`,
  });

  return { count: customers.length };
};

export const sendAdminCustomerLookupPrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: "Editar cliente",
      },
      body: {
        text: "Envie o número do cliente no formato +5511999998888 ou 11999998888.",
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: ADMIN_FLOW_BUTTON_IDS.cancel,
              title: "Cancelar",
            },
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Prompt de busca de cliente enviado para ${to}`,
    failureLog: `Falha ao enviar prompt de busca de cliente para ${to}`,
  });
};

export const sendAdminCustomerEditMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  customer: CustomerSummary;
}) => {
  const { webhook, to, customer } = options;
  const lines = buildCustomerSummaryLines(customer);

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: "Editar cliente",
      },
      body: {
        text: truncate(lines.join("\n"), MENU_TEXT_LIMIT),
      },
      action: {
        button: "Selecionar ação",
        sections: [
          {
            title: "Ações disponíveis",
            rows: [
              {
                id: ADMIN_CUSTOMER_EDIT_OPTION_IDS.balance,
                title: "Ajustar saldo",
                description: "Use formatos +10 ou -5 para aplicar o ajuste.",
              },
              {
                id: ADMIN_CUSTOMER_EDIT_OPTION_IDS.name,
                title: "Alterar nome",
                description: "Defina um novo nome de exibição.",
              },
              {
                id: ADMIN_CUSTOMER_EDIT_OPTION_IDS.toggleBlock,
                title: customer.isBlocked ? "Desbanir cliente" : "Banir cliente",
                description: customer.isBlocked
                  ? "Permitir interações novamente."
                  : "Impedir novas interações.",
              },
              {
                id: ADMIN_CUSTOMER_EDIT_OPTION_IDS.back,
                title: "Voltar",
                description: "Retornar ao menu de clientes.",
              },
            ].map((row) => ({
              id: row.id,
              title: truncate(row.title, 24),
              description: row.description ? truncate(row.description, 60) : undefined,
            })),
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Menu de edição de cliente enviado para ${to}`,
    failureLog: `Falha ao enviar menu de edição de cliente para ${to}`,
  });
};

export const sendAdminCustomerBalancePrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  customer: CustomerSummary;
}) => {
  const { webhook, to, customer } = options;

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: "Ajustar saldo",
      },
      body: {
        text: `Saldo atual: ${formatCurrency(customer.balance)}\nEnvie o valor no formato +10 ou -5. Use 0 para não alterar.`,
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: ADMIN_FLOW_BUTTON_IDS.cancel,
              title: "Cancelar",
            },
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Prompt de ajuste de saldo enviado para ${to}`,
    failureLog: `Falha ao enviar prompt de ajuste de saldo para ${to}`,
  });
};

export const sendAdminCustomerNamePrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  customer: CustomerSummary;
}) => {
  const { webhook, to, customer } = options;

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: "Alterar nome",
      },
      body: {
        text: `Nome atual: ${customer.displayName || customer.profileName || "—"}\nEnvie o novo nome com pelo menos 2 caracteres.`,
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: ADMIN_FLOW_BUTTON_IDS.cancel,
              title: "Cancelar",
            },
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Prompt de alteração de nome enviado para ${to}`,
    failureLog: `Falha ao enviar prompt de alteração de nome para ${to}`,
  });
};

export const sendAdminCustomerUpdateConfirmation = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  customer: CustomerSummary;
  message: string;
}) => {
  const { webhook, to, customer, message } = options;
  const lines = [message, "", ...buildCustomerSummaryLines(customer)];

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: "Cliente atualizado",
      },
      body: {
        text: truncate(lines.join("\n"), MENU_TEXT_LIMIT),
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: ADMIN_CUSTOMER_BUTTON_IDS.backToActions,
              title: "Voltar",
            },
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Confirmação de atualização de cliente enviada para ${to}`,
    failureLog: `Falha ao enviar confirmação de atualização de cliente para ${to}`,
  });
};

export const sendAdminSubscriptionSummary = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  userId: number;
}) => {
  const { webhook, to, userId } = options;
  const status = await getUserPlanStatus(userId);

  if (!status.plan) {
    await sendTextMessage({
      webhook,
      to,
      text: [
        "Você ainda não possui um plano ativo.",
        "Acesse a página de grupos para escolher a licença do grupo.",
        `${APP_BASE_URL}/dashboard/user/grupos`,
      ].join("\n"),
    });
    return;
  }

  const lines = [
    `Plano: ${status.plan.name}`,
    `Valor: ${formatCurrency(status.plan.price)}`,
    `Limite de instâncias: ${status.plan.instanceLimit}`,
    `Status: ${status.status === "active" ? "Ativo" : status.status === "expired" ? "Expirado" : status.status === "pending" ? "Pagamento pendente" : "Inativo"}`,
  ];

  if (status.currentPeriodStart) {
    lines.push(`Início do ciclo: ${formatDate(status.currentPeriodStart)}`);
  }

  if (status.currentPeriodEnd) {
    lines.push(`Fim do ciclo: ${formatDate(status.currentPeriodEnd)}`);
  }

  if (status.daysRemaining !== null) {
    lines.push(`Dias restantes: ${status.daysRemaining}`);
  }

  lines.push("", `Gerencie seus grupos: ${APP_BASE_URL}/dashboard/user/grupos`);

  await sendTextMessage({
    webhook,
    to,
    text: lines.join("\n"),
  });
};

const buildPlanStatusLabel = (status: UserPlanStatus["status"]) => {
  switch (status) {
    case "active":
      return "Ativo";
    case "pending":
      return "Pagamento pendente";
    case "expired":
      return "Expirado";
    default:
      return "Inativo";
  }
};

const buildPlanReplacements = (status: UserPlanStatus) => {
  const plan = status.plan;
  const summary = plan ? buildPlanPaymentSummary(plan) : ["Plano: —", "Valor: —"].join("\n");
  return {
    "{{plan_name}}": plan?.name ?? "—",
    "{{plan_status}}": buildPlanStatusLabel(status.status),
    "{{plan_price}}": plan ? formatCurrency(plan.price) : "—",
    "{{plan_category_limit}}": plan ? String(plan.instanceLimit) : "—",
    "{{plan_renews_at}}": status.currentPeriodEnd ? formatDate(status.currentPeriodEnd) : "—",
    "{{plan_started_at}}": status.currentPeriodStart ? formatDate(status.currentPeriodStart) : "—",
    "{{plan_days_remaining}}":
      status.daysRemaining !== null ? `${status.daysRemaining}` : "—",
    "{{plan_summary}}": summary,
  };
};

const buildPlanButtons = (config: AdminBotConfig, replacements: Record<string, string>) => [
  {
    type: "reply" as const,
    reply: {
      id: ADMIN_SUBSCRIPTION_BUTTON_IDS.renew,
      title: truncate(applyConfigTokens(config.subscriptionRenewButtonText, config, replacements), BUTTON_TITLE_LIMIT),
    },
  },
  {
    type: "reply" as const,
    reply: {
      id: ADMIN_SUBSCRIPTION_BUTTON_IDS.change,
      title: truncate(applyConfigTokens(config.subscriptionChangeButtonText, config, replacements), BUTTON_TITLE_LIMIT),
    },
  },
  {
    type: "reply" as const,
    reply: {
      id: ADMIN_SUBSCRIPTION_BUTTON_IDS.details,
      title: truncate(applyConfigTokens(config.subscriptionDetailsButtonText, config, replacements), BUTTON_TITLE_LIMIT),
    },
  },
];

export const sendAdminSubscriptionMenu = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  config: AdminBotConfig;
}) => {
  const { webhook, to, user, config } = options;
  const status = await getUserPlanStatus(user.id);
  const replacements = buildPlanReplacements(status);

  if (!status.plan) {
    const header = truncate(applyConfigTokens(config.subscriptionNoPlanHeaderText, config, replacements), 60);
    const body = truncate(
      applyConfigTokens(config.subscriptionNoPlanBodyText, config, replacements),
      MENU_TEXT_LIMIT,
    );

    const interactive: Record<string, unknown> = {
      type: "button",
      body: { text: body },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: ADMIN_SUBSCRIPTION_BUTTON_IDS.start,
              title: truncate(
                applyConfigTokens(config.subscriptionNoPlanButtonText, config, replacements),
                BUTTON_TITLE_LIMIT,
              ),
            },
          },
        ],
      },
    };

    if (header) {
      interactive.header = {
        type: "text",
        text: header,
      };
    }

    await dispatchMetaMessage(webhook, {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive,
    }, {
      successLog: `Menu de assinatura (sem plano) enviado para ${to}`,
      failureLog: `Falha ao enviar menu de assinatura (sem plano) para ${to}`,
    });

    return;
  }

  const headerText = truncate(applyConfigTokens(config.subscriptionHeaderText, config, replacements), 60);
  const bodyText = truncate(applyConfigTokens(config.subscriptionBodyText, config, replacements), MENU_TEXT_LIMIT);
  const footerText = config.subscriptionFooterText?.trim();

  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: bodyText },
    action: { buttons: buildPlanButtons(config, replacements) },
  };

  if (headerText) {
    interactive.header = {
      type: "text",
      text: headerText,
    };
  }

  if (footerText) {
    interactive.footer = {
      text: truncate(applyConfigTokens(footerText, config, replacements), 60),
    };
  }

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive,
  }, {
    successLog: `Menu de assinatura enviado para ${to}`,
    failureLog: `Falha ao enviar menu de assinatura para ${to}`,
  });
};

export const sendAdminPlanDetails = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  status: UserPlanStatus;
  config: AdminBotConfig;
}) => {
  const { webhook, to, status, config } = options;

  if (!status.plan) {
    await sendTextMessage({
      webhook,
      to,
      text: applyConfigTokens(config.subscriptionNoPlanBodyText, config, buildPlanReplacements(status)),
    });
    return;
  }

  const replacements = buildPlanReplacements(status);
  const lines = [
    applyConfigTokens(config.subscriptionHeaderText, config, replacements),
    "",
    applyConfigTokens(config.subscriptionBodyText, config, replacements),
    "",
    `Link do painel: ${APP_BASE_URL}/dashboard/user/grupos`,
  ];

  await sendTextMessage({
    webhook,
    to,
    text: lines.filter((line) => line.trim().length > 0).join("\n"),
  });
};

export const sendAdminPlanList = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  config: AdminBotConfig;
  status?: UserPlanStatus;
}) => {
  const { webhook, to, config, status } = options;
  const plans = (await getAllSubscriptionPlans()).filter((plan) => plan.isActive);

  if (!plans.length) {
    await sendTextMessage({
      webhook,
      to,
      text: "Nenhum plano ativo foi encontrado. Cadastre os planos no painel antes de continuar.",
    });
    return;
  }

  const rows = [
    status?.plan
      ? {
          id: ADMIN_PLAN_ADDON_ROW_ID,
          title: truncate("Comprar instâncias", META_INTERACTIVE_ROW_TITLE_LIMIT),
          description: truncate("Adicione instâncias extras ao painel atual.", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
        }
      : null,
    ...plans.map((plan) => {
      const repl: Record<string, string> = {
        "{{plan_name}}": plan.name,
        "{{plan_description}}": (plan.description ?? "").trim(),
        "{{plan_price}}": formatCurrency(plan.price),
        "{{plan_instance_limit}}": String(plan.instanceLimit),
        "{{plan_group_limit}}": String(plan.groupLimit),
        "{{plan_duration_days}}": String(plan.durationDays),
        "{{plan_summary}}": buildPlanPaymentSummary(plan),
      };
      const template = config.subscriptionPlanListRowDescriptionTemplate?.trim() ||
        "💰 {{plan_price}} · 👥 1 grupo · 🤖 1 instância base";
      const desc = applyConfigTokens(template, config, repl);
      return {
        id: `${ADMIN_PLAN_ROW_PREFIX}${plan.id}`,
        title: truncate(plan.name, 24),
        description: truncate(desc, 60),
      };
    }),
  ].filter((row): row is { id: string; title: string; description: string } => Boolean(row));

  const baseReplacements: Record<string, string> = {};
  const headerText = truncate(applyConfigTokens(config.subscriptionPlanListTitle, config, baseReplacements), 60);
  const bodyText = truncate(applyConfigTokens(config.subscriptionPlanListBody, config, baseReplacements), MENU_TEXT_LIMIT);
  const buttonText = truncate(applyConfigTokens(config.subscriptionPlanListButtonText, config, baseReplacements), BUTTON_TITLE_LIMIT);

  const interactive: Record<string, unknown> = {
    type: "list",
    header: {
      type: "text",
      text: headerText,
    },
    body: {
      text: bodyText,
    },
    action: {
      button: buttonText,
      sections: [
        {
          title: headerText,
          rows,
        },
      ],
    },
  };

  const footer = config.subscriptionPlanListFooterText?.trim();
  if (footer) {
    interactive.footer = {
      text: truncate(applyConfigTokens(footer, config, baseReplacements), 60),
    };
  }

  await dispatchMetaMessage(webhook, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive,
  }, {
    successLog: `Lista de planos enviada para ${to}`,
    failureLog: `Falha ao enviar lista de planos para ${to}`,
  });
};

const buildPlanPaymentSummary = (plan: SubscriptionPlan) =>
  [
    `📦 Plano: ${plan.name}`,
    `💰 Valor: ${formatCurrency(plan.price)}`,
    "🤖 Instância base: 1 incluída",
    "👥 Grupo: 1 licença",
    `⏳ Duração: ${plan.durationDays} dias`,
  ].join("\n");

// Helpers para cálculo/legenda de add-ons
const formatAddonSelectionSummary = (selections: PlanAddonSelection[]) => {
  const parts: string[] = [];
  for (const selection of selections) {
    const q = Math.max(0, Math.floor(Number(selection.quantity ?? 0)));
    if (q <= 0) continue;
    if (selection.type === "instance") {
      parts.push(`${q} instância(s)`);
    }
  }
  return parts.length > 0 ? parts.join(" e ") : "sem extras";
};

const computeAddonTotalAmount = (plan: SubscriptionPlan, selections: PlanAddonSelection[]) =>
  selections.reduce((sum, s) => {
    const qty = Math.max(0, Math.floor(Number(s.quantity ?? 0)));
    const unit = s.type === "instance" ? plan.addonInstancePrice : 0;
    return sum + unit * qty;
  }, 0);

export const sendAdminPlanPayment = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  plan: SubscriptionPlan;
  method?: AdminPlanPaymentMethod;
}) => {
  const { webhook, to, user, plan } = options;
  const config = await getAdminBotConfig();
  let forcedMethod = options.method;

  const summary = buildPlanPaymentSummary(plan);
  const baseReplacements: Record<string, string> = {
    "{{plan_name}}": plan.name,
    "{{plan_price}}": formatCurrency(plan.price),
    "{{plan_summary}}": summary,
  };
  const normalizeInteractiveBody = (text: string) =>
    text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const combineHeaderAndBody = (header: string | null | undefined, body: string) => {
    const trimmed = (header ?? "").trim();
    return trimmed ? `${trimmed}\n\n${body}` : body;
  };

  const [pixConfig, polopagConfig, checkoutConfig] = await Promise.all([
    getAdminMercadoPagoPixConfig(),
    getAdminPoloPagPixConfig(),
    getAdminMercadoPagoCheckoutConfig(),
  ]);

  const methodDisplayName: Record<AdminPlanPaymentMethod, string> = {
    mercadopago_pix:
      pixConfig.displayName?.trim() ||
      applyConfigTokens(config.paymentMethodPixRowTitle, config, baseReplacements) ||
      "Pix (Mercado Pago)",
    polopag_pix:
      polopagConfig.displayName?.trim() ||
      "Pix (PoloPag)",
    mercadopago_checkout:
      checkoutConfig.displayName?.trim() ||
      applyConfigTokens(config.paymentMethodCheckoutRowTitle, config, baseReplacements) ||
      "Pagamento online",
  };

  const methodFlags: Record<AdminPlanPaymentMethod, { enabled: boolean; canCharge: boolean }> = {
    mercadopago_pix: {
      enabled: Boolean(pixConfig.isActive),
      canCharge: Boolean(pixConfig.isActive && pixConfig.isConfigured && pixConfig.accessToken),
    },
    polopag_pix: {
      enabled: Boolean(polopagConfig.isActive),
      canCharge: Boolean(polopagConfig.isActive && polopagConfig.isConfigured && polopagConfig.apiKey),
    },
    mercadopago_checkout: {
      enabled: Boolean(checkoutConfig.isActive),
      canCharge: Boolean(checkoutConfig.isActive && checkoutConfig.isConfigured && checkoutConfig.accessToken),
    },
  };

  try {
    console.info(
      "[PlanPayment] flags:",
      JSON.stringify({
        planId: plan.id,
        method: forcedMethod,
        methods: PLAN_PAYMENT_METHOD_PRIORITY.map((method) => ({
          method,
          enabled: methodFlags[method].enabled,
          canCharge: methodFlags[method].canCharge,
        })),
      }),
    );
  } catch {}

  const sendPixCharge = async (provider: "mercadopago_pix" | "polopag_pix"): Promise<boolean> => {
    if (!methodFlags[provider].canCharge) {
      return false;
    }

    try {
      const charge = await createPlanPixCharge({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        plan,
        addons: [],
        provider,
      });

      const expirationText = charge.expiresAt ? formatDateTime(charge.expiresAt) : "";
      const pixReplacements: Record<string, string> = {
        ...baseReplacements,
        "{{pix_expires_at}}": expirationText,
        "{{pix_expiration_line}}": expirationText ? `Expira em: ${expirationText}` : "",
        "{{payment_display_name}}": methodDisplayName[provider],
      };
      const rawHeader = applyConfigTokens(config.pixPaymentHeaderText, config, pixReplacements).trim();
      const rawBody = applyConfigTokens(config.pixPaymentBodyText, config, pixReplacements);
      const rawButton = applyConfigTokens(config.pixPaymentButtonText, config, pixReplacements).trim();
      const normalizedBody = normalizeInteractiveBody(rawBody);
      const resolvedBody = normalizedBody || summary;
      const interactiveBody = truncate(resolvedBody, META_INTERACTIVE_BODY_LIMIT);
      const defaultButton = provider === "polopag_pix" ? `Abrir ${methodDisplayName[provider]}` : "Abrir pagamento Pix";
      const buttonText = truncate(rawButton || defaultButton, BUTTON_TITLE_LIMIT);
      const combinedText = combineHeaderAndBody(rawHeader, resolvedBody);

      let headerImageUrl: string | null = null;
      if (charge.qrCodeBase64) {
        headerImageUrl = await saveBase64ImageToPublicUrl({ base64: charge.qrCodeBase64, filename: `qr-plan-${plan.id}.png`, folder: "qr" });
      }

      if (provider === "mercadopago_pix" && charge.ticketUrl && headerImageUrl) {
        await sendInteractiveCtaUrlMessage({
          webhook,
          to,
          bodyText: interactiveBody,
          buttonText,
          buttonUrl: charge.ticketUrl,
          headerImageUrl,
        });
      } else if (charge.qrCodeBase64) {
        const upload = await uploadImageFromBase64({ webhook, base64: charge.qrCodeBase64, filename: `qr-plan-${plan.id}.png` }).catch(() => null);
        if (upload?.mediaId) {
          await sendMediaMessage({
            webhook,
            to,
            mediaId: upload.mediaId,
            mediaType: "image",
            caption: interactiveBody,
            filename: upload.filename,
          });
        } else {
          await sendTextMessage({
            webhook,
            to,
            text: combinedText,
          });
        }
      } else {
        await sendTextMessage({
          webhook,
          to,
          text: combinedText,
        });
      }

      if (charge.qrCode) {
        await sendTextMessage({ webhook, to, text: charge.qrCode.trim() });
      }

      return true;
    } catch (error) {
      console.error(`Falha ao gerar cobrança Pix do plano (${provider})`, error);
      return false;
    }
  };

  const tryCheckout = async (): Promise<boolean> => {
    if (!methodFlags.mercadopago_checkout.canCharge) {
      return false;
    }
    try {
      const checkout = await createPlanCheckoutPreference({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        plan,
        addons: [],
      });

      if (checkout.ticketUrl) {
        const checkoutReplacements: Record<string, string> = {
          ...baseReplacements,
          "{{payment_display_name}}": methodDisplayName.mercadopago_checkout,
        };
        const rawHeader = applyConfigTokens(config.checkoutPaymentHeaderText, config, checkoutReplacements).trim();
        const rawBody = applyConfigTokens(config.checkoutPaymentBodyText, config, checkoutReplacements);
        const rawButton = applyConfigTokens(config.checkoutPaymentButtonText, config, checkoutReplacements).trim();
        const normalizedBody = normalizeInteractiveBody(rawBody);
        const resolvedBody = normalizedBody || summary;
        const interactiveBody = truncate(resolvedBody, META_INTERACTIVE_BODY_LIMIT);
        const headerText = rawHeader ? truncate(rawHeader, 60) : undefined;
        const defaultButton = `Abrir ${methodDisplayName.mercadopago_checkout}`;
        const buttonText = truncate(rawButton || defaultButton, BUTTON_TITLE_LIMIT);

        await sendInteractiveCtaUrlMessage({
          webhook,
          to,
          bodyText: interactiveBody,
          buttonText,
          buttonUrl: checkout.ticketUrl,
          headerText,
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error("Falha ao gerar checkout do plano", error);
      return false;
    }
  };

  const attemptMethod = async (method: AdminPlanPaymentMethod): Promise<boolean> => {
    if (!methodFlags[method].enabled) {
      return false;
    }
    switch (method) {
      case "mercadopago_pix":
        return sendPixCharge("mercadopago_pix");
      case "polopag_pix":
        return sendPixCharge("polopag_pix");
      case "mercadopago_checkout":
        return tryCheckout();
      default:
        return false;
    }
  };

  const enabledMethods = PLAN_PAYMENT_METHOD_PRIORITY.filter((method) => methodFlags[method].enabled);

  if (!enabledMethods.length) {
    await sendTextMessage({ webhook, to, text: "Nenhuma forma de pagamento está ativa no momento." });
    return;
  }

  if (forcedMethod && !methodFlags[forcedMethod]?.enabled) {
    forcedMethod = enabledMethods[0];
  }

  if (forcedMethod) {
    const ok = await attemptMethod(forcedMethod);
    if (!ok) {
      const failureText =
        forcedMethod === "mercadopago_checkout"
          ? "Não foi possível abrir o checkout agora. Tente novamente mais tarde."
          : "Não foi possível gerar o Pix agora. Tente novamente mais tarde.";
      await sendTextMessage({ webhook, to, text: failureText });
    }
    return;
  }

  if (enabledMethods.length > 1) {
    const methodPrefixes: Record<AdminPlanPaymentMethod, string> = {
      mercadopago_pix: ADMIN_PLAN_PAY_PIX_PREFIX,
      polopag_pix: ADMIN_PLAN_PAY_POLOPAG_PREFIX,
      mercadopago_checkout: ADMIN_PLAN_PAY_CHECKOUT_PREFIX,
    };

    const repl = {
      "{{plan_name}}": plan.name,
      "{{plan_price}}": formatCurrency(plan.price),
      "{{plan_instance_limit}}": String(plan.instanceLimit),
      "{{plan_group_limit}}": String(plan.groupLimit),
      "{{plan_duration_days}}": String(plan.durationDays),
    } as Record<string, string>;

    const header = truncate(applyConfigTokens(config.paymentMethodPickerTitle, config, repl), 60);
    const baseBody = applyConfigTokens(config.paymentMethodPickerBody, config, repl).trim();
    const planDetailsTpl = (config.paymentMethodPlanDetailsTemplate ||
      "📦 Plano: {{plan_name}}\n💰 Valor: {{plan_price}}\n🤖 Instâncias: {{plan_instance_limit}}\n👥 Grupos: {{plan_group_limit}}\n⏳ Duração: {{plan_duration_days}} dias").trim();
    const details = applyConfigTokens(planDetailsTpl, config, repl);
    const body = truncate([details, baseBody].filter(Boolean).join("\n\n"), META_INTERACTIVE_BODY_LIMIT);
    const button = truncate(applyConfigTokens(config.paymentMethodPickerButtonText, config, repl), BUTTON_TITLE_LIMIT);
    const rows = enabledMethods.map((method) => {
      const methodRepl = {
        ...repl,
        "{{payment_display_name}}": methodDisplayName[method],
      };
      const titleTemplate = method === "mercadopago_checkout"
        ? config.paymentMethodCheckoutRowTitle
        : config.paymentMethodPixRowTitle;
      const descriptionTemplate = method === "mercadopago_checkout"
        ? config.paymentMethodCheckoutRowDescription
        : config.paymentMethodPixRowDescription;
      const fallbackTitle = applyConfigTokens(titleTemplate, config, methodRepl);
      const description = applyConfigTokens(descriptionTemplate, config, methodRepl);

      return {
        id: `${methodPrefixes[method]}${plan.id}`,
        title: truncate(methodDisplayName[method] || fallbackTitle, META_INTERACTIVE_ROW_TITLE_LIMIT),
        description: truncate(description, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
      };
    });

    const res = await dispatchMetaMessage(webhook, {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        header: { type: "text", text: header },
        body: { text: body },
        action: { button, sections: [{ title: "Formas de pagamento", rows }] },
      },
    }, {
      successLog: `Picker de método de pagamento enviado para ${to}`,
      failureLog: `Falha ao enviar picker de método de pagamento para ${to}`,
    });

    try {
      await updateAdminBotSessionFlow(to, { name: "plan_payment_method_pick", planId: plan.id });
      const messageIds = (res as any)?.messageIds as string[] | undefined;
      if (Array.isArray(messageIds)) {
        for (const mid of messageIds) {
          await savePlanPickerMessageContext(mid, plan.id);
        }
      }
      await cleanupAdminMessageContext(240).catch(() => {});
    } catch {}
    return;
  }

  for (const method of PLAN_PAYMENT_METHOD_PRIORITY) {
    if (!methodFlags[method].enabled) {
      continue;
    }
    const ok = await attemptMethod(method);
    if (ok) {
      return;
    }
  }

  await sendTextMessage({ webhook, to, text: "Não foi possível gerar o pagamento automaticamente. Tente novamente mais tarde." });
};

export const sendAdminPlanAddonQuantityPrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  plan: SubscriptionPlan;
  type: "instance" | "group";
}) => {
  const { webhook, to, plan } = options;
  const type = "instance";
  const unitPrice = plan.addonInstancePrice;
  const label = "instâncias";

  const quickOptions = [1, 3, 5];
  const rows = quickOptions.map((quantity) => ({
    id: `${ADMIN_PLAN_ADDON_QUANTITY_PREFIX}${type}_${quantity}`,
    title: truncate(`${quantity} ${label}`, META_INTERACTIVE_ROW_TITLE_LIMIT),
    description: truncate(`Total: R$ ${formatCurrency(unitPrice * quantity)}`, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
  }));
  rows.push({
    id: `${ADMIN_PLAN_ADDON_QUANTITY_CUSTOM_PREFIX}${type}`,
    title: truncate("Outro valor", META_INTERACTIVE_ROW_TITLE_LIMIT),
    description: truncate("Informar manualmente", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
  });
  rows.push({
    id: ADMIN_FLOW_BUTTON_IDS.cancel,
    title: truncate((await getAdminBotConfig()).addonQuantityCancelRowText || "Cancelar", META_INTERACTIVE_ROW_TITLE_LIMIT),
    description: truncate("Voltar ao menu", META_INTERACTIVE_ROW_DESCRIPTION_LIMIT),
  });

  const payload: MetaMessagePayload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: truncate(applyConfigTokens((await getAdminBotConfig()).addonQuantityHeaderText, await getAdminBotConfig(), {}), 60) },
      body: {
        text: truncate(applyConfigTokens((await getAdminBotConfig()).addonQuantityBodyText, await getAdminBotConfig(), {
          "{{addon_unit_price}}": formatCurrency(unitPrice),
          "{{addon_label}}": label.replace(/s$/, ""),
        }), META_INTERACTIVE_BODY_LIMIT),
      },
      action: {
        button: truncate((await getAdminBotConfig()).addonQuantityButtonText, BUTTON_TITLE_LIMIT),
        sections: [
          {
            title: truncate("Quantidades rápidas", META_INTERACTIVE_SECTION_TITLE_LIMIT),
            rows: rows.map((row) => ({
              id: row.id,
              title: sanitizeListLabel(row.title, META_INTERACTIVE_ROW_TITLE_LIMIT, row.title),
              description: row.description
                ? sanitizeListLabel(row.description, META_INTERACTIVE_ROW_DESCRIPTION_LIMIT, undefined as any)
                : undefined,
            })),
          },
        ],
      },
    },
  };

  await dispatchMetaMessage(webhook, payload, {
    successLog: `Prompt de quantidade de add-ons enviado para ${to}`,
    failureLog: `Falha ao enviar prompt de quantidade de add-ons para ${to}`,
  });
};

export const sendAdminPlanAddonTypePrompt = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  plan: SubscriptionPlan;
}) => {
  const { webhook, to, plan } = options;
  const config = await getAdminBotConfig();
  const tokens: Record<string, string> = {
    "{{addon_instance_price}}": formatCurrency(plan.addonInstancePrice),
    "{{addon_group_price}}": formatCurrency(plan.addonGroupPrice),
  };
  await sendInteractiveReplyButtonsMessage({
    webhook,
    to,
    headerText: truncate(applyConfigTokens(config.addonTypeHeaderText, config, tokens), 60),
    bodyText: truncate(applyConfigTokens(config.addonTypeBodyText, config, tokens), META_INTERACTIVE_BODY_LIMIT),
    buttons: [
      { id: ADMIN_PLAN_ADDON_TYPE_INSTANCE_ID, title: truncate(config.addonTypeInstanceButtonText, BUTTON_TITLE_LIMIT) },
      { id: ADMIN_FLOW_BUTTON_IDS.cancel, title: truncate(config.addonTypeCancelButtonText, BUTTON_TITLE_LIMIT) },
    ],
  });
};

export const sendAdminPlanAddonPayment = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
  user: SessionUser;
  plan: SubscriptionPlan;
  status: UserPlanStatus;
  selections: PlanAddonSelection[];
  method?: "pix" | "checkout";
}) => {
  const { webhook, to, user, plan, status, selections } = options;
  const method = options.method;

  const sanitizedSelections = selections.filter((selection) => selection.type === "instance" && selection.quantity > 0);
  if (sanitizedSelections.length === 0) {
    await sendTextMessage({ webhook, to, text: "Informe a quantidade de add-ons antes de continuar." });
    return;
  }

  if (sanitizedSelections.length > 1) {
    await sendTextMessage({ webhook, to, text: "Adicione um tipo de add-on por vez. Repita o processo para cada tipo desejado." });
    return;
  }

  if (plan.addonInstancePrice <= 0) {
    await sendTextMessage({ webhook, to, text: "Este plano não possui preço configurado para instâncias extras." });
    return;
  }

  const totalAmount = computeAddonTotalAmount(plan, sanitizedSelections);
  if (totalAmount <= 0) {
    await sendTextMessage({ webhook, to, text: "Os valores de add-ons não estão configurados para este plano." });
    return;
  }

  const summaryLabel = formatAddonSelectionSummary(sanitizedSelections);
  const addonExpiresAt = status.currentPeriodEnd ?? null;
  const subscriptionId = status.subscriptionId ?? null;

  const [pixConfig, checkoutConfig] = await Promise.all([
    getAdminMercadoPagoPixConfig(),
    getAdminMercadoPagoCheckoutConfig(),
  ]);

  const pixActive = Boolean(pixConfig.isActive && pixConfig.accessToken);
  const checkoutActive = Boolean(checkoutConfig.isActive && checkoutConfig.accessToken);

  if (!pixActive && !checkoutActive) {
    await sendTextMessage({ webhook, to, text: "Nenhuma forma de pagamento está ativa para gerar os add-ons." });
    return;
  }

  const summaryText = `Plano: ${plan.name}\nExtras: ${summaryLabel}\nTotal: ${formatCurrency(totalAmount)}`;

  const tryPix = async () => {
    if (!pixActive || !pixConfig.accessToken) {
      return false;
    }
    try {
      const checkout = await createPlanAddonPixCharge({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        plan,
        addons: sanitizedSelections,
        subscriptionId,
        addonExpiresAt,
      });

      let headerImageUrl: string | null = null;
      if (checkout.qrCodeBase64) {
        headerImageUrl = await saveBase64ImageToPublicUrl({ base64: checkout.qrCodeBase64, filename: `qr-addon-${plan.id}.png`, folder: "qr" });
      }

      const bodyText = truncate(`${summaryText}\n\nUse o botão para abrir o QR Code Pix.`, META_INTERACTIVE_BODY_LIMIT);

      if (checkout.ticketUrl && headerImageUrl) {
        await sendInteractiveCtaUrlMessage({
          webhook,
          to,
          bodyText,
          buttonText: "Pagar com Pix",
          buttonUrl: checkout.ticketUrl,
          headerImageUrl,
          headerText: undefined,
        });
      } else if (checkout.qrCodeBase64) {
        const upload = await uploadImageFromBase64({ webhook, base64: checkout.qrCodeBase64, filename: `qr-addon-${plan.id}.png` }).catch(() => null);
        if (upload?.mediaId) {
          await sendMediaMessage({
            webhook,
            to,
            mediaId: upload.mediaId,
            mediaType: "image",
            caption: bodyText,
            filename: upload.filename,
          });
        } else {
          await sendTextMessage({ webhook, to, text: bodyText });
        }
      } else {
        await sendTextMessage({ webhook, to, text: bodyText });
      }

      if (checkout.qrCode) {
        await sendTextMessage({ webhook, to, text: checkout.qrCode.trim() });
      }

      return true;
    } catch (error) {
      console.error("Falha ao gerar pagamento de add-ons via Pix", error);
      return false;
    }
  };

  const tryCheckout = async () => {
    if (!checkoutActive || !checkoutConfig.accessToken) {
      return false;
    }
    try {
      const checkout = await createPlanAddonCheckoutPreference({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        plan,
        addons: sanitizedSelections,
        subscriptionId,
        addonExpiresAt,
      });

      if (checkout.ticketUrl) {
        await sendInteractiveCtaUrlMessage({
          webhook,
          to,
          bodyText: truncate(`${summaryText}\n\nUse o botão para abrir o checkout seguro.`, META_INTERACTIVE_BODY_LIMIT),
          buttonText: "Pagar online",
          buttonUrl: checkout.ticketUrl,
          headerText: "Add-ons online",
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error("Falha ao gerar pagamento de add-ons via checkout", error);
      return false;
    }
  };

  if (method === "pix") {
    if (!pixActive) {
      await sendTextMessage({ webhook, to, text: "O pagamento via Pix está desativado no momento." });
      return;
    }
    const ok = await tryPix();
    if (!ok) {
      await sendTextMessage({ webhook, to, text: "Não foi possível gerar o Pix agora. Tente novamente em instantes." });
    }
    return;
  }

  if (method === "checkout") {
    if (!checkoutActive) {
      await sendTextMessage({ webhook, to, text: "O pagamento online está desativado no momento." });
      return;
    }
    const ok = await tryCheckout();
    if (!ok) {
      await sendTextMessage({ webhook, to, text: "Não foi possível gerar o checkout agora. Tente novamente em instantes." });
    }
    return;
  }

  if (pixActive && checkoutActive) {
    const firstSelection = sanitizedSelections[0];
    await sendInteractiveReplyButtonsMessage({
      webhook,
      to,
      headerText: "Escolher método",
      bodyText: `Extras do plano: ${summaryLabel}. Como deseja pagar?`,
      buttons: [
        { id: `${ADMIN_PLAN_ADDON_PAY_PIX_PREFIX}${firstSelection.type}_${firstSelection.quantity}`, title: "Pagar com Pix" },
        { id: `${ADMIN_PLAN_ADDON_PAY_CHECKOUT_PREFIX}${firstSelection.type}_${firstSelection.quantity}`, title: "Pagar online" },
        { id: ADMIN_FLOW_BUTTON_IDS.cancel, title: "Cancelar" },
      ],
    });
    return;
  }

  if (pixActive) {
    const ok = await tryPix();
    if (!ok) {
      await sendTextMessage({ webhook, to, text: "Não foi possível gerar o Pix agora. Tente novamente em instantes." });
    }
    return;
  }

  if (checkoutActive) {
    const ok = await tryCheckout();
    if (!ok) {
      await sendTextMessage({ webhook, to, text: "Não foi possível gerar o checkout agora. Tente novamente em instantes." });
    }
    return;
  }
};

export const sendAdminSupportMessage = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}): Promise<string> => {
  const { webhook, to } = options;
  const siteSettings = await getAdminSiteSettings();

  const lines = [
    "Pedido de ajuda aberto! ✅",
    "Envie agora, de forma clara e objetiva, o seu pedido de ajuda. Nossa equipe receberá tudo pelo painel.",
    siteSettings.supportEmail ? `E-mail: ${siteSettings.supportEmail}` : null,
    siteSettings.supportPhone ? `WhatsApp: ${siteSettings.supportPhone}` : null,
    "Assim que quiser voltar ao menu principal, use o botão abaixo.",
  ];

  const bodyText = lines.filter(Boolean).join("\n");

  await sendInteractiveReplyButtonsMessage({
    webhook,
    to,
    headerText: "Pedido de suporte",
    bodyText,
    buttons: [
      { id: ADMIN_MENU_BUTTON_IDS.home, title: "Voltar ao menu" },
    ],
  });

  return bodyText;
};

export const sendAdminRegistrationMissingMessage = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;

  const message = [
    "Não encontramos uma conta ativa vinculada a este número de WhatsApp.",
    "Cadastre-se no StoreBot ou atualize o número nas configurações do seu perfil para usar o bot administrativo.",
    `${APP_BASE_URL}/sign-in`,
  ].join("\n");

  await sendTextMessage({
    webhook,
    to,
    text: message,
  });
};

export const sendAdminUnknownOptionMessage = async (options: {
  webhook: MetaWebhookCredentials;
  to: string;
}) => {
  const { webhook, to } = options;

  await sendTextMessage({
    webhook,
    to,
    text: "Não entendi sua solicitação. Use os botões para escolher uma das opções disponíveis.",
  });
};

export const parseAdminCategoryRowId = (rawId: string) => {
  if (rawId.startsWith(ADMIN_CATEGORY_ROW_PREFIX)) {
    const numeric = Number.parseInt(rawId.slice(ADMIN_CATEGORY_ROW_PREFIX.length), 10);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
};

export const parseAdminCategoryNextPage = (rawId: string) => {
  if (rawId.startsWith(ADMIN_CATEGORY_NEXT_PREFIX)) {
    const numeric = Number.parseInt(rawId.slice(ADMIN_CATEGORY_NEXT_PREFIX.length), 10);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
};

export const parseAdminInstanceRowId = (rawId: string): number | null => {
  if (!rawId.startsWith(ADMIN_INSTANCE_ROW_PREFIX)) {
    return null;
  }
  const numeric = Number.parseInt(rawId.slice(ADMIN_INSTANCE_ROW_PREFIX.length), 10);
  return Number.isFinite(numeric) ? numeric : null;
};

export const parseAdminInstanceAction = (
  rawId: string,
): { action: keyof typeof ADMIN_INSTANCE_ACTION_PREFIX; instanceId: number } | null => {
  for (const [key, prefix] of Object.entries(ADMIN_INSTANCE_ACTION_PREFIX)) {
    if (rawId.startsWith(prefix)) {
      const numeric = Number.parseInt(rawId.slice(prefix.length), 10);
      if (Number.isFinite(numeric)) {
        return { action: key as keyof typeof ADMIN_INSTANCE_ACTION_PREFIX, instanceId: numeric };
      }
      return null;
    }
  }
  return null;
};

export const parseAdminCategoryRenameNextPage = (rawId: string) =>
  parsePrefixedCategoryId(rawId, ADMIN_CATEGORY_RENAME_NEXT_PREFIX);

export const parseAdminCategoryPriceNextPage = (rawId: string) =>
  parsePrefixedCategoryId(rawId, ADMIN_CATEGORY_PRICE_NEXT_PREFIX);

export const parseAdminCategorySkuNextPage = (rawId: string) =>
  parsePrefixedCategoryId(rawId, ADMIN_CATEGORY_SKU_NEXT_PREFIX);

const parsePrefixedCategoryId = (rawId: string, prefix: string) => {
  if (rawId.startsWith(prefix)) {
    const numeric = Number.parseInt(rawId.slice(prefix.length), 10);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

export const parseAdminCategoryRenameRowId = (rawId: string) =>
  parsePrefixedCategoryId(rawId, ADMIN_CATEGORY_RENAME_PREFIX);

export const parseAdminCategoryPriceRowId = (rawId: string) =>
  parsePrefixedCategoryId(rawId, ADMIN_CATEGORY_PRICE_PREFIX);

export const parseAdminCategorySkuRowId = (rawId: string) =>
  parsePrefixedCategoryId(rawId, ADMIN_CATEGORY_SKU_PREFIX);

export const parseAdminPlanRowId = (rawId: string) => {
  if (rawId.startsWith(ADMIN_PLAN_ROW_PREFIX)) {
    const numeric = Number.parseInt(rawId.slice(ADMIN_PLAN_ROW_PREFIX.length), 10);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
};
