import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getUserRaffleByIdForUser,
  summarizeRaffle,
  updateUserRaffleForUser,
  updateUserRaffleStatus,
  deleteUserRaffleForUser,
  type UpdateUserRafflePayload,
  type UserRaffleStatus,
} from "lib/user-raffles";

const parseStatus = (value: unknown): UserRaffleStatus | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "active":
    case "selling":
    case "sold_out":
    case "completed":
    case "cancelled":
    case "draft":
      return normalized as UserRaffleStatus;
    default:
      return null;
  }
};

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
};

const parseGroupIds = (value: unknown): number[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
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

export async function GET(
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

    const raffle = await getUserRaffleByIdForUser(user.id, raffleId);
    if (!raffle) {
      return NextResponse.json({ message: "Rifa não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ raffle });
  } catch (error) {
    console.error("Failed to load raffle", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os detalhes da rifa." },
      { status: 500 },
    );
  }
}

export async function PATCH(
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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const nextStatus = parseStatus(body.status ?? body.action);
    if (!nextStatus) {
      return NextResponse.json({ message: "Nada para atualizar." }, { status: 400 });
    }

    const updated = await updateUserRaffleStatus(user.id, raffleId, nextStatus);
    if (!updated) {
      return NextResponse.json({ message: "Rifa não encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Rifa atualizada com sucesso.",
      raffle: summarizeRaffle(updated),
    });
  } catch (error) {
    console.error("Failed to update raffle", error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar a rifa.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function PUT(
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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const payload: UpdateUserRafflePayload = {};

    if ("title" in body) {
      if (body.title === null) {
        payload.title = "";
      } else if (typeof body.title === "string") {
        payload.title = body.title;
      } else {
        payload.title = String(body.title);
      }
    }
    if ("description" in body) {
      payload.description =
        body.description === null
          ? null
          : typeof body.description === "string"
            ? body.description
            : String(body.description);
    }
    if ("price" in body) {
      const price = parseNumber(body.price);
      if (price === undefined) {
        return NextResponse.json({ message: "Informe um valor válido para o preço." }, { status: 400 });
      }
      payload.price = price;
    }
    if ("numbersTotal" in body) {
      const numbersTotal = parseNumber(body.numbersTotal);
      if (numbersTotal === undefined) {
        return NextResponse.json({ message: "Informe uma quantidade válida de números." }, { status: 400 });
      }
      payload.numbersTotal = numbersTotal;
    }
    if ("winnersCount" in body) {
      const winnersCount = parseNumber(body.winnersCount);
      if (winnersCount === undefined) {
        return NextResponse.json({ message: "Informe uma quantidade válida de ganhadores." }, { status: 400 });
      }
      payload.winnersCount = winnersCount;
    }
    const groupIds = parseGroupIds(body.groupIds ?? body.groups);
    if (groupIds !== undefined) {
      payload.groupIds = groupIds;
    }

    if (
      "announcement" in body ||
      "announcementMessage" in body ||
      "announcementMedia" in body ||
      "announcementMentionAll" in body
    ) {
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
        const composed: Record<string, unknown> = {};
        if (message !== undefined) composed.message = message;
        if (media !== undefined) composed.media = media;
        if (mentionAll !== undefined) composed.mentionAll = mentionAll;
        return composed;
      })();
      payload.announcement = announcementInput as UpdateUserRafflePayload["announcement"];
    }

    if ("finalization" in body || "finalMessage" in body) {
      const finalizationInput = (() => {
        if (body.finalization && typeof body.finalization === "object") {
          return body.finalization as Record<string, unknown>;
        }
        const message = typeof body.finalMessage === "string" ? body.finalMessage : undefined;
        if (message === undefined) {
          return undefined;
        }
        return { message };
      })();
      payload.finalization = finalizationInput as UpdateUserRafflePayload["finalization"];
    }

    if ("purchaseMenu" in body && body.purchaseMenu && typeof body.purchaseMenu === "object") {
      payload.purchaseMenu =
        body.purchaseMenu as UpdateUserRafflePayload["purchaseMenu"];
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ message: "Nada para atualizar." }, { status: 400 });
    }

    const updated = await updateUserRaffleForUser(user.id, raffleId, payload);
    if (!updated) {
      return NextResponse.json({ message: "Rifa não encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      message: "Rifa atualizada com sucesso.",
      raffle: summarizeRaffle(updated),
    });
  } catch (error) {
    console.error("Failed to update raffle", error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar a rifa.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(
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

    await deleteUserRaffleForUser(user.id, raffleId);

    return NextResponse.json({ message: "Rifa excluída com sucesso." });
  } catch (error) {
    console.error("Failed to delete raffle", error);
    const message = error instanceof Error ? error.message : "Não foi possível excluir a rifa.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
