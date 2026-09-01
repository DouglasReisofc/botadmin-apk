import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { searchInstancesForServerAssignment } from "lib/bot-instances";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");
    const limitParam = searchParams.get("limit");
    const serverParam = searchParams.get("serverId");

    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const serverId = serverParam ? Number.parseInt(serverParam, 10) : undefined;

    const instances = await searchInstancesForServerAssignment({
      query,
      limit,
      serverId: Number.isFinite(serverId) ? serverId : undefined,
    });

    return NextResponse.json({ instances });
  } catch (error) {
    console.error("Failed to search instances for assignment", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as instâncias." },
      { status: 500 },
    );
  }
}
