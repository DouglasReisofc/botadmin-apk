import type { RowDataPacket } from "mysql2";

import { getDb } from "lib/db";
import { getPanelModule, getPanelModules, type PanelModuleLifecycle } from "lib/panel-modules";

export type GlobalPanelModuleState = {
  id: string;
  globalEnabled: boolean;
  lifecycle: PanelModuleLifecycle;
  rolloutPercent: number;
  updatedAt: string | null;
};

type GlobalRow = RowDataPacket & {
  module_key: string;
  enabled: number;
  lifecycle: PanelModuleLifecycle;
  rollout_percent: number;
  updated_at?: Date | string | null;
};

let schemaPromise: Promise<void> | null = null;

export const ensurePanelModuleGovernanceTable = async (): Promise<void> => {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const db = getDb();
    await db.query(`CREATE TABLE IF NOT EXISTS panel_module_catalog (
      module_key VARCHAR(40) NOT NULL PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      lifecycle VARCHAR(24) NOT NULL DEFAULT 'active',
      rollout_percent INTEGER NOT NULL DEFAULT 100,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    for (const definition of getPanelModules("user")) {
      await db.query(
        `INSERT INTO panel_module_catalog (module_key, enabled, lifecycle, rollout_percent)
         VALUES (?, 1, ?, 100)
         ON DUPLICATE KEY UPDATE module_key = VALUES(module_key)`,
        [definition.id, definition.lifecycle],
      );
    }
    for (const definition of getPanelModules("admin")) {
      await db.query(
        `INSERT INTO panel_module_catalog (module_key, enabled, lifecycle, rollout_percent)
         VALUES (?, 1, ?, 100)
         ON DUPLICATE KEY UPDATE module_key = VALUES(module_key)`,
        [definition.id, definition.lifecycle],
      );
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
};

const normalizeDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const getGlobalPanelModuleStates = async (): Promise<GlobalPanelModuleState[]> => {
  await ensurePanelModuleGovernanceTable();
  const db = getDb();
  const [rows] = await db.query<GlobalRow[]>("SELECT module_key, enabled, lifecycle, rollout_percent, updated_at FROM panel_module_catalog");
  const map = new Map(rows.map((row) => [String(row.module_key), row]));
  return [...new Map([...getPanelModules("user"), ...getPanelModules("admin")].map((item) => [item.id, item])).values()].map((definition) => {
    const row = map.get(definition.id);
    return {
      id: definition.id,
      globalEnabled: row ? Number(row.enabled) === 1 : true,
      lifecycle: row?.lifecycle || definition.lifecycle,
      rolloutPercent: Math.max(0, Math.min(100, Number(row?.rollout_percent ?? 100))),
      updatedAt: normalizeDate(row?.updated_at),
    };
  });
};

export const getGlobalPanelModuleState = async (moduleId: string): Promise<GlobalPanelModuleState | null> => {
  const definition = getPanelModule("user", moduleId) || getPanelModule("admin", moduleId);
  if (!definition) return null;
  const states = await getGlobalPanelModuleStates();
  return states.find((item) => item.id === moduleId) || null;
};

export const saveGlobalPanelModuleState = async (options: {
  actorUserId: number;
  moduleId: string;
  enabled?: boolean;
  lifecycle?: PanelModuleLifecycle;
  rolloutPercent?: number;
}): Promise<GlobalPanelModuleState> => {
  const definition = getPanelModule("user", options.moduleId) || getPanelModule("admin", options.moduleId);
  if (!definition) throw new Error("Módulo inválido.");
  const current = await getGlobalPanelModuleState(options.moduleId);
  const lifecycle = options.lifecycle || current?.lifecycle || definition.lifecycle;
  if (!["active", "beta", "maintenance", "coming_soon"].includes(lifecycle)) throw new Error("Ciclo de vida inválido.");
  const enabled = options.enabled ?? current?.globalEnabled ?? true;
  const rolloutPercent = Math.max(0, Math.min(100, Math.floor(options.rolloutPercent ?? current?.rolloutPercent ?? 100)));
  await getDb().query(
    `INSERT INTO panel_module_catalog (module_key, enabled, lifecycle, rollout_percent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), lifecycle = VALUES(lifecycle), rollout_percent = VALUES(rollout_percent), updated_at = CURRENT_TIMESTAMP`,
    [options.moduleId, enabled ? 1 : 0, lifecycle, rolloutPercent],
  );
  const next = (await getGlobalPanelModuleState(options.moduleId))!;
  await getDb().query(
    `INSERT INTO panel_module_audit_logs
      (actor_user_id, target_user_id, panel_scope, module_key, action, previous_value, next_value)
     VALUES (?, ?, 'admin', ?, 'module.global_updated', ?, ?)`,
    [
      options.actorUserId,
      options.actorUserId,
      options.moduleId,
      JSON.stringify(current),
      JSON.stringify(next),
    ],
  );
  return next;
};
