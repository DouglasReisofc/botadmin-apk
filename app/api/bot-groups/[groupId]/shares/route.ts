import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotGroupError,
  listGroupSharesForOwner,
  updateGroupSharesForOwner,
} from "lib/bot-groups";

type Context = {
  params: Promise<{ groupId: string }>;
};

const parseGroupId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseEmails = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
      .flatMap((entry) => entry.split(/[\n,;]+/))
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
  }
  return [];
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const groupId = parseGroupId(params.groupId);
    if (!groupId) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const shares = await listGroupSharesForOwner(user.id, groupId);
    return NextResponse.json({ shares });
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }
    console.error("Failed to list group shares", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os compartilhamentos do grupo." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const params = await Promise.resolve(context.params);
    const groupId = parseGroupId(params.groupId);
    if (!groupId) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const emails = parseEmails((body as Record<string, unknown> | null)?.emails);
    const result = await updateGroupSharesForOwner(user.id, groupId, emails);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BotGroupError) {
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }
    console.error("Failed to update group shares", error);
    return NextResponse.json(
      { message: "Não foi possível salvar o compartilhamento do grupo." },
      { status: 500 },
    );
  }
}
