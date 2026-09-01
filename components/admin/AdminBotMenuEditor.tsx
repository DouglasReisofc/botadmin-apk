"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Row, Modal } from "react-bootstrap";

import type { AdminBotConfig } from "types/admin-bot";

interface AdminBotMenuEditorProps {
  config: AdminBotConfig;
}

type Feedback = { type: "success" | "danger"; message: string } | null;

type FormState = {
  botName: string;
  purchaseVoiceTemplate: string;
  balanceVoiceTemplate: string;
  menuText: string;
  menuFooterText: string;
  panelButtonText: string;
  subscriptionButtonText: string;
  supportButtonText: string;
  supportUrl: string;
  supportCtaBodyText: string;
  supportCtaFooterText: string;
  subscriptionHeaderText: string;
  subscriptionBodyText: string;
  subscriptionFooterText: string;
  subscriptionRenewButtonText: string;
  subscriptionChangeButtonText: string;
  subscriptionDetailsButtonText: string;
  subscriptionNoPlanHeaderText: string;
  subscriptionNoPlanBodyText: string;
  subscriptionNoPlanButtonText: string;
  subscriptionPlanListTitle: string;
  subscriptionPlanListBody: string;
  subscriptionPlanListButtonText: string;
  subscriptionPlanListFooterText: string;
  subscriptionPlanListRowDescriptionTemplate: string;
  paymentMethodPickerTitle: string;
  paymentMethodPickerBody: string;
  paymentMethodPickerButtonText: string;
  paymentMethodPixRowTitle: string;
  paymentMethodPixRowDescription: string;
  paymentMethodCheckoutRowTitle: string;
  paymentMethodCheckoutRowDescription: string;
  paymentMethodPlanDetailsTemplate: string;
  pixPaymentHeaderText: string;
  pixPaymentBodyText: string;
  pixPaymentButtonText: string;
  checkoutPaymentHeaderText: string;
  checkoutPaymentBodyText: string;
  checkoutPaymentButtonText: string;
  // Confirmações (WhatsApp)
  planConfirmHeaderText: string;
  planConfirmBodyText: string;
  planConfirmButtonText: string;
  planConfirmMediaFile: File | null;
  removePlanConfirmMedia: boolean;
  addonConfirmHeaderText: string;
  addonConfirmBodyText: string;
  addonConfirmButtonText: string;
  addonConfirmMediaFile: File | null;
  removeAddonConfirmMedia: boolean;
  // Add-ons
  addonTypeHeaderText: string;
  addonTypeBodyText: string;
  addonTypeInstanceButtonText: string;
  addonTypeGroupButtonText: string;
  addonTypeCancelButtonText: string;
  addonQuantityHeaderText: string;
  addonQuantityBodyText: string;
  addonQuantityButtonText: string;
  addonQuantityCancelRowText: string;
  instanceConnectedHeaderText: string;
  instanceConnectedBodyText: string;
  instanceConnectedLinkGroupButtonText: string;
  instanceConnectedLaterButtonText: string;
  groupCreateHeaderText: string;
  groupCreateBodyText: string;
  groupCreateFooterText: string;
  groupCreateCancelButtonText: string;
  // Painel interno
  panelHeaderText: string;
  panelBodyText: string;
  panelGroupsRowTitle: string;
  panelGroupsRowDescription: string;
  panelInstancesRowTitle: string;
  panelInstancesRowDescription: string;
  panelWebRowTitle: string;
  panelWebRowDescription: string;
  panelBackRowTitle: string;
  panelBackRowDescription: string;
  // Grupos ações
  groupActionsHeaderText: string;
  groupActionsBodyText: string;
  groupActionsButtonText: string;
  groupActionsListTitle: string;
  groupActionsListDesc: string;
  groupActionsCreateTitle: string;
  groupActionsCreateDesc: string;
  groupActionsRemoveTitle: string;
  groupActionsRemoveDesc: string;
  groupActionsBackTitle: string;
  groupActionsBackDesc: string;
  // Grupos selecionar instância
  groupSelectInstanceHeaderText: string;
  groupSelectInstanceBodyText: string;
  groupSelectInstanceButtonText: string;
  // Grupos exclusão
  groupDeletePromptBodyText: string;
  groupDeleteConfirmButtonText: string;
  groupDeleteCancelButtonText: string;
  // Painel web (CTA)
  webPanelHeaderText: string;
  webPanelBodyText: string;
  webPanelButtonText: string;
  // Cadastro rápido (WhatsApp)
  signupHeaderText: string;
  signupBodyText: string;
  signupEmailInvalidText: string;
  signupPasswordPromptText: string;
  signupSuccessHeaderText: string;
  signupSuccessBodyText: string;
  signupSuccessButtonText: string;
  removeImage: boolean;
  imageFile: File | null;
};

const toFormState = (config: AdminBotConfig): FormState => ({
  botName: config.botName,
  purchaseVoiceTemplate: config.purchaseVoiceTemplate,
  balanceVoiceTemplate: config.balanceVoiceTemplate,
  menuText: config.menuText,
  menuFooterText: config.menuFooterText ?? "",
  panelButtonText: config.panelButtonText,
  subscriptionButtonText: config.subscriptionButtonText,
  supportButtonText: config.supportButtonText,
  supportUrl: config.supportUrl ?? "",
  supportCtaBodyText: config.supportCtaBodyText,
  supportCtaFooterText: config.supportCtaFooterText ?? "",
  subscriptionHeaderText: config.subscriptionHeaderText,
  subscriptionBodyText: config.subscriptionBodyText,
  subscriptionFooterText: config.subscriptionFooterText ?? "",
  subscriptionRenewButtonText: config.subscriptionRenewButtonText,
  subscriptionChangeButtonText: config.subscriptionChangeButtonText,
  subscriptionDetailsButtonText: config.subscriptionDetailsButtonText,
  subscriptionNoPlanHeaderText: config.subscriptionNoPlanHeaderText,
  subscriptionNoPlanBodyText: config.subscriptionNoPlanBodyText,
  subscriptionNoPlanButtonText: config.subscriptionNoPlanButtonText,
  subscriptionPlanListTitle: config.subscriptionPlanListTitle,
  subscriptionPlanListBody: config.subscriptionPlanListBody,
  subscriptionPlanListButtonText: config.subscriptionPlanListButtonText,
  subscriptionPlanListFooterText: config.subscriptionPlanListFooterText ?? "",
  subscriptionPlanListRowDescriptionTemplate: config.subscriptionPlanListRowDescriptionTemplate ?? "",
  paymentMethodPickerTitle: config.paymentMethodPickerTitle,
  paymentMethodPickerBody: config.paymentMethodPickerBody,
  paymentMethodPickerButtonText: config.paymentMethodPickerButtonText,
  paymentMethodPixRowTitle: config.paymentMethodPixRowTitle,
  paymentMethodPixRowDescription: config.paymentMethodPixRowDescription,
  paymentMethodCheckoutRowTitle: config.paymentMethodCheckoutRowTitle,
  paymentMethodCheckoutRowDescription: config.paymentMethodCheckoutRowDescription,
  paymentMethodPlanDetailsTemplate: config.paymentMethodPlanDetailsTemplate ?? "",
  pixPaymentHeaderText: config.pixPaymentHeaderText,
  pixPaymentBodyText: config.pixPaymentBodyText,
  pixPaymentButtonText: config.pixPaymentButtonText,
  checkoutPaymentHeaderText: config.checkoutPaymentHeaderText,
  checkoutPaymentBodyText: config.checkoutPaymentBodyText,
  checkoutPaymentButtonText: config.checkoutPaymentButtonText,
  planConfirmHeaderText: config.planConfirmHeaderText ?? "",
  planConfirmBodyText: config.planConfirmBodyText ?? "",
  planConfirmButtonText: config.planConfirmButtonText ?? "",
  planConfirmMediaFile: null,
  removePlanConfirmMedia: false,
  addonConfirmHeaderText: config.addonConfirmHeaderText ?? "",
  addonConfirmBodyText: config.addonConfirmBodyText ?? "",
  addonConfirmButtonText: config.addonConfirmButtonText ?? "",
  addonConfirmMediaFile: null,
  removeAddonConfirmMedia: false,
  addonTypeHeaderText: config.addonTypeHeaderText,
  addonTypeBodyText: config.addonTypeBodyText,
  addonTypeInstanceButtonText: config.addonTypeInstanceButtonText,
  addonTypeGroupButtonText: config.addonTypeGroupButtonText,
  addonTypeCancelButtonText: config.addonTypeCancelButtonText,
  addonQuantityHeaderText: config.addonQuantityHeaderText,
  addonQuantityBodyText: config.addonQuantityBodyText,
  addonQuantityButtonText: config.addonQuantityButtonText,
  addonQuantityCancelRowText: config.addonQuantityCancelRowText,
  instanceConnectedHeaderText: config.instanceConnectedHeaderText,
  instanceConnectedBodyText: config.instanceConnectedBodyText,
  instanceConnectedLinkGroupButtonText: config.instanceConnectedLinkGroupButtonText,
  instanceConnectedLaterButtonText: config.instanceConnectedLaterButtonText,
  groupCreateHeaderText: config.groupCreateHeaderText,
  groupCreateBodyText: config.groupCreateBodyText,
  groupCreateFooterText: config.groupCreateFooterText ?? "",
  groupCreateCancelButtonText: config.groupCreateCancelButtonText,
  panelHeaderText: config.panelHeaderText ?? "",
  panelBodyText: config.panelBodyText ?? "",
  panelGroupsRowTitle: config.panelGroupsRowTitle ?? "",
  panelGroupsRowDescription: config.panelGroupsRowDescription ?? "",
  panelInstancesRowTitle: config.panelInstancesRowTitle ?? "",
  panelInstancesRowDescription: config.panelInstancesRowDescription ?? "",
  panelWebRowTitle: config.panelWebRowTitle ?? "",
  panelWebRowDescription: config.panelWebRowDescription ?? "",
  panelBackRowTitle: config.panelBackRowTitle ?? "",
  panelBackRowDescription: config.panelBackRowDescription ?? "",
  groupActionsHeaderText: config.groupActionsHeaderText ?? "",
  groupActionsBodyText: config.groupActionsBodyText ?? "",
  groupActionsButtonText: config.groupActionsButtonText ?? "",
  groupActionsListTitle: config.groupActionsListTitle ?? "",
  groupActionsListDesc: config.groupActionsListDesc ?? "",
  groupActionsCreateTitle: config.groupActionsCreateTitle ?? "",
  groupActionsCreateDesc: config.groupActionsCreateDesc ?? "",
  groupActionsRemoveTitle: config.groupActionsRemoveTitle ?? "",
  groupActionsRemoveDesc: config.groupActionsRemoveDesc ?? "",
  groupActionsBackTitle: config.groupActionsBackTitle ?? "",
  groupActionsBackDesc: config.groupActionsBackDesc ?? "",
  groupSelectInstanceHeaderText: config.groupSelectInstanceHeaderText ?? "",
  groupSelectInstanceBodyText: config.groupSelectInstanceBodyText ?? "",
  groupSelectInstanceButtonText: config.groupSelectInstanceButtonText ?? "",
  groupDeletePromptBodyText: config.groupDeletePromptBodyText ?? "",
  groupDeleteConfirmButtonText: config.groupDeleteConfirmButtonText ?? "",
  groupDeleteCancelButtonText: config.groupDeleteCancelButtonText ?? "",
  webPanelHeaderText: config.webPanelHeaderText ?? "",
  webPanelBodyText: config.webPanelBodyText ?? "",
  webPanelButtonText: config.webPanelButtonText ?? "",
  signupHeaderText: config.signupHeaderText ?? "",
  signupBodyText: config.signupBodyText ?? "",
  signupEmailInvalidText: config.signupEmailInvalidText ?? "",
  signupPasswordPromptText: config.signupPasswordPromptText ?? "",
  signupSuccessHeaderText: config.signupSuccessHeaderText ?? "",
  signupSuccessBodyText: config.signupSuccessBodyText ?? "",
  signupSuccessButtonText: config.signupSuccessButtonText ?? "",
  removeImage: false,
  imageFile: null,
});

// Prévia removida — editores apenas

const AdminBotMenuEditor = ({ config }: AdminBotMenuEditorProps) => {
  const [formState, setFormState] = useState<FormState>(() => toFormState(config));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(config.menuImageUrl);
  type SectionKey =
    | "general"
    | "menu"
    | "support_cta"
    | "subscription"
    | "noplan"
    | "planlist"
    | "payment"
    | "confirm"
    | "signup"
    | "panel"
    | "panel_web"
    | "addons"
    | "group_actions"
    | "group_select"
    | "group_delete"
    | "group_flow";
  const [activeSection, setActiveSection] = useState<SectionKey>("menu");
  const SECTION_LABEL: Record<SectionKey, string> = {
    general: "Geral",
    menu: "Menu principal",
    support_cta: "Mini card de suporte",
    subscription: "Assinatura",
    noplan: "Sem plano",
    planlist: "Lista de planos",
    payment: "Pagamento",
    confirm: "Confirmações",
    signup: "Cadastro rápido",
    addons: "Add-ons (planos)",
    panel: "Painel interno",
    panel_web: "Painel web (CTA)",
    group_actions: "Grupos: ações",
    group_select: "Grupos: selecionar instância",
    group_delete: "Grupos: exclusão",
    group_flow: "Fluxo de grupos",
  } as const;

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    setFormState(toFormState(config));
    setCurrentImageUrl(config.menuImageUrl);
    setPreviewUrl(null);
  }, [config]);

  const displayedImageUrl = useMemo(() => {
    if (formState.removeImage) {
      return null;
    }
    return previewUrl ?? currentImageUrl ?? null;
  }, [formState.removeImage, previewUrl, currentImageUrl]);

  const handleTextChange = (field: keyof FormState) =>
    (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      setFormState((previous) => ({ ...previous, [field]: value }));
    };

  const handleFileChange = (event: FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;

    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    if (!file) {
      setPreviewUrl(null);
      setFormState((previous) => ({ ...previous, imageFile: null }));
      return;
    }

    const mime = file.type.toLowerCase();
    if (mime !== "image/png" && mime !== "image/jpeg") {
      setFeedback({ type: "danger", message: "Selecione uma imagem PNG ou JPG." });
      event.currentTarget.value = "";
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setFormState((previous) => ({ ...previous, imageFile: file, removeImage: false }));
  };

  const handleRemoveImageToggle = (event: FormEvent<HTMLInputElement>) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    setFormState((previous) => ({ ...previous, removeImage: checked }));
    if (checked) {
      setPreviewUrl(null);
    }
  };

  // Variáveis: inserir tokens nos campos
  type FieldKey = keyof FormState;
  const fieldRefs = useMemo(() => ({} as Record<FieldKey, HTMLInputElement | HTMLTextAreaElement | null>), []);
  const setFieldRef = (key: FieldKey) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRefs[key] = el;
  };
  const [tokensModal, setTokensModal] = useState<{ field: FieldKey | null; tokens: string[] }>({ field: null, tokens: [] });
  const openTokens = (field: FieldKey, tokens: string[]) => setTokensModal({ field, tokens });
  const closeTokens = () => setTokensModal({ field: null, tokens: [] });
  const insertToken = (token: string) => {
    const field = tokensModal.field;
    if (!field) return;
    const el = fieldRefs[field];
    setFormState((prev) => {
      const current = String((prev as any)[field] ?? "");
      if (el && typeof (el as any).selectionStart === "number") {
        const start = (el as any).selectionStart as number;
        const end = (el as any).selectionEnd as number;
        const next = current.slice(0, start) + token + current.slice(end);
        setTimeout(() => {
          try { el?.focus(); (el as any).setSelectionRange(start + token.length, start + token.length); } catch {}
        }, 0);
        return { ...(prev as any), [field]: next } as FormState;
      }
      return { ...(prev as any), [field]: current + token } as FormState;
    });
  };

  const TOKENS = {
    common: ["{{bot_name}}", "{{user_first_name}}", "{{user_name}}", "{{user_number}}", "{{push_name}}"],
    plan: ["{{plan_name}}", "{{plan_status}}", "{{plan_price}}", "{{plan_renews_at}}", "{{plan_summary}}"],
    planRow: ["{{plan_name}}", "{{plan_price}}", "{{plan_instance_limit}}", "{{plan_group_limit}}", "{{plan_duration_days}}", "{{plan_description}}"],
    instance: ["{{instance_name}}"],
    addon: ["{{addon_instance_price}}", "{{addon_group_price}}", "{{addon_unit_price}}", "{{addon_label}}"],
    pix: ["{{pix_expires_at}}", "{{pix_expiration_line}}"],
  } as const;

  const LabelWithVars = ({ label, field, tokens }: { label: string; field: FieldKey; tokens: string[] }) => (
    <div className="d-flex justify-content-between align-items-center">
      <Form.Label className="mb-0">{label}</Form.Label>
      <Button size="sm" variant="outline-secondary" onClick={() => openTokens(field, tokens)}>Variáveis</Button>
    </div>
  );

  // Acionadores de navegação por seções
  const makeGo = (key: SectionKey) => () => setActiveSection(key);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const body = new FormData();
      body.set("botName", formState.botName);
      body.set("purchaseVoiceTemplate", formState.purchaseVoiceTemplate);
      body.set("balanceVoiceTemplate", formState.balanceVoiceTemplate);
      body.set("menuText", formState.menuText);
      body.set("menuFooterText", formState.menuFooterText);
      body.set("panelButtonText", formState.panelButtonText);
      body.set("subscriptionButtonText", formState.subscriptionButtonText);
      body.set("supportButtonText", formState.supportButtonText);
      body.set("supportUrl", formState.supportUrl);
      body.set("supportCtaBodyText", formState.supportCtaBodyText);
      body.set("supportCtaFooterText", formState.supportCtaFooterText);
      body.set("subscriptionHeaderText", formState.subscriptionHeaderText);
      body.set("subscriptionBodyText", formState.subscriptionBodyText);
      body.set("subscriptionFooterText", formState.subscriptionFooterText);
      body.set("subscriptionRenewButtonText", formState.subscriptionRenewButtonText);
      body.set("subscriptionChangeButtonText", formState.subscriptionChangeButtonText);
      body.set("subscriptionDetailsButtonText", formState.subscriptionDetailsButtonText);
      body.set("subscriptionNoPlanHeaderText", formState.subscriptionNoPlanHeaderText);
      body.set("subscriptionNoPlanBodyText", formState.subscriptionNoPlanBodyText);
      body.set("subscriptionNoPlanButtonText", formState.subscriptionNoPlanButtonText);
      body.set("subscriptionPlanListTitle", formState.subscriptionPlanListTitle);
      body.set("subscriptionPlanListBody", formState.subscriptionPlanListBody);
      body.set("subscriptionPlanListButtonText", formState.subscriptionPlanListButtonText);
      body.set("subscriptionPlanListFooterText", formState.subscriptionPlanListFooterText);
      body.set("subscriptionPlanListRowDescriptionTemplate", formState.subscriptionPlanListRowDescriptionTemplate);
      body.set("paymentMethodPickerTitle", formState.paymentMethodPickerTitle);
      body.set("paymentMethodPickerBody", formState.paymentMethodPickerBody);
      body.set("paymentMethodPickerButtonText", formState.paymentMethodPickerButtonText);
      body.set("paymentMethodPixRowTitle", formState.paymentMethodPixRowTitle);
      body.set("paymentMethodPixRowDescription", formState.paymentMethodPixRowDescription);
      body.set("paymentMethodCheckoutRowTitle", formState.paymentMethodCheckoutRowTitle);
      body.set("paymentMethodCheckoutRowDescription", formState.paymentMethodCheckoutRowDescription);
      body.set("paymentMethodPlanDetailsTemplate", formState.paymentMethodPlanDetailsTemplate);
      // Add-ons
      body.set("addonTypeHeaderText", formState.addonTypeHeaderText);
      body.set("addonTypeBodyText", formState.addonTypeBodyText);
      body.set("addonTypeInstanceButtonText", formState.addonTypeInstanceButtonText);
      body.set("addonTypeGroupButtonText", formState.addonTypeGroupButtonText);
      body.set("addonTypeCancelButtonText", formState.addonTypeCancelButtonText);
      body.set("addonQuantityHeaderText", formState.addonQuantityHeaderText);
      body.set("addonQuantityBodyText", formState.addonQuantityBodyText);
      body.set("addonQuantityButtonText", formState.addonQuantityButtonText);
      body.set("addonQuantityCancelRowText", formState.addonQuantityCancelRowText);
      body.set("pixPaymentHeaderText", formState.pixPaymentHeaderText);
      body.set("pixPaymentBodyText", formState.pixPaymentBodyText);
      body.set("pixPaymentButtonText", formState.pixPaymentButtonText);
      body.set("checkoutPaymentHeaderText", formState.checkoutPaymentHeaderText);
      body.set("checkoutPaymentBodyText", formState.checkoutPaymentBodyText);
      body.set("checkoutPaymentButtonText", formState.checkoutPaymentButtonText);
      // Confirmações (WhatsApp)
      body.set("planConfirmHeaderText", formState.planConfirmHeaderText);
      body.set("planConfirmBodyText", formState.planConfirmBodyText);
      body.set("planConfirmButtonText", formState.planConfirmButtonText);
      body.set("removePlanConfirmMedia", String(formState.removePlanConfirmMedia));
      if (formState.planConfirmMediaFile) { body.set("planConfirmMedia", formState.planConfirmMediaFile); }
      body.set("addonConfirmHeaderText", formState.addonConfirmHeaderText);
      body.set("addonConfirmBodyText", formState.addonConfirmBodyText);
      body.set("addonConfirmButtonText", formState.addonConfirmButtonText);
      body.set("removeAddonConfirmMedia", String(formState.removeAddonConfirmMedia));
      if (formState.addonConfirmMediaFile) { body.set("addonConfirmMedia", formState.addonConfirmMediaFile); }
      body.set("instanceConnectedHeaderText", formState.instanceConnectedHeaderText);
      body.set("instanceConnectedBodyText", formState.instanceConnectedBodyText);
      body.set("instanceConnectedLinkGroupButtonText", formState.instanceConnectedLinkGroupButtonText);
      body.set("instanceConnectedLaterButtonText", formState.instanceConnectedLaterButtonText);
      body.set("groupCreateHeaderText", formState.groupCreateHeaderText);
      body.set("groupCreateBodyText", formState.groupCreateBodyText);
      body.set("groupCreateFooterText", formState.groupCreateFooterText);
      body.set("groupCreateCancelButtonText", formState.groupCreateCancelButtonText);
      // Painel interno
      body.set("panelHeaderText", formState.panelHeaderText);
      body.set("panelBodyText", formState.panelBodyText);
      body.set("panelGroupsRowTitle", formState.panelGroupsRowTitle);
      body.set("panelGroupsRowDescription", formState.panelGroupsRowDescription);
      body.set("panelInstancesRowTitle", formState.panelInstancesRowTitle);
      body.set("panelInstancesRowDescription", formState.panelInstancesRowDescription);
      body.set("panelWebRowTitle", formState.panelWebRowTitle);
      body.set("panelWebRowDescription", formState.panelWebRowDescription);
      body.set("webPanelHeaderText", formState.webPanelHeaderText);
      body.set("webPanelBodyText", formState.webPanelBodyText);
      body.set("webPanelButtonText", formState.webPanelButtonText);
      body.set("panelBackRowTitle", formState.panelBackRowTitle);
      body.set("panelBackRowDescription", formState.panelBackRowDescription);
      // Grupos ações
      body.set("groupActionsHeaderText", formState.groupActionsHeaderText);
      body.set("groupActionsBodyText", formState.groupActionsBodyText);
      body.set("groupActionsButtonText", formState.groupActionsButtonText);
      body.set("groupActionsListTitle", formState.groupActionsListTitle);
      body.set("groupActionsListDesc", formState.groupActionsListDesc);
      body.set("groupActionsCreateTitle", formState.groupActionsCreateTitle);
      body.set("groupActionsCreateDesc", formState.groupActionsCreateDesc);
      body.set("groupActionsRemoveTitle", formState.groupActionsRemoveTitle);
      body.set("groupActionsRemoveDesc", formState.groupActionsRemoveDesc);
      body.set("groupActionsBackTitle", formState.groupActionsBackTitle);
      body.set("groupActionsBackDesc", formState.groupActionsBackDesc);
      // Grupos selecionar instância
      body.set("groupSelectInstanceHeaderText", formState.groupSelectInstanceHeaderText);
      body.set("groupSelectInstanceBodyText", formState.groupSelectInstanceBodyText);
      body.set("groupSelectInstanceButtonText", formState.groupSelectInstanceButtonText);
      // Grupos exclusão
      body.set("groupDeletePromptBodyText", formState.groupDeletePromptBodyText);
      body.set("groupDeleteConfirmButtonText", formState.groupDeleteConfirmButtonText);
      body.set("groupDeleteCancelButtonText", formState.groupDeleteCancelButtonText);
      // Signup (WhatsApp)
      body.set("signupHeaderText", formState.signupHeaderText);
      body.set("signupBodyText", formState.signupBodyText);
      body.set("signupEmailInvalidText", formState.signupEmailInvalidText);
      body.set("signupPasswordPromptText", formState.signupPasswordPromptText);
      body.set("signupSuccessHeaderText", formState.signupSuccessHeaderText);
      body.set("signupSuccessBodyText", formState.signupSuccessBodyText);
      body.set("signupSuccessButtonText", formState.signupSuccessButtonText);
      body.set("removeMenuImage", String(formState.removeImage));

      if (formState.imageFile) {
        body.set("menuImage", formState.imageFile);
      }

      const response = await fetch("/api/admin/bot/config", {
        method: "POST",
        body,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? "Não foi possível atualizar as configurações do bot.";
        throw new Error(message);
      }

      if (payload?.config) {
        const nextConfig = payload.config as AdminBotConfig;
        setFormState(toFormState(nextConfig));
        setCurrentImageUrl(nextConfig.menuImageUrl);
        setPreviewUrl(null);
      }

      setFeedback({
        type: "success",
        message: payload?.message ?? "Configurações do bot atualizadas com sucesso.",
      });
    } catch (error) {
      console.error("Failed to update admin bot config", error);
      setFeedback({
        type: "danger",
        message:
          error instanceof Error ? error.message : "Não foi possível atualizar as configurações do bot.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Nenhuma variável de prévia

  return (
    <div className="admin-bot-editor position-relative" style={{ maxWidth: "100%", overflowX: "clip" }}>
    {/* Atalhos de edição (botões por seção) */}
    <div className="container-narrow">
      <div className="editor-grid">
        <aside className="nav-col">
          <Card className="mb-4">
            <Card.Header>
              <Card.Title as="h2" className="h6 mb-0">Seções do bot</Card.Title>
            </Card.Header>
            <Card.Body className="py-3">
              <div className="d-flex flex-column gap-2">
                <Button size="sm" variant={activeSection === "general" ? "success" : "outline-secondary"} onClick={makeGo("general")}>Geral</Button>
                <Button size="sm" variant={activeSection === "menu" ? "success" : "outline-secondary"} onClick={makeGo("menu")}>Menu principal</Button>
                <Button size="sm" variant={activeSection === "support_cta" ? "success" : "outline-secondary"} onClick={makeGo("support_cta")}>Mini card de suporte</Button>
                <Button size="sm" variant={activeSection === "subscription" ? "success" : "outline-secondary"} onClick={makeGo("subscription")}>Assinatura</Button>
                <Button size="sm" variant={activeSection === "noplan" ? "success" : "outline-secondary"} onClick={makeGo("noplan")}>Sem plano</Button>
                <Button size="sm" variant={activeSection === "planlist" ? "success" : "outline-secondary"} onClick={makeGo("planlist")}>Lista de planos</Button>
                <hr className="my-2" />
                <Button size="sm" variant={activeSection === "payment" ? "primary" : "outline-secondary"} onClick={makeGo("payment")}>Pagamento</Button>
                <Button size="sm" variant={activeSection === "confirm" ? "primary" : "outline-secondary"} onClick={makeGo("confirm")}>Confirmações</Button>
                <Button size="sm" variant={activeSection === "signup" ? "primary" : "outline-secondary"} onClick={makeGo("signup")}>Cadastro rápido</Button>
                <Button size="sm" variant={activeSection === "panel" ? "primary" : "outline-secondary"} onClick={makeGo("panel")}>Painel interno</Button>
                <Button size="sm" variant={activeSection === "panel_web" ? "primary" : "outline-secondary"} onClick={makeGo("panel_web")}>Painel web (CTA)</Button>
                <Button size="sm" variant={activeSection === "group_actions" ? "primary" : "outline-secondary"} onClick={makeGo("group_actions")}>Grupos: ações</Button>
                <Button size="sm" variant={activeSection === "group_select" ? "primary" : "outline-secondary"} onClick={makeGo("group_select")}>Grupos: selecionar instância</Button>
                <Button size="sm" variant={activeSection === "group_delete" ? "primary" : "outline-secondary"} onClick={makeGo("group_delete")}>Grupos: exclusão</Button>
                <Button size="sm" variant={activeSection === "group_flow" ? "primary" : "outline-secondary"} onClick={makeGo("group_flow")}>Fluxo de grupos</Button>
              </div>
            </Card.Body>
          </Card>
        </aside>
        <main className="content-col">

    {(["general", "menu", "support_cta", "subscription", "noplan", "planlist"] as SectionKey[]).includes(activeSection) && (
    <Card className="mb-4">
      <Card.Header>
        <Card.Title as="h2" className="h5 mb-0">{`Editar • ${SECTION_LABEL[activeSection]}`}</Card.Title>
      </Card.Header>
      <Card.Body>
        <Form className="d-flex flex-column gap-4" onSubmit={handleSubmit} encType="multipart/form-data">
          {feedback && (
            <Alert
              variant={feedback.type === "success" ? "success" : "danger"}
              onClose={() => setFeedback(null)}
              dismissible
              className="mb-0"
            >
              {feedback.message}
            </Alert>
          )}
          {/* View: Geral */}
          {activeSection === "general" && (
            <>
              <Form.Group controlId="admin-bot-name">
                <Form.Label>Nome do bot</Form.Label>
                <Form.Control type="text" value={formState.botName} onChange={handleTextChange("botName")} disabled={isSubmitting} required />
                <Form.Text>Esse nome aparecerá nas mensagens automáticas e pode ser usado com {"{{bot_name}}"}.</Form.Text>
              </Form.Group>
              <Form.Group controlId="admin-voice-template-purchase" className="mt-3">
                <Form.Label>Mensagem curta para compras (voz)</Form.Label>
                <Form.Control as="textarea" rows={3} value={formState.purchaseVoiceTemplate} onChange={handleTextChange("purchaseVoiceTemplate")} disabled={isSubmitting} required maxLength={160} />
              </Form.Group>
              <Form.Group controlId="admin-voice-template-balance" className="mt-3">
                <Form.Label>Mensagem curta para créditos (voz)</Form.Label>
                <Form.Control as="textarea" rows={3} value={formState.balanceVoiceTemplate} onChange={handleTextChange("balanceVoiceTemplate")} disabled={isSubmitting} required maxLength={160} />
              </Form.Group>
            </>
          )}

          {/* View: Menu principal */}
          {activeSection === "menu" && (
            <>
              <Form.Group controlId="admin-bot-menu-text">
                <LabelWithVars label="Mensagem do menu principal" field="menuText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control as="textarea" rows={4} value={formState.menuText} onChange={handleTextChange("menuText")} disabled={isSubmitting} required ref={setFieldRef("menuText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-menu-footer" className="mt-3">
                <LabelWithVars label="Rodapé do menu" field="menuFooterText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.menuFooterText} onChange={handleTextChange("menuFooterText")} disabled={isSubmitting} ref={setFieldRef("menuFooterText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-menu-image" className="mt-3">
                <Form.Label>Imagem do menu (opcional)</Form.Label>
                <Form.Control type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} disabled={isSubmitting} />
                <Form.Check type="switch" id="admin-bot-menu-remove-image" className="mt-2" label="Remover imagem atual" checked={formState.removeImage} onChange={handleRemoveImageToggle} disabled={isSubmitting || (!displayedImageUrl && !currentImageUrl)} />
              </Form.Group>
            </>
          )}

          {/* View: Mini card de suporte */}
          {activeSection === "support_cta" && (
            <>
              <Alert variant="info" className="mb-0">
                Configure aqui o botão de suporte do menu principal e a mensagem exibida ao usuário.
              </Alert>
              <Form.Group controlId="admin-bot-support-button" className="mt-3">
                <LabelWithVars label="Botão do suporte (menu principal)" field="supportButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control
                  type="text"
                  value={formState.supportButtonText}
                  onChange={handleTextChange("supportButtonText")}
                  disabled={isSubmitting}
                  required
                  ref={setFieldRef("supportButtonText")}
                />
                <Form.Text className="text-secondary">
                  Esse rótulo também aparece no mini card de suporte.
                </Form.Text>
              </Form.Group>
              <Form.Group controlId="admin-bot-support-url" className="mt-3">
                <Form.Label>URL do suporte</Form.Label>
                <Form.Control
                  type="url"
                  value={formState.supportUrl}
                  onChange={handleTextChange("supportUrl")}
                  disabled={isSubmitting}
                  placeholder="https://seusite.com/suporte"
                  ref={setFieldRef("supportUrl")}
                />
                <Form.Text className="text-secondary">
                  Deixe vazio para usar automaticamente a URL configurada no painel do site.
                </Form.Text>
              </Form.Group>
              <Form.Group controlId="admin-bot-support-cta-body" className="mt-3">
                <LabelWithVars
                  label="Mensagem do cartão de suporte"
                  field="supportCtaBodyText"
                  tokens={[...TOKENS.common, ...TOKENS.plan]}
                />
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={formState.supportCtaBodyText}
                  onChange={handleTextChange("supportCtaBodyText")}
                  disabled={isSubmitting}
                  required
                  ref={setFieldRef("supportCtaBodyText")}
                  maxLength={500}
                  placeholder="Toque no botão abaixo para abrir o suporte no site."
                />
                <Form.Text>
                  Essa mensagem aparece acima do botão verde quando o usuário toca em “Suporte”.
                </Form.Text>
              </Form.Group>
              <Form.Group controlId="admin-bot-support-cta-footer" className="mt-3">
                <Form.Label>Texto de rodapé (opcional)</Form.Label>
                <Form.Control
                  type="text"
                  value={formState.supportCtaFooterText}
                  onChange={handleTextChange("supportCtaFooterText")}
                  disabled={isSubmitting}
                  ref={setFieldRef("supportCtaFooterText")}
                  maxLength={60}
                  placeholder="Bot Admin"
                />
                <Form.Text>
                  Preencha se quiser exibir uma assinatura pequena logo acima do horário (ex.: nome da empresa).
                </Form.Text>
              </Form.Group>
            </>
          )}

          {/* View: Assinatura */}
          {activeSection === "subscription" && (
            <>
              <Form.Group controlId="admin-bot-subscription-button">
                <LabelWithVars label="Botão do menu principal" field="subscriptionButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.subscriptionButtonText} onChange={handleTextChange("subscriptionButtonText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionButtonText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-subscription-header" className="mt-3">
                <LabelWithVars label="Título da assinatura" field="subscriptionHeaderText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.subscriptionHeaderText} onChange={handleTextChange("subscriptionHeaderText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionHeaderText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-subscription-body" className="mt-3">
                <LabelWithVars label="Resumo do plano" field="subscriptionBodyText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control as="textarea" rows={4} value={formState.subscriptionBodyText} onChange={handleTextChange("subscriptionBodyText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionBodyText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-subscription-footer" className="mt-3">
                <LabelWithVars label="Rodapé da assinatura" field="subscriptionFooterText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.subscriptionFooterText} onChange={handleTextChange("subscriptionFooterText")} disabled={isSubmitting} ref={setFieldRef("subscriptionFooterText")} />
              </Form.Group>
              <Row className="g-3 mt-1">
                <Col md={12}>
                  <Form.Group controlId="admin-bot-subscription-renew">
                    <LabelWithVars label="Botão renovar" field="subscriptionRenewButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                    <Form.Control type="text" value={formState.subscriptionRenewButtonText} onChange={handleTextChange("subscriptionRenewButtonText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionRenewButtonText")} />
                  </Form.Group>
                </Col>
                <Col md={12}>
                  <Form.Group controlId="admin-bot-subscription-change" className="mt-2">
                    <LabelWithVars label="Botão mudar" field="subscriptionChangeButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                    <Form.Control type="text" value={formState.subscriptionChangeButtonText} onChange={handleTextChange("subscriptionChangeButtonText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionChangeButtonText")} />
                  </Form.Group>
                </Col>
                <Col md={12}>
                  <Form.Group controlId="admin-bot-subscription-details" className="mt-2">
                    <LabelWithVars label="Botão detalhes" field="subscriptionDetailsButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                    <Form.Control type="text" value={formState.subscriptionDetailsButtonText} onChange={handleTextChange("subscriptionDetailsButtonText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionDetailsButtonText")} />
                  </Form.Group>
                </Col>
              </Row>
            </>
          )}

          {/* View: Sem plano */}
          {activeSection === "noplan" && (
            <>
              <Form.Group controlId="admin-bot-noplan-header">
                <LabelWithVars label="Título sem plano" field="subscriptionNoPlanHeaderText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.subscriptionNoPlanHeaderText} onChange={handleTextChange("subscriptionNoPlanHeaderText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionNoPlanHeaderText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-noplan-body" className="mt-3">
                <LabelWithVars label="Mensagem sem plano" field="subscriptionNoPlanBodyText" tokens={[...TOKENS.common]} />
                <Form.Control as="textarea" rows={4} value={formState.subscriptionNoPlanBodyText} onChange={handleTextChange("subscriptionNoPlanBodyText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionNoPlanBodyText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-noplan-button" className="mt-3">
                <LabelWithVars label="Botão para assinar" field="subscriptionNoPlanButtonText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.subscriptionNoPlanButtonText} onChange={handleTextChange("subscriptionNoPlanButtonText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionNoPlanButtonText")} />
              </Form.Group>
            </>
          )}

          {/* View: Lista de planos */}
          {activeSection === "planlist" && (
            <>
              <Form.Group controlId="admin-bot-planlist-title">
                <LabelWithVars label="Título da lista de planos" field="subscriptionPlanListTitle" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.subscriptionPlanListTitle} onChange={handleTextChange("subscriptionPlanListTitle")} disabled={isSubmitting} required ref={setFieldRef("subscriptionPlanListTitle")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-planlist-body" className="mt-3">
                <LabelWithVars label="Mensagem da lista de planos" field="subscriptionPlanListBody" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control as="textarea" rows={4} value={formState.subscriptionPlanListBody} onChange={handleTextChange("subscriptionPlanListBody")} disabled={isSubmitting} required ref={setFieldRef("subscriptionPlanListBody")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-planlist-row-template" className="mt-3">
                <LabelWithVars label="Descrição de cada plano" field="subscriptionPlanListRowDescriptionTemplate" tokens={[...TOKENS.planRow]} />
                <Form.Control as="textarea" rows={3} value={formState.subscriptionPlanListRowDescriptionTemplate} onChange={handleTextChange("subscriptionPlanListRowDescriptionTemplate")} disabled={isSubmitting} ref={setFieldRef("subscriptionPlanListRowDescriptionTemplate")} />
                <Form.Text>Texto exibido na linha de cada plano. Limite recomendado: 60 caracteres após aplicar as variáveis.</Form.Text>
              </Form.Group>
              <Form.Group controlId="admin-bot-planlist-button" className="mt-3">
                <LabelWithVars label="Botão da lista" field="subscriptionPlanListButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.subscriptionPlanListButtonText} onChange={handleTextChange("subscriptionPlanListButtonText")} disabled={isSubmitting} required ref={setFieldRef("subscriptionPlanListButtonText")} />
              </Form.Group>
              <Form.Group controlId="admin-bot-planlist-footer" className="mt-3">
                <LabelWithVars label="Rodapé da lista" field="subscriptionPlanListFooterText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.subscriptionPlanListFooterText} onChange={handleTextChange("subscriptionPlanListFooterText")} disabled={isSubmitting} ref={setFieldRef("subscriptionPlanListFooterText")} />
              </Form.Group>
            </>
          )}
          <div className="d-flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
            <Button
              type="button"
              variant="outline-secondary"
              disabled={isSubmitting}
              onClick={() => {
                setFormState(toFormState(config));
                setPreviewUrl(null);
                setCurrentImageUrl(config.menuImageUrl);
                setFeedback(null);
              }}
            >
              Restaurar valores carregados
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
    )}

    {activeSection === "signup" && (
      <Card className="mb-4">
        <Card.Header>
          <Card.Title as="h2" className="h6 mb-0">Cadastro rápido (WhatsApp)</Card.Title>
        </Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Título" field="signupHeaderText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.signupHeaderText} onChange={handleTextChange("signupHeaderText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Mensagem inicial" field="signupBodyText" tokens={[...TOKENS.common]} />
                <Form.Control as="textarea" rows={2} value={formState.signupBodyText} onChange={handleTextChange("signupBodyText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Aviso e-mail inválido" field="signupEmailInvalidText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.signupEmailInvalidText} onChange={handleTextChange("signupEmailInvalidText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Prompt de senha" field="signupPasswordPromptText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.signupPasswordPromptText} onChange={handleTextChange("signupPasswordPromptText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Sucesso — título" field="signupSuccessHeaderText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.signupSuccessHeaderText} onChange={handleTextChange("signupSuccessHeaderText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Sucesso — botão" field="signupSuccessButtonText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.signupSuccessButtonText} onChange={handleTextChange("signupSuccessButtonText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <LabelWithVars label="Sucesso — mensagem" field="signupSuccessBodyText" tokens={[...TOKENS.common]} />
                <Form.Control as="textarea" rows={2} value={formState.signupSuccessBodyText} onChange={handleTextChange("signupSuccessBodyText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex gap-2 mt-3">
            <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </Card.Body>
      </Card>
    )}

    {activeSection === "payment" && (
    <>
      <Card className="mb-4">
        <Card.Header>
          <Card.Title as="h2" className="h6 mb-0">Pagamento (escolha do método)</Card.Title>
        </Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Título do picker" field="paymentMethodPickerTitle" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.paymentMethodPickerTitle} onChange={handleTextChange("paymentMethodPickerTitle")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Texto do botão" field="paymentMethodPickerButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.paymentMethodPickerButtonText} onChange={handleTextChange("paymentMethodPickerButtonText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <LabelWithVars label="Mensagem do picker" field="paymentMethodPickerBody" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control as="textarea" rows={3} value={formState.paymentMethodPickerBody} onChange={handleTextChange("paymentMethodPickerBody")} disabled={isSubmitting} ref={setFieldRef("paymentMethodPickerBody")} />
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <LabelWithVars label="Resumo detalhado do plano" field="paymentMethodPlanDetailsTemplate" tokens={[...TOKENS.planRow, "{{plan_summary}}"]} />
                <Form.Control as="textarea" rows={4} value={formState.paymentMethodPlanDetailsTemplate} onChange={handleTextChange("paymentMethodPlanDetailsTemplate")} disabled={isSubmitting} ref={setFieldRef("paymentMethodPlanDetailsTemplate")} />
                <Form.Text>Esse texto aparece antes das opções de pagamento. Útil para reforçar preço, limites e duração do plano.</Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Título opção Pix" field="paymentMethodPixRowTitle" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.paymentMethodPixRowTitle} onChange={handleTextChange("paymentMethodPixRowTitle")} disabled={isSubmitting} ref={setFieldRef("paymentMethodPixRowTitle")} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Descrição opção Pix" field="paymentMethodPixRowDescription" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.paymentMethodPixRowDescription} onChange={handleTextChange("paymentMethodPixRowDescription")} disabled={isSubmitting} ref={setFieldRef("paymentMethodPixRowDescription")} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Título opção Checkout" field="paymentMethodCheckoutRowTitle" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.paymentMethodCheckoutRowTitle} onChange={handleTextChange("paymentMethodCheckoutRowTitle")} disabled={isSubmitting} ref={setFieldRef("paymentMethodCheckoutRowTitle")} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Descrição opção Checkout" field="paymentMethodCheckoutRowDescription" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.paymentMethodCheckoutRowDescription} onChange={handleTextChange("paymentMethodCheckoutRowDescription")} disabled={isSubmitting} ref={setFieldRef("paymentMethodCheckoutRowDescription")} />
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex gap-2 mt-3">
            <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
            <Button type="button" variant="outline-secondary" disabled={isSubmitting}
              onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
              Restaurar valores carregados
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card className="mb-4">
        <Card.Header>
          <Card.Title as="h2" className="h6 mb-0">Mensagens dos pagamentos</Card.Title>
          <Card.Subtitle className="text-secondary small mt-1">
            Ajuste o conteúdo enviado junto aos botões de pagamento Pix e online no bot administrativo.
          </Card.Subtitle>
        </Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Pix — título" field="pixPaymentHeaderText" tokens={[...TOKENS.common, ...TOKENS.plan, ...TOKENS.pix]} />
                <Form.Control type="text" value={formState.pixPaymentHeaderText} onChange={handleTextChange("pixPaymentHeaderText")} disabled={isSubmitting} ref={setFieldRef("pixPaymentHeaderText")} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Pix — botão" field="pixPaymentButtonText" tokens={[...TOKENS.common, ...TOKENS.plan, ...TOKENS.pix]} />
                <Form.Control type="text" value={formState.pixPaymentButtonText} onChange={handleTextChange("pixPaymentButtonText")} disabled={isSubmitting} ref={setFieldRef("pixPaymentButtonText")} />
              </Form.Group>
            </Col>
            <Col xs={12}>
              <Form.Group>
                <LabelWithVars label="Pix — mensagem" field="pixPaymentBodyText" tokens={[...TOKENS.common, ...TOKENS.plan, ...TOKENS.pix]} />
                <Form.Control as="textarea" rows={4} value={formState.pixPaymentBodyText} onChange={handleTextChange("pixPaymentBodyText")} disabled={isSubmitting} ref={setFieldRef("pixPaymentBodyText")} />
              </Form.Group>
            </Col>
          </Row>
          <hr className="my-4" />
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Checkout — título" field="checkoutPaymentHeaderText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.checkoutPaymentHeaderText} onChange={handleTextChange("checkoutPaymentHeaderText")} disabled={isSubmitting} ref={setFieldRef("checkoutPaymentHeaderText")} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Checkout — botão" field="checkoutPaymentButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control type="text" value={formState.checkoutPaymentButtonText} onChange={handleTextChange("checkoutPaymentButtonText")} disabled={isSubmitting} ref={setFieldRef("checkoutPaymentButtonText")} />
              </Form.Group>
            </Col>
            <Col xs={12}>
              <Form.Group>
                <LabelWithVars label="Checkout — mensagem" field="checkoutPaymentBodyText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                <Form.Control as="textarea" rows={4} value={formState.checkoutPaymentBodyText} onChange={handleTextChange("checkoutPaymentBodyText")} disabled={isSubmitting} ref={setFieldRef("checkoutPaymentBodyText")} />
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex gap-2 mt-3">
            <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
            <Button type="button" variant="outline-secondary" disabled={isSubmitting}
              onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
              Restaurar valores carregados
            </Button>
          </div>
        </Card.Body>
    </Card>
    </>
    )}

    {activeSection === "confirm" && (
      <>
        <Card className="mb-4">
          <Card.Header>
            <Card.Title as="h2" className="h6 mb-0">Mensagens de confirmação (WhatsApp)</Card.Title>
          </Card.Header>
          <Card.Body>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group>
                  <LabelWithVars label="Título (plano)" field="planConfirmHeaderText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
                  <Form.Control type="text" value={formState.planConfirmHeaderText} onChange={handleTextChange("planConfirmHeaderText")} disabled={isSubmitting} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <LabelWithVars label="Botão (plano)" field="planConfirmButtonText" tokens={[...TOKENS.common]} />
                  <Form.Control type="text" value={formState.planConfirmButtonText} onChange={handleTextChange("planConfirmButtonText")} disabled={isSubmitting} />
                </Form.Group>
              </Col>
              <Col md={12}>
                <Form.Group>
                  <LabelWithVars label="Mensagem (plano)" field="planConfirmBodyText" tokens={[...TOKENS.common, ...TOKENS.plan, "{{amount}}", "{{new_due_date}}"]} />
                  <Form.Control as="textarea" rows={4} value={formState.planConfirmBodyText} onChange={handleTextChange("planConfirmBodyText")} disabled={isSubmitting} ref={setFieldRef("planConfirmBodyText")} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Mídia (plano)</Form.Label>
                  <Form.Control type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
                    const f = e.currentTarget.files?.[0] ?? null;
                    setFormState((s) => ({ ...s, planConfirmMediaFile: f }));
                  }} disabled={isSubmitting} />
                  <Form.Check type="switch" id="admin-plan-confirm-media-remove" className="mt-2" label="Remover mídia" checked={formState.removePlanConfirmMedia} onChange={(e) => setFormState((s) => ({ ...s, removePlanConfirmMedia: e.currentTarget.checked }))} disabled={isSubmitting} />
                </Form.Group>
              </Col>
              <hr className="my-2" />
              <Col md={6}>
                <Form.Group>
                  <LabelWithVars label="Título (add-ons)" field="addonConfirmHeaderText" tokens={[...TOKENS.common]} />
                  <Form.Control type="text" value={formState.addonConfirmHeaderText} onChange={handleTextChange("addonConfirmHeaderText")} disabled={isSubmitting} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <LabelWithVars label="Botão (add-ons)" field="addonConfirmButtonText" tokens={[...TOKENS.common]} />
                  <Form.Control type="text" value={formState.addonConfirmButtonText} onChange={handleTextChange("addonConfirmButtonText")} disabled={isSubmitting} />
                </Form.Group>
              </Col>
              <Col md={12}>
                <Form.Group>
                  <LabelWithVars label="Mensagem (add-ons)" field="addonConfirmBodyText" tokens={[...TOKENS.common, "{{addons_summary}}", "{{addon_expires_at}}"]} />
                  <Form.Control as="textarea" rows={4} value={formState.addonConfirmBodyText} onChange={handleTextChange("addonConfirmBodyText")} disabled={isSubmitting} ref={setFieldRef("addonConfirmBodyText")} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Mídia (add-ons)</Form.Label>
                  <Form.Control type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
                    const f = e.currentTarget.files?.[0] ?? null;
                    setFormState((s) => ({ ...s, addonConfirmMediaFile: f }));
                  }} disabled={isSubmitting} />
                  <Form.Check type="switch" id="admin-addon-confirm-media-remove" className="mt-2" label="Remover mídia" checked={formState.removeAddonConfirmMedia} onChange={(e) => setFormState((s) => ({ ...s, removeAddonConfirmMedia: e.currentTarget.checked }))} disabled={isSubmitting} />
                </Form.Group>
              </Col>
            </Row>
            <div className="d-flex gap-2 mt-3">
              <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
                {isSubmitting ? "Salvando..." : "Salvar alterações"}
              </Button>
            </div>
          </Card.Body>
        </Card>
      </>
    )}

    {activeSection === "addons" && (
    <Card className="mb-4">
      <Card.Header>
        <Card.Title as="h2" className="h6 mb-0">Mensagens de add-ons (planos)</Card.Title>
      </Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Tipo — título" field="addonTypeHeaderText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
              <Form.Control type="text" value={formState.addonTypeHeaderText} onChange={handleTextChange("addonTypeHeaderText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Tipo — botão cancelar" field="addonTypeCancelButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.addonTypeCancelButtonText} onChange={handleTextChange("addonTypeCancelButtonText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <LabelWithVars label="Tipo — mensagem" field="addonTypeBodyText" tokens={[...TOKENS.common, ...TOKENS.plan, ...TOKENS.addon]} />
              <Form.Control as="textarea" rows={3} value={formState.addonTypeBodyText} onChange={handleTextChange("addonTypeBodyText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Tipo — botão instâncias" field="addonTypeInstanceButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.addonTypeInstanceButtonText} onChange={handleTextChange("addonTypeInstanceButtonText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Tipo — botão grupos" field="addonTypeGroupButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.addonTypeGroupButtonText} onChange={handleTextChange("addonTypeGroupButtonText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
        </Row>
        <hr className="my-4" />
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Quantidade — título" field="addonQuantityHeaderText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
              <Form.Control type="text" value={formState.addonQuantityHeaderText} onChange={handleTextChange("addonQuantityHeaderText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Quantidade — texto do botão da lista" field="addonQuantityButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.addonQuantityButtonText} onChange={handleTextChange("addonQuantityButtonText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <LabelWithVars label="Quantidade — mensagem" field="addonQuantityBodyText" tokens={[...TOKENS.common, ...TOKENS.addon]} />
              <Form.Control as="textarea" rows={3} value={formState.addonQuantityBodyText} onChange={handleTextChange("addonQuantityBodyText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Quantidade — item cancelar" field="addonQuantityCancelRowText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.addonQuantityCancelRowText} onChange={handleTextChange("addonQuantityCancelRowText")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex gap-2 mt-3">
          <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline-secondary" disabled={isSubmitting}
            onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
            Restaurar valores carregados
          </Button>
        </div>
      </Card.Body>
    </Card>
    )}
    {activeSection === "panel" && (
    <Card className="mb-4">
      <Card.Header>
        <Card.Title as="h2" className="h6 mb-0">Painel (menu interno)</Card.Title>
      </Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Botão do menu principal" field="panelButtonText" tokens={[...TOKENS.common, ...TOKENS.plan]} />
              <Form.Control type="text" value={formState.panelButtonText} onChange={handleTextChange("panelButtonText")} disabled={isSubmitting} required ref={setFieldRef("panelButtonText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Título" field="panelHeaderText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelHeaderText} onChange={handleTextChange("panelHeaderText")} disabled={isSubmitting} ref={setFieldRef("panelHeaderText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Mensagem" field="panelBodyText" tokens={[...TOKENS.common]} />
              <Form.Control as="textarea" rows={2} value={formState.panelBodyText} onChange={handleTextChange("panelBodyText")} disabled={isSubmitting} ref={setFieldRef("panelBodyText")} />
            </Form.Group>
          </Col>
        </Row>
        <Row className="g-3 mt-1">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Linha grupos - título" field="panelGroupsRowTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelGroupsRowTitle} onChange={handleTextChange("panelGroupsRowTitle")} disabled={isSubmitting} ref={setFieldRef("panelGroupsRowTitle")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Linha grupos - descrição" field="panelGroupsRowDescription" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelGroupsRowDescription} onChange={handleTextChange("panelGroupsRowDescription")} disabled={isSubmitting} ref={setFieldRef("panelGroupsRowDescription")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Linha instâncias - título" field="panelInstancesRowTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelInstancesRowTitle} onChange={handleTextChange("panelInstancesRowTitle")} disabled={isSubmitting} ref={setFieldRef("panelInstancesRowTitle")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Linha instâncias - descrição" field="panelInstancesRowDescription" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelInstancesRowDescription} onChange={handleTextChange("panelInstancesRowDescription")} disabled={isSubmitting} ref={setFieldRef("panelInstancesRowDescription")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Painel web — título da linha" field="panelWebRowTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelWebRowTitle} onChange={handleTextChange("panelWebRowTitle")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Painel web — descrição da linha" field="panelWebRowDescription" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelWebRowDescription} onChange={handleTextChange("panelWebRowDescription")} disabled={isSubmitting} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Voltar - título" field="panelBackRowTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelBackRowTitle} onChange={handleTextChange("panelBackRowTitle")} disabled={isSubmitting} ref={setFieldRef("panelBackRowTitle")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Voltar - descrição" field="panelBackRowDescription" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.panelBackRowDescription} onChange={handleTextChange("panelBackRowDescription")} disabled={isSubmitting} ref={setFieldRef("panelBackRowDescription")} />
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex gap-2 mt-3">
          <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline-secondary" disabled={isSubmitting}
            onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
            Restaurar valores carregados
          </Button>
        </div>
      </Card.Body>
    </Card>
    )}
    {activeSection === "panel_web" && (
      <Card className="mb-4">
        <Card.Header>
          <Card.Title as="h2" className="h6 mb-0">Painel web (CTA)</Card.Title>
        </Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Titulo do card" field="webPanelHeaderText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.webPanelHeaderText} onChange={handleTextChange("webPanelHeaderText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <LabelWithVars label="Texto do botão" field="webPanelButtonText" tokens={[...TOKENS.common]} />
                <Form.Control type="text" value={formState.webPanelButtonText} onChange={handleTextChange("webPanelButtonText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
            <Col xs={12}>
              <Form.Group>
                <LabelWithVars label="Mensagem do card" field="webPanelBodyText" tokens={[...TOKENS.common]} />
                <Form.Control as="textarea" rows={3} value={formState.webPanelBodyText} onChange={handleTextChange("webPanelBodyText")} disabled={isSubmitting} />
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex gap-2 mt-3">
            <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </Button>
            <Button
              type="button"
              variant="outline-secondary"
              disabled={isSubmitting}
              onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}
            >
              Restaurar valores carregados
            </Button>
          </div>
        </Card.Body>
      </Card>
    )}

    {activeSection === "group_actions" && (
    <Card className="mb-4">
      <Card.Header>
        <Card.Title as="h2" className="h6 mb-0">Grupos (ações)</Card.Title>
      </Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Título" field="groupActionsHeaderText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsHeaderText} onChange={handleTextChange("groupActionsHeaderText")} disabled={isSubmitting} ref={setFieldRef("groupActionsHeaderText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Mensagem" field="groupActionsBodyText" tokens={[...TOKENS.common]} />
              <Form.Control as="textarea" rows={2} value={formState.groupActionsBodyText} onChange={handleTextChange("groupActionsBodyText")} disabled={isSubmitting} ref={setFieldRef("groupActionsBodyText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Texto do botão" field="groupActionsButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsButtonText} onChange={handleTextChange("groupActionsButtonText")} disabled={isSubmitting} ref={setFieldRef("groupActionsButtonText")} />
            </Form.Group>
          </Col>
        </Row>
        <Row className="g-3 mt-1">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Listar - título" field="groupActionsListTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsListTitle} onChange={handleTextChange("groupActionsListTitle")} disabled={isSubmitting} ref={setFieldRef("groupActionsListTitle")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Listar - descrição" field="groupActionsListDesc" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsListDesc} onChange={handleTextChange("groupActionsListDesc")} disabled={isSubmitting} ref={setFieldRef("groupActionsListDesc")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Cadastrar - título" field="groupActionsCreateTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsCreateTitle} onChange={handleTextChange("groupActionsCreateTitle")} disabled={isSubmitting} ref={setFieldRef("groupActionsCreateTitle")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Cadastrar - descrição" field="groupActionsCreateDesc" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsCreateDesc} onChange={handleTextChange("groupActionsCreateDesc")} disabled={isSubmitting} ref={setFieldRef("groupActionsCreateDesc")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Excluir - título" field="groupActionsRemoveTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsRemoveTitle} onChange={handleTextChange("groupActionsRemoveTitle")} disabled={isSubmitting} ref={setFieldRef("groupActionsRemoveTitle")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Excluir - descrição" field="groupActionsRemoveDesc" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsRemoveDesc} onChange={handleTextChange("groupActionsRemoveDesc")} disabled={isSubmitting} ref={setFieldRef("groupActionsRemoveDesc")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Voltar - título" field="groupActionsBackTitle" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsBackTitle} onChange={handleTextChange("groupActionsBackTitle")} disabled={isSubmitting} ref={setFieldRef("groupActionsBackTitle")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Voltar - descrição" field="groupActionsBackDesc" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupActionsBackDesc} onChange={handleTextChange("groupActionsBackDesc")} disabled={isSubmitting} ref={setFieldRef("groupActionsBackDesc")} />
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex gap-2 mt-3">
          <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline-secondary" disabled={isSubmitting}
            onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
            Restaurar valores carregados
          </Button>
        </div>
      </Card.Body>
    </Card>
    )}

    {activeSection === "group_select" && (
    <Card className="mb-4">
      <Card.Header>
        <Card.Title as="h2" className="h6 mb-0">Grupos (selecionar instância)</Card.Title>
      </Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Título" field="groupSelectInstanceHeaderText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupSelectInstanceHeaderText} onChange={handleTextChange("groupSelectInstanceHeaderText")} disabled={isSubmitting} ref={setFieldRef("groupSelectInstanceHeaderText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Mensagem" field="groupSelectInstanceBodyText" tokens={[...TOKENS.common]} />
              <Form.Control as="textarea" rows={2} value={formState.groupSelectInstanceBodyText} onChange={handleTextChange("groupSelectInstanceBodyText")} disabled={isSubmitting} ref={setFieldRef("groupSelectInstanceBodyText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Botão" field="groupSelectInstanceButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupSelectInstanceButtonText} onChange={handleTextChange("groupSelectInstanceButtonText")} disabled={isSubmitting} ref={setFieldRef("groupSelectInstanceButtonText")} />
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex gap-2 mt-3">
          <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline-secondary" disabled={isSubmitting}
            onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
            Restaurar valores carregados
          </Button>
        </div>
      </Card.Body>
    </Card>
    )}

    {activeSection === "group_delete" && (
    <Card className="mb-4">
      <Card.Header>
        <Card.Title as="h2" className="h6 mb-0">Grupos (exclusão)</Card.Title>
      </Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={12}>
            <Form.Group>
              <LabelWithVars label="Mensagem de confirmação" field="groupDeletePromptBodyText" tokens={[...TOKENS.common]} />
              <Form.Control as="textarea" rows={2} value={formState.groupDeletePromptBodyText} onChange={handleTextChange("groupDeletePromptBodyText")} disabled={isSubmitting} ref={setFieldRef("groupDeletePromptBodyText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Texto do botão Confirmar" field="groupDeleteConfirmButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupDeleteConfirmButtonText} onChange={handleTextChange("groupDeleteConfirmButtonText")} disabled={isSubmitting} ref={setFieldRef("groupDeleteConfirmButtonText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Texto do botão Cancelar" field="groupDeleteCancelButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupDeleteCancelButtonText} onChange={handleTextChange("groupDeleteCancelButtonText")} disabled={isSubmitting} ref={setFieldRef("groupDeleteCancelButtonText")} />
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex gap-2 mt-3">
          <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline-secondary" disabled={isSubmitting}
            onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
            Restaurar valores carregados
          </Button>
        </div>
      </Card.Body>
    </Card>
    )}
    {activeSection === "group_flow" && (
    <Card>
      <Card.Header>
        <Card.Title as="h2" className="h6 mb-0">Fluxo de grupos</Card.Title>
      </Card.Header>
      <Card.Body>
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Título: instância conectada" field="instanceConnectedHeaderText" tokens={[...TOKENS.common, ...TOKENS.instance]} />
              <Form.Control type="text" value={formState.instanceConnectedHeaderText} onChange={handleTextChange("instanceConnectedHeaderText")} disabled={isSubmitting} ref={setFieldRef("instanceConnectedHeaderText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Botão: vincular grupo" field="instanceConnectedLinkGroupButtonText" tokens={[...TOKENS.common, ...TOKENS.instance]} />
              <Form.Control type="text" value={formState.instanceConnectedLinkGroupButtonText} onChange={handleTextChange("instanceConnectedLinkGroupButtonText")} disabled={isSubmitting} ref={setFieldRef("instanceConnectedLinkGroupButtonText")} />
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <LabelWithVars label="Mensagem: instância conectada" field="instanceConnectedBodyText" tokens={[...TOKENS.common, ...TOKENS.instance]} />
              <Form.Control as="textarea" rows={3} value={formState.instanceConnectedBodyText} onChange={handleTextChange("instanceConnectedBodyText")} disabled={isSubmitting} ref={setFieldRef("instanceConnectedBodyText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Botão: agora não" field="instanceConnectedLaterButtonText" tokens={[...TOKENS.common, ...TOKENS.instance]} />
              <Form.Control type="text" value={formState.instanceConnectedLaterButtonText} onChange={handleTextChange("instanceConnectedLaterButtonText")} disabled={isSubmitting} ref={setFieldRef("instanceConnectedLaterButtonText")} />
            </Form.Group>
          </Col>
        </Row>
        <hr />
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Título: cadastro de grupo" field="groupCreateHeaderText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupCreateHeaderText} onChange={handleTextChange("groupCreateHeaderText")} disabled={isSubmitting} ref={setFieldRef("groupCreateHeaderText")} />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <LabelWithVars label="Botão: cancelar" field="groupCreateCancelButtonText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupCreateCancelButtonText} onChange={handleTextChange("groupCreateCancelButtonText")} disabled={isSubmitting} ref={setFieldRef("groupCreateCancelButtonText")} />
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <LabelWithVars label="Mensagem: cadastro de grupo" field="groupCreateBodyText" tokens={[...TOKENS.common]} />
              <Form.Control as="textarea" rows={3} value={formState.groupCreateBodyText} onChange={handleTextChange("groupCreateBodyText")} disabled={isSubmitting} ref={setFieldRef("groupCreateBodyText")} />
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <LabelWithVars label="Rodapé (opcional)" field="groupCreateFooterText" tokens={[...TOKENS.common]} />
              <Form.Control type="text" value={formState.groupCreateFooterText} onChange={handleTextChange("groupCreateFooterText")} disabled={isSubmitting} ref={setFieldRef("groupCreateFooterText")} />
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex gap-2 mt-3">
          <Button onClick={(e) => void (handleSubmit(e as any))} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline-secondary" disabled={isSubmitting}
            onClick={() => { setFormState(toFormState(config)); setPreviewUrl(null); setCurrentImageUrl(config.menuImageUrl); setFeedback(null); }}>
            Restaurar valores carregados
          </Button>
        </div>
      </Card.Body>
    </Card>
    )}

    </main>
    </div>
    </div>

    <Modal show={!!tokensModal.field} onHide={closeTokens} centered>
      <Modal.Header closeButton>
        <Modal.Title>Inserir variável</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <ul className="list-unstyled d-flex flex-column gap-2 mb-0">
          {tokensModal.tokens.map((tok) => (
            <li key={tok} className="d-flex justify-content-between align-items-center gap-3 border rounded p-2">
              <div>
                <code className="me-2">{tok}</code>
                <small className="text-secondary">{(
                  {
                    "{{bot_name}}": "Nome do bot definido no painel.",
                    "{{user_first_name}}": "Primeiro nome do usuário logado.",
                    "{{user_name}}": "Nome completo do usuário logado.",
                    "{{user_number}}": "Número WhatsApp do usuário (se preenchido).",
                    "{{push_name}}": "Nome de perfil do WhatsApp (quando disponível).",
                    "{{plan_name}}": "Nome do plano atual.",
                    "{{plan_status}}": "Status do plano (Ativo/Expirado/Pendente).",
                    "{{plan_price}}": "Valor do plano (formatado).",
                    "{{plan_renews_at}}": "Data de vencimento do plano (formatada).",
                    "{{instance_name}}": "Nome da instância conectada (ou número).",
                  } as Record<string, string>
                )[tok] || "Variável"}</small>
              </div>
              <Button size="sm" variant="outline-primary" onClick={() => insertToken(tok)}>Inserir</Button>
            </li>
          ))}
        </ul>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={closeTokens}>Fechar</Button>
      </Modal.Footer>
    </Modal>
    <style jsx global>{`
      /* Container com largura moderada */
      .admin-bot-editor .container-narrow { max-width: 1100px; margin: 0 auto; }
      /* Grid principal: menu à esquerda, conteúdo à direita */
      .admin-bot-editor .editor-grid { display: grid; grid-template-columns: 240px 1fr; gap: 1rem; align-items: start; }
      @media (max-width: 991.98px) { .admin-bot-editor .editor-grid { grid-template-columns: 1fr; } }

      /* Campos do conteúdo em coluna única */
      .admin-bot-editor .content-col .row.g-4,
      .admin-bot-editor .content-col .row.g-3,
      .admin-bot-editor .content-col .row.g-2 { flex-direction: column; }
      .admin-bot-editor .content-col [class*="col-"] { max-width: 100% !important; flex: 0 0 100% !important; }

      /* Largura máxima dos controles para evitar campos gigantes */
      .admin-bot-editor .content-col .form-control,
      .admin-bot-editor .content-col .form-select,
      .admin-bot-editor .content-col textarea { max-width: 720px; }
      .admin-bot-editor .content-col textarea { min-height: 120px; }

      /* Botões do menu lateral ocupam toda a largura do card */
      .admin-bot-editor .nav-col .btn { width: 100%; text-align: left; }
    `}</style>
    </div>
  );
};

export default AdminBotMenuEditor;

// Additional sections appended below the main card to edit new templates
export const _AdminBotMenuEditorExtensions = () => null;
