import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { finalizeInternalGroupSweepstake, InternalGroupError } from "lib/internal-groups";

type Context = { params: Promise<{ groupId: string; sweepstakeId: string }> };
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const params = await context.params;
    return NextResponse.json(await finalizeInternalGroupSweepstake(Number(params.groupId), user.id, Number(params.sweepstakeId)));
  } catch (error) {
    return error instanceof InternalGroupError
      ? NextResponse.json({ message: error.message }, { status: error.status })
      : NextResponse.json({ message: "Não foi possível finalizar o sorteio." }, { status: 500 });
  }
}
