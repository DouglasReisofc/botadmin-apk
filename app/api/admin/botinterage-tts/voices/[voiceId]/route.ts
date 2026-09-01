import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  AdminBotInterageTtsApiError,
  fetchAdminBotInterageTtsUpstream,
} from "lib/admin-botinterage-tts-api";

const parseUpstreamError = async (response: Response): Promise<string> => {
  const payload = await response.json().catch(() => null) as
    | { detail?: string; message?: string; error?: string }
    | null;
  return (
    payload?.detail ||
    payload?.message ||
    payload?.error ||
    `Falha na API TTS (${response.status}).`
  );
};

const ensureAdmin = async () => {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  }
  return null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ voiceId: string }> },
) {
  try {
    const authError = await ensureAdmin();
    if (authError) return authError;

    const { voiceId: rawVoiceId } = await context.params;
    const voiceId = rawVoiceId?.trim();
    if (!voiceId) {
      return NextResponse.json({ message: "voice_id inválido." }, { status: 400 });
    }

    const payload = (await request.json().catch(() => null)) as
      | {
          name?: string;
          slug?: string;
          description?: string;
          referenceText?: string;
          tags?: string[];
        }
      | null;
    if (!payload) {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const body = {
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
      ...(typeof payload.slug === "string" ? { slug: payload.slug } : {}),
      ...(typeof payload.description === "string" ? { description: payload.description } : {}),
      ...(typeof payload.referenceText === "string" ? { reference_text: payload.referenceText } : {}),
      ...(Array.isArray(payload.tags) ? { tags: payload.tags } : {}),
    };

    const response = await fetchAdminBotInterageTtsUpstream(`/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const responsePayload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AdminBotInterageTtsApiError(
        await parseUpstreamError(response),
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }

    return NextResponse.json({
      message: "Voz atualizada com sucesso.",
      voice: responsePayload ?? null,
    });
  } catch (error) {
    if (error instanceof AdminBotInterageTtsApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[admin-botinterage-tts] failed to update voice", error);
    return NextResponse.json({ message: "Não foi possível atualizar a voz." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ voiceId: string }> },
) {
  try {
    const authError = await ensureAdmin();
    if (authError) return authError;

    const { voiceId: rawVoiceId } = await context.params;
    const voiceId = rawVoiceId?.trim();
    if (!voiceId) {
      return NextResponse.json({ message: "voice_id inválido." }, { status: 400 });
    }

    const response = await fetchAdminBotInterageTtsUpstream(`/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AdminBotInterageTtsApiError(
        await parseUpstreamError(response),
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }

    return NextResponse.json({
      message: "Voz removida com sucesso.",
      result: payload ?? null,
    });
  } catch (error) {
    if (error instanceof AdminBotInterageTtsApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[admin-botinterage-tts] failed to delete voice", error);
    return NextResponse.json({ message: "Não foi possível excluir a voz." }, { status: 500 });
  }
}
