import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { createBotFlowForUser, listBotFlowsForUser } from "lib/bot-flows";
import { publishBotFlowRealtimeEvent } from "lib/bot-flow-realtime-bus";
import { userPlanAllowsFlows } from "lib/plans";

const assertPayload = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const flows = await listBotFlowsForUser(user.id);
    return NextResponse.json({ flows });
  } catch (error) {
    console.error("[bot-flows] GET error", error);
    return NextResponse.json({ message: "Não foi possível carregar os fluxos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
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

    const flow = await createBotFlowForUser(user.id, payload);
    const flows = await listBotFlowsForUser(user.id);
    publishBotFlowRealtimeEvent(user.id, "flow.created", flow.id, flow);
    return NextResponse.json({ message: "Fluxo criado com sucesso.", flow, flows }, { status: 201 });
  } catch (error) {
    console.error("[bot-flows] POST error", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível criar o fluxo." },
      { status: 400 },
    );
  }
}
