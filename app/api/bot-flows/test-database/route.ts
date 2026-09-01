import { NextResponse } from "next/server";
import mysql from "mysql2/promise";

import { getCurrentUser } from "lib/auth";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const renderTemplate = (value: unknown, variables: Record<string, string>) =>
  String(value ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, rawKey: string) => variables[rawKey.toLowerCase()] ?? "");

const normalizeVariables = (value: unknown): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(asRecord(value))) {
    const normalized = key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    if (normalized) output[normalized] = typeof entry === "string" ? entry : String(entry ?? "");
  }
  return output;
};

const cleanText = (value: unknown, max = 4000) => String(value ?? "").trim().slice(0, max);

const safeQueryForOperation = (query: string, operation: string) => {
  const compact = query.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ").trim();
  const firstWord = compact.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!compact || compact.includes(";")) return false;
  if (operation === "select") return firstWord === "select";
  if (operation === "insert") return firstWord === "insert";
  if (operation === "update") return firstWord === "update";
  if (operation === "delete") return firstWord === "delete";
  return ["select", "insert", "update", "delete", "with"].includes(firstWord);
};

const parseValues = (value: unknown, variables: Record<string, string>): unknown[] => {
  const raw = renderTemplate(value, variables).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 100) : [];
  } catch {
    return [];
  }
};

const limitRows = (rows: unknown) => {
  if (!Array.isArray(rows)) return rows;
  return rows.slice(0, 20);
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  try {
    const payload = asRecord(await request.json().catch(() => null));
    const variables = normalizeVariables(payload.variables);
    const provider = cleanText(payload.provider || payload.databaseProvider).toLowerCase();
    const operation = cleanText(payload.operation || payload.databaseOperation || "query").toLowerCase();
    const host = renderTemplate(payload.host || payload.databaseHost, variables);
    const port = Number(payload.port || payload.databasePort || (provider === "postgres" ? 5432 : 3306));
    const database = renderTemplate(payload.database || payload.databaseName, variables);
    const userName = renderTemplate(payload.user || payload.databaseUser, variables);
    const password = renderTemplate(payload.password || payload.databasePassword, variables);
    const ssl = Boolean(payload.ssl || payload.databaseSsl);
    const query = renderTemplate(payload.query || payload.databaseQuery, variables);
    const values = parseValues(payload.valuesJson || payload.databaseValuesJson, variables);

    if (!["mysql", "postgres"].includes(provider)) {
      return NextResponse.json({ message: "Escolha MySQL ou PostgreSQL." }, { status: 400 });
    }
    if (!host || !database || !userName) {
      return NextResponse.json({ message: "Informe host, banco e usuário." }, { status: 400 });
    }
    if (!safeQueryForOperation(query, operation)) {
      return NextResponse.json({ message: "Query incompatível com a operação selecionada ou contém múltiplos comandos." }, { status: 400 });
    }

    if (provider === "mysql") {
      const connection = await mysql.createConnection({
        host,
        port: Number.isFinite(port) ? port : 3306,
        database,
        user: userName,
        password,
        ssl: ssl ? {} : undefined,
        connectTimeout: 8000,
      });
      try {
        const [rows] = await connection.execute(query, values);
        return NextResponse.json({ ok: true, provider, rows: limitRows(rows), affectedRows: (rows as { affectedRows?: number }).affectedRows ?? null });
      } finally {
        await connection.end();
      }
    }

    let PgClient: any;
    try {
      PgClient = (eval("require") as NodeRequire)("pg").Client;
    } catch {
      return NextResponse.json(
        { message: "Suporte PostgreSQL precisa do pacote pg instalado no servidor." },
        { status: 400 },
      );
    }
    const client = new PgClient({
      host,
      port: Number.isFinite(port) ? port : 5432,
      database,
      user: userName,
      password,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8000,
    });
    await client.connect();
    try {
      const result = await client.query(query, values);
      return NextResponse.json({ ok: true, provider, rows: limitRows(result.rows), rowCount: result.rowCount });
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("[bot-flows] database test failed", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível testar o banco." },
      { status: 400 },
    );
  }
}
