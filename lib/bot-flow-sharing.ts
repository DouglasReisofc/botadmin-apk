import { randomUUID } from "crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import {
  createBotFlowForUser,
  ensureBotFlowsTable,
  getBotFlowForUser,
  sanitizeFlowEdges,
  sanitizeFlowNodes,
} from "lib/bot-flows";
import { getDb } from "lib/db";
import { getPublicAppBaseUrl } from "lib/meta";
import type { BotFlow, BotFlowEdge, BotFlowInput, BotFlowNode } from "types/bot-flows";

const SHARE_TABLE_NAME = "bot_flow_shares";
const SHARE_SCHEMA = "botadmin.flow.share";
const SHARE_VERSION = 1;
const BOTCONVERSA_API_BASE = "https://backend.botconversa.com.br/api/v2";

type BotFlowShareRow = RowDataPacket & {
  code: string;
  user_id: number;
  flow_id: number;
  snapshot_json: string;
  is_active: number | boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_accessed_at: Date | string | null;
};

type UnknownRecord = Record<string, unknown>;

export type BotFlowSharePackage = {
  schema: typeof SHARE_SCHEMA;
  version: typeof SHARE_VERSION;
  exportedAt: string;
  source: {
    platform: "botadmin" | "botconversa" | "json";
    shareCode?: string;
    url?: string;
  };
  flow: Required<Pick<BotFlowInput, "name" | "command" | "scope" | "triggerType" | "matchMode" | "enabled" | "nodes" | "edges">> & {
    instanceId: null;
    groupId: null;
    description: string | null;
  };
  meta: {
    originalFlowId?: number | string | null;
    originalName?: string | null;
    nodeCount: number;
    edgeCount: number;
    warnings: string[];
  };
};

export type BotFlowShareSummary = {
  code: string;
  flowId: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
};

export type ImportedBotFlowResult = {
  flow: BotFlow;
  package: BotFlowSharePackage;
  warnings: string[];
};

export type ImportSharedFlowParams = {
  userId: number;
  input?: string;
  code?: string;
  url?: string;
  package?: unknown;
  raw?: unknown;
  botconversaAuthorization?: string;
  name?: string;
  command?: string;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const sanitizeText = (value: unknown, fallback = "", max = 4000): string => {
  const text = typeof value === "string" ? value : value === null || value === undefined ? fallback : String(value);
  return text.replace(/\r\n/g, "\n").trim().slice(0, max);
};

const slugifyCommand = (value: unknown, fallback = "fluxo-importado"): string => {
  const raw = sanitizeText(value, fallback, 80) || fallback;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return normalized || fallback;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const pickFirst = (source: UnknownRecord, keys: string[]): unknown => {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const parseJsonMaybe = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const stringifyCompact = (value: unknown, max = 1600): string => {
  try {
    return JSON.stringify(value, null, 2).slice(0, max);
  } catch {
    return sanitizeText(value, "", max);
  }
};

export const buildBotFlowShareUrl = (code: string): string =>
  `${getPublicAppBaseUrl()}/share-flow?share_code=${encodeURIComponent(code)}`;

const mapShareRow = (row: BotFlowShareRow): BotFlowShareSummary => ({
  code: row.code,
  flowId: Number(row.flow_id),
  url: buildBotFlowShareUrl(row.code),
  createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  lastAccessedAt: toIso(row.last_accessed_at),
});

export const ensureBotFlowSharesTable = async () => {
  await ensureBotFlowsTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${SHARE_TABLE_NAME} (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(80) NOT NULL UNIQUE,
      user_id INT NOT NULL,
      flow_id INT NOT NULL,
      snapshot_json LONGTEXT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_accessed_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_bot_flow_shares_user_flow (user_id, flow_id),
      INDEX idx_bot_flow_shares_flow (flow_id),
      CONSTRAINT fk_bot_flow_shares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_bot_flow_shares_flow FOREIGN KEY (flow_id) REFERENCES bot_flows(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
};

const buildPackageFromFlow = (
  flow: BotFlow,
  source: BotFlowSharePackage["source"] = { platform: "botadmin" },
  warnings: string[] = [],
): BotFlowSharePackage => {
  const nodes = sanitizeFlowNodes(flow.nodes, flow.command);
  const edges = sanitizeFlowEdges(flow.edges, nodes);
  return {
    schema: SHARE_SCHEMA,
    version: SHARE_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    flow: {
      name: sanitizeText(flow.name, "Fluxo compartilhado", 120) || "Fluxo compartilhado",
      command: slugifyCommand(flow.command, "fluxo-compartilhado"),
      scope: flow.scope,
      instanceId: null,
      groupId: null,
      triggerType: flow.triggerType,
      matchMode: flow.matchMode,
      enabled: Boolean(flow.enabled),
      description: flow.description,
      nodes,
      edges,
    },
    meta: {
      originalFlowId: flow.id,
      originalName: flow.name,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      warnings,
    },
  };
};

export const createOrUpdateBotFlowShare = async (userId: number, flowId: number) => {
  const flow = await getBotFlowForUser(userId, flowId);
  if (!flow) {
    throw new Error("Fluxo não encontrado.");
  }
  await ensureBotFlowSharesTable();
  const db = getDb();
  const pack = buildPackageFromFlow(flow);
  const [existingRows] = await db.query<BotFlowShareRow[]>(
    `SELECT * FROM ${SHARE_TABLE_NAME} WHERE user_id = ? AND flow_id = ? LIMIT 1`,
    [userId, flowId],
  );
  const existing = existingRows[0];
  if (existing) {
    await db.query(
      `UPDATE ${SHARE_TABLE_NAME}
       SET snapshot_json = ?, is_active = 1, updated_at = NOW()
       WHERE user_id = ? AND flow_id = ?`,
      [JSON.stringify(pack), userId, flowId],
    );
    const [rows] = await db.query<BotFlowShareRow[]>(
      `SELECT * FROM ${SHARE_TABLE_NAME} WHERE user_id = ? AND flow_id = ? LIMIT 1`,
      [userId, flowId],
    );
    return { share: mapShareRow(rows[0] ?? existing), package: pack };
  }

  const code = randomUUID();
  await db.query<ResultSetHeader>(
    `INSERT INTO ${SHARE_TABLE_NAME} (code, user_id, flow_id, snapshot_json)
     VALUES (?, ?, ?, ?)`,
    [code, userId, flowId, JSON.stringify(pack)],
  );
  const [rows] = await db.query<BotFlowShareRow[]>(
    `SELECT * FROM ${SHARE_TABLE_NAME} WHERE code = ? LIMIT 1`,
    [code],
  );
  return { share: mapShareRow(rows[0]), package: pack };
};

export const getSharedBotFlowPackage = async (code: string): Promise<{
  share: BotFlowShareSummary;
  package: BotFlowSharePackage;
} | null> => {
  const shareCode = sanitizeText(code, "", 80);
  if (!shareCode) return null;
  await ensureBotFlowSharesTable();
  const db = getDb();
  const [rows] = await db.query<BotFlowShareRow[]>(
    `SELECT * FROM ${SHARE_TABLE_NAME} WHERE code = ? AND is_active = 1 LIMIT 1`,
    [shareCode],
  );
  const row = rows[0];
  if (!row) return null;
  await db.query(`UPDATE ${SHARE_TABLE_NAME} SET last_accessed_at = NOW() WHERE code = ?`, [shareCode]);
  const parsed = parseJsonMaybe(row.snapshot_json);
  if (!isBotAdminSharePackage(parsed)) return null;
  return { share: mapShareRow(row), package: parsed };
};

const isBotAdminSharePackage = (value: unknown): value is BotFlowSharePackage =>
  isRecord(value) &&
  value.schema === SHARE_SCHEMA &&
  value.version === SHARE_VERSION &&
  isRecord(value.flow) &&
  Array.isArray(value.flow.nodes);

const normalizePackageForImport = (
  pack: BotFlowSharePackage,
  overrides?: { name?: string; command?: string },
): { input: BotFlowInput; package: BotFlowSharePackage } => {
  const command = slugifyCommand(overrides?.command || pack.flow.command, "fluxo-importado");
  const nodes = sanitizeFlowNodes(pack.flow.nodes, command);
  const edges = sanitizeFlowEdges(pack.flow.edges, nodes);
  return {
    input: {
      scope: pack.flow.scope === "private" ? "private" : pack.flow.scope === "both" ? "both" : "group",
      instanceId: null,
      groupId: null,
      name: sanitizeText(overrides?.name || pack.flow.name, "Fluxo importado", 120) || "Fluxo importado",
      command,
      triggerType: pack.flow.triggerType,
      matchMode: pack.flow.matchMode,
      enabled: false,
      description: pack.flow.description,
      nodes,
      edges,
    },
    package: {
      ...pack,
      flow: {
        ...pack.flow,
        name: sanitizeText(overrides?.name || pack.flow.name, "Fluxo importado", 120) || "Fluxo importado",
        command,
        instanceId: null,
        groupId: null,
        nodes,
        edges,
      },
      meta: {
        ...pack.meta,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    },
  };
};

const extractShareCodeFromInput = (value: string): { code: string | null; platform: "botadmin" | "botconversa" | null } => {
  const raw = sanitizeText(value, "", 1000);
  if (!raw) return { code: null, platform: null };
  try {
    const url = new URL(raw);
    const code =
      url.searchParams.get("share_code") ||
      url.searchParams.get("flow_share") ||
      url.searchParams.get("code") ||
      url.pathname.split("/").filter(Boolean).at(-1) ||
      "";
    const host = url.hostname.toLowerCase();
    return {
      code: sanitizeText(code, "", 120) || null,
      platform: host.includes("botconversa.com.br") ? "botconversa" : "botadmin",
    };
  } catch {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      return { code: raw, platform: null };
    }
    return { code: null, platform: null };
  }
};

const detectBotConversaBlockKind = (block: UnknownRecord): BotFlowNode["kind"] => {
  const raw = sanitizeText(
    pickFirst(block, ["kind", "type", "block_type", "component", "name", "subtype"]),
    "",
    80,
  ).toLowerCase();
  if (/menu|list|choice|option/.test(raw) || Array.isArray(block.options) || Array.isArray(block.items)) return "menu";
  if (/button|quick_reply|reply/.test(raw) || Array.isArray(block.buttons)) return "buttons";
  if (/image|video|audio|media|file|document/.test(raw) || block.media || block.media_url || block.file) return "media";
  if (/delay|wait|typing/.test(raw)) return "delay";
  if (/condition|if|rule/.test(raw)) return "condition";
  if (/webhook/.test(raw)) return "webhook_wait";
  if (/http|request|integration/.test(raw)) return "http_request";
  if (/capture|input|question|ask/.test(raw)) return "capture";
  if (/trigger|start/.test(raw)) return "trigger";
  return "text";
};

const extractPlainText = (value: unknown): string => {
  const parsed = parseJsonMaybe(value);
  if (typeof parsed === "string") return sanitizeText(parsed, "", 4000);
  if (Array.isArray(parsed)) {
    return parsed.map(extractPlainText).filter(Boolean).join("\n").slice(0, 4000);
  }
  if (isRecord(parsed)) {
    const direct = pickFirst(parsed, ["text", "message", "body", "content", "caption", "value", "title", "subtitle"]);
    if (direct !== undefined) {
      const text = extractPlainText(direct);
      if (text) return text;
    }
    if (Array.isArray(parsed.blocks)) {
      return parsed.blocks.map(extractPlainText).filter(Boolean).join("\n").slice(0, 4000);
    }
    if (Array.isArray(parsed.children)) {
      return parsed.children.map(extractPlainText).filter(Boolean).join("\n").slice(0, 4000);
    }
  }
  return "";
};

const extractMediaType = (block: UnknownRecord): BotFlowNode["mediaType"] => {
  const raw = sanitizeText(pickFirst(block, ["mediaType", "media_type", "file_type", "type"]), "", 80).toLowerCase();
  if (raw.includes("video")) return "video";
  if (raw.includes("audio") || raw.includes("voice")) return "audio";
  if (raw.includes("doc") || raw.includes("file") || raw.includes("pdf")) return "document";
  return "image";
};

const normalizeBotConversaOption = (value: unknown, index: number) => {
  const option = isRecord(value) ? value : { label: value };
  const label = sanitizeText(pickFirst(option, ["label", "title", "name", "text", "value"]), `Opção ${index + 1}`, 80);
  const target = sanitizeText(pickFirst(option, ["target", "target_id", "next", "next_id", "next_block", "next_block_id", "block", "block_id"]), "", 80);
  return {
    id: sanitizeText(pickFirst(option, ["id", "uuid", "key"]), `option_${index + 1}`, 80) || `option_${index + 1}`,
    label: label || `Opção ${index + 1}`,
    value: sanitizeText(pickFirst(option, ["value", "payload", "command"]), label, 500) || label,
    description: sanitizeText(pickFirst(option, ["description", "subtitle"]), "", 160),
    target,
  };
};

const extractNextTarget = (block: UnknownRecord): string => {
  return sanitizeText(
    pickFirst(block, [
      "target",
      "target_id",
      "next",
      "next_id",
      "nextBlock",
      "next_block",
      "next_block_id",
      "next_step",
      "next_step_id",
      "block",
      "block_id",
    ]),
    "",
    80,
  );
};

const extractBotConversaBlocks = (source: unknown): UnknownRecord[] => {
  const parsed = parseJsonMaybe(source);
  const visited = new Set<unknown>();
  const arrays: UnknownRecord[][] = [];

  const walk = (value: unknown) => {
    if (!value || visited.has(value)) return;
    if (typeof value === "object") visited.add(value);
    if (Array.isArray(value)) {
      const records = value.filter(isRecord);
      const score = records.filter((entry) =>
        Boolean(pickFirst(entry, ["id", "uuid", "type", "kind", "block_type", "message", "text", "content", "buttons", "options"])),
      ).length;
      if (records.length > 0 && score >= Math.max(1, Math.floor(records.length * 0.4))) {
        arrays.push(records);
      }
      records.forEach(walk);
      return;
    }
    if (!isRecord(value)) return;
    for (const key of ["blocks", "nodes", "flow_blocks", "flowBlocks", "steps", "items", "data", "results"]) {
      if (value[key]) walk(value[key]);
    }
  };

  walk(parsed);
  return arrays.sort((a, b) => b.length - a.length)[0] ?? [];
};

const convertBotConversaToPackage = (
  raw: unknown,
  source: BotFlowSharePackage["source"],
): BotFlowSharePackage => {
  const root = parseJsonMaybe(raw);
  const record = isRecord(root) ? root : {};
  const flowRecord = isRecord(record.flow) ? record.flow : isRecord(record.data) ? (record.data as UnknownRecord) : record;
  const name = sanitizeText(pickFirst(flowRecord, ["name", "title", "flow_name", "label"]), "Fluxo BotConversa", 120) || "Fluxo BotConversa";
  const command = slugifyCommand(pickFirst(flowRecord, ["command", "keyword", "trigger", "slug"]), name);
  const warnings: string[] = [];
  const blocks = extractBotConversaBlocks(root);

  if (blocks.length === 0) {
    warnings.push("Nao foi possivel identificar blocos estruturados do BotConversa; o payload original ficou em um bloco de revisao.");
    const nodes = sanitizeFlowNodes(
      [
        {
          id: "trigger",
          kind: "trigger",
          title: "Gatilho #1",
          x: 40,
          y: 100,
          text: `/${command}`,
          triggerType: "command",
          triggerMatchMode: "exact",
          triggerValue: command,
        },
        {
          id: "bc-review",
          kind: "text",
          title: "Revisar importacao",
          x: 360,
          y: 100,
          text: `Fluxo importado do BotConversa, mas o formato veio desconhecido.\n\n${stringifyCompact(root)}`,
        },
      ],
      command,
    );
    const edges = sanitizeFlowEdges([{ id: "edge-trigger-bc-review", from: "trigger", to: "bc-review" }], nodes);
    return {
      schema: SHARE_SCHEMA,
      version: SHARE_VERSION,
      exportedAt: new Date().toISOString(),
      source,
      flow: {
        name,
        command,
        scope: "group",
        instanceId: null,
        groupId: null,
        triggerType: "command",
        matchMode: "exact",
        enabled: false,
        description: `Importado do BotConversa. Origem: ${source.url || source.shareCode || "payload colado"}`,
        nodes,
        edges,
      },
      meta: {
        originalFlowId: sanitizeText(pickFirst(flowRecord, ["id", "uuid"]), "", 120) || null,
        originalName: name,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        warnings,
      },
    };
  }

  const idMap = new Map<string, string>();
  blocks.forEach((block, index) => {
    const original = sanitizeText(pickFirst(block, ["id", "uuid", "key", "block_id"]), `${index + 1}`, 80) || `${index + 1}`;
    idMap.set(original, `bc_${original.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
  });

  const nodes: BotFlowNode[] = [
    {
      id: "trigger",
      kind: "trigger",
      title: "Gatilho #1",
      x: 40,
      y: 100,
      text: `/${command}`,
      triggerType: "command",
      triggerMatchMode: "exact",
      triggerValue: command,
      triggerMediaType: "any",
    },
  ];
  const edges: BotFlowEdge[] = [];

  blocks.forEach((block, index) => {
    const originalId = sanitizeText(pickFirst(block, ["id", "uuid", "key", "block_id"]), `${index + 1}`, 80) || `${index + 1}`;
    const nodeId = idMap.get(originalId) ?? `bc_${index + 1}`;
    const kind = detectBotConversaBlockKind(block);
    const title = sanitizeText(pickFirst(block, ["title", "name", "label"]), "", 80) || (kind === "menu" ? "Lista" : kind === "buttons" ? "Botões" : "Mensagem");
    const text = extractPlainText(pickFirst(block, ["text", "message", "body", "content", "caption", "editor", "editor_json", "value"])) || title;
    const mediaUrl = sanitizeText(pickFirst(block, ["mediaUrl", "media_url", "url", "file_url", "image", "video", "audio"]), "", 1000);
    const options = asArray(pickFirst(block, ["options", "items", "rows", "buttons"])).map(normalizeBotConversaOption);
    const baseNode: BotFlowNode = {
      id: nodeId,
      kind,
      title,
      x: 360 + (index % 3) * 310,
      y: 100 + Math.floor(index / 3) * 260,
      text,
      headerTitle: kind === "buttons" || kind === "menu" ? title : "",
      footerText: sanitizeText(pickFirst(block, ["footer", "footerText", "footer_text"]), "", 180),
      mediaUrl: kind === "media" || kind === "buttons" ? mediaUrl : "",
      mediaType: extractMediaType(block),
      delaySeconds: kind === "delay" ? Math.max(1, Math.min(120, Number(pickFirst(block, ["seconds", "delay", "delaySeconds", "delay_seconds"])) || 2)) : 0,
      menuMode: kind === "menu" ? "list" : undefined,
      menuOptions: kind === "menu" ? options.map(({ target: _target, ...option }) => option) : [],
      buttons: kind === "buttons"
        ? options.slice(0, 3).map((option) => ({ id: option.id, type: "reply", label: option.label, value: option.value }))
        : [],
      conditionVariable: kind === "condition" ? sanitizeText(pickFirst(block, ["variable", "field"]), "args", 80) : undefined,
      conditionOperator: kind === "condition" ? "contains" : undefined,
      conditionValue: kind === "condition" ? sanitizeText(pickFirst(block, ["value", "expected"]), "", 500) : undefined,
      triggerType: kind === "webhook_wait" ? "webhook" : undefined,
      triggerMatchMode: kind === "webhook_wait" ? "exact" : undefined,
      triggerValue: kind === "webhook_wait" ? slugifyCommand(pickFirst(block, ["token", "path", "slug"]), `webhook-${index + 1}`) : undefined,
    };
    nodes.push(baseNode);

    const nextTarget = extractNextTarget(block);
    const mappedTarget = nextTarget ? idMap.get(nextTarget) : null;
    if (mappedTarget && mappedTarget !== nodeId) {
      edges.push({ id: `edge-${nodeId}-${mappedTarget}`, from: nodeId, to: mappedTarget });
    }
    if (kind === "buttons") {
      options.forEach((option) => {
        const target = option.target ? idMap.get(option.target) : null;
        if (target && target !== nodeId) {
          edges.push({
            id: `edge-${nodeId}-${option.id}-${target}`,
            from: nodeId,
            to: target,
            branch: `button:${option.id}`,
            label: option.label,
          });
        }
      });
    }
    if (kind === "menu") {
      options.forEach((option) => {
        const target = option.target ? idMap.get(option.target) : null;
        if (target && target !== nodeId) {
          edges.push({
            id: `edge-${nodeId}-${option.id}-${target}`,
            from: nodeId,
            to: target,
            branch: `menu:${option.id}`,
            label: option.label,
          });
        }
      });
    }
  });

  if (nodes.length > 1) {
    const first = nodes[1];
    edges.unshift({ id: `edge-trigger-${first.id}`, from: "trigger", to: first.id });
  }

  const sanitizedNodes = sanitizeFlowNodes(nodes, command);
  const sanitizedEdges = sanitizeFlowEdges(edges, sanitizedNodes);
  if (sanitizedEdges.length < edges.length) {
    warnings.push("Algumas conexoes do BotConversa apontavam para blocos ausentes e foram ignoradas.");
  }

  return {
    schema: SHARE_SCHEMA,
    version: SHARE_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    flow: {
      name,
      command,
      scope: "group",
      instanceId: null,
      groupId: null,
      triggerType: "command",
      matchMode: "exact",
      enabled: false,
      description: `Importado do BotConversa. Origem: ${source.url || source.shareCode || "payload colado"}`,
      nodes: sanitizedNodes,
      edges: sanitizedEdges,
    },
    meta: {
      originalFlowId: sanitizeText(pickFirst(flowRecord, ["id", "uuid"]), "", 120) || null,
      originalName: name,
      nodeCount: sanitizedNodes.length,
      edgeCount: sanitizedEdges.length,
      warnings,
    },
  };
};

const fetchBotConversaSharedFlow = async (
  shareCode: string,
  authorization?: string,
): Promise<unknown> => {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "BotAdminFlowImporter/1.0",
  };
  const auth = sanitizeText(authorization, "", 3000);
  if (auth) {
    if (/^(bearer|token)\s+/i.test(auth) || auth.includes("=")) {
      if (auth.includes("=") && !/^(bearer|token)\s+/i.test(auth)) {
        headers.Cookie = auth;
      } else {
        headers.Authorization = auth;
      }
    } else {
      headers.Authorization = `Bearer ${auth}`;
    }
  }
  const response = await fetch(`${BOTCONVERSA_API_BASE}/flows/share/${encodeURIComponent(shareCode)}/`, {
    headers,
    cache: "no-store",
  });
  const bodyText = await response.text();
  const parsed = parseJsonMaybe(bodyText);
  if (!response.ok) {
    const message = isRecord(parsed)
      ? sanitizeText(parsed.detail || parsed.message, "", 300)
      : sanitizeText(bodyText, "", 300);
    throw new Error(
      response.status === 401
        ? "O BotConversa exigiu autenticação para esse link. Informe token/cookie ou cole o JSON exportado."
        : message || "Não foi possível buscar o fluxo no BotConversa.",
    );
  }
  return parsed;
};

const resolvePackageFromImportParams = async (params: ImportSharedFlowParams): Promise<BotFlowSharePackage> => {
  if (isBotAdminSharePackage(params.package)) return params.package;
  if (isBotAdminSharePackage(params.raw)) return params.raw;

  const input = sanitizeText(params.input || params.url || params.code, "", 12000);
  const parsedInput = parseJsonMaybe(input);
  if (isBotAdminSharePackage(parsedInput)) return parsedInput;
  if (isRecord(parsedInput) || Array.isArray(parsedInput)) {
    return convertBotConversaToPackage(parsedInput, { platform: "json" });
  }

  const explicitCode = sanitizeText(params.code, "", 120);
  const explicitUrl = sanitizeText(params.url, "", 1000);
  const detected = extractShareCodeFromInput(explicitUrl || input || explicitCode);
  const shareCode = explicitCode || detected.code;
  if (!shareCode) {
    throw new Error("Informe um link, código de compartilhamento ou JSON de fluxo.");
  }

  if (detected.platform !== "botconversa") {
    const ownShare = await getSharedBotFlowPackage(shareCode);
    if (ownShare) return ownShare.package;
  }

  const rawBotConversa = await fetchBotConversaSharedFlow(shareCode, params.botconversaAuthorization);
  return convertBotConversaToPackage(rawBotConversa, {
    platform: "botconversa",
    shareCode,
    url: explicitUrl || input,
  });
};

export const importSharedBotFlowForUser = async (params: ImportSharedFlowParams): Promise<ImportedBotFlowResult> => {
  const pack = await resolvePackageFromImportParams(params);
  const { input, package: normalizedPackage } = normalizePackageForImport(pack, {
    name: params.name,
    command: params.command,
  });
  const flow = await createBotFlowForUser(params.userId, input);
  return {
    flow,
    package: normalizedPackage,
    warnings: normalizedPackage.meta.warnings,
  };
};
