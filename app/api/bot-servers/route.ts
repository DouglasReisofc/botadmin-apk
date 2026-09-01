import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getActiveBotServers } from "lib/bot-servers";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const servers = await getActiveBotServers();
    return NextResponse.json({
      servers: servers.map((server) => ({
        id: server.id,
        name: server.name,
        sessionLimit: server.sessionLimit,
      })),
    });
  } catch (error) {
    console.error("Failed to list active bot servers", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os servidores." },
      { status: 500 },
    );
  }
}
