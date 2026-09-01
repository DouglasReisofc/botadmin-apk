import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  AdminBotInterageTtsApiError,
  fetchAdminBotInterageTtsUpstream,
} from "lib/admin-botinterage-tts-api";
import { getAdminBotInterageTtsConfig } from "lib/admin-botinterage-tts-config";
import { convertMediaBufferToVoiceReferenceWav } from "lib/media/audio";

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

const DIRECT_AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".wave",
  ".mp3",
  ".flac",
  ".ogg",
  ".m4a",
  ".aac",
  ".aiff",
  ".aif",
  ".opus",
  ".webm",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".3gp",
  ".mpeg",
  ".mpg",
]);

const getFileExtension = (fileName: string): string => {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx).toLowerCase();
};

const shouldNormalizeReferenceAudio = (file: File): boolean => {
  const ext = getFileExtension(file.name || "");
  const mime = (file.type || "").toLowerCase();

  if (mime.startsWith("video/")) return true;
  if (VIDEO_EXTENSIONS.has(ext)) return true;

  if (mime.startsWith("audio/")) {
    return ext ? !DIRECT_AUDIO_EXTENSIONS.has(ext) : false;
  }

  if (DIRECT_AUDIO_EXTENSIONS.has(ext)) return false;

  return true;
};

const normalizeReferenceAudio = async (file: File): Promise<File> => {
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const converted = await convertMediaBufferToVoiceReferenceWav({
    buffer: sourceBuffer,
    fileName: file.name || "reference",
    mimeType: file.type || "application/octet-stream",
  });
  return new File([converted.buffer], converted.fileName, { type: converted.mimeType });
};

const parseUpstreamErrorFromPayload = (
  payload: unknown,
  status: number,
): string => {
  if (payload && typeof payload === "object") {
    const asObj = payload as { detail?: unknown; message?: unknown; error?: unknown };
    if (typeof asObj.detail === "string" && asObj.detail.trim()) return asObj.detail.trim();
    if (typeof asObj.message === "string" && asObj.message.trim()) return asObj.message.trim();
    if (typeof asObj.error === "string" && asObj.error.trim()) return asObj.error.trim();
  }
  return `Falha na API TTS (${status}).`;
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const [config, voicesResponse] = await Promise.all([
      getAdminBotInterageTtsConfig(),
      fetchAdminBotInterageTtsUpstream("/v1/voices"),
    ]);

    if (!voicesResponse.ok) {
      throw new AdminBotInterageTtsApiError(
        await parseUpstreamError(voicesResponse),
        voicesResponse.status >= 400 && voicesResponse.status < 600 ? voicesResponse.status : 502,
      );
    }

    const payload = await voicesResponse.json().catch(() => null) as
      | { voices?: Array<Record<string, unknown>>; count?: number }
      | null;

    const voices = Array.isArray(payload?.voices)
      ? payload!.voices
          .map((entry) => {
            const voiceId = typeof entry?.voice_id === "string" ? entry.voice_id.trim() : "";
            if (!voiceId) return null;
            return {
              voiceId,
              name:
                typeof entry?.name === "string" && entry.name.trim()
                  ? entry.name.trim()
                  : voiceId,
              slug:
                typeof entry?.slug === "string" && entry.slug.trim()
                  ? entry.slug.trim()
                  : null,
              description:
                typeof entry?.description === "string" && entry.description.trim()
                  ? entry.description.trim()
                  : null,
              tags: Array.isArray(entry?.tags)
                ? entry.tags.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                : [],
              updatedAtUnix:
                typeof entry?.updated_at_unix === "number" && Number.isFinite(entry.updated_at_unix)
                  ? entry.updated_at_unix
                  : null,
              createdAtUnix:
                typeof entry?.created_at_unix === "number" && Number.isFinite(entry.created_at_unix)
                  ? entry.created_at_unix
                  : null,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : [];

    return NextResponse.json({
      voices,
      count: voices.length,
      defaultVoiceId: config.defaultVoiceId ?? null,
    });
  } catch (error) {
    if (error instanceof AdminBotInterageTtsApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[admin-botinterage-tts] failed to list voices", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as vozes da API TTS." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const form = await request.formData();
    const referenceAudio = form.get("referenceAudio");
    const referenceText = typeof form.get("referenceText") === "string" ? String(form.get("referenceText")) : "";
    const name = typeof form.get("name") === "string" ? String(form.get("name")) : "";
    const slug = typeof form.get("slug") === "string" ? String(form.get("slug")) : "";
    const description = typeof form.get("description") === "string" ? String(form.get("description")) : "";
    const tags = typeof form.get("tags") === "string" ? String(form.get("tags")) : "";

    if (!(referenceAudio instanceof File)) {
      return NextResponse.json(
        { message: "Envie o áudio de referência para clonar a voz." },
        { status: 400 },
      );
    }
    if (!referenceText.trim()) {
      return NextResponse.json(
        { message: "Informe o texto de referência da gravação." },
        { status: 400 },
      );
    }

    const tagsJson = tags
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const sendCreateVoiceRequest = async (audioFile: File) => {
      const upstreamForm = new FormData();
      upstreamForm.append("reference_audio", audioFile);
      upstreamForm.append("reference_text", referenceText.trim());
      upstreamForm.append("name", name.trim());
      upstreamForm.append("slug", slug.trim());
      upstreamForm.append("description", description.trim());
      upstreamForm.append("tags_json", JSON.stringify(tagsJson));
      return fetchAdminBotInterageTtsUpstream("/v1/voices", {
        method: "POST",
        body: upstreamForm,
      });
    };

    let normalizedAudio = shouldNormalizeReferenceAudio(referenceAudio);
    let referenceAudioToSend = referenceAudio;
    try {
      referenceAudioToSend = await normalizeReferenceAudio(referenceAudio);
      normalizedAudio = true;
    } catch (conversionError) {
      console.error("[admin-botinterage-tts] failed to normalize reference audio", conversionError);
    }

    let response = await sendCreateVoiceRequest(referenceAudioToSend);
    let payload = await response.json().catch(() => null);

    if (!response.ok && !normalizedAudio) {
      try {
        referenceAudioToSend = await normalizeReferenceAudio(referenceAudio);
        normalizedAudio = true;
        response = await sendCreateVoiceRequest(referenceAudioToSend);
        payload = await response.json().catch(() => null);
      } catch (conversionError) {
        console.error("[admin-botinterage-tts] failed to normalize reference audio", conversionError);
      }
    }

    if (!response.ok) {
      throw new AdminBotInterageTtsApiError(
        parseUpstreamErrorFromPayload(payload, response.status),
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }

    return NextResponse.json({
      message: normalizedAudio
        ? "Voz clonada com sucesso (áudio convertido automaticamente)."
        : "Voz clonada com sucesso.",
      voice: payload ?? null,
    });
  } catch (error) {
    if (error instanceof AdminBotInterageTtsApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("[admin-botinterage-tts] failed to create voice", error);
    return NextResponse.json(
      { message: "Não foi possível criar a voz clonada." },
      { status: 500 },
    );
  }
}
