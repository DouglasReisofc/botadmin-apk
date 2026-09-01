import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import {
  addInternalGroupSweepstakeParticipant,
  InternalGroupError,
} from "lib/internal-groups";

type Context = { params: Promise<{ groupId: string; sweepstakeId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await context.params;
    const body = await request.json().catch(() => ({}));
    const participantUserId = Number(body?.userId ?? body?.user_id ?? 0);
    if (!Number.isInteger(participantUserId) || participantUserId <= 0) {
      return NextResponse.json({ message: "Membro inválido." }, { status: 400 });
    }
    return NextResponse.json(await addInternalGroupSweepstakeParticipant(
      Number(params.groupId),
      user.id,
      Number(params.sweepstakeId),
      participantUserId,
    ));
  } catch (error) {
    return error instanceof InternalGroupError
      ? NextResponse.json({ message: error.message }, { status: error.status })
      : NextResponse.json({ message: "Não foi possível adicionar o participante." }, { status: 500 });
  }
}
