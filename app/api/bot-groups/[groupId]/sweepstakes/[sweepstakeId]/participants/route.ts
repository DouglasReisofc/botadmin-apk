import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { getGroupAccessForUser, getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceForUser } from "lib/bot-instances";
import {
  getSweepstakeForGroup,
  listSweepstakesForGroup,
  recordSweepstakeVote,
} from "lib/bot-sweepstakes";

const digits = (value: unknown) => String(value ?? "").replace(/\D+/g, "");

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string; sweepstakeId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { groupId: rawGroupId, sweepstakeId: rawSweepstakeId } = await context.params;
    const groupId = Number(rawGroupId);
    const sweepstakeId = Number(rawSweepstakeId);
    if (!Number.isInteger(groupId) || groupId <= 0 || !Number.isInteger(sweepstakeId) || sweepstakeId <= 0) {
      return NextResponse.json({ message: "Grupo ou sorteio inválido." }, { status: 400 });
    }
    const access = await getGroupAccessForUser(user.id, groupId);
    if (!access) return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    const group = await getGroupByIdForUser(access.ownerUserId, groupId);
    if (!group?.remoteId) return NextResponse.json({ message: "Grupo sem sincronização." }, { status: 409 });
    const instance = await getInstanceForUser(user.id, group.instanceId);
    if (!instance) return NextResponse.json({ message: "Instância não encontrada." }, { status: 404 });
    const sweepstake = await getSweepstakeForGroup(instance.id, group.remoteId, sweepstakeId);
    if (!sweepstake || sweepstake.status !== "active") {
      return NextResponse.json({ message: "Sorteio ativo não encontrado." }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const requestedJid = String(body?.jid ?? "").trim();
    const member = (group.participants ?? []).find((entry) =>
      entry.id === requestedJid || digits(entry.id) === digits(requestedJid),
    );
    if (!member) return NextResponse.json({ message: "Selecione um membro deste grupo." }, { status: 400 });
    const displayName = String(
      body?.displayName || member.name || member.displayName || member.pushName || "",
    ).trim() || null;
    await recordSweepstakeVote(sweepstake, {
      participantJid: member.id,
      selectedOptionHashes: [sweepstake.joinOptionHash],
      displayName,
    });
    const list = await listSweepstakesForGroup(instance.id, group.remoteId);
    return NextResponse.json({ active: list.active, history: list.history });
  } catch (error) {
    console.error("Failed to add external sweepstake participant", error);
    return NextResponse.json({ message: "Não foi possível adicionar o participante." }, { status: 500 });
  }
}
