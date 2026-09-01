export type MegaCredentials = {
  email: string | null;
  hasPassword: boolean;
  updatedAt: string | null;
  externalAccountsEnabled: boolean;
  externalAccountsUrl: string | null;
  hasSession: boolean;
  sessionEmail: string | null;
  sessionUpdatedAt: string | null;
};

export type MegaCredentialsPayload = {
  email?: string | null;
  password?: string | null;
  clearPassword?: boolean;
  externalAccountsEnabled?: boolean;
  externalAccountsUrl?: string | null;
  resetSession?: boolean;
};

export type MegaCredentialSecret = {
  email: string | null;
  password: string | null;
  externalAccountsEnabled: boolean;
  externalAccountsUrl: string | null;
  sessionEmail: string | null;
  sessionPayload: string | null;
  sessionUpdatedAt: string | null;
};
