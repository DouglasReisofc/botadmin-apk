import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getUserNotificationAudioSettings,
  saveUserNotificationAudioSettings,
} from "lib/notification-audio-settings";
import type { UserNotificationAudioSettings } from "types/notifications";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const settings = await getUserNotificationAudioSettings(user.id);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to load notification audio settings", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações de áudio." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    let body: Partial<UserNotificationAudioSettings> = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === "object") {
        body = raw as Partial<UserNotificationAudioSettings>;
      }
    } catch {
      body = {};
    }

    const settings = await saveUserNotificationAudioSettings(user.id, body);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Failed to save notification audio settings", error);
    return NextResponse.json(
      { message: "Não foi possível salvar as configurações de áudio." },
      { status: 500 },
    );
  }
}
