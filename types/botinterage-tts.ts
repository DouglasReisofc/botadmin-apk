export type AdminBotInterageTtsConfig = {
  enabled: boolean;
  baseUrl: string | null;
  hasToken: boolean;
  defaultVoiceId: string | null;
  updatedAt: string | null;
};

export type BotInterageTtsRuntimeConfig = {
  enabled: boolean;
  baseUrl: string | null;
  token: string | null;
  defaultVoiceId: string | null;
};

export type AdminBotInterageTtsAllowedUser = {
  userId: number;
  name: string;
  email: string | null;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
};

export type AdminBotInterageTtsConfigPayload = {
  enabled?: unknown;
  baseUrl?: unknown;
  token?: unknown;
  clearToken?: unknown;
  defaultVoiceId?: unknown;
};
