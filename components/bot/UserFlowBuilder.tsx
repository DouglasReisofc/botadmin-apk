"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  Controls,
  EdgeLabelRenderer,
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
  useUpdateNodeInternals,
} from "@xyflow/react";
import {
  IconArrowBackUp,
  IconArrowLeft,
  IconBolt,
  IconClock,
  IconCopy,
  IconDatabase,
  IconDeviceFloppy,
  IconExternalLink,
  IconFileImport,
  IconGitBranch,
  IconLink,
  IconMenu2,
  IconMessage,
  IconPencil,
  IconPhoto,
  IconPhone,
  IconPlayerPlay,
  IconPlus,
  IconSettings,
  IconShare2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import type { BotFlow, BotFlowButton, BotFlowEdge, BotFlowNode, BotFlowScope } from "types/bot-flows";
import type { BotGroup } from "types/bot-groups";
import type { BotInstance } from "types/bot-instances";

import styles from "./UserFlowBuilder.module.css";

type Props = {
  instances: BotInstance[];
  groups: BotGroup[];
  preferredInstanceId?: number | null;
  initialImportText?: string;
  onExit?: () => void;
};

type TouchConnectionDraft = {
  source: string;
  branch: BotFlowEdge["branch"];
  label?: string;
};

type ConnectionDragDraft = TouchConnectionDraft & {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type BotFlowPaletteKind = BotFlowNode["kind"] | "webhook_trigger";

type RenderedFlowEdge = {
  id: string;
  label: string;
  path: string;
  labelPath: string;
  pathId: string;
  labelPathId: string;
  labelX: number;
  labelY: number;
  deleteX: number;
  deleteY: number;
  className: string;
  labelClassName: string;
};

type FlowNodeData = {
  flow: BotFlow;
  flowNode: BotFlowNode;
  selected: boolean;
  touchConnectEnabled: boolean;
  touchConnection: TouchConnectionDraft | null;
  onSelect: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onAddButton: (nodeId: string) => void;
  onEditButton: (nodeId: string, buttonId: string) => void;
  onEditField: (nodeId: string, field: FlowNodeEditableField) => void;
  onRemoveButton: (nodeId: string, buttonId: string) => void;
  onStartTouchConnection: (connection: TouchConnectionDraft) => void;
  onStartConnectionDrag: (connection: TouchConnectionDraft, point: { x: number; y: number }) => void;
  onFinishTouchConnection: (targetId: string) => void;
  onUploadMedia: (nodeId: string, file: File) => void;
  onClearMedia: (nodeId: string) => void;
};

type FlowNodeEditableField = "headerTitle" | "text" | "media";

type FlowEdgeData = {
  label?: string;
  onRemove: (edgeId: string) => void;
};

type FlowSimulatorMessage = {
  id: string;
  from: "user" | "bot" | "system";
  text?: string;
  node?: BotFlowNode;
  interactive?: boolean;
  hidden?: boolean;
};

type BotFlowWebhookExample = {
  id: number;
  flowId: number;
  nodeId: string;
  method: string;
  path?: string | null;
  queryJson?: string | null;
  headersJson?: string | null;
  bodyJson?: string | null;
  createdAt?: string | null;
};

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const newWebhookToken = () => newId("wh").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

const buildWebhookUrl = (flow: BotFlow, node: BotFlowNode) => {
  const token = String(node.triggerValue ?? "").trim();
  if (flow.id <= 0 || !token) return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/api/bot-flows/webhook/${flow.id}/${encodeURIComponent(node.id)}/${encodeURIComponent(token)}`;
};

const normalizeCommand = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const extractCommandFromTrigger = (value: string | null | undefined) => normalizeCommand(String(value ?? "").replace(/^[!/#$%&.~]+/, ""));

const makeDraftFlow = (instanceId: number | null): BotFlow => {
  const command = "novofluxo";
  const nodes: BotFlowNode[] = [
    {
      id: "trigger",
      kind: "trigger",
      title: "Gatilho",
      x: 120,
      y: 160,
      text: `/${command}`,
      triggerType: "command",
      triggerMatchMode: "exact",
      triggerValue: command,
      triggerMediaType: "any",
    },
    {
      id: "message-1",
      kind: "text",
      title: "Resposta",
      x: 460,
      y: 160,
      text: "Olá, {{usuario}}. Esse é um fluxo nativo do BotAdmin.",
    },
  ];
  return {
    id: 0,
    userId: 0,
    scope: "group",
    instanceId,
    groupId: null,
    name: "Novo fluxo",
    command,
    triggerType: "command",
    matchMode: "exact",
    enabled: true,
    description: "",
    nodes,
    edges: [{ id: "edge-trigger-message-1", from: "trigger", to: "message-1", branch: "default" }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 0,
  };
};

const nodeKindLabel = (kind: BotFlowPaletteKind) => {
  if (kind === "trigger") return "Gatilho";
  if (kind === "content") return "Conteúdo";
  if (kind === "menu") return "Lista";
  if (kind === "action") return "Ação";
  if (kind === "webhook_trigger" || kind === "webhook_wait") return "Webhook";
  if (kind === "media") return "Mídia";
  if (kind === "buttons") return "Botões";
  if (kind === "delay") return "Delay";
  if (kind === "condition") return "Condição";
  if (kind === "flow_link") return "Conexão";
  if (kind === "randomizer") return "Randomizador";
  if (kind === "smart_delay") return "Delay";
  if (kind === "integration") return "Banco de dados";
  if (kind === "assistant_gpt") return "Assistente GPT";
  if (kind === "set_variable") return "Variável";
  if (kind === "http_request") return "HTTP";
  if (kind === "capture") return "Captura";
  if (kind === "jump") return "Jump";
  return "Texto";
};

const nodeDisplayKindLabel = (node: BotFlowNode) =>
  (node.kind === "trigger" && node.triggerType === "webhook") || node.kind === "webhook_wait" ? "Webhook" : nodeKindLabel(node.kind);

const nodeIcon = (kind: BotFlowPaletteKind, size = 15) => {
  if (kind === "trigger") return <IconBolt size={size} />;
  if (kind === "content") return <IconMessage size={size} />;
  if (kind === "menu") return <IconMenu2 size={size} />;
  if (kind === "action") return <IconBolt size={size} />;
  if (kind === "webhook_trigger" || kind === "webhook_wait") return <IconLink size={size} />;
  if (kind === "media") return <IconPhoto size={size} />;
  if (kind === "buttons") return <IconLink size={size} />;
  if (kind === "delay") return <IconClock size={size} />;
  if (kind === "condition") return <IconGitBranch size={size} />;
  if (kind === "flow_link") return <IconArrowBackUp size={size} />;
  if (kind === "randomizer") return <IconGitBranch size={size} />;
  if (kind === "smart_delay") return <IconClock size={size} />;
  if (kind === "integration") return <IconDatabase size={size} />;
  if (kind === "assistant_gpt") return <IconSettings size={size} />;
  if (kind === "set_variable") return <IconBolt size={size} />;
  if (kind === "http_request") return <IconExternalLink size={size} />;
  if (kind === "capture") return <IconMessage size={size} />;
  if (kind === "jump") return <IconArrowBackUp size={size} />;
  return <IconMessage size={size} />;
};

const FLOW_PALETTE_KINDS: BotFlowPaletteKind[] = [
  "trigger",
  "webhook_wait",
  "menu",
  "action",
  "text",
  "media",
  "buttons",
  "capture",
  "delay",
  "condition",
  "randomizer",
  "flow_link",
  "set_variable",
  "integration",
  "jump",
  "http_request",
  "assistant_gpt",
];

const parseError = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload.message === "string" ? payload.message : "Falha ao processar a solicitação.";
};

const classNames = (...entries: Array<string | false | null | undefined>) => entries.filter(Boolean).join(" ");

const CAPTURE_TYPE_OPTIONS: Array<{ value: NonNullable<BotFlowNode["captureType"]>; label: string }> = [
  { value: "text", label: "Texto livre" },
  { value: "email", label: "Email" },
  { value: "number", label: "Número" },
  { value: "phone", label: "Telefone" },
  { value: "website", label: "Site" },
  { value: "date", label: "Data" },
  { value: "time", label: "Horário" },
  { value: "media", label: "Mídia" },
];

const captureTypeLabel = (value: BotFlowNode["captureType"]) =>
  CAPTURE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Texto livre";

const TRIGGER_TYPE_OPTIONS: Array<{ value: BotFlow["triggerType"]; label: string; hint: string }> = [
  { value: "command", label: "Comando com prefixo", hint: "Inicia quando a pessoa digita um comando, como !menu ou /menu." },
  { value: "keyword", label: "Texto ou palavra-chave", hint: "Inicia quando o texto recebido combina com o gatilho." },
  { value: "message", label: "Qualquer mensagem", hint: "Inicia com qualquer mensagem de texto recebida no escopo do fluxo." },
  { value: "media", label: "Mídia recebida", hint: "Inicia quando chegar imagem, vídeo, áudio, documento, figurinha ou contato." },
  { value: "button", label: "Clique em botão", hint: "Inicia quando a pessoa clicar em um botão específico ou em um comando de botão." },
  { value: "webhook", label: "Webhook", hint: "Gera uma URL pública para receber eventos externos e capturar exemplos." },
];

const TRIGGER_MATCH_OPTIONS: Array<{ value: BotFlow["matchMode"]; label: string }> = [
  { value: "exact", label: "Exatamente igual" },
  { value: "contains", label: "Contém" },
  { value: "starts_with", label: "Começa com" },
];

const TRIGGER_MEDIA_OPTIONS: Array<{ value: NonNullable<BotFlowNode["triggerMediaType"]>; label: string }> = [
  { value: "any", label: "Qualquer mídia" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "audio", label: "Áudio" },
  { value: "document", label: "Documento" },
  { value: "sticker", label: "Figurinha" },
  { value: "vcard", label: "Contato" },
];

const triggerTypeLabel = (value: BotFlow["triggerType"]) =>
  TRIGGER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Comando com prefixo";

const triggerMatchLabel = (value: BotFlow["matchMode"]) =>
  TRIGGER_MATCH_OPTIONS.find((option) => option.value === value)?.label ?? "Exatamente igual";

const triggerMediaLabel = (value: BotFlowNode["triggerMediaType"]) =>
  TRIGGER_MEDIA_OPTIONS.find((option) => option.value === value)?.label ?? "Qualquer mídia";

const getFlowTriggerNode = (flow: BotFlow) => flow.nodes.find((node) => node.kind === "trigger") ?? null;

const resolveFlowTriggerType = (flow: BotFlow, node?: BotFlowNode | null): BotFlow["triggerType"] =>
  node?.triggerType ?? flow.triggerType ?? "command";

const resolveFlowTriggerMatchMode = (flow: BotFlow, node?: BotFlowNode | null): BotFlow["matchMode"] =>
  node?.triggerMatchMode ?? flow.matchMode ?? "exact";

const getTriggerValue = (node: BotFlowNode | null | undefined, flow: BotFlow) => {
  const type = resolveFlowTriggerType(flow, node);
  if (type === "command") return String(node?.triggerValue || node?.text || flow.command || "").trim();
  if (typeof node?.text === "string") return node.text.trim();
  if (typeof node?.triggerValue === "string") return node.triggerValue.trim();
  return "";
};

const describeTriggerNode = (flow: BotFlow, node: BotFlowNode) => {
  const type = resolveFlowTriggerType(flow, node);
  const value = getTriggerValue(node, flow);
  if (type === "command") return `Comando /${extractCommandFromTrigger(value) || flow.command || "comando"}`;
  if (type === "keyword") return `${triggerMatchLabel(resolveFlowTriggerMatchMode(flow, node))}: ${value || "texto"}`;
  if (type === "message") return value ? `Mensagem com filtro: ${value}` : "Qualquer mensagem recebida";
  if (type === "media") {
    const media = triggerMediaLabel(node.triggerMediaType ?? "any");
    return value ? `${media} com legenda ${triggerMatchLabel(resolveFlowTriggerMatchMode(flow, node)).toLowerCase()}: ${value}` : media;
  }
  if (type === "button") return value ? `Botão ${triggerMatchLabel(resolveFlowTriggerMatchMode(flow, node)).toLowerCase()}: ${value}` : "Qualquer clique em botão";
  if (type === "webhook") return value ? `Webhook ${value}` : "Webhook aguardando token";
  return triggerTypeLabel(type);
};

const validateCapturePreviewValue = (type: BotFlowNode["captureType"], value: string) => {
  const trimmed = value.trim();
  if (type === "media") return trimmed.length > 0;
  if (!trimmed) return false;
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(trimmed);
  if (type === "number") return Number.isFinite(Number(trimmed.replace(",", ".")));
  if (type === "phone") return trimmed.replace(/\D/g, "").length >= 8;
  if (type === "website") return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(trimmed);
  if (type === "date") return /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})$/.test(trimmed);
  if (type === "time") return /^([01]?\d|2[0-3]):[0-5]\d$/.test(trimmed);
  return true;
};

const capturePreviewFallback = (node: BotFlowNode) => node.captureFallbackText?.trim() ?? "";

const renderScopeLabel = (flow: BotFlow) => {
  if (flow.scope === "both") return "PV e grupos";
  if (flow.scope === "private") return "PV";
  if (flow.groupId) return "Grupo específico";
  return "Todos os grupos";
};

const describeNode = (node: BotFlowNode) => {
  if (node.kind === "content") return `${(node.contentItems ?? []).length || 1} item(ns) de conteúdo`;
  if (node.kind === "menu") return `${(node.menuOptions ?? []).length || 0} resposta(s) no menu`;
  if (node.kind === "action") return `${(node.actions ?? []).length || 0} ação(ões)`;
  if (node.kind === "media") return node.mediaUrl || "Mídia ainda não configurada";
  if (node.kind === "buttons") return `${(node.buttons ?? []).length} botão(ões)`;
  if (node.kind === "delay" || node.kind === "smart_delay") {
    if (node.smartDelayMode === "datetime") return node.smartDelayUntil ? `Até ${node.smartDelayUntil}` : "Aguardar data e hora";
    return `${node.delaySeconds || 1} ${node.smartDelayUnit || (node.kind === "smart_delay" ? "minutes" : "seconds")}`;
  }
  if (node.kind === "flow_link") return node.targetFlowName || (node.targetFlowId ? `Fluxo #${node.targetFlowId}` : "Selecione um fluxo");
  if (node.kind === "randomizer") return `${node.randomizerMode === "sequential" ? "Sequencial" : "Aleatório"} com ${(node.randomizerOptions ?? []).length} saída(s)`;
  if (node.kind === "integration") return `${node.databaseProvider || "mysql"} ${node.databaseOperation || "query"} ${node.databaseTable || node.databaseName || ""}`.trim();
  if (node.kind === "assistant_gpt") return node.assistantName || "Assistente com IA";
  if (node.kind === "set_variable") {
    const operation = node.variableOperation === "append" ? "adiciona em" : node.variableOperation === "clear" ? "limpa" : "define";
    return `${operation} {{${node.variableName || "variavel"}}}`;
  }
  if (node.kind === "http_request") return `${node.httpMethod || "GET"} ${node.httpUrl || "https://api.exemplo.com"}`;
  if (node.kind === "webhook_wait") return "Aguarda um evento externo antes de continuar";
  if (node.kind === "capture") return `Captura ${captureTypeLabel(node.captureType)} em {{${node.captureVariable || "resposta"}}}`;
  if (node.kind === "jump") return `Pula para ${node.jumpTargetNodeId || "outro bloco"}`;
  if (node.kind === "condition") {
    const rules = node.conditionRules?.length
      ? node.conditionRules
      : [{ variable: node.conditionVariable || "args", operator: node.conditionOperator ?? "contains", value: node.conditionValue || "" }];
    return `${rules.length} comparação(ões)`;
  }
  return node.text || "Sem texto";
};

const normalizeFlowButtons = (buttons: BotFlowButton[]) => {
  const firstActionButton = buttons.find((button) => button.type === "url" || button.type === "call" || button.type === "copy");
  if (firstActionButton) return [firstActionButton];
  return buttons.filter((button) => button.type === "reply").slice(0, 3);
};

const buildFlowSavePayload = (flow: BotFlow) => {
  const triggerNode = getFlowTriggerNode(flow);
  const triggerType = resolveFlowTriggerType(flow, triggerNode);
  const matchMode = resolveFlowTriggerMatchMode(flow, triggerNode);
  const triggerValue = getTriggerValue(triggerNode, flow);
  const command =
    normalizeCommand(flow.command) ||
    (triggerType === "command" ? extractCommandFromTrigger(triggerValue) : "") ||
    normalizeCommand(flow.name) ||
    "fluxo";
  return {
    ...flow,
    command,
    triggerType,
    matchMode,
    nodes: flow.nodes.map((node) =>
      node.kind === "trigger" && node.id === triggerNode?.id
        ? {
            ...node,
            triggerType,
            triggerMatchMode: matchMode,
            triggerMediaType: node.triggerMediaType ?? "any",
            triggerValue: triggerType === "command" ? command : triggerValue,
            text: triggerType === "command" ? `/${command}` : node.text ?? "",
          }
        : node.kind === "trigger"
          ? {
              ...node,
              triggerType: node.triggerType ?? "keyword",
              triggerMatchMode: node.triggerMatchMode ?? "contains",
              triggerMediaType: node.triggerMediaType ?? "any",
              triggerValue:
                node.triggerType === "command"
                  ? extractCommandFromTrigger(node.triggerValue || node.text || "")
                  : node.triggerValue ?? node.text ?? "",
              text:
                node.triggerType === "command"
                  ? `/${extractCommandFromTrigger(node.triggerValue || node.text || "") || "comando"}`
                  : node.text ?? "",
            }
        : node.kind === "buttons"
          ? { ...node, buttons: normalizeFlowButtons(node.buttons ?? []) }
          : node,
    ),
  };
};

const makeFlowSnapshot = (flow: BotFlow) => {
  const payload = buildFlowSavePayload(flow);
  const { id: _id, userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...stablePayload } = payload;
  return JSON.stringify(stablePayload);
};

const inferMediaTypeFromFile = (file: File): BotFlowNode["mediaType"] => {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

const flowMediaAccept = (node: BotFlowNode) =>
  node.kind === "buttons" ? "image/*,video/*,.pdf,.doc,.docx" : "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt";

const estimateNodeHeight = (node: BotFlowNode) => {
  if (node.kind === "menu") return 126 + Math.max(1, (node.menuOptions ?? []).length) * 36;
  if (node.kind === "randomizer") return 104 + Math.max(2, (node.randomizerOptions ?? []).length) * 34;
  if (node.kind === "content") return 118 + Math.max(1, (node.contentItems ?? []).length) * 30;
  if (node.kind === "buttons") return 132 + Math.max(1, (node.buttons ?? []).length) * 42;
  if (node.kind === "condition") return 104;
  if (node.kind === "http_request") return 112;
  if (node.kind === "set_variable") return 98;
  if (node.kind === "jump") return 92;
  if (node.kind === "delay") return 92;
  const textLength = (node.text || node.mediaUrl || "").length;
  return textLength > 70 ? 128 : 106;
};

const buttonBranchId = (buttonId: string): BotFlowEdge["branch"] => `button:${buttonId}`;
const menuBranchId = (optionId: string): BotFlowEdge["branch"] => `menu:${optionId}`;
const randomBranchId = (optionId: string): BotFlowEdge["branch"] => `random:${optionId}`;

const flowEdgeLabel = (edge: BotFlowEdge) =>
  edge.label || (edge.branch === "true" ? "Sim" : edge.branch === "false" ? "Else" : edge.branch === "invalid" ? "Inválido" : "");

const resolveFlowEdgeLabel = (edge: BotFlowEdge, sourceNode?: BotFlowNode, targetNode?: BotFlowNode, flow?: BotFlow) => {
  const branch = edge.branch || "default";
  const explicit = flowEdgeLabel(edge).trim();
  if (explicit) return explicit.slice(0, 32);

  const sourceBranchLabel =
    branch.startsWith("button:") && sourceNode?.kind === "buttons"
      ? (sourceNode.buttons ?? []).find((button) => buttonBranchId(button.id) === branch)?.label
      : branch.startsWith("menu:") && sourceNode?.kind === "menu"
        ? (sourceNode.menuOptions ?? []).find((option) => menuBranchId(option.id) === branch)?.label
        : branch.startsWith("random:") && sourceNode?.kind === "randomizer"
          ? (sourceNode.randomizerOptions ?? []).find((option) => randomBranchId(option.id) === branch)?.label
          : "";
  if (sourceBranchLabel?.trim()) return sourceBranchLabel.trim().slice(0, 32);

  const targetStackId = targetNode?.stackId?.trim();
  const stackNodes = targetStackId ? flow?.nodes.filter((node) => node.stackId?.trim() === targetStackId) ?? [] : [];
  if (stackNodes.length > 1) {
    const stackIndex = Math.max(1, (flow?.nodes.findIndex((node) => node.stackId?.trim() === targetStackId) ?? 0) + 1);
    return `Sequência #${stackIndex}`.slice(0, 32);
  }

  return (targetNode?.title || (targetNode ? nodeDisplayKindLabel(targetNode) : "") || "Próximo").trim().slice(0, 32);
};

const flowEdgeClassName = (branch: BotFlowEdge["branch"] | undefined, falseClass: string, trueClass: string, defaultClass: string) =>
  branch === "false" || branch === "invalid" ? falseClass : branch === "true" ? trueClass : defaultClass;

const buildMeasuredEdgePath = (params: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}) => {
  const { sourceX, sourceY, targetX, targetY } = params;
  // The measured coordinates are already in viewport pixels. Keeping the
  // handle proportional makes the same saved layout look identical at every
  // zoom level and avoids oversized loops between nearby blocks.
  const handle = Math.max(24, Math.min(140, Math.abs(targetX - sourceX) * 0.45));
  const path = `M ${sourceX} ${sourceY} C ${sourceX + handle} ${sourceY}, ${targetX - handle} ${targetY}, ${targetX} ${targetY}`;
  const labelPath =
    targetX >= sourceX
      ? path
      : `M ${targetX} ${targetY} C ${targetX - handle} ${targetY}, ${sourceX + handle} ${sourceY}, ${sourceX} ${sourceY}`;
  const midpointX =
    0.125 * sourceX +
    0.375 * (sourceX + handle) +
    0.375 * (targetX - handle) +
    0.125 * targetX;
  const midpointY = 0.5 * sourceY + 0.5 * targetY;
  const distance = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
  const normalX = -(targetY - sourceY) / distance;
  const normalY = (targetX - sourceX) / distance;
  const deleteOffset = 34;
  return {
    path,
    labelPath,
    labelX: midpointX,
    labelY: midpointY,
    deleteX: midpointX + normalX * deleteOffset,
    deleteY: midpointY + normalY * deleteOffset,
  };
};

const flowButtonIcon = (type: BotFlowButton["type"]) => {
  if (type === "url") return <IconExternalLink size={14} />;
  if (type === "call") return <IconPhone size={14} />;
  if (type === "copy") return <IconCopy size={14} />;
  return <IconArrowBackUp size={14} />;
};

const DEFAULT_FLOW_VARIABLES = [
  "usuario",
  "nome",
  "numero",
  "args",
  "comando",
  "grupo",
  "grupo_id",
  "instancia",
  "prefixo",
  "http_status",
  "http_body",
  "http_error",
];

const collectFlowVariables = (flow: BotFlow): string[] => {
  const variables = new Set(DEFAULT_FLOW_VARIABLES);
  for (const node of flow.nodes) {
    if (node.variableName) variables.add(node.variableName);
    if (node.captureVariable) variables.add(node.captureVariable);
    if (node.conditionVariable) variables.add(node.conditionVariable);
    for (const item of node.contentItems ?? []) {
      if (item.variableName) variables.add(item.variableName);
    }
    for (const action of node.actions ?? []) {
      if (action.type === "set_field" && action.key) variables.add(action.key);
    }
    for (const rule of node.conditionRules ?? []) {
      if (rule.variable) variables.add(rule.variable);
    }
    if (node.httpSaveStatusVariable) variables.add(node.httpSaveStatusVariable);
    if (node.httpSaveBodyVariable) variables.add(node.httpSaveBodyVariable);
    if (node.databaseSaveResultVariable) variables.add(node.databaseSaveResultVariable);
    for (const mapping of node.httpResponseMappings ?? []) {
      if (mapping.variable) variables.add(mapping.variable);
    }
    for (const mapping of node.databaseResponseMappings ?? []) {
      if (mapping.variable) variables.add(mapping.variable);
    }
    for (const mapping of node.webhookResponseMappings ?? []) {
      if (mapping.variable) variables.add(mapping.variable);
    }
  }
  return Array.from(variables).map(normalizeUiVariableName).filter(Boolean);
};

const normalizeUiVariableName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 80);

const parseJsonValue = (value: string | null | undefined): unknown => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
};

type WebhookDataSuggestion = {
  path: string;
  variable: string;
  preview: string;
};

const flattenWebhookValue = (
  value: unknown,
  prefix: string,
  output: WebhookDataSuggestion[] = [],
  depth = 0,
): WebhookDataSuggestion[] => {
  if (value === null || value === undefined || depth > 4) return output;
  if (typeof value !== "object") {
    const preview = String(value);
    output.push({
      path: prefix,
      variable: normalizeUiVariableName(prefix.replace(/\[(\d+)\]/g, "_$1").replace(/\./g, "_")),
      preview: preview.length > 160 ? `${preview.slice(0, 157)}...` : preview,
    });
    return output;
  }
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((entry, index) => flattenWebhookValue(entry, `${prefix}[${index}]`, output, depth + 1));
    return output;
  }
  Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, entry]) => {
    const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (cleanKey) flattenWebhookValue(entry, `${prefix}.${cleanKey}`, output, depth + 1);
  });
  return output;
};

const buildWebhookDataSuggestions = (example: BotFlowWebhookExample | null): WebhookDataSuggestion[] => {
  if (!example) return [];
  return [
    ...flattenWebhookValue(parseJsonValue(example.queryJson), "query"),
    ...flattenWebhookValue(parseJsonValue(example.bodyJson), "body"),
    ...flattenWebhookValue(parseJsonValue(example.headersJson), "headers"),
  ].slice(0, 60);
};

type HttpTestResult = {
  ok: boolean;
  statusCode: number;
  statusText?: string;
  text?: string;
  json?: unknown;
  suggestions?: string[];
};

const renderFlowMediaPreview = (node: BotFlowNode) => {
  const url = (node.mediaUrl ?? "").trim();
  if (!url) {
    return (
      <div className={styles.flowPhoneMediaPlaceholder}>
        <IconPhoto size={22} />
        <span>Mídia do bloco</span>
      </div>
    );
  }
  if (node.mediaType === "video") {
    return <video src={url} controls preload="metadata" />;
  }
  if (node.mediaType === "audio") {
    return (
      <div className={styles.flowPhoneAudioPreview}>
        <IconPhone size={18} />
        <audio src={url} controls preload="metadata" />
      </div>
    );
  }
  if (node.mediaType === "document") {
    return (
      <a className={styles.flowPhoneDocumentPreview} href={url} target="_blank" rel="noreferrer">
        <IconLink size={18} />
        Abrir documento
      </a>
    );
  }
  return <img src={url} alt="Preview da mídia do fluxo" />;
};

const orderFlowPreviewNodes = (flow: BotFlow) => {
  const nodeMap = new Map(flow.nodes.map((node) => [node.id, node]));
  const ordered: BotFlowNode[] = [];
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;
    visited.add(nodeId);
    if (node.kind !== "trigger") ordered.push(node);
    const outgoing = flow.edges.filter((edge) => edge.from === nodeId);
    const defaultEdge = outgoing.find((edge) => !edge.branch || edge.branch === "default");
    if (defaultEdge) {
      walk(defaultEdge.to);
      return;
    }
    outgoing.forEach((edge) => walk(edge.to));
  };
  walk("trigger");
  flow.nodes.forEach((node) => {
    if (!visited.has(node.id) && node.kind !== "trigger") ordered.push(node);
  });
  return ordered;
};

const FlowNodeCard = ({ data }: NodeProps<Node<FlowNodeData>>) => {
  const node = data.flowNode;
  const selected = data.selected;
  const canRemove = node.id !== "trigger";
  const canFinishTouchConnection = Boolean(data.touchConnectEnabled && data.touchConnection && data.touchConnection.source !== node.id);
  const replyButtons = node.kind === "buttons" ? (node.buttons ?? []).filter((button) => button.type === "reply") : [];
  const startTouchConnection = (
    event: ReactPointerEvent<HTMLDivElement>,
    branch: BotFlowEdge["branch"] = "default",
    label = "",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    data.onStartConnectionDrag(
      { source: node.id, branch, label },
      {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    );
  };
  const handleNodeMediaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (file) data.onUploadMedia(node.id, file);
  };
  const handleNodeContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    data.onSelect(node.id);
    if (node.kind === "buttons") {
      data.onEditField(node.id, "text");
      return;
    }
    if (node.kind === "text") {
      data.onEditField(node.id, "text");
      return;
    }
    if (node.kind === "media") {
      data.onEditField(node.id, "media");
    }
  };
  return (
    <div
      className={classNames(
        styles.flowNodeCard,
        node.kind === "buttons" && styles.flowButtonNodeCard,
        node.kind === "menu" && styles.flowMenuNodeCard,
        node.kind === "http_request" && styles.flowHttpNodeCard,
        selected && styles.flowNodeCardSelected,
        selected && node.kind === "http_request" && styles.flowHttpNodeCardSelected,
        canFinishTouchConnection && styles.flowNodeTouchTarget,
      )}
      data-flow-node-id={node.id}
      onContextMenu={handleNodeContextMenu}
      onClick={() => {
        if (canFinishTouchConnection) {
          data.onFinishTouchConnection(node.id);
          return;
        }
        data.onSelect(node.id);
      }}
    >
      <Handle type="target" position={Position.Left} id="in" className={styles.reactFlowHandle} />
      <div className={styles.flowNodeHeader}>
        <span className={styles.flowNodeTitle}>
          <span className={styles.flowNodeIcon}>{nodeIcon(node.kind)}</span>
          {node.title || nodeDisplayKindLabel(node)}
        </span>
        <span className={styles.chip}>{nodeDisplayKindLabel(node)}</span>
      </div>
      {node.kind === "buttons" ? (
        <div className={styles.flowButtonNodeBubble}>
          <div className={styles.flowButtonHeaderSlot}>
            {node.mediaUrl ? (
              <div className={styles.flowButtonNodeMedia}>
                {node.mediaType === "video" ? (
                  <video src={node.mediaUrl} preload="metadata" />
                ) : node.mediaType === "document" ? (
                  <span><IconLink size={16} /> Documento</span>
                ) : (
                  <img src={node.mediaUrl} alt="" />
                )}
                <button
                  type="button"
                  className={styles.flowButtonHeaderAction}
                  title="Trocar mídia"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onEditField(node.id, "media");
                  }}
                >
                  <IconPhoto size={13} />
                </button>
                <button
                  type="button"
                  className={styles.flowButtonHeaderRemove}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onClearMedia(node.id);
                  }}
                  aria-label="Remover mídia"
                >
                  <IconTrash size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.flowButtonHeaderUpload}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onEditField(node.id, "media");
                }}
              >
                <IconPhoto size={17} />
                <span>Adicionar mídia no header</span>
              </button>
            )}
          </div>
          <div className={styles.flowButtonMessageTitle}>
            <strong>{(node.headerTitle ?? "").trim() || "Título da mensagem"}</strong>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onEditField(node.id, "headerTitle");
              }}
              aria-label="Editar título"
            >
              <IconPencil size={12} />
            </button>
          </div>
          <div className={styles.flowButtonMessageBody}>
            <p>{(node.text ?? "").trim() || "Selecione uma opção abaixo."}</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onEditField(node.id, "text");
              }}
              aria-label="Editar mensagem"
            >
              <IconPencil size={12} />
            </button>
          </div>
          <div className={styles.flowNodeButtonList}>
            {(node.buttons ?? []).map((button) => (
              <div
                key={button.id}
                className={styles.flowNodeButtonItem}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data.onSelect(node.id);
                  data.onEditButton(node.id, button.id);
                }}
              >
                <button
                  type="button"
                  className={styles.flowNodeButtonTrash}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onRemoveButton(node.id, button.id);
                  }}
                  aria-label={`Remover ${button.label || "botão"}`}
                >
                  <IconTrash size={12} />
                </button>
                <span className={styles.flowNodeButtonContent}>
                  <span>{flowButtonIcon(button.type)}</span>
                  <strong>{button.label || "Botão"}</strong>
                </span>
                <button
                  type="button"
                  className={styles.flowNodeButtonEdit}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onEditButton(node.id, button.id);
                  }}
                  aria-label={`Editar ${button.label || "botão"}`}
                >
                  <IconPencil size={12} />
                </button>
                {button.type === "reply" ? (
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={buttonBranchId(button.id)}
                    className={classNames(styles.reactFlowHandle, styles.reactFlowButtonHandle)}
                    onPointerDown={(event) => startTouchConnection(event, buttonBranchId(button.id), button.label)}
                  />
                ) : null}
              </div>
            ))}
            {replyButtons.length === 0 ? <small>Botão de ação sem saída visual.</small> : null}
          </div>
          {!((node.buttons ?? []).some((button) => button.type === "url" || button.type === "call" || button.type === "copy")) && (node.buttons ?? []).length < 3 ? (
            <button
              type="button"
              className={styles.flowNodeAddButton}
              onClick={(event) => {
                event.stopPropagation();
                data.onAddButton(node.id);
              }}
              aria-label="Adicionar botão"
            >
              <IconPlus size={15} />
            </button>
          ) : null}
        </div>
      ) : node.kind === "trigger" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconBolt size={15} />
            <span>{triggerTypeLabel(resolveFlowTriggerType(data.flow, node))}</span>
          </div>
          <div className={styles.conditionNodeRow}>
            <strong>{describeTriggerNode(data.flow, node)}</strong>
          </div>
        </div>
      ) : node.kind === "webhook_wait" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconLink size={15} />
            <span>Aguardando webhook</span>
          </div>
          <div className={styles.conditionNodeRow}>
            <strong>{node.triggerValue ? "Token configurado" : "Sem token"}</strong>
          </div>
        </div>
      ) : node.kind === "content" ? (
        <div className={styles.conditionNodeContent}>
          {(node.contentItems?.length ? node.contentItems : [{ id: "preview", type: "text", text: node.text || "Mensagem do conteúdo" }]).slice(0, 4).map((item, index) => (
            <div key={item.id || index} className={styles.conditionNodeRow}>
              <IconMessage size={15} />
              <span>{item.type === "delay" ? `${item.delaySeconds || 1}s de espera` : item.text || item.caption || item.mediaUrl || "Item de conteúdo"}</span>
            </div>
          ))}
        </div>
      ) : node.kind === "menu" ? (
        <div className={styles.flowMenuListBubble}>
          <div className={styles.flowMenuListCard}>
            <div className={styles.flowButtonMessageTitle}>
              <strong>{node.headerTitle || "Lista"}</strong>
            </div>
            <div className={styles.flowButtonMessageBody}>
              <p>{node.text || "Escolha uma opção."}</p>
            </div>
            {node.footerText ? <span className={styles.flowMenuFooter}>{node.footerText}</span> : null}
            <div className={styles.flowMenuOpenButton}>
              <IconMenu2 size={15} />
              <strong>{node.menuMode === "number" ? "Responder por número" : "Ver opções"}</strong>
            </div>
          </div>
          {node.menuMode === "list" ? (
            <div className={styles.flowMenuOptionsPreview}>
              {(node.menuOptions ?? []).map((option) => (
                <div key={option.id} className={styles.flowMenuOptionRow}>
                  <span>
                    <strong>{option.label || "Opção"}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={menuBranchId(option.id)}
                    className={classNames(styles.reactFlowHandle, styles.reactFlowButtonHandle)}
                    onPointerDown={(event) => startTouchConnection(event, menuBranchId(option.id), option.label)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.flowNodeButtonList}>
              {(node.menuOptions ?? []).map((option, index) => (
                <div key={option.id} className={styles.flowNodeButtonItem}>
                  <span className={styles.flowNodeButtonContent}>
                    <span>#{index + 1}</span>
                    <strong>{option.label || "Opção"}</strong>
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={menuBranchId(option.id)}
                    className={classNames(styles.reactFlowHandle, styles.reactFlowButtonHandle)}
                    onPointerDown={(event) => startTouchConnection(event, menuBranchId(option.id), option.label)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : node.kind === "action" ? (
        <div className={styles.conditionNodeContent}>
          {(node.actions?.length ? node.actions : [{ id: "preview", type: "custom_event", label: "Adicionar ação" }]).slice(0, 4).map((action, index) => (
            <div key={action.id || index} className={styles.conditionNodeRow}>
              <IconBolt size={15} />
              <span>{action.label || action.type}</span>
            </div>
          ))}
        </div>
      ) : node.kind === "randomizer" ? (
        <div className={styles.conditionNodeContent}>
          {(node.randomizerOptions ?? []).map((option) => (
            <div key={option.id} className={styles.conditionNodeRow}>
              <IconGitBranch size={15} />
              <span><strong>{option.label}</strong> {node.randomizerMode === "random" ? `${option.weight}%` : "sequencial"}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={randomBranchId(option.id)}
                className={classNames(styles.reactFlowHandle, styles.reactFlowButtonHandle)}
                onPointerDown={(event) => startTouchConnection(event, randomBranchId(option.id), option.label)}
              />
            </div>
          ))}
        </div>
      ) : node.kind === "flow_link" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconArrowBackUp size={15} />
            <span>Iniciar outro fluxo</span>
          </div>
          <div className={styles.conditionNodeRow}>
            <strong>{node.targetFlowName || (node.targetFlowId ? `Fluxo #${node.targetFlowId}` : "Selecione um fluxo")}</strong>
          </div>
        </div>
      ) : node.kind === "smart_delay" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconClock size={15} />
            <span>{describeNode(node)}</span>
          </div>
        </div>
      ) : node.kind === "integration" ? (
        <div className={styles.httpNodeContent}>
          <div className={styles.httpNodeRequestLine}>
            <IconExternalLink size={14} />
            <span>{node.httpMethod || "POST"}</span>
            <strong>{node.httpUrl || "Webhook/API"}</strong>
          </div>
        </div>
      ) : node.kind === "assistant_gpt" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconSettings size={15} />
            <span>{node.assistantName || "Assistente IA"}</span>
          </div>
          <div className={styles.conditionNodeRow}>
            <strong>{node.assistantModel || "gpt-4o-mini"}</strong>
          </div>
        </div>
      ) : node.kind === "media" ? (
        <div className={styles.flowNodeMediaPreview}>
          {renderFlowMediaPreview(node)}
          {node.text?.trim() ? <p>{node.text}</p> : null}
        </div>
      ) : node.kind === "http_request" ? (
        <div className={styles.httpNodeContent}>
          <div className={styles.httpNodeRequestLine}>
            <IconBolt size={14} />
            <span>{node.httpMethod || "GET"}</span>
            <strong>{node.httpUrl || "https://api.exemplo.com"}</strong>
          </div>
        </div>
      ) : node.kind === "condition" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconGitBranch size={15} />
            <span>
              IF {(node.conditionRules?.[0]?.variable || node.conditionVariable || "variavel") ? (
                <strong>{node.conditionRules?.[0]?.variable || node.conditionVariable || "variavel"}</strong>
              ) : null}
            </span>
          </div>
          <div className={styles.conditionNodeRow}>
            <span>Else</span>
          </div>
        </div>
      ) : node.kind === "capture" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconMessage size={15} />
            <span>Capturar <strong>{captureTypeLabel(node.captureType)}</strong></span>
          </div>
          <div className={styles.conditionNodeRow}>
            <span>Salvar em</span>
            <strong>{"{{"}{node.captureVariable || "resposta"}{"}}"}</strong>
          </div>
        </div>
      ) : node.kind === "jump" ? (
        <div className={styles.conditionNodeContent}>
          <div className={styles.conditionNodeRow}>
            <IconArrowBackUp size={15} />
            <span>Pular para</span>
          </div>
          <div className={styles.conditionNodeRow}>
            <strong>{node.jumpTargetNodeId || "Selecione um bloco"}</strong>
          </div>
        </div>
      ) : (
        <p className={styles.flowNodeText}>{describeNode(node)}</p>
      )}
      {canRemove ? (
        <button
          type="button"
          className={styles.flowNodeDelete}
          onClick={(event) => {
            event.stopPropagation();
            data.onRemove(node.id);
          }}
          title="Excluir bloco"
        >
          <IconTrash size={13} />
        </button>
      ) : null}
      {node.kind === "condition" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className={classNames(styles.reactFlowHandle, styles.reactFlowHandleTrue)}
            onPointerDown={(event) => startTouchConnection(event, "true", "Sim")}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            className={classNames(styles.reactFlowHandle, styles.reactFlowHandleFalse)}
            onPointerDown={(event) => startTouchConnection(event, "false", "Não")}
          />
          <span className={classNames(styles.handleLabel, styles.handleLabelTrue)}>Sim</span>
          <span className={classNames(styles.handleLabel, styles.handleLabelFalse)}>Else</span>
        </>
      ) : node.kind === "capture" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="default"
            className={classNames(styles.reactFlowHandle, styles.reactFlowHandleTrue)}
            onPointerDown={(event) => startTouchConnection(event, "default", "Válido")}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="invalid"
            className={classNames(styles.reactFlowHandle, styles.reactFlowHandleFalse)}
            onPointerDown={(event) => startTouchConnection(event, "invalid", "Inválido")}
          />
          <span className={classNames(styles.handleLabel, styles.handleLabelTrue)}>Válido</span>
          <span className={classNames(styles.handleLabel, styles.handleLabelFalse)}>Inválido</span>
        </>
      ) : node.kind === "buttons" || node.kind === "menu" || node.kind === "randomizer" || node.kind === "flow_link" ? null : (
        <Handle
          type="source"
          position={Position.Right}
          id="default"
          className={styles.reactFlowHandle}
          onPointerDown={(event) => startTouchConnection(event, "default", "")}
        />
      )}
    </div>
  );
};

const FlowEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<Edge<FlowEdgeData>>) => {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const removeEdge = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    data?.onRemove(id);
  };
  return (
    <>
      <path className="react-flow__edge-path" d={edgePath} markerEnd={markerEnd} />
      <path className={styles.edgeHitPath} d={edgePath} onClick={() => data?.onRemove(id)} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={styles.edgeDeleteButton}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={removeEdge}
          title="Excluir conexão"
        >
          {data?.label || <IconX size={12} />}
        </button>
      </EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = { botFlowNode: FlowNodeCard };
const edgeTypes = { botFlowEdge: FlowEdge };
const FLOW_WEB_POSITION_SCALE = 1;

const buildBotFlowRealtimeWebSocketUrl = () => {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/bot-flows`;
};

const canvasNodeIdsSignature = (nodes: Node<FlowNodeData>[]) => nodes.map((node) => node.id).join("|");

const canvasNodePositionSignature = (nodes: Node<FlowNodeData>[]) =>
  nodes.map((node) => `${node.id}:${Math.round(node.position.x)}:${Math.round(node.position.y)}`).join("|");

const toFlowDisplayPosition = (position: { x: number; y: number }) => ({
  x: position.x * FLOW_WEB_POSITION_SCALE,
  y: position.y * FLOW_WEB_POSITION_SCALE,
});

const toFlowStoredPosition = (position: { x: number; y: number }) => ({
  x: position.x / FLOW_WEB_POSITION_SCALE,
  y: position.y / FLOW_WEB_POSITION_SCALE,
});

const mergeDraggedCanvasNodes = (
  baseNodes: Node<FlowNodeData>[],
  changedNodes: Node<FlowNodeData>[],
): Node<FlowNodeData>[] => {
  if (changedNodes.length === 0) return baseNodes;
  const changedById = new Map(changedNodes.map((node) => [node.id, node]));
  const merged = baseNodes.map((node) => {
    const changed = changedById.get(node.id);
    return changed
      ? {
          ...node,
          position: changed.position,
          positionAbsoluteX: changed.positionAbsoluteX,
          positionAbsoluteY: changed.positionAbsoluteY,
          selected: changed.selected ?? node.selected,
          dragging: changed.dragging ?? node.dragging,
        }
      : node;
  });
  const existing = new Set(baseNodes.map((node) => node.id));
  for (const changed of changedNodes) {
    if (!existing.has(changed.id)) merged.push(changed);
  }
  return merged;
};

const UserFlowBuilderInner = ({ instances, groups, preferredInstanceId = null, initialImportText = "", onExit }: Props) => {
  const [flows, setFlows] = useState<BotFlow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<number | "draft" | null>(null);
  const [draft, setDraft] = useState<BotFlow>(() => makeDraftFlow(preferredInstanceId ?? instances[0]?.id ?? null));
  const [selectedNodeId, setSelectedNodeId] = useState("trigger");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sharingFlowId, setSharingFlowId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importAuth, setImportAuth] = useState("");
  const [importName, setImportName] = useState("");
  const [importCommand, setImportCommand] = useState("");
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<Date | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<Node<FlowNodeData>, Edge<FlowEdgeData>> | null>(null);
  const [flowConfigOpen, setFlowConfigOpen] = useState(false);
  const [mobilePaletteOpen, setMobilePaletteOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [quickEditorOpen, setQuickEditorOpen] = useState(false);
  const [buttonEditor, setButtonEditor] = useState<{ nodeId: string; buttonId: string } | null>(null);
  const [fieldEditor, setFieldEditor] = useState<{ nodeId: string; field: FlowNodeEditableField } | null>(null);
  const [touchDragPreview, setTouchDragPreview] = useState<{ kind: BotFlowPaletteKind; x: number; y: number } | null>(null);
  const [touchConnectEnabled, setTouchConnectEnabled] = useState(false);
  const [touchConnection, setTouchConnection] = useState<TouchConnectionDraft | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragDraft | null>(null);
  const [renderedEdges, setRenderedEdges] = useState<RenderedFlowEdge[]>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [canvasNodes, setCanvasNodes] = useState<Node<FlowNodeData>[]>([]);
  const updateNodeInternals = useUpdateNodeInternals();
  const canvasPanelRef = useRef<HTMLElement | null>(null);
  const builderStageRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef("");
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const latestFlowRef = useRef<BotFlow | null>(null);
  const flowTouchActiveRef = useRef(false);
  const flowConnectionTouchActiveRef = useRef(false);
  const connectionDragRef = useRef<ConnectionDragDraft | null>(null);
  const flowRealtimeSocketRef = useRef<WebSocket | null>(null);
  const flowRealtimeReconnectTimerRef = useRef<number | null>(null);
  const initialImportAppliedRef = useRef("");
  const canvasNodesRef = useRef<Node<FlowNodeData>[]>([]);
  const lastCommittedPositionSignatureRef = useRef("");
  const dragPositionCommittedRef = useRef(false);
  const renderedEdgesSignatureRef = useRef("");
  const measureEdgesFrameRef = useRef<number | null>(null);
  const scheduleMeasureRenderedEdgesRef = useRef<() => void>(() => undefined);
  const lastFittedFlowIdRef = useRef<number | null>(null);
  const liveFlowBroadcastFrameRef = useRef<number | null>(null);
  const flowRealtimeClientIdRef = useRef(newId("web-flow"));
  const connectionDragFrameRef = useRef<number | null>(null);
  const nodeDragActiveRef = useRef(false);
  const skipPaletteClickRef = useRef(false);
  const paletteDragActiveRef = useRef(false);
  const touchDragRef = useRef<{
    kind: BotFlowPaletteKind;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const isEditorOpen = selectedFlowId !== null;
  const connectionDragActive = Boolean(connectionDrag);
  const activeProfileInstanceId = useMemo(
    () => preferredInstanceId ?? instances[0]?.id ?? null,
    [instances, preferredInstanceId],
  );

  const selectedFlow = useMemo(() => {
    if (selectedFlowId === "draft") return draft;
    return flows.find((flow) => flow.id === selectedFlowId) ?? draft;
  }, [draft, flows, selectedFlowId]);
  const applyActiveProfileToFlow = useCallback(
    (flow: BotFlow): BotFlow => {
      if (!activeProfileInstanceId) return flow;
      return {
        ...flow,
        instanceId: activeProfileInstanceId,
        groupId:
          flow.groupId && groups.some((group) => group.id === flow.groupId && group.instanceId === activeProfileInstanceId)
            ? flow.groupId
            : null,
      };
    },
    [activeProfileInstanceId, groups],
  );

  const nodeHandleSignature = useMemo(
    () =>
      selectedFlow.nodes
        .map((node) =>
          [
            node.id,
            node.kind,
            node.kind === "buttons" ? (node.buttons ?? []).map((button) => `${button.id}:${button.type}`).join(",") : "",
            node.kind === "menu" ? (node.menuOptions ?? []).map((option) => option.id).join(",") : "",
            node.kind === "randomizer" ? (node.randomizerOptions ?? []).map((option) => option.id).join(",") : "",
            node.kind === "buttons" ? node.mediaUrl ?? "" : "",
          ].join(":"),
        )
        .join("|"),
    [selectedFlow.nodes],
  );
  const nodeIdsForInternals = useMemo(() => selectedFlow.nodes.map((node) => node.id), [nodeHandleSignature]);

  useEffect(() => {
    latestFlowRef.current = selectedFlow;
  }, [selectedFlow]);

  useEffect(() => {
    connectionDragRef.current = connectionDrag;
  }, [connectionDrag]);

  useEffect(() => {
    setTouchConnectEnabled(false);
  }, []);

  useEffect(() => {
    if (!isEditorOpen) return;
    if (nodeIdsForInternals.length === 0) return;
    const run = () => nodeIdsForInternals.forEach((nodeId) => updateNodeInternals(nodeId));
    const frame = window.requestAnimationFrame(run);
    const timer = window.setTimeout(run, 350);
    const lateTimer = window.setTimeout(run, 1000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.clearTimeout(lateTimer);
    };
  }, [isEditorOpen, nodeIdsForInternals, updateNodeInternals]);

  const selectedNode = useMemo(
    () => selectedFlow.nodes.find((node) => node.id === selectedNodeId) ?? selectedFlow.nodes[0] ?? null,
    [selectedFlow.nodes, selectedNodeId],
  );
  const selectedNodeIsEditable = Boolean(quickEditorOpen && selectedNode && selectedNode.kind !== "buttons");
  const editingButtonNode = buttonEditor ? selectedFlow.nodes.find((node) => node.id === buttonEditor.nodeId) ?? null : null;
  const editingButton =
    editingButtonNode?.kind === "buttons"
      ? (editingButtonNode.buttons ?? []).find((button) => button.id === buttonEditor?.buttonId) ?? null
      : null;
  const editingFieldNode = fieldEditor ? selectedFlow.nodes.find((node) => node.id === fieldEditor.nodeId) ?? null : null;

  const broadcastFlowRealtime = useCallback((_flow: BotFlow) => {
    // Realtime updates are emitted by the API after persistence. Local previews
    // are intentionally not broadcast to avoid stale sessions rolling back nodes.
  }, []);

  const updateSelectedFlow = useCallback(
    (updater: (flow: BotFlow) => BotFlow) => {
      const next = updater(selectedFlow);
      if (selectedFlowId === "draft" || next.id === 0) {
        setDraft(next);
        setSelectedFlowId("draft");
        return;
      }
      setFlows((current) => current.map((flow) => (flow.id === next.id ? next : flow)));
      broadcastFlowRealtime(next);
    },
    [broadcastFlowRealtime, selectedFlow, selectedFlowId],
  );

  const selectNodeForEdit = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setQuickEditorOpen(true);
  }, []);

  const updateNode = useCallback(
    (nodeId: string, updater: (node: BotFlowNode) => BotFlowNode) => {
      updateSelectedFlow((flow) => {
        let nextCommand = flow.command;
        let nextTriggerType: BotFlow["triggerType"] = flow.triggerType;
        let nextMatchMode: BotFlow["matchMode"] = flow.matchMode;
        const nodes: BotFlowNode[] = flow.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          const updated = updater(node);
          if (updated.kind === "trigger") {
            const triggerType: BotFlow["triggerType"] = updated.triggerType ?? flow.triggerType ?? "command";
            const triggerMatchMode: BotFlow["matchMode"] = updated.triggerMatchMode ?? flow.matchMode ?? "exact";
            nextTriggerType = triggerType;
            nextMatchMode = triggerMatchMode;
            if (triggerType === "command") {
              const triggerCommand = extractCommandFromTrigger(updated.text || updated.triggerValue || flow.command);
              nextCommand = triggerCommand || flow.command || "fluxo";
              return {
                ...updated,
                triggerType,
                triggerMatchMode: "exact",
                triggerValue: nextCommand,
                text: `/${nextCommand}`,
              };
            }
            return {
              ...updated,
              triggerType,
              triggerMatchMode,
              triggerValue: updated.triggerValue ?? updated.text ?? "",
            };
          }
          return updated;
        });
        return { ...flow, command: nextCommand, triggerType: nextTriggerType, matchMode: nextMatchMode, nodes };
      });
    },
    [updateSelectedFlow],
  );

  const refreshFlows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/bot-flows", { cache: "no-store" });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = await response.json();
      const nextFlows: BotFlow[] = Array.isArray(payload.flows) ? payload.flows : [];
      setFlows(nextFlows);
      setSelectedFlowId((current) => {
        if (current === "draft") return current;
        if (current && nextFlows.some((flow: BotFlow) => flow.id === current)) return current;
        return null;
      });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Não foi possível carregar os fluxos." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshFlows();
  }, [refreshFlows]);

  useEffect(() => {
    const nextImport = initialImportText.trim();
    if (!nextImport || initialImportAppliedRef.current === nextImport) return;
    initialImportAppliedRef.current = nextImport;
    setImportText(nextImport);
    setImportModalOpen(true);
  }, [initialImportText]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let closed = false;

    const applyRemoteFlow = (message: Record<string, unknown>) => {
      const eventType = String(message.eventType || message.type || "");
      if (!eventType.startsWith("flow.")) return;
      if (typeof message.sourceClientId === "string" && message.sourceClientId === flowRealtimeClientIdRef.current) return;

      const flowId = Number(message.flowId || 0);
      const remoteFlow = message.flow && typeof message.flow === "object" && !Array.isArray(message.flow)
        ? (message.flow as BotFlow)
        : null;

      if (eventType === "flow.deleted") {
        setFlows((current) => current.filter((flow) => flow.id !== flowId));
        setSelectedFlowId((current) => (current === flowId ? null : current));
        return;
      }

      if (!remoteFlow?.id) {
        void refreshFlows();
        return;
      }

      setFlows((current) => {
        const existing = current.find((flow) => flow.id === remoteFlow.id);
        if (existing && (remoteFlow.revision ?? 0) <= (existing.revision ?? 0)) return current;
        const next = existing
          ? current.map((flow) => (flow.id === remoteFlow.id ? remoteFlow : flow))
          : [remoteFlow, ...current];
        return next.sort((a, b) =>
          String(b.updatedAt ?? b.createdAt ?? b.id).localeCompare(String(a.updatedAt ?? a.createdAt ?? a.id)),
        );
      });

      const localBusy = saveInFlightRef.current || autoSaveTimerRef.current !== null;
      const openFlow = latestFlowRef.current;
      if (
        selectedFlowId === remoteFlow.id &&
        !localBusy &&
        (!openFlow || (remoteFlow.revision ?? 0) > (openFlow.revision ?? 0))
      ) {
        setSelectedNodeId((currentNodeId) =>
          remoteFlow.nodes.some((node) => node.id === currentNodeId) ? currentNodeId : "trigger",
        );
        lastSavedSnapshotRef.current = makeFlowSnapshot(remoteFlow);
        setLastAutoSavedAt(remoteFlow.updatedAt ? new Date(remoteFlow.updatedAt) : new Date());
        renderedEdgesSignatureRef.current = "";
        window.setTimeout(() => scheduleMeasureRenderedEdgesRef.current(), 80);
        window.setTimeout(() => scheduleMeasureRenderedEdgesRef.current(), 260);
      }
    };

    const scheduleReconnect = () => {
      if (closed || flowRealtimeReconnectTimerRef.current !== null) return;
      flowRealtimeReconnectTimerRef.current = window.setTimeout(() => {
        flowRealtimeReconnectTimerRef.current = null;
        connect();
      }, 2500);
    };

    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(buildBotFlowRealtimeWebSocketUrl());
      flowRealtimeSocketRef.current = socket;
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.type === "ping") {
            socket.send(JSON.stringify({ type: "pong", at: new Date().toISOString() }));
            return;
          }
          if (message.type === "hello" || message.type === "pong" || message.type === "error") return;
          applyRemoteFlow(message);
        } catch {
          // Ignore invalid realtime payloads.
        }
      };
      socket.onclose = scheduleReconnect;
      socket.onerror = scheduleReconnect;
    };

    connect();
    return () => {
      closed = true;
      if (flowRealtimeReconnectTimerRef.current !== null) {
        window.clearTimeout(flowRealtimeReconnectTimerRef.current);
        flowRealtimeReconnectTimerRef.current = null;
      }
      flowRealtimeSocketRef.current?.close();
      flowRealtimeSocketRef.current = null;
      if (liveFlowBroadcastFrameRef.current !== null) {
        window.cancelAnimationFrame(liveFlowBroadcastFrameRef.current);
        liveFlowBroadcastFrameRef.current = null;
      }
    };
  }, [refreshFlows, selectedFlowId]);

  useEffect(() => {
    if (!isEditorOpen) return;
    if (selectedFlow.nodes.some((node) => node.id === selectedNodeId)) return;
    setSelectedNodeId("trigger");
  }, [isEditorOpen, selectedFlow, selectedNodeId]);

  useEffect(() => {
    if (!isEditorOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousHtmlTouchAction = document.documentElement.style.touchAction;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyWidth = document.body.style.width;
    const previousBodyHeight = document.body.style.height;
    const previousScrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.touchAction = "none";
    document.documentElement.style.touchAction = "none";
    document.body.style.position = "fixed";
    document.body.style.top = `-${previousScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.height = "100dvh";
    document.body.classList.add("botadmin-flow-lock");
    document.documentElement.classList.add("botadmin-flow-lock");
    document.body.classList.add(styles.flowTouchLockedBody);
    document.documentElement.classList.add(styles.flowTouchLockedRoot);
    const blockNavigation = (event: BeforeUnloadEvent) => {
      const current = latestFlowRef.current;
      if (!current) return;
      if (makeFlowSnapshot(current) === lastSavedSnapshotRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const blockExternalDrop = (event: globalThis.DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      if (types.includes("application/botadmin-flow-node")) return;
      event.preventDefault();
    };
    const isFlowTouchTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return Boolean(
        element?.closest(
          [
            ".react-flow",
            ".react-flow__handle",
            ".react-flow__connection",
            ".react-flow__connection-path",
            ".react-flow__edge-path",
            ".react-flow__pane",
            ".react-flow__viewport",
            "[data-flow-node-id]",
            `.${styles.builderStage}`,
            `.${styles.nodePalette}`,
            `.${styles.nodeTypeButton}`,
            `.${styles.touchDragPreview}`,
          ].join(", "),
        ),
      );
    };
    const shouldIgnoreTouchTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      if (element?.closest(`.${styles.nodeTypeButton}, .react-flow__handle, [data-flow-node-id]`)) return false;
      return Boolean(element?.closest("input, textarea, select, button"));
    };
    const isConnectionTouchTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return Boolean(
        element?.closest(
          ".react-flow__handle, .react-flow__connection, .react-flow__connection-path, .react-flow__edge-path, .react-flow__edge, .measuredEdgesLayer",
        ),
      );
    };
    const preventEditorGesture = (event: Event) => {
      if (event.cancelable) event.preventDefault();
    };
    const preventNativePaletteDrag = (event: Event) => {
      if (!paletteDragActiveRef.current) return;
      preventEditorGesture(event);
      event.stopPropagation();
    };
    const startFlowTouch = (event: TouchEvent | PointerEvent) => {
      if (!isFlowTouchTarget(event.target) || shouldIgnoreTouchTarget(event.target)) return;
      flowTouchActiveRef.current = true;
      flowConnectionTouchActiveRef.current = isConnectionTouchTarget(event.target);
      if (paletteDragActiveRef.current) {
        preventEditorGesture(event);
        return;
      }
      if (event instanceof PointerEvent && event.pointerType !== "mouse" && event.cancelable) event.preventDefault();
    };
    const blockCanvasPullToRefresh = (event: TouchEvent | PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        paletteDragActiveRef.current ||
        touchDragRef.current ||
        connectionDragRef.current ||
        flowConnectionTouchActiveRef.current ||
        isConnectionTouchTarget(event.target)
      ) {
        preventEditorGesture(event);
        event.stopPropagation();
        return;
      }
      if (target?.closest("input, textarea, select")) return;
      if (!flowTouchActiveRef.current && !isFlowTouchTarget(event.target)) return;
      preventEditorGesture(event);
    };
    const blockEditorContextMenu = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select")) return;
      if (!isFlowTouchTarget(event.target) && !target?.closest(`.${styles.builderStage}`)) return;
      event.preventDefault();
    };
    const blockEditorWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`input, textarea, select, .${styles.flowPhoneChat}`)) return;
      if (!isFlowTouchTarget(event.target) && !target?.closest(`.${styles.builderStage}`)) return;
      preventEditorGesture(event);
    };
    const keepScrollLocked = () => {
      if (window.scrollY !== previousScrollY) window.scrollTo(0, previousScrollY);
    };
    const stopFlowTouch = () => {
      flowTouchActiveRef.current = false;
      flowConnectionTouchActiveRef.current = false;
      paletteDragActiveRef.current = false;
    };
    window.addEventListener("beforeunload", blockNavigation);
    window.addEventListener("dragover", blockExternalDrop);
    window.addEventListener("drop", blockExternalDrop);
    window.addEventListener("dragstart", preventNativePaletteDrag, { capture: true });
    window.addEventListener("selectstart", preventNativePaletteDrag, { capture: true });
    window.addEventListener("touchstart", startFlowTouch, { passive: false, capture: true });
    window.addEventListener("touchmove", blockCanvasPullToRefresh, { passive: false, capture: true });
    window.addEventListener("touchend", stopFlowTouch, { capture: true });
    window.addEventListener("touchcancel", stopFlowTouch, { capture: true });
    window.addEventListener("pointerdown", startFlowTouch, { passive: false, capture: true });
    window.addEventListener("pointermove", blockCanvasPullToRefresh, { passive: false, capture: true });
    window.addEventListener("pointerup", stopFlowTouch, { capture: true });
    window.addEventListener("pointercancel", stopFlowTouch, { capture: true });
    document.addEventListener("touchstart", startFlowTouch, { passive: false, capture: true });
    document.addEventListener("touchmove", blockCanvasPullToRefresh, { passive: false, capture: true });
    document.addEventListener("touchend", stopFlowTouch, { capture: true });
    document.addEventListener("touchcancel", stopFlowTouch, { capture: true });
    document.addEventListener("contextmenu", blockEditorContextMenu, { capture: true });
    window.addEventListener("wheel", blockEditorWheel, { passive: false, capture: true });
    window.addEventListener("scroll", keepScrollLocked, { capture: true });
    window.addEventListener("gesturestart", preventEditorGesture, { passive: false, capture: true });
    return () => {
      flowTouchActiveRef.current = false;
      flowConnectionTouchActiveRef.current = false;
      paletteDragActiveRef.current = false;
      document.body.classList.remove("botadmin-flow-lock");
      document.documentElement.classList.remove("botadmin-flow-lock");
      document.body.classList.remove(styles.flowTouchLockedBody);
      document.documentElement.classList.remove(styles.flowTouchLockedRoot);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      document.body.style.touchAction = previousBodyTouchAction;
      document.documentElement.style.touchAction = previousHtmlTouchAction;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.body.style.height = previousBodyHeight;
      window.scrollTo(0, previousScrollY);
      window.removeEventListener("beforeunload", blockNavigation);
      window.removeEventListener("dragover", blockExternalDrop);
      window.removeEventListener("drop", blockExternalDrop);
      window.removeEventListener("dragstart", preventNativePaletteDrag, { capture: true });
      window.removeEventListener("selectstart", preventNativePaletteDrag, { capture: true });
      window.removeEventListener("touchstart", startFlowTouch, { capture: true });
      window.removeEventListener("touchmove", blockCanvasPullToRefresh, { capture: true });
      window.removeEventListener("touchend", stopFlowTouch, { capture: true });
      window.removeEventListener("touchcancel", stopFlowTouch, { capture: true });
      window.removeEventListener("pointerdown", startFlowTouch, { capture: true });
      window.removeEventListener("pointermove", blockCanvasPullToRefresh, { capture: true });
      window.removeEventListener("pointerup", stopFlowTouch, { capture: true });
      window.removeEventListener("pointercancel", stopFlowTouch, { capture: true });
      document.removeEventListener("touchstart", startFlowTouch, { capture: true });
      document.removeEventListener("touchmove", blockCanvasPullToRefresh, { capture: true });
      document.removeEventListener("touchend", stopFlowTouch, { capture: true });
      document.removeEventListener("touchcancel", stopFlowTouch, { capture: true });
      document.removeEventListener("contextmenu", blockEditorContextMenu, { capture: true });
      window.removeEventListener("wheel", blockEditorWheel, { capture: true });
      window.removeEventListener("scroll", keepScrollLocked, { capture: true });
      window.removeEventListener("gesturestart", preventEditorGesture, { capture: true });
    };
  }, [isEditorOpen]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const updateFlowField = <K extends keyof BotFlow>(key: K, value: BotFlow[K]) => {
    updateSelectedFlow((flow) => {
      const next = { ...flow, [key]: value };
      if (key === "command") {
        const command = normalizeCommand(String(value));
        next.command = command;
        next.nodes = next.nodes.map((node) =>
          node.kind === "trigger" && resolveFlowTriggerType(next, node) === "command"
            ? { ...node, text: `/${command || "comando"}`, triggerValue: command || "comando" }
            : node,
        );
      }
      if (key === "scope" && value !== "group") next.groupId = null;
      if (key === "instanceId") next.groupId = null;
      return next;
    });
  };

  const startNewFlow = () => {
    const next = makeDraftFlow(preferredInstanceId ?? instances[0]?.id ?? null);
    setDraft(next);
    setSelectedFlowId("draft");
    setSelectedNodeId("trigger");
    setQuickEditorOpen(false);
    lastSavedSnapshotRef.current = "";
    setLastAutoSavedAt(null);
  };

  const openFlow = (flow: BotFlow) => {
    setSelectedFlowId(flow.id);
    setSelectedNodeId("trigger");
    setQuickEditorOpen(false);
    lastSavedSnapshotRef.current = makeFlowSnapshot(flow);
    setLastAutoSavedAt(flow.updatedAt ? new Date(flow.updatedAt) : null);
  };

  const closeEditor = () => {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setSelectedFlowId(null);
    setSelectedNodeId("trigger");
    setQuickEditorOpen(false);
  };

  const addNode = useCallback((kind: BotFlowPaletteKind, positionOverride?: { x: number; y: number }) => {
    const nodeKind: BotFlowNode["kind"] =
      kind === "webhook_trigger" ? "webhook_wait" :
      kind === "smart_delay" ? "delay" :
      kind;
    const isTrigger = nodeKind === "trigger";
    const isWebhookNode = nodeKind === "webhook_wait";
    const id = newId(kind);
    const displayPosition = positionOverride ?? (reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 420, y: 180 });
    const position = toFlowStoredPosition(displayPosition);
    updateSelectedFlow((flow) => {
      const node: BotFlowNode = {
        id,
        kind: nodeKind,
        title: nodeKindLabel(nodeKind),
        x: Math.round(position.x),
        y: Math.round(position.y),
        text: nodeKind === "text" ? "Digite a resposta aqui." : "",
        contentItems: nodeKind === "content"
          ? [{ id: newId("item"), type: "text", text: "Digite a mensagem aqui." }]
          : [],
        headerTitle: nodeKind === "buttons" ? "BotAdmin" : "",
        footerText: "",
        mediaUrl: "",
        mediaType: "image",
        menuMode: nodeKind === "menu" ? "list" : undefined,
        menuInvalidText: nodeKind === "menu" ? "Não entendi sua resposta. Escolha uma das opções do menu." : "",
        menuErrorLimit: nodeKind === "menu" ? 3 : undefined,
        menuOptions: nodeKind === "menu"
          ? [
              { id: newId("menu"), label: "Opção 1", value: "opcao_1", description: "" },
              { id: newId("menu"), label: "Opção 2", value: "opcao_2", description: "" },
            ]
          : [],
        actions: nodeKind === "action" ? [{ id: newId("action"), type: "custom_event", label: "Evento personalizado", key: "evento", value: "fluxo" }] : [],
        delaySeconds: nodeKind === "delay" ? 2 : 0,
        smartDelayMode: nodeKind === "delay" ? "relative" : undefined,
        smartDelayUnit: nodeKind === "delay" ? "seconds" : undefined,
        smartDelayUntil: "",
        randomizerMode: nodeKind === "randomizer" ? "random" : undefined,
        randomizerOptions: nodeKind === "randomizer"
          ? [
              { id: newId("random"), label: "Caminho A", weight: 50 },
              { id: newId("random"), label: "Caminho B", weight: 50 },
            ]
          : [],
        targetFlowId: null,
        targetFlowName: "",
        assistantName: nodeKind === "assistant_gpt" ? "Assistente IA" : "",
        assistantInitialMessage: nodeKind === "assistant_gpt" ? "Um assistente de IA responderá você agora." : "",
        assistantInitialMode: nodeKind === "assistant_gpt" ? "contact" : undefined,
        assistantLanguage: nodeKind === "assistant_gpt" ? "pt-BR" : "",
        assistantTemperature: nodeKind === "assistant_gpt" ? 0.7 : undefined,
        assistantInstructions: "",
        assistantIndividualInstructions: "",
        assistantErrorMessage: nodeKind === "assistant_gpt" ? "Desculpe, não consegui encontrar uma resposta agora." : "",
        assistantModel: nodeKind === "assistant_gpt" ? "gpt-4o-mini" : "",
        assistantContext: "",
        conditionVariable: nodeKind === "condition" ? "args" : undefined,
        conditionOperator: nodeKind === "condition" ? "contains" : undefined,
        conditionValue: nodeKind === "condition" ? "sim" : undefined,
        conditionLogic: nodeKind === "condition" ? "AND" : undefined,
        conditionRules: nodeKind === "condition" ? [{ id: newId("rule"), variable: "args", operator: "contains", value: "sim" }] : [],
        variableName: nodeKind === "set_variable" ? "resposta" : "",
        variableValue: nodeKind === "set_variable" ? "{{args}}" : "",
        variableOperation: nodeKind === "set_variable" ? "set" : undefined,
        captureType: nodeKind === "capture" ? "email" : undefined,
        captureVariable: nodeKind === "capture" ? "email" : "",
        captureFallbackText: "",
        jumpTargetNodeId: "",
        triggerType: isWebhookNode ? "webhook" : isTrigger ? "keyword" : undefined,
        triggerMatchMode: isWebhookNode ? "exact" : isTrigger ? "contains" : undefined,
        triggerValue: isWebhookNode ? newWebhookToken() : isTrigger ? "" : undefined,
        triggerMediaType: isTrigger ? "any" : undefined,
        httpMethod: nodeKind === "http_request" ? "GET" : undefined,
        httpUrl: nodeKind === "http_request" ? "https://api.exemplo.com" : "",
        httpQueryParams: [],
        httpHeaders: [],
        httpBody: "",
        httpTimeoutSeconds: nodeKind === "http_request" ? 10 : undefined,
        httpSaveStatusVariable: nodeKind === "http_request" ? "http_status" : "",
        httpSaveBodyVariable: nodeKind === "http_request" ? "http_body" : "",
        httpResponseMappings: [],
        databaseProvider: nodeKind === "integration" ? "mysql" : undefined,
        databaseOperation: nodeKind === "integration" ? "query" : undefined,
        databaseHost: "",
        databasePort: nodeKind === "integration" ? 3306 : undefined,
        databaseName: "",
        databaseUser: "",
        databasePassword: "",
        databaseSsl: false,
        databaseTable: "",
        databaseQuery: nodeKind === "integration" ? "SELECT * FROM clientes WHERE telefone = ? LIMIT 1" : "",
        databaseValuesJson: nodeKind === "integration" ? "[\"{{numero}}\"]" : "",
        databaseSaveResultVariable: nodeKind === "integration" ? "db_resultado" : "",
        databaseResponseMappings: [],
        webhookResponseMappings: [],
        buttons: nodeKind === "buttons" ? [{ id: newId("btn"), type: "reply", label: "Abrir menu", value: "/menu" }] : [],
      };
      return { ...flow, nodes: [...flow.nodes, node] };
    });
    setSelectedNodeId(id);
    setMobilePaletteOpen(false);
  }, [reactFlowInstance, updateSelectedFlow]);

    const handlePalettePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, kind: BotFlowPaletteKind) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.pointerType !== "mouse") event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Alguns navegadores mobile cancelam a captura se o toque virou gesto nativo.
      }
      paletteDragActiveRef.current = true;
      flowTouchActiveRef.current = true;
      flowConnectionTouchActiveRef.current = false;
      document.body.classList.add(styles.flowConnectionDraggingBody);
      touchDragRef.current = {
        kind,
        pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    skipPaletteClickRef.current = false;
  };

  const handlePaletteClick = (event: MouseEvent<HTMLButtonElement>, kind: BotFlowPaletteKind) => {
    if (skipPaletteClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      skipPaletteClickRef.current = false;
      return;
    }
    addNode(kind);
  };

    useEffect(() => {
      if (!isEditorOpen) return;
      const handlePointerMove = (event: PointerEvent) => {
        const current = touchDragRef.current;
        if (!current || current.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
        current.x = event.clientX;
        current.y = event.clientY;
        current.moved = current.moved || distance > 8;
        if (current.moved) {
          skipPaletteClickRef.current = true;
          setTouchDragPreview({ kind: current.kind, x: event.clientX, y: event.clientY });
        }
      };
	    const handlePointerUp = (event: PointerEvent) => {
        const current = touchDragRef.current;
        if (!current || current.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
	        touchDragRef.current = null;
        paletteDragActiveRef.current = false;
	        flowTouchActiveRef.current = false;
        flowConnectionTouchActiveRef.current = false;
        document.body.classList.remove(styles.flowConnectionDraggingBody);
        setTouchDragPreview(null);
        if (!current.moved) {
          if (event.pointerType !== "mouse") {
            skipPaletteClickRef.current = true;
            window.setTimeout(() => {
              skipPaletteClickRef.current = false;
            }, 250);
            addNode(current.kind);
          }
          return;
        }
      skipPaletteClickRef.current = true;
      window.setTimeout(() => {
        skipPaletteClickRef.current = false;
      }, 250);
      const canvasRect = canvasPanelRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const isInside =
        event.clientX >= canvasRect.left &&
        event.clientX <= canvasRect.right &&
        event.clientY >= canvasRect.top &&
        event.clientY <= canvasRect.bottom;
      if (!isInside) return;
      const position = reactFlowInstance
        ? reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : { x: event.clientX, y: event.clientY };
        addNode(current.kind, position);
      };
      window.addEventListener("pointermove", handlePointerMove, { passive: false, capture: true });
      window.addEventListener("pointerup", handlePointerUp, { passive: false, capture: true });
      window.addEventListener("pointercancel", handlePointerUp, { passive: false, capture: true });
      return () => {
        document.body.classList.remove(styles.flowConnectionDraggingBody);
        window.removeEventListener("pointermove", handlePointerMove, { capture: true });
        window.removeEventListener("pointerup", handlePointerUp, { capture: true });
        window.removeEventListener("pointercancel", handlePointerUp, { capture: true });
      };
    }, [addNode, isEditorOpen, reactFlowInstance]);

  const handleCanvasDragOver = (event: DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("application/botadmin-flow-node")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

    const handleCanvasDrop = (event: DragEvent<HTMLElement>) => {
      const kind = event.dataTransfer.getData("application/botadmin-flow-node") as BotFlowPaletteKind;
      if (!kind) return;
      event.preventDefault();
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : { x: event.clientX, y: event.clientY };
      addNode(kind, position);
    };

    const blockPaletteNativeDrag = (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
    };

  const removeNode = useCallback(
    (nodeId: string) => {
      if (nodeId === "trigger") return;
      const nextSelection = "trigger";
      updateSelectedFlow((flow) => ({
        ...flow,
        nodes: flow.nodes.filter((node) => node.id !== nodeId),
        edges: flow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
      }));
      setSelectedNodeId(nextSelection);
      setQuickEditorOpen(false);
    },
    [updateSelectedFlow],
  );

  const removeEdge = useCallback(
    (edgeId: string) => {
      updateSelectedFlow((flow) => ({ ...flow, edges: flow.edges.filter((edge) => edge.id !== edgeId) }));
    },
    [updateSelectedFlow],
  );

  const updateButtonInNode = (nodeId: string, buttonId: string, updater: (button: BotFlowButton) => BotFlowButton) => {
    updateNode(nodeId, (node) => ({
      ...node,
      buttons: normalizeFlowButtons((node.buttons ?? []).map((button) => (button.id === buttonId ? updater(button) : button))),
    }));
  };

  const uploadNodeMedia = useCallback(
    async (nodeId: string, file: File) => {
      const targetNode = selectedFlow.nodes.find((node) => node.id === nodeId);
      const inferredType = inferMediaTypeFromFile(file);
      if (targetNode?.kind === "buttons" && inferredType === "audio") {
        setFeedback({ ok: false, text: "Header de botões aceita imagem, vídeo ou documento." });
        return;
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/bot-flows/upload", { method: "POST", body: formData });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message || "Não foi possível enviar a mídia.");
        const media = payload?.media as { url?: string; mediaType?: BotFlowNode["mediaType"] } | undefined;
        if (!media?.url) throw new Error("Upload concluído sem URL da mídia.");
        updateNode(nodeId, (node) => ({ ...node, mediaUrl: media.url, mediaType: media.mediaType ?? inferredType }));
      } catch (error) {
        setFeedback({ ok: false, text: error instanceof Error ? error.message : "Não foi possível enviar a mídia." });
      }
    },
    [selectedFlow.nodes, updateNode],
  );

  const addButtonToNode = useCallback((nodeId: string) => {
    updateNode(nodeId, (node) => ({
      ...node,
      buttons: normalizeFlowButtons(
        (node.buttons ?? []).some((button) => button.type === "url" || button.type === "call" || button.type === "copy")
          ? node.buttons ?? []
          : [
              ...(node.buttons ?? []).filter((button) => button.type === "reply"),
              { id: newId("btn"), type: "reply" as const, label: `Botão ${(node.buttons ?? []).length + 1}`, value: "/menu" },
            ],
      ),
    }));
  }, [updateNode]);

  const addButton = () => {
    if (!selectedNode) return;
    addButtonToNode(selectedNode.id);
  };

  const removeButtonFromNode = useCallback((nodeId: string, buttonId: string) => {
    updateSelectedFlow((flow) => ({
      ...flow,
      nodes: flow.nodes.map((node) =>
        node.id === nodeId ? { ...node, buttons: (node.buttons ?? []).filter((button) => button.id !== buttonId) } : node,
      ),
      edges: flow.edges.filter((edge) => !(edge.from === nodeId && edge.branch === buttonBranchId(buttonId))),
    }));
  }, [updateSelectedFlow]);

  const persistFlow = useCallback(async (flowToSave: BotFlow, mode: "manual" | "auto" = "manual") => {
    if (saveInFlightRef.current) {
      pendingSaveRef.current = true;
      return null;
    }
    saveInFlightRef.current = true;
    if (mode === "manual") setSaving(true);
    if (mode === "auto") setAutoSaving(true);
    try {
      const scopedFlowToSave = applyActiveProfileToFlow(flowToSave);
      const payload = buildFlowSavePayload(scopedFlowToSave);
      const submittedSnapshot = makeFlowSnapshot(scopedFlowToSave);
      const endpoint = scopedFlowToSave.id > 0 ? `/api/bot-flows/${scopedFlowToSave.id}` : "/api/bot-flows";
      const response = await fetch(endpoint, {
        method: scopedFlowToSave.id > 0 ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const current = result?.flow as BotFlow | undefined;
        if (response.status === 409 && current?.id) {
          pendingSaveRef.current = false;
          setFlows((existingFlows) => existingFlows.map((flow) => (flow.id === current.id ? current : flow)));
          lastSavedSnapshotRef.current = makeFlowSnapshot(current);
          setLastAutoSavedAt(current.updatedAt ? new Date(current.updatedAt) : new Date());
          setFeedback({ ok: true, text: result.message || "Fluxo sincronizado com a versão mais recente." });
          return current;
        }
        throw new Error(result?.message || "Não foi possível salvar o fluxo.");
      }
      const nextFlows: BotFlow[] = Array.isArray(result.flows) ? result.flows : [];
      const saved = result.flow as BotFlow | undefined;
      if (saved?.id) {
        const latest = latestFlowRef.current;
        const latestHasNewerChanges =
          latest &&
          (latest.id === scopedFlowToSave.id || scopedFlowToSave.id === 0) &&
          makeFlowSnapshot(latest) !== submittedSnapshot;
        const flowForState = latestHasNewerChanges
          ? {
              ...latest,
              id: saved.id,
              userId: saved.userId,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
              revision: saved.revision,
            }
          : saved;
        setFlows((current) => {
          const source = nextFlows.length ? nextFlows : current;
          const exists = source.some((flow) => flow.id === saved.id);
          const merged = source.map((flow) => (flow.id === saved.id ? flowForState : flow));
          return exists ? merged : [flowForState, ...merged];
        });
        setSelectedFlowId(saved.id);
        setSelectedNodeId((current) => (flowForState.nodes.some((node) => node.id === current) ? current : "trigger"));
        lastSavedSnapshotRef.current = submittedSnapshot;
        setLastAutoSavedAt(new Date());
        if (latestHasNewerChanges) pendingSaveRef.current = true;
      }
      if (mode === "manual") setFeedback({ ok: true, text: result.message || "Fluxo salvo com sucesso." });
      return saved ?? null;
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Não foi possível salvar o fluxo." });
      return null;
    } finally {
      saveInFlightRef.current = false;
      if (mode === "manual") setSaving(false);
      if (mode === "auto") setAutoSaving(false);
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        window.setTimeout(() => {
          const latest = latestFlowRef.current;
          if (!latest || makeFlowSnapshot(latest) === lastSavedSnapshotRef.current) return;
          void persistFlow(latest, "auto");
        }, 350);
      }
    }
  }, [applyActiveProfileToFlow]);

  const saveFlow = async () => {
    await persistFlow(selectedFlow, "manual");
  };

  const queueAutoSave = useCallback(
    (delay = 1200) => {
      if (!isEditorOpen || loading) return;
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => {
        autoSaveTimerRef.current = null;
        const latest = latestFlowRef.current;
        if (!latest) return;
        if (makeFlowSnapshot(latest) === lastSavedSnapshotRef.current) return;
        void persistFlow(latest, "auto");
      }, delay);
    },
    [isEditorOpen, loading, persistFlow],
  );

  useEffect(() => {
    if (!isEditorOpen || loading) return;
    if (nodeDragActiveRef.current || connectionDragRef.current) return;
    const snapshot = makeFlowSnapshot(selectedFlow);
    if (snapshot === lastSavedSnapshotRef.current) return;
    queueAutoSave(1200);
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [isEditorOpen, loading, queueAutoSave, selectedFlow]);

  const deleteFlowById = async (flowId: number) => {
    if (!flowId || !window.confirm("Remover este fluxo?")) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/bot-flows/${flowId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await parseError(response));
      const result = await response.json();
      const nextFlows: BotFlow[] = Array.isArray(result.flows) ? result.flows : [];
      setFlows(nextFlows);
      if (selectedFlowId === flowId) setSelectedFlowId(null);
      setFeedback({ ok: true, text: result.message || "Fluxo removido." });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Não foi possível remover o fluxo." });
    } finally {
      setSaving(false);
    }
  };

  const deleteFlow = async () => {
    if (!selectedFlow.id) {
      startNewFlow();
      return;
    }
    await deleteFlowById(selectedFlow.id);
  };

  const shareFlowById = async (flowId?: number) => {
    let targetId = flowId && flowId > 0 ? flowId : selectedFlow.id > 0 ? selectedFlow.id : 0;
    if (!targetId) {
      const saved = await persistFlow(selectedFlow, "manual");
      targetId = saved?.id ?? 0;
    }
    if (!targetId) return;
    setSharingFlowId(targetId);
    try {
      const response = await fetch(`/api/bot-flows/${targetId}/share`, { method: "POST" });
      if (!response.ok) throw new Error(await parseError(response));
      const result = await response.json();
      const url = String(result?.share?.url || result?.url || "");
      if (!url) throw new Error("Link de compartilhamento não retornado.");
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      setFeedback({ ok: true, text: "Link do fluxo copiado. Ele pode ser importado por outro usuário do BotAdmin." });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Não foi possível compartilhar o fluxo." });
    } finally {
      setSharingFlowId(null);
    }
  };

  const importSharedFlow = async () => {
    const input = importText.trim();
    if (!input) {
      setFeedback({ ok: false, text: "Cole um link, código ou JSON de fluxo para importar." });
      return;
    }
    setImporting(true);
    try {
      const response = await fetch("/api/bot-flows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          botconversaAuthorization: importAuth.trim() || undefined,
          name: importName.trim() || undefined,
          command: normalizeCommand(importCommand),
        }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      const result = await response.json();
      const nextFlows: BotFlow[] = Array.isArray(result.flows) ? result.flows : [];
      const imported = result.flow as BotFlow | undefined;
      if (nextFlows.length) setFlows(nextFlows);
      if (imported?.id) {
        if (!nextFlows.length) {
          setFlows((current) => [imported, ...current.filter((flow) => flow.id !== imported.id)]);
        }
        openFlow(imported);
      }
      setImportModalOpen(false);
      setImportText("");
      setImportAuth("");
      setImportName("");
      setImportCommand("");
      const warnings = Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [];
      setFeedback({
        ok: true,
        text: warnings.length
          ? `Fluxo importado. Revise os avisos: ${warnings.slice(0, 2).join(" ")}`
          : result.message || "Fluxo importado com sucesso.",
      });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "Não foi possível importar o fluxo." });
    } finally {
      setImporting(false);
    }
  };

  const connectFlowNodes = useCallback(
    (source: string, target: string, branch: BotFlowEdge["branch"] = "default", label = "") => {
      if (!source || !target || source === target) return;
      updateSelectedFlow((flow) => {
        const currentEdges: Edge<FlowEdgeData>[] = flow.edges.map((edge) => ({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: edge.branch || "default",
          targetHandle: "in",
          data: { label: edge.label ?? "", onRemove: removeEdge },
        }));
        const nextEdges = addEdge(
          {
            id: newId("edge"),
            source,
            target,
            sourceHandle: branch || "default",
            targetHandle: "in",
            type: "botFlowEdge",
            data: { label, onRemove: removeEdge },
          },
          currentEdges.filter((edge) => {
            const currentBranch = (edge.sourceHandle as BotFlowEdge["branch"]) || "default";
            return !(edge.source === source && currentBranch === branch);
          }),
        );
        return {
          ...flow,
          edges: nextEdges.map((edge) => ({
            id: edge.id,
            from: edge.source,
            to: edge.target,
            branch: (edge.sourceHandle as BotFlowEdge["branch"]) || "default",
            label: edge.data?.label ?? "",
          })),
        };
      });
    },
    [removeEdge, updateSelectedFlow],
  );

  const findConnectionTarget = useCallback(
    (clientX: number, clientY: number, sourceId: string) => {
      const directTarget = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-flow-node-id]")
        ?.dataset.flowNodeId;
      if (directTarget && directTarget !== sourceId) return directTarget;

      if (!reactFlowInstance) return null;
      const flowPoint = reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY });
      let best: { id: string; distance: number } | null = null;
      for (const node of selectedFlow.nodes) {
        if (node.id === sourceId) continue;
        const displayPosition = toFlowDisplayPosition(node);
        const width = node.kind === "buttons" || node.kind === "menu" || node.kind === "randomizer" ? 402 : node.kind === "http_request" ? 360 : 320;
        const height = estimateNodeHeight(node);
        const targetX = displayPosition.x;
        const targetY = displayPosition.y + height / 2;
        const insideExpandedBox =
          flowPoint.x >= displayPosition.x - 96 &&
          flowPoint.x <= displayPosition.x + width + 72 &&
          flowPoint.y >= displayPosition.y - 72 &&
          flowPoint.y <= displayPosition.y + height + 72;
        const distance = Math.hypot(flowPoint.x - targetX, flowPoint.y - targetY);
        if (!insideExpandedBox && distance > 140) continue;
        if (!best || distance < best.distance) best = { id: node.id, distance };
      }
      return best?.id ?? null;
    },
    [reactFlowInstance, selectedFlow.nodes],
  );

  const startConnectionDrag = useCallback((connection: TouchConnectionDraft, point: { x: number; y: number }) => {
    const draft = {
      ...connection,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    };
    connectionDragRef.current = draft;
    setConnectionDrag(draft);
  }, []);

  useEffect(() => {
    if (!connectionDragActive) return;
    document.body.classList.add(styles.flowConnectionDraggingBody);

    const moveConnection = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const current = connectionDragRef.current;
      if (!current) return;
      const next = { ...current, currentX: event.clientX, currentY: event.clientY };
      connectionDragRef.current = next;
      if (connectionDragFrameRef.current !== null) return;
      connectionDragFrameRef.current = window.requestAnimationFrame(() => {
        connectionDragFrameRef.current = null;
        const latest = connectionDragRef.current;
        if (latest) setConnectionDrag(latest);
      });
    };

    const finishConnection = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const current = connectionDragRef.current;
      if (!current) return;
      const targetId = findConnectionTarget(event.clientX, event.clientY, current.source);
      if (targetId) connectFlowNodes(current.source, targetId, current.branch, current.label ?? "");
      if (connectionDragFrameRef.current !== null) {
        window.cancelAnimationFrame(connectionDragFrameRef.current);
        connectionDragFrameRef.current = null;
      }
      connectionDragRef.current = null;
      setConnectionDrag(null);
    };

    const cancelConnection = () => {
      if (connectionDragFrameRef.current !== null) {
        window.cancelAnimationFrame(connectionDragFrameRef.current);
        connectionDragFrameRef.current = null;
      }
      connectionDragRef.current = null;
      setConnectionDrag(null);
    };

    window.addEventListener("pointermove", moveConnection, { passive: false, capture: true });
    window.addEventListener("pointerup", finishConnection, { passive: false, capture: true });
    window.addEventListener("pointercancel", cancelConnection, { capture: true });
    return () => {
      document.body.classList.remove(styles.flowConnectionDraggingBody);
      window.removeEventListener("pointermove", moveConnection, { capture: true });
      window.removeEventListener("pointerup", finishConnection, { capture: true });
      window.removeEventListener("pointercancel", cancelConnection, { capture: true });
    };
  }, [connectFlowNodes, connectionDragActive, findConnectionTarget]);

  const finishTouchConnection = useCallback(
    (targetId: string) => {
      if (!touchConnection || touchConnection.source === targetId) return;
      connectFlowNodes(touchConnection.source, targetId, touchConnection.branch, touchConnection.label ?? "");
      setTouchConnection(null);
    },
    [connectFlowNodes, touchConnection],
  );

  const flowNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      selectedFlow.nodes.map((node) => ({
        id: node.id,
        type: "botFlowNode",
        position: toFlowDisplayPosition(node),
        initialWidth: node.kind === "buttons" || node.kind === "menu" || node.kind === "randomizer" ? 402 : node.kind === "http_request" ? 360 : 320,
        initialHeight: estimateNodeHeight(node),
        data: {
          flow: selectedFlow,
          flowNode: node,
          selected: selectedNodeId === node.id,
          touchConnectEnabled,
          touchConnection,
          onSelect: selectNodeForEdit,
          onRemove: removeNode,
          onAddButton: addButtonToNode,
          onEditButton: (nodeId, buttonId) => setButtonEditor({ nodeId, buttonId }),
          onEditField: (nodeId, field) => setFieldEditor({ nodeId, field }),
          onRemoveButton: removeButtonFromNode,
          onStartTouchConnection: setTouchConnection,
          onStartConnectionDrag: startConnectionDrag,
          onFinishTouchConnection: finishTouchConnection,
          onUploadMedia: uploadNodeMedia,
          onClearMedia: (nodeId) => updateNode(nodeId, (node) => ({ ...node, mediaUrl: "", mediaType: "image" })),
        },
        dragHandle: `.${styles.flowNodeHeader}`,
      })),
    [addButtonToNode, finishTouchConnection, removeButtonFromNode, removeNode, selectNodeForEdit, selectedFlow, selectedFlow.nodes, selectedNodeId, startConnectionDrag, touchConnectEnabled, touchConnection, updateNode, uploadNodeMedia],
  );

  useEffect(() => {
    if (nodeDragActiveRef.current) return;
    const currentNodes = canvasNodesRef.current;
    const incomingPositionSignature = canvasNodePositionSignature(flowNodes);
    const currentPositionSignature = canvasNodePositionSignature(currentNodes);
    const sameNodes = currentNodes.length > 0 && canvasNodeIdsSignature(currentNodes) === canvasNodeIdsSignature(flowNodes);
    const hasLocalPositionActivity =
      nodeDragActiveRef.current ||
      saveInFlightRef.current ||
      pendingSaveRef.current ||
      autoSaveTimerRef.current !== null;
    const incomingLooksStale =
      hasLocalPositionActivity &&
      sameNodes &&
      currentPositionSignature === lastCommittedPositionSignatureRef.current &&
      incomingPositionSignature !== lastCommittedPositionSignatureRef.current;
    const currentPositionById = new Map(currentNodes.map((node) => [node.id, node.position]));
    const nextNodes = incomingLooksStale
      ? flowNodes.map((node) => ({
          ...node,
          position: currentPositionById.get(node.id) ?? node.position,
        }))
      : flowNodes;
    canvasNodesRef.current = nextNodes;
    if (!incomingLooksStale) lastCommittedPositionSignatureRef.current = incomingPositionSignature;
    setCanvasNodes(nextNodes);
  }, [flowNodes]);

  const commitCanvasNodePositions = useCallback(
    (nodesSnapshot: Node<FlowNodeData>[] = canvasNodesRef.current) => {
      const signature = canvasNodePositionSignature(nodesSnapshot);
      if (signature === lastCommittedPositionSignatureRef.current) return;
      lastCommittedPositionSignatureRef.current = signature;
      const positions = new Map(nodesSnapshot.map((node) => [node.id, node.position]));
      updateSelectedFlow((flow) => ({
        ...flow,
        nodes: flow.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return node;
          const storedPosition = toFlowStoredPosition(position);
          return { ...node, x: Math.round(storedPosition.x), y: Math.round(storedPosition.y) };
        }),
      }));
    },
    [updateSelectedFlow],
  );

  const flowEdges = useMemo<Edge<FlowEdgeData>[]>(
    () =>
      selectedFlow.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        sourceHandle: edge.branch || "default",
        targetHandle: "in",
        type: "botFlowEdge",
        animated: false,
        data: {
          label: flowEdgeLabel(edge),
          onRemove: removeEdge,
        },
        className: flowEdgeClassName(edge.branch, styles.edgeFalse, styles.edgeTrue, styles.edgeDefault),
      })),
    [removeEdge, selectedFlow.edges],
  );

  const measureRenderedEdges = useCallback(() => {
    if (!isEditorOpen) {
      if (renderedEdgesSignatureRef.current) {
        renderedEdgesSignatureRef.current = "";
        setRenderedEdges([]);
      }
      return;
    }
    const escapeSelector = (value: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&"));
    const stageRect = builderStageRef.current?.getBoundingClientRect();
    if (!stageRect) return;
    const nextEdges = selectedFlow.edges.flatMap((edge) => {
      const sourceHandle = edge.branch || "default";
      const source = document.querySelector<HTMLElement>(
        `.react-flow__handle[data-nodeid="${escapeSelector(edge.from)}"][data-handleid="${escapeSelector(sourceHandle)}"]`,
      );
      const target = document.querySelector<HTMLElement>(
        `.react-flow__handle[data-nodeid="${escapeSelector(edge.to)}"][data-handleid="in"]`,
      );
      const sourceNode = document.querySelector<HTMLElement>(`[data-flow-node-id="${escapeSelector(edge.from)}"]`);
      const targetNode = document.querySelector<HTMLElement>(`[data-flow-node-id="${escapeSelector(edge.to)}"]`);
      if (!source || !target || !sourceNode || !targetNode) return [];
      const sourceFlowNode = selectedFlow.nodes.find((node) => node.id === edge.from);
      const targetFlowNode = selectedFlow.nodes.find((node) => node.id === edge.to);
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const sourceX = sourceRect.left + sourceRect.width / 2 - stageRect.left;
      const sourceY = sourceRect.top + sourceRect.height / 2 - stageRect.top;
      const targetX = targetRect.left + targetRect.width / 2 - stageRect.left;
      const targetY = targetRect.top + targetRect.height / 2 - stageRect.top;
      const measured = buildMeasuredEdgePath({
        sourceX,
        sourceY,
        targetX,
        targetY,
      });
      return [
        {
          id: edge.id,
          label: resolveFlowEdgeLabel(edge, sourceFlowNode, targetFlowNode, selectedFlow),
          path: measured.path,
          labelPath: measured.labelPath,
          pathId: `measured-flow-edge-${edge.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
          labelPathId: `measured-flow-edge-label-${edge.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
          labelX: measured.labelX,
          labelY: measured.labelY,
          deleteX: measured.deleteX,
          deleteY: measured.deleteY,
          className: flowEdgeClassName(edge.branch, styles.measuredEdgeFalse, styles.measuredEdgeTrue, styles.measuredEdgeDefault),
          labelClassName: flowEdgeClassName(edge.branch, styles.measuredEdgeTextFalse, styles.measuredEdgeTextTrue, styles.measuredEdgeTextDefault),
        },
      ];
    });
    const signature = nextEdges
      .map(
        (edge) =>
          `${edge.id}:${edge.path}:${Math.round(edge.labelX)}:${Math.round(edge.labelY)}:${edge.label}:${edge.className}:${edge.labelClassName}`,
      )
      .join("|");
    if (signature === renderedEdgesSignatureRef.current) return;
    renderedEdgesSignatureRef.current = signature;
    setRenderedEdges(nextEdges);
  }, [isEditorOpen, selectedFlow]);

  const scheduleMeasureRenderedEdges = useCallback(() => {
    if (measureEdgesFrameRef.current !== null) return;
    measureEdgesFrameRef.current = window.requestAnimationFrame(() => {
      measureEdgesFrameRef.current = null;
      measureRenderedEdges();
    });
  }, [measureRenderedEdges]);

  useEffect(() => {
    scheduleMeasureRenderedEdgesRef.current = scheduleMeasureRenderedEdges;
  }, [scheduleMeasureRenderedEdges]);

  useEffect(() => {
    if (!isEditorOpen || !reactFlowInstance || selectedFlow.id <= 0) return;
    if (lastFittedFlowIdRef.current === selectedFlow.id) return;
    lastFittedFlowIdRef.current = selectedFlow.id;
    window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({
        padding: window.innerWidth <= 760 ? 0.24 : 0.2,
        duration: 0,
        includeHiddenNodes: false,
        maxZoom: window.innerWidth <= 760 ? 0.72 : 0.58,
      });
      window.setTimeout(() => scheduleMeasureRenderedEdgesRef.current(), 80);
      window.setTimeout(() => scheduleMeasureRenderedEdgesRef.current(), 260);
    });
  }, [isEditorOpen, reactFlowInstance, selectedFlow.id]);

  useEffect(() => {
    if (!isEditorOpen) {
      if (renderedEdgesSignatureRef.current) {
        renderedEdgesSignatureRef.current = "";
        setRenderedEdges([]);
      }
      return;
    }
    measureRenderedEdges();
    const frame = window.requestAnimationFrame(measureRenderedEdges);
    const timer = window.setTimeout(measureRenderedEdges, 350);
    const lateTimer = window.setTimeout(measureRenderedEdges, 1000);
    window.addEventListener("resize", scheduleMeasureRenderedEdges);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.clearTimeout(lateTimer);
      window.removeEventListener("resize", scheduleMeasureRenderedEdges);
      if (measureEdgesFrameRef.current !== null) {
        window.cancelAnimationFrame(measureEdgesFrameRef.current);
        measureEdgesFrameRef.current = null;
      }
    };
  }, [isEditorOpen, measureRenderedEdges, nodeHandleSignature, scheduleMeasureRenderedEdges]);

  const onNodesChange: OnNodesChange<Node<FlowNodeData>> = useCallback(
    (changes) => {
      const removedNodeIds = new Set<string>();
      changes.forEach((change) => {
        if (change.type === "remove" && "id" in change && change.id !== "trigger") {
          removedNodeIds.add(change.id);
        }
      });
      if (removedNodeIds.has(selectedNodeId)) {
        setSelectedNodeId("trigger");
      }
      const safeChanges = changes.filter((change) => !(change.type === "remove" && "id" in change && change.id === "trigger"));
      const source = canvasNodesRef.current.length ? canvasNodesRef.current : flowNodes;
      const updatedNodes = applyNodeChanges(safeChanges, source);
      canvasNodesRef.current = updatedNodes;
      setCanvasNodes(updatedNodes);
      if (removedNodeIds.size > 0) {
        updateSelectedFlow((flow) => ({
          ...flow,
          nodes: flow.nodes.filter((node) => !removedNodeIds.has(node.id)),
          edges: flow.edges.filter((edge) => !removedNodeIds.has(edge.from) && !removedNodeIds.has(edge.to)),
        }));
      }
      const hasFinalPosition = safeChanges.some((change) => change.type === "position" && change.dragging === false);
      if (hasFinalPosition) {
        dragPositionCommittedRef.current = true;
        commitCanvasNodePositions(updatedNodes);
      }
      scheduleMeasureRenderedEdges();
    },
    [commitCanvasNodePositions, flowNodes, scheduleMeasureRenderedEdges, selectedNodeId, updateSelectedFlow],
  );

  const onEdgesChange: OnEdgesChange<Edge<FlowEdgeData>> = useCallback(
    (changes) => {
      const updated = applyEdgeChanges(changes, flowEdges);
      updateSelectedFlow((flow) => ({
        ...flow,
        edges: updated.map((edge) => ({
          id: edge.id,
          from: edge.source,
          to: edge.target,
          branch: (edge.sourceHandle as BotFlowEdge["branch"]) || "default",
          label: edge.data?.label ?? "",
        })),
      }));
    },
    [flowEdges, updateSelectedFlow],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const branch = (connection.sourceHandle as BotFlowEdge["branch"]) || "default";
      const sourceNode = selectedFlow.nodes.find((node) => node.id === connection.source);
      const sourceButton =
        branch?.startsWith("button:") && sourceNode?.kind === "buttons"
          ? (sourceNode.buttons ?? []).find((button) => buttonBranchId(button.id) === branch)
          : null;
      const sourceMenuOption =
        branch?.startsWith("menu:") && sourceNode?.kind === "menu"
          ? (sourceNode.menuOptions ?? []).find((option) => menuBranchId(option.id) === branch)
          : null;
      const sourceRandomOption =
        branch?.startsWith("random:") && sourceNode?.kind === "randomizer"
          ? (sourceNode.randomizerOptions ?? []).find((option) => randomBranchId(option.id) === branch)
          : null;
      const label = branch === "true" ? "Sim" : branch === "false" ? "Não" : sourceButton?.label ?? sourceMenuOption?.label ?? sourceRandomOption?.label ?? "";
      connectFlowNodes(connection.source, connection.target, branch, label);
    },
    [connectFlowNodes, selectedFlow.nodes],
  );

  if (!isEditorOpen) {
    return (
      <div className={classNames(styles.flowShell, styles.flowHome)}>
        <div className={styles.flowHomeTopbar}>
          <button type="button" className={styles.homeBackButton} onClick={onExit}>
            <IconArrowLeft size={18} /> Voltar
          </button>
          <div className={styles.flowHomeActions}>
            <button type="button" className={styles.ghostButton} onClick={() => setImportModalOpen(true)}>
              <IconFileImport size={17} /> Importar
            </button>
            <button type="button" className={styles.primaryButton} onClick={startNewFlow}>
              <IconPlus size={17} /> Criar fluxo
            </button>
          </div>
        </div>
        {feedback ? <p className={classNames(styles.feedback, feedback.ok ? styles.feedbackOk : styles.feedbackError)}>{feedback.text}</p> : null}
        <section className={styles.flowGallery} aria-label="Fluxos criados">
          <div className={styles.galleryHeader}>
            <div>
              <h3>Meus fluxos</h3>
              <small>{loading ? "Carregando..." : `${flows.length} fluxo(s) criado(s)`}</small>
            </div>
          </div>
          <div className={styles.flowGrid}>
            {flows.map((flow) => (
              <article key={flow.id} className={styles.flowCard} onClick={() => openFlow(flow)} role="button" tabIndex={0}>
                <div className={styles.flowCardActions}>
                  <button
                    type="button"
                    className={styles.flowCardIconButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      void shareFlowById(flow.id);
                    }}
                    title="Compartilhar fluxo"
                    disabled={sharingFlowId === flow.id}
                  >
                    <IconShare2 size={15} />
                  </button>
                  <button
                    type="button"
                    className={classNames(styles.flowCardIconButton, styles.flowCardDangerButton)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteFlowById(flow.id);
                    }}
                    title="Excluir fluxo"
                    disabled={saving}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
                <span className={classNames(styles.badge, flow.enabled ? styles.badgeOn : styles.badgeOff)}>{flow.enabled ? "Ativo" : "Desativado"}</span>
                <strong>{flow.name}</strong>
                <span className={styles.flowCommand}>/{flow.command}</span>
                <span className={styles.flowCardMeta}>
                  <span>{renderScopeLabel(flow)}</span>
                  <span>{flow.nodes.length} blocos</span>
                </span>
              </article>
            ))}
            {!loading ? (
              <button type="button" className={classNames(styles.flowCard, styles.flowCardNew)} onClick={startNewFlow}>
                <span className={styles.newFlowIcon}><IconPlus size={24} /></span>
                <strong>Novo fluxo</strong>
                <span>Comece um comando visual do zero</span>
              </button>
            ) : null}
          </div>
          {flows.length === 0 && !loading ? <div className={styles.empty}>Nenhum fluxo criado ainda. Use o botão Criar fluxo para começar.</div> : null}
        </section>
      </div>
    );
  }

  return (
    <div className={classNames(styles.flowShell, styles.flowEditor)}>
      <header className={styles.editorTopbar}>
        <button type="button" className={styles.backButton} onClick={closeEditor}>
          <IconArrowLeft size={18} /> Voltar
        </button>
        <div className={styles.editorTitle}>
          <strong>{selectedFlow.name || "Novo fluxo"}</strong>
          <span>/{selectedFlow.command || "comando"}</span>
        </div>
        <div className={styles.editorTopbarActions}>
          <span className={styles.autoSaveStatus}>
            {autoSaving
              ? "Salvando automaticamente..."
              : lastAutoSavedAt
                ? `Salvo ${lastAutoSavedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                : "Autosave ativo"}
          </span>
          <button type="button" className={styles.ghostButton} onClick={() => setSimulatorOpen(true)}>
            <IconPlayerPlay size={16} /> Play
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => void shareFlowById()} disabled={sharingFlowId !== null || saving}>
            <IconShare2 size={16} /> Compartilhar
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setFlowConfigOpen(true)}>
            <IconSettings size={16} /> Configuração
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => void saveFlow()} disabled={saving}>
            {saving ? <IconClock size={16} /> : <IconDeviceFloppy size={16} />}
            {saving ? "Salvando..." : "Salvar fluxo"}
          </button>
        </div>
      </header>
      {feedback ? <p className={classNames(styles.feedback, feedback.ok ? styles.feedbackOk : styles.feedbackError)}>{feedback.text}</p> : null}
      <div ref={builderStageRef} className={styles.builderStage}>
        <button
          type="button"
          className={styles.mobilePaletteToggle}
          onClick={() => setMobilePaletteOpen((current) => !current)}
          aria-expanded={mobilePaletteOpen}
          aria-controls="flow-node-palette"
        >
          <IconMenu2 size={16} /> Blocos
        </button>
        {mobilePaletteOpen ? (
          <button
            type="button"
            className={styles.mobilePaletteBackdrop}
            onClick={() => setMobilePaletteOpen(false)}
            aria-label="Fechar menu de blocos"
          />
        ) : null}
        <aside
          id="flow-node-palette"
          className={classNames(styles.nodePalette, mobilePaletteOpen && styles.nodePaletteOpen)}
          aria-label="Adicionar blocos"
          onDragStart={blockPaletteNativeDrag}
          onPointerEnter={scheduleMeasureRenderedEdges}
          onPointerLeave={scheduleMeasureRenderedEdges}
          onTransitionEnd={scheduleMeasureRenderedEdges}
          onFocus={scheduleMeasureRenderedEdges}
          onBlur={scheduleMeasureRenderedEdges}
        >
          {FLOW_PALETTE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              draggable={false}
              className={styles.nodeTypeButton}
              onPointerDown={(event) => handlePalettePointerDown(event, kind)}
              onClick={(event) => handlePaletteClick(event, kind)}
            >
              {nodeIcon(kind, 16)} {nodeKindLabel(kind)}
            </button>
          ))}
        </aside>
        <section ref={canvasPanelRef} className={styles.canvasPanel} onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}>
          <ReactFlow<Node<FlowNodeData>, Edge<FlowEdgeData>>
            nodes={canvasNodes.length ? canvasNodes : flowNodes}
            edges={[]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelectedEdgeId(null)}
            onNodeClick={(_event, node) => {
              setSelectedEdgeId(null);
              setSelectedNodeId(node.id);
            }}
            onNodeDragStart={() => {
              nodeDragActiveRef.current = true;
              dragPositionCommittedRef.current = false;
            }}
            onNodeDrag={(_event, node, nodes) => {
              const source = canvasNodesRef.current.length ? canvasNodesRef.current : flowNodes;
              const changedNodes = nodes.length ? nodes : [node];
              const mergedNodes = mergeDraggedCanvasNodes(source, changedNodes);
              canvasNodesRef.current = mergedNodes;
              setCanvasNodes(mergedNodes);
            }}
            onNodeDragStop={(_event, node, nodes) => {
              nodeDragActiveRef.current = false;
              const source = canvasNodesRef.current.length ? canvasNodesRef.current : flowNodes;
              const changedNodes = nodes.length ? nodes : [node];
              const mergedNodes = mergeDraggedCanvasNodes(source, changedNodes);
              canvasNodesRef.current = mergedNodes;
              setCanvasNodes(mergedNodes);
              if (!dragPositionCommittedRef.current) commitCanvasNodePositions(mergedNodes);
              scheduleMeasureRenderedEdges();
              queueAutoSave(450);
            }}
            onMove={scheduleMeasureRenderedEdges}
            onInit={setReactFlowInstance}
            nodesConnectable
            nodesDraggable
            nodeDragThreshold={1}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={52}
            connectOnClick={false}
            preventScrolling
            panOnDrag
            panOnScroll={false}
            zoomOnPinch
            selectionOnDrag={false}
            autoPanOnConnect={false}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            minZoom={0.25}
            maxZoom={1.6}
            deleteKeyCode={["Backspace", "Delete"]}
            className={styles.reactFlowCanvas}
          >
            <Background gap={28} size={1.2} color="#dbe5ef" />
            <Controls position="bottom-left" />
          </ReactFlow>
        </section>
        {renderedEdges.length > 0 ? (
          <>
            <svg className={styles.measuredEdgesLayer} aria-hidden="true">
              {renderedEdges.map((edge) => {
                const edgeActive = hoveredEdgeId === edge.id || selectedEdgeId === edge.id;
                return (
                <g key={edge.id}>
                  <path
                    id={edge.pathId}
                    className={classNames(edge.className, edgeActive && styles.measuredEdgeActive)}
                    d={edge.path}
                  />
                  <path id={edge.labelPathId} className={styles.measuredEdgeLabelGuide} d={edge.labelPath} />
                  <path
                    className={styles.measuredEdgeHitPath}
                    d={edge.path}
                    onMouseEnter={() => setHoveredEdgeId(edge.id)}
                    onMouseLeave={() => setHoveredEdgeId((current) => (current === edge.id ? null : current))}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedEdgeId(edge.id);
                    }}
                  />
                </g>
                );
              })}
              {renderedEdges.map((edge) => (
                edge.label ? (
                  <g key={`${edge.id}-label`}>
                    <text className={styles.measuredEdgeTextStroke}>
                      <textPath href={`#${edge.labelPathId}`} startOffset="50%" textAnchor="middle">
                        {edge.label}
                      </textPath>
                    </text>
                    <text className={classNames(styles.measuredEdgeText, edge.labelClassName)}>
                      <textPath href={`#${edge.labelPathId}`} startOffset="50%" textAnchor="middle">
                        {edge.label}
                      </textPath>
                    </text>
                  </g>
                ) : null
              ))}
            </svg>
            {renderedEdges.map((edge) => (hoveredEdgeId === edge.id || selectedEdgeId === edge.id) ? (
              <button
                key={edge.id}
                type="button"
                className={styles.measuredEdgeDeleteButton}
                style={{ left: edge.deleteX, top: edge.deleteY }}
                onClick={() => removeEdge(edge.id)}
                title="Excluir conexão"
                aria-label="Excluir conexão"
              >
                <IconX size={12} />
              </button>
            ) : null)}
          </>
        ) : null}
        {touchDragPreview ? (
          <div className={styles.touchDragPreview} style={{ left: touchDragPreview.x, top: touchDragPreview.y }}>
            {nodeIcon(touchDragPreview.kind, 16)}
            <span>{nodeKindLabel(touchDragPreview.kind)}</span>
          </div>
        ) : null}
        {connectionDrag ? (
          <svg className={styles.connectionDragLayer} aria-hidden="true">
            <path
              d={`M ${connectionDrag.startX} ${connectionDrag.startY} C ${connectionDrag.startX + 120} ${connectionDrag.startY}, ${connectionDrag.currentX - 120} ${connectionDrag.currentY}, ${connectionDrag.currentX} ${connectionDrag.currentY}`}
            />
            <circle cx={connectionDrag.currentX} cy={connectionDrag.currentY} r="7" />
          </svg>
        ) : null}
      </div>
      {selectedNode && selectedNodeIsEditable ? (
        <QuickNodeEditor
          flow={selectedFlow}
          availableFlows={flows}
          instances={instances}
          groups={groups}
          activeProfileInstanceId={activeProfileInstanceId}
          selectedNode={selectedNode}
          updateFlowField={updateFlowField}
          updateNode={updateNode}
          addButton={addButton}
          removeNode={removeNode}
          onClose={() => {
            setQuickEditorOpen(false);
            setSelectedNodeId("trigger");
          }}
        />
      ) : null}
      {buttonEditor && editingButtonNode && editingButton ? (
        <ButtonQuickEditor
          flow={selectedFlow}
          node={editingButtonNode}
          button={editingButton}
          updateButton={updateButtonInNode}
          removeButton={removeButtonFromNode}
          onClose={() => setButtonEditor(null)}
        />
      ) : null}
      {fieldEditor && editingFieldNode ? (
        <FieldQuickEditor
          flow={selectedFlow}
          node={editingFieldNode}
          field={fieldEditor.field}
          updateNode={updateNode}
          uploadNodeMedia={uploadNodeMedia}
          clearNodeMedia={(nodeId) => updateNode(nodeId, (node) => ({ ...node, mediaUrl: "", mediaType: "image" }))}
          onClose={() => setFieldEditor(null)}
        />
      ) : null}
      {simulatorOpen ? (
        <FlowPhoneSimulator flow={selectedFlow} onClose={() => setSimulatorOpen(false)} />
      ) : null}
      {importModalOpen ? (
        <div className={styles.flowConfigOverlay} role="presentation" onClick={() => setImportModalOpen(false)}>
          <div className={classNames(styles.flowConfigModal, styles.flowImportModal)} role="dialog" aria-modal="true" aria-label="Importar fluxo" onClick={(event) => event.stopPropagation()}>
            <header className={styles.flowConfigHeader}>
              <div>
                <h3>Importar fluxo</h3>
                <p>Cole um link do BotAdmin, link do BotConversa, código de compartilhamento ou JSON exportado.</p>
              </div>
              <button type="button" className={styles.flowConfigClose} onClick={() => setImportModalOpen(false)} aria-label="Fechar importação">
                <IconX size={16} />
              </button>
            </header>
            <div className={styles.flowConfigBody}>
              <label className={styles.field}>
                Link, código ou JSON
                <textarea
                  className={styles.flowImportTextarea}
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder="https://app.botconversa.com.br/share-flow?share_code=..."
                />
              </label>
              <div className={styles.split}>
                <label className={styles.field}>Nome opcional<input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="Nome do fluxo importado" /></label>
                <label className={styles.field}>Comando opcional<input value={importCommand} onChange={(event) => setImportCommand(normalizeCommand(event.target.value))} placeholder="meufluxo" /></label>
              </div>
              <label className={styles.field}>
                Token ou cookie do BotConversa
                <input
                  value={importAuth}
                  onChange={(event) => setImportAuth(event.target.value)}
                  placeholder="Opcional. Use quando o link deles exigir login."
                />
              </label>
              <p className={styles.flowImportHint}>
                O fluxo importado entra desativado por segurança. Revise os blocos, vincule a instância/grupo e ative quando estiver pronto.
              </p>
              <div className={styles.buttonRow}>
                <button type="button" className={styles.primaryButton} onClick={() => void importSharedFlow()} disabled={importing}>
                  {importing ? <IconClock size={15} /> : <IconFileImport size={15} />}
                  {importing ? "Importando..." : "Importar fluxo"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setImportModalOpen(false)} disabled={importing}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {flowConfigOpen ? (
        <div className={styles.flowConfigOverlay} role="presentation" onClick={() => setFlowConfigOpen(false)}>
          <div className={styles.flowConfigModal} role="dialog" aria-modal="true" aria-label="Configuração do fluxo" onClick={(event) => event.stopPropagation()}>
            <header className={styles.flowConfigHeader}>
              <div>
	                <h3>Configuração do fluxo</h3>
	                <p>Nome, status e descrição geral. O uso em PV ou grupos fica no bloco Gatilho.</p>
              </div>
              <button type="button" className={styles.flowConfigClose} onClick={() => setFlowConfigOpen(false)} aria-label="Fechar configuração">
                <IconX size={16} />
              </button>
            </header>
            <div className={styles.flowConfigBody}>
              <label className={styles.field}>Nome<input value={selectedFlow.name} onChange={(event) => updateFlowField("name", event.target.value)} /></label>
              <div className={styles.split}>
                <label className={styles.field}>Comando<input value={selectedFlow.command} onChange={(event) => updateFlowField("command", normalizeCommand(event.target.value))} placeholder="meufluxo" /></label>
                <label className={styles.field}>Status<select value={selectedFlow.enabled ? "1" : "0"} onChange={(event) => updateFlowField("enabled", event.target.value === "1")}><option value="1">Ativo</option><option value="0">Desativado</option></select></label>
              </div>
	              <label className={styles.field}>Descrição interna<textarea value={selectedFlow.description ?? ""} onChange={(event) => updateFlowField("description", event.target.value)} placeholder="Ex.: fluxo para atendimento, vendas ou suporte" /></label>
              <div className={styles.buttonRow}>
                <button type="button" className={styles.primaryButton} onClick={() => void saveFlow()} disabled={saving}>{saving ? "Salvando..." : "Salvar fluxo"}</button>
                <button type="button" className={styles.ghostButton} onClick={() => void shareFlowById()} disabled={sharingFlowId !== null || saving}><IconShare2 size={15} /> Compartilhar</button>
                <button type="button" className={styles.dangerButton} onClick={() => void deleteFlow()} disabled={saving}><IconTrash size={15} /> Remover fluxo</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const FlowPhoneSimulator = ({ flow, onClose }: { flow: BotFlow; onClose: () => void }) => {
  const chatRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<FlowSimulatorMessage[]>([]);
  const [runtimeVariables, setRuntimeVariables] = useState<Record<string, string>>({});
  const nodeMap = useMemo(() => new Map(flow.nodes.map((node) => [node.id, node])), [flow.nodes]);
  const triggerNode = useMemo(() => flow.nodes.find((node) => node.kind === "trigger") ?? flow.nodes[0] ?? null, [flow.nodes]);
  const triggerType = resolveFlowTriggerType(flow, triggerNode);
  const triggerMatchMode = resolveFlowTriggerMatchMode(flow, triggerNode);
  const triggerCommand = extractCommandFromTrigger(triggerNode?.text || triggerNode?.triggerValue || flow.command || "comando");
  const triggerHint = (() => {
    if (triggerType === "command") return `Digite /${triggerCommand || "comando"} para testar o fluxo.`;
    if (triggerType === "keyword") return `Digite "${getTriggerValue(triggerNode, flow) || "palavra-chave"}" para testar o fluxo.`;
    if (triggerType === "message") return "Digite qualquer mensagem para testar o fluxo.";
    if (triggerType === "media") return "Digite uma legenda para simular a mídia recebida.";
    return `Digite ou clique no botão "${getTriggerValue(triggerNode, flow) || "botão"}" para testar o fluxo.`;
  })();

  useEffect(() => {
    setInput("");
    setMessages([]);
    setRuntimeVariables({});
  }, [flow.id, flow.command]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const findOutgoingEdge = useCallback(
    (nodeId: string, branch: BotFlowEdge["branch"] = "default") =>
      flow.edges.find((edge) => edge.from === nodeId && ((edge.branch || "default") === branch)) ??
      flow.edges.find((edge) => edge.from === nodeId && (!edge.branch || edge.branch === "default")),
    [flow.edges],
  );

  const evaluateCondition = useCallback((node: BotFlowNode, variables: Record<string, string>) => {
    const rules =
      node.conditionRules && node.conditionRules.length > 0
        ? node.conditionRules
        : node.conditionVariable
          ? [
              {
                id: "legacy",
                variable: node.conditionVariable,
                operator: node.conditionOperator || "contains",
                value: node.conditionValue || "",
              },
            ]
          : [];
    if (rules.length === 0) return true;
    const testRule = (rule: (typeof rules)[number]) => {
      const current = String(variables[rule.variable] ?? "");
      const expected = String(rule.value ?? "");
      const currentNumber = Number(current.replace(",", "."));
      const expectedNumber = Number(expected.replace(",", "."));
      switch (rule.operator) {
        case "equals":
          return current === expected;
        case "not_equals":
          return current !== expected;
        case "contains":
          return current.toLowerCase().includes(expected.toLowerCase());
        case "not_contains":
          return !current.toLowerCase().includes(expected.toLowerCase());
        case "starts_with":
          return current.toLowerCase().startsWith(expected.toLowerCase());
        case "ends_with":
          return current.toLowerCase().endsWith(expected.toLowerCase());
        case "greater_than":
          return Number.isFinite(currentNumber) && Number.isFinite(expectedNumber) && currentNumber > expectedNumber;
        case "less_than":
          return Number.isFinite(currentNumber) && Number.isFinite(expectedNumber) && currentNumber < expectedNumber;
        case "matches_regex":
          try {
            return new RegExp(expected).test(current);
          } catch {
            return false;
          }
        case "not_matches_regex":
          try {
            return !new RegExp(expected).test(current);
          } catch {
            return true;
          }
        case "is_set":
          return current.trim().length > 0;
        case "is_empty":
          return current.trim().length === 0;
        default:
          return false;
      }
    };
    return node.conditionLogic === "OR" ? rules.some(testRule) : rules.every(testRule);
  }, []);

  const buildFlowMessages = useCallback(
    (startNodeId: string | null | undefined, variables: Record<string, string>) => {
      const output: FlowSimulatorMessage[] = [];
      const visited = new Set<string>();
      let currentId = startNodeId ?? null;
      for (let guard = 0; currentId && guard < 32; guard += 1) {
        if (visited.has(currentId)) {
          output.push({ id: newId("sim-system"), from: "system", text: "O fluxo voltou para uma etapa já visitada." });
          break;
        }
        visited.add(currentId);
        const node = nodeMap.get(currentId);
        if (!node) break;
        if (node.kind === "trigger") {
          currentId = findOutgoingEdge(node.id, "default")?.to ?? null;
          continue;
        }
        if (node.kind === "text" || node.kind === "media" || node.kind === "buttons") {
          output.push({
            id: newId("sim-bot"),
            from: "bot",
            node,
            interactive: node.kind === "buttons",
          });
          if (node.kind === "buttons") break;
          currentId = findOutgoingEdge(node.id, "default")?.to ?? null;
          continue;
        }
        if (node.kind === "webhook_wait") {
          output.push({ id: newId("sim-system"), from: "system", text: "Aguardando webhook externo para continuar." });
          break;
        }
        if (node.kind === "capture") {
          output.push({
            id: newId("sim-bot"),
            from: "bot",
            node,
            interactive: true,
            hidden: true,
          });
          break;
        }
        if (node.kind === "jump") {
          currentId = node.jumpTargetNodeId && nodeMap.has(node.jumpTargetNodeId) && node.jumpTargetNodeId !== node.id
            ? node.jumpTargetNodeId
            : findOutgoingEdge(node.id, "default")?.to ?? null;
          continue;
        }
        if (node.kind === "condition") {
          currentId = findOutgoingEdge(node.id, evaluateCondition(node, variables) ? "true" : "false")?.to ?? null;
          continue;
        }
        if (node.kind === "set_variable") {
          if (node.variableName) {
            variables[node.variableName] =
              node.variableOperation === "clear"
                ? ""
                : node.variableOperation === "append"
                  ? `${variables[node.variableName] ?? ""}${node.variableValue ?? ""}`
                  : node.variableValue ?? "";
          }
          currentId = findOutgoingEdge(node.id, "default")?.to ?? null;
          continue;
        }
        if (node.kind === "delay" || node.kind === "http_request") {
          currentId = findOutgoingEdge(node.id, "default")?.to ?? null;
          continue;
        }
        currentId = null;
      }
      return output;
    },
    [evaluateCondition, findOutgoingEdge, nodeMap],
  );

  const triggerMatches = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const expectedRaw = getTriggerValue(triggerNode, flow);
    if (triggerType === "message") {
      if (!expectedRaw) return true;
      const expected = expectedRaw.toLowerCase();
      const received = trimmed.toLowerCase();
      if (triggerMatchMode === "contains") return received.includes(expected);
      if (triggerMatchMode === "starts_with") return received.startsWith(expected);
      return received === expected;
    }
    if (triggerType === "keyword" || triggerType === "media" || triggerType === "button") {
      const expected = expectedRaw.toLowerCase();
      if (!expected) return true;
      const received = trimmed.toLowerCase();
      if (triggerType === "button") {
        const normalizedExpected = extractCommandFromTrigger(expected);
        const normalizedReceived = extractCommandFromTrigger(received);
        if (normalizedExpected && normalizedReceived === normalizedExpected) return true;
      }
      if (triggerMatchMode === "contains") return received.includes(expected);
      if (triggerMatchMode === "starts_with") return received.startsWith(expected);
      return received === expected;
    }
    return extractCommandFromTrigger(trimmed.split(/\s+/)[0]) === triggerCommand;
  };

  const buildVariablesFromInput = (value: string) => {
    const commandToken = value.trim().split(/\s+/)[0] ?? "";
    const args = value.trim().slice(commandToken.length).trim();
    return {
      usuario: "Cliente",
      nome_usuario: "Cliente",
      mensagem: value.trim(),
      message: value.trim(),
      comando: extractCommandFromTrigger(commandToken),
      args,
    };
  };

  const submitInput = () => {
    const value = input.trim();
    if (!value) return;
    const waitingCapture = [...messages].reverse().find((message) => message.from === "bot" && message.node?.kind === "capture" && message.interactive)?.node ?? null;
    setInput("");
    if (waitingCapture) {
      const valid = validateCapturePreviewValue(waitingCapture.captureType, value);
      setMessages((current) => {
        const baseMessages = valid
          ? current.map((message) => (message.node?.id === waitingCapture.id ? { ...message, interactive: false } : message))
          : current;
        const next: FlowSimulatorMessage[] = [
          ...baseMessages,
          { id: newId("sim-user"), from: "user", text: value },
        ];
        if (!valid) {
          const fallback = capturePreviewFallback(waitingCapture);
          if (fallback) {
            return [...next, { id: newId("sim-bot"), from: "bot", text: fallback }];
          }
          const invalidTarget = flow.edges.find((edge) => edge.from === waitingCapture.id && edge.branch === "invalid")?.to ?? null;
          return [...next, ...buildFlowMessages(invalidTarget, { ...runtimeVariables, ultima_resposta_invalida: value })];
        }
        const variableName = normalizeUiVariableName(waitingCapture.captureVariable || "resposta") || "resposta";
        const nextVariables = { ...runtimeVariables, [variableName]: value, ultima_resposta: value };
        setRuntimeVariables(nextVariables);
        const nextTarget = findOutgoingEdge(waitingCapture.id, "default")?.to ?? null;
        return [...next, ...buildFlowMessages(nextTarget, { ...nextVariables })];
      });
      return;
    }
    const variables = buildVariablesFromInput(value);
    setRuntimeVariables(variables);
    setMessages((current) => {
      const next: FlowSimulatorMessage[] = [...current, { id: newId("sim-user"), from: "user", text: value }];
      if (!triggerMatches(value)) {
        next.push({ id: newId("sim-system"), from: "system", text: "Nenhum fluxo iniciou com essa mensagem." });
        return next;
      }
      const firstTarget = triggerNode ? findOutgoingEdge(triggerNode.id, "default")?.to : null;
      return [...next, ...buildFlowMessages(firstTarget, { ...variables })];
    });
  };

  const clickFlowButton = (node: BotFlowNode, button: BotFlowButton) => {
    const nextTarget = findOutgoingEdge(node.id, buttonBranchId(button.id))?.to ?? null;
    setMessages((current) => {
      const next = current.map((message) => (message.node?.id === node.id ? { ...message, interactive: false } : message));
      next.push({ id: newId("sim-user"), from: "user", text: button.label || "Botão" });
      if (!nextTarget) {
        if (button.value) {
          next.push({ id: newId("sim-system"), from: "system", text: `Ação interna: ${button.value}` });
        }
        return next;
      }
      return [...next, ...buildFlowMessages(nextTarget, { ...runtimeVariables, ultimo_botao: button.label, button_value: button.value })];
    });
  };

  return (
    <aside className={styles.flowPhoneFloating} aria-label="Simulador do fluxo">
      <div className={styles.flowPhoneEditor}>
        <button type="button" className={styles.flowPhoneModalClose} onClick={onClose} aria-label="Fechar simulador">
          <IconX size={16} />
        </button>
        <div className={styles.flowPhoneShell} aria-label="Simulação do fluxo no WhatsApp">
          <div className={styles.flowPhoneScreen}>
            <div className={styles.flowPhoneStatus}>
              <span>11:14</span>
              <span>4G</span>
            </div>
            <header className={styles.flowPhoneHeader}>
              <span className={styles.flowPhoneBack}>‹</span>
              <span className={styles.flowPhoneAvatar}>BA</span>
              <strong>BotAdmin</strong>
              <span className={styles.flowPhoneDots}>⋮</span>
            </header>
            <div ref={chatRef} className={styles.flowPhoneChat}>
              {messages.length === 0 ? (
                <div className={styles.flowPhoneSystemNote}>{triggerHint}</div>
              ) : null}
              {messages.map((message) => {
                if (message.hidden) return null;
                if (message.from === "system") {
                  return <div key={message.id} className={styles.flowPhoneSystemNote}>{message.text}</div>;
                }
                if (message.from === "user") {
                  return (
                    <section key={message.id} className={classNames(styles.flowPhoneBubble, styles.flowPhoneUserBubble)}>
                      <p>{message.text}</p>
                      <time>11:14 AM</time>
                    </section>
                  );
                }
                const node = message.node;
                return node ? (
                  <section key={message.id} className={styles.flowPhoneBubble}>
                    <span className={styles.flowPhoneSender}>BotAdmin</span>
                    {(node.kind === "media" || node.kind === "buttons") && (node.mediaUrl ?? "").trim() ? (
                      <div className={styles.flowPhoneMedia}>{renderFlowMediaPreview(node)}</div>
                    ) : null}
                    {node.kind === "buttons" && (node.headerTitle ?? "").trim() ? (
                      <div className={styles.flowPhoneButtonTitle}>{node.headerTitle}</div>
                    ) : null}
                    <div className={styles.flowPhoneText}>
                      <p>{(node.text ?? "").trim() || (node.kind === "buttons" ? "Selecione uma opção abaixo." : "Mensagem do fluxo.")}</p>
                    </div>
                    {node.kind === "buttons" && (node.footerText ?? "").trim() ? (
                      <div className={styles.flowPhoneButtonFooter}>{node.footerText}</div>
                    ) : null}
                    {node.kind === "buttons" ? (
                      <div className={styles.flowPhoneButtons}>
                        {(node.buttons ?? []).map((button) => (
                          <button
                            key={button.id}
                            type="button"
                            className={styles.flowPhoneQuickButton}
                            onClick={() => message.interactive && clickFlowButton(node, button)}
                            disabled={!message.interactive}
                          >
                            <span>{flowButtonIcon(button.type)}</span>
                            <strong>{button.label || "Botão"}</strong>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <time>11:14 AM</time>
                  </section>
                ) : null;
              })}
            </div>
            <form
              className={styles.flowPhoneComposer}
              onSubmit={(event) => {
                event.preventDefault();
                submitInput();
              }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  [...messages].reverse().some((message) => message.from === "bot" && message.node?.kind === "capture" && message.interactive)
                    ? "Digite a resposta solicitada"
                    : triggerType === "command"
                      ? `Digite /${triggerCommand || "comando"}`
                      : "Digite uma mensagem"
                }
              />
              <button type="submit">Enviar</button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
};

const QuickNodeEditor = ({
  flow,
  availableFlows,
  instances,
  groups,
  activeProfileInstanceId,
  selectedNode,
  updateFlowField,
  updateNode,
  addButton,
  removeNode,
  onClose,
}: {
  flow: BotFlow;
  availableFlows: BotFlow[];
  instances: BotInstance[];
  groups: BotGroup[];
  activeProfileInstanceId: number | null;
  selectedNode: BotFlowNode;
  updateFlowField: <K extends keyof BotFlow>(key: K, value: BotFlow[K]) => void;
  updateNode: (nodeId: string, updater: (node: BotFlowNode) => BotFlowNode) => void;
  addButton: () => void;
  removeNode: (nodeId: string) => void;
  onClose: () => void;
}) => {
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [webhookExamples, setWebhookExamples] = useState<BotFlowWebhookExample[]>([]);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookMonitoring, setWebhookMonitoring] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [webhookMappingDraft, setWebhookMappingDraft] = useState<WebhookDataSuggestion | null>(null);
  const webhookMonitorBaselineRef = useRef(0);
  const canUseMedia = selectedNode.kind === "media" || selectedNode.kind === "buttons";
  const variables = collectFlowVariables(flow);
  const appendVariable = (current: string | undefined, variable: string) => `${current ?? ""}{{${variable}}}`;
  const selectedTriggerType = resolveFlowTriggerType(flow, selectedNode);
  const selectedTriggerMatchMode = resolveFlowTriggerMatchMode(flow, selectedNode);
  const isWebhookNode = selectedNode.kind === "webhook_wait" || (selectedNode.kind === "trigger" && selectedTriggerType === "webhook");
  const webhookUrl = isWebhookNode ? buildWebhookUrl(flow, selectedNode) : "";
  const triggerGroups = useMemo(() => {
    if (!activeProfileInstanceId) return groups;
    return groups.filter((group) => group.instanceId === activeProfileInstanceId || group.id === flow.groupId);
  }, [activeProfileInstanceId, flow.groupId, groups]);
  const capturedWebhookExample = webhookExamples[0] ?? null;
  const webhookSuggestions = useMemo(() => buildWebhookDataSuggestions(capturedWebhookExample), [capturedWebhookExample]);

  useEffect(() => {
    setWebhookMappingDraft(null);
  }, [selectedNode.id]);

  const fetchWebhookExamples = useCallback(async () => {
    if (flow.id <= 0) {
      throw new Error("Salve o fluxo uma vez para monitorar exemplos.");
    }
    const response = await fetch(`/api/bot-flows/${flow.id}/webhook-events?nodeId=${encodeURIComponent(selectedNode.id)}&limit=10`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "Não foi possível carregar os exemplos.");
    return Array.isArray(payload?.events) ? (payload.events as BotFlowWebhookExample[]) : [];
  }, [flow.id, selectedNode.id]);

  const startWebhookMonitoring = async () => {
    if (!webhookUrl) {
      setWebhookError(flow.id > 0 ? "Renove ou salve o token para liberar a URL." : "Salve o fluxo uma vez para monitorar.");
      return;
    }
    setWebhookLoading(true);
    setWebhookError("");
    try {
      const events = await fetchWebhookExamples();
      setWebhookExamples([]);
      webhookMonitorBaselineRef.current = Math.max(0, ...events.map((event) => event.id));
      setWebhookMonitoring(true);
    } catch (error) {
      setWebhookError(error instanceof Error ? error.message : "Não foi possível iniciar o monitoramento.");
    } finally {
      setWebhookLoading(false);
    }
  };

  useEffect(() => {
    if (!webhookMonitoring) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const events = await fetchWebhookExamples();
        if (cancelled) return;
        const baseline = webhookMonitorBaselineRef.current;
        const newEvents = events.filter((event) => event.id > baseline);
        if (newEvents.length > 0) {
          setWebhookExamples(newEvents);
          webhookMonitorBaselineRef.current = Math.max(...newEvents.map((event) => event.id));
          setWebhookMonitoring(false);
        }
      } catch (error) {
        if (!cancelled) {
          setWebhookError(error instanceof Error ? error.message : "Não foi possível monitorar o webhook.");
          setWebhookMonitoring(false);
        }
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 1800);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchWebhookExamples, webhookMonitoring]);

	  const addWebhookMapping = (path: string, variable: string) => {
	    const cleanVariable = normalizeUiVariableName(variable);
	    if (!path || !cleanVariable) return;
	    updateNode(selectedNode.id, (node) => {
	      const current = node.webhookResponseMappings ?? [];
	      if (current.some((mapping) => mapping.path === path)) {
	        return {
	          ...node,
	          webhookResponseMappings: current.map((mapping) =>
	            mapping.path === path ? { ...mapping, variable: cleanVariable } : mapping,
	          ),
	        };
	      }
	      return {
	        ...node,
	        webhookResponseMappings: [...current, { id: newId("wh_map"), path, variable: cleanVariable }],
	      };
	    });
	  };

  const openWebhookMappingDraft = (item: WebhookDataSuggestion) => {
    const saved = (selectedNode.webhookResponseMappings ?? []).find((mapping) => mapping.path === item.path);
    setWebhookMappingDraft({
      ...item,
      variable: saved?.variable || item.variable,
    });
  };

  const saveWebhookMappingDraft = () => {
    if (!webhookMappingDraft) return;
    const cleanVariable = normalizeUiVariableName(webhookMappingDraft.variable);
    if (!cleanVariable) {
      setWebhookError("Informe um nome de variável válido.");
      return;
    }
    addWebhookMapping(webhookMappingDraft.path, cleanVariable);
    setWebhookMappingDraft(null);
    setWebhookError("");
  };

  const updateWebhookMapping = (itemId: string, field: "path" | "variable", value: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      webhookResponseMappings: (node.webhookResponseMappings ?? []).map((item) =>
        item.id === itemId ? { ...item, [field]: field === "variable" ? normalizeUiVariableName(value) : value } : item,
      ),
    }));
  };

  const removeWebhookMapping = (itemId: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      webhookResponseMappings: (node.webhookResponseMappings ?? []).filter((item) => item.id !== itemId),
    }));
  };

  const handleMediaFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    const inferredType = inferMediaTypeFromFile(file);
    if (selectedNode.kind === "buttons" && inferredType === "audio") {
      setUploadError("Header de botões aceita imagem, vídeo ou documento.");
      return;
    }
    setUploadingMedia(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/bot-flows/upload", { method: "POST", body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Não foi possível enviar a mídia.");
      const media = payload?.media as { url?: string; mediaType?: BotFlowNode["mediaType"] } | undefined;
      if (!media?.url) throw new Error("Upload concluído sem URL da mídia.");
      updateNode(selectedNode.id, (node) => ({ ...node, mediaUrl: media.url, mediaType: media.mediaType ?? inferredType }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Não foi possível enviar a mídia.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const updateContentItem = (itemId: string, field: string, value: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      contentItems: (node.contentItems ?? []).map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]:
                field === "delaySeconds"
                  ? Math.max(0, Number(value) || 0)
                  : field === "type"
                    ? (value as NonNullable<BotFlowNode["contentItems"]>[number]["type"])
                    : value,
              mediaType:
                field === "type"
                  ? value === "video"
                    ? "video"
                    : value === "audio"
                      ? "audio"
                      : value === "file"
                        ? "document"
                        : item.mediaType
                  : item.mediaType,
            }
          : item,
      ),
    }));
  };

  const addContentItem = (type: NonNullable<BotFlowNode["contentItems"]>[number]["type"] = "text") => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      contentItems: [
        ...(node.contentItems ?? []),
        {
          id: newId("item"),
          type,
          text: type === "text" ? "Nova mensagem" : "",
          delaySeconds: type === "delay" ? 2 : undefined,
          mediaType: type === "video" ? "video" : type === "audio" ? "audio" : type === "file" ? "document" : "image",
        },
      ],
    }));
  };

  const removeContentItem = (itemId: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      contentItems: (node.contentItems ?? []).filter((item) => item.id !== itemId),
    }));
  };

  const updateMenuOption = (optionId: string, field: "label" | "value" | "description", value: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      menuOptions: (node.menuOptions ?? []).map((option) => (option.id === optionId ? { ...option, [field]: value } : option)),
    }));
  };

  const addMenuOption = () => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      menuOptions: [
        ...(node.menuOptions ?? []),
        { id: newId("menu"), label: `Opção ${(node.menuOptions ?? []).length + 1}`, value: `opcao_${(node.menuOptions ?? []).length + 1}`, description: "" },
      ],
    }));
  };

  const removeMenuOption = (optionId: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      menuOptions: (node.menuOptions ?? []).filter((option) => option.id !== optionId),
    }));
  };

  const updateAction = (actionId: string, field: "type" | "label" | "key" | "value", value: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      actions: (node.actions ?? []).map((action) =>
        action.id === actionId
          ? {
              ...action,
              [field]: field === "type" ? (value as NonNullable<BotFlowNode["actions"]>[number]["type"]) : value,
            }
          : action,
      ),
    }));
  };

  const addAction = () => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      actions: [...(node.actions ?? []), { id: newId("action"), type: "custom_event", label: "Evento personalizado", key: "evento", value: "" }],
    }));
  };

  const removeAction = (actionId: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      actions: (node.actions ?? []).filter((action) => action.id !== actionId),
    }));
  };

  const updateRandomizerOption = (optionId: string, field: "label" | "weight", value: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      randomizerOptions: (node.randomizerOptions ?? []).map((option) =>
        option.id === optionId ? { ...option, [field]: field === "weight" ? Math.max(0, Math.min(100, Number(value) || 0)) : value } : option,
      ),
    }));
  };

  const addRandomizerOption = () => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      randomizerOptions: [
        ...(node.randomizerOptions ?? []),
        { id: newId("random"), label: `Caminho ${(node.randomizerOptions ?? []).length + 1}`, weight: 0 },
      ],
    }));
  };

  const removeRandomizerOption = (optionId: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      randomizerOptions: (node.randomizerOptions ?? []).filter((option) => option.id !== optionId),
    }));
  };

  const renderWebhookSettings = () => (
    <div className={styles.field}>
      <label>URL do webhook</label>
      <input
        value={webhookUrl || (flow.id > 0 ? "Gere um token para liberar a URL." : "Salve o fluxo para gerar a URL pública.")}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className={styles.inlineActions}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, triggerType: "webhook", triggerMatchMode: "exact", triggerValue: newWebhookToken() }))}
        >
          Renovar token
        </button>
        <button
          type="button"
          className={styles.ghostButton}
          disabled={!webhookUrl}
          onClick={() => {
            if (!webhookUrl) return;
            void navigator.clipboard?.writeText(webhookUrl);
          }}
        >
          <IconCopy size={14} /> Copiar
        </button>
        <button
          type="button"
          className={webhookMonitoring ? styles.ghostButton : styles.primaryButton}
          onClick={() => {
            if (webhookMonitoring) {
              setWebhookMonitoring(false);
            } else {
              void startWebhookMonitoring();
            }
          }}
          disabled={webhookLoading}
        >
          {webhookMonitoring ? "Parar" : webhookLoading ? "..." : "Monitorar"}
        </button>
      </div>
      <small>
        {webhookMonitoring
          ? "Aguardando um novo evento. A captura para automaticamente quando um payload chegar."
          : "Envie um GET ou POST para essa URL para capturar exemplos de payload e usar como variáveis no fluxo."}
      </small>
      {webhookError ? <p className={styles.flowPhoneUploadError}>{webhookError}</p> : null}
      {capturedWebhookExample ? (
        <div className={styles.webhookCaptureBox}>
          <header>
            <div>
              <strong>{capturedWebhookExample.method} #{capturedWebhookExample.id}</strong>
              <span>{capturedWebhookExample.createdAt ? new Date(capturedWebhookExample.createdAt).toLocaleString("pt-BR") : "agora"}</span>
            </div>
            <span>{webhookSuggestions.length} campo(s)</span>
          </header>
          <pre>{JSON.stringify({
            query: parseJsonValue(capturedWebhookExample.queryJson),
            body: parseJsonValue(capturedWebhookExample.bodyJson),
          }, null, 2)}</pre>
          {webhookSuggestions.length > 0 ? (
            <div className={styles.webhookFieldList}>
              {webhookSuggestions.map((item) => {
                const saved = (selectedNode.webhookResponseMappings ?? []).some((mapping) => mapping.path === item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    className={saved ? styles.webhookFieldSaved : styles.webhookFieldItem}
                    onClick={() => openWebhookMappingDraft(item)}
                  >
                    <span>
                      <strong>{item.path}</strong>
                      <small>{item.preview}</small>
                    </span>
                    <em>{saved ? "Editar variável" : "Personalizar"}</em>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {(selectedNode.webhookResponseMappings ?? []).length > 0 ? (
        <div className={styles.webhookSavedVariables}>
          <strong>Variáveis do webhook</strong>
          {(selectedNode.webhookResponseMappings ?? []).map((mapping) => (
            <div key={mapping.id} className={styles.httpMappingCard}>
              <button type="button" className={styles.httpRemoveLine} onClick={() => removeWebhookMapping(mapping.id)} aria-label="Remover variável">
                <IconTrash size={13} />
              </button>
              <label>
                <span>Dado:</span>
                <DataPathInput
                  value={mapping.path}
                  suggestions={webhookSuggestions.map((item) => item.path)}
                  onChange={(value) => updateWebhookMapping(mapping.id, "path", value)}
                />
              </label>
              <label>
                <span>Salvar em:</span>
                <VariableNameInput
                  value={mapping.variable}
                  variables={variables}
                  onChange={(value) => updateWebhookMapping(mapping.id, "variable", value)}
                />
              </label>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (selectedNode.kind === "http_request") {
    return (
      <HttpRequestEditor
        flow={flow}
        selectedNode={selectedNode}
        updateNode={updateNode}
        removeNode={removeNode}
        onClose={onClose}
      />
    );
  }

  return (
    <>
    <aside className={styles.quickNodeEditor} aria-label="Edição rápida do bloco">
      <header>
        <div>
          <strong>{selectedNode.title || nodeDisplayKindLabel(selectedNode)}</strong>
          <span>{nodeDisplayKindLabel(selectedNode)}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar edição">
          <IconX size={15} />
        </button>
      </header>
      <div className={styles.quickNodeBody}>
        <label className={styles.field}>Título do bloco<input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, title: event.target.value }))} /></label>
        {selectedNode.kind === "trigger" ? (
          <>
            <div className={styles.conditionEditor}>
              <div className={styles.ruleHint}>
                <strong>Onde este gatilho funciona</strong>
                <span>Controle se o fluxo dispara em conversa privada, grupo ou nos dois. O perfil atual define a instância automaticamente.</span>
              </div>
              <label className={styles.field}>Uso
                <select value={flow.scope} onChange={(event) => updateFlowField("scope", event.target.value as BotFlowScope)}>
                  <option value="group">Somente grupos</option>
                  <option value="private">Somente PV</option>
                  <option value="both">PV e grupos</option>
                </select>
              </label>
              {flow.scope === "group" ? (
                <div className={styles.conditionGroupScroll}>
                  <span className={styles.conditionGroupTitle}>Grupo</span>
                  <button
                    type="button"
                    className={classNames(styles.conditionGroupOption, flow.groupId == null && styles.conditionGroupOptionActive)}
                    onClick={() => updateFlowField("groupId", null)}
                  >
                    <strong>Todos os grupos do perfil atual</strong>
                    <small>O fluxo responde em qualquer grupo deste perfil.</small>
                  </button>
                  {triggerGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={classNames(styles.conditionGroupOption, flow.groupId === group.id && styles.conditionGroupOptionActive)}
                      onClick={() => updateFlowField("groupId", group.id)}
                    >
                      <strong>{group.name}</strong>
                      <small>{group.remoteId || `${group.participantCount ?? 0} participantes`}</small>
                    </button>
                  ))}
                  {triggerGroups.length === 0 ? (
                    <small className={styles.conditionGroupEmpty}>Nenhum grupo sincronizado neste perfil.</small>
                  ) : null}
                </div>
              ) : null}
            </div>
            <label className={styles.field}>Tipo de gatilho
              <select
                value={selectedTriggerType}
	                onChange={(event) => {
	                  const nextType = event.target.value as BotFlow["triggerType"];
	                  updateNode(selectedNode.id, (node) => ({
	                    ...node,
	                    triggerType: nextType,
	                    triggerMatchMode: nextType === "command" || nextType === "webhook" ? "exact" : node.triggerMatchMode ?? "contains",
	                    triggerMediaType: node.triggerMediaType ?? "any",
	                    text:
	                      nextType === "command"
	                        ? `/${extractCommandFromTrigger(node.text || flow.command) || flow.command || "comando"}`
                          : nextType === "webhook"
                            ? ""
	                        : resolveFlowTriggerType(flow, node) === "command"
	                          ? ""
	                          : node.text ?? "",
	                    triggerValue:
	                      nextType === "command"
	                        ? extractCommandFromTrigger(node.text || flow.command) || flow.command || "comando"
                          : nextType === "webhook"
                            ? node.triggerValue || newWebhookToken()
	                        : resolveFlowTriggerType(flow, node) === "command"
	                          ? ""
	                          : node.triggerValue ?? node.text ?? "",
	                  }));
	                }}
              >
                {TRIGGER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small>{TRIGGER_TYPE_OPTIONS.find((option) => option.value === selectedTriggerType)?.hint}</small>
            </label>
            {selectedTriggerType === "command" ? (
              <label className={styles.field}>Comando
                <input
                  value={extractCommandFromTrigger(selectedNode.text || selectedNode.triggerValue || flow.command)}
                  onChange={(event) => {
                    const command = normalizeCommand(event.target.value);
                    updateNode(selectedNode.id, (node) => ({
                      ...node,
                      triggerType: "command",
                      triggerMatchMode: "exact",
                      triggerValue: command,
                      text: `/${command || "comando"}`,
                    }));
                  }}
                  placeholder="menu"
                />
              </label>
            ) : null}
            {selectedTriggerType === "webhook" ? renderWebhookSettings() : null}
            {selectedTriggerType === "media" ? (
              <label className={styles.field}>Tipo de mídia
                <select
                  value={selectedNode.triggerMediaType ?? "any"}
                  onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, triggerMediaType: event.target.value as NonNullable<BotFlowNode["triggerMediaType"]> }))}
                >
                  {TRIGGER_MEDIA_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedTriggerType !== "command" && selectedTriggerType !== "webhook" ? (
              <>
                <label className={styles.field}>
	                  {selectedTriggerType === "keyword"
	                    ? "Texto ou palavra-chave"
	                    : selectedTriggerType === "message"
	                      ? "Filtro opcional de texto"
	                      : selectedTriggerType === "media"
	                        ? "Filtro opcional da legenda ou metadados"
	                        : "Texto, ID ou comando do botão"}
                  <span className={styles.inputWithVariable}>
                    <input
                      value={selectedNode.text ?? ""}
                      onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, text: event.target.value, triggerValue: event.target.value }))}
                      placeholder={
                        selectedTriggerType === "button"
                          ? "Abrir menu, menu ou /menu"
                          : selectedTriggerType === "message"
	                            ? "Deixe vazio para qualquer mensagem"
	                            : selectedTriggerType === "media"
	                              ? "Deixe vazio para qualquer mídia desse tipo"
	                              : "palavra-chave"
	                      }
                    />
                    <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, text: appendVariable(node.text, variable), triggerValue: appendVariable(node.triggerValue, variable) }))} />
                  </span>
                </label>
                <label className={styles.field}>Forma de comparação
                  <select
                    value={selectedTriggerMatchMode}
                    onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, triggerMatchMode: event.target.value as BotFlow["matchMode"] }))}
                  >
                    {TRIGGER_MATCH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </>
        ) : null}
        {selectedNode.kind === "webhook_wait" ? renderWebhookSettings() : null}
        {selectedNode.kind === "content" ? (
          <div className={styles.conditionEditor}>
            <div className={styles.ruleHint}><strong>Itens do conteúdo</strong><span>Execute mensagens, mídias, delays e variáveis em sequência.</span></div>
            {(selectedNode.contentItems?.length ? selectedNode.contentItems : [{ id: "item_1", type: "text" as const, text: "" }]).map((item) => (
              <div key={item.id} className={styles.conditionComparisonCard}>
                <button type="button" className={styles.conditionRemoveButton} onClick={() => removeContentItem(item.id)} aria-label="Remover item">
                  <IconTrash size={13} />
                </button>
                <select value={item.type} onChange={(event) => updateContentItem(item.id, "type", event.target.value)}>
                  <option value="text">Texto</option>
                  <option value="image">Imagem</option>
                  <option value="video">Vídeo</option>
                  <option value="file">Arquivo</option>
                  <option value="audio">Áudio</option>
                  <option value="save">Salvar variável</option>
                  <option value="delay">Atraso</option>
                  <option value="auto_off">AutoOff</option>
                  <option value="contact">Contato</option>
                </select>
                {item.type === "delay" ? (
                  <input type="number" min="0" value={item.delaySeconds ?? 1} onChange={(event) => updateContentItem(item.id, "delaySeconds", event.target.value)} placeholder="Segundos" />
                ) : item.type === "save" ? (
                  <>
                    <input value={item.variableName ?? ""} onChange={(event) => updateContentItem(item.id, "variableName", normalizeUiVariableName(event.target.value))} placeholder="variavel" />
                    <textarea value={item.variableValue ?? ""} onChange={(event) => updateContentItem(item.id, "variableValue", event.target.value)} placeholder="{{args}}" />
                  </>
                ) : item.type === "contact" ? (
                  <>
                    <input value={item.contactName ?? ""} onChange={(event) => updateContentItem(item.id, "contactName", event.target.value)} placeholder="Nome do contato" />
                    <input value={item.contactPhone ?? ""} onChange={(event) => updateContentItem(item.id, "contactPhone", event.target.value)} placeholder="Telefone" />
                  </>
                ) : item.type === "text" || item.type === "auto_off" ? (
                  <textarea value={item.text ?? ""} onChange={(event) => updateContentItem(item.id, "text", event.target.value)} placeholder="Digite a mensagem..." />
                ) : (
                  <>
                    <input value={item.mediaUrl ?? ""} onChange={(event) => updateContentItem(item.id, "mediaUrl", event.target.value)} placeholder="URL da mídia" />
                    <textarea value={item.caption ?? ""} onChange={(event) => updateContentItem(item.id, "caption", event.target.value)} placeholder="Legenda opcional" />
                  </>
                )}
              </div>
            ))}
            <div className={styles.inlineActions}>
              <button type="button" className={styles.ghostButton} onClick={() => addContentItem("text")}><IconPlus size={14} /> Texto</button>
              <button type="button" className={styles.ghostButton} onClick={() => addContentItem("image")}><IconPlus size={14} /> Mídia</button>
              <button type="button" className={styles.ghostButton} onClick={() => addContentItem("delay")}><IconPlus size={14} /> Delay</button>
            </div>
          </div>
        ) : null}
        {selectedNode.kind === "menu" ? (
          <div className={styles.conditionEditor}>
            <label className={styles.field}>Modo da lista
              <select value={selectedNode.menuMode ?? "list"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, menuMode: event.target.value as BotFlowNode["menuMode"] }))}>
                <option value="list">Lista do WhatsApp</option>
                <option value="buttons">Botões rápidos</option>
                <option value="number">Resposta por número</option>
              </select>
            </label>
            <label className={styles.field}>Pergunta
              <span className={styles.textareaWithVariable}>
                <textarea value={selectedNode.text ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, text: event.target.value }))} placeholder="Escolha uma opção..." />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, text: appendVariable(node.text, variable) }))} />
              </span>
            </label>
            <label className={styles.field}>Texto para entrada inválida
              <textarea value={selectedNode.menuInvalidText ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, menuInvalidText: event.target.value }))} />
            </label>
            <label className={styles.field}>Limite de erros
              <input type="number" min="1" max="10" value={selectedNode.menuErrorLimit ?? 3} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, menuErrorLimit: Number(event.target.value) }))} />
            </label>
            {(selectedNode.menuOptions ?? []).map((option) => (
              <div key={option.id} className={styles.conditionComparisonCard}>
                <button type="button" className={styles.conditionRemoveButton} onClick={() => removeMenuOption(option.id)} aria-label="Remover opção">
                  <IconTrash size={13} />
                </button>
                <input value={option.label} onChange={(event) => updateMenuOption(option.id, "label", event.target.value)} placeholder="Título da opção" />
                <input value={option.value} onChange={(event) => updateMenuOption(option.id, "value", event.target.value)} placeholder="Valor ou comando" />
                <input value={option.description ?? ""} onChange={(event) => updateMenuOption(option.id, "description", event.target.value)} placeholder="Descrição opcional" />
              </div>
            ))}
            <button type="button" className={styles.httpAddValueButton} onClick={addMenuOption}><IconPlus size={15} /> Adicionar resposta</button>
          </div>
        ) : null}
        {selectedNode.kind === "action" ? (
          <div className={styles.conditionEditor}>
            {(selectedNode.actions ?? []).map((action) => (
              <div key={action.id} className={styles.conditionComparisonCard}>
                <button type="button" className={styles.conditionRemoveButton} onClick={() => removeAction(action.id)} aria-label="Remover ação">
                  <IconTrash size={13} />
                </button>
                <select value={action.type} onChange={(event) => updateAction(action.id, "type", event.target.value)}>
                  <option value="add_tag">Adicionar etiqueta</option>
                  <option value="remove_tag">Remover etiqueta</option>
                  <option value="custom_event">Evento personalizado</option>
                  <option value="subscribe_sequence">Inscrever em sequência</option>
                  <option value="unsubscribe_sequence">Descadastrar de sequência</option>
                  <option value="set_field">Definir campo</option>
                  <option value="clear_field">Limpar campo</option>
                  <option value="open_chat">Abrir atendimento</option>
                  <option value="assign_chat">Atribuir atendimento</option>
                  <option value="notify_team">Notificar equipe</option>
                  <option value="unassign_chat">Remover atribuição</option>
                  <option value="complete_chat">Concluir atendimento</option>
                  <option value="pause_automation">Pausar automação</option>
                  <option value="restart_automation">Reiniciar automação</option>
                  <option value="clear_gpt_thread">Limpar memória GPT</option>
                </select>
                <input value={action.label ?? ""} onChange={(event) => updateAction(action.id, "label", event.target.value)} placeholder="Nome visível" />
                <input value={action.key ?? ""} onChange={(event) => updateAction(action.id, "key", event.target.value)} placeholder="Chave/etiqueta/campo" />
                <textarea value={action.value ?? ""} onChange={(event) => updateAction(action.id, "value", event.target.value)} placeholder="Valor opcional" />
              </div>
            ))}
            <button type="button" className={styles.httpAddValueButton} onClick={addAction}><IconPlus size={15} /> Adicionar ação</button>
          </div>
        ) : null}
        {selectedNode.kind === "randomizer" ? (
          <div className={styles.conditionEditor}>
            <label className={styles.field}>Modo de distribuição
              <select
                value={selectedNode.randomizerMode ?? "random"}
                onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, randomizerMode: event.target.value as BotFlowNode["randomizerMode"] }))}
              >
                <option value="random">Aleatório por peso</option>
                <option value="sequential">Sequencial</option>
              </select>
            </label>
            {(selectedNode.randomizerOptions ?? []).map((option) => (
              <div key={option.id} className={styles.conditionComparisonCard}>
                <button type="button" className={styles.conditionRemoveButton} onClick={() => removeRandomizerOption(option.id)} aria-label="Remover saída">
                  <IconTrash size={13} />
                </button>
                <input value={option.label} onChange={(event) => updateRandomizerOption(option.id, "label", event.target.value)} placeholder="Nome da saída" />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={option.weight}
                  onChange={(event) => updateRandomizerOption(option.id, "weight", event.target.value)}
                  placeholder="Peso %"
                />
              </div>
            ))}
            <button type="button" className={styles.httpAddValueButton} onClick={addRandomizerOption}><IconPlus size={15} /> Adicionar saída</button>
          </div>
        ) : null}
        {(selectedNode.kind === "delay" || selectedNode.kind === "smart_delay") ? (
          <div className={styles.conditionEditor}>
            <label className={styles.field}>Tipo de atraso
              <select
                value={selectedNode.smartDelayMode ?? "relative"}
                onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, smartDelayMode: event.target.value as BotFlowNode["smartDelayMode"] }))}
              >
                <option value="relative">Aguardar por tempo</option>
                <option value="datetime">Aguardar até data e hora</option>
              </select>
            </label>
            {selectedNode.smartDelayMode === "datetime" ? (
              <label className={styles.field}>Data e hora
                <input
                  type="datetime-local"
                  value={selectedNode.smartDelayUntil ?? ""}
                  onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, smartDelayUntil: event.target.value }))}
                />
              </label>
            ) : (
              <div className={styles.conditionComparisonCard}>
                <input
                  type="number"
                  min="0"
                  value={selectedNode.delaySeconds ?? 2}
                  onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, delaySeconds: Number(event.target.value) }))}
                  placeholder="Tempo"
                />
                <select
                  value={selectedNode.smartDelayUnit ?? "seconds"}
                  onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, smartDelayUnit: event.target.value as BotFlowNode["smartDelayUnit"] }))}
                >
                  <option value="seconds">Segundos</option>
                  <option value="minutes">Minutos</option>
                  <option value="hours">Horas</option>
                  <option value="days">Dias</option>
                </select>
              </div>
            )}
            <small>O runtime limita esperas longas para não travar execução síncrona; atrasos futuros entram como ponto de espera.</small>
          </div>
        ) : null}
        {selectedNode.kind === "flow_link" ? (
          <div className={styles.conditionEditor}>
            <label className={styles.field}>Fluxo destino
              <select
                value={selectedNode.targetFlowId ?? ""}
                onChange={(event) => {
                  const targetId = event.target.value ? Number(event.target.value) : null;
                  const targetFlow = availableFlows.find((item) => item.id === targetId);
                  updateNode(selectedNode.id, (node) => ({
                    ...node,
                    targetFlowId: targetId,
                    targetFlowName: targetFlow?.name ?? "",
                  }));
                }}
              >
                <option value="">Selecione um fluxo publicado</option>
                {availableFlows
                  .filter((item) => item.id > 0 && item.id !== flow.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name || `Fluxo #${item.id}`}{item.command ? ` /${item.command.replace(/^\//, "")}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className={styles.field}>Nome de referência
              <input
                value={selectedNode.targetFlowName ?? ""}
                onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, targetFlowName: event.target.value }))}
                placeholder="Fluxo de atendimento"
              />
            </label>
            <small>Use esse bloco para reutilizar outro fluxo publicado sem duplicar todos os blocos.</small>
          </div>
        ) : null}
        {selectedNode.kind === "assistant_gpt" ? (
          <div className={styles.conditionEditor}>
            <label className={styles.field}>Assistente
              <input value={selectedNode.assistantName ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantName: event.target.value }))} placeholder="Nome do assistente" />
            </label>
            <label className={styles.field}>Quem envia a primeira mensagem
              <select
                value={selectedNode.assistantInitialMode ?? "contact"}
                onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantInitialMode: event.target.value as BotFlowNode["assistantInitialMode"] }))}
              >
                <option value="contact">Contato</option>
                <option value="assistant">Assistente</option>
              </select>
            </label>
            <label className={styles.field}>Mensagem inicial
              <span className={styles.textareaWithVariable}>
                <textarea value={selectedNode.assistantInitialMessage ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantInitialMessage: event.target.value }))} />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, assistantInitialMessage: appendVariable(node.assistantInitialMessage, variable) }))} />
              </span>
            </label>
            <div className={styles.conditionComparisonCard}>
              <input value={selectedNode.assistantLanguage ?? "pt-BR"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantLanguage: event.target.value }))} placeholder="Idioma" />
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={selectedNode.assistantTemperature ?? 0.7}
                onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantTemperature: Number(event.target.value) }))}
                placeholder="Temperatura"
              />
            </div>
            <label className={styles.field}>Modelo
              <input value={selectedNode.assistantModel ?? "gpt-4o-mini"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantModel: event.target.value }))} />
            </label>
            <label className={styles.field}>Instruções
              <textarea value={selectedNode.assistantInstructions ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantInstructions: event.target.value }))} />
            </label>
            <label className={styles.field}>Instruções individuais
              <textarea value={selectedNode.assistantIndividualInstructions ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantIndividualInstructions: event.target.value }))} />
            </label>
            <label className={styles.field}>Contexto/arquivos
              <textarea value={selectedNode.assistantContext ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantContext: event.target.value }))} />
            </label>
            <label className={styles.field}>Mensagem de erro
              <textarea value={selectedNode.assistantErrorMessage ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, assistantErrorMessage: event.target.value }))} />
            </label>
          </div>
        ) : null}
        {selectedNode.kind === "buttons" ? (
          <label className={styles.field}>Título da mensagem
            <span className={styles.inputWithVariable}>
              <input value={selectedNode.headerTitle ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, headerTitle: event.target.value }))} />
              <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, headerTitle: appendVariable(node.headerTitle, variable) }))} />
            </span>
          </label>
        ) : null}
        {(selectedNode.kind === "text" || selectedNode.kind === "media" || selectedNode.kind === "buttons") ? (
          <label className={styles.field}>Mensagem
            <span className={styles.textareaWithVariable}>
              <textarea value={selectedNode.text ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, text: event.target.value }))} />
              <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, text: appendVariable(node.text, variable) }))} />
            </span>
          </label>
        ) : null}
        {canUseMedia ? (
          <>
            <label className={styles.quickUploadButton}>
              <IconPhoto size={16} />
              {uploadingMedia ? "Enviando mídia..." : selectedNode.mediaUrl ? "Trocar mídia" : "Adicionar mídia"}
              <input type="file" accept={flowMediaAccept(selectedNode)} onChange={handleMediaFileChange} disabled={uploadingMedia} />
            </label>
            {selectedNode.mediaUrl ? (
              <button type="button" className={styles.ghostButton} onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, mediaUrl: "", mediaType: "image" }))}>
                Remover mídia
              </button>
            ) : null}
            {uploadError ? <p className={styles.flowPhoneUploadError}>{uploadError}</p> : null}
          </>
        ) : null}
        {selectedNode.kind === "capture" ? (
          <>
            <label className={styles.field}>O que deseja capturar
              <select value={selectedNode.captureType ?? "text"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, captureType: event.target.value as NonNullable<BotFlowNode["captureType"]> }))}>
                {CAPTURE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>Salvar resposta na variável
              <input value={selectedNode.captureVariable ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, captureVariable: normalizeUiVariableName(event.target.value) }))} placeholder="ex: email_cliente" />
            </label>
            <label className={styles.field}>Fallback opcional se a resposta for inválida
              <span className={styles.textareaWithVariable}>
                <textarea value={selectedNode.captureFallbackText ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, captureFallbackText: event.target.value }))} placeholder="Deixe vazio para usar a saída Inválido do bloco." />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, captureFallbackText: appendVariable(node.captureFallbackText, variable) }))} />
              </span>
            </label>
          </>
        ) : null}
        {selectedNode.kind === "jump" ? (
          <label className={styles.field}>Pular para o bloco
            <select value={selectedNode.jumpTargetNodeId ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, jumpTargetNodeId: event.target.value }))}>
              <option value="">Selecione o destino</option>
              {flow.nodes
                .filter((node) => node.id !== selectedNode.id)
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.title || nodeDisplayKindLabel(node)} ({nodeDisplayKindLabel(node)})
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {selectedNode.kind === "condition" ? <ConditionEditor flow={flow} selectedNode={selectedNode} updateNode={updateNode} /> : null}
        {selectedNode.kind === "set_variable" ? (
          <>
            <label className={styles.field}>Ação<select value={selectedNode.variableOperation ?? "set"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, variableOperation: event.target.value as BotFlowNode["variableOperation"] }))}><option value="set">Definir valor</option><option value="append">Adicionar ao valor</option><option value="clear">Limpar variável</option></select></label>
            <label className={styles.field}>Nome da variável<input value={selectedNode.variableName ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, variableName: event.target.value }))} placeholder="ex: nome_cliente" /></label>
            {selectedNode.variableOperation !== "clear" ? (
              <label className={styles.field}>Valor
                <span className={styles.textareaWithVariable}>
                  <textarea value={selectedNode.variableValue ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, variableValue: event.target.value }))} placeholder="{{args}}" />
                  <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, variableValue: appendVariable(node.variableValue, variable) }))} />
                </span>
              </label>
            ) : null}
          </>
        ) : null}
        {selectedNode.kind === "integration" ? (
          <div className={styles.conditionEditor}>
            <label className={styles.field}>Banco
              <select value={selectedNode.databaseProvider ?? "mysql"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseProvider: event.target.value as BotFlowNode["databaseProvider"], databasePort: event.target.value === "postgres" ? 5432 : 3306 }))}>
                <option value="mysql">MySQL</option>
                <option value="postgres">PostgreSQL</option>
              </select>
            </label>
            <label className={styles.field}>Operação
              <select value={selectedNode.databaseOperation ?? "query"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseOperation: event.target.value as BotFlowNode["databaseOperation"] }))}>
                <option value="query">Query livre</option>
                <option value="select">Select</option>
                <option value="insert">Insert</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
              </select>
            </label>
            <label className={styles.field}>Host
              <span className={styles.inputWithVariable}>
                <input value={selectedNode.databaseHost ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseHost: event.target.value }))} />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, databaseHost: appendVariable(node.databaseHost, variable) }))} />
              </span>
            </label>
            <div className={styles.conditionComparisonCard}>
              <input value={selectedNode.databaseName ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseName: event.target.value }))} placeholder="Banco" />
              <input type="number" value={selectedNode.databasePort ?? 3306} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databasePort: Number(event.target.value) }))} placeholder="Porta" />
            </div>
            <div className={styles.conditionComparisonCard}>
              <input value={selectedNode.databaseUser ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseUser: event.target.value }))} placeholder="Usuário" />
              <input type="password" value={selectedNode.databasePassword ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databasePassword: event.target.value }))} placeholder="Senha/token" />
            </div>
            <label className={styles.field}>Tabela opcional<input value={selectedNode.databaseTable ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseTable: event.target.value }))} /></label>
            <label className={styles.field}>SQL
              <span className={styles.textareaWithVariable}>
                <textarea value={selectedNode.databaseQuery ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseQuery: event.target.value }))} />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, databaseQuery: appendVariable(node.databaseQuery, variable) }))} />
              </span>
            </label>
            <label className={styles.field}>Parâmetros JSON
              <span className={styles.textareaWithVariable}>
                <textarea value={selectedNode.databaseValuesJson ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseValuesJson: event.target.value }))} placeholder={'["{{numero}}"]'} />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, databaseValuesJson: appendVariable(node.databaseValuesJson, variable) }))} />
              </span>
            </label>
            <label className={styles.field}>Salvar resultado na variável<input value={selectedNode.databaseSaveResultVariable ?? ""} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, databaseSaveResultVariable: normalizeUiVariableName(event.target.value) }))} placeholder="db_resultado" /></label>
          </div>
        ) : null}
        {selectedNode.kind === "buttons" ? (
          <button type="button" className={styles.primaryButton} onClick={addButton}>
            <IconPlus size={15} /> Adicionar botão
          </button>
        ) : null}
        {selectedNode.kind !== "trigger" ? (
          <button type="button" className={styles.dangerButton} onClick={() => removeNode(selectedNode.id)}>
            <IconTrash size={14} /> Apagar bloco
          </button>
        ) : null}
      </div>
    </aside>
    {webhookMappingDraft ? (
      <div className={styles.webhookVariableModalBackdrop} role="presentation" onClick={() => setWebhookMappingDraft(null)}>
        <div
          className={styles.webhookVariableModal}
          role="dialog"
          aria-modal="true"
          aria-label="Personalizar variável do webhook"
          onClick={(event) => event.stopPropagation()}
        >
          <header>
            <div>
              <strong>Personalizar variável</strong>
              <span>{webhookMappingDraft.path}</span>
            </div>
            <button type="button" onClick={() => setWebhookMappingDraft(null)} aria-label="Fechar">
              <IconX size={15} />
            </button>
          </header>
          <small>{webhookMappingDraft.preview}</small>
          <label>
            Nome da variável
            <VariableNameInput
              value={webhookMappingDraft.variable}
              variables={variables}
              onChange={(value) =>
                setWebhookMappingDraft((current) =>
                  current ? { ...current, variable: normalizeUiVariableName(value) } : current,
                )
              }
            />
          </label>
          <footer>
            <button type="button" className={styles.ghostButton} onClick={() => setWebhookMappingDraft(null)}>
              Cancelar
            </button>
            <button type="button" className={styles.primaryButton} onClick={saveWebhookMappingDraft}>
              Salvar variável
            </button>
          </footer>
        </div>
      </div>
    ) : null}
    </>
  );
};

const FieldQuickEditor = ({
  flow,
  node,
  field,
  updateNode,
  uploadNodeMedia,
  clearNodeMedia,
  onClose,
}: {
  flow: BotFlow;
  node: BotFlowNode;
  field: FlowNodeEditableField;
  updateNode: (nodeId: string, updater: (node: BotFlowNode) => BotFlowNode) => void;
  uploadNodeMedia: (nodeId: string, file: File) => Promise<void>;
  clearNodeMedia: (nodeId: string) => void;
  onClose: () => void;
}) => {
  const variables = collectFlowVariables(flow);
  const appendVariable = (current: string | undefined, variable: string) => `${current ?? ""}{{${variable}}}`;
  const title =
    field === "headerTitle"
      ? "Editar título da mensagem"
      : field === "media"
        ? "Editar mídia do header"
        : "Editar mensagem";
  const handleMediaChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    await uploadNodeMedia(node.id, file);
    onClose();
  };

  return (
    <div className={styles.quickModalOverlay} role="presentation" onClick={onClose}>
      <div className={classNames(styles.quickButtonModal, styles.fieldQuickModal)} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="Fechar edição"><IconX size={15} /></button>
        </header>
        <div className={styles.quickNodeBody}>
          {field === "headerTitle" ? (
            <label className={styles.field}>Título da mensagem
              <span className={styles.inputWithVariable}>
                <input value={node.headerTitle ?? ""} onChange={(event) => updateNode(node.id, (current) => ({ ...current, headerTitle: event.target.value }))} autoFocus />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(node.id, (current) => ({ ...current, headerTitle: appendVariable(current.headerTitle, variable) }))} />
              </span>
            </label>
          ) : null}
          {field === "text" ? (
            <label className={styles.field}>Mensagem
              <span className={styles.textareaWithVariable}>
                <textarea value={node.text ?? ""} onChange={(event) => updateNode(node.id, (current) => ({ ...current, text: event.target.value }))} autoFocus />
                <VariablePicker variables={variables} onPick={(variable) => updateNode(node.id, (current) => ({ ...current, text: appendVariable(current.text, variable) }))} />
              </span>
            </label>
          ) : null}
          {field === "media" ? (
            <>
              {node.mediaUrl ? (
                <div className={styles.fieldMediaPreview}>
                  {renderFlowMediaPreview(node)}
                </div>
              ) : null}
              <label className={styles.quickUploadButton}>
                <IconPhoto size={16} />
                {node.mediaUrl ? "Trocar mídia" : "Adicionar mídia"}
                <input type="file" accept={flowMediaAccept(node)} onChange={handleMediaChange} />
              </label>
              {node.mediaUrl ? (
                <button type="button" className={styles.ghostButton} onClick={() => clearNodeMedia(node.id)}>
                  Remover mídia
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const ButtonQuickEditor = ({
  flow,
  node,
  button,
  updateButton,
  removeButton,
  onClose,
}: {
  flow: BotFlow;
  node: BotFlowNode;
  button: BotFlowButton;
  updateButton: (nodeId: string, buttonId: string, updater: (button: BotFlowButton) => BotFlowButton) => void;
  removeButton: (nodeId: string, buttonId: string) => void;
  onClose: () => void;
}) => {
  const variables = collectFlowVariables(flow);
  const appendVariable = (current: string | undefined, variable: string) => `${current ?? ""}{{${variable}}}`;
  return (
    <div className={styles.quickModalOverlay} role="presentation" onClick={onClose}>
      <div className={styles.quickButtonModal} role="dialog" aria-modal="true" aria-label="Editar botão" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Editar botão</strong>
          <button type="button" onClick={onClose} aria-label="Fechar edição"><IconX size={15} /></button>
        </header>
        <div className={styles.quickNodeBody}>
          <label className={styles.field}>Tipo<select value={button.type} onChange={(event) => updateButton(node.id, button.id, (current) => ({ ...current, type: event.target.value as BotFlowButton["type"] }))}><option value="reply">Resposta</option><option value="url">Link</option><option value="call">Ligar</option><option value="copy">Copiar</option></select></label>
          <label className={styles.field}>Texto
            <span className={styles.inputWithVariable}>
              <input value={button.label} onChange={(event) => updateButton(node.id, button.id, (current) => ({ ...current, label: event.target.value }))} />
              <VariablePicker variables={variables} onPick={(variable) => updateButton(node.id, button.id, (current) => ({ ...current, label: appendVariable(current.label, variable) }))} />
            </span>
          </label>
          <label className={styles.field}><span>{button.type === "url" ? "Link" : button.type === "call" ? "Telefone" : button.type === "copy" ? "Texto para copiar" : "Comando interno"}</span>
            <span className={styles.inputWithVariable}>
              <input value={button.value} onChange={(event) => updateButton(node.id, button.id, (current) => ({ ...current, value: event.target.value }))} placeholder={button.type === "url" ? "https://..." : button.type === "call" ? "+5592999999999" : button.type === "copy" ? "Código ou texto" : "/menu"} />
              <VariablePicker variables={variables} onPick={(variable) => updateButton(node.id, button.id, (current) => ({ ...current, value: appendVariable(current.value, variable) }))} />
            </span>
          </label>
          <button type="button" className={styles.dangerButton} onClick={() => { removeButton(node.id, button.id); onClose(); }}>
            <IconTrash size={14} /> Remover botão
          </button>
        </div>
      </div>
    </div>
  );
};

const VariablePicker = ({ variables, onPick }: { variables: string[]; onPick: (variable: string) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.variablePicker}>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-label="Selecionar variável">
        {"{}"}
      </button>
      {open ? (
        <span className={styles.variableMenu}>
          {variables.map((variable) => (
            <button
              key={variable}
              type="button"
              onClick={() => {
                onPick(variable);
                setOpen(false);
              }}
            >
              {variable}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
};

const HttpRequestEditor = ({
  flow,
  selectedNode,
  updateNode,
  removeNode,
  onClose,
}: {
  flow: BotFlow;
  selectedNode: BotFlowNode;
  updateNode: (nodeId: string, updater: (node: BotFlowNode) => BotFlowNode) => void;
  removeNode: (nodeId: string) => void;
  onClose: () => void;
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<HttpTestResult | null>(null);
  const variables = collectFlowVariables(flow);
  const resultSuggestions = testResult?.suggestions?.length ? testResult.suggestions : ["statusCode", "data.id", "data.name"];
  const appendVariable = (current: string | undefined, variable: string) => `${current ?? ""}{{${variable}}}`;
  const updateParam = (
    key: "httpQueryParams" | "httpHeaders",
    itemId: string,
    field: "key" | "value",
    value: string,
  ) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      [key]: ((node[key] ?? []) as Array<{ id: string; key: string; value: string }>).map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item,
      ),
    }));
  };
  const addParam = (key: "httpQueryParams" | "httpHeaders") => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      [key]: [
        ...(((node[key] ?? []) as Array<{ id: string; key: string; value: string }>)),
        { id: newId(key === "httpHeaders" ? "header" : "param"), key: "", value: "" },
      ],
    }));
  };
  const removeParam = (key: "httpQueryParams" | "httpHeaders", itemId: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      [key]: ((node[key] ?? []) as Array<{ id: string; key: string; value: string }>).filter((item) => item.id !== itemId),
    }));
  };
  const updateMapping = (itemId: string, field: "path" | "variable", value: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      httpResponseMappings: (node.httpResponseMappings ?? []).map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item,
      ),
    }));
  };
  const addMapping = () => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      httpResponseMappings: [
        ...(node.httpResponseMappings ?? []),
        { id: newId("map"), path: resultSuggestions[0] ?? "data.id", variable: "" },
      ],
    }));
  };
  const removeMapping = (itemId: string) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      httpResponseMappings: (node.httpResponseMappings ?? []).filter((item) => item.id !== itemId),
    }));
  };
  const testRequest = async () => {
    setTesting(true);
    setTestError("");
    try {
      const response = await fetch("/api/bot-flows/test-http", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: selectedNode.httpMethod ?? "GET",
          url: selectedNode.httpUrl ?? "",
          queryParams: selectedNode.httpQueryParams ?? [],
          headers: selectedNode.httpHeaders ?? [],
          body: selectedNode.httpBody ?? "",
          timeoutSeconds: selectedNode.httpTimeoutSeconds ?? 10,
          variables: Object.fromEntries(variables.map((variable) => [variable, variable === "args" ? "teste" : ""])),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Não foi possível testar a requisição.");
      setTestResult(payload as HttpTestResult);
      setSaveOpen(true);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Não foi possível testar a requisição.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <aside className={classNames(styles.quickNodeEditor, styles.httpEditorPanel)} aria-label="Editar requisição HTTP">
      <div className={styles.httpEditorUrlRow}>
        <input
          value={selectedNode.httpUrl ?? ""}
          onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, httpUrl: event.target.value }))}
          placeholder="https://api.exemplo.com/endpoint"
        />
        <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, httpUrl: appendVariable(node.httpUrl, variable) }))} />
        <button type="button" className={styles.httpEditorClose} onClick={onClose} aria-label="Fechar edição">
          <IconX size={14} />
        </button>
      </div>

      <div className={styles.httpAccordion}>
        <button type="button" className={styles.httpAccordionHeader} onClick={() => setAdvancedOpen((current) => !current)}>
          <strong>Advanced configuration</strong>
          <span>{advancedOpen ? "⌃" : "⌄"}</span>
        </button>
        {advancedOpen ? (
          <div className={styles.httpAccordionBody}>
            <label className={styles.httpToggleRow}>
              <span>Execute on client</span>
              <input type="checkbox" disabled />
            </label>
            <label className={styles.httpInlineField}>
              <span>Method:</span>
              <select value={selectedNode.httpMethod ?? "GET"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, httpMethod: event.target.value as BotFlowNode["httpMethod"] }))}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </label>

            <HttpKeyValueSection
              title="Query params"
              items={selectedNode.httpQueryParams ?? []}
              variables={variables}
              onAdd={() => addParam("httpQueryParams")}
              onRemove={(itemId) => removeParam("httpQueryParams", itemId)}
              onChange={(itemId, field, value) => updateParam("httpQueryParams", itemId, field, value)}
            />
            <HttpKeyValueSection
              title="Headers"
              items={selectedNode.httpHeaders ?? []}
              variables={variables}
              onAdd={() => addParam("httpHeaders")}
              onRemove={(itemId) => removeParam("httpHeaders", itemId)}
              onChange={(itemId, field, value) => updateParam("httpHeaders", itemId, field, value)}
            />

            <div className={styles.httpSubAccordion}>
              <button type="button" onClick={() => setBodyOpen((current) => !current)}>
                <strong>Body</strong>
                <span>{bodyOpen ? "⌃" : "⌄"}</span>
              </button>
              {bodyOpen ? (
                <div className={styles.httpBodyEditor}>
                  <textarea
                    value={selectedNode.httpBody ?? ""}
                    onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, httpBody: event.target.value }))}
                    placeholder={'{\n  "nome": "{{usuario}}"\n}'}
                  />
                  <VariablePicker variables={variables} onPick={(variable) => updateNode(selectedNode.id, (node) => ({ ...node, httpBody: appendVariable(node.httpBody, variable) }))} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <button type="button" className={styles.httpTestButton} onClick={() => void testRequest()} disabled={testing}>
        {testing ? "Testing..." : "Test the request"}
      </button>
      {testError ? <p className={styles.httpError}>{testError}</p> : null}
      {testResult ? (
        <pre className={styles.httpResultPreview}>
{JSON.stringify(testResult.json ?? testResult.text ?? { statusCode: testResult.statusCode }, null, 2)}
        </pre>
      ) : null}

      <div className={styles.httpAccordion}>
        <button type="button" className={styles.httpAccordionHeader} onClick={() => setSaveOpen((current) => !current)}>
          <strong>Save in variables</strong>
          <span>{saveOpen ? "⌃" : "⌄"}</span>
        </button>
        {saveOpen ? (
          <div className={styles.httpAccordionBody}>
            {(selectedNode.httpResponseMappings ?? []).map((mapping) => (
              <div key={mapping.id} className={styles.httpMappingCard}>
                <button type="button" className={styles.httpRemoveLine} onClick={() => removeMapping(mapping.id)} aria-label="Remover mapeamento">
                  <IconTrash size={13} />
                </button>
                <label>
                  <span>Data:</span>
                  <DataPathInput
                    value={mapping.path}
                    suggestions={resultSuggestions}
                    onChange={(value) => updateMapping(mapping.id, "path", value)}
                  />
                </label>
                <label>
                  <span>Set variable:</span>
                  <VariableNameInput
                    value={mapping.variable}
                    variables={variables}
                    onChange={(value) => updateMapping(mapping.id, "variable", value)}
                  />
                </label>
              </div>
            ))}
            <button type="button" className={styles.httpAddValueButton} onClick={addMapping}>
              <IconPlus size={15} /> Add an entry
            </button>
          </div>
        ) : null}
      </div>

      <button type="button" className={styles.httpDeleteBlock} onClick={() => removeNode(selectedNode.id)}>
        <IconTrash size={14} /> Apagar bloco
      </button>
    </aside>
  );
};

const HttpKeyValueSection = ({
  title,
  items,
  variables,
  onAdd,
  onRemove,
  onChange,
}: {
  title: string;
  items: Array<{ id: string; key: string; value: string }>;
  variables: string[];
  onAdd: () => void;
  onRemove: (itemId: string) => void;
  onChange: (itemId: string, field: "key" | "value", value: string) => void;
}) => (
  <section className={styles.httpKeyValueSection}>
    <strong>{title}</strong>
    {items.map((item) => (
      <div key={item.id} className={styles.httpKeyValueCard}>
        <button type="button" className={styles.httpRemoveLine} onClick={() => onRemove(item.id)} aria-label="Remover linha">
          <IconTrash size={13} />
        </button>
        <label>
          <span>Key:</span>
          <input value={item.key} onChange={(event) => onChange(item.id, "key", event.target.value)} placeholder="e.g. Content-Type" />
        </label>
        <label>
          <span>Value:</span>
          <span className={styles.httpInputWithVariable}>
            <input value={item.value} onChange={(event) => onChange(item.id, "value", event.target.value)} placeholder="e.g. application/json" />
            <VariablePicker variables={variables} onPick={(variable) => onChange(item.id, "value", `${item.value}{{${variable}}}`)} />
          </span>
        </label>
      </div>
    ))}
    <button type="button" className={styles.httpAddValueButton} onClick={onAdd}>
      <IconPlus size={15} /> Add a value
    </button>
  </section>
);

const DataPathInput = ({
  value,
  suggestions,
  onChange,
}: {
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const filteredSuggestions = suggestions
    .filter((suggestion) => suggestion.toLowerCase().includes(value.trim().toLowerCase()))
    .slice(0, 12);
  return (
    <span className={styles.httpSmartInput}>
      <input
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        placeholder="Select the data"
      />
      {open && filteredSuggestions.length > 0 ? (
        <span className={styles.httpDataDropdown}>
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(suggestion);
                setOpen(false);
              }}
            >
              {suggestion}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
};

const VariableNameInput = ({
  value,
  variables,
  onChange,
}: {
  value: string;
  variables: string[];
  onChange: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const normalizedValue = normalizeUiVariableName(value);
  const filteredVariables = variables
    .filter((variable) => variable.toLowerCase().includes(normalizedValue.toLowerCase()))
    .slice(0, 8);
  const canCreate = normalizedValue && !variables.some((variable) => variable.toLowerCase() === normalizedValue.toLowerCase());
  return (
    <span className={styles.httpVariableInput}>
      <input
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange(normalizeUiVariableName(event.target.value));
          setOpen(true);
        }}
        placeholder="Search for a variable"
      />
      <button type="button" aria-label="Configurar variável" onClick={() => setOpen((current) => !current)}>
        <IconSettings size={14} />
      </button>
      {open && (canCreate || filteredVariables.length > 0) ? (
        <span className={styles.httpVariableDropdown}>
          {canCreate ? (
            <button
              type="button"
              className={styles.httpCreateVariable}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(normalizedValue);
                setOpen(false);
              }}
            >
              <IconPlus size={13} />
              Criar <strong>{normalizedValue}</strong>
            </button>
          ) : null}
          {filteredVariables.map((variable) => (
            <button
              key={variable}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(variable);
                setOpen(false);
              }}
            >
              {variable}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
};

const CONDITION_OPERATORS: Array<{ value: NonNullable<BotFlowNode["conditionOperator"]>; label: string }> = [
  { value: "equals", label: "É igual" },
  { value: "not_equals", label: "É diferente" },
  { value: "contains", label: "Contém" },
  { value: "not_contains", label: "Não contém" },
  { value: "greater_than", label: "Maior ou igual" },
  { value: "less_than", label: "Menor ou igual" },
  { value: "is_set", label: "Está preenchido" },
  { value: "is_empty", label: "Está vazio" },
  { value: "starts_with", label: "Começa com" },
  { value: "ends_with", label: "Termina com" },
  { value: "matches_regex", label: "Combina com regex" },
  { value: "not_matches_regex", label: "Não combina com regex" },
];

const ConditionEditor = ({
  flow,
  selectedNode,
  updateNode,
}: {
  flow: BotFlow;
  selectedNode: BotFlowNode;
  updateNode: (nodeId: string, updater: (node: BotFlowNode) => BotFlowNode) => void;
}) => {
  const variables = collectFlowVariables(flow);
  const rules = selectedNode.conditionRules?.length
    ? selectedNode.conditionRules
    : [{ id: "rule_1", variable: selectedNode.conditionVariable ?? "args", operator: selectedNode.conditionOperator ?? "contains", value: selectedNode.conditionValue ?? "" }];
  const updateRule = (
    ruleId: string,
    updater: (rule: NonNullable<BotFlowNode["conditionRules"]>[number]) => NonNullable<BotFlowNode["conditionRules"]>[number],
  ) => {
    updateNode(selectedNode.id, (node) => {
      const nextRules = (node.conditionRules?.length ? node.conditionRules : rules).map((rule) => (rule.id === ruleId ? updater(rule) : rule));
      const first = nextRules[0];
      return {
        ...node,
        conditionRules: nextRules,
        conditionVariable: first?.variable ?? "args",
        conditionOperator: first?.operator ?? "contains",
        conditionValue: first?.value ?? "",
      };
    });
  };
  const addRule = () => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      conditionRules: [
        ...(node.conditionRules?.length ? node.conditionRules : rules),
        { id: newId("rule"), variable: "args", operator: "contains", value: "" },
      ],
    }));
  };
  const removeRule = (ruleId: string) => {
    updateNode(selectedNode.id, (node) => {
      const nextRules = (node.conditionRules?.length ? node.conditionRules : rules).filter((rule) => rule.id !== ruleId);
      const safeRules = nextRules.length ? nextRules : [{ id: "rule_1", variable: "args", operator: "contains" as const, value: "" }];
      const first = safeRules[0];
      return {
        ...node,
        conditionRules: safeRules,
        conditionVariable: first.variable,
        conditionOperator: first.operator,
        conditionValue: first.value,
      };
    });
  };
  return (
    <div className={styles.conditionEditor}>
      <div className={styles.ruleHint}><strong>Saídas da condição</strong><span>Conecte IF e Else para decidir o caminho do fluxo.</span></div>
      <label className={styles.field}>Lógica<select value={selectedNode.conditionLogic ?? "AND"} onChange={(event) => updateNode(selectedNode.id, (node) => ({ ...node, conditionLogic: event.target.value as "AND" | "OR" }))}><option value="AND">Todas as comparações precisam bater</option><option value="OR">Qualquer comparação pode bater</option></select></label>
      {rules.map((rule, index) => (
        <div key={rule.id} className={styles.conditionComparisonCard}>
          {rules.length > 1 ? (
            <button type="button" className={styles.conditionRemoveButton} onClick={() => removeRule(rule.id)} aria-label="Remover comparação">
              <IconTrash size={13} />
            </button>
          ) : null}
          {index > 0 ? (
            <div className={styles.conditionJoinLabel}>{selectedNode.conditionLogic === "OR" ? "OU" : "E"}</div>
          ) : null}
          <VariableNameInput value={rule.variable} variables={variables} onChange={(value) => updateRule(rule.id, (current) => ({ ...current, variable: value }))} />
          <select value={rule.operator} onChange={(event) => updateRule(rule.id, (current) => ({ ...current, operator: event.target.value as NonNullable<BotFlowNode["conditionOperator"]> }))}>
            <option value="">Selecione um operador</option>
            {CONDITION_OPERATORS.map((operator, index) => (
              <option key={`${operator.value}-${index}`} value={operator.value}>{operator.label}</option>
            ))}
          </select>
          {rule.operator !== "is_set" && rule.operator !== "is_empty" ? (
            <span className={styles.httpInputWithVariable}>
              <input value={rule.value} onChange={(event) => updateRule(rule.id, (current) => ({ ...current, value: event.target.value }))} placeholder="Digite um valor..." />
              <VariablePicker variables={variables} onPick={(variable) => updateRule(rule.id, (current) => ({ ...current, value: `${current.value ?? ""}{{${variable}}}` }))} />
            </span>
          ) : null}
        </div>
      ))}
      <button type="button" className={styles.httpAddValueButton} onClick={addRule}>
        <IconPlus size={15} /> Adicionar comparação
      </button>
    </div>
  );
};

const UserFlowBuilder = (props: Props) => (
  <ReactFlowProvider>
    <UserFlowBuilderInner {...props} />
  </ReactFlowProvider>
);

export default UserFlowBuilder;
