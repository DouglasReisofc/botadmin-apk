import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  dispatchRaffleFinalization,
  drawUserRaffle,
  getUserRaffleByIdForUser,
  summarizeRaffle,
} from "lib/user-raffles";

const shouldAnnounce = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "nao", "não", "no", "off"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "sim", "yes", "on"].includes(normalized)) {
      return true;
    }
  }
  return false;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ raffleId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { raffleId: rawId } = await context.params;
    const raffleId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(raffleId) || raffleId <= 0) {
      return NextResponse.json({ message: "Rifa inválida." }, { status: 400 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // ignore
    }

    const announce = shouldAnnounce(body.announce ?? body.notify);

    const { raffle, winners } = await drawUserRaffle({
      userId: user.id,
      raffleId,
      executedBy: `user:${user.id}`,
    });

    if (announce) {
      await dispatchRaffleFinalization(user.id, raffle, winners);
    }

    const refreshed = await getUserRaffleByIdForUser(user.id, raffle.id);

    return NextResponse.json({
      message: "Rifa sorteada com sucesso.",
      raffle: refreshed ? summarizeRaffle(refreshed) : summarizeRaffle(raffle),
      winners,
    });
  } catch (error) {
    console.error("Failed to draw raffle", error);
    const message = error instanceof Error ? error.message : "Não foi possível sortear a rifa.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
