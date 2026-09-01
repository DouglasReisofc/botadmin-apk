export type AdminBotInterageConfig = {
  enabled: boolean;
  baseUrl: string | null;
  hasToken: boolean;
  model: string;
  updatedAt: string | null;
};

export type BotInterageRuntimeConfig = {
  enabled: boolean;
  baseUrl: string | null;
  token: string | null;
  model: string;
};

export type AdminBotInterageAllowedUser = {
  userId: number;
  name: string;
  email: string | null;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
};

export type AdminBotInterageConfigPayload = {
  enabled?: unknown;
  baseUrl?: unknown;
  token?: unknown;
  clearToken?: unknown;
  model?: unknown;
};
