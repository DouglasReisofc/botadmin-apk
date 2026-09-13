import type { RowDataPacket } from "mysql2";

import { getDb } from "lib/db";
import { getUserPlanStatus } from "lib/plans";
import {
  getPanelModule,
  getPanelModules,
  type PanelModuleAvailability,
  type PanelModuleDefinition,
  type PanelModuleScope,
} from "lib/panel-modules";

type ModulePreferenceRow = RowDataPacket & {
  module_key: string;
  enabled: number;
  menu_order?: number | null;
  pinned?: number | null;
};

export type ResolvedPanelModule = PanelModuleDefinition & {
  enabled: boolean;
  pinned: boolean;
  order: number;
  availability: PanelModuleAvailability;
  canEnable: boolean;
  reason: string | null;
};

let ensurePromise: Promise<void> | null = null;

export const ensurePanelModuleTables = async (): Promise<void> => {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const db = getDb();
    await db.query(`CREATE TABLE IF NOT EXISTS user_panel_modules (
      user_id BIGINT NOT NULL,
      panel_scope VARCHAR(16) NOT NULL,
      module_key VARCHAR(40) NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      menu_order INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, panel_scope, module_key)
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS panel_module_audit_logs (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actor_user_id BIGINT NOT NULL,
      target_user_id BIGINT NOT NULL,
      panel_scope VARCHAR(16) NOT NULL,
      module_key VARCHAR(40) NOT NULL,
      action VARCHAR(40) NOT NULL,
      previous_value TEXT NULL,
      next_value TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    for (const statement of [
      "ALTER TABLE user_panel_modules ADD COLUMN menu_order INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE user_panel_modules ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE user_panel_modules ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    ]) {
      try {
        await db.query(statement);
      } catch (error) {
        const code = String((error as { code?: unknown })?.code || "");
        const message = String((error as { message?: unknown })?.message || "");
        if (!/duplicate|already exists|42701/i.test(`${code} ${message}`)) throw error;
      }
    }
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
};

const featureEnabled = (
  feature: string | undefined,
  plan: Awaited<ReturnType<typeof getUserPlanStatus>>,
): boolean => {
  if (!feature) return true;
  if (!plan.plan || plan.status !== "active") return false;
  if (feature === "allow_flows") {
    return Boolean(plan.plan.allowFlows || plan.plan.features.fluxos);
  }
  return Boolean(plan.plan.features[feature]);
};

const availabilityFor = (
  definition: PanelModuleDefinition,
  enabledIds: Set<string>,
  plan: Awaited<ReturnType<typeof getUserPlanStatus>> | null,
  isAdmin: boolean,
): Pick<ResolvedPanelModule, "availability" | "canEnable" | "reason"> => {
  if (definition.lifecycle === "maintenance") {
    return { availability: "maintenance", canEnable: false, reason: "Módulo temporariamente em manutenção." };
  }
  if (definition.lifecycle === "coming_soon") {
    return { availability: "coming_soon", canEnable: false, reason: "Este módulo estará disponível em breve." };
  }
  const missing = definition.dependencies.filter((dependency) => !enabledIds.has(dependency));
  if (missing.length) {
    return { availability: "dependency_locked", canEnable: false, reason: `Ative primeiro: ${missing.join(", ")}.` };
  }
  if (!isAdmin && definition.requiresFeature && (!plan || !featureEnabled(definition.requiresFeature, plan))) {
    return { availability: "plan_locked", canEnable: false, reason: "Este recurso não está incluído no plano atual." };
  }
  return { availability: "available", canEnable: true, reason: null };
};

export const resolvePanelModules = async (options: {
  userId: number;
  scope: PanelModuleScope;
  isAdmin: boolean;
}): Promise<ResolvedPanelModule[]> => {
  await ensurePanelModuleTables();
  const db = getDb();
  const [rows] = await db.query<ModulePreferenceRow[]>(
    `SELECT module_key, enabled, menu_order, pinned
       FROM user_panel_modules
      WHERE user_id = ? AND panel_scope = ?`,
    [options.userId, options.scope],
  );
  const preferences = new Map(rows.map((row) => [String(row.module_key), row]));
  const definitions = getPanelModules(options.scope);
  const enabledIds = new Set(
    definitions
      .filter((definition) => {
        const preference = preferences.get(definition.id);
        return preference ? Number(preference.enabled) === 1 : definition.defaultEnabled;
      })
      .map((definition) => definition.id),
  );
  const plan = options.scope === "user" && !options.isAdmin
    ? await getUserPlanStatus(options.userId)
    : null;

  return definitions
    .map((definition, index) => {
      const preference = preferences.get(definition.id);
      const access = availabilityFor(definition, enabledIds, plan, options.isAdmin);
      const preferredEnabled = preference
        ? Number(preference.enabled) === 1
        : definition.defaultEnabled;
      return {
        ...definition,
        enabled: preferredEnabled && access.availability === "available",
        pinned: Number(preference?.pinned || 0) === 1,
        order: Number(preference?.menu_order ?? index),
        ...access,
      };
    })
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.order - right.order || left.title.localeCompare(right.title, "pt-BR"));
};

export const savePanelModulePreference = async (options: {
  userId: number;
  actorUserId: number;
  scope: PanelModuleScope;
  moduleId: string;
  enabled: boolean;
  isAdmin: boolean;
}): Promise<ResolvedPanelModule[]> => {
  const definition = getPanelModule(options.scope, options.moduleId);
  if (!definition) throw new Error("Módulo inválido.");
  const current = await resolvePanelModules({ userId: options.userId, scope: options.scope, isAdmin: options.isAdmin });
  const moduleState = current.find((item) => item.id === options.moduleId);
  if (options.enabled && (!moduleState || !moduleState.canEnable)) {
    const error = new Error(moduleState?.reason || "Este módulo não pode ser ativado.") as Error & { status?: number };
    error.status = moduleState?.availability === "plan_locked" ? 402 : 409;
    throw error;
  }
  const db = getDb();
  const previous = moduleState?.enabled || false;
  await db.query(
    `INSERT INTO user_panel_modules (user_id, panel_scope, module_key, enabled, menu_order, pinned)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = CURRENT_TIMESTAMP`,
    [options.userId, options.scope, options.moduleId, options.enabled ? 1 : 0, moduleState?.order || 0, moduleState?.pinned ? 1 : 0],
  );
  await db.query(
    `INSERT INTO panel_module_audit_logs
      (actor_user_id, target_user_id, panel_scope, module_key, action, previous_value, next_value)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [options.actorUserId, options.userId, options.scope, options.moduleId, options.enabled ? "module.enabled" : "module.disabled", JSON.stringify({ enabled: previous }), JSON.stringify({ enabled: options.enabled })],
  );
  return resolvePanelModules({ userId: options.userId, scope: options.scope, isAdmin: options.isAdmin });
};

export const savePanelModuleLayout = async (options: {
  userId: number;
  actorUserId: number;
  scope: PanelModuleScope;
  moduleId: string;
  pinned?: boolean;
  order?: number;
  isAdmin: boolean;
}): Promise<ResolvedPanelModule[]> => {
  const current = await resolvePanelModules({ userId: options.userId, scope: options.scope, isAdmin: options.isAdmin });
  const moduleState = current.find((item) => item.id === options.moduleId);
  if (!moduleState) throw new Error("Módulo inválido.");
  const nextPinned = options.pinned === undefined ? moduleState.pinned : options.pinned;
  const nextOrder = options.order === undefined ? moduleState.order : Math.max(0, Math.min(999, Math.floor(options.order)));
  const db = getDb();
  await db.query(
    `INSERT INTO user_panel_modules (user_id, panel_scope, module_key, enabled, menu_order, pinned)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE menu_order = VALUES(menu_order), pinned = VALUES(pinned), updated_at = CURRENT_TIMESTAMP`,
    [options.userId, options.scope, options.moduleId, moduleState.enabled ? 1 : 0, nextOrder, nextPinned ? 1 : 0],
  );
  await db.query(
    `INSERT INTO panel_module_audit_logs
      (actor_user_id, target_user_id, panel_scope, module_key, action, previous_value, next_value)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [options.actorUserId, options.userId, options.scope, options.moduleId, "module.layout", JSON.stringify({ pinned: moduleState.pinned, order: moduleState.order }), JSON.stringify({ pinned: nextPinned, order: nextOrder })],
  );
  return resolvePanelModules({ userId: options.userId, scope: options.scope, isAdmin: options.isAdmin });
};

export const assertPanelModuleAccess = async (options: {
  userId: number;
  scope: PanelModuleScope;
  moduleId: string;
  isAdmin: boolean;
}): Promise<ResolvedPanelModule> => {
  const modules = await resolvePanelModules(options);
  const item = modules.find((candidate) => candidate.id === options.moduleId);
  if (!item || !item.canEnable) {
    const error = new Error(item?.reason || "Módulo indisponível.") as Error & { status?: number };
    error.status = item?.availability === "plan_locked" ? 402 : 403;
    throw error;
  }
  return item;
};
