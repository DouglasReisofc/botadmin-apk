import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAllUsefulLinkBanners, getAllUsefulLinks } from "lib/useful-links";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const [links, banners] = await Promise.all([getAllUsefulLinks(), getAllUsefulLinkBanners()]);
    return NextResponse.json({ links, banners });
  } catch (error) {
    console.error("Failed to list useful links", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os links úteis configurados." },
      { status: 500 },
    );
  }
}
