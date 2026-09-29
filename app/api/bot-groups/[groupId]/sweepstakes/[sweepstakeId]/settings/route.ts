import { NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getSweepstakeForGroup, DEFAULT_SWEEPSTAKE_WINNER_MESSAGE } from "lib/bot-sweepstakes";
import { getDb } from "lib/db";

export async function POST(request: Request, context: { params: Promise<{ groupId: string; sweepstakeId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const params = await context.params;
  const group = await getGroupByIdForUser(user.id, Number(params.groupId));
  if (!group?.remoteId) return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  const sweepstake = await getSweepstakeForGroup(group.instanceId, group.remoteId, Number(params.sweepstakeId));
  if (!sweepstake || sweepstake.status !== "active") return NextResponse.json({ message: "Sorteio ativo não encontrado." }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  const template = typeof body.winnerMessageTemplate === "string" ? body.winnerMessageTemplate.trim() : "";
  const media = typeof body.winnerMediaUrl === "string" ? body.winnerMediaUrl.trim() : null;
  if (template.length > 2000 || (media && !/^(https?:\/\/|\/uploads\/|\/botadmin-landing\/)/i.test(media))) {
    return NextResponse.json({ message: "Mensagem ou mídia inválida." }, { status: 400 });
  }
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<Array<{ metadata: unknown }>>("SELECT metadata FROM bot_sweepstakes WHERE id = ? AND status = 'active' FOR UPDATE", [sweepstake.id]);
    if (!rows.length) { await connection.rollback(); return NextResponse.json({ message: "Sorteio encerrado." }, { status: 409 }); }
    const metadata = typeof rows[0].metadata === "string" ? JSON.parse(rows[0].metadata) : rows[0].metadata || {};
    await connection.query("UPDATE bot_sweepstakes SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      JSON.stringify({ ...metadata, winnerMessageTemplate: template || DEFAULT_SWEEPSTAKE_WINNER_MESSAGE, winnerMediaUrl: media }), sweepstake.id,
    ]);
    await connection.commit();
    return NextResponse.json({ message: "Mensagem do ganhador atualizada." });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
