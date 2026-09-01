import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { importSharedBotFlowForUser } from "lib/bot-flow-sharing";
import { listBotFlowsForUser } from "lib/bot-flows";
import { publishBotFlowRealtimeEvent } from "lib/bot-flow-realtime-bus";
import { userPlanAllowsFlows } from "lib/plans";

const assertPayload = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const readText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

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

    const result = await importSharedBotFlowForUser({
      userId: user.id,
      input: readText(payload.input),
      code: readText(payload.code),
      url: readText(payload.url),
      package: payload.package,
      raw: payload.raw,
      botconversaAuthorization: readText(payload.botconversaAuthorization),
      name: readText(payload.name),
      command: readText(payload.command),
    });
    const flows = await listBotFlowsForUser(user.id);
    publishBotFlowRealtimeEvent(user.id, "flow.created", result.flow.id, result.flow);

    return NextResponse.json(
      {
        message: "Fluxo importado com sucesso.",
        flow: result.flow,
        flows,
        warnings: result.warnings,
        package: result.package,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[bot-flows/import] POST error", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível importar o fluxo." },
      { status: 400 },
    );
  }
}
