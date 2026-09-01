import fs from "node:fs/promises";
import path from "node:path";

type PlaywrightModule = typeof import("playwright");
type BrowserContext = import("playwright").BrowserContext;
type Page = import("playwright").Page;
type Response = import("playwright").Response;

export type BrowserResolvedVideo = {
  provider: "douyin" | "kwai" | "browser";
  id: string | null;
  title: string;
  author: string;
  url: string;
  durationSeconds: number;
  thumbnail: string;
  source: string;
  pageUrl: string;
  format: "video/mp4";
  resolver: "douyin-aweme" | "browser-media-sniffer";
};

type MediaCandidate = {
  url: string;
  mimeType: string;
  contentLength: number;
  resourceType: string;
  source: string;
  score: number;
};

type DouyinParamSet = Array<[string, string]>;

const USER_AGENT =
  process.env.BROWSER_MEDIA_USER_AGENT?.trim() ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const MEDIA_URL_PATTERN = /\.(mp4|m4v|mov|webm)(?:$|[?#&])/i;
const HLS_URL_PATTERN = /\.(m3u8)(?:$|[?#&])/i;
const EXCLUDED_DOUYIN_SIGNED_PARAMS = new Set([
  "a_bogus",
  "fp",
  "verifyFp",
  "msToken",
]);

const globalForBrowserResolver = globalThis as typeof globalThis & {
  __botadminBrowserMediaQueue?: Promise<void>;
};

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const absolutizeUrl = (value: string): string => {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  return value;
};

const normalizeInputUrl = (input: string): string =>
  input.trim().replace(/[)\].,'"»”’››>—–…•·]+$/gu, "");

const withBrowserResolverLock = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  const previous =
    globalForBrowserResolver.__botadminBrowserMediaQueue ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalForBrowserResolver.__botadminBrowserMediaQueue = previous
    .catch(() => {})
    .then(() => current);

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
};

const findChromeExecutable = async (): Promise<string | undefined> => {
  const candidates = [
    process.env.BROWSER_MEDIA_CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      await fs.access(value);
      return value;
    } catch {
      /* try next */
    }
  }
  return undefined;
};

const loadPlaywright = async (): Promise<PlaywrightModule> => {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      `Playwright indisponível para resolver mídia no navegador: ${(error as Error).message}`,
    );
  }
};

const providerFromUrl = (url: string): BrowserResolvedVideo["provider"] => {
  if (/kwai|kuaishou/i.test(url)) return "kwai";
  if (/douyin|iesdouyin|ixigua/i.test(url)) return "douyin";
  return "browser";
};

const parseContentLength = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const isLikelyVideoResponse = (response: Response): boolean => {
  const url = response.url();
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(?:png|jpe?g|webp|gif|avif|svg|css|js|woff2?)(?:$|[?#&])/i.test(url))
    return false;

  const headers = response.headers();
  const mimeType = (headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const resourceType = response.request().resourceType();

  if (mimeType.startsWith("video/")) return true;
  if (resourceType === "media" && !mimeType.startsWith("audio/")) return true;
  if (MEDIA_URL_PATTERN.test(url)) return true;
  return false;
};

const scoreCandidate = (candidate: Omit<MediaCandidate, "score">): number => {
  let score = 0;
  const url = candidate.url.toLowerCase();
  const mimeType = candidate.mimeType.toLowerCase();

  if (mimeType === "video/mp4") score += 1200;
  else if (mimeType.startsWith("video/")) score += 900;
  if (MEDIA_URL_PATTERN.test(url)) score += 700;
  if (HLS_URL_PATTERN.test(url)) score -= 500;
  if (/douyinvod|ixigua|byteimg|kuaishou|kwai/i.test(url)) score += 160;
  if (candidate.contentLength > 0)
    score += Math.min(
      400,
      Math.floor(candidate.contentLength / (1024 * 1024)) * 12,
    );
  if (candidate.resourceType === "media") score += 80;

  return score;
};

const collectMediaCandidate = (
  response: Response,
  candidates: MediaCandidate[],
) => {
  if (!isLikelyVideoResponse(response)) return;
  const headers = response.headers();
  const mimeType = (headers["content-type"] || "video/mp4")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const contentLength = parseContentLength(headers["content-length"]);
  const source = response.request().frame()?.url() || "";
  const base = {
    url: response.url(),
    mimeType,
    contentLength,
    resourceType: response.request().resourceType(),
    source,
  };
  if (candidates.some((entry) => entry.url === base.url)) return;
  candidates.push({ ...base, score: scoreCandidate(base) });
};

const extractIdFromUrl = (url: string): string | null => {
  const patterns = [
    /\/video\/(\d{8,})/i,
    /\/xg\/video\/(\d{8,})/i,
    /(?:aweme_id|modal_id|group_id|item_id|video_id)=(\d{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const extractIdFromPage = async (
  page: Page,
  originalUrl: string,
): Promise<string | null> => {
  const fromUrl = extractIdFromUrl(page.url()) || extractIdFromUrl(originalUrl);
  if (fromUrl) return fromUrl;

  try {
    return await page.evaluate(() => {
      const dataNode = document.querySelector("[data-e2e-vid]");
      const dataId = dataNode?.getAttribute("data-e2e-vid");
      if (dataId && /^\d{8,}$/.test(dataId)) return dataId;

      const anchors = Array.from(
        document.querySelectorAll("a[href], div[href]"),
      );
      for (const node of anchors) {
        const href = node.getAttribute("href") || "";
        const match = href.match(/(?:\/video\/|\/xg\/video\/)(\d{8,})/i);
        if (match?.[1]) return match[1];
      }
      return null;
    });
  } catch {
    return null;
  }
};

const maybeCaptureDouyinParams = (
  url: string,
  setParams: (params: DouyinParamSet) => void,
) => {
  try {
    const parsed = new URL(url);
    if (
      !/douyin\.com$/i.test(parsed.hostname) &&
      !/\.douyin\.com$/i.test(parsed.hostname)
    )
      return;
    if (!parsed.pathname.includes("/aweme/v1/web/")) return;
    const entries = Array.from(parsed.searchParams.entries());
    if (entries.length < 20) return;
    setParams(entries);
  } catch {
    /* ignore */
  }
};

const buildDouyinAwemeDetailUrl = (
  awemeId: string,
  params: DouyinParamSet,
  stripSignedParams: boolean,
): string => {
  const detailUrl = new URL(
    "https://www.douyin.com/aweme/v1/web/aweme/detail/",
  );
  let hasAwemeId = false;
  for (const [key, value] of params) {
    if (stripSignedParams && EXCLUDED_DOUYIN_SIGNED_PARAMS.has(key)) continue;
    if (key === "aweme_id") {
      detailUrl.searchParams.append("aweme_id", awemeId);
      hasAwemeId = true;
    } else {
      detailUrl.searchParams.append(key, value);
    }
  }
  if (!hasAwemeId) {
    detailUrl.searchParams.append("aweme_id", awemeId);
  }
  return detailUrl.toString();
};

const fetchJsonInsidePage = async (
  page: Page,
  url: string,
): Promise<any | null> => {
  try {
    const body = await page.evaluate(async (requestUrl) => {
      const response = await fetch(requestUrl, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
      });
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }
      return response.text();
    }, url);
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const buildResultFromAwemeDetail = (
  detail: Record<string, any>,
  source: string,
  pageUrl: string,
): BrowserResolvedVideo | null => {
  const bitRates: Array<Record<string, any>> = Array.isArray(
    detail?.video?.bit_rate,
  )
    ? detail.video.bit_rate
    : [];
  const entries = bitRates
    .filter((entry) => cleanText(entry?.format).toLowerCase() === "mp4")
    .map((entry) => {
      const playAddr = entry?.play_addr || {};
      const urls = Array.isArray(playAddr?.url_list)
        ? playAddr.url_list.map(cleanText).filter(Boolean)
        : [];
      const width = Number(playAddr?.width || 0) || 0;
      const height = Number(playAddr?.height || 0) || 0;
      return {
        url: absolutizeUrl(urls.sort((a, b) => a.length - b.length)[0] || ""),
        bitRate: Number(entry?.bit_rate || 0) || 0,
        size: Number(playAddr?.data_size || 0) || 0,
        resolution: Math.max(width, height),
      };
    })
    .filter((entry) => /^https?:\/\//i.test(entry.url));

  entries.sort((a, b) => {
    if (b.resolution !== a.resolution) return b.resolution - a.resolution;
    if (b.bitRate !== a.bitRate) return b.bitRate - a.bitRate;
    return b.size - a.size;
  });

  const selected = entries[0];
  if (!selected) return null;

  return {
    provider: "douyin",
    id: cleanText(detail?.aweme_id) || null,
    title: cleanText(detail?.desc),
    author: cleanText(detail?.author?.nickname || detail?.author?.unique_id),
    url: selected.url,
    durationSeconds: Math.round(
      (Number(detail?.duration || detail?.video?.duration || 0) || 0) / 1000,
    ),
    thumbnail: absolutizeUrl(
      cleanText(
        detail?.video?.cover?.url_list?.[0] ||
          detail?.video?.origin_cover?.url_list?.[0],
      ),
    ),
    source,
    pageUrl,
    format: "video/mp4",
    resolver: "douyin-aweme",
  };
};

const resolveDouyinAwemeFromBrowser = async (
  page: Page,
  source: string,
  latestParams: DouyinParamSet | null,
): Promise<BrowserResolvedVideo | null> => {
  const awemeId = await extractIdFromPage(page, source);
  if (!awemeId || !latestParams?.length) return null;

  for (const stripSignedParams of [false, true]) {
    const detailUrl = buildDouyinAwemeDetailUrl(
      awemeId,
      latestParams,
      stripSignedParams,
    );
    const payload = await fetchJsonInsidePage(page, detailUrl);
    const detail = payload?.aweme_detail;
    if (detail) {
      const result = buildResultFromAwemeDetail(detail, source, page.url());
      if (result) return result;
    }
  }
  return null;
};

const extractPageMetadata = async (
  page: Page,
): Promise<{ title: string; author: string; thumbnail: string }> => {
  try {
    return await page.evaluate(() => {
      const meta = (name: string) =>
        document
          .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
          ?.getAttribute("content")
          ?.trim() || "";
      return {
        title: meta("og:title") || document.title || "",
        author: meta("author"),
        thumbnail: meta("og:image"),
      };
    });
  } catch {
    return { title: "", author: "", thumbnail: "" };
  }
};

const warmUpMediaPlayback = async (page: Page) => {
  for (let i = 0; i < 3; i += 1) {
    await page
      .evaluate(() => {
        window.scrollBy(0, Math.floor(window.innerHeight * 0.55));
        for (const video of Array.from(document.querySelectorAll("video"))) {
          video.muted = true;
          video.playsInline = true;
          video.play().catch(() => {});
        }
      })
      .catch(() => {});
    await page.waitForTimeout(2200).catch(() => {});
  }
};

const pickBestMediaCandidate = (
  candidates: MediaCandidate[],
): MediaCandidate | null => {
  const usable = candidates
    .filter((candidate) => /^https?:\/\//i.test(candidate.url))
    .filter((candidate) => !HLS_URL_PATTERN.test(candidate.url))
    .sort((a, b) => b.score - a.score);
  return usable[0] ?? null;
};

const createContext = async (): Promise<BrowserContext> => {
  const { chromium } = await loadPlaywright();
  const executablePath = await findChromeExecutable();
  const baseOptions = {
    executablePath,
    headless: process.env.BROWSER_MEDIA_HEADLESS !== "0",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  };
  const contextOptions = {
    viewport: { width: 1366, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent: USER_AGENT,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,pt-BR;q=0.7",
    },
  };

  const explicitProfileDir = process.env.BROWSER_MEDIA_PROFILE_DIR?.trim();
  const primaryProfileDir = explicitProfileDir
    ? path.resolve(explicitProfileDir)
    : path.join(process.cwd(), "storage", "browser-media-profile");
  const fallbackProfileDir = path.join(
    process.cwd(),
    "storage",
    `browser-media-profile-${process.pid}`,
  );

  const launchPersistent = async (userDataDir: string) => {
    await fs.mkdir(userDataDir, { recursive: true });
    return chromium.launchPersistentContext(userDataDir, {
      ...baseOptions,
      ...contextOptions,
    });
  };

  try {
    return await launchPersistent(primaryProfileDir);
  } catch (error) {
    const message = (error as Error).message || "";
    if (
      explicitProfileDir ||
      !/ProcessSingleton|profile directory|already in use/i.test(message)
    ) {
      throw error;
    }
    console.warn(
      "[browser-media-resolver] perfil Chrome ocupado; usando perfil por processo",
      {
        primaryProfileDir,
        fallbackProfileDir,
      },
    );
    return launchPersistent(fallbackProfileDir);
  }
};

const closeContext = async (context: BrowserContext) => {
  const browser = context.browser();
  await context.close().catch(() => {});
  await browser?.close().catch(() => {});
};

const assertResolvedMediaUrl = async (url: string): Promise<void> => {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "video/*,*/*;q=0.8" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();
    if (contentType.startsWith("video/")) {
      return;
    }

    // Kwai's CDN commonly serves valid MP4 files as application/octet-stream.
    // Verify the file signature instead of rejecting a playable video because
    // the origin supplied a generic MIME type.
    if (contentType.includes("application/octet-stream") || !contentType) {
      const probe = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": USER_AGENT,
          accept: "video/*,*/*;q=0.8",
          range: "bytes=0-63",
        },
      });
      if (!probe.ok && probe.status !== 206) {
        throw new Error(`HTTP ${probe.status} ao verificar conteúdo`);
      }
      const reader = probe.body?.getReader();
      const firstChunk = reader ? await reader.read() : null;
      await reader?.cancel().catch(() => {});
      const bytes = firstChunk?.value ?? new Uint8Array();
      const ascii = Buffer.from(bytes.subarray(0, 64)).toString("latin1");
      const isIsoBaseMedia = bytes.length >= 12 && ascii.slice(4, 8) === "ftyp";
      const isWebm =
        bytes.length >= 4 &&
        bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3;
      if (isIsoBaseMedia || isWebm) {
        return;
      }
    }
    throw new Error(`content-type ${contentType || "desconhecido"}`);
  } catch (error) {
    throw new Error(
      `URL de mídia capturada não validou como vídeo: ${(error as Error).message}`,
    );
  }
};

const finalizeBrowserResult = async (
  result: BrowserResolvedVideo,
): Promise<BrowserResolvedVideo> => {
  await assertResolvedMediaUrl(result.url);
  return result;
};

const waitForMediaCandidate = async (
  page: Page,
  candidates: MediaCandidate[],
): Promise<MediaCandidate | null> => {
  for (let i = 0; i < 6; i += 1) {
    const best = pickBestMediaCandidate(candidates);
    if (best) return best;
    await page.waitForTimeout(1200).catch(() => {});
  }
  return null;
};

const clickLikelyPlaybackTargets = async (page: Page) => {
  await page
    .evaluate(() => {
      const selectors = [
        "video",
        "[class*='play']",
        "[class*='Player']",
        "[class*='poster']",
        "[data-e2e*='video']",
      ];
      for (const selector of selectors) {
        const element = document.querySelector(selector) as HTMLElement | null;
        if (element) {
          element.click();
          break;
        }
      }
    })
    .catch(() => {});
};

const resolveBySniffing = async (
  page: Page,
  source: string,
  candidates: MediaCandidate[],
): Promise<BrowserResolvedVideo> => {
  await warmUpMediaPlayback(page);
  let best = await waitForMediaCandidate(page, candidates);
  if (!best) {
    await clickLikelyPlaybackTargets(page);
    await warmUpMediaPlayback(page);
    best = await waitForMediaCandidate(page, candidates);
  }
  if (!best) {
    throw new Error("Navegador não encontrou resposta de vídeo reproduzível.");
  }

  const metadata = await extractPageMetadata(page);
  return finalizeBrowserResult({
    provider: providerFromUrl(source),
    id: extractIdFromUrl(page.url()) || extractIdFromUrl(source),
    title: metadata.title,
    author: metadata.author,
    url: best.url,
    durationSeconds: 0,
    thumbnail: absolutizeUrl(metadata.thumbnail),
    source,
    pageUrl: page.url(),
    format: "video/mp4",
    resolver: "browser-media-sniffer",
  });
};

export const resolveVideoWithBrowser = async (
  input: string,
): Promise<BrowserResolvedVideo> => {
  const source = normalizeInputUrl(input);
  if (!/^https?:\/\//i.test(source)) {
    throw new Error("Forneça uma URL válida para o resolvedor de navegador.");
  }
  if (process.env.BROWSER_MEDIA_RESOLVER_ENABLED === "0") {
    throw new Error("Resolvedor de navegador desativado por configuração.");
  }

  return withBrowserResolverLock(async () => {
    const candidates: MediaCandidate[] = [];
    let latestDouyinParams: DouyinParamSet | null = null;
    const context = await createContext();
    const page = await context.newPage();
    page.setDefaultTimeout(
      Number(process.env.BROWSER_MEDIA_TIMEOUT_MS || 45_000),
    );

    page.on("request", (request) => {
      maybeCaptureDouyinParams(request.url(), (params) => {
        latestDouyinParams = params;
      });
    });
    page.on("response", (response) =>
      collectMediaCandidate(response, candidates),
    );

    try {
      await page
        .goto(source, { waitUntil: "domcontentloaded", timeout: 45_000 })
        .catch((error) => {
          console.warn(
            "[browser-media-resolver] navegação inicial falhou; tentando sniffing parcial",
            {
              url: source,
              error: (error as Error).message,
            },
          );
        });
      await page
        .waitForLoadState("networkidle", { timeout: 8_000 })
        .catch(() => {});
      await page.waitForTimeout(1200).catch(() => {});

      const awemeResult = await resolveDouyinAwemeFromBrowser(
        page,
        source,
        latestDouyinParams,
      );
      if (awemeResult) return finalizeBrowserResult(awemeResult);

      return resolveBySniffing(page, source, candidates);
    } finally {
      await page.close().catch(() => {});
      await closeContext(context);
    }
  });
};
