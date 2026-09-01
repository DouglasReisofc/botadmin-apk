import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotFlowRevisionConflictError,
  deleteBotFlowForUser,
  getBotFlowForUser,
  listBotFlowsForUser,
  updateBotFlowForUser,
} from "lib/bot-flows";
import { publishBotFlowRealtimeEvent } from "lib/bot-flow-realtime-bus";
import { userPlanAllowsFlows } from "lib/plans";

const parseFlowId = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const assertPayload = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export async function GET(_request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { flowId } = await params;
    const id = parseFlowId(flowId);
    if (!id) {
      return NextResponse.json({ message: "Fluxo inválido." }, { status: 400 });
    }

    const flow = await getBotFlowForUser(user.id, id);
    if (!flow) {
      return NextResponse.json({ message: "Fluxo não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ flow });
  } catch (error) {
    console.error("[bot-flows] GET one error", error);
    return NextResponse.json({ message: "Não foi possível carregar o fluxo." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { flowId } = await params;
    const id = parseFlowId(flowId);
    if (!id) {
      return NextResponse.json({ message: "Fluxo inválido." }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    if (!assertPayload(payload)) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }
    if (!(await userPlanAllowsFlows(user.id))) {
      return NextResponse.json(
        { message: "Seu plano atual não libera o construtor de fluxos." },
        { status: 402 },
      );
    }

    const flow = await updateBotFlowForUser(user.id, id, payload);
    const flows = await listBotFlowsForUser(user.id);
    publishBotFlowRealtimeEvent(user.id, "flow.updated", flow.id, flow);
    return NextResponse.json({ message: "Fluxo salvo com sucesso.", flow, flows });
  } catch (error) {
    if (error instanceof BotFlowRevisionConflictError) {
      return NextResponse.json(
        { message: error.message, flow: error.current, conflict: true },
        { status: 409 },
      );
    }
    console.error("[bot-flows] PATCH error", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível salvar o fluxo." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { flowId } = await params;
    const id = parseFlowId(flowId);
    if (!id) {
      return NextResponse.json({ message: "Fluxo inválido." }, { status: 400 });
    }

    await deleteBotFlowForUser(user.id, id);
    const flows = await listBotFlowsForUser(user.id);
    publishBotFlowRealtimeEvent(user.id, "flow.deleted", id);
    return NextResponse.json({ message: "Fluxo removido com sucesso.", flows });
  } catch (error) {
    console.error("[bot-flows] DELETE error", error);
    return NextResponse.json({ message: "Não foi possível remover o fluxo." }, { status: 500 });
  }
}
