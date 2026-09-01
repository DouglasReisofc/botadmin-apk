import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  deleteEmptyRegistrationUsers,
  getEmptyRegistrationCleanupPreview,
} from "lib/users";

const CONFIRMATION_TEXT = "LIMPAR-CADASTROS-VAZIOS";

const requireAdmin = async () => {
  const currentUser = await getCurrentUser();
  return currentUser?.role === "admin";
};

export async function GET(request: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const requestedLimit = Number.parseInt(
      new URL(request.url).searchParams.get("limit") || "50",
      10,
    );
    const preview = await getEmptyRegistrationCleanupPreview(requestedLimit);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("Failed to preview empty registration cleanup", error);
    return NextResponse.json(
      { message: "Não foi possível validar os cadastros vazios com segurança." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      (body as { confirmation?: unknown }).confirmation !== CONFIRMATION_TEXT
    ) {
      return NextResponse.json(
        { message: `Confirme digitando ${CONFIRMATION_TEXT}.` },
        { status: 400 },
      );
    }

    const deletedCount = await deleteEmptyRegistrationUsers();
    return NextResponse.json({
      deletedCount,
      message:
        deletedCount > 0
          ? `${deletedCount} cadastro(s) vazio(s) foram removidos permanentemente.`
          : "Nenhum cadastro vazio elegível foi encontrado.",
    });
  } catch (error) {
    console.error("Failed to delete empty registrations", error);
    return NextResponse.json(
      { message: "Não foi possível concluir a limpeza com segurança." },
      { status: 500 },
    );
  }
}
