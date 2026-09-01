import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  createUserRaffleForUser,
  listUserRafflesForUser,
  summarizeRaffle,
  type CreateUserRafflePayload,
} from "lib/user-raffles";

const parseNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parseGroupIds = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => Number(entry))
      .filter((entry, index, array) => Number.isFinite(entry) && entry > 0 && array.indexOf(entry) === index);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((entry) => Number(entry))
      .filter((entry, index, array) => Number.isFinite(entry) && entry > 0 && array.indexOf(entry) === index);
  }
  return [];
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const raffles = await listUserRafflesForUser(user.id);
    return NextResponse.json({ raffles: raffles.map(summarizeRaffle) });
  } catch (error) {
    console.error("Failed to list raffles", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as rifas no momento." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const payload: CreateUserRafflePayload = {
      title: String(body.title ?? "").trim(),
      description: typeof body.description === "string" ? body.description : null,
      price: parseNumber(body.price),
      numbersTotal: parseNumber(body.numbersTotal),
      winnersCount: parseNumber(body.winnersCount, 1),
      groupIds: parseGroupIds(body.groupIds ?? body.groups),
      metadata: typeof body.metadata === "object" && body.metadata ? (body.metadata as Record<string, unknown>) : null,
    };

    const announcementInput = (() => {
      if (body.announcement && typeof body.announcement === "object") {
        return body.announcement as Record<string, unknown>;
      }
      const message = typeof body.announcementMessage === "string" ? body.announcementMessage : undefined;
      const mediaRaw = body.announcementMedia;
      let media: Record<string, unknown> | null | undefined;
      if (mediaRaw === null) {
        media = null;
      } else if (mediaRaw && typeof mediaRaw === "object") {
        media = mediaRaw as Record<string, unknown>;
      } else if (typeof mediaRaw === "string" && mediaRaw.trim()) {
        media = { path: mediaRaw.trim() } as Record<string, unknown>;
      }
      const mentionAll =
        body.announcementMentionAll === undefined
          ? undefined
          : Boolean(body.announcementMentionAll);
      if (message === undefined && media === undefined && mentionAll === undefined) {
        return null;
      }
      const composed: Record<string, unknown> = {};
      if (message !== undefined) composed.message = message;
      if (media !== undefined) composed.media = media;
      if (mentionAll !== undefined) composed.mentionAll = mentionAll;
      return composed;
    })();

    if (announcementInput) {
      payload.announcement = announcementInput as unknown as CreateUserRafflePayload["announcement"];
    }

    const finalizationInput = (() => {
      if (body.finalization && typeof body.finalization === "object") {
        return body.finalization as Record<string, unknown>;
      }
      const message = typeof body.finalMessage === "string" ? body.finalMessage : undefined;
      if (message === undefined) {
        return null;
      }
      return { message };
    })();

    if (finalizationInput) {
      payload.finalization = finalizationInput as unknown as CreateUserRafflePayload["finalization"];
    }

    if (body.purchaseMenu && typeof body.purchaseMenu === "object") {
      payload.purchaseMenu =
        body.purchaseMenu as CreateUserRafflePayload["purchaseMenu"];
    }

    const raffle = await createUserRaffleForUser(user.id, payload);
    return NextResponse.json(
      {
        message: "Rifa criada com sucesso.",
        raffle: summarizeRaffle(raffle),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create raffle", error);
    const message = error instanceof Error ? error.message : "Não foi possível criar a rifa.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
