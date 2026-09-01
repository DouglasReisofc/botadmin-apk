import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { searchAdminGroups } from "lib/admin-groups";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json({ message: "Acesso não autorizado." }, { status: 403 });
    }

    const url = new URL(request.url);
    const searchParam = url.searchParams.get("query") ?? url.searchParams.get("q");
    const pageParam = url.searchParams.get("page");
    const pageSizeParam = url.searchParams.get("pageSize") ?? url.searchParams.get("page_size");

    const page = pageParam ? Number.parseInt(pageParam, 10) : 1;
    const pageSize = pageSizeParam ? Number.parseInt(pageSizeParam, 10) : 20;

    const result = await searchAdminGroups({
      query: searchParam,
      page,
      pageSize,
    });

    return NextResponse.json({
      message: "Resultados carregados com sucesso.",
      ...result,
    });
  } catch (error) {
    console.error("Failed to list admin groups", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os grupos." },
      { status: 500 },
    );
  }
}
