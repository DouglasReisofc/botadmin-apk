import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import {
  deleteSweepstake,
  getSweepstakeForGroup,
  listSweepstakesForGroup,
} from "lib/bot-sweepstakes";

export async function DELETE(
  _request: Request,
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
    return NextResponse.json(
      { message: "Sincronize o grupo com o WhatsApp antes de administrar sorteios." },
      { status: 409 },
    );
  }

  const instance = await getInstanceForUser(user.id, group.instanceId);
  if (!instance) {
    return NextResponse.json({ message: "Instância vinculada ao grupo não encontrada." }, { status: 404 });
  }

  const sweepstake = await getSweepstakeForGroup(instance.id, group.remoteId, sweepstakeId);
  if (!sweepstake) {
    return NextResponse.json({ message: "Sorteio não encontrado." }, { status: 404 });
  }

  if (sweepstake.status === "active") {
    return NextResponse.json(
      { message: "Finalize ou cancele o sorteio antes de excluí-lo." },
      { status: 409 },
    );
  }

  await deleteSweepstake(sweepstake.id);

  try {
    const list = await listSweepstakesForGroup(instance.id, sweepstake.groupJid);
    return NextResponse.json({
      message: "Sorteio removido do histórico.",
      active: list.active,
      history: list.history,
    });
  } catch (error) {
    console.error("Failed to refresh sweepstakes after delete", { sweepstakeId, error });
    return NextResponse.json(
      { message: "Sorteio excluído, mas houve falha ao atualizar a lista." },
      { status: 207 },
    );
  }
}
