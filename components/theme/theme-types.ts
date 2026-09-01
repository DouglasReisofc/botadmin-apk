export type AppTheme = "dark" | "clean";

export const THEME_STORAGE_KEY = "botadmin-theme";

export const isAppTheme = (value: unknown): value is AppTheme =>
  value === "dark" || value === "clean";

export const DEFAULT_THEME: AppTheme = "dark";
