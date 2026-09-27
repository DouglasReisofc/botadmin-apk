import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "path";
import { z } from "zod";

import {
  completeChatGptPhoneJob,
  createAndRunBotInterageChatGptPhoneJob,
  createChatGptPhoneJob,
  type ChatGptPhoneArtifact,
  type ChatGptPhoneInputAttachment,
  getChatGptPhoneJob,
  getChatGptPhoneJobMcpContext,
  listBotInterageContextEvents,
  runChatGptPhoneJob,
} from "lib/chatgpt-phone";
import { getAppBaseUrl } from "lib/meta";
import { resolveUploadedFileUrl, saveBufferAsUploadedFile } from "lib/uploads";
import { getOrCreateUserApiKey } from "lib/user-api-keys";
import { getDb } from "lib/db";
import { syncGroupInfo } from "lib/bot-groups";
import { createSweepstake, findActiveSweepstakeByGroup } from "lib/bot-sweepstakes";
import { sendPollMessage, resolveWhatsappLidsToPhones } from "lib/wuzapi";
import { resolveBotAutomationGuard } from "lib/bot-automation-guard";

const jsonText = (value: unknown) => JSON.stringify(value, null, 2);

const toolResult = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: jsonText(value),
    },
  ],
  structuredContent: value as Record<string, unknown>,
});

const previewText = (value?: string | null, maxLength = 180): string | null => {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const normalizeParticipantPhone = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const local = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
  return local || null;
};

const participantLabel = (participant: Record<string, unknown>): string | null => {
  for (const key of ["name", "notify", "pushName", "verifiedName", "displayName"]) {
    const value = typeof participant[key] === "string" ? participant[key].trim() : "";
    if (value) return value;
  }
  return null;
};

const normalizeParticipant = (participant: Record<string, unknown>) => {
  const phone = normalizeParticipantPhone(participant.phone ?? participant.id ?? participant.jid ?? participant.user);
  const role = String(participant.admin ?? participant.role ?? "member").toLowerCase();
  const name = participantLabel(participant);
  return {
    phone,
    name,
    display: name && phone ? `${name} (${phone})` : name ?? phone,
    role: role === "superadmin" || role === "admin" ? role : "member",
  };
};

const summarizeChatGptPhoneJob = (job: Awaited<ReturnType<typeof completeChatGptPhoneJob>>) => ({
  jobId: job.jobId,
  status: job.status,
  resultType: job.resultType,
  responsePreview: previewText(job.responseText),
  artifactsCount: job.artifacts.length,
  workerId: job.workerId,
  completedAt: job.completedAt,
});

const logMcpTool = (event: string, details: Record<string, unknown>) => {
  console.info(`[mcp] ${event}`, details);
};

const closedReadToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const closedWriteToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const optionalPositiveInt = () => z.number().int().positive().optional();
const optionalString = () => z.string().min(1).optional();
const MCP_UPLOAD_MAX_BYTES = Math.max(
  1024,
  Number(process.env.BOTADMIN_MCP_UPLOAD_MAX_BYTES ?? 32 * 1024 * 1024),
);

const stripAccents = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const normalizeSenderJidForLookup = (input: {
  senderJid?: string | null;
  senderPhone?: string | null;
}): string | undefined => {
  const jid = input.senderJid?.trim();
  if (jid) {
    if (jid.includes("@")) {
      return jid;
    }
    const jidDigits = jid.replace(/\D+/g, "");
    if (jidDigits) {
      return `${jidDigits}@s.whatsapp.net`;
    }
  }

  const phoneDigits = input.senderPhone?.replace(/\D+/g, "");
  return phoneDigits ? `${phoneDigits}@s.whatsapp.net` : undefined;
};

const extensionFromMime = (mimeType: string): string => {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() || "";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "audio/mp4") return ".m4a";
  if (normalized === "application/pdf") return ".pdf";
  const suffix = normalized.split("/")[1]?.replace(/[^a-z0-9]+/gi, "");
  return suffix ? `.${suffix}` : ".bin";
};

const safeUploadFileName = (value?: string | null, mimeType = "application/octet-stream"): string => {
  const raw = value?.trim() || `botadmin-upload-${Date.now()}${extensionFromMime(mimeType)}`;
  const base = path.basename(raw).replace(/[^a-z0-9._-]+/gi, "_") || `botadmin-upload-${Date.now()}`;
  return path.extname(base) ? base : `${base}${extensionFromMime(mimeType)}`;
};

const parseDataUrl = (value: string): { buffer: Buffer; mimeType: string } => {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    throw new Error("dataUrl inválido.");
  }
  const mimeType = match[1]?.trim() || "application/octet-stream";
  const raw = match[3] ?? "";
  const buffer = match[2] ? Buffer.from(raw, "base64") : Buffer.from(decodeURIComponent(raw));
  return { buffer, mimeType };
};

const bufferFromBase64 = (value: string): Buffer => {
  const cleaned = value.replace(/^data:[^,]+,/i, "").replace(/\s+/g, "");
  return Buffer.from(cleaned, "base64");
};

const fileNameFromContentDisposition = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
};

const downloadTemporaryUrl = async (url: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  fileName: string | null;
}> => {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL temporária deve usar http ou https.");
  }
  const response = await fetch(url, {
    headers: { accept: "*/*" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar URL temporária: HTTP ${response.status}.`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MCP_UPLOAD_MAX_BYTES) {
    throw new Error(`Arquivo maior que o limite de ${MCP_UPLOAD_MAX_BYTES} bytes.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MCP_UPLOAD_MAX_BYTES) {
    throw new Error(`Arquivo maior que o limite de ${MCP_UPLOAD_MAX_BYTES} bytes.`);
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream";
  const headerName = fileNameFromContentDisposition(response.headers.get("content-disposition"));
  const urlName = (() => {
    try {
      return path.basename(new URL(url).pathname) || null;
    } catch {
      return null;
    }
  })();
  return { buffer, mimeType, fileName: headerName ?? urlName };
};

const materializeMcpUpload = async (input: {
  base64?: string | null;
  dataUrl?: string | null;
  url?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  folder: string;
}): Promise<{
  artifact: ChatGptPhoneArtifact;
  attachment: ChatGptPhoneInputAttachment;
  storedPath: string;
  publicUrl: string;
  bytes: number;
}> => {
  let buffer: Buffer;
  let mimeType = input.mimeType?.split(";")[0]?.trim().toLowerCase() || "";
  let fileName = input.fileName?.trim() || "";

  if (input.dataUrl?.trim()) {
    const parsed = parseDataUrl(input.dataUrl.trim());
    buffer = parsed.buffer;
    mimeType ||= parsed.mimeType;
  } else if (input.base64?.trim()) {
    buffer = bufferFromBase64(input.base64.trim());
  } else if (input.url?.trim()) {
    const downloaded = await downloadTemporaryUrl(input.url.trim());
    buffer = downloaded.buffer;
    mimeType ||= downloaded.mimeType;
    fileName ||= downloaded.fileName ?? "";
  } else {
    throw new Error("Informe base64, dataUrl ou url.");
  }

  if (buffer.byteLength <= 0) {
    throw new Error("Arquivo vazio.");
  }
  if (buffer.byteLength > MCP_UPLOAD_MAX_BYTES) {
    throw new Error(`Arquivo maior que o limite de ${MCP_UPLOAD_MAX_BYTES} bytes.`);
  }

  mimeType ||= "application/octet-stream";
  const finalFileName = safeUploadFileName(fileName, mimeType);
  const storedPath = await saveBufferAsUploadedFile(buffer, input.folder, {
    fixedFileName: finalFileName,
    forceExtension: path.extname(finalFileName) || extensionFromMime(mimeType),
  });
  const relativeUrl = resolveUploadedFileUrl(storedPath);
  const publicUrl = new URL(relativeUrl, `${getAppBaseUrl().replace(/\/+$/, "")}/`).toString();
  return {
    artifact: {
      url: publicUrl,
      path: storedPath,
      mimeType,
      fileName: finalFileName,
    },
    attachment: {
      name: finalFileName,
      mimeType,
      base64: buffer.toString("base64"),
    },
    storedPath,
    publicUrl,
    bytes: buffer.byteLength,
  };
};

const mcpUploadInputSchema = {
  jobId: z.string().uuid(),
  accessCode: z.string().uuid(),
  base64: optionalString(),
  dataUrl: optionalString(),
  url: optionalString(),
  mimeType: optionalString(),
  fileName: optionalString(),
  purpose: z.enum(["result", "attachment", "temporary"]).optional(),
  completeJob: z.boolean().optional(),
  responseText: z.string().optional(),
};

const mcpResultArtifactSchema = z.object({
  url: optionalString(),
  path: optionalString(),
  base64: optionalString(),
  dataUrl: optionalString(),
  mimeType: optionalString(),
  fileName: optionalString(),
  name: optionalString(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const mcpCompleteJobInputSchema = {
  jobId: z.string().uuid(),
  accessCode: z.string().uuid(),
  ok: z.boolean().optional(),
  resultType: z.enum(["text", "media", "file", "play", "error"]).optional(),
  text: z.string().optional(),
  responseText: z.string().optional(),
  error: z.string().optional(),
  playQuery: optionalString(),
  playKind: z.enum(["audio", "video"]).optional(),
  artifacts: z.array(mcpResultArtifactSchema).max(8).optional(),
  conversationId: optionalString(),
  messageId: optionalString(),
  interceptKey: optionalString(),
};

const MCP_SEARCH_COMPLETE_MARKER = "BOTADMIN_COMPLETE_JSON";

const buildSearchCompletionQuery = (input: {
  jobId: string;
  accessCode: string;
  resultType?: "text" | "media" | "file" | "play" | "error";
  text?: string;
  error?: string;
  playQuery?: string;
  playKind?: "audio" | "video";
}): string => {
  const payload: Record<string, string> = {
    jobId: input.jobId,
    k: input.accessCode,
    resultType: input.resultType ?? "text",
  };
  if (input.text) {
    payload.text = input.text;
  }
  if (input.error) {
    payload.error = input.error;
  }
  if (input.playQuery) {
    payload.playQuery = input.playQuery;
  }
  if (input.playKind) {
    payload.playKind = input.playKind;
  }
  return `${MCP_SEARCH_COMPLETE_MARKER} ${JSON.stringify(payload)}`;
};

const buildSearchFallbackInstruction = (jobId: string, accessCode: string): string => {
  const textExample = buildSearchCompletionQuery({
    jobId,
    accessCode,
    resultType: "text",
    text: "resposta final",
  });
  const errorExample = buildSearchCompletionQuery({
    jobId,
    accessCode,
    resultType: "error",
    error: "Nao foi possivel concluir agora. Tente novamente em instantes.",
  });
  const playExample = buildSearchCompletionQuery({
    jobId,
    accessCode,
    resultType: "play",
    playQuery: "url ou termo escolhido",
    playKind: "audio",
  });
  return [
    "RETORNO OBRIGATORIO PELO BOTADMIN:",
    "Use preferencialmente search como etapa final.",
    `Se essas ferramentas finais nao aparecerem, chame a ferramenta search com query exatamente neste formato para texto: ${textExample}`,
    `Para erro, chame search com query: ${errorExample}`,
    `Para musica/video/download, chame search com query: ${playExample}`,
    "Depois que search retornar Resultado recebido pelo BotAdmin, nao repita a resposta final no chat visivel.",
  ].join("\n");
};

const readPayloadString = (payload: Record<string, unknown>, key: string): string | undefined => {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const parseMcpSearchCompletionPayload = (query: string): Record<string, unknown> | null => {
  const markerIndex = query.indexOf(MCP_SEARCH_COMPLETE_MARKER);
  if (markerIndex < 0) {
    return null;
  }
  const start = query.indexOf("{", markerIndex);
  const end = query.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      ok: false,
      message: `Use ${MCP_SEARCH_COMPLETE_MARKER} seguido de um JSON valido.`,
    };
  }
  try {
    const parsed = JSON.parse(query.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {
          ok: false,
          message: "Payload de conclusao precisa ser um objeto JSON.",
        };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "JSON de conclusao invalido.",
    };
  }
};

const completeJobFromSearchBridge = async (payload: Record<string, unknown>) => {
  if (payload.ok === false && !readPayloadString(payload, "jobId")) {
    return payload;
  }
  const jobId = readPayloadString(payload, "jobId");
  const accessCode =
    readPayloadString(payload, "accessCode") ??
    readPayloadString(payload, "key") ??
    readPayloadString(payload, "k");
  if (!jobId || !accessCode) {
    return { ok: false, message: "Informe jobId e k no JSON de conclusao." };
  }

  const context = await getChatGptPhoneJobMcpContext({ jobId, accessCode });
  if (!context) {
    logMcpTool("search_bridge_invalid", { jobId });
    return { ok: false, message: "Job inexistente ou accessCode invalido." };
  }

  const resultType = readPayloadString(payload, "resultType") ?? "text";
  const isOk = typeof payload.ok === "boolean" ? payload.ok : resultType !== "error";
  const error = readPayloadString(payload, "error");
  const responseText = readPayloadString(payload, "responseText") ?? readPayloadString(payload, "text");
  const uploadBase64 = readPayloadString(payload, "base64");
  const uploadDataUrl = readPayloadString(payload, "dataUrl");
  const uploadUrl = readPayloadString(payload, "url");
  const hasUpload = Boolean(uploadBase64 || uploadDataUrl || uploadUrl);

  if (!isOk && !error) {
    return {
      ok: false,
      message: "Informe error quando ok=false ou resultType=error.",
    };
  }

  let finalResultType = resultType === "error" ? "text" : resultType;
  let finalResult = responseText;
  let artifacts: ChatGptPhoneArtifact[] =
    Array.isArray(payload.artifacts) ? (payload.artifacts as ChatGptPhoneArtifact[]) : [];

  if (resultType === "play") {
    const playQuery = readPayloadString(payload, "playQuery") ?? responseText;
    if (!playQuery) {
      return { ok: false, message: "Informe playQuery para concluir play/download." };
    }
    finalResult = `BOTADMIN_PLAY_SELECTION ${JSON.stringify({
      query: playQuery,
      kind: readPayloadString(payload, "playKind") ?? "audio",
    })}`;
  } else if (hasUpload) {
    const materialized = await materializeMcpUpload({
      base64: uploadBase64,
      dataUrl: uploadDataUrl,
      url: uploadUrl,
      mimeType: readPayloadString(payload, "mimeType"),
      fileName: readPayloadString(payload, "fileName"),
      folder: `chatgpt-phone/${jobId}`,
    });
    finalResultType = resultType === "file" ? "file" : "media";
    artifacts = [materialized.artifact];
  }

  if (isOk && !finalResult && artifacts.length === 0) {
    return {
      ok: false,
      message: "Informe text/responseText, playQuery, url, dataUrl, base64 ou artifacts.",
    };
  }

  const job = await completeChatGptPhoneJob({
    jobId,
    workerId: "mcp-chatgpt-search",
    payload: {
      ok: isOk,
      resultType: finalResultType,
      result: finalResult,
      error,
      artifacts,
      conversationId: readPayloadString(payload, "conversationId"),
      messageId: readPayloadString(payload, "messageId"),
      interceptKey: readPayloadString(payload, "interceptKey"),
    },
  });
  const summary = summarizeChatGptPhoneJob(job);
  logMcpTool("search_bridge_completed", {
    jobId,
    groupId: context.job.groupId,
    status: job.status,
    resultType: job.resultType,
    responsePreview: summary.responsePreview,
    artifactsCount: summary.artifactsCount,
  });
  return {
    ok: job.status === "succeeded",
    message: "Resultado recebido pelo BotAdmin via search.",
    job: summary,
    results: [
      {
        id: `botadmin_job_completed:${jobId}`,
        title: "Resultado recebido pelo BotAdmin",
        url: "https://botadmin.shop/mcp",
        text: "Job concluido. Nao repita a resposta final no chat.",
      },
    ],
  };
};

const mcpAttachmentSchema = z.object({
  base64: optionalString(),
  dataUrl: optionalString(),
  url: optionalString(),
  mimeType: optionalString(),
  fileName: optionalString(),
});

const normalizeDownloadQuery = (value: string): string => {
  const original = value.trim();
  if (!original) {
    return "";
  }
  const urlMatch = original.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    return urlMatch[0];
  }
  return original
    .replace(/@\d{5,}/g, " ")
    .replace(/@\S+/g, " ")
    .replace(/\b(?:niako|bot|rob[oô])\b/gi, " ")
    .replace(/^(?:por favor\s+)?(?:voce|você)?\s*(?:pode(?:ria)?\s+)?(?:me\s+)?(?:baix(?:a|ar|e)|manda(?:r)?|envia(?:r)?|toca(?:r)?|procura(?:r)?|pesquisa(?:r)?|abre|coloca)\s+/i, "")
    .replace(/^(?:a|o|um|uma|aquele|aquela|essa|esse)?\s*(?:m[uú]sica|som|[aá]udio|mp3|v[ií]deo|mp4|clipe)\s+(?:de|do|da)?\s*/i, "")
    .replace(/\b(?:pra|para)\s+mim\b/gi, " ")
    .replace(/\bpor favor\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || original;
};

export const createBotAdminMcpServer = (options: { publicMode?: boolean } = {}): McpServer => {
  const server = new McpServer({
    name: "botadmin-local",
    version: "1.0.0",
  });

  const probePhrase =
    process.env.BOTADMIN_MCP_PROBE_PHRASE?.trim() ||
    "BOTADMIN_MCP_PROBE_2026_05_20_OK";

  server.registerTool(
    "search",
    {
      title: "Pesquisar ou finalizar job BotAdmin",
      description:
        "Ferramenta do BotAdmin para buscar contexto e tambem finalizar jobs quando as ferramentas finais nao aparecerem. Para concluir, use query: BOTADMIN_COMPLETE_JSON {\"jobId\":\"...\",\"accessCode\":\"...\",\"resultType\":\"text\",\"text\":\"resposta final\"}.",
      annotations: closedReadToolAnnotations,
      inputSchema: {
        query: z.string().min(1),
      },
    },
    async ({ query }) => {
      logMcpTool("search", { queryPreview: previewText(query, 180) });
      const completionPayload = parseMcpSearchCompletionPayload(query);
      if (completionPayload) {
        return toolResult(await completeJobFromSearchBridge(completionPayload));
      }

      const results = [
        {
          id: "botadmin_mcp_probe",
          title: "Diagnostico publico do MCP BotAdmin",
          url: "https://botadmin.shop/mcp",
          text: `Use fetch com id botadmin_mcp_probe para validar o conector. Frase de prova disponivel no servidor.`,
        },
      ];

      const jobId = query.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
      const accessCode = query.match(/access(?:Code|code)?\s*[:=]\s*([0-9a-f-]{36})/i)?.[1];
      if (jobId && accessCode) {
        const context = await getChatGptPhoneJobMcpContext({ jobId, accessCode });
        if (context) {
          results.push({
            id: `chatgpt_phone_job:${jobId}:${accessCode}`,
            title: `Contexto BotInterage job ${jobId}`,
            url: `https://botadmin.shop/mcp#${jobId}`,
            text: [
              "Contexto privado liberado por accessCode temporario do job.",
              buildSearchFallbackInstruction(jobId, accessCode),
            ].join("\n\n"),
          });
        }
      }

      return toolResult({
        results,
        instruction:
          jobId && accessCode
            ? buildSearchFallbackInstruction(jobId, accessCode)
            : `Para finalizar um job pelo search, use: ${MCP_SEARCH_COMPLETE_MARKER} {"jobId":"...","accessCode":"...","resultType":"text","text":"resposta final"}`,
      });
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Ler documento do BotAdmin",
      description:
        "Busca o conteudo completo de um item retornado por search. Para contexto privado, use id chatgpt_phone_job:<jobId>:<accessCode>.",
      annotations: closedReadToolAnnotations,
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      logMcpTool("fetch", { idPreview: previewText(id, 180) });
      const completionPayload = parseMcpSearchCompletionPayload(id);
      if (completionPayload) {
        return toolResult(await completeJobFromSearchBridge(completionPayload));
      }

      if (id === "botadmin_mcp_probe") {
        return toolResult({
          id,
          title: "Diagnostico publico do MCP BotAdmin",
          text: [
            "O MCP publico do BotAdmin esta conectado.",
            `Frase de prova: ${probePhrase}`,
            "Este endpoint publico nao retorna historico de grupos sem um accessCode de job.",
          ].join("\n"),
          url: "https://botadmin.shop/mcp",
        });
      }

      const match = id.match(/^chatgpt_phone_job:([^:]+):([^:]+)$/);
      if (match) {
        const context = await getChatGptPhoneJobMcpContext({
          jobId: match[1],
          accessCode: match[2],
        });
        if (!context) {
          return toolResult({
            id,
            title: "Contexto nao encontrado",
            text: "Job inexistente ou accessCode invalido.",
          });
        }

        return toolResult({
          id,
          title: `Contexto BotInterage job ${context.job.jobId}`,
          text: [
            context.events
              .map((event) => `${event.createdAt} [${event.role}] ${event.senderName ?? event.senderJid ?? "bot"}: ${event.content}`)
              .join("\n"),
            buildSearchFallbackInstruction(match[1], match[2]),
          ].join("\n\n"),
          job: context.job,
          events: context.events,
          completionInstruction: buildSearchFallbackInstruction(match[1], match[2]),
        });
      }

      return toolResult({
        id,
        title: "Documento nao encontrado",
        text: "Nenhum documento encontrado para esse id.",
      });
    },
  );

  server.registerTool(
    "botadmin_probe",
    {
      title: "Provar conexao MCP",
      description: "Retorna uma frase de prova que o ChatGPT so consegue saber chamando o MCP BotAdmin.",
      annotations: closedReadToolAnnotations,
      inputSchema: {},
    },
    async () => toolResult({ phrase: probePhrase, serverTime: new Date().toISOString() }),
  );

  server.registerTool(
    "botadmin_get_job_context",
    {
      title: "Buscar contexto privado de um job",
      description:
        "Retorna contexto de BotInterage para um job especifico quando o prompt inclui jobId e accessCode. Depois de consultar, sempre conclua com botadmin_reply_text, botadmin_complete_job ou botadmin_upload_file.",
      annotations: closedReadToolAnnotations,
      inputSchema: {
        jobId: z.string().uuid(),
        accessCode: z.string().uuid(),
        senderJid: optionalString(),
        senderPhone: optionalString(),
        limit: z.number().int().min(1).max(80).optional(),
      },
    },
    async ({ jobId, accessCode, senderJid, senderPhone, limit }) => {
      const context = await getChatGptPhoneJobMcpContext({ jobId, accessCode });
      if (!context) {
        logMcpTool("get_job_context_invalid", { jobId });
        return toolResult({ ok: false, message: "Job inexistente ou accessCode invalido." });
      }
      logMcpTool("get_job_context", {
        jobId,
        groupId: context.job.groupId,
        senderPhone: senderPhone ?? null,
        events: context.events.length,
      });
      const normalizedSenderJid = normalizeSenderJidForLookup({ senderJid, senderPhone });
      if (normalizedSenderJid && context.job.groupId) {
        const events = await listBotInterageContextEvents({
          groupId: context.job.groupId,
          senderJid: normalizedSenderJid,
          limit,
        });
        const completionInstruction = buildSearchFallbackInstruction(jobId, accessCode);
        return toolResult({
          ok: true,
          job: context.job,
          events,
          filter: { senderJid: normalizedSenderJid, senderPhone: senderPhone ?? null },
          nextStep: completionInstruction,
          completionInstruction,
        });
      }
      const completionInstruction = buildSearchFallbackInstruction(jobId, accessCode);
      return toolResult({
        ok: true,
        ...context,
        nextStep: completionInstruction,
        completionInstruction,
      });
    },
  );

  server.registerTool(
    "botadmin_reply_text",
    {
      title: "Responder texto no WhatsApp pelo BotAdmin",
      description:
        "Use esta ferramenta como etapa final para responder texto no grupo. Requer jobId, accessCode e text; ela conclui o job e envia a resposta ao WhatsApp.",
      annotations: closedWriteToolAnnotations,
      inputSchema: {
        jobId: z.string().uuid(),
        accessCode: z.string().uuid(),
        text: z.string().min(1),
        conversationId: optionalString(),
        messageId: optionalString(),
        interceptKey: optionalString(),
      },
    },
    async ({ jobId, accessCode, text, conversationId, messageId, interceptKey }) => {
      const context = await getChatGptPhoneJobMcpContext({ jobId, accessCode });
      if (!context) {
        logMcpTool("reply_text_invalid", { jobId });
        return toolResult({ ok: false, message: "Job inexistente ou accessCode invalido." });
      }
      const responseText = text.trim();
      if (!responseText) {
        return toolResult({ ok: false, message: "Informe text para concluir a resposta." });
      }

      const job = await completeChatGptPhoneJob({
        jobId,
        workerId: "mcp-chatgpt",
        payload: {
          ok: true,
          resultType: "text",
          result: responseText,
          conversationId,
          messageId,
          interceptKey,
        },
      });

      const summary = summarizeChatGptPhoneJob(job);
      logMcpTool("reply_text_completed", {
        jobId,
        groupId: context.job.groupId,
        status: job.status,
        responsePreview: summary.responsePreview,
      });
      return toolResult({
        ok: job.status === "succeeded",
        message: "Resposta recebida pelo BotAdmin.",
        job: summary,
      });
    },
  );

  server.registerTool(
    "botadmin_complete_job",
    {
      title: "Concluir job do BotAdmin",
      description:
        "Canal oficial de retorno do ChatGPT para o BotInterage. Use com jobId+accessCode para devolver texto, erro, play ou artefatos ao WhatsApp sem depender de captura visual.",
      annotations: closedWriteToolAnnotations,
      inputSchema: mcpCompleteJobInputSchema,
    },
    async ({
      jobId,
      accessCode,
      ok,
      resultType,
      text,
      responseText,
      error,
      playQuery,
      playKind,
      artifacts,
      conversationId,
      messageId,
      interceptKey,
    }) => {
      const context = await getChatGptPhoneJobMcpContext({ jobId, accessCode });
      if (!context) {
        logMcpTool("complete_job_invalid", { jobId });
        return toolResult({ ok: false, message: "Job inexistente ou accessCode invalido." });
      }

      const normalizedType = resultType === "error" ? "text" : resultType ?? "text";
      const isOk = ok ?? resultType !== "error";
      let resultText = (responseText ?? text ?? "").trim();
      const artifactList = artifacts ?? [];

      if (resultType === "play") {
        const query = (playQuery ?? resultText).trim();
        if (!query) {
          return toolResult({ ok: false, message: "Informe playQuery para concluir um job de play/download." });
        }
        resultText = `BOTADMIN_PLAY_SELECTION ${JSON.stringify({
          query,
          kind: playKind ?? "audio",
        })}`;
      }

      if (!isOk && !error?.trim()) {
        return toolResult({ ok: false, message: "Informe error quando ok=false ou resultType=error." });
      }

      if (isOk && !resultText && artifactList.length === 0) {
        logMcpTool("complete_job_missing_payload", { jobId, resultType: resultType ?? null });
        return toolResult({
          ok: false,
          message:
            "Informe text/responseText, playQuery ou artifacts para concluir o job. Para texto simples, chame botadmin_reply_text com text.",
        });
      }

      const job = await completeChatGptPhoneJob({
        jobId,
        workerId: "mcp-chatgpt",
        payload: {
          ok: isOk,
          resultType: normalizedType,
          result: resultText || undefined,
          error: error?.trim() || undefined,
          artifacts: artifactList,
          conversationId,
          messageId,
          interceptKey,
        },
      });

      const summary = summarizeChatGptPhoneJob(job);
      logMcpTool("complete_job_completed", {
        jobId,
        groupId: context.job.groupId,
        status: job.status,
        resultType: job.resultType,
        responsePreview: summary.responsePreview,
        artifactsCount: summary.artifactsCount,
      });
      return toolResult({
        ok: job.status === "succeeded",
        message: "Resultado recebido pelo BotAdmin.",
        job: summary,
      });
    },
  );

  server.registerTool(
    "botadmin_upload_file",
    {
      title: "Enviar arquivo para o BotAdmin",
      description:
        "Recebe base64, dataUrl ou URL temporaria; salva no BotAdmin e retorna URL publica. Com jobId+accessCode, pode concluir o job ChatGPT Phone com o arquivo como artefato de resultado.",
      annotations: closedWriteToolAnnotations,
      inputSchema: mcpUploadInputSchema,
    },
    async ({ jobId, accessCode, base64, dataUrl, url, mimeType, fileName, purpose, completeJob, responseText }) => {
      const context = await getChatGptPhoneJobMcpContext({ jobId, accessCode });
      if (!context) {
        logMcpTool("upload_file_invalid", { jobId });
        return toolResult({ ok: false, message: "Job inexistente ou accessCode invalido." });
      }

      const materialized = await materializeMcpUpload({
        base64,
        dataUrl,
        url,
        mimeType,
        fileName,
        folder: `chatgpt-phone/${jobId}`,
      });
      const shouldComplete = completeJob ?? (purpose === undefined || purpose === "result");
      const job = shouldComplete
        ? await completeChatGptPhoneJob({
            jobId,
            workerId: "mcp-chatgpt",
            payload: {
              ok: true,
              resultType: "media",
              result: responseText,
              artifacts: [materialized.artifact],
            },
          })
        : await getChatGptPhoneJob(jobId);

      logMcpTool("upload_file_completed", {
        jobId,
        groupId: context.job.groupId,
        completeJob: shouldComplete,
        bytes: materialized.bytes,
        mimeType: materialized.artifact.mimeType,
        fileName: materialized.artifact.fileName,
        status: job?.status ?? null,
      });
      return toolResult({
        ok: true,
        upload: {
          url: materialized.publicUrl,
          path: materialized.storedPath,
          fileName: materialized.artifact.fileName,
          mimeType: materialized.artifact.mimeType,
          bytes: materialized.bytes,
          purpose: purpose ?? "result",
          completedJob: shouldComplete,
        },
        artifact: materialized.artifact,
        attachment: {
          name: materialized.attachment.name,
          mimeType: materialized.attachment.mimeType,
          base64Length: materialized.attachment.base64.length,
        },
        job: job ? summarizeChatGptPhoneJob(job) : null,
      });
    },
  );

  server.registerTool(
    "botadmin_search_play",
    {
      title: "Pesquisar midia para play/download",
      description:
        "Pesquisa musica/video no YouTube e retorna os dados que o BotAdmin usa para abrir a selecao play com MP3/MP4 no WhatsApp.",
      annotations: closedReadToolAnnotations,
      inputSchema: {
        query: z.string().min(1),
        kind: z.enum(["audio", "video"]).optional(),
        limit: z.number().int().min(1).max(10).optional(),
        userId: optionalPositiveInt(),
      },
    },
    async ({ query, kind, limit, userId }) => {
      const normalizedQuery = normalizeDownloadQuery(query);
      if (!userId) {
        return toolResult({
          ok: false,
          query: normalizedQuery,
          message:
            "Informe userId. Ele aparece no BOTADMIN_JOB ou no retorno de botadmin_get_job_context.",
        });
      }
      const apiKey = (await getOrCreateUserApiKey(userId)).apiKey;
      const baseUrl =
        process.env.INTERNAL_APP_URL?.trim().replace(/\/+$/, "") ||
        getAppBaseUrl().replace(/\/+$/, "");
      const url = new URL("/api/rest/ytsearch", baseUrl);
      url.searchParams.set("q", normalizedQuery);
      url.searchParams.set("limit", String(limit ?? 5));
      const response = await fetch(url.toString(), {
        headers: { accept: "application/json", "x-api-key": apiKey },
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      const items: Array<{
        id?: string;
        title?: string;
        url?: string;
        duration?: string;
        author?: string;
        thumbnail?: string;
        published?: string;
      }> = Array.isArray(payload?.items) ? payload.items : [];
      const results = items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        duration: item.duration,
        author: item.author,
        thumbnail: item.thumbnail,
        published: item.published ?? null,
        preferredKind: kind ?? "audio",
        whatsappSelection: {
          audioCommand: `/ytmp3 ${item.url}`,
          videoCommand: `/ytmp4 ${item.url}`,
        },
      }));
      return toolResult({
        ok: results.length > 0,
        query: normalizedQuery,
        kind: kind ?? "audio",
        count: results.length,
        results,
        instruction:
          "No BotInterage, escolha o melhor resultado e chame botadmin_complete_job com resultType='play', playQuery='<url ou termo escolhido>' e playKind='audio|video'.",
      });
    },
  );

  if (options.publicMode) {
    return server;
  }

  server.registerTool(
    "botadmin_get_botinterage_history",
    {
      title: "Consultar historico do BotInterage",
      description:
        "Consulta recente e somente leitura do historico BotInterage por grupo e opcionalmente por telefone/JID do remetente. Use apenas para contexto; nao envia resposta final.",
      annotations: closedReadToolAnnotations,
      inputSchema: {
        groupId: optionalPositiveInt(),
        groupRemoteId: optionalString(),
        senderJid: optionalString(),
        senderPhone: optionalString(),
        limit: z.number().int().min(1).max(80).optional(),
      },
    },
    async ({ groupId, groupRemoteId, senderJid, senderPhone, limit }) => {
      const normalizedSenderJid = normalizeSenderJidForLookup({ senderJid, senderPhone });
      const events = await listBotInterageContextEvents({
        groupId,
        groupRemoteId,
        senderJid: normalizedSenderJid,
        limit,
      });

      logMcpTool("get_botinterage_history", {
        groupId: groupId ?? null,
        groupRemoteId: groupRemoteId ?? null,
        senderJid: normalizedSenderJid ?? null,
        events: events.length,
      });

      return toolResult({
        ok: true,
        count: events.length,
        filter: {
          groupId: groupId ?? null,
          groupRemoteId: groupRemoteId ?? null,
          senderJid: normalizedSenderJid ?? null,
          senderPhone: senderPhone ?? null,
        },
        events,
        instruction:
          "Use estes eventos somente como memoria/contexto. A resposta final deve ser escrita normalmente no ChatGPT para o Cromite capturar.",
      });
    },
  );

  server.registerTool(
    "botadmin_get_group_profile",
    {
      title: "Consultar perfil do grupo",
      description:
        "Consulta nome, descrição, dono, administradores e quantidade de participantes do grupo atual. Use em perguntas sobre admins, descrição, regras ou quantos membros/pessoas há no grupo.",
      annotations: closedReadToolAnnotations,
      inputSchema: {
        groupId: optionalPositiveInt(),
        groupRemoteId: optionalString(),
        refreshParticipants: z.boolean().optional(),
      },
    },
    async ({ groupId, groupRemoteId, refreshParticipants }) => {
      const db = getDb();
      const query = `SELECT id, user_id, remote_id, name, description, owner, participants, participants_synced_at
           FROM bot_groups
          WHERE ${groupId && groupRemoteId ? "id = ? AND remote_id = ?" : groupId ? "id = ?" : "remote_id = ?"}
          ORDER BY id DESC LIMIT 1`;
      const values = groupId && groupRemoteId ? [groupId, groupRemoteId] : [groupId ?? groupRemoteId ?? ""];
      const load = async () => {
        const [rows] = await db.query<Array<Record<string, unknown>>>(query, values);
        return rows[0];
      };
      let row = await load();
      if (!row) {
        return toolResult({ ok: false, message: "Grupo não encontrado no BotAdmin." });
      }
      if (refreshParticipants) {
        await syncGroupInfo(Number(row.user_id), Number(row.id), { maxAgeMs: 30_000 });
        row = await load() ?? row;
      }
      let participants: Array<Record<string, unknown>> = [];
      try {
        const raw = typeof row.participants === "string" ? JSON.parse(row.participants) : row.participants;
        if (Array.isArray(raw)) participants = raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
      } catch {
        participants = [];
      }
      const normalizedParticipants = participants.map(normalizeParticipant);
      const admins = normalizedParticipants.filter((participant) => ["admin", "superadmin"].includes(participant.role));
      return toolResult({
        ok: true,
        group: {
          id: row.id,
          remoteId: row.remote_id,
          name: row.name,
          description: row.description ?? null,
          owner: normalizeParticipantPhone(row.owner),
          admins,
          participants: normalizedParticipants,
          participantCount: participants.length,
          participantsSyncedAt: row.participants_synced_at ?? null,
        },
      });
    },
  );

  server.registerTool(
    "botadmin_create_group_sweepstake",
    {
      title: "Criar sorteio por enquete no grupo atual",
      description:
        "Cria e publica uma enquete real de sorteio no grupo WhatsApp atual. Apenas quem vota em Participar entra. Informe premio, encerramento em ISO 8601 com fuso, quantidade de ganhadores, limite de participantes e se deve mencionar todos de forma oculta na enquete. Use somente diante de pedido explícito de um administrador.",
      annotations: closedWriteToolAnnotations,
      inputSchema: {
        groupId: z.number().int().positive(),
        groupRemoteId: z.string().min(1),
        senderJid: z.string().min(1),
        requestMessageId: z.string().min(1),
        prize: z.string().min(1).max(200),
        endsAt: z.string().datetime({ offset: true }),
        winnersCount: z.number().int().min(1).max(50),
        maxParticipants: z.number().int().min(1).max(10000).optional(),
        mentionAll: z.boolean().optional(),
      },
    },
    async ({ groupId, groupRemoteId, senderJid, requestMessageId, prize, endsAt, winnersCount, maxParticipants, mentionAll }) => {
      const db = getDb();
      const [rows] = await db.query<Array<Record<string, unknown>>>(
        `SELECT g.id, g.user_id, g.instance_id, g.remote_id, g.participants,
                i.base_url, i.token, i.phone, i.session_status
           FROM bot_groups g JOIN bot_instances i ON i.id = g.instance_id
          WHERE g.id = ? AND g.remote_id = ? LIMIT 1`,
        [groupId, groupRemoteId],
      );
      const row = rows[0];
      if (!row || !row.base_url || !row.token || String(row.session_status).toLowerCase() !== "conectado") {
        return toolResult({ ok: false, message: "Grupo ou instância indisponível para publicar a enquete." });
      }
      const client = { baseUrl: String(row.base_url), token: String(row.token) };
      const guard = await resolveBotAutomationGuard({
        userId: Number(row.user_id), instanceId: Number(row.instance_id), groupId: Number(row.id),
      });
      if (guard.blocked) return toolResult({ ok: false, message: "Automação não autorizada neste grupo." });
      await syncGroupInfo(Number(row.user_id), Number(row.id), { maxAgeMs: 0 });
      const [freshRows] = await db.query<Array<Record<string, unknown>>>(
        "SELECT participants FROM bot_groups WHERE id = ? LIMIT 1", [groupId],
      );
      let participants: Array<Record<string, unknown>> = [];
      try {
        const raw = freshRows[0]?.participants;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) participants = parsed.filter((entry) => entry && typeof entry === "object");
      } catch { /* fail closed below */ }
      if (participants.length === 0) return toolResult({ ok: false, message: "Não foi possível validar os administradores do grupo." });
      const senderPhone = senderJid.endsWith("@lid")
        ? (await resolveWhatsappLidsToPhones(client, [senderJid]).catch(() => new Map())).get(normalizeParticipantPhone(senderJid) ?? "")
        : normalizeParticipantPhone(senderJid);
      const senderDigits = senderPhone ?? normalizeParticipantPhone(senderJid);
      const ownDigits = normalizeParticipantPhone(row.phone);
      const isAdmin = senderDigits === ownDigits || participants.some((participant) =>
        ["admin", "superadmin"].includes(String(participant.admin ?? participant.role ?? "").toLowerCase()) &&
        normalizeParticipantPhone(participant.id ?? participant.jid ?? participant.phone) === senderDigits,
      );
      if (!senderDigits || !isAdmin) return toolResult({ ok: false, message: "Somente um administrador confirmado pode criar o sorteio." });

      const expiration = new Date(endsAt);
      const durationMs = expiration.getTime() - Date.now();
      if (!Number.isFinite(durationMs) || durationMs < 30_000 || durationMs > 7 * 86_400_000) {
        return toolResult({ ok: false, message: "O encerramento deve ocorrer entre 30 segundos e 7 dias a partir de agora." });
      }
      const limit = maxParticipants ?? Math.max(participants.length, winnersCount);
      if (winnersCount > limit) return toolResult({ ok: false, message: "Ganhadores excedem o limite de participantes." });
      const existing = await findActiveSweepstakeByGroup(Number(row.instance_id), groupRemoteId);
      if (existing) return toolResult({ ok: false, message: "Já existe um sorteio ativo neste grupo.", sweepstakeId: existing.id });

      const mentions = mentionAll
        ? participants.map((participant) => String(participant.id ?? participant.jid ?? "")).filter(Boolean)
        : [];
      const question = prize.trim();
      const poll = await sendPollMessage(client, {
        to: groupRemoteId,
        question: `🎟️ *SORTEIO*: ${question}`,
        options: ["Participar ✅", "Não participar ❌"],
        selectableOptionsCount: 1,
        mentions,
      });
      const options = (poll.poll?.options ?? []).filter((option) => option.hash && option.name);
      if (options.length < 2) {
        return toolResult({ ok: false, message: "A enquete foi publicada, mas a API não retornou os identificadores dos votos. Não foi possível ativar o sorteio com segurança." });
      }
      const sweepstake = await createSweepstake({
        instanceId: Number(row.instance_id), groupJid: groupRemoteId,
        pollMessageId: poll.messageId ?? poll.pollId, pollId: poll.pollId,
        question, joinOptionHash: options[0].hash, options,
        maxParticipants: limit, winnersCount, expiresAt: expiration,
        createdBy: senderJid,
        metadata: { source: "botinterage_mcp", mentionAll: mentionAll === true, createdAt: new Date().toISOString() },
        messageKey: requestMessageId,
      });
      return toolResult({ ok: true, sweepstakeId: sweepstake.id, pollMessageId: sweepstake.pollMessageId,
        prize: question, endsAt: expiration.toISOString(), winnersCount, maxParticipants: limit,
        mentionAll: mentionAll === true, participation: "Somente votos em Participar ✅" });
    },
  );

  server.registerTool(
    "botadmin_get_group_context",
    {
      title: "Buscar contexto do BotInterage",
      description:
        "Retorna historico recente persistido do BotInterage para um grupo e, opcionalmente, um usuario/sender JID.",
      inputSchema: {
        groupId: optionalPositiveInt(),
        groupRemoteId: optionalString(),
        senderJid: optionalString(),
        senderPhone: optionalString(),
        limit: z.number().int().min(1).max(80).optional(),
      },
    },
    async ({ groupId, groupRemoteId, senderJid, senderPhone, limit }) => {
      const normalizedSenderJid = normalizeSenderJidForLookup({ senderJid, senderPhone });
      const events = await listBotInterageContextEvents({
        groupId,
        groupRemoteId,
        senderJid: normalizedSenderJid,
        limit,
      });

      return toolResult({
        count: events.length,
        filter: normalizedSenderJid
          ? { senderJid: normalizedSenderJid, senderPhone: senderPhone ?? null }
          : null,
        events,
      });
    },
  );

  server.registerTool(
    "botadmin_create_chatgpt_phone_job",
    {
      title: "Executar ChatGPT no celular",
      description:
        "Cria um job rastreavel no BotAdmin e envia a mensagem ao executor HTTP do celular com ChatGPT. Use para texto e geracao de imagens/midia.",
      inputSchema: {
        groupId: z.number().int().positive(),
        instanceId: optionalPositiveInt(),
        userId: optionalPositiveInt(),
        groupRemoteId: optionalString(),
        groupName: optionalString(),
        senderJid: optionalString(),
        senderName: optionalString(),
        whatsappMessageId: optionalString(),
        message: z.string().min(1),
        attachments: z.array(mcpAttachmentSchema).max(4).optional(),
        runNow: z.boolean().optional(),
      },
    },
    async ({
      groupId,
      instanceId,
      userId,
      groupRemoteId,
      groupName,
      senderJid,
      senderName,
      whatsappMessageId,
      message,
      attachments,
      runNow,
    }) => {
      const resolvedAttachments: ChatGptPhoneInputAttachment[] = [];
      for (let index = 0; index < (attachments ?? []).length; index += 1) {
        const attachment = attachments![index];
        const materialized = await materializeMcpUpload({
          base64: attachment.base64,
          dataUrl: attachment.dataUrl,
          url: attachment.url,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
          folder: `chatgpt-phone/input/${Date.now()}-${index}`,
        });
        resolvedAttachments.push(materialized.attachment);
      }

      if (runNow === false) {
        const job = await createChatGptPhoneJob({
          userId,
          groupId,
          instanceId,
          groupRemoteId,
          senderJid,
          senderName,
          whatsappMessageId,
          prompt: message,
          context: { source: "mcp", groupName: groupName ?? null },
          request: {
            message,
            timeoutMs: 240_000,
            settleMs: 4_500,
            newChat: false,
            resultSource: "database",
            ...(resolvedAttachments.length ? { attachments: resolvedAttachments } : {}),
          },
        });
        return toolResult({ job });
      }

      const job = await createAndRunBotInterageChatGptPhoneJob({
        userId: userId ?? 0,
        groupId,
        instanceId: instanceId ?? 0,
        groupRemoteId: groupRemoteId ?? "",
        groupName,
        senderJid,
        senderName,
        whatsappMessageId,
        message,
        attachments: resolvedAttachments,
      });
      return toolResult({ job });
    },
  );

  server.registerTool(
    "botadmin_get_chatgpt_phone_job",
    {
      title: "Consultar job do ChatGPT Phone",
      description: "Consulta status, texto, IDs e artefatos de um job ja criado no executor do celular.",
      inputSchema: {
        jobId: z.string().uuid(),
      },
    },
    async ({ jobId }) => {
      const job = await getChatGptPhoneJob(jobId);
      return toolResult({ job });
    },
  );

  server.registerTool(
    "botadmin_run_chatgpt_phone_job",
    {
      title: "Rodar job pendente no celular",
      description:
        "Executa no celular um job ChatGPT Phone que ja foi criado. Mantem o mesmo job_id para reconciliar texto e midia.",
      inputSchema: {
        jobId: z.string().uuid(),
        timeoutMs: z.number().int().min(10_000).max(600_000).optional(),
        newChat: z.boolean().optional(),
      },
    },
    async ({ jobId, timeoutMs, newChat }) => {
      const job = await runChatGptPhoneJob(jobId, { timeoutMs, newChat });
      return toolResult({ job });
    },
  );

  return server;
};
