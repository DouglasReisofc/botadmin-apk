import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { canonicalizeCommandText } from "lib/commands/text";
import { getDb } from "lib/db";
import type {
  BotFlow,
  BotFlowEdge,
  BotFlowInput,
  BotFlowMatchMode,
  BotFlowNode,
  BotFlowScope,
  BotFlowTriggerType,
} from "types/bot-flows";

type BotFlowRow = RowDataPacket & {
  id: number;
  user_id: number;
  scope: BotFlowScope;
  instance_id: number | null;
  group_id: number | null;
  name: string;
  command: string;
  trigger_type: BotFlowTriggerType;
  match_mode: BotFlowMatchMode;
  enabled: number | boolean;
  description: string | null;
  nodes_json: string | null;
  edges_json: string | null;
  edit_revision: number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotFlowSessionRow = RowDataPacket & {
  session_id: number;
  session_flow_id: number;
  session_user_id: number;
  session_instance_id: number | null;
  session_group_id: number | null;
  session_chat_id: string;
  session_participant_id: string | null;
  session_status: string;
  session_current_node_id: string | null;
  session_variables_json: string | null;
  session_created_at: Date | string;
  session_updated_at: Date | string;
} & BotFlowRow;

type BotFlowWebhookEventRow = RowDataPacket & {
  id: number;
  user_id: number;
  flow_id: number;
  node_id: string;
  method: string;
  path: string | null;
  query_json: string | null;
  headers_json: string | null;
  body_json: string | null;
  created_at: Date | string;
};

export type BotFlowWaitingSession = {
  id: number;
  flow: BotFlow;
  chatId: string;
  participantId: string | null;
  currentNodeId: string | null;
  variables: Record<string, string>;
};

const TABLE_NAME = "bot_flows";
const SESSION_TABLE_NAME = "bot_flow_sessions";
const RESULT_TABLE_NAME = "bot_flow_results";
const LOG_TABLE_NAME = "bot_flow_logs";
const WEBHOOK_EVENT_TABLE_NAME = "bot_flow_webhook_events";

export class BotFlowRevisionConflictError extends Error {
  current: BotFlow;

  constructor(current: BotFlow) {
    super("Este fluxo foi alterado em outro dispositivo. Sincronizei a versão mais recente.");
    this.name = "BotFlowRevisionConflictError";
    this.current = current;
  }
}

const VALID_SCOPES = new Set<BotFlowScope>(["group", "private", "both"]);
const VALID_TRIGGERS = new Set<BotFlowTriggerType>(["command", "keyword", "message", "media", "button", "webhook"]);
const VALID_MATCHES = new Set<BotFlowMatchMode>(["exact", "contains", "starts_with"]);
const VALID_NODE_KINDS = new Set([
  "trigger",
  "content",
  "menu",
  "action",
  "webhook_wait",
  "text",
  "media",
  "buttons",
  "delay",
  "condition",
  "flow_link",
  "randomizer",
  "smart_delay",
  "integration",
  "assistant_gpt",
  "set_variable",
  "http_request",
  "capture",
  "jump",
]);
const VALID_CAPTURE_TYPES = new Set(["text", "email", "number", "phone", "website", "date", "time", "media"]);
const VALID_MEDIA_TYPES = new Set(["image", "video", "audio", "document"]);
const VALID_CONTENT_ITEM_TYPES = new Set(["text", "image", "video", "file", "audio", "save", "delay", "auto_off", "contact"]);
const VALID_MENU_MODES = new Set(["list", "number", "buttons"]);
const VALID_ACTION_TYPES = new Set([
  "add_tag",
  "remove_tag",
  "custom_event",
  "subscribe_sequence",
  "unsubscribe_sequence",
  "set_field",
  "clear_field",
  "open_chat",
  "assign_chat",
  "notify_team",
  "unassign_chat",
  "complete_chat",
  "pause_automation",
  "restart_automation",
  "clear_gpt_thread",
]);
const VALID_RANDOMIZER_MODES = new Set(["random", "sequential"]);
const VALID_SMART_DELAY_MODES = new Set(["relative", "datetime"]);
const VALID_SMART_DELAY_UNITS = new Set(["seconds", "minutes", "hours", "days"]);
const VALID_TRIGGER_MEDIA_TYPES = new Set(["any", "image", "video", "audio", "document", "sticker", "vcard"]);
const VALID_BUTTON_TYPES = new Set(["reply", "url", "call", "copy"]);
const VALID_CONDITION_OPERATORS = new Set([
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
  "greater_than",
  "less_than",
  "matches_regex",
  "not_matches_regex",
  "is_set",
  "is_empty",
]);
const VALID_VARIABLE_OPERATIONS = new Set(["set", "clear", "append"]);
const VALID_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const VALID_EDGE_BRANCHES = new Set(["default", "true", "false", "invalid"]);
const VALID_DATABASE_PROVIDERS = new Set(["mysql", "postgres"]);
const VALID_DATABASE_OPERATIONS = new Set(["query", "select", "insert", "update", "delete"]);

const NODE_KIND_LABELS: Record<BotFlowNode["kind"], string> = {
  trigger: "Gatilho",
  content: "Conteúdo",
  menu: "Lista",
  action: "Ação",
  webhook_wait: "Webhook",
  text: "Mensagem",
  media: "Mídia",
  buttons: "Botões",
  delay: "Delay",
  condition: "Condição",
  flow_link: "Conexão de fluxo",
  randomizer: "Randomizador",
  smart_delay: "Delay",
  integration: "Banco de dados",
  assistant_gpt: "Assistente GPT",
  set_variable: "Variável",
  http_request: "HTTP",
  capture: "Captura",
  jump: "Jump",
};

const normalizeFlowNodeTitle = (node: BotFlowNode, indexByKind: number): string => {
  const label = NODE_KIND_LABELS[node.kind] ?? "Bloco";
  const title = sanitizeText(node.title, "", 80);
  const normalizedTitle = title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const normalizedLabel = label.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const isGeneric =
    !title ||
    normalizedTitle === normalizedLabel ||
    normalizedTitle === "etapa" ||
    normalizedTitle === "resposta" ||
    new RegExp(`^${normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*#\\d+$`).test(normalizedTitle);
  return isGeneric ? `${label} #${indexByKind}` : title;
};

const isGeneratedOrGenericStackTitle = (value: unknown): boolean => {
  const title = sanitizeText(value, "", 80);
  const normalized = title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return !title || normalized === "sequencia" || normalized === "sequence" || /^sequencia\s*#\d+$/.test(normalized) || /^sequence\s*#\d+$/.test(normalized);
};

const normalizeFlowNodeStacksAndTitles = (nodes: BotFlowNode[]): BotFlowNode[] => {
  const titleCounts = new Map<BotFlowNode["kind"], number>();
  const stackCounts = new Map<string, number>();
  const stackIds = Array.from(new Set(nodes.map((node) => sanitizeText(node.stackId, "", 80)).filter(Boolean)));
  const stackTitleById = new Map<string, string>();
  stackIds.forEach((stackId, index) => {
    const explicitTitle = nodes
      .map((node) => (sanitizeText(node.stackId, "", 80) === stackId ? sanitizeText(node.stackTitle, "", 80) : ""))
      .find((title) => !isGeneratedOrGenericStackTitle(title));
    stackTitleById.set(stackId, explicitTitle || `Sequência #${index + 1}`);
  });
  return nodes.map((node) => {
    const titleIndex = (titleCounts.get(node.kind) ?? 0) + 1;
    titleCounts.set(node.kind, titleIndex);
    const stackId = sanitizeText(node.stackId, "", 80);
    const stackOrder = stackId ? Math.max(0, Math.floor(Number(node.stackOrder ?? stackCounts.get(stackId) ?? 0) || 0)) : undefined;
    if (stackId) stackCounts.set(stackId, Math.max(stackCounts.get(stackId) ?? 0, stackOrder ?? 0) + 1);
    return {
      ...node,
      title: normalizeFlowNodeTitle(node, titleIndex),
      stackId: stackId || undefined,
      stackOrder,
      stackTitle: stackId ? stackTitleById.get(stackId) : undefined,
    };
  });
};

const toIso = (value: Date | string): string => {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
};

const parseJsonArray = <T>(value: string | null, fallback: T[]): T[] => {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

const sanitizeText = (value: unknown, fallback = "", max = 4000): string => {
  const text = typeof value === "string" ? value : String(value ?? fallback);
  return text.replace(/\r\n/g, "\n").trim().slice(0, max);
};

const sanitizeScope = (value: unknown): BotFlowScope => {
  const normalized = String(value ?? "").trim();
  return VALID_SCOPES.has(normalized as BotFlowScope) ? (normalized as BotFlowScope) : "group";
};

const sanitizeTriggerType = (value: unknown): BotFlowTriggerType => {
  const normalized = String(value ?? "").trim();
  return VALID_TRIGGERS.has(normalized as BotFlowTriggerType) ? (normalized as BotFlowTriggerType) : "command";
};

const normalizeWebhookToken = (value: unknown): string =>
  sanitizeText(value, "", 160)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 160);

const sanitizeMatchMode = (value: unknown): BotFlowMatchMode => {
  const normalized = String(value ?? "").trim();
  return VALID_MATCHES.has(normalized as BotFlowMatchMode) ? (normalized as BotFlowMatchMode) : "exact";
};

const sanitizeTriggerMediaType = (value: unknown): BotFlowNode["triggerMediaType"] => {
  const normalized = String(value ?? "").trim();
  return VALID_TRIGGER_MEDIA_TYPES.has(normalized) ? (normalized as BotFlowNode["triggerMediaType"]) : "any";
};

const sanitizeOptionalId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const normalizeNodeButtons = (buttons: NonNullable<BotFlowNode["buttons"]>) => {
  const firstActionButton = buttons.find((button) => button.type === "url" || button.type === "call" || button.type === "copy");
  if (firstActionButton) return [firstActionButton];
  return buttons.filter((button) => button.type === "reply").slice(0, 3);
};

const sanitizeVariableName = (value: unknown, fallback = ""): string =>
  sanitizeText(value, fallback, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 80);

const sanitizeConditionOperator = (value: unknown): BotFlowNode["conditionOperator"] => {
  const normalized = String(value ?? "").trim();
  return VALID_CONDITION_OPERATORS.has(normalized) ? (normalized as BotFlowNode["conditionOperator"]) : "contains";
};

const sanitizeHttpHeaders = (value: unknown): NonNullable<BotFlowNode["httpHeaders"]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): NonNullable<BotFlowNode["httpHeaders"]>[number] | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const key = sanitizeText(source.key, "", 120);
      if (!key) return null;
      return {
        id: sanitizeText(source.id, `header_${index + 1}`, 80) || `header_${index + 1}`,
        key,
        value: sanitizeText(source.value, "", 1000),
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["httpHeaders"]>[number] => Boolean(entry))
    .slice(0, 20);
};

const sanitizeHttpParams = (value: unknown): NonNullable<BotFlowNode["httpQueryParams"]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): NonNullable<BotFlowNode["httpQueryParams"]>[number] | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const key = sanitizeText(source.key, "", 120);
      if (!key) return null;
      return {
        id: sanitizeText(source.id, `param_${index + 1}`, 80) || `param_${index + 1}`,
        key,
        value: sanitizeText(source.value, "", 1000),
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["httpQueryParams"]>[number] => Boolean(entry))
    .slice(0, 30);
};

const sanitizeHttpMappings = (value: unknown): NonNullable<BotFlowNode["httpResponseMappings"]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): NonNullable<BotFlowNode["httpResponseMappings"]>[number] | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const variable = sanitizeVariableName(source.variable);
      if (!variable) return null;
      return {
        id: sanitizeText(source.id, `map_${index + 1}`, 80) || `map_${index + 1}`,
        path: sanitizeText(source.path, "", 160),
        variable,
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["httpResponseMappings"]>[number] => Boolean(entry))
    .slice(0, 20);
};

const sanitizeDatabaseProvider = (value: unknown): BotFlowNode["databaseProvider"] => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return VALID_DATABASE_PROVIDERS.has(normalized) ? (normalized as BotFlowNode["databaseProvider"]) : "mysql";
};

const sanitizeDatabaseOperation = (value: unknown): BotFlowNode["databaseOperation"] => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return VALID_DATABASE_OPERATIONS.has(normalized) ? (normalized as BotFlowNode["databaseOperation"]) : "query";
};

const sanitizeDatabasePort = (value: unknown, provider: BotFlowNode["databaseProvider"]): number => {
  const fallback = provider === "postgres" ? 5432 : 3306;
  const parsed = Math.floor(Number(value ?? fallback) || fallback);
  return parsed > 0 && parsed <= 65535 ? parsed : fallback;
};

const sanitizeContentItems = (value: unknown): NonNullable<BotFlowNode["contentItems"]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): NonNullable<BotFlowNode["contentItems"]>[number] | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const typeCandidate = sanitizeText(source.type, "text", 40);
      const type = VALID_CONTENT_ITEM_TYPES.has(typeCandidate) ? typeCandidate : "text";
      const mediaTypeCandidate = sanitizeText(source.mediaType, "", 40);
      return {
        id: sanitizeText(source.id, `item_${index + 1}`, 80) || `item_${index + 1}`,
        type: type as NonNullable<BotFlowNode["contentItems"]>[number]["type"],
        text: sanitizeText(source.text, "", 4000),
        caption: sanitizeText(source.caption, "", 1000),
        mediaUrl: sanitizeText(source.mediaUrl, "", 1000),
        mediaType: VALID_MEDIA_TYPES.has(mediaTypeCandidate)
          ? (mediaTypeCandidate as NonNullable<BotFlowNode["contentItems"]>[number]["mediaType"])
          : type === "video"
            ? "video"
            : type === "audio"
              ? "audio"
              : type === "file"
                ? "document"
                : "image",
        variableName: sanitizeVariableName(source.variableName),
        variableValue: sanitizeText(source.variableValue, "", 4000),
        delaySeconds: Math.max(0, Math.min(30 * 24 * 60 * 60, Math.floor(Number(source.delaySeconds ?? 0) || 0))),
        contactName: sanitizeText(source.contactName, "", 120),
        contactPhone: sanitizeText(source.contactPhone, "", 40),
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["contentItems"]>[number] => Boolean(entry))
    .slice(0, 30);
};

const sanitizeMenuOptions = (value: unknown): NonNullable<BotFlowNode["menuOptions"]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): NonNullable<BotFlowNode["menuOptions"]>[number] | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const label = sanitizeText(source.label, `Opção ${index + 1}`, 80) || `Opção ${index + 1}`;
      return {
        id: sanitizeText(source.id, `option_${index + 1}`, 80) || `option_${index + 1}`,
        label,
        value: sanitizeText(source.value, label, 500) || label,
        description: sanitizeText(source.description, "", 160),
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["menuOptions"]>[number] => Boolean(entry))
    .slice(0, 20);
};

const sanitizeActions = (value: unknown): NonNullable<BotFlowNode["actions"]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): NonNullable<BotFlowNode["actions"]>[number] | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const typeCandidate = sanitizeText(source.type, "custom_event", 80);
      const type = VALID_ACTION_TYPES.has(typeCandidate) ? typeCandidate : "custom_event";
      return {
        id: sanitizeText(source.id, `action_${index + 1}`, 80) || `action_${index + 1}`,
        type: type as NonNullable<BotFlowNode["actions"]>[number]["type"],
        label: sanitizeText(source.label, "", 120),
        key: sanitizeText(source.key, "", 120),
        value: sanitizeText(source.value, "", 4000),
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["actions"]>[number] => Boolean(entry))
    .slice(0, 30);
};

const sanitizeRandomizerOptions = (value: unknown): NonNullable<BotFlowNode["randomizerOptions"]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index): NonNullable<BotFlowNode["randomizerOptions"]>[number] | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      return {
        id: sanitizeText(source.id, `random_${index + 1}`, 80) || `random_${index + 1}`,
        label: sanitizeText(source.label, `Saída ${index + 1}`, 80) || `Saída ${index + 1}`,
        weight: Math.max(0, Math.min(100, Math.floor(Number(source.weight ?? 0) || 0))),
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["randomizerOptions"]>[number] => Boolean(entry))
    .slice(0, 12);
};

const sanitizeCaptureType = (value: unknown): BotFlowNode["captureType"] => {
  const normalized = String(value ?? "").trim();
  return VALID_CAPTURE_TYPES.has(normalized) ? (normalized as BotFlowNode["captureType"]) : "text";
};

const parseJsonRecord = (value: string | null): Record<string, string> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      output[key] = typeof entry === "string" ? entry : JSON.stringify(entry);
    }
    return output;
  } catch {
    return {};
  }
};

const sanitizeConditionRules = (value: unknown, fallback: BotFlowNode): NonNullable<BotFlowNode["conditionRules"]> => {
  const fromArray = Array.isArray(value) ? value : [];
  const rules = fromArray
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const variable = sanitizeVariableName(source.variable, "args") || "args";
      return {
        id: sanitizeText(source.id, `rule_${index + 1}`, 80) || `rule_${index + 1}`,
        variable,
        operator: sanitizeConditionOperator(source.operator) ?? "contains",
        value: sanitizeText(source.value, "", 500),
      };
    })
    .filter((entry): entry is NonNullable<BotFlowNode["conditionRules"]>[number] => Boolean(entry))
    .slice(0, 10);
  if (rules.length > 0) return rules;
  return [
    {
      id: "rule_1",
      variable: sanitizeVariableName(fallback.conditionVariable, "args") || "args",
      operator: sanitizeConditionOperator(fallback.conditionOperator) ?? "contains",
      value: sanitizeText(fallback.conditionValue, "", 500),
    },
  ];
};

const defaultNodes = (command: string): BotFlowNode[] => [
  {
    id: "trigger",
    kind: "trigger",
    title: "Gatilho",
    x: 40,
    y: 90,
    text: command ? `/${command}` : "/comando",
    triggerType: "command",
    triggerMatchMode: "exact",
    triggerValue: command,
    triggerMediaType: "any",
  },
  {
    id: "message-1",
    kind: "text",
    title: "Resposta",
    x: 320,
    y: 90,
    text: "Olá, {{usuario}}. Esse fluxo foi executado com sucesso.",
  },
];

const defaultEdges: BotFlowEdge[] = [{ id: "edge-trigger-message-1", from: "trigger", to: "message-1" }];

export const sanitizeFlowNodes = (value: unknown, command = ""): BotFlowNode[] => {
  if (!Array.isArray(value)) return normalizeFlowNodeStacksAndTitles(defaultNodes(command));
  const nodes = value
    .map((entry, index): BotFlowNode | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const rawKind = String(source.kind ?? "").trim();
      const kind = VALID_NODE_KINDS.has(rawKind) ? (rawKind as BotFlowNode["kind"]) : "text";
      const id = sanitizeText(source.id, "", 80) || `${kind}-${index + 1}`;
      const buttons = Array.isArray(source.buttons)
        ? source.buttons
            .map((button, buttonIndex) => {
              if (!button || typeof button !== "object") return null;
              const buttonSource = button as Record<string, unknown>;
              const typeCandidate = String(buttonSource.type ?? "").trim();
              const type = VALID_BUTTON_TYPES.has(typeCandidate) ? typeCandidate : "reply";
              return {
                id: sanitizeText(buttonSource.id, `btn_${buttonIndex + 1}`, 80) || `btn_${buttonIndex + 1}`,
                type: type as NonNullable<BotFlowNode["buttons"]>[number]["type"],
                label: sanitizeText(buttonSource.label, `Botão ${buttonIndex + 1}`, 40) || `Botão ${buttonIndex + 1}`,
                value: sanitizeText(buttonSource.value, "", 500),
              };
            })
            .filter((button): button is NonNullable<BotFlowNode["buttons"]>[number] => Boolean(button))
        : [];
      const mediaTypeCandidate = String(source.mediaType ?? "").trim();
      const conditionVariable = sanitizeVariableName(source.conditionVariable, "args") || "args";
      const conditionOperator = sanitizeConditionOperator(source.conditionOperator);
      const variableOperationCandidate = String(source.variableOperation ?? "").trim();
      const httpMethodCandidate = String(source.httpMethod ?? "GET").trim().toUpperCase();
      const databaseProvider = sanitizeDatabaseProvider(source.databaseProvider);
      const conditionLogicCandidate = String(source.conditionLogic ?? "AND").trim().toUpperCase();
      const menuModeCandidate = String(source.menuMode ?? "list").trim();
      const randomizerModeCandidate = String(source.randomizerMode ?? "random").trim();
      const smartDelayModeCandidate = String(source.smartDelayMode ?? "relative").trim();
      const smartDelayUnitCandidate = String(source.smartDelayUnit ?? "minutes").trim();
      const fallbackCondition = {
        conditionVariable,
        conditionOperator,
        conditionValue: sanitizeText(source.conditionValue, "", 500),
      } as BotFlowNode;
      const triggerType = kind === "webhook_wait" ? "webhook" : sanitizeTriggerType(source.triggerType);
      return {
        id,
        kind,
        title: sanitizeText(source.title, kind === "trigger" ? "Gatilho" : "Etapa", 80) || "Etapa",
        x: Number.isFinite(Number(source.x)) ? Math.floor(Number(source.x)) : 80 + index * 260,
        y: Number.isFinite(Number(source.y)) ? Math.floor(Number(source.y)) : 90,
        stackId: sanitizeText(source.stackId, "", 80) || undefined,
        stackOrder: Number.isFinite(Number(source.stackOrder))
          ? Math.max(0, Math.floor(Number(source.stackOrder)))
          : undefined,
        stackTitle: sanitizeText(source.stackTitle, "", 80) || undefined,
        text: sanitizeText(source.text, "", 4000),
        headerTitle: sanitizeText(source.headerTitle, "", 120),
        footerText: sanitizeText(source.footerText, "", 180),
        mediaUrl: sanitizeText(source.mediaUrl, "", 1000),
        mediaType: VALID_MEDIA_TYPES.has(mediaTypeCandidate)
          ? (mediaTypeCandidate as BotFlowNode["mediaType"])
          : "image",
        contentItems: sanitizeContentItems(source.contentItems),
        menuMode: VALID_MENU_MODES.has(menuModeCandidate) ? (menuModeCandidate as BotFlowNode["menuMode"]) : "list",
        menuInvalidText: sanitizeText(source.menuInvalidText, "", 1000),
        menuErrorLimit: Math.max(1, Math.min(10, Math.floor(Number(source.menuErrorLimit ?? 3) || 3))),
        menuOptions: sanitizeMenuOptions(source.menuOptions),
        actions: sanitizeActions(source.actions),
        delaySeconds: Math.max(0, Math.min(120, Math.floor(Number(source.delaySeconds ?? 0) || 0))),
        smartDelayMode: VALID_SMART_DELAY_MODES.has(smartDelayModeCandidate)
          ? (smartDelayModeCandidate as BotFlowNode["smartDelayMode"])
          : "relative",
        smartDelayUnit: VALID_SMART_DELAY_UNITS.has(smartDelayUnitCandidate)
          ? (smartDelayUnitCandidate as BotFlowNode["smartDelayUnit"])
          : kind === "smart_delay" ? "minutes" : "seconds",
        smartDelayUntil: sanitizeText(source.smartDelayUntil, "", 80),
        randomizerMode: VALID_RANDOMIZER_MODES.has(randomizerModeCandidate)
          ? (randomizerModeCandidate as BotFlowNode["randomizerMode"])
          : "random",
        randomizerOptions: sanitizeRandomizerOptions(source.randomizerOptions),
        targetFlowId: sanitizeOptionalId(source.targetFlowId),
        targetFlowName: sanitizeText(source.targetFlowName, "", 120),
        assistantName: sanitizeText(source.assistantName, "", 120),
        assistantInitialMessage: sanitizeText(source.assistantInitialMessage, "", 1000),
        assistantInitialMode: String(source.assistantInitialMode ?? "contact") === "assistant" ? "assistant" : "contact",
        assistantLanguage: sanitizeText(source.assistantLanguage, "pt-BR", 20) || "pt-BR",
        assistantTemperature: Math.max(0, Math.min(2, Number(source.assistantTemperature ?? 0.7) || 0.7)),
        assistantInstructions: sanitizeText(source.assistantInstructions, "", 12000),
        assistantIndividualInstructions: sanitizeText(source.assistantIndividualInstructions, "", 4000),
        assistantErrorMessage: sanitizeText(source.assistantErrorMessage, "", 1000),
        assistantModel: sanitizeText(source.assistantModel, "gpt-4o-mini", 80) || "gpt-4o-mini",
        assistantContext: sanitizeText(source.assistantContext, "", 12000),
        sendDelaySeconds: Math.max(0, Math.min(30, Math.floor(Number(source.sendDelaySeconds ?? 0) || 0))),
        showTyping: Boolean(source.showTyping),
        showRecording: Boolean(source.showRecording),
        buttons: normalizeNodeButtons(buttons),
        conditionVariable,
        conditionOperator,
        conditionValue: fallbackCondition.conditionValue,
        conditionLogic: conditionLogicCandidate === "OR" ? "OR" : "AND",
        conditionRules: sanitizeConditionRules(source.conditionRules, fallbackCondition),
        variableName: sanitizeVariableName(source.variableName),
        variableValue: sanitizeText(source.variableValue, "", 4000),
        variableOperation: VALID_VARIABLE_OPERATIONS.has(variableOperationCandidate)
          ? (variableOperationCandidate as BotFlowNode["variableOperation"])
          : "set",
        httpMethod: VALID_HTTP_METHODS.has(httpMethodCandidate) ? (httpMethodCandidate as BotFlowNode["httpMethod"]) : "GET",
        httpUrl: sanitizeText(source.httpUrl, "", 1000),
        httpQueryParams: sanitizeHttpParams(source.httpQueryParams),
        httpHeaders: sanitizeHttpHeaders(source.httpHeaders),
        httpBody: sanitizeText(source.httpBody, "", 12000),
        httpTimeoutSeconds: Math.max(1, Math.min(30, Math.floor(Number(source.httpTimeoutSeconds ?? 10) || 10))),
        httpSaveStatusVariable: sanitizeVariableName(source.httpSaveStatusVariable),
        httpSaveBodyVariable: sanitizeVariableName(source.httpSaveBodyVariable),
        httpResponseMappings: sanitizeHttpMappings(source.httpResponseMappings),
        databaseProvider,
        databaseOperation: sanitizeDatabaseOperation(source.databaseOperation),
        databaseHost: sanitizeText(source.databaseHost, "", 255),
        databasePort: sanitizeDatabasePort(source.databasePort, databaseProvider),
        databaseName: sanitizeText(source.databaseName, "", 120),
        databaseUser: sanitizeText(source.databaseUser, "", 120),
        databasePassword: sanitizeText(source.databasePassword, "", 1000),
        databaseSsl: Boolean(source.databaseSsl),
        databaseTable: sanitizeText(source.databaseTable, "", 120),
        databaseQuery: sanitizeText(source.databaseQuery, "", 12000),
        databaseValuesJson: sanitizeText(source.databaseValuesJson, "", 12000),
        databaseSaveResultVariable: sanitizeVariableName(source.databaseSaveResultVariable),
        databaseResponseMappings: sanitizeHttpMappings(source.databaseResponseMappings),
        webhookResponseMappings: sanitizeHttpMappings(source.webhookResponseMappings),
        captureType: sanitizeCaptureType(source.captureType),
        captureVariable: sanitizeVariableName(source.captureVariable, kind === "capture" ? "resposta" : ""),
        captureFallbackText: sanitizeText(source.captureFallbackText, "", 1000),
        jumpTargetNodeId: sanitizeText(source.jumpTargetNodeId, "", 80),
        triggerType,
        triggerMatchMode: kind === "webhook_wait" ? "exact" : sanitizeMatchMode(source.triggerMatchMode),
        triggerValue: sanitizeText(source.triggerValue, "", 500),
        triggerMediaType: sanitizeTriggerMediaType(source.triggerMediaType),
      };
    })
    .filter((entry): entry is BotFlowNode => Boolean(entry))
    .slice(0, 24);

  if (!nodes.some((node) => node.kind === "trigger")) {
    nodes.unshift(defaultNodes(command)[0]);
  }
  return normalizeFlowNodeStacksAndTitles(nodes.length > 0 ? nodes : defaultNodes(command));
};

export const sanitizeFlowEdges = (value: unknown, nodes: BotFlowNode[]): BotFlowEdge[] => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (!Array.isArray(value)) return defaultEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  return value
    .map((entry, index): BotFlowEdge | null => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Record<string, unknown>;
      const from = sanitizeText(source.from, "", 80);
      const to = sanitizeText(source.to, "", 80);
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return null;
      const rawBranch = String(source.branch ?? "").trim();
      const fromNode = nodeMap.get(from);
      const isButtonBranch =
        rawBranch.startsWith("button:") &&
        fromNode?.kind === "buttons" &&
        (fromNode.buttons ?? []).some((button) => rawBranch === `button:${button.id}`);
      const isMenuBranch =
        rawBranch.startsWith("menu:") &&
        fromNode?.kind === "menu" &&
        (fromNode.menuOptions ?? []).some((option) => rawBranch === `menu:${option.id}`);
      const isRandomBranch =
        rawBranch.startsWith("random:") &&
        fromNode?.kind === "randomizer" &&
        (fromNode.randomizerOptions ?? []).some((option) => rawBranch === `random:${option.id}`);
      return {
        id: sanitizeText(source.id, `edge-${index + 1}`, 120) || `edge-${index + 1}`,
        from,
        to,
        branch: isButtonBranch || isMenuBranch || isRandomBranch
          ? (rawBranch as BotFlowEdge["branch"])
          : VALID_EDGE_BRANCHES.has(rawBranch)
          ? (rawBranch as BotFlowEdge["branch"])
          : "default",
        label: sanitizeText(source.label, "", 60),
      };
    })
    .filter((entry): entry is BotFlowEdge => Boolean(entry))
    .slice(0, 160);
};

const mapRow = (row: BotFlowRow): BotFlow => {
  const sanitizedNodes = sanitizeFlowNodes(parseJsonArray<BotFlowNode>(row.nodes_json, []), row.command);
  const sanitizedEdges = sanitizeFlowEdges(parseJsonArray<BotFlowEdge>(row.edges_json, []), sanitizedNodes);
  const nodes = sanitizedNodes;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    scope: sanitizeScope(row.scope),
    instanceId: row.instance_id === null ? null : Number(row.instance_id),
    groupId: row.group_id === null ? null : Number(row.group_id),
    name: row.name,
    command: row.command,
    triggerType: sanitizeTriggerType(row.trigger_type),
    matchMode: sanitizeMatchMode(row.match_mode),
    enabled: Boolean(row.enabled),
    description: row.description,
    nodes,
    edges: sanitizeFlowEdges(sanitizedEdges, nodes),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    revision: Math.max(0, Number(row.edit_revision ?? 0) || 0),
  };
};

export const ensureBotFlowsTable = async () => {
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      scope ENUM('group', 'private', 'both') NOT NULL DEFAULT 'group',
      instance_id INT NULL,
      group_id INT NULL,
      name VARCHAR(120) NOT NULL,
      command VARCHAR(80) NOT NULL,
      trigger_type ENUM('command', 'keyword') NOT NULL DEFAULT 'command',
      match_mode ENUM('exact', 'contains', 'starts_with') NOT NULL DEFAULT 'exact',
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      description VARCHAR(255) NULL,
      nodes_json JSON NULL,
      edges_json JSON NULL,
      edit_revision BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bot_flows_user_scope (user_id, scope, enabled),
      INDEX idx_bot_flows_group (group_id),
      INDEX idx_bot_flows_instance (instance_id),
      INDEX idx_bot_flows_command (command),
      CONSTRAINT fk_bot_flows_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
  await db.query(`
    ALTER TABLE ${TABLE_NAME}
    MODIFY scope ENUM('group', 'private', 'both') NOT NULL DEFAULT 'group'
  `);
  await db.query(`
    ALTER TABLE ${TABLE_NAME}
    MODIFY trigger_type ENUM('command', 'keyword', 'message', 'media', 'button', 'webhook') NOT NULL DEFAULT 'command'
  `);
  const [revisionColumns] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${TABLE_NAME} LIKE 'edit_revision'`);
  if (revisionColumns.length === 0) {
    await db.query(`ALTER TABLE ${TABLE_NAME} ADD COLUMN edit_revision BIGINT NOT NULL DEFAULT 0`);
  }
};

export const ensureBotFlowRuntimeTables = async () => {
  await ensureBotFlowsTable();
  const db = getDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${SESSION_TABLE_NAME} (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      flow_id INT NOT NULL,
      user_id INT NOT NULL,
      instance_id INT NULL,
      group_id INT NULL,
      chat_id VARCHAR(191) NOT NULL,
      participant_id VARCHAR(191) NULL,
      status ENUM('running', 'waiting_input', 'waiting_webhook', 'completed', 'failed', 'expired') NOT NULL DEFAULT 'running',
      current_node_id VARCHAR(120) NULL,
      variables_json LONGTEXT NULL,
      return_stack_json LONGTEXT NULL,
      last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bot_flow_sessions_lookup (user_id, chat_id, participant_id, status),
      INDEX idx_bot_flow_sessions_flow (flow_id, status),
      CONSTRAINT fk_bot_flow_sessions_flow FOREIGN KEY (flow_id) REFERENCES ${TABLE_NAME}(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${RESULT_TABLE_NAME} (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      flow_id INT NOT NULL,
      session_id BIGINT NULL,
      user_id INT NOT NULL,
      instance_id INT NULL,
      group_id INT NULL,
      chat_id VARCHAR(191) NOT NULL,
      participant_id VARCHAR(191) NULL,
      status ENUM('completed', 'failed') NOT NULL DEFAULT 'completed',
      variables_json LONGTEXT NULL,
      transcript_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bot_flow_results_flow (flow_id, created_at),
      INDEX idx_bot_flow_results_user (user_id, created_at),
      CONSTRAINT fk_bot_flow_results_flow FOREIGN KEY (flow_id) REFERENCES ${TABLE_NAME}(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${LOG_TABLE_NAME} (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      flow_id INT NOT NULL,
      session_id BIGINT NULL,
      node_id VARCHAR(120) NULL,
      level ENUM('info', 'warn', 'error') NOT NULL DEFAULT 'info',
      message VARCHAR(500) NOT NULL,
      payload_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bot_flow_logs_flow (flow_id, created_at),
      INDEX idx_bot_flow_logs_session (session_id, created_at),
      CONSTRAINT fk_bot_flow_logs_flow FOREIGN KEY (flow_id) REFERENCES ${TABLE_NAME}(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${WEBHOOK_EVENT_TABLE_NAME} (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      flow_id INT NOT NULL,
      node_id VARCHAR(120) NOT NULL,
      method VARCHAR(12) NOT NULL,
      path VARCHAR(500) NULL,
      query_json LONGTEXT NULL,
      headers_json LONGTEXT NULL,
      body_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bot_flow_webhook_user (user_id, flow_id, node_id, created_at),
      INDEX idx_bot_flow_webhook_flow (flow_id, node_id, created_at),
      CONSTRAINT fk_bot_flow_webhook_flow FOREIGN KEY (flow_id) REFERENCES ${TABLE_NAME}(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);
};

export const createBotFlowSession = async (params: {
  flow: BotFlow;
  chatId: string;
  participantId?: string | null;
  variables: Record<string, string>;
}): Promise<number | null> => {
  try {
    await ensureBotFlowRuntimeTables();
    const db = getDb();
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO ${SESSION_TABLE_NAME}
        (flow_id, user_id, instance_id, group_id, chat_id, participant_id, status, current_node_id, variables_json, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', 'trigger', ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [
        params.flow.id,
        params.flow.userId,
        params.flow.instanceId,
        params.flow.groupId,
        params.chatId.slice(0, 191),
        params.participantId?.slice(0, 191) ?? null,
        JSON.stringify(params.variables),
      ],
    );
    return Number(result.insertId) || null;
  } catch (error) {
    console.error("[bot-flows] failed to create runtime session", error);
    return null;
  }
};

export const findWaitingBotFlowSession = async (params: {
  userId: number;
  chatId: string;
  participantId?: string | null;
}): Promise<BotFlowWaitingSession | null> => {
  try {
    await ensureBotFlowRuntimeTables();
    const db = getDb();
    await db.query(
      `UPDATE ${SESSION_TABLE_NAME}
       SET status = 'expired'
       WHERE user_id = ? AND status = 'waiting_input' AND expires_at IS NOT NULL AND expires_at < NOW()`,
      [params.userId],
    );
    const participant = params.participantId?.slice(0, 191) ?? null;
    const [rows] = await db.query<BotFlowSessionRow[]>(
      `SELECT
          s.id AS session_id,
          s.flow_id AS session_flow_id,
          s.user_id AS session_user_id,
          s.instance_id AS session_instance_id,
          s.group_id AS session_group_id,
          s.chat_id AS session_chat_id,
          s.participant_id AS session_participant_id,
          s.status AS session_status,
          s.current_node_id AS session_current_node_id,
          s.variables_json AS session_variables_json,
          s.created_at AS session_created_at,
          s.updated_at AS session_updated_at,
          f.*
       FROM ${SESSION_TABLE_NAME} s
       INNER JOIN ${TABLE_NAME} f ON f.id = s.flow_id
       WHERE s.user_id = ?
         AND s.chat_id = ?
         AND s.status = 'waiting_input'
         AND f.enabled = 1
         AND (
           (s.participant_id IS NULL AND ? IS NULL)
           OR s.participant_id = ?
         )
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT 1`,
      [params.userId, params.chatId.slice(0, 191), participant, participant],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.session_id),
      flow: mapRow(row),
      chatId: row.session_chat_id,
      participantId: row.session_participant_id,
      currentNodeId: row.session_current_node_id,
      variables: parseJsonRecord(row.session_variables_json),
    };
  } catch (error) {
    console.error("[bot-flows] failed to find waiting session", error);
    return null;
  }
};

export const listWaitingBotFlowWebhookSessions = async (params: {
  flowId: number;
  nodeId: string;
  limit?: number;
}): Promise<BotFlowWaitingSession[]> => {
  try {
    await ensureBotFlowRuntimeTables();
    const db = getDb();
    await db.query(
      `UPDATE ${SESSION_TABLE_NAME}
       SET status = 'expired'
       WHERE flow_id = ? AND status = 'waiting_webhook' AND expires_at IS NOT NULL AND expires_at < NOW()`,
      [params.flowId],
    );
    const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 20)));
    const [rows] = await db.query<BotFlowSessionRow[]>(
      `SELECT
          s.id AS session_id,
          s.flow_id AS session_flow_id,
          s.user_id AS session_user_id,
          s.instance_id AS session_instance_id,
          s.group_id AS session_group_id,
          s.chat_id AS session_chat_id,
          s.participant_id AS session_participant_id,
          s.status AS session_status,
          s.current_node_id AS session_current_node_id,
          s.variables_json AS session_variables_json,
          s.created_at AS session_created_at,
          s.updated_at AS session_updated_at,
          f.*
       FROM ${SESSION_TABLE_NAME} s
       INNER JOIN ${TABLE_NAME} f ON f.id = s.flow_id
       WHERE s.flow_id = ?
         AND s.current_node_id = ?
         AND s.status = 'waiting_webhook'
         AND f.enabled = 1
       ORDER BY s.updated_at ASC, s.id ASC
       LIMIT ?`,
      [params.flowId, params.nodeId.slice(0, 120), limit],
    );
    return rows.map((row) => ({
      id: Number(row.session_id),
      flow: mapRow(row),
      chatId: row.session_chat_id,
      participantId: row.session_participant_id,
      currentNodeId: row.session_current_node_id,
      variables: parseJsonRecord(row.session_variables_json),
    }));
  } catch (error) {
    console.error("[bot-flows] failed to list waiting webhook sessions", error);
    return [];
  }
};

export const updateBotFlowSessionState = async (params: {
  sessionId: number | null;
  status?: "running" | "waiting_input" | "waiting_webhook" | "completed" | "failed" | "expired";
  currentNodeId?: string | null;
  variables?: Record<string, string>;
}) => {
  if (!params.sessionId) return;
  try {
    await ensureBotFlowRuntimeTables();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (params.status) {
      fields.push("status = ?");
      values.push(params.status);
    }
    if (params.currentNodeId !== undefined) {
      fields.push("current_node_id = ?");
      values.push(params.currentNodeId);
    }
    if (params.variables) {
      fields.push("variables_json = ?");
      values.push(JSON.stringify(params.variables));
    }
    if (fields.length === 0) return;
    fields.push("last_interaction_at = NOW()");
    values.push(params.sessionId);
    const db = getDb();
    await db.query(`UPDATE ${SESSION_TABLE_NAME} SET ${fields.join(", ")} WHERE id = ?`, values);
  } catch (error) {
    console.error("[bot-flows] failed to update runtime session", error);
  }
};

export const createBotFlowResult = async (params: {
  flow: BotFlow;
  sessionId: number | null;
  chatId: string;
  participantId?: string | null;
  status: "completed" | "failed";
  variables: Record<string, string>;
  transcript?: unknown[];
}) => {
  try {
    await ensureBotFlowRuntimeTables();
    const db = getDb();
    await db.query(
      `INSERT INTO ${RESULT_TABLE_NAME}
        (flow_id, session_id, user_id, instance_id, group_id, chat_id, participant_id, status, variables_json, transcript_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.flow.id,
        params.sessionId,
        params.flow.userId,
        params.flow.instanceId,
        params.flow.groupId,
        params.chatId.slice(0, 191),
        params.participantId?.slice(0, 191) ?? null,
        params.status,
        JSON.stringify(params.variables),
        JSON.stringify(params.transcript ?? []),
      ],
    );
  } catch (error) {
    console.error("[bot-flows] failed to create runtime result", error);
  }
};

export const logBotFlowEvent = async (params: {
  flowId: number;
  sessionId?: number | null;
  nodeId?: string | null;
  level?: "info" | "warn" | "error";
  message: string;
  payload?: unknown;
}) => {
  try {
    await ensureBotFlowRuntimeTables();
    const db = getDb();
    await db.query(
      `INSERT INTO ${LOG_TABLE_NAME} (flow_id, session_id, node_id, level, message, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        params.flowId,
        params.sessionId ?? null,
        params.nodeId ?? null,
        params.level ?? "info",
        params.message.slice(0, 500),
        params.payload === undefined ? null : JSON.stringify(params.payload),
      ],
    );
  } catch (error) {
    console.error("[bot-flows] failed to write runtime log", error);
  }
};

const mapWebhookEventRow = (row: BotFlowWebhookEventRow) => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  flowId: Number(row.flow_id),
  nodeId: row.node_id,
  method: row.method,
  path: row.path,
  queryJson: row.query_json,
  headersJson: row.headers_json,
  bodyJson: row.body_json,
  createdAt: toIso(row.created_at),
});

export const recordBotFlowWebhookEvent = async (params: {
  flow: BotFlow;
  nodeId: string;
  method: string;
  path?: string | null;
  query?: unknown;
  headers?: unknown;
  body?: unknown;
}) => {
  await ensureBotFlowRuntimeTables();
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO ${WEBHOOK_EVENT_TABLE_NAME}
      (user_id, flow_id, node_id, method, path, query_json, headers_json, body_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.flow.userId,
      params.flow.id,
      params.nodeId.slice(0, 120),
      params.method.slice(0, 12).toUpperCase(),
      params.path?.slice(0, 500) ?? null,
      params.query === undefined ? null : JSON.stringify(params.query),
      params.headers === undefined ? null : JSON.stringify(params.headers),
      params.body === undefined ? null : JSON.stringify(params.body),
    ],
  );
  return Number(result.insertId) || 0;
};

export const listBotFlowWebhookEventsForUser = async (params: {
  userId: number;
  flowId: number;
  nodeId?: string | null;
  limit?: number;
}) => {
  await ensureBotFlowRuntimeTables();
  const db = getDb();
  const values: unknown[] = [params.userId, params.flowId];
  let nodeFilter = "";
  if (params.nodeId) {
    nodeFilter = "AND node_id = ?";
    values.push(params.nodeId.slice(0, 120));
  }
  values.push(Math.max(1, Math.min(80, Math.floor(params.limit ?? 20))));
  const [rows] = await db.query<BotFlowWebhookEventRow[]>(
    `SELECT * FROM ${WEBHOOK_EVENT_TABLE_NAME}
     WHERE user_id = ? AND flow_id = ? ${nodeFilter}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    values,
  );
  return rows.map(mapWebhookEventRow);
};

export const normalizeFlowCommand = (value: unknown): string =>
  canonicalizeCommandText(sanitizeText(value, "", 80));

const normalizeFlowInput = (input: BotFlowInput, existing?: BotFlow | null) => {
  const command = normalizeFlowCommand(input.command ?? existing?.command ?? "");
  if (!command) {
    throw new Error("Informe um comando para o fluxo.");
  }
  const scope = input.scope !== undefined ? sanitizeScope(input.scope) : existing?.scope ?? "group";
  const name = sanitizeText(input.name ?? existing?.name ?? "", "", 120) || `Fluxo ${command}`;
  const triggerType =
    input.triggerType !== undefined ? sanitizeTriggerType(input.triggerType) : existing?.triggerType ?? "command";
  const matchMode =
    input.matchMode !== undefined ? sanitizeMatchMode(input.matchMode) : existing?.matchMode ?? "exact";
  const instanceId = input.instanceId !== undefined ? sanitizeOptionalId(input.instanceId) : existing?.instanceId ?? null;
  const groupId = input.groupId !== undefined ? sanitizeOptionalId(input.groupId) : existing?.groupId ?? null;
  const sanitizedNodes = sanitizeFlowNodes(input.nodes ?? existing?.nodes ?? defaultNodes(command), command);
  const sanitizedEdges = sanitizeFlowEdges(input.edges ?? existing?.edges ?? defaultEdges, sanitizedNodes);
  const nodes = sanitizedNodes;
  const edges = sanitizeFlowEdges(sanitizedEdges, nodes);

  return {
    scope,
    instanceId,
    groupId,
    name,
    command,
    triggerType,
    matchMode,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing?.enabled ?? true,
    description:
      input.description === null
        ? null
        : sanitizeText(input.description ?? existing?.description ?? "", "", 255) || null,
    nodes,
    edges,
  };
};

export const listBotFlowsForUser = async (userId: number): Promise<BotFlow[]> => {
  await ensureBotFlowsTable();
  const db = getDb();
  const [rows] = await db.query<BotFlowRow[]>(
    `SELECT * FROM ${TABLE_NAME} WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
    [userId],
  );
  return rows.map(mapRow);
};

export const getBotFlowForUser = async (userId: number, flowId: number): Promise<BotFlow | null> => {
  await ensureBotFlowsTable();
  const db = getDb();
  const [rows] = await db.query<BotFlowRow[]>(
    `SELECT * FROM ${TABLE_NAME} WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, flowId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
};

export const getBotFlowWebhookForPublicToken = async (params: {
  flowId: number;
  nodeId: string;
  token: string;
}): Promise<{ flow: BotFlow; node: BotFlowNode } | null> => {
  const token = normalizeWebhookToken(params.token);
  const nodeId = sanitizeText(params.nodeId, "", 120);
  if (!params.flowId || !nodeId || !token) return null;
  await ensureBotFlowsTable();
  const db = getDb();
  const [rows] = await db.query<BotFlowRow[]>(`SELECT * FROM ${TABLE_NAME} WHERE id = ? AND enabled = 1 LIMIT 1`, [
    params.flowId,
  ]);
  const flow = rows[0] ? mapRow(rows[0]) : null;
  if (!flow) return null;
  const node = flow.nodes.find(
    (entry) =>
      entry.id === nodeId &&
      ((entry.kind === "trigger" && entry.triggerType === "webhook") || entry.kind === "webhook_wait"),
  );
  if (!node) return null;
  if (normalizeWebhookToken(node.triggerValue) !== token) return null;
  return { flow, node };
};

export const createBotFlowForUser = async (userId: number, input: BotFlowInput): Promise<BotFlow> => {
  await ensureBotFlowsTable();
  const data = normalizeFlowInput(input);
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO ${TABLE_NAME}
      (user_id, scope, instance_id, group_id, name, command, trigger_type, match_mode, enabled, description, nodes_json, edges_json, edit_revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      userId,
      data.scope,
      data.instanceId,
      data.groupId,
      data.name,
      data.command,
      data.triggerType,
      data.matchMode,
      data.enabled ? 1 : 0,
      data.description,
      JSON.stringify(data.nodes),
      JSON.stringify(data.edges),
    ],
  );
  const created = await getBotFlowForUser(userId, Number(result.insertId));
  if (!created) throw new Error("Fluxo criado, mas não foi possível recarregar o registro.");
  return created;
};

export const updateBotFlowForUser = async (
  userId: number,
  flowId: number,
  input: BotFlowInput,
): Promise<BotFlow> => {
  const existing = await getBotFlowForUser(userId, flowId);
  if (!existing) {
    throw new Error("Fluxo não encontrado.");
  }
  const incomingRevision = Number(input.revision);
  if (!Number.isFinite(incomingRevision) || Math.floor(incomingRevision) !== existing.revision) {
    throw new BotFlowRevisionConflictError(existing);
  }
  const data = normalizeFlowInput(input, existing);
  const db = getDb();
  await db.query(
    `UPDATE ${TABLE_NAME}
     SET scope = ?, instance_id = ?, group_id = ?, name = ?, command = ?, trigger_type = ?, match_mode = ?,
         enabled = ?, description = ?, nodes_json = ?, edges_json = ?, edit_revision = edit_revision + 1
     WHERE user_id = ? AND id = ?`,
    [
      data.scope,
      data.instanceId,
      data.groupId,
      data.name,
      data.command,
      data.triggerType,
      data.matchMode,
      data.enabled ? 1 : 0,
      data.description,
      JSON.stringify(data.nodes),
      JSON.stringify(data.edges),
      userId,
      flowId,
    ],
  );
  const updated = await getBotFlowForUser(userId, flowId);
  if (!updated) throw new Error("Fluxo atualizado, mas não foi possível recarregar o registro.");
  return updated;
};

export const deleteBotFlowForUser = async (userId: number, flowId: number): Promise<void> => {
  await ensureBotFlowsTable();
  const db = getDb();
  await db.query(`DELETE FROM ${TABLE_NAME} WHERE user_id = ? AND id = ?`, [userId, flowId]);
};

export const findMatchingBotFlow = async (params: {
  userId: number;
  scope: BotFlowScope;
  command: string;
  instanceId?: number | null;
  groupId?: number | null;
}): Promise<BotFlow | null> => {
  const command = normalizeFlowCommand(params.command);
  if (!command) return null;
  await ensureBotFlowsTable();
  const db = getDb();
  const [rows] = await db.query<BotFlowRow[]>(
    `SELECT * FROM ${TABLE_NAME}
     WHERE user_id = ?
       AND scope IN (?, 'both')
       AND enabled = 1
       AND command = ?
       AND (instance_id IS NULL OR instance_id = ?)
       AND (group_id IS NULL OR group_id = ?)
     ORDER BY
       CASE WHEN group_id IS NULL THEN 1 ELSE 0 END,
       CASE WHEN instance_id IS NULL THEN 1 ELSE 0 END,
       updated_at DESC,
       id DESC
     LIMIT 1`,
    [params.userId, params.scope, command, params.instanceId ?? 0, params.groupId ?? 0],
  );
  if (rows[0]) return mapRow(rows[0]);

  const [fallbackRows] = await db.query<BotFlowRow[]>(
    `SELECT * FROM ${TABLE_NAME}
     WHERE user_id = ?
       AND scope IN (?, 'both')
       AND enabled = 1
       AND (instance_id IS NULL OR instance_id = ?)
       AND (group_id IS NULL OR group_id = ?)
     ORDER BY
       CASE WHEN group_id IS NULL THEN 1 ELSE 0 END,
       CASE WHEN instance_id IS NULL THEN 1 ELSE 0 END,
       updated_at DESC,
       id DESC
     LIMIT 120`,
    [params.userId, params.scope, params.instanceId ?? 0, params.groupId ?? 0],
  );
  return fallbackRows
    .map(mapRow)
    .find((flow) =>
      flow.nodes.some((node) => {
        if (node.kind !== "trigger" || node.triggerType !== "command") return false;
        const value = normalizeFlowCommand(node.triggerValue || node.text || flow.command);
        return value === command;
      }),
    ) ?? null;
};

export const listCandidateBotFlowsForEvent = async (params: {
  userId: number;
  scope: BotFlowScope;
  instanceId?: number | null;
  groupId?: number | null;
  triggerTypes?: BotFlowTriggerType[];
}): Promise<BotFlow[]> => {
  await ensureBotFlowsTable();
  const triggerTypes = (params.triggerTypes ?? ["keyword", "message", "media", "button"])
    .filter((entry, index, array) => VALID_TRIGGERS.has(entry) && array.indexOf(entry) === index);
  if (triggerTypes.length === 0) return [];
  const db = getDb();
  const [rows] = await db.query<BotFlowRow[]>(
    `SELECT * FROM ${TABLE_NAME}
     WHERE user_id = ?
       AND scope IN (?, 'both')
       AND enabled = 1
       AND (instance_id IS NULL OR instance_id = ?)
       AND (group_id IS NULL OR group_id = ?)
     ORDER BY
       CASE WHEN group_id IS NULL THEN 1 ELSE 0 END,
       CASE WHEN instance_id IS NULL THEN 1 ELSE 0 END,
       updated_at DESC,
       id DESC
     LIMIT 120`,
    [params.userId, params.scope, params.instanceId ?? 0, params.groupId ?? 0],
  );
  const allowed = new Set(triggerTypes);
  return rows
    .map(mapRow)
    .filter((flow) => {
      if (allowed.has(flow.triggerType) && flow.triggerType !== "webhook") return true;
      return flow.nodes.some((node) => node.kind === "trigger" && node.triggerType && allowed.has(node.triggerType));
    })
    .slice(0, 80);
};
