#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const mysql = require("mysql2/promise");

const ARTIFACT_DIR = path.join(process.cwd(), "storage", "db-migrations");
const DEFAULT_GROUP_LICENSE_PRICE = 25;
const DEFAULT_INSTANCE_ADDON_PRICE = 25;

const CORE_TABLES = new Set([
  "users",
  "sessions",
  "subscription_plans",
  "user_plan_subscriptions",
  "user_plan_addons",
  "user_plan_payments",
  "bot_servers",
  "bot_instances",
  "bot_instance_settings",
  "bot_groups",
  "bot_group_settings",
]);

const RESERVED_COLUMNS = new Set([
  "id",
  "user_id",
  "instance_id",
  "group_id",
  "subscription_id",
  "plan_id",
  "server_id",
  "created_at",
  "updated_at",
  "metadata",
  "status",
]);

const loadEnv = (file = ".env") => {
  const fullPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

const parseArgs = (argv) => {
  const flags = {
    audit: false,
    plan: false,
    applyPlanNormalization: false,
    applyBasePlanDefaults: false,
    applyCleanup: false,
    migrateGroupAddons: true,
    createMissingSubscriptions: true,
    includeIdleInstanceUsers: false,
    days: 30,
    dropWhitelist: new Set(),
  };

  for (const arg of argv) {
    if (arg === "--audit") flags.audit = true;
    else if (arg === "--plan") flags.plan = true;
    else if (arg === "--apply-plan-normalization") flags.applyPlanNormalization = true;
    else if (arg === "--apply-base-plan-defaults") flags.applyBasePlanDefaults = true;
    else if (arg === "--apply-cleanup") flags.applyCleanup = true;
    else if (arg === "--no-migrate-group-addons") flags.migrateGroupAddons = false;
    else if (arg === "--no-create-missing-subscriptions") flags.createMissingSubscriptions = false;
    else if (arg === "--include-idle-instance-users") flags.includeIdleInstanceUsers = true;
    else if (arg.startsWith("--days=")) flags.days = toInt(arg.slice("--days=".length), 30);
    else if (arg.startsWith("--drop=")) {
      for (const item of arg.slice("--drop=".length).split(",")) {
        const table = item.trim();
        if (table) flags.dropWhitelist.add(table);
      }
    }
  }

  const envWhitelist = String(process.env.BOTADMIN_DROP_WHITELIST || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const table of envWhitelist) {
    flags.dropWhitelist.add(table);
  }

  if (
    !flags.audit &&
    !flags.plan &&
    !flags.applyPlanNormalization &&
    !flags.applyBasePlanDefaults &&
    !flags.applyCleanup
  ) {
    flags.audit = true;
    flags.plan = true;
  }

  flags.days = Math.max(1, flags.days);
  return flags;
};

const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
};

const toMoney = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(parsed * 100) / 100;
};

const quoteIdentifier = (name) => {
  if (!/^[A-Za-z0-9_]+$/.test(String(name))) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `\`${name}\``;
};

const formatSqlString = (value) => {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
};

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const connect = async () =>
  mysql.createConnection({
    host: process.env.DATABASE_HOST || "localhost",
    port: toInt(process.env.DATABASE_PORT, 3306),
    user: process.env.DATABASE_USER || "root",
    password: process.env.DATABASE_PASSWORD || "",
    database: process.env.DATABASE_NAME || "dashboard",
    timezone: "Z",
    multipleStatements: false,
  });

const fetchSchemaInventory = async (db) => {
  const [tables] = await db.query(
    `
      SELECT
        TABLE_NAME AS tableName,
        ENGINE AS engine,
        TABLE_ROWS AS estimatedRows,
        CREATE_TIME AS createTime,
        UPDATE_TIME AS updateTime
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `,
  );

  const [columns] = await db.query(
    `
      SELECT
        TABLE_NAME AS tableName,
        COLUMN_NAME AS columnName,
        COLUMN_TYPE AS columnType,
        IS_NULLABLE AS isNullable,
        COLUMN_DEFAULT AS columnDefault,
        COLUMN_KEY AS columnKey,
        EXTRA AS extra
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `,
  );

  const rowCounts = {};
  for (const table of tables) {
    try {
      const quoted = quoteIdentifier(table.tableName);
      const [[row]] = await db.query(`SELECT COUNT(*) AS countValue FROM ${quoted}`);
      rowCounts[table.tableName] = toInt(row.countValue);
    } catch (error) {
      rowCounts[table.tableName] = null;
    }
  }

  const columnsByTable = {};
  for (const column of columns) {
    if (!columnsByTable[column.tableName]) {
      columnsByTable[column.tableName] = [];
    }
    columnsByTable[column.tableName].push(column);
  }

  return { tables, columnsByTable, rowCounts };
};

const collectRepositoryFiles = () => {
  try {
    const output = childProcess.execFileSync(
      "rg",
      [
        "--files",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!.next/**",
        "--glob",
        "!dist/**",
        "--glob",
        "!storage/db-migrations/**",
        "--glob",
        "!storage/*.sql",
        "--glob",
        "!public/uploads/**",
      ],
      { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );

    return output
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => /\.(ts|tsx|js|jsx|json|sql|md)$/.test(item));
  } catch {
    return [];
  }
};

const collectReferenceSummary = (names) => {
  const files = collectRepositoryFiles();
  const summary = {};
  for (const name of names) {
    summary[name] = { fileCount: 0, files: [] };
  }

  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    } catch {
      continue;
    }

    for (const name of names) {
      if (content.includes(name)) {
        summary[name].fileCount += 1;
        if (summary[name].files.length < 20) {
          summary[name].files.push(file);
        }
      }
    }
  }

  return summary;
};

const buildCleanupCandidates = (inventory, tableReferences, columnReferences) => {
  const tables = inventory.tables.map((table) => {
    const rowCount = inventory.rowCounts[table.tableName];
    const refs = tableReferences[table.tableName] || { fileCount: 0, files: [] };
    const isCore = CORE_TABLES.has(table.tableName);
    const canReview =
      !isCore &&
      refs.fileCount === 0 &&
      (rowCount === 0 || rowCount === null);

    return {
      table: table.tableName,
      rows: rowCount,
      codeReferenceFiles: refs.fileCount,
      sampleReferences: refs.files,
      coreTable: isCore,
      recommendedAction: canReview ? "review" : "keep",
      reason: isCore
        ? "core table"
        : refs.fileCount === 0
          ? "not referenced by repository scan"
          : "referenced by repository scan",
    };
  });

  const columns = [];
  for (const [table, tableColumns] of Object.entries(inventory.columnsByTable)) {
    for (const column of tableColumns) {
      if (
        RESERVED_COLUMNS.has(column.columnName) ||
        String(column.columnKey || "").includes("PRI")
      ) {
        continue;
      }

      const refs = columnReferences[column.columnName] || { fileCount: 0, files: [] };
      if (refs.fileCount === 0) {
        columns.push({
          table,
          column: column.columnName,
          type: column.columnType,
          nullable: column.isNullable,
          codeReferenceFiles: refs.fileCount,
          recommendedAction: "review",
          reason: "column name not referenced by repository scan",
        });
      }
    }
  }

  return { tables, columns };
};

const fetchUsageByUser = async (db, days) => {
  const [rows] = await db.query(
    `
      SELECT
        u.id AS user_id,
        LEFT(COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), CONCAT('user#', u.id)), 120) AS label,
        ups.id AS subscription_id,
        ups.status AS subscription_status,
        ups.current_period_start,
        ups.current_period_end,
        ups.metadata AS subscription_metadata,
        p.id AS plan_id,
        p.name AS plan_name,
        COALESCE(p.price, 0) AS plan_price,
        COALESCE(p.group_limit, 0) AS plan_groups,
        COALESCE(p.instance_limit, 0) AS plan_instances,
        COALESCE(p.duration_days, 30) AS duration_days,
        COALESCE(i.total_instances, 0) AS total_instances,
        COALESCE(i.connected_instances, 0) AS connected_instances,
        COALESCE(g.total_groups, 0) AS total_groups,
        COALESCE(g.active_groups, 0) AS active_groups,
        COALESCE(g.disabled_groups, 0) AS disabled_groups,
        COALESCE(g.recent_groups, 0) AS recent_groups,
        COALESCE(a.group_addons, 0) AS group_addons,
        COALESCE(a.instance_addons, 0) AS instance_addons,
        COALESCE(p.group_limit, 0) + COALESCE(a.group_addons, 0) AS effective_groups,
        COALESCE(p.instance_limit, 0) + COALESCE(a.instance_addons, 0) AS effective_instances
      FROM users u
      LEFT JOIN user_plan_subscriptions ups ON ups.user_id = u.id
      LEFT JOIN subscription_plans p ON p.id = ups.plan_id
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*) AS total_instances,
          SUM(session_status IN ('connected', 'conectado', 'open', 'online', 'logged_in')) AS connected_instances
        FROM bot_instances
        GROUP BY user_id
      ) i ON i.user_id = u.id
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*) AS total_groups,
          SUM(status = 'active') AS active_groups,
          SUM(status = 'disabled') AS disabled_groups,
          SUM(updated_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)) AS recent_groups
        FROM bot_groups
        GROUP BY user_id
      ) g ON g.user_id = u.id
      LEFT JOIN (
        SELECT
          user_id,
          SUM(CASE WHEN addon_type = 'group' AND (expires_at IS NULL OR expires_at >= UTC_TIMESTAMP()) THEN quantity ELSE 0 END) AS group_addons,
          SUM(CASE WHEN addon_type = 'instance' AND (expires_at IS NULL OR expires_at >= UTC_TIMESTAMP()) THEN quantity ELSE 0 END) AS instance_addons
        FROM user_plan_addons
        GROUP BY user_id
      ) a ON a.user_id = u.id
      WHERE
        COALESCE(i.total_instances, 0) > 0
        OR COALESCE(g.total_groups, 0) > 0
        OR ups.id IS NOT NULL
      ORDER BY active_groups DESC, connected_instances DESC, total_instances DESC, u.id ASC
    `,
    [days],
  );

  return rows.map((row) => {
    const planGroups = toInt(row.plan_groups);
    const planInstances = toInt(row.plan_instances);
    const groupAddons = toInt(row.group_addons);
    const instanceAddons = toInt(row.instance_addons);
    const activeGroups = toInt(row.active_groups);
    const connectedInstances = toInt(row.connected_instances);
    const totalInstances = toInt(row.total_instances);
    const hasSubscription = row.subscription_id !== null && row.subscription_id !== undefined;
    const isUsingNow = activeGroups > 0 || connectedInstances > 0;
    const relevantForNormalization = isUsingNow || hasSubscription;
    const requiredGroups = Math.max(1, activeGroups);
    const requiredInstances = Math.max(
      1,
      activeGroups > 0 || hasSubscription ? totalInstances : connectedInstances,
    );

    return {
      ...row,
      plan_price: toMoney(row.plan_price),
      plan_groups: planGroups,
      plan_instances: planInstances,
      group_addons: groupAddons,
      instance_addons: instanceAddons,
      effective_groups: planGroups + groupAddons,
      effective_instances: planInstances + instanceAddons,
      total_instances: totalInstances,
      connected_instances: connectedInstances,
      total_groups: toInt(row.total_groups),
      active_groups: activeGroups,
      disabled_groups: toInt(row.disabled_groups),
      recent_groups: toInt(row.recent_groups),
      duration_days: Math.max(1, toInt(row.duration_days, 30)),
      has_subscription: hasSubscription,
      is_using_now: isUsingNow,
      relevant_for_normalization: relevantForNormalization,
      required_groups: requiredGroups,
      required_instances: requiredInstances,
    };
  });
};

const parseJsonObject = (value) => {
  if (!value || typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const buildNormalizationPlan = (usageRows, flags) => {
  const groupUnit = toMoney(
    process.env.BOTADMIN_GROUP_LICENSE_PRICE,
    DEFAULT_GROUP_LICENSE_PRICE,
  );
  const instanceUnit = toMoney(
    process.env.BOTADMIN_INSTANCE_ADDON_PRICE,
    DEFAULT_INSTANCE_ADDON_PRICE,
  );
  const planByKey = new Map();
  const userActions = [];

  for (const row of usageRows) {
    if (!row.relevant_for_normalization) {
      continue;
    }

    if (!flags.includeIdleInstanceUsers && !row.is_using_now && !row.has_subscription) {
      continue;
    }

    const legacyGroupContract = flags.migrateGroupAddons
      ? row.plan_groups + row.group_addons
      : row.plan_groups;
    const targetGroups = Math.max(1, row.required_groups, legacyGroupContract);
    const targetPlanInstances = Math.max(1, row.plan_instances || 1);
    const requiredInstanceAddons = Math.max(0, row.required_instances - targetPlanInstances);
    const missingInstanceAddons = Math.max(0, requiredInstanceAddons - row.instance_addons);
    const targetPrice = toMoney(Math.max(row.plan_price, groupUnit * targetGroups));
    const durationDays = Math.max(1, row.duration_days || 30);
    const planName = `Plano Ajustado ${targetGroups}G/${targetPlanInstances}I - ${durationDays}d`;
    const key = `${targetGroups}:${targetPlanInstances}:${durationDays}:${targetPrice.toFixed(2)}`;

    const needsNewSubscription = !row.has_subscription && row.is_using_now && flags.createMissingSubscriptions;
    const needsPlanChange =
      row.plan_id === null ||
      row.plan_groups !== targetGroups ||
      row.plan_instances !== targetPlanInstances ||
      row.group_addons > 0 ||
      row.effective_groups < row.required_groups ||
      row.effective_instances < row.required_instances;

    if (!needsNewSubscription && !needsPlanChange && missingInstanceAddons === 0) {
      continue;
    }

    if (!planByKey.has(key)) {
      planByKey.set(key, {
        key,
        name: planName,
        description:
          "Plano gerado pela migracao de capacidade para preservar grupos contratados e manter 1 instancia base.",
        price: targetPrice,
        addonInstancePrice: instanceUnit,
        addonGroupPrice: 0,
        groupLimit: targetGroups,
        instanceLimit: targetPlanInstances,
        durationDays,
        isActive: 1,
      });
    }

    userActions.push({
      userId: row.user_id,
      label: row.label,
      subscriptionId: row.subscription_id,
      existingPlanId: row.plan_id,
      targetPlanKey: key,
      targetGroups,
      targetPlanInstances,
      targetPrice,
      durationDays,
      activeGroups: row.active_groups,
      totalGroups: row.total_groups,
      totalInstances: row.total_instances,
      connectedInstances: row.connected_instances,
      groupAddonsToMigrate: flags.migrateGroupAddons ? row.group_addons : 0,
      missingInstanceAddons,
      createSubscription: needsNewSubscription,
      oldEffectiveGroups: row.effective_groups,
      oldEffectiveInstances: row.effective_instances,
      requiredGroups: row.required_groups,
      requiredInstances: row.required_instances,
      subscriptionStatus: row.subscription_status,
      subscriptionMetadata: row.subscription_metadata,
    });
  }

  return {
    defaults: {
      groupLicensePrice: groupUnit,
      instanceAddonPrice: instanceUnit,
      migrateGroupAddons: flags.migrateGroupAddons,
      createMissingSubscriptions: flags.createMissingSubscriptions,
    },
    plans: Array.from(planByKey.values()),
    users: userActions,
  };
};

const buildNormalizationSqlPreview = (normalizationPlan) => {
  const lines = [];
  lines.push("-- BotAdmin capacity normalization preview");
  lines.push("-- Review before running: npm run db:migration:apply-plans");
  lines.push("START TRANSACTION;");
  lines.push("");
  lines.push("-- Base plan defaults");
  lines.push(
    "UPDATE subscription_plans SET group_limit = GREATEST(group_limit, 1), instance_limit = GREATEST(instance_limit, 1), addon_instance_price = 25.00, addon_group_price = 0.00 WHERE is_active = 1;",
  );
  lines.push("");

  for (const plan of normalizationPlan.plans) {
    lines.push(
      [
        "INSERT INTO subscription_plans",
        "(name, description, price, addon_instance_price, addon_group_price, group_limit, instance_limit, duration_days, is_active)",
        "SELECT",
        [
          formatSqlString(plan.name),
          formatSqlString(plan.description),
          plan.price.toFixed(2),
          plan.addonInstancePrice.toFixed(2),
          plan.addonGroupPrice.toFixed(2),
          plan.groupLimit,
          plan.instanceLimit,
          plan.durationDays,
          plan.isActive,
        ].join(", "),
        `WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE name = ${formatSqlString(plan.name)} LIMIT 1);`,
      ].join(" "),
    );
  }

  lines.push("");
  lines.push("-- User subscription updates are executed by the script using resolved plan ids.");
  for (const action of normalizationPlan.users) {
    lines.push(
      `-- user_id=${action.userId} target=${action.targetGroups}G/${action.targetPlanInstances}I group_addons_to_migrate=${action.groupAddonsToMigrate} missing_instance_addons=${action.missingInstanceAddons}`,
    );
  }
  lines.push("ROLLBACK;");
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const ensureMigrationLedger = async (db) => {
  await db.query(
    `
      CREATE TABLE IF NOT EXISTS botadmin_schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        migration_key VARCHAR(160) NOT NULL UNIQUE,
        status ENUM('planned','applied','failed') NOT NULL DEFAULT 'planned',
        summary LONGTEXT NULL,
        applied_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `,
  );
};

const columnExists = async (db, table, column) => {
  const [rows] = await db.query(
    `
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [table, column],
  );
  return Array.isArray(rows) && rows.length > 0;
};

const applyCompatibilitySchema = async (db) => {
  const changes = [];

  if (!(await columnExists(db, "bot_instances", "license_sales_enabled"))) {
    await db.query(
      "ALTER TABLE bot_instances ADD COLUMN license_sales_enabled TINYINT(1) NOT NULL DEFAULT 0",
    );
    changes.push("bot_instances.license_sales_enabled");
  }

  if (!(await columnExists(db, "bot_group_settings", "plan_renewal_silent"))) {
    await db.query(
      "ALTER TABLE bot_group_settings ADD COLUMN plan_renewal_silent TINYINT(1) NOT NULL DEFAULT 0",
    );
    changes.push("bot_group_settings.plan_renewal_silent");
  }

  return changes;
};

const fetchPreApplyState = async (db, normalizationPlan) => {
  const userIds = Array.from(
    new Set(normalizationPlan.users.map((action) => action.userId).filter(Boolean)),
  );
  const state = {
    capturedAt: new Date().toISOString(),
    plans: [],
    subscriptions: [],
    addons: [],
  };

  const [plans] = await db.query(
    "SELECT * FROM subscription_plans ORDER BY id",
  );
  state.plans = plans;

  if (userIds.length === 0) {
    return state;
  }

  const placeholders = userIds.map(() => "?").join(", ");
  const [subscriptions] = await db.query(
    `SELECT * FROM user_plan_subscriptions WHERE user_id IN (${placeholders}) ORDER BY user_id, id`,
    userIds,
  );
  const [addons] = await db.query(
    `SELECT * FROM user_plan_addons WHERE user_id IN (${placeholders}) ORDER BY user_id, id`,
    userIds,
  );
  state.subscriptions = subscriptions;
  state.addons = addons;
  return state;
};

const upsertCapacityPlan = async (db, plan) => {
  const [existingRows] = await db.query(
    "SELECT id FROM subscription_plans WHERE name = ? LIMIT 1",
    [plan.name],
  );

  if (existingRows.length > 0) {
    const planId = existingRows[0].id;
    await db.query(
      `
        UPDATE subscription_plans
        SET description = ?,
            price = ?,
            addon_instance_price = ?,
            addon_group_price = ?,
            group_limit = ?,
            instance_limit = ?,
            duration_days = ?,
            is_active = 1
        WHERE id = ?
      `,
      [
        plan.description,
        plan.price,
        plan.addonInstancePrice,
        plan.addonGroupPrice,
        plan.groupLimit,
        plan.instanceLimit,
        plan.durationDays,
        planId,
      ],
    );
    return planId;
  }

  const [result] = await db.query(
    `
      INSERT INTO subscription_plans (
        name,
        description,
        price,
        addon_instance_price,
        addon_group_price,
        group_limit,
        instance_limit,
        duration_days,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `,
    [
      plan.name,
      plan.description,
      plan.price,
      plan.addonInstancePrice,
      plan.addonGroupPrice,
      plan.groupLimit,
      plan.instanceLimit,
      plan.durationDays,
    ],
  );
  return result.insertId;
};

const addMigrationMetadata = (metadata, migrationKey, action) => ({
  ...parseJsonObject(metadata),
  capacityMigration: {
    key: migrationKey,
    migratedAt: new Date().toISOString(),
    targetGroups: action.targetGroups,
    targetPlanInstances: action.targetPlanInstances,
    previousEffectiveGroups: action.oldEffectiveGroups,
    previousEffectiveInstances: action.oldEffectiveInstances,
    groupAddonsMigrated: action.groupAddonsToMigrate,
    instanceAddonsGranted: action.missingInstanceAddons,
  },
});

const applyPlanNormalization = async (db, normalizationPlan, flags, artifactPath) => {
  const migrationKey = `capacity-normalization-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const planIds = new Map();
  const applied = {
    migrationKey,
    compatibilitySchemaChanges: [],
    basePlanDefaultsUpdated: false,
    plansUpserted: 0,
    subscriptionsUpdated: 0,
    subscriptionsCreated: 0,
    groupAddonsExpired: 0,
    instanceAddonsGranted: 0,
  };

  await db.beginTransaction();
  try {
    await ensureMigrationLedger(db);
    applied.compatibilitySchemaChanges = await applyCompatibilitySchema(db);

    if (flags.applyBasePlanDefaults) {
      await db.query(
        `
          UPDATE subscription_plans
          SET group_limit = GREATEST(group_limit, 1),
              instance_limit = GREATEST(instance_limit, 1),
              addon_instance_price = ?,
              addon_group_price = 0
          WHERE is_active = 1
        `,
        [normalizationPlan.defaults.instanceAddonPrice],
      );
      applied.basePlanDefaultsUpdated = true;
    }

    for (const plan of normalizationPlan.plans) {
      const planId = await upsertCapacityPlan(db, plan);
      planIds.set(plan.key, planId);
      applied.plansUpserted += 1;
    }

    for (const action of normalizationPlan.users) {
      const targetPlanId = planIds.get(action.targetPlanKey);
      if (!targetPlanId) {
        throw new Error(`Missing target plan id for ${action.targetPlanKey}`);
      }

      const nextMetadata = JSON.stringify(addMigrationMetadata(
        action.subscriptionMetadata,
        migrationKey,
        action,
      ));

      if (action.subscriptionId) {
        await db.query(
          `
            UPDATE user_plan_subscriptions
            SET plan_id = ?,
                status = CASE
                  WHEN status IN ('expired', 'cancelled') AND ? = 1 THEN 'active'
                  ELSE status
                END,
                current_period_start = COALESCE(current_period_start, UTC_TIMESTAMP()),
                current_period_end = CASE
                  WHEN current_period_end IS NULL OR current_period_end < UTC_TIMESTAMP()
                    THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)
                  ELSE current_period_end
                END,
                metadata = ?
            WHERE id = ?
          `,
          [
            targetPlanId,
            action.activeGroups > 0 || action.connectedInstances > 0 ? 1 : 0,
            action.durationDays,
            nextMetadata,
            action.subscriptionId,
          ],
        );
        applied.subscriptionsUpdated += 1;
      } else if (action.createSubscription) {
        const [insertResult] = await db.query(
          `
            INSERT INTO user_plan_subscriptions (
              user_id,
              plan_id,
              status,
              current_period_start,
              current_period_end,
              metadata
            ) VALUES (?, ?, 'active', UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?)
          `,
          [action.userId, targetPlanId, action.durationDays, nextMetadata],
        );
        action.subscriptionId = insertResult.insertId;
        applied.subscriptionsCreated += 1;
      }

      if (action.groupAddonsToMigrate > 0 && action.subscriptionId) {
        const [result] = await db.query(
          `
            UPDATE user_plan_addons
            SET expires_at = LEAST(COALESCE(expires_at, UTC_TIMESTAMP()), UTC_TIMESTAMP()),
                metadata = JSON_SET(
                  COALESCE(metadata, JSON_OBJECT()),
                  '$.migratedToPlanId',
                  ?,
                  '$.migrationKey',
                  ?,
                  '$.migrationReason',
                  'group_addon_converted_to_plan_quantity'
                )
            WHERE user_id = ?
              AND addon_type = 'group'
              AND (expires_at IS NULL OR expires_at >= UTC_TIMESTAMP())
          `,
          [targetPlanId, migrationKey, action.userId],
        );
        applied.groupAddonsExpired += result.affectedRows || 0;
      }

      if (action.missingInstanceAddons > 0 && action.subscriptionId) {
        await db.query(
          `
            INSERT INTO user_plan_addons (
              user_id,
              subscription_id,
              addon_type,
              quantity,
              auto_renew,
              purchased_at,
              expires_at,
              metadata
            ) VALUES (?, ?, 'instance', ?, 0, UTC_TIMESTAMP(), NULL, ?)
          `,
          [
            action.userId,
            action.subscriptionId,
            action.missingInstanceAddons,
            JSON.stringify({
              migrationKey,
              migrationReason: "instance_capacity_preserved",
              source: "botadmin-db-migration",
            }),
          ],
        );
        applied.instanceAddonsGranted += action.missingInstanceAddons;
      }
    }

    await db.query(
      `
        INSERT INTO botadmin_schema_migrations (migration_key, status, summary, applied_at)
        VALUES (?, 'applied', ?, UTC_TIMESTAMP())
      `,
      [migrationKey, JSON.stringify(applied)],
    );

    await db.commit();
    writeJson(path.join(artifactPath, "applied-result.json"), applied);
    return applied;
  } catch (error) {
    await db.rollback();
    try {
      await ensureMigrationLedger(db);
      await db.query(
        `
          INSERT INTO botadmin_schema_migrations (migration_key, status, summary, applied_at)
          VALUES (?, 'failed', ?, UTC_TIMESTAMP())
        `,
        [migrationKey, JSON.stringify({ error: error.message })],
      );
    } catch {
      // Ignore ledger write failures after rollback.
    }
    throw error;
  }
};

const applyCleanup = async (db, cleanupCandidates, flags) => {
  const dropped = [];
  for (const candidate of cleanupCandidates.tables) {
    if (
      candidate.recommendedAction !== "review" ||
      CORE_TABLES.has(candidate.table) ||
      !flags.dropWhitelist.has(candidate.table)
    ) {
      continue;
    }

    await db.query(`DROP TABLE IF EXISTS ${quoteIdentifier(candidate.table)}`);
    dropped.push(candidate.table);
  }
  return dropped;
};

const summarizeUsage = (usageRows, normalizationPlan) => {
  const activeUsers = usageRows.filter((row) => row.active_groups > 0).length;
  const connectedUsers = usageRows.filter((row) => row.connected_instances > 0).length;
  const usersNeedingActions = normalizationPlan.users.length;
  const activeGroups = usageRows.reduce((sum, row) => sum + row.active_groups, 0);
  const totalGroups = usageRows.reduce((sum, row) => sum + row.total_groups, 0);
  const totalInstances = usageRows.reduce((sum, row) => sum + row.total_instances, 0);
  const connectedInstances = usageRows.reduce((sum, row) => sum + row.connected_instances, 0);

  return {
    usersSeen: usageRows.length,
    usersWithActiveGroups: activeUsers,
    usersWithConnectedInstances: connectedUsers,
    usersNeedingCapacityActions: usersNeedingActions,
    activeGroups,
    totalGroups,
    totalInstances,
    connectedInstances,
    plansToCreateOrUpdate: normalizationPlan.plans.length,
    groupAddonsToMigrate: normalizationPlan.users.reduce((sum, row) => sum + row.groupAddonsToMigrate, 0),
    instanceAddonsToGrant: normalizationPlan.users.reduce((sum, row) => sum + row.missingInstanceAddons, 0),
  };
};

const main = async () => {
  loadEnv();
  const flags = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = path.join(ARTIFACT_DIR, timestamp);
  fs.mkdirSync(artifactPath, { recursive: true });

  const db = await connect();
  try {
    const inventory = await fetchSchemaInventory(db);
    const tableNames = inventory.tables.map((table) => table.tableName);
    const columnNames = Array.from(
      new Set(
        Object.values(inventory.columnsByTable)
          .flat()
          .map((column) => column.columnName),
      ),
    );
    const tableReferences = collectReferenceSummary(tableNames);
    const columnReferences = collectReferenceSummary(columnNames);
    const cleanupCandidates = buildCleanupCandidates(
      inventory,
      tableReferences,
      columnReferences,
    );
    const usageRows = await fetchUsageByUser(db, flags.days);
    const normalizationPlan = buildNormalizationPlan(usageRows, flags);
    const summary = summarizeUsage(usageRows, normalizationPlan);

    writeJson(path.join(artifactPath, "schema-inventory.json"), inventory);
    writeJson(path.join(artifactPath, "cleanup-candidates.json"), cleanupCandidates);
    writeJson(path.join(artifactPath, "usage-by-user.json"), usageRows);
    writeJson(path.join(artifactPath, "normalization-plan.json"), normalizationPlan);
    fs.writeFileSync(
      path.join(artifactPath, "normalization-plan.sql"),
      buildNormalizationSqlPreview(normalizationPlan),
      "utf8",
    );

    const backupManifest = {
      createdAt: new Date().toISOString(),
      affectedTables: [
        "subscription_plans",
        "user_plan_subscriptions",
        "user_plan_addons",
        "botadmin_schema_migrations",
      ],
      note:
        "This script writes JSON artifacts before apply. Run mysqldump for a full external backup before destructive cleanup.",
    };
    writeJson(path.join(artifactPath, "backup-manifest.json"), backupManifest);

    let applied = null;
    let cleanupDropped = [];
    if (flags.applyPlanNormalization || flags.applyBasePlanDefaults) {
      writeJson(
        path.join(artifactPath, "pre-apply-state.json"),
        await fetchPreApplyState(db, normalizationPlan),
      );
      applied = await applyPlanNormalization(db, normalizationPlan, flags, artifactPath);
    }

    if (flags.applyCleanup) {
      cleanupDropped = await applyCleanup(db, cleanupCandidates, flags);
      writeJson(path.join(artifactPath, "cleanup-applied.json"), { dropped: cleanupDropped });
    }

    const result = {
      artifactPath,
      flags,
      summary,
      cleanupReviewTables: cleanupCandidates.tables.filter((item) => item.recommendedAction === "review").length,
      cleanupReviewColumns: cleanupCandidates.columns.length,
      applied,
      cleanupDropped,
    };
    writeJson(path.join(artifactPath, "run-summary.json"), result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.end();
  }
};

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
