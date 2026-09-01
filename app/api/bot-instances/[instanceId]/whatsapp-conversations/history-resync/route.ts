import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { BotInstanceError, refreshInstanceStatus } from "lib/bot-instances";
import {
  getFullHistoryResyncStatus,
  requestChatHistorySync,
  requestFullHistoryResync,
} from "lib/wuzapi";
import {
  countWhatsappConversationMessages,
  listWhatsappHistorySyncAnchors,
  type WhatsappHistorySyncAnchor,
} from "lib/whatsapp-conversations";
import { resolveInstanceConversationAccess } from "lib/whatsapp-conversation-access";
import {
  redisDel,
  redisGetJson,
  redisKey,
  redisSetIfAbsent,
  redisSetJson,
} from "lib/redis";

type Context = { params: Promise<{ instanceId: string }> };

type ResyncJob = {
  status: "receiving" | "completed" | "failed";
  progress: number;
  conversations: number;
  totalConversations: number;
  messages: number;
  forwarded: number;
  strategy: "full-and-paginated";
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
};

declare global {
  var __botadminHistoryResyncJobs: Map<string, ResyncJob> | undefined;
}

const memoryJobs = globalThis.__botadminHistoryResyncJobs ?? new Map<string, ResyncJob>();
globalThis.__botadminHistoryResyncJobs = memoryJobs;
const jobTtlMs = 24 * 60 * 60 * 1_000;
const workerLockTtlMs = 6 * 60 * 60 * 1_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const anchorFingerprint = (anchor: WhatsappHistorySyncAnchor) =>
  `${anchor.messageId}|${anchor.timestamp}`;
const jobName = (userId: number, instanceId: number) => `${userId}:${instanceId}`;
const jobKey = (name: string) => redisKey("whatsapp", "history-resync", name);
const lockKey = (name: string) => redisKey("whatsapp", "history-resync-lock", name);

const saveJob = async (name: string, job: ResyncJob) => {
  memoryJobs.set(name, job);
  await redisSetJson(jobKey(name), job, jobTtlMs);
};

const loadJob = async (name: string) =>
  (await redisGetJson<ResyncJob>(jobKey(name))) ?? memoryJobs.get(name) ?? null;

const runPaginatedResync = async (params: {
  name: string;
  userId: number;
  instanceId: number;
  baseUrl: string;
  token: string;
  startedAt: string;
}) => {
  const { name, userId, instanceId, baseUrl, token, startedAt } = params;
  try {
    const initialCount = await countWhatsappConversationMessages(userId, instanceId);
    let active = await listWhatsappHistorySyncAnchors(userId, instanceId);
    const totalConversations = active.length;
    let completed = 0;
    let recovered = 0;

    await saveJob(name, {
      status: "receiving",
      progress: totalConversations === 0 ? 100 : 0,
      conversations: 0,
      totalConversations,
      messages: 0,
      forwarded: 0,
      strategy: "full-and-paginated",
      startedAt,
      updatedAt: new Date().toISOString(),
    });

    while (active.length > 0) {
      const requested = new Map(active.map((anchor) => [anchor.chatJid, anchor]));
      for (const anchor of active) {
        try {
          await requestChatHistorySync(
            { baseUrl, token },
            {
              chatJid: anchor.chatJid,
              oldestMessageId: anchor.messageId,
              oldestMessageFromMe: anchor.fromMe,
              oldestMessageTimestampMs: new Date(anchor.timestamp).getTime(),
              count: 100,
            },
          );
        } catch (error) {
          console.warn("Failed to request a paginated WhatsApp history chunk", {
            instanceId,
            chatJid: anchor.chatJid,
            error,
          });
        }
        await wait(350);
      }

      const changed = new Map<string, WhatsappHistorySyncAnchor>();
      const roundStartedAt = Date.now();
      let lastChangeAt = roundStartedAt;
      while (Date.now() - roundStartedAt < 120_000) {
        await wait(5_000);
        const current = await listWhatsappHistorySyncAnchors(userId, instanceId);
        const currentByChat = new Map(current.map((anchor) => [anchor.chatJid, anchor]));
        let foundChange = false;
        for (const [chatJid, previous] of requested) {
          const next = currentByChat.get(chatJid);
          if (next && anchorFingerprint(next) !== anchorFingerprint(previous)) {
            changed.set(chatJid, next);
            requested.delete(chatJid);
            foundChange = true;
          }
        }
        if (foundChange) lastChangeAt = Date.now();
        const currentCount = await countWhatsappConversationMessages(userId, instanceId);
        recovered = Math.max(0, currentCount - initialCount);
        await saveJob(name, {
          status: "receiving",
          progress: totalConversations === 0
            ? 100
            : Math.min(99, Math.round((completed / totalConversations) * 100)),
          conversations: completed,
          totalConversations,
          messages: recovered,
          forwarded: recovered,
          strategy: "full-and-paginated",
          startedAt,
          updatedAt: new Date().toISOString(),
        });
        if (requested.size === 0) break;
        if (Date.now() - roundStartedAt >= 30_000 && Date.now() - lastChangeAt >= 20_000) {
          break;
        }
      }

      completed += requested.size;
      if (changed.size === 0) break;
      active = [...changed.values()];
    }

    const finalCount = await countWhatsappConversationMessages(userId, instanceId);
    recovered = Math.max(0, finalCount - initialCount);
    const finishedAt = new Date().toISOString();
    await saveJob(name, {
      status: recovered > 0 || totalConversations === 0 ? "completed" : "failed",
      progress: 100,
      conversations: totalConversations,
      totalConversations,
      messages: recovered,
      forwarded: recovered,
      strategy: "full-and-paginated",
      startedAt,
      updatedAt: finishedAt,
      finishedAt,
      error: recovered > 0 || totalConversations === 0
        ? undefined
        : "O telefone não reemitiu mensagens. Mantenha o WhatsApp principal conectado à internet e tente novamente.",
    });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await saveJob(name, {
      status: "failed",
      progress: 0,
      conversations: 0,
      totalConversations: 0,
      messages: 0,
      forwarded: 0,
      strategy: "full-and-paginated",
      startedAt,
      updatedAt: finishedAt,
      finishedAt,
      error: error instanceof Error ? error.message : "Falha ao paginar o histórico local.",
    });
  } finally {
    await redisDel(lockKey(name));
  }
};

const unwrapData = (payload: Record<string, unknown>): Record<string, unknown> => {
  const nested = payload.data ?? payload.Data;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : payload;
};

const resolveAccess = async (context: Context) => {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  const { instanceId: rawId } = await context.params;
  const instanceId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    return { error: NextResponse.json({ message: "Perfil inválido." }, { status: 400 }) };
  }
  const access = await resolveInstanceConversationAccess(user.id, instanceId);
  if (!access || !access.isOwnerInstance) {
    return { error: NextResponse.json({ message: "Perfil não encontrado." }, { status: 404 }) };
  }
  if (!access.instance.serverBaseUrl || !access.instance.token) {
    return { error: NextResponse.json({ message: "API do perfil não configurada." }, { status: 409 }) };
  }
  return { access };
};

export async function POST(_request: Request, context: Context) {
  try {
    const resolved = await resolveAccess(context);
    if ("error" in resolved) return resolved.error;
    const { access } = resolved;
    const status = await refreshInstanceStatus(access.storageUserId, access.instance.id);
    if (status !== "conectado") {
      return NextResponse.json(
        { message: "O perfil precisa estar conectado para reemitir o histórico." },
        { status: 409 },
      );
    }
    const name = jobName(access.storageUserId, access.instance.id);
    const existing = await loadJob(name);
    if (existing?.status === "receiving") {
      return NextResponse.json({
        message: "Já existe uma resincronização em andamento.",
        resync: existing,
      }, { status: 409 });
    }
    const acquired = await redisSetIfAbsent(lockKey(name), String(Date.now()), workerLockTtlMs);
    if (acquired === false) {
      return NextResponse.json({
        message: "Já existe uma resincronização em andamento.",
        resync: existing,
      }, { status: 409 });
    }

    const startedAt = new Date().toISOString();
    const initialJob: ResyncJob = {
      status: "receiving",
      progress: 0,
      conversations: 0,
      totalConversations: 0,
      messages: 0,
      forwarded: 0,
      strategy: "full-and-paginated",
      startedAt,
      updatedAt: startedAt,
    };
    await saveJob(name, initialJob);

    let fullRequest: Record<string, unknown> | null = null;
    try {
      fullRequest = unwrapData(await requestFullHistoryResync({
        baseUrl: access.instance.serverBaseUrl!,
        token: access.instance.token!,
      }));
    } catch (error) {
      const upstreamStatus = (error as { status?: number }).status;
      if (upstreamStatus !== 409) {
        console.warn("Full WhatsApp history request was unavailable; using pagination", {
          instanceId: access.instance.id,
          error,
        });
      }
    }

    void runPaginatedResync({
      name,
      userId: access.storageUserId,
      instanceId: access.instance.id,
      baseUrl: access.instance.serverBaseUrl!,
      token: access.instance.token!,
      startedAt,
    });
    return NextResponse.json({
      message: "Resincronização completa e paginada iniciada sem desconectar o perfil.",
      resync: { ...initialJob, fullRequest },
    }, { status: 202 });
  } catch (error) {
    if (error instanceof BotInstanceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    const upstreamStatus = (error as { status?: number }).status;
    const upstream = (error as { response?: unknown }).response;
    if (upstreamStatus === 409 && upstream && typeof upstream === "object") {
      return NextResponse.json({
        message: "Já existe uma resincronização em andamento.",
        resync: unwrapData(upstream as Record<string, unknown>),
      }, { status: 409 });
    }
    console.error("Failed to request full WhatsApp history resync", error);
    return NextResponse.json(
      { message: "Não foi possível iniciar a resincronização agora." },
      { status: 502 },
    );
  }
}

export async function GET(_request: Request, context: Context) {
  try {
    const resolved = await resolveAccess(context);
    if ("error" in resolved) return resolved.error;
    const { access } = resolved;
    const name = jobName(access.storageUserId, access.instance.id);
    const job = await loadJob(name);
    let fullStatus: Record<string, unknown> | null = null;
    try {
      fullStatus = unwrapData(await getFullHistoryResyncStatus({
        baseUrl: access.instance.serverBaseUrl!,
        token: access.instance.token!,
      }));
    } catch (error) {
      console.warn("Failed to read the optional full history status", {
        instanceId: access.instance.id,
        error,
      });
    }
    if (!job) {
      return NextResponse.json({ resync: fullStatus ?? { status: "idle" } });
    }
    const fullState = fullStatus?.status?.toString().toLowerCase();
    if (fullState === "completed") {
      return NextResponse.json({ resync: { ...job, ...fullStatus, fullStatus } });
    }
    if (job.status === "failed" && (fullState === "requested" || fullState === "receiving")) {
      return NextResponse.json({
        resync: { ...job, status: "receiving", error: undefined, fullStatus },
      });
    }
    return NextResponse.json({ resync: { ...job, fullStatus } });
  } catch (error) {
    console.error("Failed to load full WhatsApp history resync status", error);
    return NextResponse.json(
      { message: "Não foi possível consultar a resincronização." },
      { status: 502 },
    );
  }
}
