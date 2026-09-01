import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminBotConfig } from "lib/admin-bot-config";
import { resolveDefaultSpeechVoice } from "lib/notification-audio";
import {
  DEFAULT_NOTIFICATION_BALANCE_TEMPLATE,
  DEFAULT_NOTIFICATION_BOT_NAME,
  DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE,
  DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE,
  DEFAULT_NOTIFICATION_PLAN_TEMPLATE,
  NOTIFICATION_VOICE_OPTIONS,
} from "data/notification-audio";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const config = await getAdminBotConfig();

    const botName = config.botName?.trim() || DEFAULT_NOTIFICATION_BOT_NAME;
    const purchaseTemplate = config.purchaseVoiceTemplate?.trim() || DEFAULT_NOTIFICATION_PURCHASE_TEMPLATE;
    const balanceTemplate = config.balanceVoiceTemplate?.trim() || DEFAULT_NOTIFICATION_BALANCE_TEMPLATE;
    const raffleTemplate = DEFAULT_NOTIFICATION_RAFFLE_TEMPLATE;
    const planTemplate = DEFAULT_NOTIFICATION_PLAN_TEMPLATE;

    return NextResponse.json({
      botName,
      defaults: {
        purchaseTemplate,
        balanceTemplate,
        raffleTemplate,
        planTemplate,
        voice: resolveDefaultSpeechVoice(),
      },
      voices: NOTIFICATION_VOICE_OPTIONS,
    });
  } catch (error) {
    console.error("Failed to load notification audio config", error);
    return NextResponse.json(
      { message: "Não foi possível carregar as configurações de áudio." },
      { status: 500 },
    );
  }
}
