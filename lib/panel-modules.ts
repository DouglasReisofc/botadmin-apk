export const PANEL_MODULES = {
  user: ["raffles", "store", "affiliates", "flows", "api", "payments"],
  admin: ["affiliates", "campaigns", "mega", "botinterage", "payments"],
} as const;

export function validModulePreference(value: unknown): value is { scope: "user" | "admin"; module: string; enabled: boolean } {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (input.scope === "user" || input.scope === "admin") && typeof input.enabled === "boolean" &&
    typeof input.module === "string" && (PANEL_MODULES[input.scope] as readonly string[]).includes(input.module);
}
