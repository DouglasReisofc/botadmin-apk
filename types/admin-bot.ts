export interface AdminBotConfig {
  botName: string;
  purchaseVoiceTemplate: string;
  balanceVoiceTemplate: string;
  menuText: string;
  menuFooterText: string | null;
  panelButtonText: string;
  subscriptionButtonText: string;
  supportButtonText: string;
  supportUrl: string | null;
  supportCtaBodyText: string;
  supportCtaFooterText: string | null;
  menuImageUrl: string | null;
  menuImagePath: string | null;
  subscriptionHeaderText: string;
  subscriptionBodyText: string;
  subscriptionFooterText: string | null;
  subscriptionRenewButtonText: string;
  subscriptionChangeButtonText: string;
  subscriptionDetailsButtonText: string;
  subscriptionNoPlanHeaderText: string;
  subscriptionNoPlanBodyText: string;
  subscriptionNoPlanButtonText: string;
  subscriptionPlanListTitle: string;
  subscriptionPlanListBody: string;
  subscriptionPlanListButtonText: string;
  subscriptionPlanListFooterText: string | null;
  // Template para a linha de cada plano na lista (tokens: {{plan_name}}, {{plan_price}}, {{plan_instance_limit}}, {{plan_group_limit}}, {{plan_duration_days}}, {{plan_description}})
  subscriptionPlanListRowDescriptionTemplate?: string;
  // Novos: escolha do método de pagamento
  paymentMethodPickerTitle: string;
  paymentMethodPickerBody: string;
  paymentMethodPickerButtonText: string;
  paymentMethodPixRowTitle: string;
  paymentMethodPixRowDescription: string;
  paymentMethodCheckoutRowTitle: string;
  paymentMethodCheckoutRowDescription: string;
  // Template com o detalhamento do plano exibido antes do corpo do picker (mesmos tokens acima)
  paymentMethodPlanDetailsTemplate?: string;
  pixPaymentHeaderText: string;
  pixPaymentBodyText: string;
  pixPaymentButtonText: string;
  checkoutPaymentHeaderText: string;
  checkoutPaymentBodyText: string;
  checkoutPaymentButtonText: string;
  // Confirmações (WhatsApp)
  planConfirmHeaderText?: string;
  planConfirmBodyText?: string; // tokens: {{plan_name}}, {{amount}}, {{new_due_date}}
  planConfirmButtonText?: string;
  // Mídia da confirmação do plano
  planConfirmMediaUrl?: string | null;
  planConfirmMediaPath?: string | null;
  addonConfirmHeaderText?: string;
  addonConfirmBodyText?: string; // tokens: {{addons_summary}}, {{addon_expires_at}}
  addonConfirmButtonText?: string;
  // Mídia da confirmação de add-ons
  addonConfirmMediaUrl?: string | null;
  addonConfirmMediaPath?: string | null;
  // Novos: add-ons (planos)
  addonTypeHeaderText: string;
  addonTypeBodyText: string; // tokens: {{addon_instance_price}}, {{addon_group_price}}
  addonTypeInstanceButtonText: string;
  addonTypeGroupButtonText: string;
  addonTypeCancelButtonText: string;
  addonQuantityHeaderText: string;
  addonQuantityBodyText: string; // tokens: {{addon_unit_price}}, {{addon_label}}
  addonQuantityButtonText: string;
  addonQuantityCancelRowText: string;
  // Novos: confirmação de instância conectada
  instanceConnectedHeaderText: string;
  instanceConnectedBodyText: string; // tokens: {{instance_name}}
  instanceConnectedLinkGroupButtonText: string;
  instanceConnectedLaterButtonText: string;
  // Novos: cadastro de grupo
  groupCreateHeaderText: string;
  groupCreateBodyText: string;
  groupCreateFooterText: string | null;
  groupCreateCancelButtonText: string;
  // Painel interno
  panelHeaderText?: string;
  panelBodyText?: string;
  panelGroupsRowTitle?: string;
  panelGroupsRowDescription?: string;
  panelInstancesRowTitle?: string;
  panelInstancesRowDescription?: string;
  panelWebRowTitle?: string;
  panelWebRowDescription?: string;
  panelBackRowTitle?: string;
  panelBackRowDescription?: string;
  // Grupos - ações
  groupActionsHeaderText?: string;
  groupActionsBodyText?: string;
  groupActionsButtonText?: string;
  groupActionsListTitle?: string;
  groupActionsListDesc?: string;
  groupActionsCreateTitle?: string;
  groupActionsCreateDesc?: string;
  groupActionsRemoveTitle?: string;
  groupActionsRemoveDesc?: string;
  groupActionsBackTitle?: string;
  groupActionsBackDesc?: string;
  // Grupos - selecionar instância
  groupSelectInstanceHeaderText?: string;
  groupSelectInstanceBodyText?: string;
  groupSelectInstanceButtonText?: string;
  // Grupos - prompt de exclusão
  groupDeletePromptBodyText?: string;
  groupDeleteConfirmButtonText?: string;
  groupDeleteCancelButtonText?: string;
  // Painel web (CTA)
  webPanelHeaderText?: string;
  webPanelBodyText?: string;
  webPanelButtonText?: string;
  // Cadastro rápido (WhatsApp)
  signupHeaderText?: string;
  signupBodyText?: string;
  signupEmailInvalidText?: string;
  signupPasswordPromptText?: string;
  signupSuccessHeaderText?: string;
  signupSuccessBodyText?: string;
  signupSuccessButtonText?: string;
}
