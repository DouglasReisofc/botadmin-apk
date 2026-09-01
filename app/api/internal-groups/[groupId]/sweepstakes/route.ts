import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import {
  createInternalGroupSweepstake,
  InternalGroupError,
  listInternalGroupSweepstakes,
} from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";

type Context = { params: Promise<{ groupId: string }> };
const fail = (error: unknown) => error instanceof InternalGroupError
  ? NextResponse.json({ message: error.message }, { status: error.status })
  : NextResponse.json({ message: "Não foi possível processar o sorteio." }, { status: 500 });

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    return NextResponse.json(await listInternalGroupSweepstakes(Number((await context.params).groupId), user.id));
  } catch (error) { return fail(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const body = await request.json().catch(() => ({}));
    const result = await createInternalGroupSweepstake(groupId, user.id, {
      question: String(body?.question ?? ""),
      durationValue: Number(body?.durationValue ?? 60),
      durationUnit: String(body?.durationUnit ?? "m"),
      maxParticipants: Number(body?.maxParticipants ?? 100),
      winnersCount: Number(body?.winnersCount ?? 1),
    });
    emitInternalGroupEvent({ groupId, actorUserId: user.id, type: "message.created", messageId: result.messageId });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return fail(error); }
}
