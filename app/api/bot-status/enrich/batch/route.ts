import { after, NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getBotAdCampaignById } from "lib/bot-ad-campaigns";
import { resolveInternalUserId } from "lib/internal-user-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? resolveInternalUserId(request);
    if (!userId) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    const body = record(await request.json());
    const campaignId = text(body.campaignId);
    if (!campaignId) {
      return NextResponse.json({ message: "Informe a programação de status." }, { status: 400 });
    }
    const campaign = await getBotAdCampaignById(userId, campaignId);
    if (!campaign) {
      return NextResponse.json({ message: "Programação não encontrada." }, { status: 404 });
    }
    const requested = Array.isArray(body.items)
      ? body.items.slice(0, 10_000).map(record)
      : [];
    const byId = new Map(
      campaign.contents.map((content) => [text(content.id), content] as const),
    );
    const jobs = requested.flatMap((entry) => {
      const contentId = text(entry.contentId);
      const content = byId.get(contentId);
      const media = record(content?.media);
      const mediaUrl = text(media.url);
      const mediaPath = text(media.path);
      if (!content || text(content.type) !== "status" || (!mediaUrl && !mediaPath)) {
        return [];
      }
      const requestedProvider = text(entry.provider).toLowerCase();
      const provider = new Set(["gemini", "chatgpt", "auto"]).has(requestedProvider)
        ? requestedProvider
        : "gemini";
      return [{
        contentId,
        provider,
        mediaUrl: mediaUrl || mediaPath,
        mediaPath,
        mimeType: text(media.mimeType),
        fileName: text(media.fileName),
        query: text(entry.query) || text(content.caption),
      }];
    });
    if (jobs.length === 0) {
      return NextResponse.json({ message: "Nenhuma mídia válida foi selecionada." }, { status: 400 });
    }

    const endpoint = new URL("/api/bot-status/enrich", request.nextUrl.origin);
    const cookie = request.headers.get("cookie") || "";
    const authorization = request.headers.get("authorization") || "";
    const internalUser = request.headers.get("x-botadmin-user-id") || "";
    after(async () => {
      let nextIndex = 0;
      const worker = async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= jobs.length) return;
          const job = jobs[index];
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json",
                ...(cookie ? { cookie } : {}),
                ...(authorization ? { authorization } : {}),
                ...(internalUser ? { "x-botadmin-user-id": internalUser } : {}),
              },
              body: JSON.stringify({
                mode: "ai",
                campaignId,
                ...job,
              }),
              signal: AbortSignal.timeout(180_000),
            });
            if (!response.ok) {
              const payload = await response.text().catch(() => "");
              console.warn("[bot-status] background analysis enqueue failed", {
                campaignId,
                contentId: job.contentId,
                status: response.status,
                payload: payload.slice(0, 500),
              });
            }
          } catch (error) {
            console.warn("[bot-status] background analysis request failed", {
              campaignId,
              contentId: job.contentId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, worker));
    });

    return NextResponse.json(
      { status: "queued", campaignId, count: jobs.length },
      { status: 202 },
    );
  } catch (error) {
    console.error("[bot-status] failed to queue background analyses", error);
    return NextResponse.json(
      {
        message: error instanceof Error
          ? error.message
          : "Não foi possível iniciar as análises em segundo plano.",
      },
      { status: 500 },
    );
  }
}
