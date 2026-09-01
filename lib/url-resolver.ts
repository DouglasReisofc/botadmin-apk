const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 12;
const HTML_MAX_BYTES = 256_000;
const URL_PARAM_KEYS = [
  "url",
  "u",
  "target",
  "dest",
  "destination",
  "redirect",
  "redirect_url",
  "redirect_uri",
  "redirectTo",
  "redirect_to",
  "redir",
  "r",
  "to",
  "go",
  "link",
  "continue",
  "continue_url",
  "continueUrl",
  "next",
  "next_url",
  "nextUrl",
];

const HTML_PATTERNS = [
  /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"' >]+)["']/i,
  /window\.location(?:\.href)?\s*=\s*["']([^"'\\]+)["']/i,
  /location\.href\s*=\s*["']([^"'\\]+)["']/i,
  /location\.replace\(\s*["']([^"'\\]+)["']\s*\)/i,
  /location\.assign\(\s*["']([^"'\\]+)["']\s*\)/i,
  /"destination"\s*:\s*"([^"]+)"/i,
  /destination\\":\\"([^"]+)\\"/i,
  /<a[^>]+id=["']download_link["'][^>]+href=["']([^"']+)["']/i,
  /<a[^>]+href=["']([^"']+)["'][^>]+id=["']download_link["']/i,
];

export type UrlResolutionResult = {
  inputUrl: string;
  finalUrl: string;
  host: string;
  visited: string[];
};

const safeDecode = (value: string): string => {
  let current = value.trim();
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
};

const ensureHttpUrl = (value: string, base?: string): string | null => {
  const trimmed = safeDecode(value);
  if (!trimmed) return null;

  try {
    const resolved = base ? new URL(trimmed, base) : new URL(trimmed);
    if (!/^https?:$/i.test(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
};

const extractNestedUrl = (rawValue: string, base?: string): string | null => {
  const direct = ensureHttpUrl(rawValue, base);
  if (direct) {
    try {
      const parsed = new URL(direct);
      for (const key of URL_PARAM_KEYS) {
        const nested = parsed.searchParams.get(key);
        if (!nested) continue;
        const resolved = ensureHttpUrl(nested, direct);
        if (resolved) {
          return resolved;
        }
      }
    } catch {
      return direct;
    }
    return direct;
  }

  const match = safeDecode(rawValue).match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) {
    return null;
  }
  return ensureHttpUrl(match[0], base);
};

const extractHtmlRedirect = (html: string, currentUrl: string): string | null => {
  const slice = html.slice(0, HTML_MAX_BYTES);
  for (const pattern of HTML_PATTERNS) {
    const match = slice.match(pattern);
    if (!match?.[1]) continue;
    const resolved = extractNestedUrl(match[1], currentUrl);
    if (resolved) {
      return resolved;
    }
  }
  return null;
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
};

export const resolveUrlTarget = async (
  rawInput: string,
  options?: { maxHops?: number; timeoutMs?: number },
): Promise<UrlResolutionResult> => {
  const initial = ensureHttpUrl(rawInput);
  if (!initial) {
    throw new Error("URL inválida. Informe um link HTTP/HTTPS válido.");
  }

  const visited: string[] = [];
  const seen = new Set<string>();
  let current = initial;
  const maxHops = Math.max(1, Math.min(options?.maxHops ?? MAX_REDIRECT_HOPS, 20));
  const timeoutMs = Math.max(3_000, Math.min(options?.timeoutMs ?? 20_000, 60_000));

  for (let hop = 0; hop < maxHops; hop += 1) {
    if (!seen.has(current)) {
      seen.add(current);
      visited.push(current);
    }

    const nestedFromUrl = extractNestedUrl(current);
    if (nestedFromUrl && nestedFromUrl !== current && !seen.has(nestedFromUrl)) {
      current = nestedFromUrl;
      continue;
    }

    const response = await fetchWithTimeout(current, timeoutMs);

    if (REDIRECT_STATUS_CODES.has(response.status)) {
      const location = response.headers.get("location");
      const redirected = location ? ensureHttpUrl(location, current) : null;
      if (redirected && redirected !== current) {
        current = redirected;
        continue;
      }
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      const html = await response.text();
      const htmlRedirect = extractHtmlRedirect(html, current);
      if (htmlRedirect && htmlRedirect !== current && !seen.has(htmlRedirect)) {
        current = htmlRedirect;
        continue;
      }
    }

    break;
  }

  const finalUrl = current;
  const host = new URL(finalUrl).hostname.toLowerCase();
  return {
    inputUrl: initial,
    finalUrl,
    host,
    visited,
  };
};
