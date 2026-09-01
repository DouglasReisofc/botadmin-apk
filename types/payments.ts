export type MercadoPagoCheckoutPaymentType =
  | "credit_card"
  | "debit_card"
  | "ticket"
  | "bank_transfer"
  | "atm"
  | "account_money";

export type MercadoPagoCheckoutPaymentMethod = "pix";

export type PaymentMethodProvider =
  | "mercadopago_pix"
  | "mercadopago_checkout"
  | "polopag_pix"
  | "bot_resale_payout";

export type BotResalePayoutMode = "automatic" | "manual";

export type BotResaleMercadoPagoAccountSnapshot = {
  id: number | null;
  nickname: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  countryId: string | null;
  siteId: string | null;
  validatedAt: string | null;
};

export type BotResalePayoutConfig = {
  mode: BotResalePayoutMode;
  isActive: boolean;
  isConfigured: boolean;
  /** Somente uso interno no servidor; não expor ao cliente. */
  accessToken?: string | null;
  hasAccessToken: boolean;
  pixKey: string | null;
  recipientFullName: string | null;
  mercadoPagoAccount: BotResaleMercadoPagoAccountSnapshot | null;
  updatedAt: string | null;
};

export type PaymentMethodSummary = {
  provider: PaymentMethodProvider;
  displayName: string;
  isActive: boolean;
  isConfigured: boolean;
};

export type PaymentConfirmationMessageConfig = {
  messageText: string;
  buttonLabel: string;
  mediaPath: string | null;
  mediaUrl: string | null;
  updatedAt: string | null;
};

export type MercadoPagoPixConfig = {
  isActive: boolean;
  displayName: string;
  accessToken: string;
  publicKey: string | null;
  pixKey: string | null;
  notificationUrl: string | null;
  pixExpirationMinutes: number;
  amountOptions: number[];
  instructions: string | null;
  isConfigured: boolean;
  updatedAt: string | null;
};

export type MercadoPagoCheckoutConfig = {
  isActive: boolean;
  displayName: string;
  accessToken: string;
  publicKey: string | null;
  notificationUrl: string | null;
  amountOptions: number[];
  allowedPaymentTypes: MercadoPagoCheckoutPaymentType[];
  allowedPaymentMethods: MercadoPagoCheckoutPaymentMethod[];
  isConfigured: boolean;
  /** Credenciais do aplicativo Marketplace (nunca expor o secret ao painel). */
  marketplaceClientId?: string;
  marketplaceClientSecret?: string;
  updatedAt: string | null;
};

export type PoloPagPixConfig = {
  isActive: boolean;
  displayName: string;
  apiKey: string;
  pixExpirationMinutes: number;
  amountOptions: number[];
  instructions: string | null;
  webhookUrl: string | null;
  isConfigured: boolean;
  updatedAt: string | null;
};

export type PaymentCharge = {
  id: number;
  publicId: string;
  userId: number;
  provider: string;
  providerPaymentId: string;
  status: string;
  amount: number;
  currency: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
  customerWhatsapp: string | null;
  customerName: string | null;
  metadata: PaymentChargeMetadata | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentChargeMetadata = {
  adminNote?: string;
  /**
   * Quando verdadeiro, evita que o webhook credite automaticamente o saldo do cliente.
   */
  skipBalanceCredit?: boolean;
  /**
   * Objeto arbitrário que descreve o contexto em que a cobrança foi criada.
   */
  context?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type MercadoPagoPixCharge = PaymentCharge & {
  provider: "mercadopago_pix";
};

export type MercadoPagoCheckoutCharge = PaymentCharge & {
  provider: "mercadopago_checkout";
};

export type PoloPagPixCharge = PaymentCharge & {
  provider: "polopag_pix";
};
