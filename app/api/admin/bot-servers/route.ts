import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  BotServerError,
  createBotServer,
  getAllBotServers,
} from "lib/bot-servers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const servers = await getAllBotServers();
    return NextResponse.json({ servers });
  } catch (error) {
    console.error("Failed to list bot servers", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os servidores." },
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
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      name,
      baseUrl,
      apiType,
      globalApiKey,
      sessionLimit,
      isActive,
    } = body as Record<string, unknown>;

    const server = await createBotServer({
      name: typeof name === "string" ? name : "",
      baseUrl: typeof baseUrl === "string" ? baseUrl : "",
      apiType: typeof apiType === "string" ? apiType : undefined,
      globalApiKey: typeof globalApiKey === "string" ? globalApiKey : "",
      sessionLimit: sessionLimit as number | string | undefined,
      isActive: typeof isActive === "boolean" ? isActive : undefined,
    });

    return NextResponse.json(
      { message: "Servidor cadastrado com sucesso.", server },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BotServerError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Failed to create bot server", error);
    return NextResponse.json(
      { message: "Não foi possível cadastrar o servidor." },
      { status: 500 },
    );
  }
}
