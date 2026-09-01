import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAdminMediaStorageSummary,
  getUserMediaStorageSummary,
  listUserMediaStoragePlans,
} from "lib/user-media-storage";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const [plans, storage] = await Promise.all([
      listUserMediaStoragePlans(),
      user.role === "admin"
        ? getAdminMediaStorageSummary(user.id)
        : getUserMediaStorageSummary(user.id),
    ]);

    return NextResponse.json({ plans, storage, adminExempt: user.role === "admin" });
  } catch (error) {
    console.error("Failed to load media storage plans", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os planos de armazenamento." },
      { status: 500 },
    );
  }
}
