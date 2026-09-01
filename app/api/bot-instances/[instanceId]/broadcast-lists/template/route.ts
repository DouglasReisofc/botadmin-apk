import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";

type Context = { params: Promise<{ instanceId: string }> };

export async function GET(_: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autenticado.", { status: 401 });
  const instanceId = Number.parseInt((await context.params).instanceId, 10);
  if (!Number.isFinite(instanceId) || !await getInstanceForUser(user.id, instanceId)) return new Response("Perfil não encontrado.", { status: 404 });
  const csv = "nome,telefone,localizacao,detalhes\nMaria Silva,5592999999999,Manaus - AM,Cliente interessado no plano premium\n";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=botadmin-contatos-modelo.csv", "Cache-Control": "no-store" } });
}
