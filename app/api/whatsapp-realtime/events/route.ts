import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getLatestWhatsappRealtimeSequence,
  listWhatsappRealtimeEvents,
} from "lib/whatsapp-conversations";
import { serializeWhatsappRealtimeEvent } from "lib/whatsapp-realtime-bus";

const readPositiveInt = (value: string | null, fallback = 0) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const after = readPositiveInt(url.searchParams.get("after"), 0);
  const limit = readPositiveInt(url.searchParams.get("limit"), 200);
  const instanceId = readPositiveInt(url.searchParams.get("instanceId"), 0);
  const chatJid = url.searchParams.get("chatJid");

  const events = await listWhatsappRealtimeEvents(user.id, {
    after,
    limit,
    instanceId: instanceId || null,
    chatJid,
  });
  const latestSequenceId = await getLatestWhatsappRealtimeSequence(user.id);

  return NextResponse.json({
    events: events.map(serializeWhatsappRealtimeEvent),
    latestSequenceId,
  });
}
