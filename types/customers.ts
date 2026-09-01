export type CustomerSummary = {
  id: number;
  userId: number;
  whatsappId: string;
  phoneNumber: string;
  displayName: string | null;
  profileName: string | null;
  notes: string | null;
  balance: number;
  isBlocked: boolean;
  lastInteraction: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerUpdateInput = {
  displayName: string | null;
  balance: number;
  isBlocked: boolean;
  notes: string | null;
};

export type CustomerInteractionPayload = {
  userId: number;
  whatsappId: string;
  phoneNumber: string;
  profileName: string | null;
  messageTimestamp?: number | null;
};

export type DebitCustomerBalanceResult = {
  success: boolean;
  balance: number;
  customer?: CustomerSummary;
  reason?: "not_found" | "blocked" | "insufficient" | "invalid_amount";
};

export type CreditCustomerBalanceResult = {
  success: boolean;
  balance: number;
  customer?: CustomerSummary;
  reason?: "invalid_amount" | "not_found";
};
