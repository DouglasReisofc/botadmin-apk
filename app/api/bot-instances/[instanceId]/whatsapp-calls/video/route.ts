import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getInstanceForUser } from "lib/bot-instances";
import { getOrCreateUserApiKey } from "lib/user-api-keys";
import {
  CallVideoSourceError,
  inspectCallVideoPlaylist,
  resolveCallVideoSource,
} from "lib/call-video-source";
import {
  deleteWhatsappCallVideoMedia,
  listWhatsappCallVideoLibrary,
  prepareWhatsappCallVideoUrl,
  uploadWhatsappCallVideo,
} from "lib/wuzapi";

type Context = { params: Promise<{ instanceId: string }> };

export const maxDuration = 300;

const authorize = async (rawInstanceId: string) => {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  const instanceId = Number.parseInt(rawInstanceId, 10);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    return { error: NextResponse.json({ message: "Instância inválida." }, { status: 400 }) };
  }
  const instance = await getInstanceForUser(user.id, instanceId);
  if (!instance) return { error: NextResponse.json({ message: "Instância não encontrada." }, { status: 404 }) };
  if (!instance.serverBaseUrl || !instance.token) {
    return { error: NextResponse.json({ message: "Instância sem servidor conectado." }, { status: 409 }) };
  }
  return { client: { baseUrl: instance.serverBaseUrl, token: instance.token }, userId: user.id };
};

const fail = (error: unknown, fallback: string) => {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ message }, { status: status && status >= 400 && status < 600 ? status : 500 });
};

const mediaOf = (payload: unknown) => {
  const data = (payload as { data?: { Media?: unknown; Media_?: unknown } } | null)?.data;
  return data?.Media ?? null;
};

/** Biblioteca de vídeos de chamada da instância (arquivos já preparados na EasyZap). */
export async function GET(_request: Request, context: Context) {
  const { instanceId } = await context.params;
  const auth = await authorize(instanceId);
  if ("error" in auth) return auth.error;
  try {
    const result = await listWhatsappCallVideoLibrary(auth.client);
    const items = (result as { data?: { Media?: unknown[] } } | null)?.data?.Media ?? [];
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return fail(error, "Não foi possível listar os vídeos.");
  }
}

/** multipart (campo "file") envia o arquivo; JSON {url} baixa e prepara um link público. */
export async function POST(request: Request, context: Context) {
  const { instanceId } = await context.params;
  const auth = await authorize(instanceId);
  if ("error" in auth) return auth.error;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.startsWith("multipart/")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size <= 0) {
        return NextResponse.json({ message: "Escolha um arquivo de vídeo." }, { status: 400 });
      }
      const result = await uploadWhatsappCallVideo(auth.client, file, file.name || "video");
      return NextResponse.json({ ok: true, media: mediaOf(result) });
    }
    const body = (await request.json().catch(() => null)) as {
      url?: unknown;
      stream?: unknown;
      action?: unknown;
    } | null;
    const link = typeof body?.url === "string" ? body.url.trim() : "";
    if (body?.action === "inspect_playlist") {
      const playlist = await inspectCallVideoPlaylist(link);
      return NextResponse.json({ ok: true, playlist });
    }
    // Resolve Instagram/TikTok/Kwai/Facebook/Pinterest/YouTube para a URL de mídia;
    // m3u8/HLS e links diretos seguem como estão.
    // Os downloaders internos cobram da chave de API do próprio usuário.
    const userKey = await getOrCreateUserApiKey(auth.userId).catch(() => null);
    const source = await resolveCallVideoSource(link, userKey?.apiKey ?? null);
    const result = await prepareWhatsappCallVideoUrl(auth.client, source.url, {
      stream: body?.stream === true || source.streamOnly,
    });
    return NextResponse.json({
      ok: true,
      media: mediaOf(result),
      source: { platform: source.platform, title: source.title, originalUrl: source.originalUrl },
    });
  } catch (error) {
    if (error instanceof CallVideoSourceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return fail(error, "Não foi possível preparar o vídeo.");
  }
}

export async function DELETE(request: Request, context: Context) {
  const { instanceId } = await context.params;
  const auth = await authorize(instanceId);
  if ("error" in auth) return auth.error;
  const mediaId = new URL(request.url).searchParams.get("mediaId")?.trim() ?? "";
  if (!/^[a-f0-9]{16}$/.test(mediaId)) {
    return NextResponse.json({ message: "mediaId inválido." }, { status: 400 });
  }
  try {
    await deleteWhatsappCallVideoMedia(auth.client, mediaId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, "Não foi possível apagar o vídeo.");
  }
}
