import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";

const renderTemplate = (value: string | null | undefined, variables: Record<string, string>) =>
  String(value ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, rawKey: string) => variables[rawKey.toLowerCase()] ?? "");

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const normalizeVariables = (value: unknown): Record<string, string> => {
  const source = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    const normalized = key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    if (normalized) out[normalized] = typeof entry === "string" ? entry : String(entry ?? "");
  }
  return out;
};

const collectJsonSuggestions = (value: unknown, prefix = "data", limit = 28): string[] => {
  const suggestions: string[] = [];
  const walk = (entry: unknown, path: string, depth: number) => {
    if (suggestions.length >= limit || depth > 4) return;
    if (entry === null || entry === undefined) return;
    if (typeof entry !== "object") {
      suggestions.push(path);
      return;
    }
    if (Array.isArray(entry)) {
      suggestions.push(path);
      if (entry.length > 0) walk(entry[0], `${path}[0]`, depth + 1);
      return;
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record).slice(0, 12)) {
      walk(record[key], `${path}.${key}`, depth + 1);
      if (suggestions.length >= limit) return;
    }
  };
  walk(value, prefix, 0);
  return Array.from(new Set(["statusCode", ...suggestions]));
};

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const payload = asRecord(await request.json().catch(() => null));
    const variables = {
      usuario: user.name || "usuario",
      nome: user.name || "usuario",
      numero: "",
      args: "",
      comando: "",
      grupo: "",
      instancia: "",
      ...normalizeVariables(payload.variables),
    };
    const method = String(payload.method ?? "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return NextResponse.json({ message: "Método inválido." }, { status: 400 });
    }

    const url = renderTemplate(String(payload.url ?? ""), variables).trim();
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ message: "Informe uma URL começando com http:// ou https://." }, { status: 400 });
    }
    const requestUrl = new URL(url);
    const rawParams = Array.isArray(payload.queryParams) ? payload.queryParams : [];
    for (const entry of rawParams) {
      const record = asRecord(entry);
      const key = renderTemplate(String(record.key ?? ""), variables).trim();
      if (key) requestUrl.searchParams.set(key, renderTemplate(String(record.value ?? ""), variables));
    }

    const headers: Record<string, string> = {};
    const rawHeaders = Array.isArray(payload.headers) ? payload.headers : [];
    for (const entry of rawHeaders) {
      const record = asRecord(entry);
      const key = renderTemplate(String(record.key ?? ""), variables).trim();
      if (key) headers[key] = renderTemplate(String(record.value ?? ""), variables);
    }

    const timeoutSeconds = Math.max(1, Math.min(30, Number(payload.timeoutSeconds ?? 10) || 10));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    try {
      const body = renderTemplate(String(payload.body ?? ""), variables);
      const response = await fetch(requestUrl.toString(), {
        method,
        headers,
        body: method === "GET" || method === "DELETE" || !body.trim() ? undefined : body,
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return NextResponse.json({
        ok: response.ok,
        statusCode: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        text,
        json,
        suggestions: collectJsonSuggestions(json ?? text),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "A requisição passou do tempo limite."
      : error instanceof Error
        ? error.message
        : "Não foi possível testar a requisição.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
