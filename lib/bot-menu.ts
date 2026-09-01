import { formatCurrency } from "./format";

export const globalTemplateTokens = [
  "{{nome_cliente}}",
  "{{numero_cliente}}",
  "{{saldo_cliente}}",
] as const;

export const categoryTemplateTokens = [
  "{{id_categoria}}",
  "{{nome_categoria}}",
  "{{preco_categoria}}",
  "{{descricao_categoria}}",
] as const;

export const defaultMenuVariables = globalTemplateTokens;

const DEFAULT_TEMPLATE_TOKENS = Array.from(
  new Set([
    ...globalTemplateTokens,
    ...categoryTemplateTokens,
  ]),
);

export const defaultMenuText = [
  "𝑩𝑶𝑻𝑨𝑫𝑴𝑰𝑵",
  "╭━━━ 乂 𝑰 𝑵 𝑭 𝑶 乂 ━━━╮",
  "┃ 👤 𝑪𝒍𝒊𝒆𝒏𝒕𝒆: {{nome_cliente}}",
  "┃ 📱 𝑵º: {{numero_cliente}}",
  "┃ 💰 𝑺𝒂𝒍𝒅𝒐: {{saldo_cliente}}",
  "╰━━━━━━━━━━━━━╯",
  "",
  "╭━━━ 乂 𝑩𝑶𝑻𝑨𝑫𝑴𝑰𝑵 乂 ━━━╮",
  "┃ 💜 𝑨𝒕𝒆𝒏𝒅𝒊𝒎𝒆𝒏𝒕𝒐 𝒓á𝒑𝒊𝒅𝒐 𝒆 𝒐𝒓𝒈𝒂𝒏𝒊𝒛𝒂𝒅𝒐.",
  "┃ 🛒 𝑬𝒔𝒄𝒐𝒍𝒉𝒂 𝒖𝒎𝒂 𝒐𝒑çã𝒐 𝒆 𝒄𝒐𝒏𝒕𝒊𝒏𝒖𝒆.",
  "╰━━━━━━━━━━━━━╯",
].join("\n");

export const defaultMenuFooterText = "💎 𝑻𝒐𝒒𝒖𝒆 𝒆𝒎 𝒖𝒎𝒂 𝒐𝒑çã𝒐 𝒑𝒂𝒓𝒂 𝒄𝒐𝒏𝒕𝒊𝒏𝒖𝒂𝒓.";

export const defaultMenuButtonLabels = {
  buy: "🛒 Comprar",
  addBalance: "💎 Saldo",
  support: "💬 Suporte",
  profile: "👤 Perfil",
} as const;

export const defaultCategoryListHeaderText = "Comprar contas";
export const defaultCategoryListBodyText =
  "Selecione a categoria que deseja comprar.";
export const defaultCategoryListFooterText =
  "Selecione a categoria desejada para continuar sua compra.";
export const defaultCategoryListFooterMoreText =
  "Role até o fim e toque em \"Próxima lista\" para visualizar mais opções.";
export const defaultCategoryListButtonText = "Ver categorias";
export const defaultCategoryListSectionTitle = "Categorias disponíveis";
export const defaultCategoryListNextTitle = "Próxima lista ▶️";
export const defaultCategoryListNextDescription =
  "Ver mais categorias";
export const defaultCategoryListEmptyText =
  "No momento não encontramos categorias ativas para compras. Aguarde novas ofertas ou fale com o suporte.";

export const defaultCategoryDetailBodyText =
  "{{nome_categoria}}\nValor: {{preco_categoria}}\n\n{{descricao_categoria}}";
export const defaultCategoryDetailFooterText =
  "Toque em Comprar para receber o produto escolhido.";
export const defaultCategoryDetailButtonText = "Comprar";
export const defaultCategoryDetailFileCaption = "{{nome_categoria}} - dados complementares";

export const defaultAddBalanceReplyText =
  "Para adicionar saldo, informe o valor desejado e aguarde o envio das instruções de pagamento por este canal.";
export const defaultSupportReplyText =
  "Nossa equipe de suporte foi acionada. Descreva sua necessidade para que possamos auxiliá-lo imediatamente.";

export const defaultProfileMenuBodyText = [
  "Gerencie seu atendimento pelo painel BotAdmin.",
  "",
  "Escolha uma das opções abaixo para revisar compras ou falar com o suporte.",
].join("\n");

export const defaultProfileMenuFooterText =
  "Use os botões para navegar entre suas compras ou solicitar suporte.";

export const defaultProfileMenuButtonLabels = {
  profile: "Meu perfil",
  purchases: "Minhas compras",
  support: "Suporte",
  back: "Voltar",
} as const;

export const defaultProfilePurchasesHeaderText = "Minhas compras";
export const defaultProfilePurchasesBodyText =
  "Listamos suas compras recentes deste número de WhatsApp. Toque para visualizar os detalhes entregues.";
export const defaultProfilePurchasesFooterText =
  "Selecione uma compra para receber novamente os dados.";
export const defaultProfilePurchasesEmptyText =
  "Ainda não encontramos compras vinculadas a este número. Assim que uma compra for concluída ela aparecerá aqui.";
export const defaultProfilePurchasesButtonText = "Ver compras";

export const defaultProfileSupportReasonBodyText =
  "Para agilizar o atendimento selecione o motivo principal do seu contato.";
export const defaultProfileSupportReasonFooterText =
  "Assim que escolher um motivo nossa equipe será notificada automaticamente.";
export const defaultProfileSupportReasonButtonLabels = {
  purchase: "Problemas com uma compra",
  payment: "Problemas com pagamento",
  other: "Outros assuntos",
} as const;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type BotTemplateContext = {
  contactName?: string | null;
  contactNumber?: string | null;
  contactBalance?: number | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryPrice?: number | null;
  categoryDescription?: string | null;
};

const resolveReplacement = (token: string, context: BotTemplateContext): string => {
  const normalized = token.trim().toLowerCase();

  switch (normalized) {
    case "{{nome_cliente}}": {
      const name = context.contactName?.toString().trim();
      return name && name.length > 0 ? name : "Cliente";
    }
    case "{{numero_cliente}}": {
      const number = context.contactNumber?.toString().trim();
      return number ?? "";
    }
    case "{{saldo_cliente}}": {
      const numericBalance = typeof context.contactBalance === "number"
        ? context.contactBalance
        : Number(context.contactBalance ?? 0);

      return formatCurrency(Number.isFinite(numericBalance) ? numericBalance : 0);
    }
    case "{{id_categoria}}":
      return context.categoryId?.toString().trim() ?? "";
    case "{{nome_categoria}}":
      return context.categoryName?.toString().trim() ?? "";
    case "{{preco_categoria}}": {
      const numericPrice = typeof context.categoryPrice === "number"
        ? context.categoryPrice
        : Number(context.categoryPrice ?? 0);
      return formatCurrency(Number.isFinite(numericPrice) ? numericPrice : 0);
    }
    case "{{descricao_categoria}}":
      return context.categoryDescription?.toString().trim() ?? "";
    default:
      return "";
  }
};

type RenderOptions = {
  allowEmpty?: boolean;
  trimResult?: boolean;
};

const renderTemplateValue = (
  template: string | null | undefined,
  fallback: string,
  context: BotTemplateContext,
  customTokens: readonly string[] | undefined,
  options?: RenderOptions,
): string => {
  const allowEmpty = options?.allowEmpty ?? false;
  const trimResult = options?.trimResult ?? true;

  const source = typeof template === "string"
    ? template
    : fallback;

  const shouldUseFallback =
    (typeof template !== "string" || (template.trim().length === 0 && !allowEmpty)) && fallback.trim().length > 0;

  const templateToRender = shouldUseFallback ? fallback : source;

  const tokens = Array.from(
    new Set([
      ...DEFAULT_TEMPLATE_TOKENS,
      ...(Array.isArray(customTokens) ? customTokens : []),
    ]
      .map((token) => token.trim())
      .filter((token) => token.length > 0)),
  );

  const rendered = tokens.reduce((currentText, token) => {
    const replacement = resolveReplacement(token, context);
    if (replacement === undefined) {
      return currentText;
    }

    const pattern = new RegExp(escapeRegExp(token), "gi");
    return currentText.replace(pattern, replacement);
  }, templateToRender);

  if (!trimResult) {
    return rendered;
  }

  const trimmed = rendered.trim();

  if (!trimmed && !allowEmpty) {
    return fallback.trim();
  }

  return trimmed;
};

export const renderMainMenuTemplate = (
  config: {
    menuText: string;
    menuFooterText: string | null;
    menuButtonBuyText: string;
    menuButtonAddBalanceText: string;
    menuButtonProfileText: string;
    imagePath: string | null;
    variables: string[];
  } | null,
  context: BotTemplateContext,
) => {
  const variables = config?.variables ?? [];

  const body = renderTemplateValue(
    config?.menuText,
    defaultMenuText,
    context,
    variables,
    { allowEmpty: false, trimResult: false },
  ).trim();

  const footerRaw = renderTemplateValue(
    config?.menuFooterText ?? null,
    defaultMenuFooterText,
    context,
    variables,
    { allowEmpty: true },
  );

  const footer = footerRaw.trim().length > 0 ? footerRaw.trim() : null;

  return {
    body,
    footer,
    buttons: {
      buy: config?.menuButtonBuyText?.trim() || defaultMenuButtonLabels.buy,
      addBalance: config?.menuButtonAddBalanceText?.trim() || defaultMenuButtonLabels.addBalance,
      profile: config?.menuButtonProfileText?.trim() || defaultMenuButtonLabels.profile,
    },
    imagePath: config?.imagePath ?? null,
  };
};

export const renderProfileMenuTemplate = (
  config: {
    profileMenuBodyText: string;
    profileMenuFooterText: string | null;
    profileButtonPurchasesText: string;
    profileButtonSupportText: string;
    profileButtonBackText: string;
    variables: string[];
  } | null,
  context: BotTemplateContext,
) => {
  const variables = config?.variables ?? [];

  const body = renderTemplateValue(
    config?.profileMenuBodyText,
    defaultProfileMenuBodyText,
    context,
    variables,
    { allowEmpty: false, trimResult: false },
  ).trim();

  const footerRaw = renderTemplateValue(
    config?.profileMenuFooterText ?? null,
    defaultProfileMenuFooterText,
    context,
    variables,
    { allowEmpty: true },
  );

  const footer = footerRaw.trim().length > 0 ? footerRaw.trim() : null;

  return {
    body,
    footer,
    buttons: {
      purchases: config?.profileButtonPurchasesText?.trim() || defaultProfileMenuButtonLabels.purchases,
      support: config?.profileButtonSupportText?.trim() || defaultProfileMenuButtonLabels.support,
      back: config?.profileButtonBackText?.trim() || defaultProfileMenuButtonLabels.back,
    },
  };
};

export const renderProfilePurchasesTemplate = (
  config: {
    profilePurchasesHeaderText: string;
    profilePurchasesBodyText: string;
    profilePurchasesFooterText: string;
    profilePurchasesButtonText: string;
    profilePurchasesEmptyText: string;
    variables: string[];
  } | null,
  context: BotTemplateContext,
) => {
  const variables = config?.variables ?? [];

  const header = renderTemplateValue(
    config?.profilePurchasesHeaderText,
    defaultProfilePurchasesHeaderText,
    context,
    variables,
    { allowEmpty: false },
  );

  const body = renderTemplateValue(
    config?.profilePurchasesBodyText,
    defaultProfilePurchasesBodyText,
    context,
    variables,
    { allowEmpty: false },
  );

  const footer = renderTemplateValue(
    config?.profilePurchasesFooterText,
    defaultProfilePurchasesFooterText,
    context,
    variables,
    { allowEmpty: true },
  );

  const button = renderTemplateValue(
    config?.profilePurchasesButtonText,
    defaultProfilePurchasesButtonText,
    context,
    variables,
    { allowEmpty: false },
  );

  const emptyText = renderTemplateValue(
    config?.profilePurchasesEmptyText,
    defaultProfilePurchasesEmptyText,
    context,
    variables,
    { allowEmpty: false },
  );

  return {
    header,
    body,
    footer: footer.trim().length > 0 ? footer.trim() : null,
    button,
    emptyText,
  };
};

export const renderProfileSupportReasonTemplate = (
  config: {
    profileSupportReasonBodyText: string;
    profileSupportReasonFooterText: string | null;
    profileSupportReasonPurchaseText: string;
    profileSupportReasonPaymentText: string;
    profileSupportReasonOtherText: string;
    variables: string[];
  } | null,
  context: BotTemplateContext,
) => {
  const variables = config?.variables ?? [];

  const body = renderTemplateValue(
    config?.profileSupportReasonBodyText,
    defaultProfileSupportReasonBodyText,
    context,
    variables,
    { allowEmpty: false, trimResult: false },
  ).trim();

  const footerRaw = renderTemplateValue(
    config?.profileSupportReasonFooterText ?? null,
    defaultProfileSupportReasonFooterText,
    context,
    variables,
    { allowEmpty: true },
  );

  const footer = footerRaw.trim().length > 0 ? footerRaw.trim() : null;

  return {
    body,
    footer,
    buttons: {
      purchase: config?.profileSupportReasonPurchaseText?.trim()
        || defaultProfileSupportReasonButtonLabels.purchase,
      payment: config?.profileSupportReasonPaymentText?.trim()
        || defaultProfileSupportReasonButtonLabels.payment,
      other: config?.profileSupportReasonOtherText?.trim()
        || defaultProfileSupportReasonButtonLabels.other,
    },
  };
};

export const renderCategoryListTemplate = (
  config: {
    categoryListHeaderText: string;
    categoryListBodyText: string;
    categoryListFooterText: string;
    categoryListFooterMoreText: string;
    categoryListButtonText: string;
    categoryListSectionTitle: string;
    categoryListNextTitle: string;
    categoryListNextDescription: string;
    categoryListEmptyText: string;
    variables: string[];
  } | null,
  context: BotTemplateContext,
) => {
  const variables = config?.variables ?? [];

  const header = renderTemplateValue(
    config?.categoryListHeaderText,
    defaultCategoryListHeaderText,
    context,
    variables,
    { allowEmpty: false },
  );

  const body = renderTemplateValue(
    config?.categoryListBodyText,
    defaultCategoryListBodyText,
    context,
    variables,
    { allowEmpty: false },
  );

  const footer = renderTemplateValue(
    config?.categoryListFooterText,
    defaultCategoryListFooterText,
    context,
    variables,
    { allowEmpty: true },
  );

  const footerMore = renderTemplateValue(
    config?.categoryListFooterMoreText,
    defaultCategoryListFooterMoreText,
    context,
    variables,
    { allowEmpty: true },
  );

  const button = renderTemplateValue(
    config?.categoryListButtonText,
    defaultCategoryListButtonText,
    context,
    variables,
    { allowEmpty: false },
  );

  const sectionTitle = renderTemplateValue(
    config?.categoryListSectionTitle,
    defaultCategoryListSectionTitle,
    context,
    variables,
    { allowEmpty: false },
  );

  const nextTitle = renderTemplateValue(
    config?.categoryListNextTitle,
    defaultCategoryListNextTitle,
    context,
    variables,
    { allowEmpty: false },
  );

  const nextDescription = renderTemplateValue(
    config?.categoryListNextDescription,
    defaultCategoryListNextDescription,
    context,
    variables,
    { allowEmpty: false },
  );

  const emptyText = renderTemplateValue(
    config?.categoryListEmptyText,
    defaultCategoryListEmptyText,
    context,
    variables,
    { allowEmpty: false },
  );

  return {
    header,
    body,
    footer: footer.trim().length > 0 ? footer.trim() : null,
    footerMore: footerMore.trim().length > 0 ? footerMore.trim() : null,
    button,
    sectionTitle,
    nextTitle,
    nextDescription,
    emptyText,
  };
};

export const renderCategoryDetailTemplate = (
  config: {
    categoryDetailBodyText: string;
    categoryDetailFooterText: string;
    categoryDetailButtonText: string;
    categoryDetailFileCaption: string | null;
    variables: string[];
  } | null,
  context: BotTemplateContext,
) => {
  const variables = config?.variables ?? [];

  const body = renderTemplateValue(
    config?.categoryDetailBodyText,
    defaultCategoryDetailBodyText,
    context,
    variables,
    { allowEmpty: false },
  );

  const footer = renderTemplateValue(
    config?.categoryDetailFooterText,
    defaultCategoryDetailFooterText,
    context,
    variables,
    { allowEmpty: true },
  );

  const button = renderTemplateValue(
    config?.categoryDetailButtonText,
    defaultCategoryDetailButtonText,
    context,
    variables,
    { allowEmpty: false },
  );

  const captionRaw = renderTemplateValue(
    config?.categoryDetailFileCaption ?? null,
    defaultCategoryDetailFileCaption,
    context,
    variables,
    { allowEmpty: true, trimResult: false },
  );

  const caption = captionRaw.trim().length > 0 ? captionRaw.trim() : null;

  return {
    body,
    footer: footer.trim().length > 0 ? footer.trim() : null,
    button,
    fileCaption: caption,
  };
};

export const renderNoCategoryMessage = (
  config: { categoryListEmptyText: string; variables: string[] } | null,
  context: BotTemplateContext,
) => renderTemplateValue(
  config?.categoryListEmptyText,
  defaultCategoryListEmptyText,
  context,
  config?.variables,
  { allowEmpty: false },
);

export const renderAddBalanceReply = (
  config: { addBalanceReplyText: string; variables: string[] } | null,
  context: BotTemplateContext,
) => renderTemplateValue(
  config?.addBalanceReplyText,
  defaultAddBalanceReplyText,
  context,
  config?.variables,
  { allowEmpty: false },
);

export const renderSupportReply = (
  config: { supportReplyText: string; variables: string[] } | null,
  context: BotTemplateContext,
) => renderTemplateValue(
  config?.supportReplyText,
  defaultSupportReplyText,
  context,
  config?.variables,
  { allowEmpty: false },
);
