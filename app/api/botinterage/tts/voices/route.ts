import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { NOTIFICATION_VOICE_OPTIONS } from "data/notification-audio";

type PrivateVoice = {
  voiceId: string;
  name: string;
  slug: string | null;
  description: string | null;
};

const BOTINTERAGE_FREE_TTS_BR_VALUES = new Set([
  "ludmilla",
  "laizza",
  "lhays",
  "bueno",
  "ivete",
  "br001",
  "br002",
  "br003",
  "br004",
  "br005",
  "br_003",
  "br_004",
  "br_005",
]);

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const groupIdParam = searchParams.get("groupId");
    const groupId = groupIdParam ? Number.parseInt(groupIdParam, 10) : Number.NaN;
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    const freeVoices = NOTIFICATION_VOICE_OPTIONS
      .filter((voice) => BOTINTERAGE_FREE_TTS_BR_VALUES.has(voice.value))
      .map((voice) => ({
        value: voice.value,
        label: voice.label,
      }));

    return NextResponse.json({
      mode: "free",
      freeVoices,
      privateVoices: [] as PrivateVoice[],
      defaultVoiceId: null,
    });
  } catch (error) {
    console.error("[botinterage-tts-voices] failed to load voices", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as vozes de TTS." },
      { status: 500 },
    );
  }
}
