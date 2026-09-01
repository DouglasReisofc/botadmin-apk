export type AdminUserSummary = {
  id: number;
  name: string;
  email: string | null;
  role: "admin" | "user";
  isActive: boolean;
  balance: number;
  customPlanPrice: number | null;
  customAddonInstancePrice: number | null;
  customAddonGroupPrice: number | null;
  whatsappNumber: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  activeSessions: number;
  lastSessionAt: string | null;
  hasActiveSubscription?: boolean;
};

export type UserMetrics = {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  activeSessions: number;
};
