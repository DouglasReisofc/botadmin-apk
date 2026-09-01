import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";
import {
  buildPinterestDownloads,
  fetchPinterestPageVideoDownloads,
  fetchPinterestPinV2,
  type PinterestDownloadEntry,
} from "lib/pinterest";

const resolveAbsoluteUrl = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, "https://www.savepin.app/");
    return url.toString();
  } catch {
    return value;
  }
};

const loadSavePinAdapter = () => {
  try {
    const target = path.join(process.cwd(), "lib/integrations/apis/funcoes/savepin.js");
    const adapter = (eval("require") as NodeRequire)(target);
    if (typeof adapter === "function") return adapter;
    if (adapter && typeof adapter.default === "function") return adapter.default;
    console.error("[rest/pinterest] módulo SavePin não exporta uma função");
    return null;
  } catch (error) {
    console.error("[rest/pinterest] falha ao carregar SavePin", error);
    return null;
  }
};

const savePinAdapter = loadSavePinAdapter();

const normalizeAdapterDownloads = (results: any[]): PinterestDownloadEntry[] =>
  results
    .map((entry) => {
      const link =
        typeof entry?.downloadLink === "string" && entry.downloadLink.trim()
          ? resolveAbsoluteUrl(entry.downloadLink.trim())
          : null;
      if (!link) {
        return null;
      }
      const descriptor = `${entry?.type || ""} ${entry?.format || ""}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const type = /video|mp4|mov|webm/.test(descriptor) || /\.(?:mp4|mov|webm)($|\?)/i.test(link)
        ? "video"
        : "image";
      return {
        type,
        format: typeof entry?.format === "string" ? entry.format : type === "video" ? "mp4" : "jpg",
        url: link,
        quality: typeof entry?.type === "string" ? entry.type : null,
      } satisfies PinterestDownloadEntry;
    })
    .filter((entry): entry is PinterestDownloadEntry => Boolean(entry));

export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get("url") || searchParams.get("q") || "").trim();
    if (!url) {
      return NextResponse.json(
        { status: false, mensagem: "Informe url" },
        { status: 400 },
      );
    }

    const versionParam = (searchParams.get("version") || searchParams.get("v") || "")
      .trim()
      .toLowerCase();
    const preferV1 = versionParam === "v1";
    const preferV2 = versionParam !== "v1";

    let payload: Record<string, unknown> | null = null;
    let versionUsed: "v1" | "v2" | "page" = preferV1 ? "v1" : "v2";
    let v2Error: unknown = null;

    if (preferV2) {
      try {
        const pinResponse = await fetchPinterestPinV2(url);
        const downloads = buildPinterestDownloads(pinResponse.pin);
        payload = {
          version: "v2",
          fetchedAt: pinResponse.fetchedAt,
          pin: pinResponse.pin,
          downloads,
        };
      } catch (error) {
        v2Error = error;
        if (versionParam === "v2") {
          throw error;
        }
      }
    }

    const v2Downloads = Array.isArray(payload?.downloads)
      ? payload.downloads as PinterestDownloadEntry[]
      : [];
    const v2HasDirectVideo = v2Downloads.some(
      (entry) => entry.type === "video" && !entry.isHls && entry.format !== "m3u8",
    );

    // A API v2 às vezes devolve somente a capa mesmo quando o HTML do pin traz
    // as variantes MP4. Extraímos primeiro o vídeo direto da página e só então
    // recorremos ao serviço legado, sempre mantendo o MP4 antes da imagem.
    if (!payload || !v2HasDirectVideo) {
      let pageDownloads: PinterestDownloadEntry[] = [];
      try {
        pageDownloads = await fetchPinterestPageVideoDownloads(url);
      } catch {
        /* SavePin remains available as the last resolver. */
      }

      if (pageDownloads.length > 0) {
        if (!payload) versionUsed = "page";
        const mergedDownloads = [...pageDownloads, ...v2Downloads].filter(
          (entry, index, entries) => entries.findIndex((candidate) => candidate.url === entry.url) === index,
        );
        payload = {
          ...(payload ?? {}),
          downloads: mergedDownloads,
          fallback: "pinterest-page",
        };
      } else if (savePinAdapter) {
        versionUsed = "v1";
        const adapterResult = await savePinAdapter(url);
        const adapterDownloads = Array.isArray(adapterResult?.results)
          ? normalizeAdapterDownloads(adapterResult.results)
          : [];
        const mergedDownloads = [...adapterDownloads, ...v2Downloads].filter(
          (entry, index, entries) => entries.findIndex((candidate) => candidate.url === entry.url) === index,
        );
        if (payload) {
          versionUsed = "v2";
          payload = {
            ...payload,
            title: typeof adapterResult?.title === "string" ? adapterResult.title : payload.title,
            downloads: mergedDownloads,
            fallback: "savepin",
          };
        } else {
          payload = {
            version: "v1",
            title: typeof adapterResult?.title === "string" ? adapterResult.title : null,
            downloads: mergedDownloads,
            raw: adapterResult || null,
          };
        }
      } else if (!payload && v2Error instanceof Error) {
        throw v2Error;
      }
    }

    return NextResponse.json({
      status: true,
      código: 200,
      resultado: {
        ...(payload || {}),
        version: versionUsed,
      },
    });
  } catch (err: any) {
    const message = err?.message || "Erro";
    return NextResponse.json({ status: false, mensagem: message }, { status: 500 });
  }
});
