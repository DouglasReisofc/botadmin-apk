import { NextResponse } from "next/server";

import { getAndroidKeystoreForCi } from "lib/mobile-signing";

export async function GET(request: Request) {
  const token = request.headers.get("x-internal-token")?.trim() ?? "";
  const expected = process.env.MOBILE_CI_TOKEN?.trim() ?? "";

  if (!expected || token !== expected) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const payload = await getAndroidKeystoreForCi();
  if (!payload) {
    return NextResponse.json({ message: "Keystore não configurado." }, { status: 404 });
  }

  return NextResponse.json(payload);
}

