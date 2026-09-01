import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { releaseAllReservationsForRaffleForUser, summarizeRaffle } from "lib/user-raffles";

export async function POST(
  _request: Request,
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

    const updated = await releaseAllReservationsForRaffleForUser(user.id, raffleId);
    if (!updated) {
      return NextResponse.json({ message: "Rifa não encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Reservas liberadas com sucesso.",
      raffle: summarizeRaffle(updated),
    });
  } catch (error) {
    console.error("Failed to release raffle reservations", error);
    const message = error instanceof Error ? error.message : "Não foi possível liberar as reservas.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
