import path from "node:path";
import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";

// Usa o mesmo scraper de instagram2 (fallback SnapSave suporta Facebook)
const fbdown = (() => {
  try {
    const target = path.join(process.cwd(), "lib/integrations/apis/funcoes/instagram2.js");
    return (eval("require") as NodeRequire)(target);
  } catch {
    return null as any;
  }
})();

export const runtime = 'nodejs';
export const maxDuration = 300;

type FacebookExtractorResponse = {
  url?: unknown;
  metadata?: unknown;
  msg?: unknown;
  [key: string]: unknown;
};

const toUrlList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return [...unique];
};

const resolveBaseUrl = (req: NextRequest): string => {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  const baseSiteUrl = process.env.BASE_SITE_URL?.trim();
  if (baseSiteUrl) return baseSiteUrl.replace(/\/$/, "");
  try {
    return req.nextUrl.origin.replace(/\/$/, "");
  } catch {
    return "http://localhost:4478";
  }
};

const runPython = (
  scriptPath: string,
  args: string[],
  cwd: string,
  timeoutMs = 20000,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, ...args], { cwd });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`timeout ao executar ${path.basename(scriptPath)}`));
    }, timeoutMs);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(err.trim() || `python exited ${code}`));
        return;
      }
      const text = out.trim();
      if (!text) {
        reject(new Error("python did not return output"));
        return;
      }
      resolve(text);
    });
  });

const compactErrorMessage = (message: string): string => {
  const normalized = message.replace(/\r/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Erro ao limpar arquivo/i.test(line));
  const first = lines[0] || "fallback indisponível";
  if (first.length <= 220) return first;
  return `${first.slice(0, 217)}...`;
};

const tryPythonFallback = async (targetUrl: string, req: NextRequest) => {
  const baseDir = path.join(process.cwd(), "lib", "python");
  const downloaderScript = path.join(baseDir, "video_downloader.py");
  const infoScript = path.join(baseDir, "video_info.py");

  const id = await runPython(downloaderScript, [targetUrl, resolveBaseUrl(req)], baseDir);
  const infoRaw = await runPython(infoScript, [id], baseDir);
  const info = JSON.parse(infoRaw) as { video_info?: Record<string, unknown> };
  const videoInfo = info?.video_info ?? {};
  const fallbackUrl =
    typeof videoInfo.video_url === "string" ? videoInfo.video_url.trim() : "";
  if (!fallbackUrl) {
    throw new Error("fallback não retornou URL de vídeo");
  }
  const metadata = {
    url: targetUrl,
    title: typeof videoInfo.titulo === "string" ? videoInfo.titulo : null,
    description: typeof videoInfo.descricao === "string" ? videoInfo.descricao : null,
    caption: typeof videoInfo.descricao === "string" ? videoInfo.descricao : null,
    author: typeof videoInfo.uploader === "string" ? videoInfo.uploader : null,
    thumbnail: typeof videoInfo.thumbnail === "string" ? videoInfo.thumbnail : null,
    source: "python-fallback",
  };
  return {
    urls: [fallbackUrl],
    metadata,
    raw: info,
  };
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get('url') || searchParams.get('q') || '').trim();
    if (!url) return NextResponse.json({ status: false, mensagem: 'Informe url' }, { status: 400 });

    if (!fbdown) {
      return NextResponse.json(
        { status: false, mensagem: "Extrator de Facebook indisponível no momento." },
        { status: 500 },
      );
    }

    const res = (await fbdown(url)) as FacebookExtractorResponse;
    const metadata = res?.metadata && typeof res.metadata === "object" ? res.metadata : null;
    const list = toUrlList(res?.url);
    const metadataUrls =
      Array.isArray(metadata?.downloads)
        ? metadata.downloads
            .filter((entry: any) => entry && entry.url && !entry.requiresRender)
            .map((entry: any) => entry.url)
            .filter((entry: any) => typeof entry === "string" && entry.trim())
        : [];
    const urls = list.length ? list : toUrlList(metadataUrls);
    if (urls.length) {
      const resultado = { urls, metadata };
      return NextResponse.json({ status: true, código: 200, resultado, raw: res });
    }

    try {
      const fallback = await tryPythonFallback(url, req);
      const resultado = { urls: fallback.urls, metadata: fallback.metadata };
      return NextResponse.json({
        status: true,
        código: 200,
        resultado,
        raw: res,
        fallback: fallback.raw,
      });
    } catch (fallbackError: any) {
      const upstreamMessage =
        typeof res?.msg === "string" && res.msg.trim()
          ? res.msg.trim()
          : "Não foi possível baixar este link do Facebook.";
      const fallbackMessageRaw =
        typeof fallbackError?.message === "string" ? fallbackError.message : "fallback indisponível";
      const fallbackMessage = compactErrorMessage(fallbackMessageRaw);
      return NextResponse.json(
        {
          status: false,
          mensagem: `${upstreamMessage} (fallback: ${fallbackMessage})`,
          raw: res,
        },
        { status: 502 },
      );
    }
  } catch (err: any) {
    return NextResponse.json({ status: false, mensagem: err?.message || 'Erro' }, { status: 500 });
  }
});
