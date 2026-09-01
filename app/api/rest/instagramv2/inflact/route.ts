import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";

const INFLACT_HELPER_PATH = path.join(
  process.cwd(),
  "helper",
  "inflact-viewer.js",
);

const inflactHelper = (() => {
  try {
    const req = eval("require") as NodeRequire;
    return req(INFLACT_HELPER_PATH);
  } catch (error) {
    console.error("[rest/instagramv2/inflact] helper load failed", error);
    return null as any;
  }
})();

export const runtime = "nodejs";
export const maxDuration = 300;

const normalizePostResult = (payload: any) => {
  const post = payload?.data?.post;
  if (!post) return null;
  const caption =
    post?.edge_media_to_caption?.edges?.[0]?.node?.text ||
    post?.caption?.text ||
    null;
  const videoUrl =
    post?.video_url ||
    payload?.data?.video_url ||
    payload?.video_url ||
    null;
  const thumbnail =
    post?.thumbnail_src || post?.display_url || payload?.data?.thumbnail || null;
  return {
    url: videoUrl,
    video_url: videoUrl,
    thumbnail,
    title:
      caption?.split(/\n/)[0]?.trim() ||
      `Instagram ${post?.shortcode || ""}`.trim(),
    caption,
    shortcode: post?.shortcode || null,
    owner: post?.owner?.username || null,
    duration: post?.video_duration ?? null,
    view_count: post?.video_view_count ?? null,
    media_type: post?.__typename || null,
    raw_post: post,
  };
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    if (!inflactHelper?.fetchInflactDownloadPost) {
      return NextResponse.json(
        { status: false, mensagem: "Downloader temporariamente indisponível." },
        { status: 503 },
      );
    }
    const { searchParams } = new URL(req.url);
    const url =
      (searchParams.get("url") ||
        searchParams.get("link") ||
        searchParams.get("q") ||
        "").trim();
    if (!url) {
      return NextResponse.json(
        { status: false, mensagem: "Informe a URL do post/reel." },
        { status: 400 },
      );
    }
    const refreshFlag = searchParams.get("refresh");
    const forceRefresh =
      refreshFlag === "1" ||
      refreshFlag?.toLowerCase() === "true" ||
      refreshFlag?.toLowerCase() === "force";
    const inflact = await inflactHelper.fetchInflactDownloadPost(url, {
      forceRefresh,
    });
    if (inflact?.status !== "success") {
      return NextResponse.json(
        {
          status: false,
          mensagem: inflact?.message || "Falha ao processar o link do Instagram.",
        },
        { status: 502 },
      );
    }
    const resultado = normalizePostResult(inflact);
    if (!resultado?.video_url) {
      return NextResponse.json(
        { status: false, mensagem: "Não foi possível obter o vídeo." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      status: true,
      código: 200,
      resultado,
      raw: inflact,
    });
  } catch (err: any) {
    return NextResponse.json(
      { status: false, mensagem: err?.message || "Erro" },
      { status: 500 },
    );
  }
});
