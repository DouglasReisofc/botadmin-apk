import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import {
  createSweepstake,
  findActiveSweepstakeByGroup,
  listSweepstakesForGroup,
  type BotSweepstakeOption,
} from "lib/bot-sweepstakes";
import { sendPollMessage } from "lib/wuzapi";
import type { BotGroup } from "types/bot-groups";

const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const MIN_DURATION_MS = 30_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const parsePollOptions = (options: unknown): BotSweepstakeOption[] => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const hash = firstString(record.hash, record.Hash, record.optionHash, record.OptionHash);
      const name = firstString(record.name, record.Name, record.option, record.Option);
      if (!hash || !name) {
        return null;
      }
      return { hash, name };
    })
    .filter((option): option is BotSweepstakeOption => Boolean(option));
};

const ensureGroupContext = async (
  groupId: number,
): Promise<
  | { error: NextResponse }
  | { userId: number; group: BotGroup; instance: Awaited<ReturnType<typeof getInstanceForUser>> }
> => {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  }

  const group = await getGroupByIdForUser(user.id, groupId);
  if (!group) {
    return { error: NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 }) };
  }

  const instance = await getInstanceForUser(user.id, group.instanceId);
  if (!instance) {
    return {
      error: NextResponse.json({ message: "Instância vinculada ao grupo não encontrada." }, { status: 404 }),
    };
  }

  return { userId: user.id, group, instance };
};

export async function GET(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const group = await getGroupByIdForUser(user.id, groupId);
  if (!group) {
    return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  }

  if (!group.remoteId) {
    return NextResponse.json({
      active: [],
      history: [],
      requiresSync: true,
      message: "Sincronize o grupo com o WhatsApp para gerenciar sorteios.",
    });
  }

  const historyLimitParam = request.nextUrl.searchParams.get("limit");
  const historyLimit = historyLimitParam ? Number.parseInt(historyLimitParam, 10) : undefined;

  try {
    const list = await listSweepstakesForGroup(group.instanceId, group.remoteId, { historyLimit });
    return NextResponse.json({
      active: list.active,
      history: list.history,
      requiresSync: false,
    });
  } catch (error) {
    console.error("Failed to load sweepstakes for group", { groupId, error });
    return NextResponse.json(
      { message: "Não foi possível carregar os sorteios do grupo." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const { groupId: rawGroupId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  const auth = await ensureGroupContext(groupId);
  if ("error" in auth) {
    return auth.error;
  }

  const { userId, group, instance } = auth;

  if (!group.remoteId) {
    return NextResponse.json(
      { message: "Sincronize o grupo com o WhatsApp antes de criar sorteios." },
      { status: 409 },
    );
  }

  if (!instance.serverBaseUrl || !instance.token) {
    return NextResponse.json(
      { message: "A instância vinculada não possui credenciais de envio configuradas." },
      { status: 409 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  if (!question) {
    return NextResponse.json({ message: "Informe o título do sorteio." }, { status: 400 });
  }

  const durationValue = parsePositiveInteger(
    payload.durationValue ?? payload.duration_value ?? payload.duration ?? payload.tempo,
  );
  const durationUnitRaw = firstString(payload.durationUnit, payload.duration_unit, payload.unit);
  const durationUnitKey = (durationUnitRaw ?? "m").toLowerCase().slice(0, 1);
  const multiplier = DURATION_MULTIPLIERS[durationUnitKey] ?? null;

  if (!durationValue || !multiplier) {
    return NextResponse.json({ message: "Informe um tempo de duração válido." }, { status: 400 });
  }

  const durationMs = durationValue * multiplier;
  if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    return NextResponse.json(
      {
        message: `O tempo deve estar entre ${Math.floor(MIN_DURATION_MS / 1_000)} segundos e ${Math.floor(
          MAX_DURATION_MS / (60 * 60 * 1_000),
        )} horas.`,
      },
      { status: 400 },
    );
  }

  const maxParticipants = parsePositiveInteger(
    payload.maxParticipants ?? payload.max_participants ?? payload.limit ?? payload.participantes,
  );
  if (!maxParticipants) {
    return NextResponse.json({ message: "Informe o limite de participantes." }, { status: 400 });
  }

  const winnersCount = parsePositiveInteger(
    payload.winnersCount ?? payload.winners_count ?? payload.ganhadores ?? payload.winners,
  );
  if (!winnersCount) {
    return NextResponse.json({ message: "Informe o número de vencedores." }, { status: 400 });
  }

  if (winnersCount > maxParticipants) {
    return NextResponse.json(
      { message: "O número de vencedores não pode ser maior que o limite de participantes." },
      { status: 400 },
    );
  }

  try {
    const existing = await findActiveSweepstakeByGroup(instance.id, group.remoteId);
    if (existing) {
      return NextResponse.json(
        {
          message: "Já existe um sorteio ativo neste grupo. Finalize ou cancele o atual antes de criar outro.",
        },
        { status: 409 },
      );
    }
  } catch (error) {
    console.error("Failed to check active sweepstake", { groupId, error });
    return NextResponse.json(
      { message: "Não foi possível verificar os sorteios ativos no momento." },
      { status: 500 },
    );
  }

  const expiresAt = new Date(Date.now() + durationMs);
  const pollQuestion = `🎟️ *SORTEIO*: ${question}`;

  let pollResponse: Awaited<ReturnType<typeof sendPollMessage>>;
  try {
    pollResponse = await sendPollMessage(
      { baseUrl: instance.serverBaseUrl, token: instance.token },
      {
        to: group.remoteId,
        question: pollQuestion,
        options: ["Participar ✅", "Não participar ❌"],
        selectableOptionsCount: 1,
      },
    );
  } catch (error) {
    console.error("Failed to send sweepstake poll", { groupId, error });
    return NextResponse.json(
      { message: "Não foi possível enviar a enquete do sorteio. Verifique a conexão da instância." },
      { status: 502 },
    );
  }

  const pollOptions = parsePollOptions((pollResponse.poll as any)?.options ?? []);
  if (pollOptions.length === 0) {
    return NextResponse.json(
      { message: "Não foi possível obter as opções da enquete criada." },
      { status: 502 },
    );
  }

  const joinOption = pollOptions[0];
  const pollMessageId = pollResponse.messageId ?? pollResponse.pollId;
  const metadata = {
    createdVia: "panel",
    durationMs,
    winnersCount,
    maxParticipants,
    createdByUserId: userId,
  };

  try {
    await createSweepstake({
      instanceId: instance.id,
      groupJid: group.remoteId,
      pollMessageId: pollMessageId ?? pollResponse.pollId,
      pollId: pollResponse.pollId,
      question,
      joinOptionHash: joinOption.hash,
      options: pollOptions,
      maxParticipants,
      winnersCount,
      expiresAt,
      createdBy: instance.phone ?? String(userId),
      metadata,
      messageKey: null,
    });
  } catch (error) {
    console.error("Failed to persist sweepstake", { groupId, error });
    return NextResponse.json(
      { message: "Não foi possível salvar o sorteio. Tente novamente em instantes." },
      { status: 500 },
    );
  }

  try {
    const list = await listSweepstakesForGroup(instance.id, group.remoteId);
    return NextResponse.json(
      {
        message: "Sorteio criado com sucesso.",
        active: list.active,
        history: list.history,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to reload sweepstakes after creation", { groupId, error });
    return NextResponse.json(
      { message: "Sorteio criado, mas houve falha ao atualizar a lista." },
      { status: 207 },
    );
  }
}
