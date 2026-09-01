import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getLatestGroupParticipantImportJobForTarget,
  GroupParticipantImportJobError,
  requestPauseGroupParticipantImportJobForUser,
  requestCancelGroupParticipantImportJobForUser,
  requestResumeGroupParticipantImportJobForUser,
  startGroupParticipantImportDispatcher,
  startGroupParticipantImportJobForUser,
  updateGroupParticipantImportJobSettingsForUser,
} from "lib/group-participant-import-jobs";

const parseGroupId = (rawValue: string): number => {
  const groupId = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new GroupParticipantImportJobError("Grupo de destino inválido.", 400);
  }
  return groupId;
};

const readPayload = async (request: NextRequest): Promise<Record<string, unknown>> => {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    throw new GroupParticipantImportJobError("Payload inválido.", 400);
  }
  return payload;
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    startGroupParticipantImportDispatcher();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawTargetGroupId } = await context.params;
    const targetGroupId = parseGroupId(rawTargetGroupId);
    const job = await getLatestGroupParticipantImportJobForTarget(user.id, targetGroupId);
    return NextResponse.json({ status: true, job });
  } catch (error) {
    const message =
      error instanceof GroupParticipantImportJobError
        ? error.message
        : "Não foi possível carregar o status da importação de membros.";
    const status = error instanceof GroupParticipantImportJobError ? error.status : 500;
    return NextResponse.json({ status: false, message }, { status });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    startGroupParticipantImportDispatcher();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const { groupId: rawTargetGroupId } = await context.params;
    const targetGroupId = parseGroupId(rawTargetGroupId);
    const payload = await readPayload(request);
    const sourceGroupId = Number.parseInt(String(payload.sourceGroupId ?? payload.source_group_id ?? ""), 10);
    if (!Number.isFinite(sourceGroupId) || sourceGroupId <= 0) {
      throw new GroupParticipantImportJobError("Selecione um grupo de origem válido.", 400);
    }

    const result = await startGroupParticipantImportJobForUser({
      userId: user.id,
      targetGroupId,
      sourceGroupId,
      excludeAdmins: payload.excludeAdmins,
      delayMs: payload.delayMs,
      jitterMs: payload.jitterMs,
      batchSize: payload.batchSize,
      maxMembers: payload.maxMembers,
    });

    return NextResponse.json({
      status: true,
      message: result.alreadyRunning
        ? "Já existe um processo em andamento para este grupo. Acompanhe o progresso abaixo."
        : "Processo iniciado em background. Você pode fechar o modal e acompanhar em tempo real.",
      job: result.job,
    });
  } catch (error) {
    const message =
      error instanceof GroupParticipantImportJobError
        ? error.message
        : "Não foi possível iniciar a importação de membros agora.";
    const status = error instanceof GroupParticipantImportJobError ? error.status : 500;
    return NextResponse.json({ status: false, message }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    startGroupParticipantImportDispatcher();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ status: false, message: "Não autenticado." }, { status: 401 });
    }
    const { groupId: rawTargetGroupId } = await context.params;
    const targetGroupId = parseGroupId(rawTargetGroupId);
    const payload = await readPayload(request);
    const action = String(payload.action ?? "").trim().toLowerCase();
    if (action !== "cancel" && action !== "pause" && action !== "resume" && action !== "update") {
      throw new GroupParticipantImportJobError("Ação inválida para esta rota.", 400);
    }

    const rawJobId = Number(payload.jobId ?? payload.job_id ?? 0);
    const normalizedJobId = Number.isFinite(rawJobId) && rawJobId > 0 ? Math.floor(rawJobId) : null;
    let job = null;
    let message = "";

    if (action === "cancel") {
      job = await requestCancelGroupParticipantImportJobForUser({
        userId: user.id,
        targetGroupId,
        jobId: normalizedJobId,
      });
      message =
        job?.status === "cancelled"
          ? "Importação cancelada."
          : "Cancelamento solicitado. Finalizando lote atual...";
    } else if (action === "pause") {
      job = await requestPauseGroupParticipantImportJobForUser({
        userId: user.id,
        targetGroupId,
        jobId: normalizedJobId,
      });
      message = "Processo pausado.";
    } else if (action === "resume") {
      job = await requestResumeGroupParticipantImportJobForUser({
        userId: user.id,
        targetGroupId,
        jobId: normalizedJobId,
      });
      message = "Processo retomado.";
    } else {
      job = await updateGroupParticipantImportJobSettingsForUser({
        userId: user.id,
        targetGroupId,
        jobId: normalizedJobId,
        delayMs: payload.delayMs,
        jitterMs: payload.jitterMs,
        batchSize: payload.batchSize,
      });
      message = "Ritmo atualizado.";
    }

    if (!job) {
      return NextResponse.json(
        { status: false, message: "Nenhum processo ativo encontrado para este grupo." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      status: true,
      message,
      job,
    });
  } catch (error) {
    const message =
      error instanceof GroupParticipantImportJobError
        ? error.message
        : "Não foi possível atualizar a importação agora.";
    const status = error instanceof GroupParticipantImportJobError ? error.status : 500;
    return NextResponse.json({ status: false, message }, { status });
  }
}
