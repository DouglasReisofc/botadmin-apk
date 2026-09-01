import { RowDataPacket } from "mysql2";
import sharp from "sharp";

import type { AdminBotConfig } from "types/admin-bot";
import { getAppBaseUrl } from "lib/meta";
import {
  DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  DEFAULT_NOTIFICATION_BOT_NAME,
  DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
} from "data/notification-audio";
import {
  AdminBotConfigRow,
  ensureAdminBotConfigTable,
  getDb,
} from "./db";
import { deleteUploadedFile, resolveUploadedFileUrl, saveUploadedFile } from "./uploads";

const DEFAULT_SUPPORT_URL = (() => {
  try {
    return getAppBaseUrl();
  } catch {
    return "https://storebot.app";
  }
})();

const DEFAULT_ADMIN_BOT_CONFIG: AdminBotConfig = {
  botName: DEFAULT_NOTIFICATION_BOT_NAME,
  purchaseVoiceTemplate: DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  balanceVoiceTemplate: DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  menuText:
    "Olá {{user_first_name}},\n\nBem-vindo ao painel rápido do StoreBot pelo WhatsApp. Use os botões abaixo para navegar pelas funções principais.",
  menuFooterText: "Selecione uma opção para continuar.",
  panelButtonText: "Painel",
  subscriptionButtonText: "Assinatura",
  supportButtonText: "Suporte",
  supportUrl: DEFAULT_SUPPORT_URL,
  supportCtaBodyText: "Selecione uma opção para continuar.",
  supportCtaFooterText: DEFAULT_NOTIFICATION_BOT_NAME,
  menuImageUrl: null,
  menuImagePath: null,
  subscriptionHeaderText: "Resumo do plano",
  subscriptionBodyText:
    "Plano: {{plan_name}}\nStatus: {{plan_status}}\nValor: {{plan_price}}\nVencimento: {{plan_renews_at}}",
  subscriptionFooterText: "Escolha uma ação para gerenciar sua assinatura.",
  subscriptionRenewButtonText: "Renovar",
  subscriptionChangeButtonText: "Mudar plano",
  subscriptionDetailsButtonText: "Ver detalhes",
  subscriptionNoPlanHeaderText: "Você ainda não possui um plano ativo.",
  subscriptionNoPlanBodyText:
    "Escolha a melhor opção para iniciar sua assinatura do StoreBot e liberar todos os recursos.",
  subscriptionNoPlanButtonText: "Assinar plano",
  subscriptionPlanListTitle: "Planos disponíveis",
  subscriptionPlanListBody:
    "Selecione um dos planos abaixo para gerar o pagamento imediatamente.",
  subscriptionPlanListButtonText: "Escolher",
  subscriptionPlanListFooterText:
    "Após selecionar um plano enviaremos o link de pagamento automaticamente.",
  subscriptionPlanListRowDescriptionTemplate:
    "💰 {{plan_price}} · 🤖 {{plan_instance_limit}} instâncias · 👥 {{plan_group_limit}} grupos",
  // Pagamento (escolha de método)
  paymentMethodPickerTitle: "Escolher forma de pagamento",
  paymentMethodPickerBody: "{{plan_name}} • {{plan_price}}\n\nSelecione como deseja pagar:",
  paymentMethodPickerButtonText: "Escolher",
  paymentMethodPixRowTitle: "Pagar com Pix",
  paymentMethodPixRowDescription: "QR Code/Chave Pix",
  paymentMethodCheckoutRowTitle: "Pagar online",
  paymentMethodCheckoutRowDescription: "Cartão/Pix no checkout",
  paymentMethodPlanDetailsTemplate:
    "📦 Plano: {{plan_name}}\n💰 Valor: {{plan_price}}\n🤖 Instâncias: {{plan_instance_limit}}\n👥 Grupos: {{plan_group_limit}}\n⏳ Duração: {{plan_duration_days}} dias",
  pixPaymentHeaderText: "Pagamento Pix",
  pixPaymentBodyText:
    "💳 Pagamento Pix\n\n{{plan_summary}}\n{{pix_expiration_line}}\n\nUse o botão abaixo para abrir o QR Code e finalizar o pagamento.",
  pixPaymentButtonText: "Abrir pagamento Pix",
  checkoutPaymentHeaderText: "Pagamento online",
  checkoutPaymentBodyText:
    "💳 Pagamento online\n\n{{plan_summary}}\n\nToque no botão abaixo para abrir o checkout seguro e concluir o pagamento.",
  checkoutPaymentButtonText: "Abrir checkout",
  // Confirmações (WhatsApp)
  planConfirmHeaderText: "Assinatura confirmada",
  planConfirmBodyText: "✅ Assinatura confirmada!\n• Plano: {{plan_name}}\n• Valor pago: R$ {{amount}}\n• Novo vencimento: {{new_due_date}}\n\nAcesse o painel pelo botão abaixo para continuar.",
  planConfirmButtonText: "Abrir painel",
  planConfirmMediaUrl: null,
  planConfirmMediaPath: null,
  addonConfirmHeaderText: "Add-ons ativados",
  addonConfirmBodyText: "🧩 Add-ons ativados com sucesso!\n• Itens: {{addons_summary}}\n• Validade: {{addon_expires_at}}\n\nUse o botão abaixo para gerenciar seus recursos.",
  addonConfirmButtonText: "Abrir painel",
  addonConfirmMediaUrl: null,
  addonConfirmMediaPath: null,
  // Add-ons (planos)
  addonTypeHeaderText: "Comprar add-ons",
  addonTypeBodyText: "Instâncias extras custam {{addon_instance_price}} cada. Grupos são ativados individualmente na página de grupos.",
  addonTypeInstanceButtonText: "Instâncias extras",
  addonTypeGroupButtonText: "Grupos no painel",
  addonTypeCancelButtonText: "Cancelar",
  addonQuantityHeaderText: "Comprar add-ons",
  addonQuantityBodyText: "Cada {{addon_label}} extra custa {{addon_unit_price}}. Escolha a quantidade desejada.",
  addonQuantityButtonText: "Selecionar",
  addonQuantityCancelRowText: "Cancelar",
  // Instância conectada
  instanceConnectedHeaderText: "Instância conectada",
  instanceConnectedBodyText: "✅ {{instance_name}} conectada com sucesso!\nDeseja vincular um grupo agora?",
  instanceConnectedLinkGroupButtonText: "Vincular grupo",
  instanceConnectedLaterButtonText: "Agora não",
  // Cadastro de grupo
  groupCreateHeaderText: "Cadastrar grupo",
  groupCreateBodyText: "Me envie agora o link do seu grupo (https://chat.whatsapp.com/...).",
  groupCreateFooterText: null,
  groupCreateCancelButtonText: "Cancelar",
  // Painel interno (defaults also used to pré-preencher editores)
  panelHeaderText: "Painel administrativo",
  panelBodyText: "Escolha o que deseja gerenciar agora.",
  panelGroupsRowTitle: "Gerenciar grupos",
  panelGroupsRowDescription: "Cadastrar, listar e remover grupos.",
  panelInstancesRowTitle: "Gerenciar instâncias",
  panelInstancesRowDescription: "Conectar, parear ou remover suas instâncias.",
  panelWebRowTitle: "🌐 Painel web",
  panelWebRowDescription: "Abra o painel no navegador para gerenciar tudo.",
  panelBackRowTitle: "Voltar",
  panelBackRowDescription: "Retornar ao menu principal.",
  // Grupos – ações
  groupActionsHeaderText: "Grupos",
  groupActionsBodyText: "O que você deseja fazer com os grupos?",
  groupActionsButtonText: "Escolher",
  groupActionsListTitle: "Listar grupos",
  groupActionsListDesc: "Ver grupos cadastrados.",
  groupActionsCreateTitle: "Cadastrar grupo",
  groupActionsCreateDesc: "Adicionar um novo grupo.",
  groupActionsRemoveTitle: "Excluir grupo",
  groupActionsRemoveDesc: "Remover um grupo existente.",
  groupActionsBackTitle: "Voltar",
  groupActionsBackDesc: "Retornar ao painel.",
  // Grupos – selecionar instância
  groupSelectInstanceHeaderText: "Selecionar instância",
  groupSelectInstanceBodyText: "Escolha a instância para cadastrar o grupo.",
  groupSelectInstanceButtonText: "Selecionar",
  // Grupos – exclusão
  groupDeletePromptBodyText: "Confirmar exclusão do grupo?",
  groupDeleteConfirmButtonText: "Confirmar",
  groupDeleteCancelButtonText: "Cancelar",
  // Painel web (CTA)
  webPanelHeaderText: "🌐 Painel web",
  webPanelBodyText: "Acesse o painel completo do StoreBot pelo navegador para configurar planos, instâncias e recursos avançados. Ideal para um controle rápido e completo.",
  webPanelButtonText: "Abrir painel web",
  // Cadastro rápido (WhatsApp)
  signupHeaderText: "🚀 Criar conta pelo WhatsApp",
  signupBodyText: "Me envie seu e-mail para começarmos seu cadastro. Você poderá usar o painel pelo WhatsApp imediatamente!",
  signupEmailInvalidText: "⚠️ Esse e-mail não parece válido. Tente novamente, por favor.",
  signupPasswordPromptText: "🔐 Perfeito! Agora envie uma senha com pelo menos 8 caracteres.",
  signupSuccessHeaderText: "✅ Conta criada!",
  signupSuccessBodyText: "Sua conta foi criada e seu WhatsApp já está vinculado. Toque no botão para abrir o painel rápido.",
  signupSuccessButtonText: "Abrir painel",
};

// Trata campos vazios (string ""), null ou undefined como "não preenchidos",
// retornando o valor padrão para pré-preencher os editores.
const looksMojibake = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.includes("�")) {
    return true;
  }

  if (trimmed.includes("Ã") || trimmed.includes("Â")) {
    return true;
  }

  const questionMatches = trimmed.match(/\?/g);
  const questionCount = questionMatches ? questionMatches.length : 0;
  if (questionCount >= 2 && questionCount / Math.max(1, trimmed.length) > 0.03) {
    return true;
  }

  return false;
};

const nonEmpty = (v: unknown, fallback: string): string => {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  if (!s.trim() || looksMojibake(s)) {
    return fallback;
  }
  return s;
};

const nonEmptyOrNull = (v: unknown, fallback: string | null): string | null => {
  if (fallback === null) {
    const s = typeof v === "string" ? v : v == null ? "" : String(v);
    if (!s.trim() || looksMojibake(s)) {
      return null;
    }
    return s;
  }
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  if (!s.trim() || looksMojibake(s)) {
    return fallback;
  }
  return s;
};

const mapRowToConfig = (row: AdminBotConfigRow | null): AdminBotConfig => {
  if (!row) {
    return DEFAULT_ADMIN_BOT_CONFIG;
  }

  return {
    botName: nonEmpty(row.bot_name, DEFAULT_ADMIN_BOT_CONFIG.botName),
    purchaseVoiceTemplate: nonEmpty(
      row.purchase_voice_template,
      DEFAULT_ADMIN_BOT_CONFIG.purchaseVoiceTemplate,
    ),
    balanceVoiceTemplate: nonEmpty(
      row.balance_voice_template,
      DEFAULT_ADMIN_BOT_CONFIG.balanceVoiceTemplate,
    ),
    menuText: nonEmpty(row.menu_text, DEFAULT_ADMIN_BOT_CONFIG.menuText),
    menuFooterText: nonEmptyOrNull(
      row.menu_footer_text,
      DEFAULT_ADMIN_BOT_CONFIG.menuFooterText,
    ),
    panelButtonText: nonEmpty(row.panel_button_text, DEFAULT_ADMIN_BOT_CONFIG.panelButtonText),
  subscriptionButtonText: nonEmpty(
    row.subscription_button_text,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionButtonText,
  ),
  supportButtonText: nonEmpty(row.support_button_text, DEFAULT_ADMIN_BOT_CONFIG.supportButtonText),
  supportUrl: nonEmptyOrNull((row as any).support_url, DEFAULT_ADMIN_BOT_CONFIG.supportUrl),
  supportCtaBodyText: nonEmpty(
    (row as any).support_cta_body_text,
    DEFAULT_ADMIN_BOT_CONFIG.supportCtaBodyText,
  ),
  supportCtaFooterText: nonEmptyOrNull(
    (row as any).support_cta_footer_text,
    DEFAULT_ADMIN_BOT_CONFIG.supportCtaFooterText,
  ),
    menuImageUrl: row.menu_image_path ? resolveUploadedFileUrl(row.menu_image_path) : null,
    menuImagePath: row.menu_image_path ?? null,
    subscriptionHeaderText: nonEmpty(row.subscription_header_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionHeaderText),
    subscriptionBodyText: nonEmpty(row.subscription_body_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionBodyText),
    subscriptionFooterText: nonEmptyOrNull(row.subscription_footer_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionFooterText),
    subscriptionRenewButtonText: nonEmpty(row.subscription_renew_button_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionRenewButtonText),
    subscriptionChangeButtonText: nonEmpty(row.subscription_change_button_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionChangeButtonText),
    subscriptionDetailsButtonText: nonEmpty(row.subscription_details_button_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionDetailsButtonText),
    subscriptionNoPlanHeaderText: nonEmpty(row.subscription_no_plan_header_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionNoPlanHeaderText),
    subscriptionNoPlanBodyText: nonEmpty(row.subscription_no_plan_body_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionNoPlanBodyText),
    subscriptionNoPlanButtonText: nonEmpty(row.subscription_no_plan_button_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionNoPlanButtonText),
    subscriptionPlanListTitle: nonEmpty(row.subscription_plan_list_title, DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListTitle),
    subscriptionPlanListBody: nonEmpty(row.subscription_plan_list_body, DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListBody),
    subscriptionPlanListButtonText: nonEmpty(row.subscription_plan_list_button_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListButtonText),
    subscriptionPlanListFooterText: nonEmptyOrNull(row.subscription_plan_list_footer_text, DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListFooterText),
    subscriptionPlanListRowDescriptionTemplate: nonEmpty((row as any).subscription_plan_list_row_template, DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListRowDescriptionTemplate!),
    // Método de pagamento
    paymentMethodPickerTitle: nonEmpty((row as any).payment_method_picker_title, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPickerTitle),
    paymentMethodPickerBody: nonEmpty((row as any).payment_method_picker_body, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPickerBody),
    paymentMethodPickerButtonText: nonEmpty((row as any).payment_method_picker_button_text, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPickerButtonText),
    paymentMethodPixRowTitle: nonEmpty((row as any).payment_method_pix_row_title, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPixRowTitle),
    paymentMethodPixRowDescription: nonEmpty((row as any).payment_method_pix_row_description, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPixRowDescription),
    paymentMethodCheckoutRowTitle: nonEmpty((row as any).payment_method_checkout_row_title, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodCheckoutRowTitle),
    paymentMethodCheckoutRowDescription: nonEmpty((row as any).payment_method_checkout_row_description, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodCheckoutRowDescription),
    paymentMethodPlanDetailsTemplate: nonEmpty((row as any).payment_method_plan_details_template, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPlanDetailsTemplate!),
    pixPaymentHeaderText: nonEmpty((row as any).pix_payment_header_text, DEFAULT_ADMIN_BOT_CONFIG.pixPaymentHeaderText),
    pixPaymentBodyText: nonEmpty((row as any).pix_payment_body_text, DEFAULT_ADMIN_BOT_CONFIG.pixPaymentBodyText),
    pixPaymentButtonText: nonEmpty((row as any).pix_payment_button_text, DEFAULT_ADMIN_BOT_CONFIG.pixPaymentButtonText),
    checkoutPaymentHeaderText: nonEmpty((row as any).checkout_payment_header_text, DEFAULT_ADMIN_BOT_CONFIG.checkoutPaymentHeaderText),
    checkoutPaymentBodyText: nonEmpty((row as any).checkout_payment_body_text, DEFAULT_ADMIN_BOT_CONFIG.checkoutPaymentBodyText),
    checkoutPaymentButtonText: nonEmpty((row as any).checkout_payment_button_text, DEFAULT_ADMIN_BOT_CONFIG.checkoutPaymentButtonText),
    // Confirmações (WhatsApp)
    planConfirmHeaderText: nonEmpty((row as any).plan_confirm_header_text, DEFAULT_ADMIN_BOT_CONFIG.planConfirmHeaderText!),
    planConfirmBodyText: nonEmpty((row as any).plan_confirm_body_text, DEFAULT_ADMIN_BOT_CONFIG.planConfirmBodyText!),
    planConfirmButtonText: nonEmpty((row as any).plan_confirm_button_text, DEFAULT_ADMIN_BOT_CONFIG.planConfirmButtonText!),
    planConfirmMediaUrl: (row as any).plan_confirm_media_path ? resolveUploadedFileUrl((row as any).plan_confirm_media_path) : null,
    planConfirmMediaPath: (row as any).plan_confirm_media_path ?? null,
    addonConfirmHeaderText: nonEmpty((row as any).addon_confirm_header_text, DEFAULT_ADMIN_BOT_CONFIG.addonConfirmHeaderText!),
    addonConfirmBodyText: nonEmpty((row as any).addon_confirm_body_text, DEFAULT_ADMIN_BOT_CONFIG.addonConfirmBodyText!),
    addonConfirmButtonText: nonEmpty((row as any).addon_confirm_button_text, DEFAULT_ADMIN_BOT_CONFIG.addonConfirmButtonText!),
    addonConfirmMediaUrl: (row as any).addon_confirm_media_path ? resolveUploadedFileUrl((row as any).addon_confirm_media_path) : null,
    addonConfirmMediaPath: (row as any).addon_confirm_media_path ?? null,
    // Add-ons (planos)
    addonTypeHeaderText: nonEmpty((row as any).addon_type_header_text, DEFAULT_ADMIN_BOT_CONFIG.addonTypeHeaderText),
    addonTypeBodyText: nonEmpty((row as any).addon_type_body_text, DEFAULT_ADMIN_BOT_CONFIG.addonTypeBodyText),
    addonTypeInstanceButtonText: nonEmpty((row as any).addon_type_instance_button_text, DEFAULT_ADMIN_BOT_CONFIG.addonTypeInstanceButtonText),
    addonTypeGroupButtonText: nonEmpty((row as any).addon_type_group_button_text, DEFAULT_ADMIN_BOT_CONFIG.addonTypeGroupButtonText),
    addonTypeCancelButtonText: nonEmpty((row as any).addon_type_cancel_button_text, DEFAULT_ADMIN_BOT_CONFIG.addonTypeCancelButtonText),
    addonQuantityHeaderText: nonEmpty((row as any).addon_quantity_header_text, DEFAULT_ADMIN_BOT_CONFIG.addonQuantityHeaderText),
    addonQuantityBodyText: nonEmpty((row as any).addon_quantity_body_text, DEFAULT_ADMIN_BOT_CONFIG.addonQuantityBodyText),
    addonQuantityButtonText: nonEmpty((row as any).addon_quantity_button_text, DEFAULT_ADMIN_BOT_CONFIG.addonQuantityButtonText),
    addonQuantityCancelRowText: nonEmpty((row as any).addon_quantity_cancel_row_text, DEFAULT_ADMIN_BOT_CONFIG.addonQuantityCancelRowText),
    // Instância conectada
    instanceConnectedHeaderText: nonEmpty((row as any).instance_connected_header_text, DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedHeaderText),
    instanceConnectedBodyText: nonEmpty((row as any).instance_connected_body_text, DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedBodyText),
    instanceConnectedLinkGroupButtonText: nonEmpty((row as any).instance_connected_link_group_button_text, DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedLinkGroupButtonText),
    instanceConnectedLaterButtonText: nonEmpty((row as any).instance_connected_later_button_text, DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedLaterButtonText),
    // Cadastro de grupo
    groupCreateHeaderText: nonEmpty((row as any).group_create_header_text, DEFAULT_ADMIN_BOT_CONFIG.groupCreateHeaderText),
    groupCreateBodyText: nonEmpty((row as any).group_create_body_text, DEFAULT_ADMIN_BOT_CONFIG.groupCreateBodyText),
    groupCreateFooterText: nonEmptyOrNull((row as any).group_create_footer_text, DEFAULT_ADMIN_BOT_CONFIG.groupCreateFooterText),
    groupCreateCancelButtonText: nonEmpty((row as any).group_create_cancel_button_text, DEFAULT_ADMIN_BOT_CONFIG.groupCreateCancelButtonText),
    // Painel interno
    panelHeaderText: nonEmpty((row as any).panel_header_text, DEFAULT_ADMIN_BOT_CONFIG.panelHeaderText!),
    panelBodyText: nonEmpty((row as any).panel_body_text, DEFAULT_ADMIN_BOT_CONFIG.panelBodyText!),
    panelGroupsRowTitle: nonEmpty((row as any).panel_groups_row_title, DEFAULT_ADMIN_BOT_CONFIG.panelGroupsRowTitle!),
    panelGroupsRowDescription: nonEmpty((row as any).panel_groups_row_description, DEFAULT_ADMIN_BOT_CONFIG.panelGroupsRowDescription!),
  panelInstancesRowTitle: nonEmpty((row as any).panel_instances_row_title, DEFAULT_ADMIN_BOT_CONFIG.panelInstancesRowTitle!),
  panelInstancesRowDescription: nonEmpty((row as any).panel_instances_row_description, DEFAULT_ADMIN_BOT_CONFIG.panelInstancesRowDescription!),
  panelWebRowTitle: nonEmpty((row as any).panel_web_row_title, DEFAULT_ADMIN_BOT_CONFIG.panelWebRowTitle!),
  panelWebRowDescription: nonEmpty((row as any).panel_web_row_description, DEFAULT_ADMIN_BOT_CONFIG.panelWebRowDescription!),
  panelBackRowTitle: nonEmpty((row as any).panel_back_row_title, DEFAULT_ADMIN_BOT_CONFIG.panelBackRowTitle!),
  panelBackRowDescription: nonEmpty((row as any).panel_back_row_description, DEFAULT_ADMIN_BOT_CONFIG.panelBackRowDescription!),
    // Grupos – ações
    groupActionsHeaderText: nonEmpty((row as any).group_actions_header_text, DEFAULT_ADMIN_BOT_CONFIG.groupActionsHeaderText!),
    groupActionsBodyText: nonEmpty((row as any).group_actions_body_text, DEFAULT_ADMIN_BOT_CONFIG.groupActionsBodyText!),
    groupActionsButtonText: nonEmpty((row as any).group_actions_button_text, DEFAULT_ADMIN_BOT_CONFIG.groupActionsButtonText!),
    groupActionsListTitle: nonEmpty((row as any).group_actions_list_title, DEFAULT_ADMIN_BOT_CONFIG.groupActionsListTitle!),
    groupActionsListDesc: nonEmpty((row as any).group_actions_list_desc, DEFAULT_ADMIN_BOT_CONFIG.groupActionsListDesc!),
    groupActionsCreateTitle: nonEmpty((row as any).group_actions_create_title, DEFAULT_ADMIN_BOT_CONFIG.groupActionsCreateTitle!),
    groupActionsCreateDesc: nonEmpty((row as any).group_actions_create_desc, DEFAULT_ADMIN_BOT_CONFIG.groupActionsCreateDesc!),
    groupActionsRemoveTitle: nonEmpty((row as any).group_actions_remove_title, DEFAULT_ADMIN_BOT_CONFIG.groupActionsRemoveTitle!),
    groupActionsRemoveDesc: nonEmpty((row as any).group_actions_remove_desc, DEFAULT_ADMIN_BOT_CONFIG.groupActionsRemoveDesc!),
    groupActionsBackTitle: nonEmpty((row as any).group_actions_back_title, DEFAULT_ADMIN_BOT_CONFIG.groupActionsBackTitle!),
    groupActionsBackDesc: nonEmpty((row as any).group_actions_back_desc, DEFAULT_ADMIN_BOT_CONFIG.groupActionsBackDesc!),
    // Grupos – selecionar instância
    groupSelectInstanceHeaderText: nonEmpty((row as any).group_select_instance_header_text, DEFAULT_ADMIN_BOT_CONFIG.groupSelectInstanceHeaderText!),
    groupSelectInstanceBodyText: nonEmpty((row as any).group_select_instance_body_text, DEFAULT_ADMIN_BOT_CONFIG.groupSelectInstanceBodyText!),
    groupSelectInstanceButtonText: nonEmpty((row as any).group_select_instance_button_text, DEFAULT_ADMIN_BOT_CONFIG.groupSelectInstanceButtonText!),
    // Grupos – prompt de exclusão
    groupDeletePromptBodyText: nonEmpty((row as any).group_delete_prompt_body_text, DEFAULT_ADMIN_BOT_CONFIG.groupDeletePromptBodyText!),
  groupDeleteConfirmButtonText: nonEmpty((row as any).group_delete_confirm_button_text, DEFAULT_ADMIN_BOT_CONFIG.groupDeleteConfirmButtonText!),
    groupDeleteCancelButtonText: nonEmpty((row as any).group_delete_cancel_button_text, DEFAULT_ADMIN_BOT_CONFIG.groupDeleteCancelButtonText!),
    signupHeaderText: nonEmpty((row as any).signup_header_text, DEFAULT_ADMIN_BOT_CONFIG.signupHeaderText!),
    signupBodyText: nonEmpty((row as any).signup_body_text, DEFAULT_ADMIN_BOT_CONFIG.signupBodyText!),
    signupEmailInvalidText: nonEmpty((row as any).signup_email_invalid_text, DEFAULT_ADMIN_BOT_CONFIG.signupEmailInvalidText!),
    signupPasswordPromptText: nonEmpty((row as any).signup_password_prompt_text, DEFAULT_ADMIN_BOT_CONFIG.signupPasswordPromptText!),
    signupSuccessHeaderText: nonEmpty((row as any).signup_success_header_text, DEFAULT_ADMIN_BOT_CONFIG.signupSuccessHeaderText!),
    signupSuccessBodyText: nonEmpty((row as any).signup_success_body_text, DEFAULT_ADMIN_BOT_CONFIG.signupSuccessBodyText!),
    signupSuccessButtonText: nonEmpty((row as any).signup_success_button_text, DEFAULT_ADMIN_BOT_CONFIG.signupSuccessButtonText!),
  webPanelHeaderText: nonEmpty((row as any).web_panel_header_text, DEFAULT_ADMIN_BOT_CONFIG.webPanelHeaderText!),
  webPanelBodyText: nonEmpty((row as any).web_panel_body_text, DEFAULT_ADMIN_BOT_CONFIG.webPanelBodyText!),
  webPanelButtonText: nonEmpty((row as any).web_panel_button_text, DEFAULT_ADMIN_BOT_CONFIG.webPanelButtonText!),
  } satisfies AdminBotConfig;
};

const sanitizeText = (value: FormDataEntryValue | null, maxLength: number, fallback = "") => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }

  return trimmed;
};

const sanitizeOptionalText = (value: FormDataEntryValue | null, maxLength: number) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const sanitizeLongText = (value: FormDataEntryValue | null, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed;
};

const ensureMenuImageFile = async (file: File): Promise<File> => {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Arquivo de imagem inválido.");
  }

  const mime = (file.type || "").toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg") {
    return file;
  }

  if (mime === "image/webp") {
    const baseName = file.name.replace(/\.[^.]+$/, "") || "menu-image";
    const buffer = Buffer.from(await file.arrayBuffer());
    const converted = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
    return new File([converted], `${baseName}.jpg`, { type: "image/jpeg" });
  }

  throw new Error("Formato de imagem não suportado. Use PNG ou JPG.");
};

const sanitizeOptionalUrl = (value: FormDataEntryValue | null): string | null => {
  const raw = sanitizeOptionalText(value, 300);
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) {
      throw new Error("Invalid protocol");
    }
  } catch (_error) {
    throw new Error("Informe uma URL válida iniciando com http ou https.");
  }

  return raw;
};

export const getAdminBotConfig = async (): Promise<AdminBotConfig> => {
  await ensureAdminBotConfigTable();
  const db = getDb();

  const [rows] = await db.query<(AdminBotConfigRow & RowDataPacket)[]>(
    `SELECT * FROM admin_bot_config WHERE id = 1 LIMIT 1`,
  );

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return mapRowToConfig(row);
};

export const saveAdminBotConfigFromForm = async (formData: FormData): Promise<AdminBotConfig> => {
  await ensureAdminBotConfigTable();
  const db = getDb();

  const [rows] = await db.query<(AdminBotConfigRow & RowDataPacket)[]>(
    `SELECT * FROM admin_bot_config WHERE id = 1 LIMIT 1`,
  );
  const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

  const botName = sanitizeText(formData.get("botName"), 60, DEFAULT_ADMIN_BOT_CONFIG.botName);
  const purchaseVoiceTemplate = sanitizeText(
    formData.get("purchaseVoiceTemplate"),
    160,
    DEFAULT_ADMIN_BOT_CONFIG.purchaseVoiceTemplate,
  );
  const balanceVoiceTemplate = sanitizeText(
    formData.get("balanceVoiceTemplate"),
    160,
    DEFAULT_ADMIN_BOT_CONFIG.balanceVoiceTemplate,
  );
  const menuText = sanitizeLongText(formData.get("menuText"), DEFAULT_ADMIN_BOT_CONFIG.menuText);
  const menuFooterText = sanitizeOptionalText(formData.get("menuFooterText"), 255);
  const panelButtonText = sanitizeText(
    formData.get("panelButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.panelButtonText,
  );
  const subscriptionButtonText = sanitizeText(
    formData.get("subscriptionButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionButtonText,
  );
  const supportButtonText = sanitizeText(
    formData.get("supportButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.supportButtonText,
  );
  const supportUrl = sanitizeOptionalUrl(formData.get("supportUrl")) ?? DEFAULT_ADMIN_BOT_CONFIG.supportUrl;
  const supportCtaBodyText = sanitizeLongText(
    formData.get("supportCtaBodyText"),
    DEFAULT_ADMIN_BOT_CONFIG.supportCtaBodyText,
  );
  const supportCtaFooterText = sanitizeOptionalText(formData.get("supportCtaFooterText"), 60);

  const subscriptionHeaderText = sanitizeText(
    formData.get("subscriptionHeaderText"),
    160,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionHeaderText,
  );
  const subscriptionBodyText = sanitizeLongText(
    formData.get("subscriptionBodyText"),
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionBodyText,
  );
  const subscriptionFooterText = sanitizeOptionalText(formData.get("subscriptionFooterText"), 255);
  const subscriptionRenewButtonText = sanitizeText(
    formData.get("subscriptionRenewButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionRenewButtonText,
  );
  const subscriptionChangeButtonText = sanitizeText(
    formData.get("subscriptionChangeButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionChangeButtonText,
  );
  const subscriptionDetailsButtonText = sanitizeText(
    formData.get("subscriptionDetailsButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionDetailsButtonText,
  );

  const subscriptionNoPlanHeaderText = sanitizeText(
    formData.get("subscriptionNoPlanHeaderText"),
    160,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionNoPlanHeaderText,
  );
  const subscriptionNoPlanBodyText = sanitizeLongText(
    formData.get("subscriptionNoPlanBodyText"),
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionNoPlanBodyText,
  );
  const subscriptionNoPlanButtonText = sanitizeText(
    formData.get("subscriptionNoPlanButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionNoPlanButtonText,
  );

  const subscriptionPlanListTitle = sanitizeText(
    formData.get("subscriptionPlanListTitle"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListTitle,
  );
  const subscriptionPlanListBody = sanitizeLongText(
    formData.get("subscriptionPlanListBody"),
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListBody,
  );
  const subscriptionPlanListButtonText = sanitizeText(
    formData.get("subscriptionPlanListButtonText"),
    60,
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListButtonText,
  );
  const subscriptionPlanListFooterText = sanitizeOptionalText(
    formData.get("subscriptionPlanListFooterText"),
    255,
  );
  const subscriptionPlanListRowDescriptionTemplate = sanitizeLongText(
    formData.get("subscriptionPlanListRowDescriptionTemplate"),
    DEFAULT_ADMIN_BOT_CONFIG.subscriptionPlanListRowDescriptionTemplate!,
  );

  // Payment method picker
  const paymentMethodPickerTitle = sanitizeText(formData.get("paymentMethodPickerTitle"), 160, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPickerTitle);
  const paymentMethodPickerBody = sanitizeLongText(formData.get("paymentMethodPickerBody"), DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPickerBody);
  const paymentMethodPickerButtonText = sanitizeText(formData.get("paymentMethodPickerButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPickerButtonText);
  const paymentMethodPixRowTitle = sanitizeText(formData.get("paymentMethodPixRowTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPixRowTitle);
  const paymentMethodPixRowDescription = sanitizeText(formData.get("paymentMethodPixRowDescription"), 255, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPixRowDescription);
  const paymentMethodCheckoutRowTitle = sanitizeText(formData.get("paymentMethodCheckoutRowTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodCheckoutRowTitle);
  const paymentMethodCheckoutRowDescription = sanitizeText(formData.get("paymentMethodCheckoutRowDescription"), 255, DEFAULT_ADMIN_BOT_CONFIG.paymentMethodCheckoutRowDescription);
  const paymentMethodPlanDetailsTemplate = sanitizeLongText(
    formData.get("paymentMethodPlanDetailsTemplate"),
    DEFAULT_ADMIN_BOT_CONFIG.paymentMethodPlanDetailsTemplate!,
  );
  const pixPaymentHeaderText = sanitizeText(formData.get("pixPaymentHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.pixPaymentHeaderText);
  const pixPaymentBodyText = sanitizeLongText(formData.get("pixPaymentBodyText"), DEFAULT_ADMIN_BOT_CONFIG.pixPaymentBodyText);
  const pixPaymentButtonText = sanitizeText(formData.get("pixPaymentButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.pixPaymentButtonText);
  const checkoutPaymentHeaderText = sanitizeText(formData.get("checkoutPaymentHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.checkoutPaymentHeaderText);
  const checkoutPaymentBodyText = sanitizeLongText(formData.get("checkoutPaymentBodyText"), DEFAULT_ADMIN_BOT_CONFIG.checkoutPaymentBodyText);
  const checkoutPaymentButtonText = sanitizeText(formData.get("checkoutPaymentButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.checkoutPaymentButtonText);
  // Confirmações (WhatsApp)
  const planConfirmHeaderText = sanitizeText(formData.get("planConfirmHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.planConfirmHeaderText!);
  const planConfirmBodyText = sanitizeLongText(formData.get("planConfirmBodyText"), DEFAULT_ADMIN_BOT_CONFIG.planConfirmBodyText!);
  const planConfirmButtonText = sanitizeText(formData.get("planConfirmButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.planConfirmButtonText!);
  const addonConfirmHeaderText = sanitizeText(formData.get("addonConfirmHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.addonConfirmHeaderText!);
  const addonConfirmBodyText = sanitizeLongText(formData.get("addonConfirmBodyText"), DEFAULT_ADMIN_BOT_CONFIG.addonConfirmBodyText!);
  const addonConfirmButtonText = sanitizeText(formData.get("addonConfirmButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.addonConfirmButtonText!);

  // Add-ons (planos)
  const addonTypeHeaderText = sanitizeText(formData.get("addonTypeHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.addonTypeHeaderText);
  const addonTypeBodyText = sanitizeLongText(formData.get("addonTypeBodyText"), DEFAULT_ADMIN_BOT_CONFIG.addonTypeBodyText);
  const addonTypeInstanceButtonText = sanitizeText(formData.get("addonTypeInstanceButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.addonTypeInstanceButtonText);
  const addonTypeGroupButtonText = sanitizeText(formData.get("addonTypeGroupButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.addonTypeGroupButtonText);
  const addonTypeCancelButtonText = sanitizeText(formData.get("addonTypeCancelButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.addonTypeCancelButtonText);
  const addonQuantityHeaderText = sanitizeText(formData.get("addonQuantityHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.addonQuantityHeaderText);
  const addonQuantityBodyText = sanitizeLongText(formData.get("addonQuantityBodyText"), DEFAULT_ADMIN_BOT_CONFIG.addonQuantityBodyText);
  const addonQuantityButtonText = sanitizeText(formData.get("addonQuantityButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.addonQuantityButtonText);
  const addonQuantityCancelRowText = sanitizeText(formData.get("addonQuantityCancelRowText"), 60, DEFAULT_ADMIN_BOT_CONFIG.addonQuantityCancelRowText);

  // Instance connected
  const instanceConnectedHeaderText = sanitizeText(formData.get("instanceConnectedHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedHeaderText);
  const instanceConnectedBodyText = sanitizeLongText(formData.get("instanceConnectedBodyText"), DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedBodyText);
  const instanceConnectedLinkGroupButtonText = sanitizeText(formData.get("instanceConnectedLinkGroupButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedLinkGroupButtonText);
  const instanceConnectedLaterButtonText = sanitizeText(formData.get("instanceConnectedLaterButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.instanceConnectedLaterButtonText);

  // Group create prompt
  const groupCreateHeaderText = sanitizeText(formData.get("groupCreateHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.groupCreateHeaderText);
  const groupCreateBodyText = sanitizeLongText(formData.get("groupCreateBodyText"), DEFAULT_ADMIN_BOT_CONFIG.groupCreateBodyText);
  const groupCreateFooterText = sanitizeOptionalText(formData.get("groupCreateFooterText"), 255);
  const groupCreateCancelButtonText = sanitizeText(formData.get("groupCreateCancelButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupCreateCancelButtonText);
  // Painel
  const panelHeaderText = sanitizeText(formData.get("panelHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.panelHeaderText!);
  const panelBodyText = sanitizeLongText(formData.get("panelBodyText"), DEFAULT_ADMIN_BOT_CONFIG.panelBodyText!);
  const panelGroupsRowTitle = sanitizeText(formData.get("panelGroupsRowTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.panelGroupsRowTitle!);
  const panelGroupsRowDescription = sanitizeText(formData.get("panelGroupsRowDescription"), 255, DEFAULT_ADMIN_BOT_CONFIG.panelGroupsRowDescription!);
  const panelInstancesRowTitle = sanitizeText(formData.get("panelInstancesRowTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.panelInstancesRowTitle!);
  const panelInstancesRowDescription = sanitizeText(formData.get("panelInstancesRowDescription"), 255, DEFAULT_ADMIN_BOT_CONFIG.panelInstancesRowDescription!);
  const panelWebRowTitle = sanitizeText(formData.get("panelWebRowTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.panelWebRowTitle!);
  const panelWebRowDescription = sanitizeText(formData.get("panelWebRowDescription"), 255, DEFAULT_ADMIN_BOT_CONFIG.panelWebRowDescription!);
  const panelBackRowTitle = sanitizeText(formData.get("panelBackRowTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.panelBackRowTitle!);
  const panelBackRowDescription = sanitizeText(formData.get("panelBackRowDescription"), 255, DEFAULT_ADMIN_BOT_CONFIG.panelBackRowDescription!);
  // Grupos – ações
  const groupActionsHeaderText = sanitizeText(formData.get("groupActionsHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.groupActionsHeaderText!);
  const groupActionsBodyText = sanitizeLongText(formData.get("groupActionsBodyText"), DEFAULT_ADMIN_BOT_CONFIG.groupActionsBodyText!);
  const groupActionsButtonText = sanitizeText(formData.get("groupActionsButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupActionsButtonText!);
  const groupActionsListTitle = sanitizeText(formData.get("groupActionsListTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupActionsListTitle!);
  const groupActionsListDesc = sanitizeText(formData.get("groupActionsListDesc"), 255, DEFAULT_ADMIN_BOT_CONFIG.groupActionsListDesc!);
  const groupActionsCreateTitle = sanitizeText(formData.get("groupActionsCreateTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupActionsCreateTitle!);
  const groupActionsCreateDesc = sanitizeText(formData.get("groupActionsCreateDesc"), 255, DEFAULT_ADMIN_BOT_CONFIG.groupActionsCreateDesc!);
  const groupActionsRemoveTitle = sanitizeText(formData.get("groupActionsRemoveTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupActionsRemoveTitle!);
  const groupActionsRemoveDesc = sanitizeText(formData.get("groupActionsRemoveDesc"), 255, DEFAULT_ADMIN_BOT_CONFIG.groupActionsRemoveDesc!);
  const groupActionsBackTitle = sanitizeText(formData.get("groupActionsBackTitle"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupActionsBackTitle!);
  const groupActionsBackDesc = sanitizeText(formData.get("groupActionsBackDesc"), 255, DEFAULT_ADMIN_BOT_CONFIG.groupActionsBackDesc!);
  // Grupos – selecionar instância
  const groupSelectInstanceHeaderText = sanitizeText(formData.get("groupSelectInstanceHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.groupSelectInstanceHeaderText!);
  const groupSelectInstanceBodyText = sanitizeLongText(formData.get("groupSelectInstanceBodyText"), DEFAULT_ADMIN_BOT_CONFIG.groupSelectInstanceBodyText!);
  const groupSelectInstanceButtonText = sanitizeText(formData.get("groupSelectInstanceButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupSelectInstanceButtonText!);
  // Grupos – prompt de exclusão
  const groupDeletePromptBodyText = sanitizeLongText(formData.get("groupDeletePromptBodyText"), DEFAULT_ADMIN_BOT_CONFIG.groupDeletePromptBodyText!);
  const groupDeleteConfirmButtonText = sanitizeText(formData.get("groupDeleteConfirmButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupDeleteConfirmButtonText!);
  const groupDeleteCancelButtonText = sanitizeText(formData.get("groupDeleteCancelButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.groupDeleteCancelButtonText!);
  // Cadastro rápido (WhatsApp)
  const signupHeaderText = sanitizeText(formData.get("signupHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.signupHeaderText!);
  const signupBodyText = sanitizeLongText(formData.get("signupBodyText"), DEFAULT_ADMIN_BOT_CONFIG.signupBodyText!);
  const signupEmailInvalidText = sanitizeText(formData.get("signupEmailInvalidText"), 160, DEFAULT_ADMIN_BOT_CONFIG.signupEmailInvalidText!);
  const signupPasswordPromptText = sanitizeText(formData.get("signupPasswordPromptText"), 160, DEFAULT_ADMIN_BOT_CONFIG.signupPasswordPromptText!);
  const signupSuccessHeaderText = sanitizeText(formData.get("signupSuccessHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.signupSuccessHeaderText!);
  const signupSuccessBodyText = sanitizeLongText(formData.get("signupSuccessBodyText"), DEFAULT_ADMIN_BOT_CONFIG.signupSuccessBodyText!);
  const signupSuccessButtonText = sanitizeText(formData.get("signupSuccessButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.signupSuccessButtonText!);
  const webPanelHeaderText = sanitizeText(formData.get("webPanelHeaderText"), 160, DEFAULT_ADMIN_BOT_CONFIG.webPanelHeaderText!);
  const webPanelBodyText = sanitizeLongText(formData.get("webPanelBodyText"), DEFAULT_ADMIN_BOT_CONFIG.webPanelBodyText!);
  const webPanelButtonText = sanitizeText(formData.get("webPanelButtonText"), 60, DEFAULT_ADMIN_BOT_CONFIG.webPanelButtonText!);

  const removeImage = String(formData.get("removeMenuImage") ?? "").toLowerCase() === "true";
  const rawImage = formData.get("menuImage");
  const imageFile = rawImage instanceof File ? await ensureMenuImageFile(rawImage) : null;

  // Novas mídias de confirmação
  const removePlanConfirmMedia = String(formData.get("removePlanConfirmMedia") ?? "").toLowerCase() === "true";
  const rawPlanMedia = formData.get("planConfirmMedia");
  const planMediaFile = rawPlanMedia instanceof File ? await ensureMenuImageFile(rawPlanMedia) : null;

  const removeAddonConfirmMedia = String(formData.get("removeAddonConfirmMedia") ?? "").toLowerCase() === "true";
  const rawAddonMedia = formData.get("addonConfirmMedia");
  const addonMediaFile = rawAddonMedia instanceof File ? await ensureMenuImageFile(rawAddonMedia) : null;

  let nextImagePath = existing?.menu_image_path ?? null;
  let imageToDelete: string | null = null;
  let nextPlanConfirmMediaPath = (existing as any)?.plan_confirm_media_path ?? null;
  let planConfirmMediaToDelete: string | null = null;
  let nextAddonConfirmMediaPath = (existing as any)?.addon_confirm_media_path ?? null;
  let addonConfirmMediaToDelete: string | null = null;

  if (removeImage && nextImagePath) {
    imageToDelete = nextImagePath;
    nextImagePath = null;
  }

  if (imageFile && imageFile.size > 0) {
    const storedPath = await saveUploadedFile(imageFile, "admin/bot", { convertToWebp: false });
    if (!removeImage && existing?.menu_image_path) {
      imageToDelete = existing.menu_image_path;
    }
    nextImagePath = storedPath;
  }

  if (removePlanConfirmMedia && nextPlanConfirmMediaPath) {
    planConfirmMediaToDelete = nextPlanConfirmMediaPath;
    nextPlanConfirmMediaPath = null;
  }
  if (planMediaFile && planMediaFile.size > 0) {
    const stored = await saveUploadedFile(planMediaFile, "admin/bot", { convertToWebp: false });
    if (!removePlanConfirmMedia && (existing as any)?.plan_confirm_media_path) {
      planConfirmMediaToDelete = (existing as any).plan_confirm_media_path;
    }
    nextPlanConfirmMediaPath = stored;
  }

  if (removeAddonConfirmMedia && nextAddonConfirmMediaPath) {
    addonConfirmMediaToDelete = nextAddonConfirmMediaPath;
    nextAddonConfirmMediaPath = null;
  }
  if (addonMediaFile && addonMediaFile.size > 0) {
    const stored = await saveUploadedFile(addonMediaFile, "admin/bot", { convertToWebp: false });
    if (!removeAddonConfirmMedia && (existing as any)?.addon_confirm_media_path) {
      addonConfirmMediaToDelete = (existing as any).addon_confirm_media_path;
    }
    nextAddonConfirmMediaPath = stored;
  }

  await db.query(
    `
      UPDATE admin_bot_config
      SET
        bot_name = ?,
        purchase_voice_template = ?,
        balance_voice_template = ?,
        menu_text = ?,
        menu_footer_text = ?,
        panel_button_text = ?,
        subscription_button_text = ?,
        support_button_text = ?,
        support_url = ?,
        support_cta_body_text = ?,
        support_cta_footer_text = ?,
        menu_image_path = ?,
        subscription_header_text = ?,
        subscription_body_text = ?,
        subscription_footer_text = ?,
        subscription_renew_button_text = ?,
        subscription_change_button_text = ?,
        subscription_details_button_text = ?,
        subscription_no_plan_header_text = ?,
        subscription_no_plan_body_text = ?,
        subscription_no_plan_button_text = ?,
        subscription_plan_list_title = ?,
      subscription_plan_list_body = ?,
      subscription_plan_list_button_text = ?,
      subscription_plan_list_footer_text = ?,
      subscription_plan_list_row_template = ?,
      payment_method_picker_title = ?,
        payment_method_picker_body = ?,
        payment_method_picker_button_text = ?,
        payment_method_pix_row_title = ?,
        payment_method_pix_row_description = ?,
        payment_method_checkout_row_title = ?,
        payment_method_checkout_row_description = ?,
        payment_method_plan_details_template = ?,
        pix_payment_header_text = ?,
        pix_payment_body_text = ?,
        pix_payment_button_text = ?,
        checkout_payment_header_text = ?,
        checkout_payment_body_text = ?,
        checkout_payment_button_text = ?,
        plan_confirm_header_text = ?,
        plan_confirm_body_text = ?,
        plan_confirm_button_text = ?,
        plan_confirm_media_path = ?,
        addon_confirm_header_text = ?,
        addon_confirm_body_text = ?,
        addon_confirm_button_text = ?,
        addon_confirm_media_path = ?,
        addon_type_header_text = ?,
        addon_type_body_text = ?,
        addon_type_instance_button_text = ?,
        addon_type_group_button_text = ?,
        addon_type_cancel_button_text = ?,
        addon_quantity_header_text = ?,
        addon_quantity_body_text = ?,
        addon_quantity_button_text = ?,
        addon_quantity_cancel_row_text = ?,
        instance_connected_header_text = ?,
        instance_connected_body_text = ?,
        instance_connected_link_group_button_text = ?,
        instance_connected_later_button_text = ?,
        group_create_header_text = ?,
        group_create_body_text = ?,
        group_create_footer_text = ?,
        group_create_cancel_button_text = ?,
        panel_header_text = ?,
        panel_body_text = ?,
        panel_groups_row_title = ?,
        panel_groups_row_description = ?,
        panel_instances_row_title = ?,
        panel_instances_row_description = ?,
        panel_web_row_title = ?,
        panel_web_row_description = ?,
        panel_back_row_title = ?,
        panel_back_row_description = ?,
        group_actions_header_text = ?,
        group_actions_body_text = ?,
        group_actions_button_text = ?,
        group_actions_list_title = ?,
        group_actions_list_desc = ?,
        group_actions_create_title = ?,
        group_actions_create_desc = ?,
        group_actions_remove_title = ?,
        group_actions_remove_desc = ?,
        group_actions_back_title = ?,
        group_actions_back_desc = ?,
        group_select_instance_header_text = ?,
        group_select_instance_body_text = ?,
        group_select_instance_button_text = ?,
        group_delete_prompt_body_text = ?,
        group_delete_confirm_button_text = ?,
        group_delete_cancel_button_text = ?,
        signup_header_text = ?,
        signup_body_text = ?,
        signup_email_invalid_text = ?,
        signup_password_prompt_text = ?,
        signup_success_header_text = ?,
        signup_success_body_text = ?,
        signup_success_button_text = ?,
        web_panel_header_text = ?,
        web_panel_body_text = ?,
        web_panel_button_text = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `,
    [
      botName,
      purchaseVoiceTemplate,
      balanceVoiceTemplate,
      menuText,
      menuFooterText,
      panelButtonText,
      subscriptionButtonText,
      supportButtonText,
      supportUrl,
      supportCtaBodyText,
      supportCtaFooterText,
      nextImagePath,
      subscriptionHeaderText,
      subscriptionBodyText,
      subscriptionFooterText,
      subscriptionRenewButtonText,
      subscriptionChangeButtonText,
      subscriptionDetailsButtonText,
      subscriptionNoPlanHeaderText,
      subscriptionNoPlanBodyText,
      subscriptionNoPlanButtonText,
      subscriptionPlanListTitle,
      subscriptionPlanListBody,
      subscriptionPlanListButtonText,
      subscriptionPlanListFooterText,
      subscriptionPlanListRowDescriptionTemplate,
      paymentMethodPickerTitle,
      paymentMethodPickerBody,
      paymentMethodPickerButtonText,
      paymentMethodPixRowTitle,
      paymentMethodPixRowDescription,
      paymentMethodCheckoutRowTitle,
      paymentMethodCheckoutRowDescription,
      paymentMethodPlanDetailsTemplate,
      pixPaymentHeaderText,
      pixPaymentBodyText,
      pixPaymentButtonText,
      checkoutPaymentHeaderText,
      checkoutPaymentBodyText,
      checkoutPaymentButtonText,
      planConfirmHeaderText,
      planConfirmBodyText,
      planConfirmButtonText,
      nextPlanConfirmMediaPath,
      addonConfirmHeaderText,
      addonConfirmBodyText,
      addonConfirmButtonText,
      nextAddonConfirmMediaPath,
      addonTypeHeaderText,
      addonTypeBodyText,
      addonTypeInstanceButtonText,
      addonTypeGroupButtonText,
      addonTypeCancelButtonText,
      addonQuantityHeaderText,
      addonQuantityBodyText,
      addonQuantityButtonText,
      addonQuantityCancelRowText,
      instanceConnectedHeaderText,
      instanceConnectedBodyText,
      instanceConnectedLinkGroupButtonText,
      instanceConnectedLaterButtonText,
      groupCreateHeaderText,
      groupCreateBodyText,
      groupCreateFooterText,
      groupCreateCancelButtonText,
      panelHeaderText,
      panelBodyText,
      panelGroupsRowTitle,
      panelGroupsRowDescription,
      panelInstancesRowTitle,
      panelInstancesRowDescription,
      panelWebRowTitle,
      panelWebRowDescription,
      panelBackRowTitle,
      panelBackRowDescription,
      groupActionsHeaderText,
      groupActionsBodyText,
      groupActionsButtonText,
      groupActionsListTitle,
      groupActionsListDesc,
      groupActionsCreateTitle,
      groupActionsCreateDesc,
      groupActionsRemoveTitle,
      groupActionsRemoveDesc,
      groupActionsBackTitle,
      groupActionsBackDesc,
      groupSelectInstanceHeaderText,
      groupSelectInstanceBodyText,
      groupSelectInstanceButtonText,
      groupDeletePromptBodyText,
      groupDeleteConfirmButtonText,
      groupDeleteCancelButtonText,
      signupHeaderText,
      signupBodyText,
      signupEmailInvalidText,
      signupPasswordPromptText,
      signupSuccessHeaderText,
      signupSuccessBodyText,
      signupSuccessButtonText,
      webPanelHeaderText,
      webPanelBodyText,
      webPanelButtonText,
    ],
  );

  if (imageToDelete && imageToDelete !== nextImagePath) {
    await deleteUploadedFile(imageToDelete).catch((error) => {
      console.error("Failed to remove previous admin bot image", error);
    });
  }

  if (planConfirmMediaToDelete && planConfirmMediaToDelete !== nextPlanConfirmMediaPath) {
    await deleteUploadedFile(planConfirmMediaToDelete).catch((error) => {
      console.error("Failed to remove previous plan confirm media", error);
    });
  }
  if (addonConfirmMediaToDelete && addonConfirmMediaToDelete !== nextAddonConfirmMediaPath) {
    await deleteUploadedFile(addonConfirmMediaToDelete).catch((error) => {
      console.error("Failed to remove previous addon confirm media", error);
    });
  }

  return getAdminBotConfig();
};

export const getDefaultAdminBotConfig = (): AdminBotConfig => DEFAULT_ADMIN_BOT_CONFIG;
