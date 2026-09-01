import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
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

    console.info("[admin-support-media] request", { adminUserId: session.id, mediaId });

    const webhookRow = await getAdminWebhookRow();
    const accessToken = webhookRow?.access_token?.trim() ?? "";
    if (!accessToken) {
      return NextResponse.json(
        { message: "Configure o Access Token do bot administrativo." },
        { status: 400 },
      );
    }

    const version = getMetaApiVersion();
    const metadataRes = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const metadata = await metadataRes.json().catch(() => null);
    if (!metadataRes.ok || !metadata?.url) {
      const message = metadata?.error?.message ?? "Falha ao obter metadados do arquivo.";
      console.error("[admin-support-media] metadata failure", {
        status: metadataRes.status,
        mediaId,
        message,
        raw: metadata,
      });
      return NextResponse.json({ message }, { status: metadataRes.status || 502 });
    }

    const mediaResponse = await fetch(metadata.url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!mediaResponse.ok || !mediaResponse.body) {
      console.error("[admin-support-media] download failure", {
        status: mediaResponse.status,
        mediaId,
        headers: Object.fromEntries(mediaResponse.headers.entries()),
      });
      return NextResponse.json(
        { message: "Não foi possível baixar o arquivo de mídia." },
        { status: mediaResponse.status || 502 },
      );
    }

    const mimeType = metadata.mime_type ?? mediaResponse.headers.get("Content-Type") ?? "application/octet-stream";
    const headers = new Headers();
    headers.set("Content-Type", mimeType);
    if (metadata.file_size) {
      headers.set("Content-Length", String(metadata.file_size));
    }
    if (metadata.id) {
      headers.set("Content-Disposition", `inline; filename="${metadata.id}"`);
    }

    if (metadata.file_size) {
      console.info("[admin-support-media] streaming", { adminUserId: session.id, mediaId, size: metadata.file_size });
    }

    return new Response(mediaResponse.body, { headers });
  } catch (error) {
    console.error("[admin-support-media] unexpected error", { mediaId: context.params.mediaId, error });
    return NextResponse.json(
      { message: "Erro ao recuperar arquivo de mídia." },
      { status: 500 },
    );
  }
}
