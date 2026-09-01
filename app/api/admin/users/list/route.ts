import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { searchAdminUsersPaged } from "lib/users";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso nao autorizado." }, { status: 403 });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get("query") ?? url.searchParams.get("q");
    const page = Number.parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const pageSize = Number.parseInt(url.searchParams.get("pageSize") || "20", 10) || 20;
    const statusParam = (url.searchParams.get("status") || "all").toLowerCase();
    const status = statusParam === "active" || statusParam === "inactive" ? statusParam : "all";
    const planParam = (url.searchParams.get("plan") || "all").toLowerCase();
    const plan = planParam === "with_active" || planParam === "without_active" ? planParam : "all";

    const result = await searchAdminUsersPaged({
      query: query || undefined,
      page,
      pageSize,
      status,
      plan,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to paginate admin users", error);
    return NextResponse.json(
      { message: "Nao foi possivel carregar a lista de usuarios." },
      { status: 500 },
    );
  }
}

