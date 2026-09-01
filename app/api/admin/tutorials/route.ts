import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAllFieldTutorials } from "lib/tutorials";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const tutorials = await getAllFieldTutorials();
    return NextResponse.json({ tutorials });
  } catch (error) {
    console.error("Failed to list tutorials", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os tutoriais configurados." },
      { status: 500 },
    );
  }
}
