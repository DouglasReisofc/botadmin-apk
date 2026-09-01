import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  InternalGroupError,
  listInternalGroupMessageReceipts,
  recordInternalGroupReceipts,
} from "lib/internal-groups";

type Context = { params: Promise<{ groupId: string }> };

const failure = (error: unknown) => {
  if (error instanceof InternalGroupError) {
    return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
  }
  console.error("[internal-groups] receipts request failed", error);
  return NextResponse.json({ message: "Não foi possível atualizar os recibos." }, { status: 500 });
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const body = await request.json().catch(() => ({}));
    const entries = Array.isArray(body?.receipts)
      ? body.receipts
          .map((item: any) => ({
            messageId: Number(item?.messageId ?? item?.id),
            state: item?.state === "read" ? "read" : "delivered",
          }))
          .filter((item: any) => Number.isInteger(item.messageId) && item.messageId > 0)
      : [];
    return NextResponse.json(await recordInternalGroupReceipts(groupId, user.id, entries));
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    const messageId = Number(new URL(request.url).searchParams.get("messageId") ?? 0);
    if (!messageId) return NextResponse.json({ message: "Mensagem inválida." }, { status: 400 });
    return NextResponse.json({ receipts: await listInternalGroupMessageReceipts(groupId, messageId, user.id) });
  } catch (error) {
    return failure(error);
  }
}
