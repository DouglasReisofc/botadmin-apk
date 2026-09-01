import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import type { AndroidPushOptions } from "lib/push-notifications";
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  ANDROID_NOTIFICATION_SOUND,
  ANDROID_TTS_DEFAULT_LOCALE,
  sendPushNotification,
  sendPushNotificationToUser,
  sendPushNotificationToAllUsers,
} from "lib/push-notifications";

export async function POST(request: Request) {
  const sessionUser = await getCurrentUser();

  if (!sessionUser) {
    return NextResponse.json({ message: "Nao autenticado." }, { status: 401 });
  }

  if (sessionUser.role !== "admin") {
    return NextResponse.json({ message: "Permissao negada." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Payload invalido." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const message = typeof payload.body === "string" ? payload.body.trim() : "";
  const dataRaw = payload.data;
  const userIdRaw = payload.userId;
  const tokensRaw = payload.tokens;
  const androidRaw = payload.android;
  const broadcastRaw = payload.broadcast;
  const imageUrlRaw = payload.imageUrl;
  const targetUrlRaw = payload.targetUrl;

  let androidOptions: AndroidPushOptions | undefined;

  if (androidRaw && typeof androidRaw === "object") {
    const rawObject = androidRaw as Record<string, unknown>;
    androidOptions = {
      channelId: typeof rawObject.channelId === "string" ? rawObject.channelId : undefined,
      sound: typeof rawObject.sound === "string" ? rawObject.sound : undefined,
      soundUrl: typeof rawObject.soundUrl === "string" ? rawObject.soundUrl : undefined,
      speakText: typeof rawObject.speakText === "string" ? rawObject.speakText : undefined,
      speakLocale: typeof rawObject.speakLocale === "string" ? rawObject.speakLocale : undefined,
      speechMode: typeof rawObject.speechMode === "string" ? rawObject.speechMode : undefined,
      speechVoice: typeof rawObject.speechVoice === "string" ? rawObject.speechVoice : undefined,
      speakUrl: typeof rawObject.speakUrl === "string" ? rawObject.speakUrl : undefined,
      imageUrl: typeof rawObject.imageUrl === "string" ? rawObject.imageUrl : undefined,
    };
  }

  const defaultSpeakText = message || title;
  const normalizedImageUrl =
    typeof imageUrlRaw === "string" ? imageUrlRaw.trim() : "";

  const resolveAndroidOptions = () => {
    const speakText = (androidOptions?.speakText ?? defaultSpeakText)?.trim() || undefined;
    const rawSpeechMode = androidOptions?.speechMode;
    let speechMode: AndroidPushOptions["speechMode"];
    if (typeof rawSpeechMode === "string") {
      const normalized = rawSpeechMode.trim().toLowerCase();
      if (normalized === "browser" || normalized === "api") {
        speechMode = normalized;
      }
    } else if (rawSpeechMode === "browser" || rawSpeechMode === "api") {
      speechMode = rawSpeechMode;
    }

    const speechVoice = androidOptions?.speechVoice?.trim() || undefined;
    const speakUrl = androidOptions?.speakUrl?.trim() || undefined;
    const soundUrl = androidOptions?.soundUrl?.trim() || undefined;
    const imageUrl =
      typeof androidOptions?.imageUrl === "string" && androidOptions.imageUrl.trim()
        ? androidOptions.imageUrl.trim()
        : normalizedImageUrl || undefined;

    return {
      channelId: androidOptions?.channelId?.trim() || ANDROID_NOTIFICATION_CHANNEL_ID,
      sound: androidOptions?.sound?.trim() || ANDROID_NOTIFICATION_SOUND,
      soundUrl,
      speakText,
      speakLocale: androidOptions?.speakLocale?.trim() || ANDROID_TTS_DEFAULT_LOCALE,
      speechMode,
      speechVoice,
      speakUrl,
      imageUrl,
    };
  };

  let data: Record<string, string | number | boolean | null> | undefined;
  if (dataRaw && typeof dataRaw === "object" && !Array.isArray(dataRaw)) {
    data = { ...(dataRaw as Record<string, string | number | boolean | null>) };
  }

  const normalizedTargetUrl =
    typeof targetUrlRaw === "string" ? targetUrlRaw.trim() : "";

  if (normalizedTargetUrl) {
    if (!data) {
      data = {};
    }
    data.targetUrl = normalizedTargetUrl;
  }

  if (normalizedImageUrl) {
    if (!data) {
      data = {};
    }
    data.imageUrl = normalizedImageUrl;
  }

  const hasContent = Boolean(title || message || (data && Object.keys(data).length));

  if (!hasContent) {
    return NextResponse.json({ message: "Informe titulo, mensagem ou dados." }, { status: 400 });
  }

  const broadcast =
    typeof broadcastRaw === "boolean"
      ? broadcastRaw
      : typeof broadcastRaw === "string"
        ? ["1", "true", "on", "yes"].includes(broadcastRaw.trim().toLowerCase())
        : false;

  try {
    if (broadcast) {
      await sendPushNotificationToAllUsers({
        title,
        body: message,
        data,
        android: resolveAndroidOptions(),
      });
      return NextResponse.json({ message: "Notificacao enviada." });
    }

    if (typeof userIdRaw === "number") {
      await sendPushNotificationToUser(userIdRaw, {
        title,
        body: message,
        data,
        android: resolveAndroidOptions(),
      });
      return NextResponse.json({ message: "Notificacao enviada." });
    }

    if (Array.isArray(tokensRaw) && tokensRaw.length > 0) {
      const tokens = tokensRaw.filter((token): token is string => typeof token === "string" && token.trim().length > 0);
      if (!tokens.length) {
        return NextResponse.json({ message: "Informe tokens validos." }, { status: 400 });
      }
      await sendPushNotification({
        tokens,
        notification: title || message ? { title, body: message } : undefined,
        data,
        android: resolveAndroidOptions(),
      });
      return NextResponse.json({ message: "Notificacao enviada." });
    }

    return NextResponse.json(
      { message: "Informe o usuario, tokens ou habilite o envio em broadcast." },
      { status: 400 },
    );
  } catch (error) {
    console.error("Falha ao enviar push notification", error);
    return NextResponse.json({ message: "Nao foi possivel enviar a notificacao." }, { status: 500 });
  }
}
