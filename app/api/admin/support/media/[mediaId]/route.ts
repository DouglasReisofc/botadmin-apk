import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import { getDb } from "lib/db";
import { getMetaApiVersion } from "lib/meta";

export async function GET(
  _request: Request,
  context: { params: { mediaId: string } },
) {
  try {
    const session = await getCurrentUser();
    if (!session) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const { mediaId } = context.params;
    if (!mediaId) {
      return NextResponse.json({ message: "MediaId inválido." }, { status: 400 });
    }

    const requestedUserId = Number(new URL(_request.url).searchParams.get("userId"));
    const tokens: string[] = [];
    if (Number.isInteger(requestedUserId) && requestedUserId > 0) {
      const db = getDb();
      const [rows] = await db.query<Array<{ access_token: string | null }>>(
        "SELECT access_token FROM user_webhooks WHERE user_id = ? LIMIT 1",
        [requestedUserId],
      );
      const userToken = rows[0]?.access_token?.trim();
      if (userToken) tokens.push(userToken);
    }
    const webhookRow = await getAdminWebhookRow();
    const adminToken = webhookRow?.access_token?.trim() ?? "";
    if (adminToken && !tokens.includes(adminToken)) tokens.push(adminToken);
    if (tokens.length === 0) {
      return NextResponse.json(
        { message: "Configure o Access Token do bot administrativo." },
        { status: 400 },
      );
    }

    console.info("[admin-support-media] request", {
      adminUserId: session.id,
      mediaId,
      requestedUserId: Number.isInteger(requestedUserId) && requestedUserId > 0 ? requestedUserId : null,
      tokenCandidates: tokens.length,
    });

    const version = getMetaApiVersion();
    let lastStatus = 502;
    let lastMessage = "Falha ao obter metadados do arquivo.";
    for (const accessToken of tokens) {
      const metadataRes = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const metadata = await metadataRes.json().catch(() => null);
      if (!metadataRes.ok || !metadata?.url) {
        lastStatus = metadataRes.status || 502;
        lastMessage = metadata?.error?.message ?? lastMessage;
        continue;
      }

      const mediaResponse = await fetch(metadata.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!mediaResponse.ok || !mediaResponse.body) {
        lastStatus = mediaResponse.status || 502;
        lastMessage = "Não foi possível baixar o arquivo de mídia.";
        continue;
      }

      const mimeType = metadata.mime_type ?? mediaResponse.headers.get("Content-Type") ?? "application/octet-stream";
      const headers = new Headers();
      headers.set("Content-Type", mimeType);
      if (metadata.file_size) headers.set("Content-Length", String(metadata.file_size));
      if (metadata.id) headers.set("Content-Disposition", `inline; filename="${metadata.id}"`);

      if (metadata.file_size) {
        console.info("[admin-support-media] streaming", { adminUserId: session.id, mediaId, size: metadata.file_size });
      }

      return new Response(mediaResponse.body, { headers });
    }

    console.error("[admin-support-media] metadata/download failure", {
      mediaId,
      status: lastStatus,
      message: lastMessage,
      tokenCandidates: tokens.length,
    });
    return NextResponse.json({ message: lastMessage }, { status: lastStatus });
  } catch (error) {
    console.error("[admin-support-media] unexpected error", { mediaId: context.params.mediaId, error });
    return NextResponse.json(
      { message: "Erro ao recuperar arquivo de mídia." },
      { status: 500 },
    );
  }
}
