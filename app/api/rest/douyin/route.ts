import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { spawn } from "node:child_process";

import { withUserApiAuth } from "lib/api-rest-auth";
import { resolveVideoWithBrowser } from "lib/browser-media-resolver";
import { resolveDouyinVideo } from "lib/douyin-resolver";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const getBaseUrl = () => {
  if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim().replace(/\/$/, "");
  if (process.env.BASE_SITE_URL?.trim()) return process.env.BASE_SITE_URL.trim().replace(/\/$/, "");
  try {
    const cfg = (eval("require") as NodeRequire)("config/app-settings.js");
    if (cfg?.basesiteUrl) return String(cfg.basesiteUrl).replace(/\/$/, "");
  } catch {}
  return "http://localhost:4322";
};

const runLocalVideoFallback = async (url: string) => {
  const baseDir = path.join(process.cwd(), "lib", "python");
  const pyScript = path.join(baseDir, "video_downloader.py");
  const infoScript = path.join(baseDir, "video_info.py");
  const baseUrl = getBaseUrl();

  const id: string = await new Promise((resolve, reject) => {
    const child = spawn("python3", [pyScript, url, baseUrl], { cwd: baseDir });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp excedeu o tempo limite ao resolver Douyin."));
    }, 180_000);
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (err += String(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `python exited ${code}`));
      const value = out.trim();
      if (!value) return reject(new Error("yt-dlp não retornou id para Douyin."));
      resolve(value);
    });
  });

  const info: any = await new Promise((resolve, reject) => {
    const child = spawn("python3", [infoScript, id], { cwd: baseDir });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (err += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `python info exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("yt-dlp retornou info inválida para Douyin."));
      }
    });
  });

  const bundle = info?.video_info || {};
  return {
    provider: "douyin",
    id,
    title: bundle.titulo || bundle.title || "",
    author: bundle.uploader || "",
    url: bundle.video_url || `${baseUrl}/api/play/${id}`,
    durationSeconds: Number(bundle.duration || 0) || 0,
    thumbnail: bundle.thumbnail || "",
    source: bundle.url || url,
    pageUrl: bundle.url || url,
    format: "video/mp4",
  };
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get("url") || searchParams.get("q") || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ status: false, mensagem: "Forneça url válida" }, { status: 400 });
    }

    let result;
    try {
      result = await resolveDouyinVideo(url);
    } catch (primaryError: any) {
      console.warn("[api/rest/douyin] resolvedor HTML falhou; tentando navegador", {
        url,
        error: primaryError?.message,
      });
      try {
        result = await resolveVideoWithBrowser(url);
      } catch (browserError: any) {
        console.warn("[api/rest/douyin] resolvedor por navegador falhou; tentando yt-dlp local", {
          url,
          error: browserError?.message,
        });
        result = await runLocalVideoFallback(url);
      }
    }
    return NextResponse.json({
      status: true,
      código: 200,
      resultado: result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { status: false, mensagem: err?.message || "Erro ao resolver Douyin" },
      { status: 500 },
    );
  }
});
