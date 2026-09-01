import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getBotAdCampaignById, updateBotAdCampaign } from "lib/bot-ad-campaigns";
import { assertStatusCampaignCommandAvailable } from "lib/status-campaign-command";

type RouteContext = { params: Promise<{ campaignId: string }> };

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const { campaignId } = await context.params;
    const campaign = await getBotAdCampaignById(user.id, campaignId);
    if (!campaign) return NextResponse.json({ message: "Lista não encontrada." }, { status: 404 });
    if (!campaign.targets.some((target) => target.type === "status")) {
      return NextResponse.json({ message: "Este comando só pode ser usado em listas de status." }, { status: 400 });
    }
    const body = toRecord(await request.json().catch(() => null));
    const enabled = body.enabled !== false;
    const provider = body.captionProvider === "auto" || body.captionProvider === "chatgpt"
      ? body.captionProvider
      : "gemini";
    const command = enabled
      ? await assertStatusCampaignCommandAvailable({
          userId: user.id,
          campaignId,
          command: String(body.command || ""),
        })
      : String(body.command || campaign.options?.statusCommand?.command || "addstatus");
    const updated = await updateBotAdCampaign(user.id, campaignId, {
      name: campaign.name,
      options: {
        ...(campaign.options || {}),
        statusCommand: { enabled, command, captionProvider: provider },
      },
    });
    return NextResponse.json({
      message: enabled ? "Comando da lista salvo." : "Comando da lista desativado.",
      campaign: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Não foi possível salvar o comando." },
      { status: 400 },
    );
  }
}
