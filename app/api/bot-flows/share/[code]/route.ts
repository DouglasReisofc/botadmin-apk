import { NextResponse } from "next/server";

import { getSharedBotFlowPackage } from "lib/bot-flow-sharing";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const result = await getSharedBotFlowPackage(code);
    if (!result) {
      return NextResponse.json({ message: "Fluxo compartilhado não encontrado." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[bot-flows/share] GET public error", error);
    return NextResponse.json({ message: "Não foi possível carregar o fluxo compartilhado." }, { status: 500 });
  }
}

