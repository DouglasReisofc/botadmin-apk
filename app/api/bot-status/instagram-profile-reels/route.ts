import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { resolveInstagramProfileReels } from "lib/instagram-profile-reels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bounded = (value: string | null, fallback: number, max: number) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const profile =
      request.nextUrl.searchParams.get("username") ||
      request.nextUrl.searchParams.get("profile") ||
      request.nextUrl.searchParams.get("url") ||
      "";
    const limit = bounded(request.nextUrl.searchParams.get("limit"), 24, 1200);
    const pages = bounded(request.nextUrl.searchParams.get("pages"), Math.ceil(limit / 12), 100);
    const result = await resolveInstagramProfileReels(profile, {
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit,
      maxPages: pages,
    });
    return NextResponse.json({
      success: true,
      profile: result.username,
      count: result.count,
      pagesFetched: result.pagesFetched,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      stats: result.stats,
      candidates: result.reels.map((reel) => ({
        id: `instagram-${reel.shortcode}`,
        provider: "instagram",
        mediaType: "video",
        sourceUrl: reel.permalink,
        resolveUrl: reel.permalink,
        previewUrl: reel.videoUrl,
        downloadUrl: reel.downloadUrl,
        thumbnail: reel.thumbnail,
        caption: reel.caption,
        createdAt: reel.createdAt,
        metrics: {
          likes: reel.likeCount,
          comments: reel.commentCount,
          views: reel.viewCount,
          plays: reel.playCount,
        },
        dimensions: { width: reel.width, height: reel.height },
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível capturar os Reels.";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
