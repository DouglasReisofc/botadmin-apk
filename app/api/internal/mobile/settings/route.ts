import { NextResponse } from "next/server";
import { getAdminMobileSettings } from "lib/admin-mobile";

export async function GET(request: Request) {
  const token = request.headers.get("x-internal-token")?.trim() ?? "";
  const expected = process.env.MOBILE_CI_TOKEN?.trim() ?? "";
  if (!expected || token !== expected) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const settings = await getAdminMobileSettings();
  return NextResponse.json(settings);
}

