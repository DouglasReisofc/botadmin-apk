import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { Client as PgClient } from "pg";

type MySqlColumn = {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  column_default: string | null;
  is_nullable: "YES" | "NO";
  data_type: string;
  column_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  extra: string;
};

type MySqlIndex = {
  table_name: string;
  index_name: string;
  non_unique: number;
  seq_in_index: number;
  column_name: string;
};

type MySqlForeignKey = {
  table_name: string;
  constraint_name: string;
  column_name: string;
  referenced_table_name: string;
  referenced_column_name: string;
  ordinal_position: number;
  update_rule: string;
  delete_rule: string;
};

type Config = {
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  postgres: {
    connectionString: string;
  };
  batchSize: number;
  artifactsDir: string;
};

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ARTIFACTS_DIR = path.join(PROJECT_ROOT, "backups", "pg-migration");

const loadDotEnv = () => {
  const filePath = path.join(PROJECT_ROOT, ".env");
  const parsed: Record<string, string> = {};
  if (!existsSync(filePath)) return parsed;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value.replace(/\\n/g, "\n");
  }
  return parsed;
};

const envFile = loadDotEnv();
const env = (name: string, fallback = "") => process.env[name] ?? envFile[name] ?? fallback;

const getConfig = (): Config => {
  const pgUrl =
    env("POSTGRES_TARGET_URL") ||
    env("DATABASE_URL") ||
    `postgres://botadmin:${encodeURIComponent(env("POSTGRES_TARGET_PASSWORD", ""))}@127.0.0.1:7778/botadmin`;

  return {
    mysql: {
      host: env("MYSQL_SOURCE_HOST", env("DATABASE_HOST", "127.0.0.1")),
      port: Number(env("MYSQL_SOURCE_PORT", env("DATABASE_PORT", "3306"))),
      user: env("MYSQL_SOURCE_USER", env("DATABASE_USER", "root")),
      password: env("MYSQL_SOURCE_PASSWORD", env("DATABASE_PASSWORD", "")),
      database: env("MYSQL_SOURCE_DATABASE", env("DATABASE_NAME", "dashboard")),
    },
    postgres: {
      connectionString: pgUrl,
    },
    batchSize: Math.max(1, Number(env("PG_MIGRATION_BATCH_SIZE", "500")) || 500),
    artifactsDir: env("PG_MIGRATION_ARTIFACTS_DIR", DEFAULT_ARTIFACTS_DIR),
  };
};

const args = new Set(process.argv.slice(2));
const command = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) ?? "audit";

const ensureArtifactsDir = (config: Config) => {
  mkdirSync(config.artifactsDir, { recursive: true });
};

const artifactPath = (config: Config, name: string) => {
  ensureArtifactsDir(config);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(config.artifactsDir, `${stamp}-${name}`);
};

const writeArtifact = (config: Config, name: string, data: unknown) => {
  const filePath = artifactPath(config, name);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
};

const q = (identifier: string) => `"${identifier.replace(/"/g, "\"\"")}"`;
const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const connectMysql = (config: Config) =>
  mysql.createConnection({
    ...config.mysql,
    timezone: "Z",
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });

const connectPostgres = async (config: Config) => {
  const pg = new PgClient({ connectionString: config.postgres.connectionString });
  await pg.connect();
  return pg;
};

const loadTables = async (db: mysql.Connection, database: string) => {
  const [rows] = await db.query<Array<{ table_name: string; table_rows: number; total_mb: string }>>(
    `
      SELECT table_name, COALESCE(table_rows, 0) AS table_rows,
             ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_mb
      FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `,
    [database],
  );
  return rows;
};

const loadColumns = async (db: mysql.Connection, database: string) => {
  const [rows] = await db.query<MySqlColumn[]>(
    `
      SELECT table_name, column_name, ordinal_position, column_default, is_nullable,
             data_type, column_type, character_maximum_length, numeric_precision,
             numeric_scale, extra
      FROM information_schema.columns
      WHERE table_schema = ?
      ORDER BY table_name, ordinal_position
    `,
    [database],
  );
  return rows;
};

const loadIndexes = async (db: mysql.Connection, database: string) => {
  const [rows] = await db.query<MySqlIndex[]>(
    `
      SELECT table_name, index_name, non_unique, seq_in_index, column_name
      FROM information_schema.statistics
      WHERE table_schema = ?
      ORDER BY table_name, index_name, seq_in_index
    `,
    [database],
  );
  return rows;
};

const loadForeignKeys = async (db: mysql.Connection, database: string) => {
  const [rows] = await db.query<MySqlForeignKey[]>(
    `
      SELECT kcu.table_name, kcu.constraint_name, kcu.column_name,
             kcu.referenced_table_name, kcu.referenced_column_name,
             kcu.ordinal_position, rc.update_rule, rc.delete_rule
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_schema = kcu.constraint_schema
       AND rc.constraint_name = kcu.constraint_name
      WHERE kcu.table_schema = ? AND kcu.referenced_table_name IS NOT NULL
      ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position
    `,
    [database],
  );
  return rows;
};

const mapDefault = (column: MySqlColumn) => {
  let value = column.column_default;
  if (value === null || value === undefined) return "";
  if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).replace(/\\'/g, "'");
  }
  const lower = String(value).toLowerCase();
  if (lower === "current_timestamp()" || lower === "current_timestamp" || /^current_timestamp\(\d+\)$/.test(lower)) {
    return " DEFAULT CURRENT_TIMESTAMP";
  }
  if (lower === "null") return "";
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return ` DEFAULT ${value}`;
  return ` DEFAULT ${sqlString(value)}`;
};

const mapColumnType = (column: MySqlColumn) => {
  const dataType = column.data_type.toLowerCase();
  const columnType = column.column_type.toLowerCase();

  if (column.extra.toLowerCase().includes("auto_increment")) {
    if (dataType === "bigint") return "BIGINT GENERATED BY DEFAULT AS IDENTITY";
    return "INTEGER GENERATED BY DEFAULT AS IDENTITY";
  }

  if (dataType === "tinyint") return "SMALLINT";
  if (dataType === "smallint") return "SMALLINT";
  if (dataType === "mediumint" || dataType === "int" || dataType === "integer") return "INTEGER";
  if (dataType === "bigint") return "BIGINT";
  if (dataType === "decimal") {
    const precision = column.numeric_precision ?? 12;
    const scale = column.numeric_scale ?? 2;
    return `NUMERIC(${precision}, ${scale})`;
  }
  if (dataType === "float" || dataType === "double") return "DOUBLE PRECISION";
  if (dataType === "datetime" || dataType === "timestamp") return "TIMESTAMP";
  if (dataType === "date") return "DATE";
  if (dataType === "time") return "TIME";
  if (dataType === "json") return "TEXT";
  if (dataType === "longtext" || dataType === "mediumtext" || dataType === "tinytext" || dataType === "text") return "TEXT";
  if (dataType === "enum") return "TEXT";
  if (dataType === "char") return `CHAR(${column.character_maximum_length ?? 255})`;
  if (dataType === "varchar") return `VARCHAR(${column.character_maximum_length ?? 255})`;
  if (dataType.includes("blob") || columnType.includes("binary")) return "BYTEA";
  return "TEXT";
};

const enumCheck = (column: MySqlColumn) => {
  if (column.data_type.toLowerCase() !== "enum") return "";
  const values = Array.from(column.column_type.matchAll(/'((?:[^'\\]|\\.)*)'/g)).map((match) =>
    match[1].replace(/\\'/g, "'"),
  );
  if (values.length === 0) return "";
  return ` CHECK (${q(column.column_name)} IN (${values.map(sqlString).join(", ")}))`;
};

const columnSql = (column: MySqlColumn) => {
  const nullable = column.is_nullable === "NO" && !column.extra.toLowerCase().includes("auto_increment") ? " NOT NULL" : "";
  return `${q(column.column_name)} ${mapColumnType(column)}${nullable}${mapDefault(column)}${enumCheck(column)}`;
};

const groupedBy = <T, K extends string>(items: T[], keyFn: (item: T) => K) => {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
};

const buildPrimaryKeys = (indexes: MySqlIndex[]) => {
  const grouped = groupedBy(indexes.filter((index) => index.index_name === "PRIMARY"), (index) => index.table_name);
  const result = new Map<string, string[]>();
  for (const [table, entries] of grouped) {
    result.set(table, entries.sort((a, b) => a.seq_in_index - b.seq_in_index).map((entry) => entry.column_name));
  }
  return result;
};

const buildCreateTableSql = (tableName: string, columns: MySqlColumn[], primaryKeys: Map<string, string[]>) => {
  const definitions = columns.map(columnSql);
  const pk = primaryKeys.get(tableName);
  if (pk && pk.length > 0) {
    definitions.push(`PRIMARY KEY (${pk.map(q).join(", ")})`);
  }
  return `CREATE TABLE IF NOT EXISTS ${q(tableName)} (\n  ${definitions.join(",\n  ")}\n)`;
};

const indexSqls = (indexes: MySqlIndex[]) => {
  const byIndex = groupedBy(indexes.filter((index) => index.index_name !== "PRIMARY"), (index) => `${index.table_name}:${index.index_name}`);
  const sql: string[] = [];
  for (const entries of byIndex.values()) {
    const sorted = entries.sort((a, b) => a.seq_in_index - b.seq_in_index);
    const first = sorted[0];
    const unique = first.non_unique === 0 ? "UNIQUE " : "";
    sql.push(
      `CREATE ${unique}INDEX IF NOT EXISTS ${q(first.index_name)} ON ${q(first.table_name)} (${sorted
        .map((entry) => q(entry.column_name))
        .join(", ")})`,
    );
  }
  return sql;
};

const fkSqls = (foreignKeys: MySqlForeignKey[]) => {
  const byFk = groupedBy(foreignKeys, (fk) => `${fk.table_name}:${fk.constraint_name}`);
  const sql: string[] = [];
  for (const entries of byFk.values()) {
    const sorted = entries.sort((a, b) => a.ordinal_position - b.ordinal_position);
    const first = sorted[0];
    const onDelete = first.delete_rule && first.delete_rule !== "RESTRICT" ? ` ON DELETE ${first.delete_rule}` : "";
    const onUpdate = first.update_rule && first.update_rule !== "RESTRICT" ? ` ON UPDATE ${first.update_rule}` : "";
    sql.push(
      `ALTER TABLE ${q(first.table_name)} ADD CONSTRAINT ${q(first.constraint_name)} FOREIGN KEY (${sorted
        .map((entry) => q(entry.column_name))
        .join(", ")}) REFERENCES ${q(first.referenced_table_name)} (${sorted
        .map((entry) => q(entry.referenced_column_name))
        .join(", ")})${onDelete}${onUpdate}`,
    );
  }
  return sql;
};

const dependencyOrder = (tables: string[], foreignKeys: MySqlForeignKey[]) => {
  const remaining = new Set(tables);
  const parentsByChild = new Map<string, Set<string>>();
  for (const fk of foreignKeys) {
    if (fk.table_name === fk.referenced_table_name) continue;
    if (!parentsByChild.has(fk.table_name)) parentsByChild.set(fk.table_name, new Set());
    parentsByChild.get(fk.table_name)?.add(fk.referenced_table_name);
  }
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => {
      const parents = parentsByChild.get(table) ?? new Set();
      return [...parents].every((parent) => !remaining.has(parent));
    });
    if (ready.length === 0) {
      ordered.push(...[...remaining].sort());
      break;
    }
    ready.sort();
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
};

const audit = async (config: Config) => {
  const db = await connectMysql(config);
  try {
    const [summaryRows] = await db.query<Array<{ tableCount: number; totalMb: string }>>(
      `
        SELECT COUNT(*) AS tableCount,
               COALESCE(ROUND(SUM(data_length + index_length) / 1024 / 1024, 2), 0) AS totalMb
        FROM information_schema.tables
        WHERE table_schema = ?
      `,
      [config.mysql.database],
    );
    const tables = await loadTables(db, config.mysql.database);
    const columns = await loadColumns(db, config.mysql.database);
    const indexes = await loadIndexes(db, config.mysql.database);
    const foreignKeys = await loadForeignKeys(db, config.mysql.database);
    const result = {
      source: {
        host: config.mysql.host,
        port: config.mysql.port,
        database: config.mysql.database,
      },
      summary: summaryRows[0],
      tables: tables.slice().sort((a, b) => Number(b.total_mb) - Number(a.total_mb)).slice(0, 30),
      columnCount: columns.length,
      indexCount: new Set(indexes.map((index) => `${index.table_name}:${index.index_name}`)).size,
      foreignKeyCount: new Set(foreignKeys.map((fk) => `${fk.table_name}:${fk.constraint_name}`)).size,
    };
    const filePath = writeArtifact(config, "audit.json", result);
    console.log(JSON.stringify({ ok: true, filePath, ...result }, null, 2));
  } finally {
    await db.end();
  }
};

const applySchema = async (config: Config) => {
  const mysqlDb = await connectMysql(config);
  const pg = await connectPostgres(config);
  try {
    const tables = await loadTables(mysqlDb, config.mysql.database);
    const columns = await loadColumns(mysqlDb, config.mysql.database);
    const indexes = await loadIndexes(mysqlDb, config.mysql.database);
    const foreignKeys = await loadForeignKeys(mysqlDb, config.mysql.database);
    const columnsByTable = groupedBy(columns, (column) => column.table_name);
    const primaryKeys = buildPrimaryKeys(indexes);

    for (const table of tables) {
      await pg.query(buildCreateTableSql(table.table_name, columnsByTable.get(table.table_name) ?? [], primaryKeys));
    }
    for (const sql of indexSqls(indexes)) {
      await pg.query(sql);
    }
    for (const sql of fkSqls(foreignKeys)) {
      await pg.query(sql).catch((error) => {
        if (error?.code !== "42710") throw error;
      });
    }
    console.log(JSON.stringify({ ok: true, tables: tables.length, indexes: indexSqls(indexes).length, foreignKeys: fkSqls(foreignKeys).length }, null, 2));
  } finally {
    await mysqlDb.end();
    await pg.end();
  }
};

const countPgRows = async (pg: PgClient, tableName: string) => {
  const result = await pg.query(`SELECT COUNT(*)::bigint AS count FROM ${q(tableName)}`);
  return Number(result.rows[0]?.count ?? 0);
};

const truncateTables = async (pg: PgClient, tableNames: string[]) => {
  if (tableNames.length === 0) return;
  await pg.query(`TRUNCATE ${tableNames.map(q).join(", ")} RESTART IDENTITY CASCADE`);
};

const copyTable = async (
  mysqlDb: mysql.Connection,
  pg: PgClient,
  tableName: string,
  columns: MySqlColumn[],
  primaryKeys: Map<string, string[]>,
  batchSize: number,
) => {
  const columnNames = columns.map((column) => column.column_name);
  if (columnNames.length === 0) return { tableName, copied: 0 };
  let copied = 0;

  const singlePk = primaryKeys.get(tableName)?.length === 1 ? primaryKeys.get(tableName)?.[0] : null;
  if (singlePk) {
    const [maxRows] = await mysqlDb.query<Array<{ max_value: unknown }>>(
      `SELECT \`${singlePk}\` AS max_value FROM \`${tableName}\` ORDER BY \`${singlePk}\` DESC LIMIT 1`,
    );
    const maxValue = maxRows[0]?.max_value ?? null;
    if (maxValue === null || maxValue === undefined) return { tableName, copied: 0 };
    let lastValue: unknown = null;
    for (;;) {
      const where = lastValue === null ? `\`${singlePk}\` <= ?` : `\`${singlePk}\` > ? AND \`${singlePk}\` <= ?`;
      const params = lastValue === null ? [maxValue, batchSize] : [lastValue, maxValue, batchSize];
      const [rows] = await mysqlDb.query<Record<string, unknown>[]>(
        `SELECT ${columnNames.map((column) => `\`${column}\``).join(", ")} FROM \`${tableName}\` WHERE ${where} ORDER BY \`${singlePk}\` ASC LIMIT ?`,
        params,
      );
      if (!Array.isArray(rows) || rows.length === 0) break;
      const values: unknown[] = [];
      const tuples = rows.map((row, rowIndex) => {
        const placeholders = columnNames.map((_column, columnIndex) => `$${rowIndex * columnNames.length + columnIndex + 1}`);
        for (const columnName of columnNames) values.push(row[columnName] ?? null);
        return `(${placeholders.join(", ")})`;
      });
      await pg.query(
        `INSERT INTO ${q(tableName)} (${columnNames.map(q).join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`,
        values,
      );
      copied += rows.length;
      lastValue = rows[rows.length - 1][singlePk];
      console.log(JSON.stringify({ tableName, copied }));
      if (rows.length < batchSize) break;
    }
    return { tableName, copied };
  }

  const [[snapshotCount]] = await mysqlDb.query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM \`${tableName}\``,
  );
  const totalRows = Number(snapshotCount.count) || 0;
  let offset = 0;
  while (offset < totalRows) {
    const [rows] = await mysqlDb.query<Record<string, unknown>[]>(
      `SELECT ${columnNames.map((column) => `\`${column}\``).join(", ")} FROM \`${tableName}\` ORDER BY ${columnNames.map((column) => `\`${column}\``).join(", ")} LIMIT ? OFFSET ?`,
      [batchSize, offset],
    );
    if (!Array.isArray(rows) || rows.length === 0) break;
    const values: unknown[] = [];
    const tuples = rows.map((row, rowIndex) => {
      const placeholders = columnNames.map((_column, columnIndex) => `$${rowIndex * columnNames.length + columnIndex + 1}`);
      for (const columnName of columnNames) values.push(row[columnName] ?? null);
      return `(${placeholders.join(", ")})`;
    });
    await pg.query(
      `INSERT INTO ${q(tableName)} (${columnNames.map(q).join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`,
      values,
    );
    copied += rows.length;
    offset += rows.length;
    console.log(JSON.stringify({ tableName, copied }));
  }
  return { tableName, copied };
};

const resetSequences = async (pg: PgClient) => {
  const result = await pg.query<Array<{ table_name: string; column_name: string; sequence_name: string }>>(
    `
      SELECT table_name, column_name, pg_get_serial_sequence(format('%I', table_name), column_name) AS sequence_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (column_default LIKE 'nextval(%' OR identity_generation IS NOT NULL)
    `,
  );
  for (const row of result.rows) {
    if (!row.sequence_name) continue;
    await pg.query(
      `SELECT setval($1, COALESCE((SELECT MAX(${q(row.column_name)}) FROM ${q(row.table_name)}), 0) + 1, false)`,
      [row.sequence_name],
    );
  }
};

const copyData = async (config: Config, forceTruncate = false) => {
  const mysqlDb = await connectMysql(config);
  const pg = await connectPostgres(config);
  try {
    const tables = await loadTables(mysqlDb, config.mysql.database);
    const columns = await loadColumns(mysqlDb, config.mysql.database);
    const foreignKeys = await loadForeignKeys(mysqlDb, config.mysql.database);
    const indexes = await loadIndexes(mysqlDb, config.mysql.database);
    const primaryKeys = buildPrimaryKeys(indexes);
    const tableNames = dependencyOrder(tables.map((table) => table.table_name), foreignKeys);
    const columnsByTable = groupedBy(columns, (column) => column.table_name);

    if (!forceTruncate) {
      const nonEmpty: Array<{ tableName: string; rows: number }> = [];
      for (const tableName of tableNames) {
        const rows = await countPgRows(pg, tableName).catch(() => 0);
        if (rows > 0) nonEmpty.push({ tableName, rows });
      }
      if (nonEmpty.length > 0) {
        throw new Error(`Postgres target is not empty. Re-run with --truncate. First non-empty table: ${nonEmpty[0].tableName}`);
      }
    } else {
      await truncateTables(pg, tableNames);
    }

    const copied: Array<{ tableName: string; copied: number }> = [];
    for (const tableName of tableNames) {
      copied.push(await copyTable(mysqlDb, pg, tableName, columnsByTable.get(tableName) ?? [], primaryKeys, config.batchSize));
    }
    await resetSequences(pg);
    const filePath = writeArtifact(config, "copy.json", copied);
    console.log(JSON.stringify({ ok: true, filePath, tables: copied.length }, null, 2));
  } finally {
    await mysqlDb.end();
    await pg.end();
  }
};

const validate = async (config: Config) => {
  const mysqlDb = await connectMysql(config);
  const pg = await connectPostgres(config);
  try {
    const tables = await loadTables(mysqlDb, config.mysql.database);
    const mismatches: Array<{ tableName: string; mysqlRows: number; postgresRows: number }> = [];
    for (const table of tables) {
      const [[mysqlCount]] = await mysqlDb.query<Array<{ count: number }>>(`SELECT COUNT(*) AS count FROM \`${table.table_name}\``);
      const pgRows = await countPgRows(pg, table.table_name).catch(() => -1);
      if (Number(mysqlCount.count) !== pgRows) {
        mismatches.push({ tableName: table.table_name, mysqlRows: Number(mysqlCount.count), postgresRows: pgRows });
      }
    }
    const fkResult = await pg.query(
      `SELECT COUNT(*)::bigint AS count FROM pg_constraint WHERE contype = 'f' AND connamespace = current_schema()::regnamespace`,
    );
    const result = {
      ok: mismatches.length === 0,
      tableCount: tables.length,
      mismatches,
      postgresForeignKeys: Number(fkResult.rows[0]?.count ?? 0),
    };
    const filePath = writeArtifact(config, "validate.json", result);
    console.log(JSON.stringify({ filePath, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await mysqlDb.end();
    await pg.end();
  }
};

const finalSync = async (config: Config) => {
  await applySchema(config);
  await copyData(config, true);
  await validate(config);
};

const cutoverReport = async (config: Config) => {
  const password = new URL(config.postgres.connectionString).password || "<senha>";
  const report = {
    generatedAt: new Date().toISOString(),
    env: {
      DATABASE_PROVIDER: "postgres",
      DATABASE_URL: config.postgres.connectionString || `postgres://botadmin:${password}@127.0.0.1:7778/botadmin`,
      REDIS_URL: env("REDIS_URL", "redis://127.0.0.1:7779/0"),
      REDIS_PREFIX: env("REDIS_PREFIX", "botadmin:local"),
    },
    commands: [
      "systemctl stop botadmin-local.service",
      "npm run db:pg:final-sync",
      "npm run db:pg:validate",
      "npm run build",
      "systemctl start botadmin-local.service",
      "curl -fsS http://127.0.0.1:4478/",
    ],
    rollback: [
      "restore .env from /root/botadmin-migration-backups/*.env",
      "systemctl restart botadmin-local.service",
      "keep MariaDB source untouched until post-cutover observation finishes",
    ],
  };
  const filePath = writeArtifact(config, "cutover-report.json", report);
  console.log(JSON.stringify({ ok: true, filePath, report }, null, 2));
};

const ensureLocalPostgresRole = async (config: Config) => {
  const adminUrl = env("POSTGRES_ADMIN_URL", "");
  const pg = adminUrl
    ? new PgClient({ connectionString: adminUrl })
    : new PgClient({
        host: env("POSTGRES_ADMIN_HOST", "/var/run/postgresql"),
        port: Number(env("POSTGRES_ADMIN_PORT", "7778")),
        user: env("POSTGRES_ADMIN_USER", "postgres"),
        database: env("POSTGRES_ADMIN_DATABASE", "postgres"),
      });
  const generatedPassword = env("POSTGRES_TARGET_PASSWORD", randomBytes(24).toString("base64url"));
  try {
    await pg.connect();
    await pg.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'botadmin') THEN CREATE ROLE botadmin LOGIN; END IF; END $$;",
    );
    await pg.query(`ALTER ROLE botadmin WITH PASSWORD ${mysql.escape(generatedPassword)}`);
    await pg.query("SELECT 1 FROM pg_database WHERE datname = 'botadmin'").then(async (result) => {
      if (result.rowCount === 0) {
        await pg.query("CREATE DATABASE botadmin OWNER botadmin");
      }
    });
    const output = {
      ok: true,
      database: "botadmin",
      role: "botadmin",
      databaseUrl: `postgres://botadmin:${encodeURIComponent(generatedPassword)}@127.0.0.1:7778/botadmin`,
      note: "Store this DATABASE_URL in .env before cutover.",
    };
    const filePath = writeArtifact(config, "setup-local-postgres.json", output);
    console.log(JSON.stringify({ filePath, ...output }, null, 2));
  } finally {
    await pg.end().catch(() => {});
  }
};

const main = async () => {
  const config = getConfig();
  if (command === "audit") return audit(config);
  if (command === "schema") return applySchema(config);
  if (command === "copy") return copyData(config, args.has("--truncate"));
  if (command === "validate") return validate(config);
  if (command === "final-sync") return finalSync(config);
  if (command === "cutover-report") return cutoverReport(config);
  if (command === "setup-local-postgres") return ensureLocalPostgresRole(config);
  throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
  const digest = createHash("sha256").update(String(error?.stack || error?.message || error)).digest("hex").slice(0, 12);
  console.error(JSON.stringify({ ok: false, digest, message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
