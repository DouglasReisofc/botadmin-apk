import { randomBytes, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import mysql, { type Pool as MySqlPool, type RowDataPacket } from "mysql2/promise";
import {
  createPostgresCompatPool,
  isPostgresDatabaseProvider,
  isPostgresTransientErrorCode,
  type DatabasePool,
} from "lib/db/postgres-compat";

declare global {
  var __botadmDbPool: DatabasePool | null | undefined;
}

const DATABASE_HOST = process.env.DATABASE_HOST ?? "localhost";
const DATABASE_PORT = Number(process.env.DATABASE_PORT ?? 3306);
const DATABASE_USER = process.env.DATABASE_USER ?? "root";
const DATABASE_PASSWORD = process.env.DATABASE_PASSWORD ?? "";
const DATABASE_NAME = process.env.DATABASE_NAME ?? "dashboard";
const DATABASE_CONNECTION_LIMIT = Number.isFinite(Number(process.env.DATABASE_CONNECTION_LIMIT))
  ? Math.max(1, Math.floor(Number(process.env.DATABASE_CONNECTION_LIMIT)))
  : 10;
const DATABASE_CONNECT_TIMEOUT = Number.isFinite(Number(process.env.DATABASE_CONNECT_TIMEOUT))
  ? Math.max(1_000, Math.floor(Number(process.env.DATABASE_CONNECT_TIMEOUT)))
  : 5_000;
const DATABASE_LOCK_WAIT_TIMEOUT_SECONDS = Number.isFinite(
  Number(process.env.DATABASE_LOCK_WAIT_TIMEOUT_SECONDS),
)
  ? Math.max(1, Math.floor(Number(process.env.DATABASE_LOCK_WAIT_TIMEOUT_SECONDS)))
  : 5;
const DATABASE_QUEUE_LIMIT = Number.isFinite(Number(process.env.DATABASE_QUEUE_LIMIT))
  ? Math.max(0, Math.floor(Number(process.env.DATABASE_QUEUE_LIMIT)))
  : 0;
const DATABASE_IDLE_TIMEOUT = Number.isFinite(Number(process.env.DATABASE_IDLE_TIMEOUT))
  ? Math.max(0, Math.floor(Number(process.env.DATABASE_IDLE_TIMEOUT)))
  : 300_000;
const DATABASE_MAX_IDLE = Number.isFinite(Number(process.env.DATABASE_MAX_IDLE))
  ? Math.max(
      0,
      Math.min(
        Math.floor(Number(process.env.DATABASE_MAX_IDLE)),
        Number.isFinite(Number(process.env.DATABASE_CONNECTION_LIMIT))
          ? Math.floor(Number(process.env.DATABASE_CONNECTION_LIMIT))
          : DATABASE_CONNECTION_LIMIT,
      ),
    )
  : DATABASE_CONNECTION_LIMIT;
const DEFAULT_ADMIN_EMAIL =
  process.env.DEFAULT_ADMIN_EMAIL ?? "contactgestorvip@gmail.com";
const DEFAULT_ADMIN_PASSWORD =
  process.env.DEFAULT_ADMIN_PASSWORD ?? "Dev7766@#$%";
const DEFAULT_ADMIN_NAME =
  process.env.DEFAULT_ADMIN_NAME ?? "Administrador StoreBot";

const TRANSIENT_DB_ERROR_CODES = new Set([
  "ECONNRESET",
  "PROTOCOL_CONNECTION_LOST",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "PROTOCOL_SEQUENCE_TIMEOUT",
]);

const isTransientDbError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && (TRANSIENT_DB_ERROR_CODES.has(code) || isPostgresTransientErrorCode(code));
};

const resetDbPool = async (): Promise<void> => {
  const currentPool = globalThis.__botadmDbPool ?? null;
  if (!currentPool) {
    return;
  }

  try {
    await currentPool.end();
  } catch {
    /* ignore shutdown errors */
  } finally {
    globalThis.__botadmDbPool = null;
  }
};

const withDbRetry = async <T>(
  operation: () => Promise<T>,
  attempt = 0,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDbError(error) || attempt >= 2) {
      throw error;
    }
    const code = (error as { code?: string }).code;
    console.warn(`[db] transient error (${code}); retrying query (attempt ${attempt + 1})`);
    await resetDbPool();
    return withDbRetry(operation, attempt + 1);
  }
};

const ensureTasks = new Map<string, Promise<void>>();
const ensureCompleted = new Set<string>();

const runEnsure = (key: string, ensureFn: () => Promise<void>): Promise<void> => {
  if (ensureCompleted.has(key)) {
    return Promise.resolve();
  }

  const existingTask = ensureTasks.get(key);
  if (existingTask) {
    return existingTask;
  }

  const task = ensureFn()
    .then(() => {
      ensureCompleted.add(key);
      ensureTasks.delete(key);
    })
    .catch((error) => {
      ensureTasks.delete(key);
      throw error;
    });

  ensureTasks.set(key, task);
  return task;
};

export const getDb = (): DatabasePool => {
  let pool = globalThis.__botadmDbPool ?? null;
  if (!pool) {
    if (isPostgresDatabaseProvider()) {
      pool = createPostgresCompatPool();
      globalThis.__botadmDbPool = pool;
      return pool;
    }

    const mysqlPool: MySqlPool = mysql.createPool({
      host: DATABASE_HOST,
      port: DATABASE_PORT,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      database: DATABASE_NAME,
      connectTimeout: DATABASE_CONNECT_TIMEOUT,
      waitForConnections: true,
      connectionLimit: DATABASE_CONNECTION_LIMIT,
      queueLimit: DATABASE_QUEUE_LIMIT,
      maxIdle: DATABASE_MAX_IDLE,
      idleTimeout: DATABASE_IDLE_TIMEOUT,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      timezone: "Z",
    });
    pool = mysqlPool as unknown as DatabasePool;
    const eventedPool = pool as unknown as {
      on?: (
        event: "connection",
        listener: (connection: { query: (sql: string, callback: (error: unknown) => void) => void }) => void,
      ) => void;
    };
    eventedPool.on?.("connection", (connection) => {
      connection.query(
        `SET SESSION lock_wait_timeout = ${DATABASE_LOCK_WAIT_TIMEOUT_SECONDS}`,
        (error) => {
          if (error) {
            console.warn("[db] failed to set lock_wait_timeout", error);
          }
        },
      );
    });
    globalThis.__botadmDbPool = pool;
  }

  return pool;
};

export const ensureUserTable = async () =>
  runEnsure("user-table", async () => {
    const execute = async (query: string, params: unknown[] = []) =>
      withDbRetry(async () => {
        const db = getDb();
        await db.query(query, params);
      });

    const fetch = async <T extends RowDataPacket[]>(query: string, params: unknown[] = []) =>
      withDbRetry(async () => {
        const db = getDb();
        const [rows] = await db.query<RowDataPacket[]>(query, params);
        return rows as T;
      });

    await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
      whatsapp_number VARCHAR(32) NULL,
      timezone VARCHAR(64) NULL,
      avatar_path VARCHAR(255) NULL,
      needs_credentials_completion TINYINT(1) NOT NULL DEFAULT 0,
      password_missing TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const existing = await fetch<RowDataPacket[]>(
      "SHOW COLUMNS FROM users LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await execute(`
        ALTER TABLE users
        ADD COLUMN ${definition};
      `);
    }
  };

  const emailColumn = await fetch<RowDataPacket[]>(
    "SHOW COLUMNS FROM users LIKE 'email'",
  );

  if (Array.isArray(emailColumn) && emailColumn.length > 0) {
    const columnDefinition = emailColumn[0];
    if (columnDefinition.Null === "NO") {
      await execute("ALTER TABLE users MODIFY email VARCHAR(255) NULL;");
    }
  }

  await ensureColumn("is_active", "is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role");
  await ensureColumn("balance", "balance DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER is_active");
  await ensureColumn("timezone", "timezone VARCHAR(64) NULL AFTER whatsapp_number");
  await ensureColumn("whatsapp_number", "whatsapp_number VARCHAR(32) NULL AFTER balance");
  await ensureColumn("avatar_path", "avatar_path VARCHAR(255) NULL AFTER whatsapp_number");
  await ensureColumn(
    "needs_credentials_completion",
    "needs_credentials_completion TINYINT(1) NOT NULL DEFAULT 0 AFTER avatar_path",
  );
  await ensureColumn(
    "password_missing",
    "password_missing TINYINT(1) NOT NULL DEFAULT 0 AFTER needs_credentials_completion",
  );
  await ensureColumn(
    "custom_plan_price",
    "custom_plan_price DECIMAL(12, 2) NULL AFTER balance",
  );
  await ensureColumn(
    "custom_addon_instance_price",
    "custom_addon_instance_price DECIMAL(12, 2) NULL AFTER custom_plan_price",
  );
  await ensureColumn(
    "custom_addon_group_price",
    "custom_addon_group_price DECIMAL(12, 2) NULL AFTER custom_addon_instance_price",
  );

  await ensureWebhookTable();
  await ensureWebhookEventTable();
  await ensureCustomerTable();
  await ensurePaymentMethodTable();
  await ensurePaymentChargeTable();
  await ensureSiteSettingsTable();
  await ensureUserPlanSubscriptionTable();
  await ensureUserPlanPaymentTable();
  await ensureUserPlanAddonTable();
  await ensureUserBalancePaymentTable();
  await ensureUserBotResaleLedgerTable();
  await ensureUserPurchaseHistoryTable();
  await ensureAdminFirebaseSettingsTable();
  await ensurePlanTrialSettingsTable();
    await ensureUserNotificationTable();
    await ensurePushSubscriptionTable();
    await ensureFieldTutorialTable();
    await ensureAdminMobileSettingsTable();
    await ensurePasswordResetTable();
  await ensureUserVerificationTable();
  await ensureUserApiKeyTable();
  await ensureApiRequestPlanTable();
  await ensureUserApiRequestTopupTable();

    const normalizedEmail = DEFAULT_ADMIN_EMAIL.toLowerCase().trim();
    const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

    await execute(
      `
        INSERT INTO users (name, email, password, role, is_active, balance)
        VALUES (?, ?, ?, 'admin', 1, 0)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          password = VALUES(password),
          role = 'admin',
          is_active = 1
      `,
      [DEFAULT_ADMIN_NAME.trim(), normalizedEmail, hashedPassword],
    );

    const adminRows = await fetch<RowDataPacket[]>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail],
    );

    if (Array.isArray(adminRows) && adminRows.length > 0) {
      const adminId = Number(adminRows[0].id);

      const webhookRows = await fetch<RowDataPacket[]>(
        "SELECT id FROM user_webhooks WHERE user_id = ? LIMIT 1",
        [adminId],
      );

      if (!Array.isArray(webhookRows) || webhookRows.length === 0) {
        await execute(
          `
            INSERT INTO user_webhooks (id, user_id, verify_token)
            VALUES (?, ?, ?)
          `,
          [randomUUID(), adminId, randomBytes(24).toString("hex")],
        );
      }
    }
  });

export type UserRow = {
  id: number;
  name: string;
  email: string | null;
  password: string;
  role: "admin" | "user";
  is_active: number;
  balance: string;
  custom_plan_price: string | null;
  custom_addon_instance_price: string | null;
  custom_addon_group_price: string | null;
  whatsapp_number: string | null;
  timezone: string | null;
  avatar_path: string | null;
  needs_credentials_completion: number;
  password_missing: number;
  created_at: Date;
  updated_at: Date;
};

export type UserApiKeyRow = {
  id: number;
  user_id: number;
  api_key: string;
  daily_quota: number;
  requests_used: number;
  reset_at: Date | null;
  rotation_locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type UserVerificationRow = {
  id: number;
  user_id: number;
  code: string;
  token: string;
  status: "pending" | "verified";
  confirmation_channel: string | null;
  expires_at: Date;
  verified_at: Date | null;
  created_at: Date;
};

export type ApiRequestPlanRow = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  request_amount: number;
  is_active: number;
  order_index: number;
  created_at: Date;
  updated_at: Date;
};

export type UserApiRequestTopupRow = {
  id: number;
  user_id: number;
  plan_id: number | null;
  provider: string;
  provider_payment_id: string;
  request_amount: number;
  amount_cents: number;
  status: string;
  metadata: string | null;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export const ensureSessionTable = async () =>
  runEnsure("session-table", async () => {
    await ensureUserTable();
    await withDbRetry(async () => {
      const db = getDb();
      await db.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id CHAR(36) PRIMARY KEY,
        user_id INT NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL,
        impersonated_by_user_id INT NULL,
        impersonated_from_session_id CHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_sessions_impersonator FOREIGN KEY (impersonated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_active (user_id, expires_at, revoked_at),
        INDEX idx_sessions_impersonator (impersonated_by_user_id),
        INDEX idx_sessions_origin (impersonated_from_session_id)
      ) ENGINE=InnoDB;
    `);

      const [impersonatedColumn] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM sessions LIKE 'impersonated_by_user_id'",
      );
      if (!Array.isArray(impersonatedColumn) || impersonatedColumn.length === 0) {
        await db.query(
          "ALTER TABLE sessions ADD COLUMN impersonated_by_user_id INT NULL AFTER revoked_at",
        );
        await db.query(
          "ALTER TABLE sessions ADD CONSTRAINT fk_sessions_impersonator FOREIGN KEY (impersonated_by_user_id) REFERENCES users(id) ON DELETE SET NULL",
        ).catch(() => {});
        await db.query(
          "ALTER TABLE sessions ADD INDEX idx_sessions_impersonator (impersonated_by_user_id)",
        ).catch(() => {});
      }

      const [originColumn] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM sessions LIKE 'impersonated_from_session_id'",
      );
      if (!Array.isArray(originColumn) || originColumn.length === 0) {
        await db.query(
          "ALTER TABLE sessions ADD COLUMN impersonated_from_session_id CHAR(36) NULL AFTER impersonated_by_user_id",
        );
        await db.query(
          "ALTER TABLE sessions ADD INDEX idx_sessions_origin (impersonated_from_session_id)",
        ).catch(() => {});
      }
    });
  });

export type SessionRow = {
  id: string;
  user_id: number;
  expires_at: Date;
  revoked_at: Date | null;
  impersonated_by_user_id: number | null;
  impersonated_from_session_id: string | null;
  created_at: Date;
};

export const ensurePasswordResetTable = async () =>
  runEnsure("password-reset", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id CHAR(36) PRIMARY KEY,
      user_id INT NOT NULL,
      token CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_pwdresets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_token (token),
      INDEX idx_resets_user (user_id),
      INDEX idx_resets_active (user_id, expires_at, used_at)
    ) ENGINE=InnoDB;
  `);
  const [codeHashColumn] = await db.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM password_resets LIKE 'code_hash'",
  );
  if (!Array.isArray(codeHashColumn) || codeHashColumn.length === 0) {
    await db.query(
      "ALTER TABLE password_resets ADD COLUMN code_hash VARCHAR(255) NULL AFTER token",
    );
  }
  });

export type PasswordResetRow = {
  id: string;
  user_id: number;
  token: string;
  code_hash?: string | null;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
};

export const ensureUserVerificationTable = async () =>
  runEnsure("user-verification", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_verification_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      code VARCHAR(32) NOT NULL,
      token CHAR(64) NOT NULL,
      status ENUM('pending', 'verified') NOT NULL DEFAULT 'pending',
      confirmation_channel VARCHAR(32) NULL,
      expires_at DATETIME NOT NULL,
      verified_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_user_verification_token (token),
      UNIQUE KEY uniq_user_verification_code (code),
      INDEX idx_user_verification_user (user_id, status),
      INDEX idx_user_verification_expires (status, expires_at)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureCategoryTable = async () =>
  runEnsure("category", async () => {
  const db = getDb();
  await ensureUserTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      sku VARCHAR(100) NOT NULL,
      description TEXT,
      image_path VARCHAR(255),
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      duration_days INT NOT NULL DEFAULT 30,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT unique_category_sku_per_user UNIQUE KEY unique_category_sku_per_user (user_id, sku)
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM categories LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE categories ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("duration_days", "duration_days INT NOT NULL DEFAULT 30");
  });

export const ensureProductTable = async () =>
  runEnsure("product", async () => {
  const db = getDb();
  await ensureCategoryTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      category_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      details TEXT NOT NULL,
      file_path VARCHAR(255),
      resale_limit INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_products_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
  });

export const ensureBotMenuConfigTable = async () =>
  runEnsure("bot-menu-config", async () => {
  const db = getDb();
  await ensureUserTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_menu_configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      menu_text TEXT NOT NULL,
      variables TEXT NULL,
      image_path VARCHAR(255) NULL,
      menu_footer_text TEXT NULL,
      menu_button_buy VARCHAR(120) NULL,
      menu_button_add_balance VARCHAR(120) NULL,
      menu_button_support VARCHAR(120) NULL,
      menu_button_profile VARCHAR(120) NULL,
      category_list_header TEXT NULL,
      category_list_body TEXT NULL,
      category_list_footer TEXT NULL,
      category_list_footer_more TEXT NULL,
      category_list_button VARCHAR(120) NULL,
      category_list_section VARCHAR(255) NULL,
      category_list_next_title VARCHAR(120) NULL,
      category_list_next_description VARCHAR(255) NULL,
      category_list_empty TEXT NULL,
      category_detail_body TEXT NULL,
      category_detail_footer TEXT NULL,
      category_detail_button VARCHAR(120) NULL,
      category_detail_caption VARCHAR(255) NULL,
      menu_add_balance_reply TEXT NULL,
      menu_support_reply TEXT NULL,
      profile_menu_body TEXT NULL,
      profile_menu_footer TEXT NULL,
      profile_button_purchases VARCHAR(120) NULL,
      profile_button_support VARCHAR(120) NULL,
      profile_button_back VARCHAR(120) NULL,
      profile_purchases_header TEXT NULL,
      profile_purchases_body TEXT NULL,
      profile_purchases_footer TEXT NULL,
      profile_purchases_empty TEXT NULL,
      profile_purchases_button VARCHAR(120) NULL,
      profile_support_reason_body TEXT NULL,
      profile_support_reason_footer TEXT NULL,
      profile_support_reason_purchase VARCHAR(120) NULL,
      profile_support_reason_payment VARCHAR(120) NULL,
      profile_support_reason_other VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_bot_menu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const addColumnIfMissing = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_menu_configs LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_menu_configs ADD COLUMN ${column} ${definition}`);
    }
  };

  await addColumnIfMissing("menu_footer_text", "TEXT NULL");
  await addColumnIfMissing("menu_button_buy", "VARCHAR(120) NULL");
  await addColumnIfMissing("menu_button_add_balance", "VARCHAR(120) NULL");
  await addColumnIfMissing("menu_button_support", "VARCHAR(120) NULL");
  await addColumnIfMissing("menu_button_profile", "VARCHAR(120) NULL");
  await addColumnIfMissing("category_list_header", "TEXT NULL");
  await addColumnIfMissing("category_list_body", "TEXT NULL");
  await addColumnIfMissing("category_list_footer", "TEXT NULL");
  await addColumnIfMissing("category_list_footer_more", "TEXT NULL");
  await addColumnIfMissing("category_list_button", "VARCHAR(120) NULL");
  await addColumnIfMissing("category_list_section", "VARCHAR(255) NULL");
  await addColumnIfMissing("category_list_next_title", "VARCHAR(120) NULL");
  await addColumnIfMissing("category_list_next_description", "VARCHAR(255) NULL");
  await addColumnIfMissing("category_list_empty", "TEXT NULL");
  await addColumnIfMissing("category_detail_body", "TEXT NULL");
  await addColumnIfMissing("category_detail_footer", "TEXT NULL");
  await addColumnIfMissing("category_detail_button", "VARCHAR(120) NULL");
  await addColumnIfMissing("category_detail_caption", "VARCHAR(255) NULL");
  await addColumnIfMissing("menu_add_balance_reply", "TEXT NULL");
  await addColumnIfMissing("menu_support_reply", "TEXT NULL");
  await addColumnIfMissing("profile_menu_body", "TEXT NULL");
  await addColumnIfMissing("profile_menu_footer", "TEXT NULL");
  await addColumnIfMissing("profile_button_purchases", "VARCHAR(120) NULL");
  await addColumnIfMissing("profile_button_support", "VARCHAR(120) NULL");
  await addColumnIfMissing("profile_button_back", "VARCHAR(120) NULL");
  await addColumnIfMissing("profile_purchases_header", "TEXT NULL");
  await addColumnIfMissing("profile_purchases_body", "TEXT NULL");
  await addColumnIfMissing("profile_purchases_footer", "TEXT NULL");
  await addColumnIfMissing("profile_purchases_empty", "TEXT NULL");
  await addColumnIfMissing("profile_purchases_button", "VARCHAR(120) NULL");
  await addColumnIfMissing("profile_support_reason_body", "TEXT NULL");
  await addColumnIfMissing("profile_support_reason_footer", "TEXT NULL");
  await addColumnIfMissing("profile_support_reason_purchase", "VARCHAR(120) NULL");
  await addColumnIfMissing("profile_support_reason_payment", "VARCHAR(120) NULL");
  await addColumnIfMissing("profile_support_reason_other", "VARCHAR(120) NULL");
  });

export const ensureCustomerTable = async () =>
  runEnsure("customer", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      whatsapp_id VARCHAR(32) NOT NULL,
      phone_number VARCHAR(32) NOT NULL,
      display_name VARCHAR(255) NULL,
      profile_name VARCHAR(255) NULL,
      notes TEXT NULL,
      balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
      is_blocked TINYINT(1) NOT NULL DEFAULT 0,
      last_interaction DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_customers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT unique_customer_user_whatsapp UNIQUE KEY unique_customer_user_whatsapp (user_id, whatsapp_id)
    ) ENGINE=InnoDB;
  `);
  });

export const ensurePaymentMethodTable = async () =>
  runEnsure("payment-method", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_payment_methods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      provider VARCHAR(64) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      display_name VARCHAR(255) NULL,
      credentials LONGTEXT NULL,
      settings LONGTEXT NULL,
      metadata LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_payment_methods_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT unique_payment_method UNIQUE KEY unique_payment_method (user_id, provider)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureAdminPaymentMethodTable = async () =>
  runEnsure("admin-payment-method", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_payment_methods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(64) NOT NULL UNIQUE,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      display_name VARCHAR(255) NULL,
      credentials LONGTEXT NULL,
      settings LONGTEXT NULL,
      metadata LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  });

export const ensurePaymentChargeTable = async () =>
  runEnsure("payment-charge", async () => {
  const db = getDb();
  await ensurePaymentMethodTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_payment_charges (
      id INT AUTO_INCREMENT PRIMARY KEY,
      public_id CHAR(36) NOT NULL UNIQUE,
      user_id INT NOT NULL,
      provider VARCHAR(64) NOT NULL,
      provider_payment_id VARCHAR(128) NOT NULL,
      status VARCHAR(64) NOT NULL,
      amount DECIMAL(12, 2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
      qr_code LONGTEXT NULL,
      qr_code_base64 LONGTEXT NULL,
      ticket_url TEXT NULL,
      expires_at DATETIME NULL,
      customer_whatsapp VARCHAR(32) NULL,
      customer_name VARCHAR(255) NULL,
      metadata LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_payment_charges_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT unique_provider_payment UNIQUE KEY unique_provider_payment (provider, provider_payment_id)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureSubscriptionPlanTable = async () =>
  runEnsure("subscription-plan", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        description TEXT NULL,
        price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        addon_instance_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        addon_group_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        category_limit INT NOT NULL DEFAULT 0,
        group_limit INT NOT NULL DEFAULT 0,
        instance_limit INT NOT NULL DEFAULT 1,
        allow_flows TINYINT(1) NOT NULL DEFAULT 1,
        storage_quota_gb DECIMAL(10, 2) NOT NULL DEFAULT 0,
        features_json TEXT NULL,
        duration_days INT NOT NULL DEFAULT 30,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);
  });

  const ensureColumn = async (column: string, definition: string, onAdded?: () => Promise<void>) => {
    await withDbRetry(async () => {
      const db = getDb();
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM subscription_plans LIKE ?",
        [column],
      );

      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE subscription_plans ADD COLUMN ${definition};`);
        if (onAdded) {
          await onAdded().catch((error) => {
            console.warn(`[db] Falha ao inicializar coluna ${column}:`, error);
          });
        }
      }
    });
  };

  await ensureColumn("group_limit", "group_limit INT NOT NULL DEFAULT 0", async () => {
    await withDbRetry(async () => {
      const db = getDb();
      await db.query(
        "UPDATE subscription_plans SET group_limit = category_limit WHERE group_limit = 0 AND category_limit > 0",
      );
    });
  });

  await ensureColumn("instance_limit", "instance_limit INT NOT NULL DEFAULT 1", async () => {
    await withDbRetry(async () => {
      const db = getDb();
      await db.query(
        "UPDATE subscription_plans SET instance_limit = GREATEST(category_limit, 1)",
      );
    });
  });

  await ensureColumn("allow_flows", "allow_flows TINYINT(1) NOT NULL DEFAULT 1");
  await ensureColumn("storage_quota_gb", "storage_quota_gb DECIMAL(10, 2) NOT NULL DEFAULT 0");
  await ensureColumn("features_json", "features_json TEXT NULL AFTER storage_quota_gb");
  await ensureColumn("addon_instance_price", "addon_instance_price DECIMAL(10, 2) NOT NULL DEFAULT 0");
  await ensureColumn("addon_group_price", "addon_group_price DECIMAL(10, 2) NOT NULL DEFAULT 0");
  });

export const ensureSiteSettingsTable = async () =>
  runEnsure("site-settings", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
    CREATE TABLE IF NOT EXISTS user_site_settings (
      user_id INT PRIMARY KEY,
      site_name VARCHAR(120) NOT NULL,
      tagline VARCHAR(255) NULL,
      logo_path VARCHAR(255) NULL,
      favicon_path VARCHAR(255) NULL,
      seo_image_path VARCHAR(255) NULL,
      seo_title VARCHAR(160) NULL,
      seo_description VARCHAR(320) NULL,
      seo_keywords VARCHAR(512) NULL,
      footer_text TEXT NULL,
      footer_links LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_site_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
  });

  const ensureColumn = async (column: string, definition: string) => {
    await withDbRetry(async () => {
      const db = getDb();
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM user_site_settings LIKE ?",
        [column],
      );

      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE user_site_settings ADD COLUMN ${definition};`);
      }
    });
  };

  await Promise.all([
    ensureColumn("logo_path", "logo_path VARCHAR(255) NULL"),
    ensureColumn("favicon_path", "favicon_path VARCHAR(255) NULL"),
    ensureColumn("seo_image_path", "seo_image_path VARCHAR(255) NULL"),
  ]);
  });

export const ensureAdminSiteSettingsTable = async () =>
  runEnsure("admin-site-settings", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
    CREATE TABLE IF NOT EXISTS admin_site_settings (
      id TINYINT PRIMARY KEY,
      site_name VARCHAR(120) NOT NULL,
      tagline VARCHAR(255) NULL,
      logo_path VARCHAR(255) NULL,
      favicon_path VARCHAR(255) NULL,
      favicon_assets_path VARCHAR(255) NULL,
      favicon_assets_json TEXT NULL,
      support_email VARCHAR(160) NULL,
      support_phone VARCHAR(40) NULL,
      support_url VARCHAR(300) NULL,
      support_channel VARCHAR(20) NOT NULL DEFAULT 'chat',
      support_whatsapp_number VARCHAR(40) NULL,
      signup_whatsapp_verification_enabled TINYINT(1) NOT NULL DEFAULT 1,
      signup_whatsapp_verification_mode VARCHAR(32) NOT NULL DEFAULT 'user_sends_code',
      signup_whatsapp_verification_target_number VARCHAR(40) NULL,
      signup_whatsapp_verification_instructions TEXT NULL,
      signup_whatsapp_verification_support_text TEXT NULL,
      user_panel_banners_json TEXT NULL,
      test_groups_json TEXT NULL,
      official_groups_json TEXT NULL,
      official_group_instance_id INT NULL,
      official_group_jid VARCHAR(80) NULL,
      official_group_invite_link TEXT NULL,
      official_group_invite_updated_at TIMESTAMP NULL,
      email_verification_enabled TINYINT(1) NOT NULL DEFAULT 0,
      email_verification_api_keys TEXT NULL,
      hero_badge VARCHAR(120) NULL,
      hero_title VARCHAR(160) NULL,
      hero_subtitle VARCHAR(255) NULL,
      hero_button_label VARCHAR(60) NULL,
      hero_button_url VARCHAR(300) NULL,
      hero_secondary_button_label VARCHAR(60) NULL,
      hero_secondary_button_url VARCHAR(300) NULL,
      hero_image_path VARCHAR(255) NULL,
      features_title VARCHAR(160) NULL,
      features_subtitle VARCHAR(255) NULL,
      features_json TEXT NULL,
      workflow_title VARCHAR(160) NULL,
      workflow_description VARCHAR(320) NULL,
      workflow_bullets_json TEXT NULL,
      workflow_image_path VARCHAR(255) NULL,
      cta_title VARCHAR(160) NULL,
      cta_description VARCHAR(320) NULL,
      cta_button_label VARCHAR(60) NULL,
      cta_button_url VARCHAR(300) NULL,
      seo_title VARCHAR(160) NULL,
      seo_description VARCHAR(320) NULL,
      seo_keywords_json TEXT NULL,
      seo_highlight_keywords_json TEXT NULL,
      seo_image_path VARCHAR(255) NULL,
      mobile_icon_path VARCHAR(255) NULL,
      footer_text TEXT NULL,
      terms_content MEDIUMTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  });

  const ensureColumn = async (column: string, definition: string) => {
    await withDbRetry(async () => {
      const db = getDb();
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM admin_site_settings LIKE ?",
        [column],
      );

      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE admin_site_settings ADD COLUMN ${definition};`);
      }
    });
  };

  await Promise.all([
    ensureColumn("logo_path", "logo_path VARCHAR(255) NULL"),
    ensureColumn("favicon_path", "favicon_path VARCHAR(255) NULL"),
    ensureColumn("seo_image_path", "seo_image_path VARCHAR(255) NULL"),
    ensureColumn("favicon_assets_path", "favicon_assets_path VARCHAR(255) NULL"),
    ensureColumn("favicon_assets_json", "favicon_assets_json TEXT NULL"),
    ensureColumn("mobile_icon_path", "mobile_icon_path VARCHAR(255) NULL"),
    ensureColumn("support_url", "support_url VARCHAR(300) NULL"),
    ensureColumn(
      "signup_whatsapp_verification_enabled",
      "signup_whatsapp_verification_enabled TINYINT(1) NOT NULL DEFAULT 1",
    ),
    ensureColumn(
      "signup_whatsapp_verification_mode",
      "signup_whatsapp_verification_mode VARCHAR(32) NOT NULL DEFAULT 'user_sends_code'",
    ),
    ensureColumn(
      "signup_whatsapp_verification_target_number",
      "signup_whatsapp_verification_target_number VARCHAR(40) NULL",
    ),
    ensureColumn(
      "signup_whatsapp_verification_instructions",
      "signup_whatsapp_verification_instructions TEXT NULL",
    ),
    ensureColumn(
      "signup_whatsapp_verification_support_text",
      "signup_whatsapp_verification_support_text TEXT NULL",
    ),
    ensureColumn("user_panel_banners_json", "user_panel_banners_json TEXT NULL"),
    ensureColumn("test_groups_json", "test_groups_json TEXT NULL"),
    ensureColumn("official_groups_json", "official_groups_json TEXT NULL AFTER test_groups_json"),
    ensureColumn("official_group_instance_id", "official_group_instance_id INT NULL AFTER test_groups_json"),
    ensureColumn("official_group_jid", "official_group_jid VARCHAR(80) NULL AFTER official_group_instance_id"),
    ensureColumn("official_group_invite_link", "official_group_invite_link TEXT NULL AFTER official_group_jid"),
    ensureColumn(
      "official_group_invite_updated_at",
      "official_group_invite_updated_at TIMESTAMP NULL AFTER official_group_invite_link",
    ),
    ensureColumn("hero_badge", "hero_badge VARCHAR(120) NULL"),
    ensureColumn("hero_secondary_button_label", "hero_secondary_button_label VARCHAR(60) NULL"),
    ensureColumn("hero_secondary_button_url", "hero_secondary_button_url VARCHAR(300) NULL"),
    ensureColumn("hero_image_path", "hero_image_path VARCHAR(255) NULL"),
    ensureColumn("features_title", "features_title VARCHAR(160) NULL"),
    ensureColumn("features_subtitle", "features_subtitle VARCHAR(255) NULL"),
    ensureColumn("features_json", "features_json TEXT NULL"),
    ensureColumn("workflow_title", "workflow_title VARCHAR(160) NULL"),
    ensureColumn("workflow_description", "workflow_description VARCHAR(320) NULL"),
    ensureColumn("workflow_bullets_json", "workflow_bullets_json TEXT NULL"),
    ensureColumn("workflow_image_path", "workflow_image_path VARCHAR(255) NULL"),
    ensureColumn("email_verification_enabled", "email_verification_enabled TINYINT(1) NOT NULL DEFAULT 0"),
    ensureColumn("email_verification_api_keys", "email_verification_api_keys TEXT NULL"),
    ensureColumn("cta_title", "cta_title VARCHAR(160) NULL"),
    ensureColumn("cta_description", "cta_description VARCHAR(320) NULL"),
    ensureColumn("cta_button_label", "cta_button_label VARCHAR(60) NULL"),
    ensureColumn("cta_button_url", "cta_button_url VARCHAR(300) NULL"),
    ensureColumn("seo_keywords_json", "seo_keywords_json TEXT NULL"),
    ensureColumn("seo_highlight_keywords_json", "seo_highlight_keywords_json TEXT NULL"),
    ensureColumn("terms_content", "terms_content MEDIUMTEXT NULL"),
  ]);

  await withDbRetry(async () => {
    const db = getDb();
    await db.query(
      `INSERT INTO admin_site_settings (id, site_name)
       VALUES (1, 'StoreBot')
       ON DUPLICATE KEY UPDATE site_name = site_name`,
    );
  });
  });

export const ensurePlanTrialSettingsTable = async () =>
  runEnsure("plan-trial-settings", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS plan_trial_settings (
        id TINYINT PRIMARY KEY,
        settings_json MEDIUMTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  });

  const ensureColumn = async (column: string, definition: string) => {
    await withDbRetry(async () => {
      const db = getDb();
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM admin_site_settings LIKE ?",
        [column],
      );
      if (!Array.isArray(existing) || existing.length === 0) {
        try {
          await db.query(`ALTER TABLE admin_site_settings ADD COLUMN ${definition};`);
        } catch (error) {
          if ((error as { code?: string }).code !== "ER_DUP_FIELDNAME") {
            throw error;
          }
        }
      }
    });
  };

  await Promise.all([
    ensureColumn("support_channel", "support_channel VARCHAR(20) NOT NULL DEFAULT 'chat'"),
    ensureColumn(
      "support_whatsapp_number",
      "support_whatsapp_number VARCHAR(40) NULL",
    ),
  ]);
  });

export const ensurePlanGuardSettingsTable = async () =>
  runEnsure("plan-guard-settings", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS plan_guard_settings (
        id TINYINT PRIMARY KEY,
        settings_json MEDIUMTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);
  });
  });

export const ensureAdminSmtpSettingsTable = async () =>
  runEnsure("admin-smtp-settings", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_smtp_settings (
      id TINYINT PRIMARY KEY,
      host VARCHAR(255) NOT NULL,
      port INT NOT NULL DEFAULT 587,
      is_secure TINYINT(1) NOT NULL DEFAULT 0,
      username VARCHAR(255) NULL,
      password VARCHAR(255) NULL,
      from_name VARCHAR(255) NOT NULL,
      from_email VARCHAR(255) NOT NULL,
      reply_to VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await db.query(
    `
      INSERT INTO admin_smtp_settings (
        id,
        host,
        port,
        is_secure,
        username,
        password,
        from_name,
        from_email
      ) VALUES (1, 'smtp.exemplo.com', 587, 0, NULL, NULL, 'StoreBot', 'no-reply@storebot.app')
      ON DUPLICATE KEY UPDATE id = id
    `,
  );
  });

export const ensureAdminMobileSettingsTable = async () =>
  runEnsure("admin-mobile-settings", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_mobile_settings (
      id TINYINT PRIMARY KEY,
      app_name VARCHAR(120) NOT NULL,
      package_name VARCHAR(160) NOT NULL,
      version_code INT NOT NULL DEFAULT 1,
      version_name VARCHAR(40) NOT NULL DEFAULT '1.0',
      server_url VARCHAR(300) NULL,
      min_version_code INT NULL,
      release_notes TEXT NULL,
      onboarding_enabled TINYINT(1) NOT NULL DEFAULT 0,
      onboarding_slides LONGTEXT NULL,
      onboarding_revision VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_mobile_settings LIKE ?",
      [column],
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_mobile_settings ADD COLUMN ${definition};`);
    }
  };

  await Promise.all([
    ensureColumn("min_version_code", "min_version_code INT NULL"),
    ensureColumn("release_notes", "release_notes TEXT NULL"),
    ensureColumn("onboarding_enabled", "onboarding_enabled TINYINT(1) NOT NULL DEFAULT 0"),
    ensureColumn("onboarding_slides", "onboarding_slides LONGTEXT NULL"),
    ensureColumn("onboarding_revision", "onboarding_revision VARCHAR(64) NULL"),
  ]);

  const [rows] = await db.query<RowDataPacket[]>(`SELECT id FROM admin_mobile_settings WHERE id = 1 LIMIT 1`);
  if (!Array.isArray(rows) || rows.length === 0) {
    await db.query(
      `INSERT INTO admin_mobile_settings (id, app_name, package_name, version_code, version_name)
       VALUES (1, 'Bot Admin', 'com.botadmin.shop', 1, '1.0')
       ON DUPLICATE KEY UPDATE id = id`
    );
  }
  });

export const ensureAdminMegaCredentialsTable = async () =>
  runEnsure("admin-mega-credentials", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_mega_credentials (
      id TINYINT PRIMARY KEY,
      email VARCHAR(255) NULL,
      password VARCHAR(255) NULL,
      external_accounts_enabled TINYINT(1) NOT NULL DEFAULT 0,
      external_accounts_url VARCHAR(500) NULL,
      session_email VARCHAR(255) NULL,
      session_payload LONGTEXT NULL,
      session_updated_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_mega_credentials LIKE ?",
      [column],
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_mega_credentials ADD COLUMN ${definition}`);
    }
  };

  await Promise.all([
    ensureColumn("external_accounts_enabled", "external_accounts_enabled TINYINT(1) NOT NULL DEFAULT 0"),
    ensureColumn("external_accounts_url", "external_accounts_url VARCHAR(500) NULL"),
    ensureColumn("session_email", "session_email VARCHAR(255) NULL"),
    ensureColumn("session_payload", "session_payload LONGTEXT NULL"),
    ensureColumn("session_updated_at", "session_updated_at TIMESTAMP NULL DEFAULT NULL"),
  ]);

  await db.query(
    `
      INSERT INTO admin_mega_credentials (id)
      VALUES (1)
      ON DUPLICATE KEY UPDATE id = id
    `,
  );
  });

export const ensureAdminBotInterageConfigTables = async () =>
  runEnsure("admin-botinterage-config", async () => {
  const db = getDb();
  await ensureUserTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_botinterage_config (
      id TINYINT PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      api_base_url VARCHAR(500) NULL,
      api_token LONGTEXT NULL,
      model VARCHAR(120) NOT NULL DEFAULT 'qwen2.5:7b',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureConfigColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_botinterage_config LIKE ?",
      [column],
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_botinterage_config ADD COLUMN ${definition}`);
    }
  };

  await Promise.all([
    ensureConfigColumn("enabled", "enabled TINYINT(1) NOT NULL DEFAULT 0"),
    ensureConfigColumn("api_base_url", "api_base_url VARCHAR(500) NULL"),
    ensureConfigColumn("api_token", "api_token LONGTEXT NULL"),
    ensureConfigColumn("model", "model VARCHAR(120) NOT NULL DEFAULT 'qwen2.5:7b'"),
  ]);

  await db.query(
    `
      INSERT INTO admin_botinterage_config (id)
      VALUES (1)
      ON DUPLICATE KEY UPDATE id = id
    `,
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_botinterage_users (
      user_id INT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_admin_botinterage_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_admin_botinterage_users_created (created_at)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureAdminBotInterageTtsConfigTables = async () =>
  runEnsure("admin-botinterage-tts-config", async () => {
  const db = getDb();
  await ensureUserTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_botinterage_tts_config (
      id TINYINT PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      api_base_url VARCHAR(500) NULL,
      api_token LONGTEXT NULL,
      default_voice_id VARCHAR(190) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureConfigColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_botinterage_tts_config LIKE ?",
      [column],
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_botinterage_tts_config ADD COLUMN ${definition}`);
    }
  };

  await Promise.all([
    ensureConfigColumn("enabled", "enabled TINYINT(1) NOT NULL DEFAULT 0"),
    ensureConfigColumn("api_base_url", "api_base_url VARCHAR(500) NULL"),
    ensureConfigColumn("api_token", "api_token LONGTEXT NULL"),
    ensureConfigColumn("default_voice_id", "default_voice_id VARCHAR(190) NULL"),
  ]);

  await db.query(
    `
      INSERT INTO admin_botinterage_tts_config (id)
      VALUES (1)
      ON DUPLICATE KEY UPDATE id = id
    `,
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_botinterage_tts_users (
      user_id INT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_admin_botinterage_tts_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_admin_botinterage_tts_users_created (created_at)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureAdminBillingNotificationsTable = async () =>
  runEnsure("admin-billing-notifications", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_billing_notifications (
      id TINYINT PRIMARY KEY,
      settings JSON NOT NULL,
      timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM admin_billing_notifications WHERE id = 1 LIMIT 1`,
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    await db.query(
      `INSERT INTO admin_billing_notifications (id, settings, timezone)
       VALUES (1, JSON_OBJECT(), 'America/Sao_Paulo')
       ON DUPLICATE KEY UPDATE id = id`,
    );
  }
  });

export const ensureAdminMobileBuildJobsTable = async () =>
  runEnsure("admin-mobile-build-jobs", async () => {
  await ensureUserTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_mobile_build_jobs (
      id CHAR(36) PRIMARY KEY,
      status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
      progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
      stage VARCHAR(160) NULL,
      message TEXT NULL,
      started_by INT NOT NULL,
      cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
      apk_url VARCHAR(255) NULL,
      apk_size BIGINT UNSIGNED NULL,
      apk_updated_at DATETIME NULL,
      apk_version_name VARCHAR(80) NULL,
      apk_version_code INT NULL,
      aab_url VARCHAR(255) NULL,
      aab_size BIGINT UNSIGNED NULL,
      aab_updated_at DATETIME NULL,
      aab_version_name VARCHAR(80) NULL,
      aab_version_code INT NULL,
      log_path VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_admin_mobile_build_user FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_admin_mobile_build_status (status),
      INDEX idx_admin_mobile_build_updated_at (updated_at)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureAdminFirebaseSettingsTable = async () =>
  runEnsure("admin-firebase-settings", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_firebase_settings (
      id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
      project_id VARCHAR(128) NULL,
      client_email VARCHAR(255) NULL,
      private_key LONGTEXT NULL,
      web_api_key VARCHAR(255) NULL,
      web_auth_domain VARCHAR(255) NULL,
      web_project_id VARCHAR(128) NULL,
      web_storage_bucket VARCHAR(255) NULL,
      web_messaging_sender_id VARCHAR(64) NULL,
      web_app_id VARCHAR(255) NULL,
      web_measurement_id VARCHAR(64) NULL,
      vapid_key TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  });

export const ensureUserRafflesTable = async () =>
  runEnsure("user-raffles", async () => {
  const db = getDb();
  await ensurePaymentChargeTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_raffles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(160) NOT NULL,
      description TEXT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      price DECIMAL(12, 2) NOT NULL,
      numbers_total INT NOT NULL,
      reserved_count INT NOT NULL DEFAULT 0,
      sold_count INT NOT NULL DEFAULT 0,
      winners_count INT NOT NULL DEFAULT 1,
      tickets LONGTEXT NOT NULL,
      group_targets LONGTEXT NULL,
      group_jids LONGTEXT NULL,
      winners LONGTEXT NULL,
      metadata LONGTEXT NULL,
      drawn_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_raffles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_raffles_user_status (user_id, status),
      INDEX idx_user_raffles_created (created_at)
    ) ENGINE=InnoDB;
  `);

  const [groupTargetsColumn] = await db.query<RowDataPacket[]>(
    `SHOW COLUMNS FROM user_raffles LIKE 'group_targets'`,
  );
  const hasGroupTargets = Array.isArray(groupTargetsColumn) && groupTargetsColumn.length > 0;

  if (!hasGroupTargets) {
    const [existingGroupsColumn] = await db.query<RowDataPacket[]>(
      `SHOW COLUMNS FROM user_raffles LIKE 'groups'`,
    );
    const hasOldGroupsColumn = Array.isArray(existingGroupsColumn) && existingGroupsColumn.length > 0;

    if (hasOldGroupsColumn) {
      await db.query(
        "ALTER TABLE user_raffles CHANGE COLUMN `groups` group_targets LONGTEXT NULL",
      );
    } else {
      await db.query(
        "ALTER TABLE user_raffles ADD COLUMN group_targets LONGTEXT NULL AFTER tickets",
      );
    }
  }
  });

export type AdminMobileBuildJobRow = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: string | null;
  message: string | null;
  started_by: number;
  cancel_requested: number;
  apk_url: string | null;
  apk_size: number | null;
  apk_updated_at: Date | string | null;
  apk_version_name: string | null;
  apk_version_code: number | null;
  aab_url: string | null;
  aab_size: number | null;
  aab_updated_at: Date | string | null;
  aab_version_name: string | null;
  aab_version_code: number | null;
  log_path: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
};

export const ensureAdminBotConfigTable = async () =>
  runEnsure("admin-bot-config", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_bot_config (
      id TINYINT PRIMARY KEY,
      bot_name VARCHAR(60) NOT NULL DEFAULT 'StoreBot',
      purchase_voice_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} comprou {{category_name}} no {{bot_name}}.',
      balance_voice_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} adicionou {{amount}} no {{bot_name}}.',
      menu_text TEXT NOT NULL,
      menu_footer_text VARCHAR(255) NULL,
      panel_button_text VARCHAR(60) NOT NULL,
      subscription_button_text VARCHAR(60) NOT NULL,
      support_button_text VARCHAR(60) NOT NULL,
      support_url VARCHAR(300) NULL,
      support_cta_body_text TEXT NOT NULL,
      support_cta_footer_text VARCHAR(60) NULL,
      menu_image_path VARCHAR(255) NULL,
      subscription_header_text VARCHAR(160) NOT NULL,
      subscription_body_text TEXT NOT NULL,
      subscription_footer_text VARCHAR(255) NULL,
      subscription_renew_button_text VARCHAR(60) NOT NULL,
      subscription_change_button_text VARCHAR(60) NOT NULL,
      subscription_details_button_text VARCHAR(60) NOT NULL,
      subscription_no_plan_header_text VARCHAR(160) NOT NULL,
      subscription_no_plan_body_text TEXT NOT NULL,
      subscription_no_plan_button_text VARCHAR(60) NOT NULL,
      subscription_plan_list_title VARCHAR(60) NOT NULL,
      subscription_plan_list_body TEXT NOT NULL,
      subscription_plan_list_button_text VARCHAR(60) NOT NULL,
      subscription_plan_list_footer_text VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureColumnExists = async (
    column: string,
    definition: string,
  ) => {
    const [columnInfo] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_bot_config LIKE ?",
      [column],
    );

    if (!Array.isArray(columnInfo) || columnInfo.length === 0) {
      await db.query(`
        ALTER TABLE admin_bot_config
        ADD COLUMN ${definition}
      `);
    }
  };

  await ensureColumnExists(
    "bot_name",
    "bot_name VARCHAR(60) NOT NULL DEFAULT 'StoreBot' AFTER id",
  );

  await ensureColumnExists(
    "purchase_voice_template",
    "purchase_voice_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} comprou {{category_name}} no {{bot_name}}.' AFTER bot_name",
  );

  await ensureColumnExists(
    "balance_voice_template",
    "balance_voice_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} adicionou {{amount}} no {{bot_name}}.' AFTER purchase_voice_template",
  );
  await ensureColumnExists(
    "support_url",
    "support_url VARCHAR(300) NULL AFTER support_button_text",
  );
  await ensureColumnExists(
    "support_cta_body_text",
    "support_cta_body_text TEXT NOT NULL AFTER support_url",
  );
  await ensureColumnExists(
    "support_cta_footer_text",
    "support_cta_footer_text VARCHAR(60) NULL AFTER support_cta_body_text",
  );

  await db.query(
    `
      UPDATE admin_bot_config
      SET
        support_cta_body_text = CASE
          WHEN support_cta_body_text IS NULL OR TRIM(support_cta_body_text) = '' THEN 'Selecione uma opção para continuar.'
          ELSE support_cta_body_text
        END,
        support_cta_footer_text = CASE
          WHEN support_cta_footer_text IS NULL OR TRIM(support_cta_footer_text) = '' THEN 'StoreBot'
          ELSE support_cta_footer_text
        END
      WHERE id = 1
    `,
  );
  // Confirmações de pagamento (WhatsApp)
  await ensureColumnExists("plan_confirm_header_text", "plan_confirm_header_text VARCHAR(160) NULL");
  await ensureColumnExists("plan_confirm_body_text", "plan_confirm_body_text TEXT NULL");
  await ensureColumnExists("plan_confirm_button_text", "plan_confirm_button_text VARCHAR(60) NULL");
  await ensureColumnExists("plan_confirm_media_path", "plan_confirm_media_path VARCHAR(255) NULL");
  await ensureColumnExists("addon_confirm_header_text", "addon_confirm_header_text VARCHAR(160) NULL");
  await ensureColumnExists("addon_confirm_body_text", "addon_confirm_body_text TEXT NULL");
  await ensureColumnExists("addon_confirm_button_text", "addon_confirm_button_text VARCHAR(60) NULL");
  await ensureColumnExists("addon_confirm_media_path", "addon_confirm_media_path VARCHAR(255) NULL");
  // Painel/Grupos custom texts
  await ensureColumnExists("panel_header_text", "panel_header_text VARCHAR(160) NULL");
  await ensureColumnExists("panel_body_text", "panel_body_text TEXT NULL");
  await ensureColumnExists("panel_groups_row_title", "panel_groups_row_title VARCHAR(60) NULL");
  await ensureColumnExists("panel_groups_row_description", "panel_groups_row_description VARCHAR(255) NULL");
  await ensureColumnExists("panel_instances_row_title", "panel_instances_row_title VARCHAR(60) NULL");
  await ensureColumnExists("panel_instances_row_description", "panel_instances_row_description VARCHAR(255) NULL");
  await ensureColumnExists("panel_web_row_title", "panel_web_row_title VARCHAR(60) NULL");
  await ensureColumnExists("panel_web_row_description", "panel_web_row_description VARCHAR(255) NULL");
  await ensureColumnExists("panel_back_row_title", "panel_back_row_title VARCHAR(60) NULL");
  await ensureColumnExists("panel_back_row_description", "panel_back_row_description VARCHAR(255) NULL");
  await ensureColumnExists("group_actions_header_text", "group_actions_header_text VARCHAR(160) NULL");
  await ensureColumnExists("group_actions_body_text", "group_actions_body_text TEXT NULL");
  await ensureColumnExists("group_actions_button_text", "group_actions_button_text VARCHAR(60) NULL");
  await ensureColumnExists("group_actions_list_title", "group_actions_list_title VARCHAR(60) NULL");
  await ensureColumnExists("group_actions_list_desc", "group_actions_list_desc VARCHAR(255) NULL");
  await ensureColumnExists("group_actions_create_title", "group_actions_create_title VARCHAR(60) NULL");
  await ensureColumnExists("group_actions_create_desc", "group_actions_create_desc VARCHAR(255) NULL");
  await ensureColumnExists("group_actions_remove_title", "group_actions_remove_title VARCHAR(60) NULL");
  await ensureColumnExists("group_actions_remove_desc", "group_actions_remove_desc VARCHAR(255) NULL");
  await ensureColumnExists("group_actions_back_title", "group_actions_back_title VARCHAR(60) NULL");
  await ensureColumnExists("group_actions_back_desc", "group_actions_back_desc VARCHAR(255) NULL");
  await ensureColumnExists("group_select_instance_header_text", "group_select_instance_header_text VARCHAR(160) NULL");
  await ensureColumnExists("group_select_instance_body_text", "group_select_instance_body_text TEXT NULL");
  await ensureColumnExists("group_select_instance_button_text", "group_select_instance_button_text VARCHAR(60) NULL");
  await ensureColumnExists("group_delete_prompt_body_text", "group_delete_prompt_body_text TEXT NULL");
  await ensureColumnExists("group_delete_confirm_button_text", "group_delete_confirm_button_text VARCHAR(60) NULL");
  await ensureColumnExists("group_delete_cancel_button_text", "group_delete_cancel_button_text VARCHAR(60) NULL");
  await ensureColumnExists("web_panel_header_text", "web_panel_header_text VARCHAR(160) NULL");
  await ensureColumnExists("web_panel_body_text", "web_panel_body_text TEXT NULL");
  await ensureColumnExists("web_panel_button_text", "web_panel_button_text VARCHAR(60) NULL");
  await ensureColumnExists("signup_header_text", "signup_header_text VARCHAR(160) NULL");
  await ensureColumnExists("signup_body_text", "signup_body_text TEXT NULL");
  await ensureColumnExists("signup_email_invalid_text", "signup_email_invalid_text VARCHAR(160) NULL");
  await ensureColumnExists("signup_password_prompt_text", "signup_password_prompt_text VARCHAR(160) NULL");
  await ensureColumnExists("signup_success_header_text", "signup_success_header_text VARCHAR(160) NULL");
  await ensureColumnExists("signup_success_body_text", "signup_success_body_text TEXT NULL");
  await ensureColumnExists("signup_success_button_text", "signup_success_button_text VARCHAR(60) NULL");

  // New admin bot config columns (idempotent)
  await ensureColumnExists("subscription_plan_list_row_template", "subscription_plan_list_row_template TEXT NULL AFTER subscription_plan_list_footer_text");
  await ensureColumnExists("payment_method_picker_title", "payment_method_picker_title VARCHAR(160) NULL AFTER subscription_plan_list_row_template");
  await ensureColumnExists("payment_method_picker_body", "payment_method_picker_body TEXT NULL AFTER payment_method_picker_title");
  await ensureColumnExists("payment_method_picker_button_text", "payment_method_picker_button_text VARCHAR(60) NULL AFTER payment_method_picker_body");
  await ensureColumnExists("payment_method_pix_row_title", "payment_method_pix_row_title VARCHAR(60) NULL AFTER payment_method_picker_button_text");
  await ensureColumnExists("payment_method_pix_row_description", "payment_method_pix_row_description VARCHAR(255) NULL AFTER payment_method_pix_row_title");
  await ensureColumnExists("payment_method_checkout_row_title", "payment_method_checkout_row_title VARCHAR(60) NULL AFTER payment_method_pix_row_description");
  await ensureColumnExists("payment_method_checkout_row_description", "payment_method_checkout_row_description VARCHAR(255) NULL AFTER payment_method_checkout_row_title");
  await ensureColumnExists("payment_method_plan_details_template", "payment_method_plan_details_template TEXT NULL AFTER payment_method_checkout_row_description");
  await ensureColumnExists("pix_payment_header_text", "pix_payment_header_text VARCHAR(160) NULL AFTER payment_method_plan_details_template");
  await ensureColumnExists("pix_payment_body_text", "pix_payment_body_text TEXT NULL AFTER pix_payment_header_text");
  await ensureColumnExists("pix_payment_button_text", "pix_payment_button_text VARCHAR(60) NULL AFTER pix_payment_body_text");
  await ensureColumnExists("checkout_payment_header_text", "checkout_payment_header_text VARCHAR(160) NULL AFTER pix_payment_button_text");
  await ensureColumnExists("checkout_payment_body_text", "checkout_payment_body_text TEXT NULL AFTER checkout_payment_header_text");
  await ensureColumnExists("checkout_payment_button_text", "checkout_payment_button_text VARCHAR(60) NULL AFTER checkout_payment_body_text");
  await ensureColumnExists("addon_type_header_text", "addon_type_header_text VARCHAR(160) NULL AFTER checkout_payment_button_text");
  await ensureColumnExists("addon_type_body_text", "addon_type_body_text TEXT NULL AFTER addon_type_header_text");
  await ensureColumnExists("addon_type_instance_button_text", "addon_type_instance_button_text VARCHAR(60) NULL AFTER addon_type_body_text");
  await ensureColumnExists("addon_type_group_button_text", "addon_type_group_button_text VARCHAR(60) NULL AFTER addon_type_instance_button_text");
  await ensureColumnExists("addon_type_cancel_button_text", "addon_type_cancel_button_text VARCHAR(60) NULL AFTER addon_type_group_button_text");
  await ensureColumnExists("addon_quantity_header_text", "addon_quantity_header_text VARCHAR(160) NULL AFTER addon_type_cancel_button_text");
  await ensureColumnExists("addon_quantity_body_text", "addon_quantity_body_text TEXT NULL AFTER addon_quantity_header_text");
  await ensureColumnExists("addon_quantity_button_text", "addon_quantity_button_text VARCHAR(60) NULL AFTER addon_quantity_body_text");
  await ensureColumnExists("addon_quantity_cancel_row_text", "addon_quantity_cancel_row_text VARCHAR(60) NULL AFTER addon_quantity_button_text");
  await ensureColumnExists("instance_connected_header_text", "instance_connected_header_text VARCHAR(160) NULL AFTER checkout_payment_button_text");
  await ensureColumnExists("instance_connected_body_text", "instance_connected_body_text TEXT NULL AFTER instance_connected_header_text");
  await ensureColumnExists("instance_connected_link_group_button_text", "instance_connected_link_group_button_text VARCHAR(60) NULL AFTER instance_connected_body_text");
  await ensureColumnExists("instance_connected_later_button_text", "instance_connected_later_button_text VARCHAR(60) NULL AFTER instance_connected_link_group_button_text");
  await ensureColumnExists("group_create_header_text", "group_create_header_text VARCHAR(160) NULL AFTER instance_connected_later_button_text");
  await ensureColumnExists("group_create_body_text", "group_create_body_text TEXT NULL AFTER group_create_header_text");
  await ensureColumnExists("group_create_footer_text", "group_create_footer_text VARCHAR(255) NULL AFTER group_create_body_text");
  await ensureColumnExists("group_create_cancel_button_text", "group_create_cancel_button_text VARCHAR(60) NULL AFTER group_create_footer_text");

  await db.query(
    `
      INSERT INTO admin_bot_config (
        id,
        bot_name,
        purchase_voice_template,
        balance_voice_template,
        menu_text,
        menu_footer_text,
        panel_button_text,
        subscription_button_text,
        support_button_text,
        support_url,
        support_cta_body_text,
        support_cta_footer_text,
        menu_image_path,
        subscription_header_text,
        subscription_body_text,
        subscription_footer_text,
        subscription_renew_button_text,
        subscription_change_button_text,
        subscription_details_button_text,
        subscription_no_plan_header_text,
        subscription_no_plan_body_text,
        subscription_no_plan_button_text,
        subscription_plan_list_title,
        subscription_plan_list_body,
        subscription_plan_list_button_text,
        subscription_plan_list_footer_text
      ) VALUES (
        1,
        'StoreBot',
        '{{customer_name}} comprou {{category_name}} no {{bot_name}}.',
        '{{customer_name}} adicionou {{amount}} no {{bot_name}}.',
        'Olá {{user_first_name}},\n\nBem-vindo ao painel rápido do StoreBot pelo WhatsApp. Use os botões abaixo para navegar pelas funções principais.',
        'Selecione uma opção para continuar.',
        'Painel',
        'Assinatura',
        'Suporte',
        NULL,
        'Selecione uma opção para continuar.',
        'StoreBot',
        NULL,
        'Resumo do plano',
        'Plano: {{plan_name}}\nStatus: {{plan_status}}\nValor: {{plan_price}}\nVencimento: {{plan_renews_at}}',
        'Escolha uma ação para gerenciar sua assinatura.',
        'Renovar',
        'Mudar plano',
        'Ver detalhes',
        'Você ainda não possui um plano ativo.',
        'Escolha a melhor opção para iniciar sua assinatura do StoreBot e liberar todos os recursos.',
        'Assinar plano',
        'Planos disponíveis',
        'Selecione um dos planos abaixo para gerar o pagamento imediatamente.',
        'Escolher',
        'Após selecionar um plano enviaremos o link de pagamento automaticamente.'
      )
      ON DUPLICATE KEY UPDATE id = id
    `,
  );
  });

export const ensureUserNotificationAudioSettingsTable = async () =>
  runEnsure("user-notification-audio-settings", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_notification_audio_settings (
      user_id INT PRIMARY KEY,
      sounds_enabled TINYINT(1) NOT NULL DEFAULT 1,
      tts_enabled TINYINT(1) NOT NULL DEFAULT 1,
      speech_mode ENUM('browser', 'api') NOT NULL DEFAULT 'api',
      speech_voice VARCHAR(40) NOT NULL DEFAULT 'ludmilla',
      purchase_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} comprou {{category_name}} no {{bot_name}}.',
      balance_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} adicionou {{amount}} no {{bot_name}}.',
      raffle_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} garantiu {{ticket_quantity}} número(s) na {{raffle_name}}.',
      plan_template VARCHAR(160) NOT NULL DEFAULT '{{buyer_name}} confirmou o plano {{plan_name}} por {{amount}}.',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_notification_audio_settings_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [columns] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM user_notification_audio_settings LIKE ?",
      [column],
    );
    if (!Array.isArray(columns) || columns.length === 0) {
      await db.query(`ALTER TABLE user_notification_audio_settings ADD COLUMN ${definition}`);
    }
  };

  await ensureColumn(
    "raffle_template",
    "raffle_template VARCHAR(160) NOT NULL DEFAULT '{{customer_name}} garantiu {{ticket_quantity}} número(s) na {{raffle_name}}.' AFTER balance_template",
  );
  await ensureColumn(
    "plan_template",
    "plan_template VARCHAR(160) NOT NULL DEFAULT '{{buyer_name}} confirmou o plano {{plan_name}} por {{amount}}.' AFTER raffle_template",
  );
  });

export const ensureAdminEmailTemplatesTable = async () =>
  runEnsure("admin-email-templates", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_email_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_key VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      heading VARCHAR(255) NOT NULL,
      body_html LONGTEXT NOT NULL,
      cta_label VARCHAR(120) NULL,
      cta_url VARCHAR(255) NULL,
      footer_text VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const defaults: Array<[
    string,
    string,
    string,
    string,
    string,
    string | null,
    string | null,
    string | null
  ]> = [
    [
      "plan_payment_confirmation",
      "Confirmação de pagamento do plano",
      "Pagamento confirmado - {{planName}}",
      "Acesso liberado!",
      "<p>Olá, <strong>{{userName}}</strong>! Recebemos a confirmação do pagamento do plano <strong>{{planName}}</strong> no valor de <strong>{{amount}}</strong>.</p><p>Seu acesso ao StoreBot foi liberado imediatamente. Comece agora mesmo a configurar suas automações e aproveite os recursos exclusivos do plano selecionado.</p>",
      "Ir para o painel",
      "{{dashboardUrl}}",
      "Precisa de ajuda? Responda este e-mail e nossa equipe entrará em contato."
    ],
    [
      "user_registration",
      "Boas-vindas ao StoreBot",
      "Conta criada com sucesso",
      "Seja bem-vindo(a)!",
      "<p>Olá, <strong>{{userName}}</strong>! Sua conta foi criada e você já pode acessar o StoreBot para construir experiências incríveis para seus clientes.</p><p>Acesse o painel para configurar seu bot, cadastrar produtos e ativar os canais de atendimento.</p>",
      "Acessar o painel",
      "{{dashboardUrl}}",
      "Estamos por aqui para o que precisar."
    ],
    [
      "bot_sale_notification",
      "Nova venda no seu bot",
      "Você recebeu uma nova venda",
      "Venda aprovada!",
      "<p>Olá, <strong>{{userName}}</strong>! Uma nova venda foi confirmada no seu bot pelo valor de <strong>{{amount}}</strong>.</p><p>Forma de pagamento: <strong>{{paymentMethod}}</strong>.</p><p>Cliente: {{customer}}</p>",
      "Ver detalhes",
      "{{salesUrl}}",
      "Continue oferecendo a melhor experiência para os seus clientes."
    ],
    [
      "generic_notification",
      "Notificação StoreBot",
      "{{subject}}",
      "Olá!",
      "<p>Esta é uma mensagem automática do StoreBot.</p><p>{{message}}</p>",
      null,
      null,
      "Equipe StoreBot"
    ],
  ];

  await Promise.all(
    defaults.map(async (entry) => {
      await db.query(
        `
          INSERT INTO admin_email_templates (
            template_key,
            name,
            subject,
            heading,
            body_html,
            cta_label,
            cta_url,
            footer_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE template_key = template_key
        `,
        entry,
      );
    }),
  );
  });

export const ensureUserPlanSubscriptionTable = async () =>
  runEnsure("user-plan-subscription", async () => {
  await ensureSubscriptionPlanTable();
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
    CREATE TABLE IF NOT EXISTS user_plan_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      plan_id INT NOT NULL,
      auto_renew_plan TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('pending','active','expired','cancelled') NOT NULL DEFAULT 'pending',
      current_period_start DATETIME NULL,
      current_period_end DATETIME NULL,
      cancelled_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_plan_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_plan_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
    ) ENGINE=InnoDB;
  `);
  });

  const ensureColumn = async (column: string, definition: string) => {
    await withDbRetry(async () => {
      const db = getDb();
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM user_plan_subscriptions LIKE ?",
        [column],
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(`ALTER TABLE user_plan_subscriptions ADD COLUMN ${definition};`);
      }
    });
  };

  await ensureColumn(
    "auto_renew_plan",
    "auto_renew_plan TINYINT(1) NOT NULL DEFAULT 0 AFTER plan_id",
  );
  await ensureColumn(
    "is_trial",
    "is_trial TINYINT(1) NOT NULL DEFAULT 0 AFTER status",
  );
  await ensureColumn(
    "metadata",
    "metadata LONGTEXT NULL AFTER cancelled_at",
  );
  });

export const ensureUserPlanPaymentTable = async () =>
  runEnsure("user-plan-payment", async () => {
  await ensureSubscriptionPlanTable();
  await ensureUserPlanSubscriptionTable();
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
    CREATE TABLE IF NOT EXISTS user_plan_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      plan_id INT NOT NULL,
      subscription_id INT NULL,
      provider VARCHAR(64) NOT NULL,
      provider_payment_id VARCHAR(128) NOT NULL,
      status VARCHAR(64) NOT NULL,
      status_detail VARCHAR(64) NULL,
      amount DECIMAL(12, 2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
      metadata LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_plan_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_plan_payments_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
      CONSTRAINT fk_user_plan_payments_subscription FOREIGN KEY (subscription_id) REFERENCES user_plan_subscriptions(id) ON DELETE SET NULL,
      CONSTRAINT unique_user_plan_payment UNIQUE KEY unique_user_plan_payment (provider, provider_payment_id)
    ) ENGINE=InnoDB;
  `);
  });
  });

export const ensureUserPlanAddonTable = async () =>
  runEnsure("user-plan-addon", async () => {
  await ensureUserPlanSubscriptionTable();
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
    CREATE TABLE IF NOT EXISTS user_plan_addons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      subscription_id INT NULL,
      addon_type ENUM('instance','group') NOT NULL,
      quantity INT NOT NULL,
      auto_renew TINYINT(1) NOT NULL DEFAULT 0,
      purchased_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NULL,
      metadata JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_plan_addons_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_plan_addons_subscription FOREIGN KEY (subscription_id) REFERENCES user_plan_subscriptions(id) ON DELETE SET NULL,
      INDEX idx_plan_addons_user (user_id),
      INDEX idx_plan_addons_type (addon_type, expires_at)
    ) ENGINE=InnoDB;
  `);
  });

  const ensureColumn = async (column: string, definition: string) => {
    await withDbRetry(async () => {
      const db = getDb();
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM user_plan_addons LIKE ?",
        [column],
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(`ALTER TABLE user_plan_addons ADD COLUMN ${definition};`);
      }
    });
  };

  await ensureColumn(
    "auto_renew",
    "auto_renew TINYINT(1) NOT NULL DEFAULT 0 AFTER quantity",
  );
  });

export const ensureBotServerTable = async () =>
  runEnsure("bot-server", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_servers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      base_url VARCHAR(500) NOT NULL,
      api_type VARCHAR(50) NOT NULL DEFAULT 'wuzapi',
      global_api_key VARCHAR(255) NOT NULL,
      session_limit INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bot_servers_name (name)
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_servers LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_servers ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("api_type", "api_type VARCHAR(50) NOT NULL DEFAULT 'wuzapi'");
  await ensureColumn("session_limit", "session_limit INT NOT NULL DEFAULT 0");
  await ensureColumn("is_active", "is_active TINYINT(1) NOT NULL DEFAULT 1");
  });

export const ensureBotInstanceTable = async () =>
  runEnsure("bot-instance", async () => {
  const db = getDb();
  await ensureUserTable();
  await ensureBotServerTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_instances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      profile_id INT NULL,
      server_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      token VARCHAR(255) NOT NULL,
      base_url VARCHAR(500) NOT NULL,
      remote_id VARCHAR(255) NULL,
      webhook_url VARCHAR(500) NULL,
      events VARCHAR(255) NULL,
      auto_read TINYINT(1) NOT NULL DEFAULT 0,
      pv_enabled TINYINT(1) NOT NULL DEFAULT 0,
      license_sales_enabled TINYINT(1) NOT NULL DEFAULT 0,
      purpose VARCHAR(40) NOT NULL DEFAULT 'profile',
      session_status VARCHAR(40) NOT NULL DEFAULT 'desconectado',
      desired_session_state VARCHAR(20) NOT NULL DEFAULT 'connected',
      last_status_sync DATETIME NULL,
      expires_at DATETIME NULL,
      plan_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bot_instances_token (token),
      CONSTRAINT fk_bot_instances_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bot_instances_server FOREIGN KEY (server_id) REFERENCES bot_servers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_instances LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_instances ADD COLUMN ${definition};`);
    }
  };

  const ensureIndex = async (index: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM bot_instances WHERE Key_name = ?",
      [index],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_instances ADD ${definition};`);
    }
  };

  const dropOldUniquePhoneIndex = async () => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM bot_instances WHERE Column_name = 'phone'",
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      return;
    }

    const indexMap = new Map<string, RowDataPacket[]>();
    existing.forEach((row) => {
      const keyName = String(row.Key_name ?? "").trim();
      if (!keyName || keyName === "PRIMARY") {
        return;
      }

      const current = indexMap.get(keyName) ?? [];
      current.push(row);
      indexMap.set(keyName, current);
    });

    for (const [keyName, rows] of indexMap.entries()) {
      const isUnique = rows.every((row) => Number(row.Non_unique ?? 1) === 0);
      const isSingleColumnPhoneIndex =
        rows.length === 1 &&
        Number(rows[0].Seq_in_index ?? 0) === 1 &&
        String(rows[0].Column_name ?? "").trim() === "phone";

      if (isUnique && isSingleColumnPhoneIndex) {
        const escapedKeyName = keyName.replace(/`/g, "``");
        await db.query(`ALTER TABLE bot_instances DROP INDEX \`${escapedKeyName}\`;`);
      }
    }
  };

  await ensureColumn("pv_enabled", "pv_enabled TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("license_sales_enabled", "license_sales_enabled TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("purpose", "purpose VARCHAR(40) NOT NULL DEFAULT 'profile'");
  const [pvColumn] = await db.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM bot_instances LIKE 'pv_enabled'",
  );

  if (Array.isArray(pvColumn) && pvColumn.length > 0) {
    const info = pvColumn[0];
    const defaultValue = info.Default;
    const needsUpdate =
      info.Null !== "NO" ||
      defaultValue === null ||
      defaultValue === "" ||
      defaultValue === "1" ||
      defaultValue === 1;

    if (needsUpdate) {
      await db.query(
        "ALTER TABLE bot_instances MODIFY pv_enabled TINYINT(1) NOT NULL DEFAULT 0;",
      );
    }
  }
  await ensureColumn("session_status", "session_status VARCHAR(40) NOT NULL DEFAULT 'desconectado'");
  await ensureColumn(
    "desired_session_state",
    "desired_session_state VARCHAR(20) NOT NULL DEFAULT 'connected' AFTER session_status",
  );
  await ensureColumn("last_status_sync", "last_status_sync DATETIME NULL");
  await ensureColumn("expires_at", "expires_at DATETIME NULL");
  await ensureColumn("plan_id", "plan_id INT NULL");
  await ensureIndex("uq_bot_instances_token", "UNIQUE KEY uq_bot_instances_token (token)");
  await ensureIndex("idx_bot_instances_purpose", "KEY idx_bot_instances_purpose (purpose)");
  await dropOldUniquePhoneIndex();
  });

export const ensureBotInstanceProxyTable = async () =>
  runEnsure("bot-instance-proxy", async () => {
    await ensureBotInstanceTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_instance_proxies (
        instance_id INT NOT NULL PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        protocol VARCHAR(16) NOT NULL DEFAULT 'socks5',
        host VARCHAR(255) NULL,
        port INT NULL,
        username_encrypted TEXT NULL,
        password_encrypted TEXT NULL,
        source VARCHAR(32) NOT NULL DEFAULT 'customer',
        resolved_ip VARCHAR(64) NULL,
        country_code VARCHAR(8) NULL,
        country_name VARCHAR(120) NULL,
        region_name VARCHAR(160) NULL,
        city_name VARCHAR(160) NULL,
        timezone_name VARCHAR(80) NULL,
        isp_name VARCHAR(255) NULL,
        latency_ms INT NULL,
        checked_at DATETIME NULL,
        applied_at DATETIME NULL,
        last_error VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_bot_instance_proxy_instance
          FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE,
        INDEX idx_bot_instance_proxy_enabled (enabled, checked_at)
      ) ENGINE=InnoDB;
    `);

    // Prevent two enabled instances from sharing the same network endpoint.
    // Including `enabled` keeps historical/disabled configurations harmless.
    const [existingIndex] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM bot_instance_proxies WHERE Key_name = ?",
      ["uq_bot_instance_proxy_endpoint"],
    );
    if (!Array.isArray(existingIndex) || existingIndex.length === 0) {
      try {
        await db.query(
          "ALTER TABLE bot_instance_proxies ADD UNIQUE KEY uq_bot_instance_proxy_endpoint (enabled, host, port)",
        );
      } catch (error) {
        // Do not prevent the application from starting if an old database
        // already contains duplicate routes. The application-level check in
        // instance-proxy.ts still rejects new reuse; an administrator can
        // clean the legacy duplicates and a migration can then create this
        // stronger database constraint explicitly.
        console.warn("[proxy] could not create endpoint uniqueness index", error);
      }
    }

    // Different proxy hostnames can still expose the same public egress IP.
    // Keep that identity exclusive too; NULL is allowed for disabled or
    // legacy rows and therefore does not prevent their migration.
    const [existingEgressIndex] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM bot_instance_proxies WHERE Key_name = ?",
      ["uq_bot_instance_proxy_egress_ip"],
    );
    if (!Array.isArray(existingEgressIndex) || existingEgressIndex.length === 0) {
      try {
        await db.query(
          "ALTER TABLE bot_instance_proxies ADD UNIQUE KEY uq_bot_instance_proxy_egress_ip (enabled, resolved_ip)",
        );
      } catch (error) {
        // Preserve availability when legacy data contains duplicate egress
        // values. The application-level check still rejects new assignments;
        // cleanup can be performed explicitly before retrying this index.
        console.warn("[proxy] could not create egress-IP uniqueness index", error);
      }
    }
  });

export const ensureBotInstanceSettingsTable = async () =>
  runEnsure("bot-instance-settings", async () => {
  const db = getDb();
  await ensureBotInstanceTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_instance_settings (
      instance_id INT NOT NULL PRIMARY KEY,
      command_toggles JSON NULL,
      auto_responses JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_bot_instance_settings_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_instance_settings LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_instance_settings ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("command_toggles", "command_toggles JSON NULL");
  await ensureColumn("auto_response_counters", "auto_response_counters JSON NULL");
  await ensureColumn("auto_responses", "auto_responses JSON NULL");
  });

export const ensureBotGroupTable = async () =>
  runEnsure("bot-group", async () => {
  const db = getDb();
  await ensureBotInstanceTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      instance_id INT NULL,
      slot INT NOT NULL DEFAULT 0,
      remote_id VARCHAR(128) NOT NULL,
      invite_code VARCHAR(128) NULL,
      invite_link TEXT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      image_url TEXT NULL,
      owner VARCHAR(64) NULL,
      awaiting_approval TINYINT(1) NOT NULL DEFAULT 0,
      awaiting_entry TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      participants JSON NULL,
      metadata JSON NULL,
      group_synced_at DATETIME NULL,
      participants_synced_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bot_groups_instance_remote (instance_id, remote_id),
      KEY idx_bot_groups_user (user_id),
      KEY idx_bot_groups_instance (instance_id),
      CONSTRAINT fk_bot_groups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bot_groups_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_groups LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_groups ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("slot", "slot INT NOT NULL DEFAULT 0 AFTER instance_id");
  const [slotColumnRows] = await db.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM bot_groups LIKE 'slot'",
  );
  const slotColumn = Array.isArray(slotColumnRows) ? slotColumnRows[0] : null;
  if (
    slotColumn &&
    (String(slotColumn.Type).toLowerCase() !== "int" ||
      String(slotColumn.Null).toUpperCase() !== "NO" ||
      String(slotColumn.Default ?? "") !== "0")
  ) {
    await db.query("ALTER TABLE bot_groups MODIFY slot INT NOT NULL DEFAULT 0");
  }
  await ensureColumn("invite_code", "invite_code VARCHAR(128) NULL AFTER remote_id");
  await ensureColumn("invite_link", "invite_link TEXT NULL AFTER invite_code");
  await ensureColumn("image_url", "image_url TEXT NULL AFTER description");
  await ensureColumn("owner", "owner VARCHAR(64) NULL AFTER image_url");
  await ensureColumn("awaiting_entry", "awaiting_entry TINYINT(1) NOT NULL DEFAULT 0 AFTER awaiting_approval");
  await ensureColumn("status", "status ENUM('active','disabled') NOT NULL DEFAULT 'active' AFTER awaiting_entry");
  await ensureColumn("participants", "participants JSON NULL AFTER status");
  await ensureColumn("metadata", "metadata JSON NULL AFTER participants");
  await ensureColumn("group_synced_at", "group_synced_at DATETIME NULL AFTER metadata");
  await ensureColumn("participants_synced_at", "participants_synced_at DATETIME NULL AFTER group_synced_at");
  await db.query("UPDATE bot_groups SET slot = 0 WHERE status = 'disabled' AND slot <> 0");

  // Um mesmo grupo pode ter mais de um bot cadastrado, desde que apenas um
  // deles esteja ativo. A chave global antiga fazia o grupo continuar preso
  // ao primeiro bot mesmo depois de pausado.
  const [instanceRemoteIndexRows] = await db.query<RowDataPacket[]>(
    "SHOW INDEX FROM bot_groups WHERE Key_name = ?",
    ["uq_bot_groups_instance_remote"],
  );
  if (!Array.isArray(instanceRemoteIndexRows) || instanceRemoteIndexRows.length === 0) {
    await db.query(
      "ALTER TABLE bot_groups ADD UNIQUE KEY uq_bot_groups_instance_remote (instance_id, remote_id)",
    );
  }

  const [legacyRemoteIndexRows] = await db.query<RowDataPacket[]>(
    "SHOW INDEX FROM bot_groups WHERE Key_name = ?",
    ["uq_bot_groups_remote"],
  );
  if (Array.isArray(legacyRemoteIndexRows) && legacyRemoteIndexRows.length > 0) {
    await db.query("ALTER TABLE bot_groups DROP INDEX `uq_bot_groups_remote`");
  }

  const [instanceColumnRows] = await db.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM bot_groups LIKE 'instance_id'",
  );
  const instanceColumn = Array.isArray(instanceColumnRows) ? instanceColumnRows[0] : null;
  if (
    instanceColumn &&
    (String(instanceColumn.Type).toLowerCase() !== "int" ||
      String(instanceColumn.Null).toUpperCase() !== "YES")
  ) {
    await db.query("ALTER TABLE bot_groups MODIFY instance_id INT NULL");
  }

  const [instanceFkRows] = await db.query<RowDataPacket[]>(
    `
      SELECT
        rc.CONSTRAINT_NAME AS constraint_name,
        rc.DELETE_RULE AS delete_rule
      FROM information_schema.REFERENTIAL_CONSTRAINTS rc
      INNER JOIN information_schema.KEY_COLUMN_USAGE kcu
        ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
       AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND rc.TABLE_NAME = kcu.TABLE_NAME
      WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
        AND rc.TABLE_NAME = 'bot_groups'
        AND rc.REFERENCED_TABLE_NAME = 'bot_instances'
        AND kcu.COLUMN_NAME = 'instance_id'
    `,
  );

  let hasExpectedInstanceFk = false;
  if (Array.isArray(instanceFkRows)) {
    for (const row of instanceFkRows) {
      const constraintName = typeof row.constraint_name === "string" ? row.constraint_name : "";
      const deleteRule = typeof row.delete_rule === "string" ? row.delete_rule.toUpperCase() : "";

      if (constraintName === "fk_bot_groups_instance" && deleteRule === "SET NULL") {
        hasExpectedInstanceFk = true;
        continue;
      }

      if (constraintName) {
        try {
          await db.query(`ALTER TABLE bot_groups DROP FOREIGN KEY \`${constraintName}\``);
        } catch {
          // ignore
        }
      }
    }
  }

  if (!hasExpectedInstanceFk) {
    await db.query(
      `
        ALTER TABLE bot_groups
        ADD CONSTRAINT fk_bot_groups_instance
        FOREIGN KEY (instance_id) REFERENCES bot_instances(id)
        ON DELETE SET NULL
      `,
    ).catch(() => {});
  }
  });

export const ensureBotGroupShareTable = async () =>
  runEnsure("bot-group-share", async () => {
    const db = getDb();
    await ensureBotGroupTable();
    await ensureUserTable();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_group_shares (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        owner_user_id INT NOT NULL,
        shared_user_id INT NOT NULL,
        granted_by_user_id INT NULL,
        role ENUM('admin') NOT NULL DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bot_group_shares_user (group_id, shared_user_id),
        KEY idx_bot_group_shares_shared_user (shared_user_id),
        KEY idx_bot_group_shares_owner (owner_user_id),
        CONSTRAINT fk_bot_group_shares_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_group_shares_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_group_shares_shared FOREIGN KEY (shared_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_group_shares_granted_by FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);
  });

export const ensureBotGroupSettingsTable = async () =>
  runEnsure("bot-group-settings", async () => {
  const db = getDb();
  await ensureBotGroupTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_group_settings (
      group_id INT NOT NULL PRIMARY KEY,
      antilink TINYINT(1) NOT NULL DEFAULT 0,
      antilink_group_invite TINYINT(1) NOT NULL DEFAULT 0,
      ban_extremo TINYINT(1) NOT NULL DEFAULT 0,
      auto_read TINYINT(1) NOT NULL DEFAULT 1,
      allowed_links MEDIUMTEXT NULL,
      feature_flags JSON NULL,
      allowed_ddis TEXT NULL,
      banned_words TEXT NULL,
      max_infractions INT NOT NULL DEFAULT 3,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_bot_group_settings_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_group_settings LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_group_settings ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("antilink", "antilink TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("antilink_group_invite", "antilink_group_invite TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("ban_extremo", "ban_extremo TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("auto_read", "auto_read TINYINT(1) NOT NULL DEFAULT 1");
  await ensureColumn("allowed_links", "allowed_links MEDIUMTEXT NULL");
  await ensureColumn("feature_flags", "feature_flags JSON NULL");
  await ensureColumn("allowed_ddis", "allowed_ddis TEXT NULL");
  await ensureColumn("banned_words", "banned_words TEXT NULL");
  await ensureColumn("max_infractions", "max_infractions INT NOT NULL DEFAULT 3");
  await ensureColumn("language", "language VARCHAR(16) NOT NULL DEFAULT 'ptbr'");
  await ensureColumn("command_flags", "command_flags JSON NULL");
  await ensureColumn("command_prefixes", "command_prefixes TEXT NULL");
  await ensureColumn(
    "allow_commands_without_prefix",
    "allow_commands_without_prefix TINYINT(1) NOT NULL DEFAULT 0",
  );
  await ensureColumn("menu_texts", "menu_texts JSON NULL");
  await ensureColumn("menu_carousel", "menu_carousel JSON NULL");
  await ensureColumn("welcome_config", "welcome_config JSON NULL");
  await ensureColumn("auto_responses", "auto_responses JSON NULL");
  await ensureColumn("command_aliases", "command_aliases JSON NULL");
  await ensureColumn("muted_members", "muted_members JSON NULL");
  await ensureColumn("blacklist_members", "blacklist_members JSON NULL");
  await ensureColumn("command_aliases", "command_aliases JSON NULL");
  await ensureColumn("groq_keys", "groq_keys TEXT NULL");
  await ensureColumn("ai_provider", "ai_provider VARCHAR(32) NOT NULL DEFAULT 'groq'");
  await ensureColumn("openai_api_key", "openai_api_key TEXT NULL");
  await ensureColumn("ai_prompt", "ai_prompt TEXT NULL");
  await ensureColumn("ai_tools_prompt", "ai_tools_prompt TEXT NULL");
  await ensureColumn("ai_voice", "ai_voice VARCHAR(64) NULL");
  await ensureColumn("ai_model", "ai_model VARCHAR(128) NULL");
  await ensureColumn("ai_memory", "ai_memory JSON NULL");
  await ensureColumn("antifake_message", "antifake_message TEXT NULL");
  await ensureColumn(
    "antipalavras_max_infractions",
    "antipalavras_max_infractions INT NOT NULL DEFAULT 5",
  );
  await ensureColumn(
    "ai_last_interaction_at",
    "ai_last_interaction_at TIMESTAMP NULL DEFAULT NULL",
  );
  await ensureColumn("ads_config", "ads_config JSON NULL");
  await ensureColumn("schedule_config", "schedule_config JSON NULL");
  await ensureColumn("horapg_config", "horapg_config JSON NULL");
  await ensureColumn("anti_inactivity_config", "anti_inactivity_config JSON NULL");
  await ensureColumn("antispam_config", "antispam_config JSON NULL");
  await ensureColumn("last_mark_message", "last_mark_message JSON NULL");
  await ensureColumn("last_broadcast_template", "last_broadcast_template JSON NULL");
  await ensureColumn("rules_message", "rules_message JSON NULL");
  await ensureColumn("table_message", "table_message JSON NULL");
  await ensureColumn("unknown_command_template", "unknown_command_template TEXT NULL");
  await ensureColumn(
    "plan_renewal_admins_only",
    "plan_renewal_admins_only TINYINT(1) NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    "plan_renewal_silent",
    "plan_renewal_silent TINYINT(1) NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    "mute_ban_limit",
    "mute_ban_limit INT NOT NULL DEFAULT 3",
  );
  await ensureColumn("premium_config", "premium_config JSON NULL");
  await ensureColumn("bot_coins_config", "bot_coins_config JSON NULL");
  });

export const ensureBotGroupMutesTable = async () =>
  runEnsure("bot-group-mutes", async () => {
  const db = getDb();
  await ensureBotGroupTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_group_mutes (
      group_id INT NOT NULL,
      member_jid VARCHAR(128) NOT NULL,
      ban_after_messages INT NOT NULL DEFAULT 3,
      deleted_count INT NOT NULL DEFAULT 0,
      last_warned_count INT NOT NULL DEFAULT 0,
      muted_by VARCHAR(128) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, member_jid),
      INDEX idx_bot_group_mutes_group (group_id),
      CONSTRAINT fk_bot_group_mutes_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_group_mutes LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_group_mutes ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("ban_after_messages", "ban_after_messages INT NOT NULL DEFAULT 3");
  await ensureColumn("deleted_count", "deleted_count INT NOT NULL DEFAULT 0");
  await ensureColumn("last_warned_count", "last_warned_count INT NOT NULL DEFAULT 0");
  await ensureColumn("muted_by", "muted_by VARCHAR(128) NULL");
  });

export const ensureBotGroupInfractionsTable = async () =>
  runEnsure("bot-group-infractions", async () => {
  const db = getDb();
  await ensureBotGroupTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_group_infractions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      member_jid VARCHAR(128) NOT NULL,
      reason VARCHAR(32) NOT NULL DEFAULT 'link',
      count INT NOT NULL DEFAULT 1,
      last_occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_group_member_reason (group_id, member_jid, reason),
      CONSTRAINT fk_bot_group_infractions_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM bot_group_infractions LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE bot_group_infractions ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("reason", "reason VARCHAR(32) NOT NULL DEFAULT 'link'");
  await ensureColumn("count", "count INT NOT NULL DEFAULT 1");
  await ensureColumn("last_occurred_at", "last_occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  });

export const ensureBotSweepstakesTable = async () =>
  runEnsure("bot-sweepstakes", async () => {
  await ensureBotInstanceTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_sweepstakes (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      instance_id INT NOT NULL,
      group_jid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
      poll_message_id VARCHAR(128) NOT NULL,
      poll_id VARCHAR(128) NOT NULL,
      question TEXT NOT NULL,
      join_option_hash VARCHAR(128) NOT NULL,
      options JSON NULL,
      participants JSON NULL,
      winners JSON NULL,
      max_participants INT NULL,
      winners_count INT NOT NULL DEFAULT 1,
      status ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
      expires_at DATETIME NOT NULL,
      created_by VARCHAR(64) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      concluded_at DATETIME NULL,
      metadata JSON NULL,
      message_key VARCHAR(255) NULL,
      UNIQUE KEY uq_bot_sweepstakes_poll (instance_id, poll_id),
      INDEX idx_bot_sweepstakes_status (status, expires_at),
      INDEX idx_bot_sweepstakes_group (group_jid),
      CONSTRAINT fk_bot_sweepstakes_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
  await db.query(`
    ALTER TABLE bot_sweepstakes
    MODIFY group_jid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
  `);
  });

export const ensureBotGroupRankingTable = async () =>
  runEnsure("bot-group-ranking", async () => {
  await ensureBotGroupTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_group_ranking (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      member_jid VARCHAR(64) NOT NULL,
      score INT NOT NULL DEFAULT 1,
      first_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_group_member (group_id, member_jid),
      INDEX idx_group_ranking_group (group_id),
      INDEX idx_group_ranking_score (group_id, score),
      CONSTRAINT fk_bot_group_ranking_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
});

export const ensureBotGroupRankingPeriodTable = async () =>
  runEnsure("bot-group-ranking-periods", async () => {
  await ensureBotGroupTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_group_ranking_periods (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      member_jid VARCHAR(64) NOT NULL,
      period_type ENUM('weekly','monthly') NOT NULL,
      period_key VARCHAR(16) NOT NULL,
      score INT NOT NULL DEFAULT 0,
      last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_group_member_period (group_id, member_jid, period_type, period_key),
      INDEX idx_period_group (group_id, period_type, period_key, score),
      CONSTRAINT fk_bot_group_ranking_period_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
});

export const ensureBotGroupCoinsTable = async () =>
  runEnsure("bot-group-coins-cleanup", async () => {
  await ensureBotGroupTable();
  const db = getDb();
  await db.query("DROP TABLE IF EXISTS bot_group_coin_ledger;");
  await db.query("DROP TABLE IF EXISTS bot_group_coin_rewards;");
  await db.query("DROP TABLE IF EXISTS bot_group_coin_items;");
  await db.query("DROP TABLE IF EXISTS bot_group_coins;");
});

export const ensureBotGroupCoinItemsTable = async () =>
  runEnsure("bot-group-coin-items-cleanup", async () => {
  await ensureBotGroupTable();
  const db = getDb();
  await db.query("DROP TABLE IF EXISTS bot_group_coin_items;");
});

export const ensureBotGroupPremiumMembersTable = async () =>
  runEnsure("bot-group-premium-members", async () => {
  await ensureBotGroupTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_group_premium_members (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      member_jid VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_group_premium_member (group_id, member_jid),
      INDEX idx_group_premium_exp (group_id, expires_at),
      CONSTRAINT fk_bot_group_premium_members_group FOREIGN KEY (group_id) REFERENCES bot_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
});

export const ensureBotGroupCoinRewardsTable = async () =>
  runEnsure("bot-group-coin-rewards-cleanup", async () => {
  await ensureBotGroupTable();
  const db = getDb();
  await db.query("DROP TABLE IF EXISTS bot_group_coin_rewards;");
});

export const ensureBotGroupCoinLedgerTable = async () =>
  runEnsure("bot-group-coin-ledger-cleanup", async () => {
  await ensureBotGroupTable();
  const db = getDb();
  await db.query("DROP TABLE IF EXISTS bot_group_coin_ledger;");
});

export const ensureUserBalancePaymentTable = async () =>
  runEnsure("user-balance-payment", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_balance_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      provider VARCHAR(64) NOT NULL,
      provider_payment_id VARCHAR(128) NOT NULL,
      status VARCHAR(64) NOT NULL,
      status_detail VARCHAR(64) NULL,
      amount DECIMAL(12, 2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
      metadata LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_balance_payments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT unique_user_balance_payment UNIQUE KEY unique_user_balance_payment (provider, provider_payment_id)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureUserBotResaleLedgerTable = async () =>
  runEnsure("user-bot-resale-ledger", async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_bot_resale_ledger (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        entry_type VARCHAR(32) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        plan_payment_id VARCHAR(128) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'completed',
        metadata LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_user_bot_resale_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_bot_resale_sale_credit (user_id, plan_payment_id, entry_type)
      ) ENGINE=InnoDB;
    `);
  });

/**
 * Tables shared by the partner/reseller program.  They are deliberately
 * separate from `users.role`: existing accounts keep their `admin`/`user`
 * role while a scoped panel role and reseller relationship are attached here.
 * Every ensure is idempotent so blue/green boots can run it concurrently.
 */
export const ensurePartnerProgramTables = async () =>
  runEnsure("partner-program", async () => {
    await ensureUserTable();
    await ensureSubscriptionPlanTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_panel_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        role VARCHAR(32) NOT NULL DEFAULT 'support',
        permissions JSON NULL,
        commission_rate DECIMAL(5,2) NOT NULL DEFAULT 20.00,
        status ENUM('active','suspended') NOT NULL DEFAULT 'active',
        invited_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_admin_panel_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_admin_panel_member_inviter FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_admin_panel_member_role (role, status)
      ) ENGINE=InnoDB;
    `);
    const [memberColumns] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_panel_members LIKE 'commission_rate'",
    );
    if (!memberColumns.length) {
      await db.query(
        "ALTER TABLE admin_panel_members ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 20.00 AFTER permissions",
      );
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS reseller_wallets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reseller_user_id INT NOT NULL UNIQUE,
        credit_balance INT NOT NULL DEFAULT 0,
        reserved_credits INT NOT NULL DEFAULT 0,
        commission_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_reseller_wallet_user FOREIGN KEY (reseller_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS reseller_credit_ledger (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        wallet_id INT NOT NULL,
        entry_type VARCHAR(32) NOT NULL,
        credits INT NOT NULL,
        idempotency_key VARCHAR(128) NULL,
        reference_id VARCHAR(128) NULL,
        metadata JSON NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_reseller_credit_wallet FOREIGN KEY (wallet_id) REFERENCES reseller_wallets(id) ON DELETE CASCADE,
        CONSTRAINT fk_reseller_credit_actor FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE KEY uq_reseller_credit_idempotency (wallet_id, idempotency_key),
        INDEX idx_reseller_credit_created (wallet_id, created_at)
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS reseller_customer_links (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        reseller_user_id INT NOT NULL,
        customer_user_id INT NOT NULL,
        plan_id INT NULL,
        status ENUM('active','suspended','ended') NOT NULL DEFAULT 'active',
        source VARCHAR(32) NOT NULL DEFAULT 'reseller',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_reseller_customer (reseller_user_id, customer_user_id),
        CONSTRAINT fk_reseller_link_reseller FOREIGN KEY (reseller_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_reseller_link_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_reseller_link_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL,
        INDEX idx_reseller_link_customer (customer_user_id, status)
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_user_id INT NOT NULL,
        action VARCHAR(80) NOT NULL,
        target_type VARCHAR(40) NULL,
        target_id VARCHAR(128) NULL,
        before_data JSON NULL,
        after_data JSON NULL,
        ip_address VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_partner_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_partner_audit_actor (actor_user_id, created_at),
        INDEX idx_partner_audit_target (target_type, target_id, created_at)
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_payment_accounts (
        user_id INT NOT NULL PRIMARY KEY,
        provider VARCHAR(32) NOT NULL DEFAULT 'mercadopago',
        status ENUM('pending','connected','error','disconnected') NOT NULL DEFAULT 'pending',
        provider_user_id VARCHAR(80) NULL,
        nickname VARCHAR(160) NULL,
        email VARCHAR(255) NULL,
        access_token_encrypted TEXT NULL,
        refresh_token_encrypted TEXT NULL,
        token_expires_at DATETIME NULL,
        scopes TEXT NULL,
        last_error VARCHAR(500) NULL,
        connected_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_partner_payment_account_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_partner_payment_status (provider, status)
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_credit_orders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        public_id VARCHAR(80) NOT NULL UNIQUE,
        buyer_user_id INT NOT NULL,
        seller_user_id INT NULL,
        credit_count INT NOT NULL,
        unit_price DECIMAL(12,2) NOT NULL,
        total_amount DECIMAL(12,2) NOT NULL,
        platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
        provider VARCHAR(32) NOT NULL DEFAULT 'mercadopago_checkout',
        provider_preference_id VARCHAR(128) NULL,
        provider_payment_id VARCHAR(128) NULL,
        checkout_url TEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        metadata JSON NULL,
        approved_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_partner_credit_buyer FOREIGN KEY (buyer_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_partner_credit_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE KEY uq_partner_credit_payment (provider, provider_payment_id),
        INDEX idx_partner_credit_buyer (buyer_user_id, created_at),
        INDEX idx_partner_credit_status (status, created_at)
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_financial_settings (
        user_id INT NOT NULL PRIMARY KEY,
        credit_unit_price DECIMAL(12,2) NOT NULL DEFAULT 29.90,
        manual_payments_enabled TINYINT(1) NOT NULL DEFAULT 0,
        allow_child_manual_payments TINYINT(1) NOT NULL DEFAULT 0,
        manual_pix_key VARCHAR(255) NULL,
        manual_instructions VARCHAR(1000) NULL,
        proxy_sales_mode VARCHAR(32) NOT NULL DEFAULT 'manual',
        proxy_monthly_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        allow_customer_proxy TINYINT(1) NOT NULL DEFAULT 1,
        proxy_sales_instructions VARCHAR(1000) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_partner_financial_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    const ensurePartnerFinancialColumn = async (column: string, definition: string) => {
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM partner_financial_settings LIKE ?",
        [column],
      );
      if (!rows.length) {
        await db.query(`ALTER TABLE partner_financial_settings ADD COLUMN ${definition}`);
      }
    };
    await ensurePartnerFinancialColumn(
      "proxy_sales_mode",
      "proxy_sales_mode VARCHAR(32) NOT NULL DEFAULT 'manual' AFTER manual_instructions",
    );
    await ensurePartnerFinancialColumn(
      "proxy_monthly_price",
      "proxy_monthly_price DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER proxy_sales_mode",
    );
    await ensurePartnerFinancialColumn(
      "allow_customer_proxy",
      "allow_customer_proxy TINYINT(1) NOT NULL DEFAULT 1 AFTER proxy_monthly_price",
    );
    await ensurePartnerFinancialColumn(
      "proxy_sales_instructions",
      "proxy_sales_instructions VARCHAR(1000) NULL AFTER allow_customer_proxy",
    );
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_plan_credit_costs (
        owner_user_id INT NOT NULL,
        plan_id INT NOT NULL,
        credit_cost INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (owner_user_id, plan_id),
        CONSTRAINT fk_partner_plan_cost_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_partner_plan_cost_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS partner_manual_payment_requests (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        public_id VARCHAR(80) NOT NULL UNIQUE,
        buyer_user_id INT NOT NULL,
        approver_user_id INT NULL,
        credit_count INT NOT NULL,
        unit_price DECIMAL(12,2) NOT NULL,
        total_amount DECIMAL(12,2) NOT NULL,
        proof_path VARCHAR(500) NOT NULL,
        note VARCHAR(500) NULL,
        status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        reviewed_by INT NULL,
        reviewed_at DATETIME NULL,
        review_note VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_partner_manual_buyer FOREIGN KEY (buyer_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_partner_manual_approver FOREIGN KEY (approver_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_partner_manual_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_partner_manual_approver (approver_user_id, status, created_at),
        INDEX idx_partner_manual_buyer (buyer_user_id, created_at)
      ) ENGINE=InnoDB;
    `);
  });

export type UserBotResaleLedgerRow = {
  id: number;
  user_id: number;
  entry_type: string;
  amount: string;
  plan_payment_id: string | null;
  status: string;
  metadata: string | null;
  created_at: Date | string;
};

export const ensureUserPurchaseHistoryTable = async () =>
  runEnsure("user-purchase-history", async () => {
  const db = getDb();
  await ensureCustomerTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_purchase_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      customer_id INT NULL,
      customer_whatsapp VARCHAR(32) NULL,
      customer_name VARCHAR(255) NULL,
      category_id INT NULL,
      category_name VARCHAR(255) NOT NULL,
      category_price DECIMAL(12, 2) NOT NULL,
      category_description TEXT NULL,
      category_duration_days INT NULL,
      product_id INT NULL,
      product_details TEXT NOT NULL,
      product_file_path VARCHAR(255) NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
      metadata LONGTEXT NULL,
      purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_purchase_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_purchase_history_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      INDEX idx_purchase_history_user (user_id, purchased_at),
      INDEX idx_purchase_history_customer (customer_id)
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM user_purchase_history LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE user_purchase_history ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("category_duration_days", "category_duration_days INT NULL");
  });

export const ensureFieldTutorialTable = async () =>
  runEnsure("field-tutorial", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS field_tutorials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(80) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      media_path VARCHAR(255) NULL,
      media_type ENUM('image', 'video') NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
  });

export const ensureSisregWatcherTable = async () =>
  runEnsure("sisreg-watcher", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS sisreg_watchers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      instance_id INT NOT NULL,
      contact_digits VARCHAR(32) NOT NULL,
      code VARCHAR(32) NOT NULL,
      unit_hint VARCHAR(255) NULL,
      unit_resolved VARCHAR(255) NOT NULL,
      interval_seconds INT NOT NULL,
      next_run_at DATETIME NOT NULL,
      last_status TEXT NULL,
      last_checked_at DATETIME NULL,
      daily_notified_at DATETIME NULL,
      failure_count INT NOT NULL DEFAULT 0,
      locked_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_sisreg_watchers_instance FOREIGN KEY (instance_id) REFERENCES bot_instances(id) ON DELETE CASCADE,
      UNIQUE KEY uq_sisreg_watchers_code (instance_id, contact_digits, code),
      KEY idx_sisreg_watchers_next_run (next_run_at),
      KEY idx_sisreg_watchers_locked (locked_at)
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM sisreg_watchers LIKE ?",
      [column],
    );

  if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE sisreg_watchers ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("daily_notified_at", "daily_notified_at DATETIME NULL AFTER last_checked_at");

  const ensureIndex = async (index: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM sisreg_watchers WHERE Key_name = ?",
      [index],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE sisreg_watchers ADD ${definition};`);
    }
  };

  await Promise.all([
    ensureColumn("failure_count", "failure_count INT NOT NULL DEFAULT 0"),
    ensureColumn("locked_at", "locked_at DATETIME NULL"),
    ensureColumn("unit_hint", "unit_hint VARCHAR(255) NULL"),
    ensureColumn("unit_resolved", "unit_resolved VARCHAR(255) NOT NULL"),
  ]);

  await Promise.all([
    ensureIndex(
      "uq_sisreg_watchers_code",
      "UNIQUE KEY uq_sisreg_watchers_code (instance_id, contact_digits, code)",
    ),
    ensureIndex(
      "idx_sisreg_watchers_next_run",
      "INDEX idx_sisreg_watchers_next_run (next_run_at)",
    ),
    ensureIndex(
      "idx_sisreg_watchers_locked",
      "INDEX idx_sisreg_watchers_locked (locked_at)",
    ),
  ]);
  });

export const ensureUsefulLinksTable = async () =>
  runEnsure("useful-links", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS useful_links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      description TEXT NULL,
      url VARCHAR(500) NOT NULL,
      button_label VARCHAR(80) NOT NULL,
      icon VARCHAR(80) NULL,
      image_path VARCHAR(255) NULL,
      order_index INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>("SHOW COLUMNS FROM useful_links LIKE ?", [
      column,
    ]);

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE useful_links ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("order_index", "order_index INT NOT NULL DEFAULT 0");
  await ensureColumn("is_active", "is_active TINYINT(1) NOT NULL DEFAULT 1");
  });

export const ensureUsefulLinkBannersTable = async () =>
  runEnsure("useful-link-banners", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS useful_link_banners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      subtitle VARCHAR(255) NULL,
      link_url VARCHAR(500) NULL,
      media_path VARCHAR(255) NOT NULL,
      order_index INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM useful_link_banners LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE useful_link_banners ADD COLUMN ${definition};`);
    }
  };

  await ensureColumn("subtitle", "subtitle VARCHAR(255) NULL");
  await ensureColumn("order_index", "order_index INT NOT NULL DEFAULT 0");
  await ensureColumn("is_active", "is_active TINYINT(1) NOT NULL DEFAULT 1");
  });

export const ensureWebhookTable = async () =>
  runEnsure("webhook", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_webhooks (
        id CHAR(36) PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        verify_token VARCHAR(128) NOT NULL,
        app_id VARCHAR(64) NULL,
        app_secret VARCHAR(128) NULL,
        business_account_id VARCHAR(64) NULL,
        phone_number_id VARCHAR(64) NULL,
        phone_number VARCHAR(32) NULL,
        access_token TEXT NULL,
        last_event_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_user_webhooks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  });

  const dropDeprecatedColumn = async (column: string) => {
    const existing = await withDbRetry(async () => {
      const db = getDb();
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM user_webhooks LIKE ?",
        [column],
      );
      return rows;
    });

    if (Array.isArray(existing) && existing.length > 0) {
      await withDbRetry(async () => {
        const db = getDb();
        await db.query(`ALTER TABLE user_webhooks DROP COLUMN ${column};`);
      });
    }
  };

  await dropDeprecatedColumn("api_key");

  const ensureColumn = async (column: string, definition: string) => {
    const existing = await withDbRetry(async () => {
      const db = getDb();
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM user_webhooks LIKE ?",
        [column],
      );
      return rows;
    });

    if (!Array.isArray(existing) || existing.length === 0) {
      await withDbRetry(async () => {
        const db = getDb();
        await db.query(`ALTER TABLE user_webhooks ADD COLUMN ${definition};`);
      });
    }
  };

  await ensureColumn("app_id", "app_id VARCHAR(64) NULL");
  await ensureColumn("app_secret", "app_secret VARCHAR(128) NULL");
  await ensureColumn("business_account_id", "business_account_id VARCHAR(64) NULL");
  await ensureColumn("phone_number_id", "phone_number_id VARCHAR(64) NULL");
  await ensureColumn("phone_number", "phone_number VARCHAR(32) NULL");
  await ensureColumn("access_token", "access_token TEXT NULL");
  });

export const ensureUserApiKeyTable = async () =>
  runEnsure("user-api-key", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_api_keys (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        api_key VARCHAR(191) NOT NULL,
        daily_quota INT NOT NULL DEFAULT 1000,
        requests_used INT NOT NULL DEFAULT 0,
        reset_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_api_keys_user (user_id),
        UNIQUE KEY uq_user_api_keys_key (api_key),
        CONSTRAINT fk_user_api_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  });

  const ensureColumn = async (column: string, definition: string) => {
    const existing = await withDbRetry(async () => {
      const db = getDb();
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM user_api_keys LIKE ?",
        [column],
      );
      return rows;
    });

    if (!Array.isArray(existing) || existing.length === 0) {
      await withDbRetry(async () => {
        const db = getDb();
        await db.query(`ALTER TABLE user_api_keys ADD COLUMN ${definition};`);
      });
    }
  };

  await ensureColumn("daily_quota", "daily_quota INT NOT NULL DEFAULT 1000");
  await ensureColumn("requests_used", "requests_used INT NOT NULL DEFAULT 0");
  await ensureColumn("reset_at", "reset_at DATETIME NULL");
  await ensureColumn("rotation_locked_until", "rotation_locked_until DATETIME NULL");
  });

export const ensureApiRequestPlanTable = async () =>
  runEnsure("api-request-plan", async () => {
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS api_request_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(255) NULL,
        price_cents INT NOT NULL,
        request_amount INT NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        order_index INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);
  });

  const ensureColumn = async (column: string, definition: string) => {
    await withDbRetry(async () => {
      const db = getDb();
      const [rows] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM api_request_plans LIKE ?",
        [column],
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        await db.query(`ALTER TABLE api_request_plans ADD COLUMN ${definition};`);
      }
    });
  };

  await ensureColumn("description", "description VARCHAR(255) NULL");
  await ensureColumn("order_index", "order_index INT NOT NULL DEFAULT 0");
  });

export const ensureUserApiRequestTopupTable = async () =>
  runEnsure("user-api-request-topup", async () => {
  await ensureApiRequestPlanTable();
  await withDbRetry(async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_api_request_topups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        plan_id INT NULL,
        provider VARCHAR(64) NOT NULL,
        provider_payment_id VARCHAR(128) NOT NULL,
        request_amount INT NOT NULL,
        amount_cents INT NOT NULL,
        status VARCHAR(32) NOT NULL,
        metadata LONGTEXT NULL,
        processed_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_api_request_topups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_api_request_topups_plan FOREIGN KEY (plan_id) REFERENCES api_request_plans(id) ON DELETE SET NULL,
        UNIQUE KEY uq_api_request_topups_payment (provider, provider_payment_id)
      ) ENGINE=InnoDB;
    `);
  });
  });

export const ensureUserNotificationTable = async () =>
  runEnsure("user-notification", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      metadata LONGTEXT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_notifications_user (user_id, is_read, created_at)
    ) ENGINE=InnoDB;
  `);
  });

export const ensurePushSubscriptionTable = async () =>
  runEnsure("push-subscription", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token VARCHAR(255) NOT NULL,
      platform ENUM('android','ios','web') NOT NULL,
      device_id VARCHAR(191) NULL,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_push_token (token),
      INDEX idx_push_subscriptions_user (user_id, platform)
    ) ENGINE=InnoDB;
  `);
  });


export const ensureWebhookEventTable = async () =>
  runEnsure("webhook-event", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_webhook_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      webhook_id CHAR(36) NOT NULL,
      user_id INT NOT NULL,
      event_type VARCHAR(191) NULL,
      payload LONGTEXT NOT NULL,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_webhook_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_webhook_events_webhook FOREIGN KEY (webhook_id) REFERENCES user_webhooks(id) ON DELETE CASCADE,
      INDEX idx_webhook_events_user (user_id),
      INDEX idx_webhook_events_webhook (webhook_id, received_at)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureAdminWebhookTable = async () =>
  runEnsure("admin-webhook", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_webhooks (
      id CHAR(36) PRIMARY KEY,
      verify_token VARCHAR(128) NOT NULL,
      app_id VARCHAR(64) NULL,
      business_account_id VARCHAR(64) NULL,
      phone_number_id VARCHAR(64) NULL,
      phone_number VARCHAR(32) NULL,
      access_token TEXT NULL,
      last_event_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_webhooks LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_webhooks ADD COLUMN ${definition};`);
    }
  };

  await Promise.all([
    ensureColumn("app_id", "app_id VARCHAR(64) NULL"),
    ensureColumn("business_account_id", "business_account_id VARCHAR(64) NULL"),
    ensureColumn("phone_number_id", "phone_number_id VARCHAR(64) NULL"),
    ensureColumn("phone_number", "phone_number VARCHAR(32) NULL"),
    ensureColumn("access_token", "access_token TEXT NULL"),
    ensureColumn("last_event_at", "last_event_at DATETIME NULL"),
  ]);
  });

export const ensureAdminWebhookEventTable = async () =>
  runEnsure("admin-webhook-event", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_webhook_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      webhook_id CHAR(36) NOT NULL,
      event_type VARCHAR(191) NULL,
      payload LONGTEXT NOT NULL,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admin_webhook_events (webhook_id, received_at)
    ) ENGINE=InnoDB;
  `);
  });

export const ensureAdminMetaTemplatesTable = async () =>
  runEnsure("admin-meta-templates", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_meta_templates (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      template_id VARCHAR(128) NOT NULL,
      name VARCHAR(255) NOT NULL,
      language VARCHAR(32) NOT NULL,
      category VARCHAR(64) NULL,
      status VARCHAR(32) NOT NULL,
      quality_score VARCHAR(32) NULL,
      rejected_reason TEXT NULL,
      components LONGTEXT NULL,
      meta_created_at DATETIME NULL,
      meta_updated_at DATETIME NULL,
      last_synced_at DATETIME NULL,
      business_account_id VARCHAR(128) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_admin_meta_templates_template_id (template_id),
      INDEX idx_admin_meta_templates_name (name),
      INDEX idx_admin_meta_templates_status (status)
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_meta_templates LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_meta_templates ADD COLUMN ${definition};`);
    }
  };

  const ensureIndex = async (index: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW INDEX FROM admin_meta_templates WHERE Key_name = ?",
      [index],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_meta_templates ADD ${definition};`);
    }
  };

  await Promise.all([
    ensureColumn("category", "category VARCHAR(64) NULL"),
    ensureColumn("status", "status VARCHAR(32) NOT NULL DEFAULT 'APPROVED'"),
    ensureColumn("quality_score", "quality_score VARCHAR(32) NULL"),
    ensureColumn("rejected_reason", "rejected_reason TEXT NULL"),
    ensureColumn("components", "components LONGTEXT NULL"),
    ensureColumn("meta_created_at", "meta_created_at DATETIME NULL"),
    ensureColumn("meta_updated_at", "meta_updated_at DATETIME NULL"),
    ensureColumn("last_synced_at", "last_synced_at DATETIME NULL"),
    ensureColumn("business_account_id", "business_account_id VARCHAR(128) NULL"),
  ]);

  await Promise.all([
    ensureIndex(
      "uniq_admin_meta_templates_template_id",
      "UNIQUE KEY uniq_admin_meta_templates_template_id (template_id)",
    ),
    ensureIndex(
      "idx_admin_meta_templates_name",
      "INDEX idx_admin_meta_templates_name (name)",
    ),
    ensureIndex(
      "idx_admin_meta_templates_status",
      "INDEX idx_admin_meta_templates_status (status)",
    ),
    ensureIndex(
      "idx_admin_meta_templates_business_account",
      "INDEX idx_admin_meta_templates_business_account (business_account_id)",
    ),
  ]);
  });

export const ensureAdminCampaignTable = async () =>
  runEnsure("admin-campaign", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_campaigns (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      campaign_id CHAR(36) NOT NULL UNIQUE,
      name VARCHAR(191) NOT NULL,
      description TEXT NULL,
      template_id VARCHAR(128) NOT NULL,
      template_name VARCHAR(191) NOT NULL,
      status ENUM('draft','scheduled','queued','sending','completed','paused','cancelled') NOT NULL DEFAULT 'draft',
      scheduled_at DATETIME NULL,
      business_account_id VARCHAR(128) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_admin_campaigns_status (status),
      INDEX idx_admin_campaigns_business_account (business_account_id),
      INDEX idx_admin_campaigns_template (template_id)
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_campaigns LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_campaigns ADD COLUMN ${definition};`);
    }
  };

  await Promise.all([
    ensureColumn("description", "description TEXT NULL"),
    ensureColumn("scheduled_at", "scheduled_at DATETIME NULL"),
    ensureColumn("business_account_id", "business_account_id VARCHAR(128) NULL"),
    ensureColumn("sending_started_at", "sending_started_at DATETIME NULL"),
    ensureColumn("sending_completed_at", "sending_completed_at DATETIME NULL"),
    ensureColumn("last_error", "last_error TEXT NULL"),
  ]);
  });

export const ensureAdminCampaignContactTable = async () =>
  runEnsure("admin-campaign-contact", async () => {
  await ensureAdminCampaignTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_campaign_contacts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      campaign_id BIGINT NOT NULL,
      campaign_contact_id CHAR(36) NOT NULL,
      name VARCHAR(191) NULL,
      phone VARCHAR(32) NOT NULL,
      variables LONGTEXT NULL,
      status ENUM('pending','queued','sent','failed','skipped') NOT NULL DEFAULT 'pending',
      error_message TEXT NULL,
      metadata LONGTEXT NULL,
      sent_at DATETIME NULL,
      attempt_count INT NOT NULL DEFAULT 0,
      last_attempt_at DATETIME NULL,
      message_id VARCHAR(191) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_admin_campaign_contact (campaign_id, phone),
      INDEX idx_admin_campaign_contacts_status (status),
      INDEX idx_admin_campaign_contacts_campaign (campaign_id),
      CONSTRAINT fk_admin_campaign_contacts_campaign FOREIGN KEY (campaign_id)
        REFERENCES admin_campaigns(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_campaign_contacts LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_campaign_contacts ADD COLUMN ${definition};`);
    }
  };

  await Promise.all([
    ensureColumn("metadata", "metadata LONGTEXT NULL"),
    ensureColumn("sent_at", "sent_at DATETIME NULL"),
    ensureColumn("attempt_count", "attempt_count INT NOT NULL DEFAULT 0"),
    ensureColumn("last_attempt_at", "last_attempt_at DATETIME NULL"),
    ensureColumn("message_id", "message_id VARCHAR(191) NULL"),
  ]);
  });

export const ensureBotAdCampaignTable = async () =>
  runEnsure("bot-ad-campaigns", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_ad_campaigns (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        campaign_id CHAR(36) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        status ENUM('draft','scheduled','running','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
        schedule_kind ENUM('manual','immediate','once','recurring','window') NOT NULL DEFAULT 'manual',
        schedule_config LONGTEXT NULL,
        content_json LONGTEXT NULL,
        options_json LONGTEXT NULL,
        timezone VARCHAR(64) NULL,
        start_at DATETIME NULL,
        end_at DATETIME NULL,
        last_run_at DATETIME NULL,
        next_run_at DATETIME NULL,
        next_target_hint_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        KEY idx_bot_ad_campaigns_user (user_id),
        KEY idx_bot_ad_campaigns_status (status),
        KEY idx_bot_ad_campaigns_next_run (next_run_at),
        CONSTRAINT fk_bot_ad_campaigns_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_ad_campaigns LIKE ?",
        [column],
      );
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE bot_ad_campaigns ADD COLUMN ${definition};`);
      }
    };

    await Promise.all([
      ensureColumn("options_json", "options_json LONGTEXT NULL"),
      ensureColumn("timezone", "timezone VARCHAR(64) NULL"),
      ensureColumn("start_at", "start_at DATETIME NULL"),
      ensureColumn("end_at", "end_at DATETIME NULL"),
      ensureColumn("next_target_hint_json", "next_target_hint_json LONGTEXT NULL"),
      ensureColumn("deleted_at", "deleted_at DATETIME NULL"),
    ]);
  });

export const ensureBotAdCampaignTargetTable = async () =>
  runEnsure("bot-ad-campaign-targets", async () => {
    await Promise.all([ensureBotAdCampaignTable(), ensureBotInstanceTable(), ensureBotGroupTable()]);
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_ad_campaign_targets (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        target_id CHAR(36) NOT NULL UNIQUE,
        campaign_id BIGINT NOT NULL,
        target_type ENUM('group','status') NOT NULL,
        instance_id INT NOT NULL,
        group_id INT NULL,
        remote_id VARCHAR(191) NULL,
        invite_code VARCHAR(128) NULL,
        invite_link TEXT NULL,
        audience_meta LONGTEXT NULL,
        inspection_json LONGTEXT NULL,
        status_config LONGTEXT NULL,
        mention_all TINYINT(1) NOT NULL DEFAULT 0,
        exclude_admins TINYINT(1) NOT NULL DEFAULT 0,
        mention_list LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bot_ad_campaign_targets_campaign (campaign_id),
        KEY idx_bot_ad_campaign_targets_instance (instance_id),
        KEY idx_bot_ad_campaign_targets_group (group_id),
        CONSTRAINT fk_bot_ad_campaign_targets_campaign FOREIGN KEY (campaign_id)
          REFERENCES bot_ad_campaigns(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_ad_campaign_targets_instance FOREIGN KEY (instance_id)
          REFERENCES bot_instances(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_ad_campaign_targets_group FOREIGN KEY (group_id)
          REFERENCES bot_groups(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_ad_campaign_targets LIKE ?",
        [column],
      );
      if (Array.isArray(existing) && existing.length > 0) {
        return;
      }
      try {
        await db.query(`ALTER TABLE bot_ad_campaign_targets ADD COLUMN ${definition};`);
      } catch (error) {
        if ((error as { code?: string }).code === "ER_DUP_FIELDNAME") {
          return;
        }
        throw error;
      }
    };

    await Promise.all([
      ensureColumn("status_config", "status_config LONGTEXT NULL"),
      ensureColumn("mention_all", "mention_all TINYINT(1) NOT NULL DEFAULT 0"),
      ensureColumn("exclude_admins", "exclude_admins TINYINT(1) NOT NULL DEFAULT 0"),
      ensureColumn("mention_list", "mention_list LONGTEXT NULL"),
      ensureColumn("invite_code", "invite_code VARCHAR(128) NULL"),
      ensureColumn("invite_link", "invite_link TEXT NULL"),
      ensureColumn("audience_meta", "audience_meta LONGTEXT NULL"),
      ensureColumn("inspection_json", "inspection_json LONGTEXT NULL"),
    ]);
  });

export const ensureBotAdCampaignRunTable = async () =>
  runEnsure("bot-ad-campaign-runs", async () => {
    await Promise.all([ensureBotAdCampaignTable(), ensureBotAdCampaignTargetTable()]);
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_ad_campaign_runs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        run_id CHAR(36) NOT NULL UNIQUE,
        campaign_id BIGINT NOT NULL,
        target_id BIGINT NULL,
        scheduled_for DATETIME NULL,
        started_at DATETIME NULL,
        finished_at DATETIME NULL,
        status ENUM('pending','running','success','failed','cancelled','skipped') NOT NULL DEFAULT 'pending',
        error_message TEXT NULL,
        stats_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bot_ad_campaign_runs_campaign (campaign_id),
        KEY idx_bot_ad_campaign_runs_target (target_id),
        KEY idx_bot_ad_campaign_runs_status (status),
        CONSTRAINT fk_bot_ad_campaign_runs_campaign FOREIGN KEY (campaign_id)
          REFERENCES bot_ad_campaigns(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_ad_campaign_runs_target FOREIGN KEY (target_id)
          REFERENCES bot_ad_campaign_targets(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_ad_campaign_runs LIKE ?",
        [column],
      );
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE bot_ad_campaign_runs ADD COLUMN ${definition};`);
      }
    };

    await Promise.all([
      ensureColumn("stats_json", "stats_json LONGTEXT NULL"),
      ensureColumn("scheduled_for", "scheduled_for DATETIME NULL"),
    ]);
  });

export const ensureBotAdCampaignStatusPostTable = async () =>
  runEnsure("bot-ad-campaign-status-posts", async () => {
    await Promise.all([
      ensureBotAdCampaignTable(),
      ensureBotAdCampaignTargetTable(),
      ensureBotAdCampaignRunTable(),
      ensureBotInstanceTable(),
    ]);
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_ad_campaign_status_posts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        post_id CHAR(36) NOT NULL UNIQUE,
        campaign_id BIGINT NOT NULL,
        run_id BIGINT NULL,
        target_id BIGINT NULL,
        instance_id INT NOT NULL,
        remote_jid VARCHAR(191) NULL,
        message_id VARCHAR(191) NULL,
        delete_at DATETIME NULL,
        deleted_at DATETIME NULL,
        payload_json LONGTEXT NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bot_ad_campaign_status_posts_campaign (campaign_id),
        KEY idx_bot_ad_campaign_status_posts_delete (delete_at),
        KEY idx_bot_ad_campaign_status_posts_instance (instance_id),
        CONSTRAINT fk_bot_ad_campaign_status_posts_campaign FOREIGN KEY (campaign_id)
          REFERENCES bot_ad_campaigns(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_ad_campaign_status_posts_run FOREIGN KEY (run_id)
          REFERENCES bot_ad_campaign_runs(id) ON DELETE SET NULL,
        CONSTRAINT fk_bot_ad_campaign_status_posts_target FOREIGN KEY (target_id)
          REFERENCES bot_ad_campaign_targets(id) ON DELETE SET NULL,
        CONSTRAINT fk_bot_ad_campaign_status_posts_instance FOREIGN KEY (instance_id)
          REFERENCES bot_instances(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_ad_campaign_status_posts LIKE ?",
        [column],
      );
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE bot_ad_campaign_status_posts ADD COLUMN ${definition};`);
      }
    };

    await Promise.all([
      ensureColumn("remote_jid", "remote_jid VARCHAR(191) NULL"),
      ensureColumn("payload_json", "payload_json LONGTEXT NULL"),
      ensureColumn("error_message", "error_message TEXT NULL"),
    ]);
  });

export const ensureDivulgacaoTemplateTable = async () =>
  runEnsure("bot-group-divulgacao-templates", async () => {
    await ensureUserTable();
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_group_divulgacao_templates (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(191) NOT NULL,
        description TEXT NULL,
        contents_json LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bot_group_divulgacao_templates_user (user_id),
        CONSTRAINT fk_bot_group_divulgacao_templates_user FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_group_divulgacao_templates LIKE ?",
        [column],
      );
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE bot_group_divulgacao_templates ADD COLUMN ${definition};`);
      }
    };

    await Promise.all([
      ensureColumn("description", "description TEXT NULL"),
      ensureColumn("contents_json", "contents_json LONGTEXT NULL"),
    ]);
  });

export const ensureDivulgacaoRunTable = async () =>
  runEnsure("bot-group-divulgacao-runs", async () => {
    await Promise.all([ensureDivulgacaoTemplateTable(), ensureBotInstanceTable(), ensureUserTable()]);
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bot_group_divulgacao_runs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        run_uid CHAR(36) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        instance_id INT NOT NULL,
        template_id BIGINT NULL,
        invite_code VARCHAR(128) NOT NULL,
        invite_link TEXT NULL,
        target_jid VARCHAR(191) NULL,
        target_name VARCHAR(191) NULL,
        status ENUM('pending','verifying','joined','sending','sent','failed') NOT NULL DEFAULT 'pending',
        inspect_json LONGTEXT NULL,
        payload_json LONGTEXT NULL,
        response_json LONGTEXT NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bot_group_divulgacao_runs_user (user_id),
        KEY idx_bot_group_divulgacao_runs_instance (instance_id),
        KEY idx_bot_group_divulgacao_runs_template (template_id),
        KEY idx_bot_group_divulgacao_runs_invite (invite_code),
        CONSTRAINT fk_bot_group_divulgacao_runs_user FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_group_divulgacao_runs_instance FOREIGN KEY (instance_id)
          REFERENCES bot_instances(id) ON DELETE CASCADE,
        CONSTRAINT fk_bot_group_divulgacao_runs_template FOREIGN KEY (template_id)
          REFERENCES bot_group_divulgacao_templates(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);

    const ensureColumn = async (column: string, definition: string) => {
      const [existing] = await db.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM bot_group_divulgacao_runs LIKE ?",
        [column],
      );
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.query(`ALTER TABLE bot_group_divulgacao_runs ADD COLUMN ${definition};`);
      }
    };

    await Promise.all([
      ensureColumn("response_json", "response_json LONGTEXT NULL"),
      ensureColumn("error_message", "error_message TEXT NULL"),
    ]);
  });

export const ensureAdminBotSessionTable = async () =>
  runEnsure("admin-bot-session", async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_bot_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      whatsapp_id VARCHAR(32) NOT NULL UNIQUE,
      whatsapp_e164 VARCHAR(32) NOT NULL,
      user_id INT NOT NULL,
      flow_state VARCHAR(64) NULL,
      flow_context LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_admin_bot_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  const ensureColumn = async (column: string, definition: string) => {
    const [existing] = await db.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM admin_bot_sessions LIKE ?",
      [column],
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await db.query(`ALTER TABLE admin_bot_sessions ADD COLUMN ${definition};`);
    }
  };

  await Promise.all([
    ensureColumn("flow_state", "flow_state VARCHAR(64) NULL"),
    ensureColumn("flow_context", "flow_context LONGTEXT NULL"),
  ]);
  });

export type CategoryRow = {
  id: number;
  user_id: number;
  name: string;
  price: string;
  sku: string;
  description: string | null;
  image_path: string | null;
  is_active: number;
  duration_days: number;
  created_at: Date;
  updated_at: Date;
};

export type ProductRow = {
  id: number;
  user_id: number;
  category_id: number;
  name: string;
  details: string;
  file_path: string | null;
  resale_limit: number;
  created_at: Date;
  updated_at: Date;
};

export type CustomerRow = {
  id: number;
  user_id: number;
  whatsapp_id: string;
  phone_number: string;
  display_name: string | null;
  profile_name: string | null;
  notes: string | null;
  balance: string;
  is_blocked: number;
  last_interaction: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type UserPaymentMethodRow = {
  id: number;
  user_id: number;
  provider: string;
  is_active: number;
  display_name: string | null;
  credentials: string | null;
  settings: string | null;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminPaymentMethodRow = {
  id: number;
  provider: string;
  is_active: number;
  display_name: string | null;
  credentials: string | null;
  settings: string | null;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

export type SubscriptionPlanRow = {
  id: number;
  name: string;
  description: string | null;
  price: string;
  addon_instance_price: string;
  addon_group_price: string;
  category_limit: number;
  group_limit: number;
  instance_limit: number;
  allow_flows: number;
  storage_quota_gb: string;
  features_json: string | null;
  duration_days: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
};

export type UserPaymentChargeRow = {
  id: number;
  public_id: string;
  user_id: number;
  provider: string;
  provider_payment_id: string;
  status: string;
  amount: string;
  currency: string;
  qr_code: string | null;
  qr_code_base64: string | null;
  ticket_url: string | null;
  expires_at: Date | null;
  customer_whatsapp: string | null;
  customer_name: string | null;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserPurchaseHistoryRow = {
  id: number;
  user_id: number;
  customer_id: number | null;
  customer_whatsapp: string | null;
  customer_name: string | null;
  category_id: number | null;
  category_name: string;
  category_price: string;
  category_description: string | null;
  category_duration_days: number | null;
  product_id: number | null;
  product_details: string;
  product_file_path: string | null;
  currency: string;
  metadata: string | null;
  purchased_at: Date;
  created_at: Date;
};

export type FieldTutorialRow = {
  id: number;
  slug: string;
  title: string;
  description: string;
  media_path: string | null;
  media_type: "image" | "video" | null;
  created_at: Date;
  updated_at: Date;
};

export type UserSiteSettingsRow = {
  user_id: number;
  site_name: string;
  tagline: string | null;
  logo_path: string | null;
  favicon_path: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_image_path: string | null;
  seo_keywords: string | null;
  footer_text: string | null;
  footer_links: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminSiteSettingsRow = {
  id: number;
  site_name: string;
  tagline: string | null;
  logo_path: string | null;
  favicon_path: string | null;
  favicon_assets_path: string | null;
  favicon_assets_json: string | null;
  support_email: string | null;
  support_phone: string | null;
  support_url: string | null;
  support_channel: string | null;
  support_whatsapp_number: string | null;
  signup_whatsapp_verification_enabled: number | null;
  signup_whatsapp_verification_mode: string | null;
  signup_whatsapp_verification_target_number: string | null;
  signup_whatsapp_verification_instructions: string | null;
  signup_whatsapp_verification_support_text: string | null;
  email_verification_enabled: number | null;
  email_verification_api_keys: string | null;
  hero_badge: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  hero_button_label: string | null;
  hero_button_url: string | null;
  hero_secondary_button_label: string | null;
  hero_secondary_button_url: string | null;
  hero_image_path: string | null;
  features_title: string | null;
  features_subtitle: string | null;
  features_json: string | null;
  workflow_title: string | null;
  workflow_description: string | null;
  workflow_bullets_json: string | null;
  workflow_image_path: string | null;
  cta_title: string | null;
  cta_description: string | null;
  cta_button_label: string | null;
  cta_button_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords_json: string | null;
  seo_highlight_keywords_json: string | null;
  seo_image_path: string | null;
  mobile_icon_path: string | null;
  footer_text: string | null;
  terms_content: string | null;
  user_panel_banners_json: string | null;
  test_groups_json: string | null;
  official_groups_json: string | null;
  official_group_instance_id: number | null;
  official_group_jid: string | null;
  official_group_invite_link: string | null;
  official_group_invite_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminBotConfigRow = {
  id: number;
  bot_name: string;
  purchase_voice_template: string;
  balance_voice_template: string;
  menu_text: string;
  menu_footer_text: string | null;
  panel_button_text: string;
  subscription_button_text: string;
  support_button_text: string;
  support_url: string | null;
  support_cta_body_text?: string | null;
  support_cta_footer_text?: string | null;
  menu_image_path: string | null;
  subscription_header_text: string;
  subscription_body_text: string;
  subscription_footer_text: string | null;
  subscription_renew_button_text: string;
  subscription_change_button_text: string;
  subscription_details_button_text: string;
  subscription_no_plan_header_text: string;
  subscription_no_plan_body_text: string;
  subscription_no_plan_button_text: string;
  subscription_plan_list_title: string;
  subscription_plan_list_body: string;
  subscription_plan_list_button_text: string;
  subscription_plan_list_footer_text: string | null;
  subscription_plan_list_row_template?: string | null;
  payment_method_picker_title?: string | null;
  payment_method_picker_body?: string | null;
  payment_method_picker_button_text?: string | null;
  payment_method_pix_row_title?: string | null;
  payment_method_pix_row_description?: string | null;
  payment_method_checkout_row_title?: string | null;
  payment_method_checkout_row_description?: string | null;
  payment_method_plan_details_template?: string | null;
  pix_payment_header_text?: string | null;
  pix_payment_body_text?: string | null;
  pix_payment_button_text?: string | null;
  checkout_payment_header_text?: string | null;
  checkout_payment_body_text?: string | null;
  checkout_payment_button_text?: string | null;
  plan_confirm_header_text?: string | null;
  plan_confirm_body_text?: string | null;
  plan_confirm_button_text?: string | null;
  plan_confirm_media_path?: string | null;
  addon_confirm_header_text?: string | null;
  addon_confirm_body_text?: string | null;
  addon_confirm_button_text?: string | null;
  addon_confirm_media_path?: string | null;
  addon_type_header_text?: string | null;
  addon_type_body_text?: string | null;
  addon_type_instance_button_text?: string | null;
  addon_type_group_button_text?: string | null;
  addon_type_cancel_button_text?: string | null;
  addon_quantity_header_text?: string | null;
  addon_quantity_body_text?: string | null;
  addon_quantity_button_text?: string | null;
  addon_quantity_cancel_row_text?: string | null;
  instance_connected_header_text?: string | null;
  instance_connected_body_text?: string | null;
  instance_connected_link_group_button_text?: string | null;
  instance_connected_later_button_text?: string | null;
  group_create_header_text?: string | null;
  group_create_body_text?: string | null;
  group_create_footer_text?: string | null;
  group_create_cancel_button_text?: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserNotificationAudioSettingsRow = {
  user_id: number;
  sounds_enabled: number;
  tts_enabled: number;
  speech_mode: "browser" | "api";
  speech_voice: string;
  purchase_template: string;
  balance_template: string;
  raffle_template: string;
  plan_template: string;
  created_at: Date;
  updated_at: Date;
};

export type AdminWebhookRow = {
  id: string;
  verify_token: string;
  app_id: string | null;
  business_account_id: string | null;
  phone_number_id: string | null;
  phone_number: string | null;
  access_token: string | null;
  last_event_at: Date | string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminWebhookEventRow = {
  id: number;
  webhook_id: string;
  event_type: string | null;
  payload: string;
  received_at: Date;
};

export type AdminMetaTemplateRow = {
  id: number;
  template_id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  quality_score: string | null;
  rejected_reason: string | null;
  components: string | null;
  meta_created_at: Date | string | null;
  meta_updated_at: Date | string | null;
  last_synced_at: Date | string | null;
  business_account_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminCampaignRow = {
  id: number;
  campaign_id: string;
  name: string;
  description: string | null;
  template_id: string;
  template_name: string;
  status: string;
  scheduled_at: Date | string | null;
  sending_started_at: Date | string | null;
  sending_completed_at: Date | string | null;
  last_error: string | null;
  business_account_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminCampaignContactRow = {
  id: number;
  campaign_id: number;
  campaign_contact_id: string;
  name: string | null;
  phone: string;
  variables: string | null;
  status: string;
  error_message: string | null;
  metadata: string | null;
  attempt_count: number;
  last_attempt_at: Date | string | null;
  message_id: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | string | null;
};

export type BotAdCampaignRow = {
  id: number;
  campaign_id: string;
  user_id: number;
  name: string;
  description: string | null;
  status: string;
  schedule_kind: string;
  schedule_config: string | null;
  content_json: string | null;
  options_json: string | null;
  timezone: string | null;
  start_at: Date | string | null;
  end_at: Date | string | null;
  last_run_at: Date | string | null;
  next_run_at: Date | string | null;
  next_target_hint_json: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | string | null;
};

export type BotAdCampaignTargetRow = {
  id: number;
  target_id: string;
  campaign_id: number;
  target_type: string;
  instance_id: number;
  group_id: number | null;
  remote_id: string | null;
  invite_code: string | null;
  invite_link: string | null;
  audience_meta: string | null;
  inspection_json: string | null;
  status_config: string | null;
  mention_all: number;
  exclude_admins: number;
  mention_list: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BotAdCampaignRunRow = {
  id: number;
  run_id: string;
  campaign_id: number;
  target_id: number | null;
  scheduled_for: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  status: string;
  error_message: string | null;
  stats_json: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BotAdCampaignStatusPostRow = {
  id: number;
  post_id: string;
  campaign_id: number;
  run_id: number | null;
  target_id: number | null;
  instance_id: number;
  remote_jid: string | null;
  message_id: string | null;
  delete_at: Date | string | null;
  deleted_at: Date | string | null;
  payload_json: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

export type DivulgacaoTemplateRow = {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  contents_json: string | null;
  created_at: Date;
  updated_at: Date;
};

export type DivulgacaoRunRow = {
  id: number;
  run_uid: string;
  user_id: number;
  instance_id: number;
  template_id: number | null;
  invite_code: string;
  invite_link: string | null;
  target_jid: string | null;
  target_name: string | null;
  status: string;
  inspect_json: string | null;
  payload_json: string | null;
  response_json: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminBotSessionRow = {
  id: number;
  whatsapp_id: string;
  whatsapp_e164: string;
  user_id: number;
  flow_state: string | null;
  flow_context: string | null;
  created_at: Date;
  last_interaction_at: Date;
};

export type AdminSmtpSettingsRow = {
  id: number;
  host: string;
  port: number;
  is_secure: number;
  username: string | null;
  password: string | null;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminMegaCredentialsRow = {
  id: number;
  email: string | null;
  password: string | null;
  external_accounts_enabled: number;
  external_accounts_url: string | null;
  session_email: string | null;
  session_payload: string | null;
  session_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminBotInterageConfigRow = {
  id: number;
  enabled: number;
  api_base_url: string | null;
  api_token: string | null;
  model: string;
  created_at: Date;
  updated_at: Date;
};

export type AdminBotInterageAllowedUserRow = {
  user_id: number;
  created_at: Date;
  updated_at: Date;
};

export type AdminBotInterageTtsConfigRow = {
  id: number;
  enabled: number;
  api_base_url: string | null;
  api_token: string | null;
  default_voice_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AdminBotInterageTtsAllowedUserRow = {
  user_id: number;
  created_at: Date;
  updated_at: Date;
};

export type AdminEmailTemplateRow = {
  id: number;
  template_key: string;
  name: string;
  subject: string;
  heading: string;
  body_html: string;
  cta_label: string | null;
  cta_url: string | null;
  footer_text: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserPlanSubscriptionRow = {
  id: number;
  user_id: number;
  plan_id: number;
  auto_renew_plan: number;
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  is_trial: number;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancelled_at: Date | null;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserPlanPaymentRow = {
  id: number;
  user_id: number;
  plan_id: number;
  subscription_id: number | null;
  provider: string;
  provider_payment_id: string;
  status: string;
  status_detail: string | null;
  amount: string;
  currency: string;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserPlanAddonRow = {
  id: number;
  user_id: number;
  subscription_id: number | null;
  addon_type: 'instance' | 'group';
  quantity: number;
  auto_renew: number;
  purchased_at: Date;
  expires_at: Date | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
};

export type UserBalancePaymentRow = {
  id: number;
  user_id: number;
  provider: string;
  provider_payment_id: string;
  status: string;
  status_detail: string | null;
  amount: string;
  currency: string;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BotServerRow = {
  id: number;
  name: string;
  base_url: string;
  api_type: string;
  global_api_key: string;
  session_limit: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
};

export type BotInstanceRow = {
  id: number;
  user_id: number;
  profile_id: number | null;
  server_id: number;
  name: string;
  phone: string;
  token: string;
  base_url: string;
  remote_id: string | null;
  webhook_url: string | null;
  events: string | null;
  auto_read: number;
  pv_enabled: number;
  license_sales_enabled: number;
  purpose: string;
  session_status: string;
  desired_session_state: string;
  last_status_sync: Date | null;
  expires_at: Date | null;
  plan_id: number | null;
  created_at: Date;
  updated_at: Date;
};

export type BotGroupRow = {
  id: number;
  user_id: number;
  instance_id: number;
  slot: number;
  remote_id: string;
  invite_code: string | null;
  invite_link: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  owner: string | null;
  awaiting_approval: number;
  awaiting_entry: number;
  status: string;
  participants: string | null;
  metadata: string | null;
  group_synced_at: Date | null;
  participants_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type UserNotificationRow = {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  metadata: string | null;
  is_read: number;
  read_at: Date | null;
  created_at: Date;
};

export type SisregWatcherRow = {
  id: number;
  instance_id: number;
  contact_digits: string;
  code: string;
  unit_hint: string | null;
  unit_resolved: string;
  interval_seconds: number;
  next_run_at: Date;
  last_status: string | null;
  last_checked_at: Date | null;
  daily_notified_at: Date | null;
  failure_count: number;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type UsefulLinkRow = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  button_label: string;
  icon: string | null;
  image_path: string | null;
  order_index: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
};

export type UsefulLinkBannerRow = {
  id: number;
  title: string;
  subtitle: string | null;
  link_url: string | null;
  media_path: string;
  order_index: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
};

export type PushSubscriptionRow = {
  id: number;
  user_id: number;
  token: string;
  platform: 'android' | 'ios' | 'web';
  device_id: string | null;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type BotMenuConfigRow = {
  id: number;
  user_id: number;
  menu_text: string;
  variables: string | null;
  image_path: string | null;
  menu_footer_text: string | null;
  menu_button_buy: string | null;
  menu_button_add_balance: string | null;
  menu_button_support: string | null;
  menu_button_profile: string | null;
  category_list_header: string | null;
  category_list_body: string | null;
  category_list_footer: string | null;
  category_list_footer_more: string | null;
  category_list_button: string | null;
  category_list_section: string | null;
  category_list_next_title: string | null;
  category_list_next_description: string | null;
  category_list_empty: string | null;
  category_detail_body: string | null;
  category_detail_footer: string | null;
  category_detail_button: string | null;
  category_detail_caption: string | null;
  menu_add_balance_reply: string | null;
  menu_support_reply: string | null;
  profile_menu_body: string | null;
  profile_menu_footer: string | null;
  profile_button_purchases: string | null;
  profile_button_support: string | null;
  profile_button_back: string | null;
  profile_purchases_header: string | null;
  profile_purchases_body: string | null;
  profile_purchases_footer: string | null;
  profile_purchases_empty: string | null;
  profile_purchases_button: string | null;
  profile_support_reason_body: string | null;
  profile_support_reason_footer: string | null;
  profile_support_reason_purchase: string | null;
  profile_support_reason_payment: string | null;
  profile_support_reason_other: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserWebhookRow = {
  id: string;
  user_id: number;
  verify_token: string;
  app_id: string | null;
  app_secret: string | null;
  business_account_id: string | null;
  phone_number_id: string | null;
  phone_number: string | null;
  access_token: string | null;
  last_event_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type WebhookEventRow = {
  id: number;
  webhook_id: string;
  user_id: number;
  event_type: string | null;
  payload: string;
  received_at: Date;
};
