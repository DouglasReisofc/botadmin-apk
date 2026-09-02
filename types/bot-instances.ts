export type BotInstanceStatus =
  | "desconectado"
  | "conectado"
  | "aguardando_qr"
  | "aguardando_pareamento"
  | "inicializando";

export type BotInstancePurpose = "profile" | "session" | "admin_system";

export type BotServer = {
  id: number;
  name: string;
  baseUrl: string;
  apiType: string;
  globalApiKey: string;
  sessionLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BotServerPayload = {
  name: string;
  baseUrl: string;
  apiType?: string;
  globalApiKey: string;
  sessionLimit?: number;
  isActive?: boolean;
};

export type BotInstance = {
  id: number;
  userId: number;
  serverId: number;
  serverName: string;
  serverBaseUrl: string;
  serverApiType: string;
  name: string;
  phone: string;
  token: string;
  remoteId: string | null;
  webhookUrl: string | null;
  events: string | null;
  autoRead: boolean;
  pvEnabled: boolean;
  licenseSalesEnabled: boolean;
  purpose: BotInstancePurpose;
  sessionStatus: BotInstanceStatus;
  desiredSessionState: "connected" | "disconnected";
  lastStatusSync: string | null;
  expiresAt: string | null;
  planId: number | null;
  profileId?: number | null;
  hasActiveSession?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BotInstanceProfile = {
  displayName: string;
  pushName: string | null;
  statusText: string | null;
  jid: string | null;
  avatarUrl: string | null;
  sessionStatus: BotInstanceStatus;
};

export type BotInstanceProfileUpdatePayload = {
  /** Nome interno exibido na lista de perfis do BotAdmin. */
  instanceName?: string;
  /** Número que será usado no próximo pareamento (somente dígitos). */
  phone?: string;
  displayName?: string;
  pushName?: string;
  statusText?: string;
  imageDataUrl?: string;
  removePhoto?: boolean;
};

export type BotInstanceAdminSummary = BotInstance & {
  userName: string;
  userEmail: string;
};

export type BotInstancePayload = {
  serverId: number;
  phone: string;
  name?: string;
};

export type BotInstanceRenamePayload = {
  name: string;
};

export type BotInstanceUpdatePayload = {
  name?: string;
  phone?: string;
  licenseSalesEnabled?: boolean;
  resetSession?: boolean;
};

export type BotInstanceAction = "connect" | "logout" | "restart";
