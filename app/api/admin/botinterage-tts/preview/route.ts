import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  AdminBotInterageTtsApiError,
  fetchAdminBotInterageTtsUpstream,
} from "lib/admin-botinterage-tts-api";

const parseUpstreamError = async (response: Response): Promise<string> => {
  const payload = await response.json().catch(() => null) as
    | { detail?: string; message?: string; error?: string; body?: string }
    | null;
  return (
    payload?.detail ||
    payload?.message ||
    payload?.error ||
    payload?.body ||
    `Falha na API TTS (${response.status}).`
  );
};

export async function GET(request: NextRequest) {
  try {
    const startedAt = Date.now();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const voiceId = (searchParams.get("voiceId") || "").trim();
    const text = (searchParams.get("text") || "").trim();

    if (!voiceId) {
      return NextResponse.json({ message: "Informe o voice_id." }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ message: "Informe o texto para prévia." }, { status: 400 });
    }

    const upstream = await fetchAdminBotInterageTtsUpstream("/v1/tts", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/wav" },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        format: "wav",
        streaming: true,
      }),
    });

    if (!upstream.ok) {
      throw new AdminBotInterageTtsApiError(
        await parseUpstreamError(upstream),
        upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      );
    }

    const contentType = upstream.headers.get("content-type") || "audio/wav";
    console.info("[admin-botinterage-tts] preview stream started", {
      voiceId,
      elapsedMs: Date.now() - startedAt,
      contentType,
    });
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AdminBotInterageTtsApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[admin-botinterage-tts] failed to build preview", error);
    return NextResponse.json(
      { message: "Não foi possível gerar a prévia de áudio." },
      { status: 500 },
    );
  }
}
