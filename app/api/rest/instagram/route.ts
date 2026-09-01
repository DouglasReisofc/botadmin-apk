import path from "path";
import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";

type InstagramMetadata = {
  caption?: string | null;
  description?: string | null;
  title?: string | null;
  username?: string | null;
  author?: string | null;
  thumbnail?: string | null;
  downloads?: any;
  isVideo?: boolean | null;
  [key: string]: any;
};

type InstagramOembedResponse = {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  html?: string;
  width?: number;
  height?: number;
  media_id?: string;
  provider_name?: string;
  provider_url?: string;
};

type InstagramExtractor = ((url: string) => Promise<any>) | null;

const igdl: InstagramExtractor = (() => {
  try {
    const req = eval("require") as NodeRequire;
    const target = path.join(process.cwd(), "lib/integrations/apis/funcoes/instagram2.js");
    const mod = req(target);
    if (typeof mod === "function") {
      return mod;
    }
    if (mod && typeof mod === "object" && typeof mod.default === "function") {
      return mod.default;
    }
    console.error("[rest/instagram] módulo carregado não exporta função");
    return null;
  } catch (error) {
    console.error("[rest/instagram] falha ao carregar extrator", error);
    return null;
  }
})();

export const runtime = 'nodejs';
export const maxDuration = 300;

const IG_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const normalizeText = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
};

const cookieContains = (cookieString: string, key: string): boolean =>
  new RegExp(`(?:^|;\\s*)${key}=`, "i").test(cookieString);

const getInstagramCookieHeader = (): string | null => {
  const explicit = process.env.INSTAGRAM_AUTH_COOKIES?.trim() || "";
  const cookies: string[] = [];
  if (explicit) {
    const cleaned = explicit.replace(/^cookie:\s*/i, "").trim();
    if (cleaned) {
      cookies.push(cleaned.replace(/\s*;\s*$/, ""));
    }
  }
  const merged = cookies.join("; ");
  const hasSession = merged ? cookieContains(merged, "sessionid") : false;
  const hasCsrf = merged ? cookieContains(merged, "csrftoken") : false;
  const session = process.env.INSTAGRAM_SESSIONID?.trim();
  if (session && !hasSession) {
    cookies.push(`sessionid=${session}`);
  }
  const csrf = process.env.INSTAGRAM_CSRF_TOKEN?.trim();
  if (csrf && !hasCsrf) {
    cookies.push(`csrftoken=${csrf}`);
  }
  if (!cookies.length) {
    return null;
  }
  return cookies.join("; ");
};

const fetchOembedMetadata = async (url: string, cookieHeader?: string | null): Promise<InstagramOembedResponse | null> => {
  try {
    const endpoint = new URL("https://www.instagram.com/oembed/");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("omitscript", "true");
    endpoint.searchParams.set("hidecaption", "false");
    const headers: Record<string, string> = {
      "User-Agent": IG_USER_AGENT,
      Accept: "application/json",
    };
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    const resp = await fetch(endpoint.toString(), {
      headers,
      cache: "no-store",
      redirect: "follow",
    });
    if (!resp.ok) {
      return null;
    }
    const contentType = resp.headers.get("content-type") || "";
    if (!/application\/json/i.test(contentType)) {
      return null;
    }
    const data = (await resp.json()) as InstagramOembedResponse;
    return data || null;
  } catch {
    return null;
  }
};

const extractInstagramShortcode = (targetUrl: string): string | null => {
  const match = targetUrl.match(
    /(?:https?:\/\/)?(?:(?:www|m)\.)?instagram\.com\/(?:p|tv|stories|reel)\/([^/?#&]+).*/i,
  );
  return match?.[1] ?? null;
};

const resolveMediaNodeFromPayload = (payload: any): any => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (payload.graphql?.shortcode_media) {
    return payload.graphql.shortcode_media;
  }
  if (payload.data?.shortcode_media) {
    return payload.data.shortcode_media;
  }
  if (payload.data?.xdt_shortcode_media) {
    return payload.data.xdt_shortcode_media;
  }
  if (payload.items && Array.isArray(payload.items) && payload.items.length > 0) {
    const item = payload.items[0];
    if (item?.media) {
      return item.media;
    }
    return item;
  }
  return null;
};

const extractMediaMetadata = (media: any): InstagramMetadata => {
  if (!media || typeof media !== "object") {
    return {};
  }
  const caption =
    media?.edge_media_to_caption?.edges?.[0]?.node?.text ||
    media?.caption?.text ||
    media?.title ||
    media?.accessibility_caption ||
    null;
  const username =
    media?.owner?.username ||
    media?.user?.username ||
    media?.author?.username ||
    media?.creator?.username ||
    null;
  const title =
    media?.title ||
    media?.accessibility_caption ||
    media?.edge_media_to_caption?.edges?.[0]?.node?.text ||
    null;
  const description =
    media?.caption?.text ||
    media?.edge_media_to_caption?.edges?.[0]?.node?.text ||
    media?.title ||
    null;
  const thumbnail =
    media?.thumbnail_url ||
    media?.thumbnail_src ||
    media?.display_url ||
    media?.image_versions2?.candidates?.[0]?.url ||
    media?.image_versions2?.additional_candidates?.[0]?.url ||
    null;
  const isVideo =
    typeof media?.is_video === "boolean"
      ? media.is_video
      : media?.media_type === 2 || media?.__typename === "GraphVideo";

  return {
    caption: normalizeText(caption),
    username: normalizeText(username),
    author: normalizeText(username),
    title: normalizeText(title),
    description: normalizeText(description),
    thumbnail: thumbnail || null,
    isVideo: typeof isVideo === "boolean" ? isVideo : null,
  };
};

const fetchRichMetadataWithCookies = async (
  url: string,
  cookieHeader?: string | null,
): Promise<InstagramMetadata | null> => {
  if (!cookieHeader) {
    return null;
  }
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) {
    return null;
  }
  const endpoints = [
    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    `https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`,
    `https://www.instagram.com/tv/${shortcode}/?__a=1&__d=dis`,
  ];
  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        headers: {
          "User-Agent": IG_USER_AGENT,
          Accept: "application/json",
          Cookie: cookieHeader,
        },
        cache: "no-store",
        redirect: "follow",
      });
      if (!resp.ok) {
        continue;
      }
      const contentType = resp.headers.get("content-type") || "";
      if (!/application\/json/i.test(contentType)) {
        continue;
      }
      const payload = await resp.json().catch(() => null);
      const media = resolveMediaNodeFromPayload(payload);
      if (media) {
        return extractMediaMetadata(media);
      }
    } catch {
      /* ignore individual fetch failures */
    }
  }
  return null;
};

type YtDlpInstagramRecord = {
  id?: string;
  title?: string;
  description?: string;
  uploader?: string;
  uploader_id?: string;
  thumbnail?: string;
  webpage_url?: string;
  duration?: number | null;
  ext?: string;
  vcodec?: string | null;
  entries?: YtDlpInstagramRecord[] | null;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isAbsoluteHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value.trim());

/**
 * Instagram occasionally returns a transient 5xx/"Try again later" from the
 * HTML resolvers.  The server already ships with yt-dlp for the other media
 * providers, so use it as a last-mile resolver instead of failing the group
 * event.  We ask for metadata and the selected media URL in one invocation;
 * no media is downloaded to the API process and the URL is consumed
 * immediately by the autodownloader.
 */
const resolveInstagramWithYtDlp = async (targetUrl: string): Promise<{
  urls: string[];
  metadata: InstagramMetadata;
} | null> => {
  const binary =
    process.env.INSTAGRAM_YTDLP_BINARY?.trim() ||
    process.env.YT_DLP_BINARY?.trim() ||
    "/opt/botadmin/yt-venv/bin/yt-dlp";
  const args = [
    "--dump-single-json",
    "--get-url",
    "--format",
    "bestvideo[ext=mp4]/best[ext=mp4]/best",
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "15",
    "--retries",
    "2",
    targetUrl,
  ];
  const proxy = process.env.INSTAGRAM_YTDLP_PROXY?.trim();
  if (proxy) {
    args.splice(args.length - 1, 0, "--proxy", proxy);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: { urls: string[]; metadata: InstagramMetadata } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(binary, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      finish(null);
    }, 90_000);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 2_000_000) stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_000) stderr += String(chunk);
    });
    child.on("error", (error) => {
      console.warn("[rest/instagram] fallback yt-dlp indisponível", {
        error: error instanceof Error ? error.message : String(error),
      });
      finish(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.warn("[rest/instagram] fallback yt-dlp falhou", {
          code,
          error: stderr.trim().slice(0, 500),
        });
        finish(null);
        return;
      }
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));
      let record: YtDlpInstagramRecord | null = null;
      if (jsonLine) {
        try {
          record = JSON.parse(jsonLine) as YtDlpInstagramRecord;
        } catch (error) {
          console.warn("[rest/instagram] fallback yt-dlp retornou JSON inválido", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const urls = lines.filter(
        (line) => isAbsoluteHttpUrl(line) && line !== record?.webpage_url,
      );
      if (!urls.length) {
        finish(null);
        return;
      }
      const firstUrl = urls[0];
      const isVideo =
        /\.mp4(?:[?#]|$)/i.test(firstUrl) ||
        record?.ext === "mp4" ||
        Boolean(record?.vcodec && record.vcodec !== "none");
      const caption = normalizeText(record?.description) || normalizeText(record?.title);
      const username = normalizeText(record?.uploader) || normalizeText(record?.uploader_id);
      const thumbnail = isAbsoluteHttpUrl(record?.thumbnail) ? record.thumbnail : null;
      finish({
        urls,
        metadata: {
          caption,
          description: caption,
          title: normalizeText(record?.title),
          username,
          author: username,
          thumbnail,
          isVideo,
          downloads: urls.map((url) => ({
            url,
            type: "download",
            mediaType: isVideo ? "video" : "image",
            format: isVideo ? "mp4" : undefined,
          })),
        },
      });
    });
  });
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    if (!igdl) {
      console.warn("[rest/instagram] extrator principal indisponível; usando fallback yt-dlp");
    }

    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!url) return NextResponse.json({ status: false, mensagem: 'Informe url' }, { status: 400 });
    if (!/^https?:\/\/(?:www\.|m\.)?instagram\.com\//i.test(url)) {
      return NextResponse.json({ status: false, mensagem: "Forneça um link válido do Instagram." }, { status: 400 });
    }

    let res: any = null;
    let list: string[] = [];
    let resolverError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        res = igdl ? await igdl(url) : null;
        list = Array.isArray(res?.url)
          ? res.url.filter((entry: any) => typeof entry === "string" && /^https?:\/\//i.test(entry.trim()))
          : [];
        if (list.length) break;
        resolverError = typeof res?.msg === "string" ? res.msg : null;
      } catch (error) {
        resolverError = error;
      }
      if (attempt === 0) {
        await sleep(400 + Math.floor(Math.random() * 400));
      }
    }

    // Fallback local: evita que uma falha transitória do SnapSave/GraphQL
    // impeça o autodownloader de publicar no grupo.
    let fallbackMetadata: InstagramMetadata | null = null;
    if (!list.length) {
      const fallback = await resolveInstagramWithYtDlp(url);
      if (fallback) {
        list = fallback.urls;
        fallbackMetadata = fallback.metadata;
        res = { url: list, metadata: fallback.metadata, resolver: "yt-dlp" };
        console.info("[rest/instagram] Instagram resolvido pelo fallback yt-dlp", {
          url,
          urls: list.length,
        });
      }
    }
    if (!list.length) {
      return NextResponse.json(
        {
          status: false,
          mensagem:
            typeof resolverError === "string" && resolverError.trim()
              ? resolverError
              : 'Falha ao obter links de download do Instagram.',
        },
        { status: 502 },
      );
    }
    const metadata: InstagramMetadata =
      res && typeof res.metadata === "object" && res.metadata ? { ...res.metadata } : {};
    if (fallbackMetadata) {
      Object.assign(metadata, {
        ...fallbackMetadata,
        ...metadata,
      });
    }
    let caption =
      normalizeText(metadata.caption) ||
      normalizeText(metadata.description) ||
      normalizeText(metadata.title) ||
      null;
    let username = normalizeText(metadata.username) || normalizeText(metadata.author) || null;
    const isVideo =
      typeof metadata.isVideo === "boolean"
        ? metadata.isVideo
        : null;
    let title = normalizeText(metadata.title) || null;
    let description = normalizeText(metadata.description) || normalizeText(metadata.caption) || null;
    let author = normalizeText(metadata.author) || normalizeText(metadata.username) || null;
    let thumbnail = metadata.thumbnail || (metadata as any)?.thumb || null;
    const downloads = Array.isArray(metadata.downloads) ? metadata.downloads : null;
    const cookieHeader = getInstagramCookieHeader();

    let cookieMetadata: InstagramMetadata | null = null;
    if (!caption || !username || !thumbnail || !title) {
      cookieMetadata = await fetchRichMetadataWithCookies(url, cookieHeader);
      if (cookieMetadata) {
        caption = caption || cookieMetadata.caption || null;
        title = title || cookieMetadata.title || null;
        description = description || cookieMetadata.description || null;
        username = username || cookieMetadata.username || null;
        author = author || cookieMetadata.author || cookieMetadata.username || null;
        thumbnail = thumbnail || cookieMetadata.thumbnail || null;
      }
    }

    let oembed: InstagramOembedResponse | null = null;
    if (!caption || !username || !thumbnail || !title) {
      oembed = await fetchOembedMetadata(url, cookieHeader);
      if (oembed) {
        caption = caption || normalizeText(oembed.title) || null;
        title = title || normalizeText(oembed.title) || null;
        description = description || normalizeText(oembed.title) || null;
        username = username || normalizeText(oembed.author_name) || null;
        author = author || normalizeText(oembed.author_name) || null;
        thumbnail = thumbnail || oembed.thumbnail_url || null;
      }
    }

    const resultado = {
      url: list,
      urls: list,
      caption,
      username,
      isVideo,
      title,
      description,
      author,
      thumbnail,
      downloads,
      metadata,
      metadataCookies: cookieMetadata,
      oembed,
    };
    return NextResponse.json({ status: true, código: 200, resultado, raw: res });
  } catch (err: any) {
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
