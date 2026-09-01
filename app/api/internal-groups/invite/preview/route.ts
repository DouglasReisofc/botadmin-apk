import { NextResponse } from "next/server";

import { getInternalGroupInvitePreview } from "lib/internal-groups";
import { getPublicAppBaseUrl } from "lib/meta";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = (requestUrl.searchParams.get("token") ?? "").trim();
  if (!token || token.length > 256) {
    return NextResponse.json({ message: "Convite inválido." }, { status: 400 });
  }
  const preview = await getInternalGroupInvitePreview(token).catch(() => null);
  if (!preview) {
    return NextResponse.json(
      { message: "Este convite expirou, foi revogado ou não existe mais.", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }
  const avatarUrl = preview.avatarUrl
    ? new URL(preview.avatarUrl, getPublicAppBaseUrl()).toString()
    : null;
  return NextResponse.json(
    { preview: { ...preview, avatarUrl } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
