import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import {
  cancelSweepstake,
  getSweepstakeForGroup,
  listSweepstakesForGroup,
} from "lib/bot-sweepstakes";
import { deleteMessageForEveryone, sendTextMessage } from "lib/wuzapi";

const shouldNotify = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (value === null) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "não", "nao", "off"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "yes", "sim", "on"].includes(normalized)) {
      return true;
    }
  }
  return true;
};

const sanitizeReason = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string; sweepstakeId: string }> },
) {
  const { groupId: rawGroupId, sweepstakeId: rawSweepstakeId } = await context.params;
  const groupId = Number.parseInt(rawGroupId, 10);
  const sweepstakeId = Number.parseInt(rawSweepstakeId, 10);

  if (!Number.isFinite(groupId) || groupId <= 0) {
    return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
  }

  if (!Number.isFinite(sweepstakeId) || sweepstakeId <= 0) {
    return NextResponse.json({ message: "Sorteio inválido." }, { status: 400 });
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
    return NextResponse.json({ message: "Sincronize o grupo com o WhatsApp antes de cancelar sorteios." }, { status: 409 });
  }

  const instance = await getInstanceForUser(user.id, group.instanceId);
  if (!instance) {
    return NextResponse.json({ message: "Instância vinculada ao grupo não encontrada." }, { status: 404 });
  }

  const sweepstake = await getSweepstakeForGroup(instance.id, group.remoteId, sweepstakeId);
  if (!sweepstake) {
    return NextResponse.json({ message: "Sorteio não encontrado." }, { status: 404 });
  }

  if (sweepstake.status !== "active") {
    return NextResponse.json({ message: "Este sorteio já foi encerrado." }, { status: 409 });
  }

  let notify = true;
  let reason: string | null = null;

  try {
    const body = await request.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      notify = shouldNotify(record.notify ?? record.announce);
      reason = sanitizeReason(record.reason ?? record.motivo ?? record.cause);
    }
  } catch {
    // ignora payload inválido e usa padrões
  }

  if (instance.serverBaseUrl && instance.token) {
    if (sweepstake.pollMessageId) {
      try {
        await deleteMessageForEveryone(
          { baseUrl: instance.serverBaseUrl, token: instance.token },
          {
            chatId: sweepstake.groupJid,
            messageId: sweepstake.pollMessageId,
            participant: undefined,
          },
        );
      } catch (error) {
        console.warn("Failed to delete sweepstake poll on cancel", { sweepstakeId, error });
      }
    }

    if (notify) {
      const lines: string[] = [];
      lines.push("⚠️ *SORTEIO CANCELADO*");
      lines.push(`• Prêmio: ${sweepstake.question}`);
      const maxParticipants = sweepstake.maxParticipants;
      lines.push(
        `• Participantes inscritos: ${sweepstake.participants.length}${
          typeof maxParticipants === "number" ? `/${maxParticipants}` : ""
        }`,
      );
      if (reason) {
        lines.push("", `Motivo: ${reason}`);
      }
      lines.push("", "O sorteio foi encerrado manualmente pelo painel.");

      try {
        await sendTextMessage(
          { baseUrl: instance.serverBaseUrl, token: instance.token },
          {
            to: sweepstake.groupJid,
            body: lines.join("\n"),
          },
        );
      } catch (error) {
        console.error("Failed to send sweepstake cancel message", { sweepstakeId, error });
      }
    }
  }

  const metadata = {
    ...(typeof sweepstake.metadata === "object" && sweepstake.metadata ? sweepstake.metadata : {}),
    cancelledBy: `user:${user.id}`,
    cancelledAt: new Date().toISOString(),
    cancelledReason: reason,
    participantsCount: sweepstake.participants.length,
  };

  await cancelSweepstake(sweepstake.id, metadata);

  try {
    const list = await listSweepstakesForGroup(instance.id, sweepstake.groupJid);
    return NextResponse.json({
      message: "Sorteio cancelado com sucesso.",
      active: list.active,
      history: list.history,
    });
  } catch (error) {
    console.error("Failed to refresh sweepstakes after cancel", { sweepstakeId, error });
    return NextResponse.json(
      { message: "Sorteio cancelado, mas houve falha ao atualizar a lista." },
      { status: 207 },
    );
  }
}
