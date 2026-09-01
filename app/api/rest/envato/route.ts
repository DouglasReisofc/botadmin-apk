import { NextRequest, NextResponse } from "next/server";

import { enqueueAutoDownJobAndWait } from "lib/autodown";
import { withUserApiAuth } from "lib/api-rest-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const isEnvatoElementsHost = (hostname: string): boolean => {
  const lowered = hostname.toLowerCase();
  return lowered === "elements.envato.com" || lowered.endsWith(".elements.envato.com");
};

const decodeContentDispositionFilename = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\+/g, " ");
  let decoded = normalized;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    /* ignore decode errors */
  }
  const starMatch = decoded.match(/filename\*=(?:UTF-8''|)([^;]+)/i);
  if (starMatch?.[1]) {
    return starMatch[1].replace(/^["']+|["']+$/g, "").trim() || null;
  }
  const plainMatch = decoded.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim() || null;
  }
  return null;
};

const deriveFilename = (downloadUrl: string): string => {
  try {
    const url = new URL(downloadUrl);
    const filenameParam = url.searchParams.get("filename");
    if (filenameParam?.trim()) {
      return decodeURIComponent(filenameParam.trim());
    }
    const filenameStar = url.searchParams.get("filename*");
    if (filenameStar?.trim()) {
      try {
        const [, encoded] = filenameStar.split("''");
        if (encoded?.trim()) {
          return decodeURIComponent(encoded.trim());
        }
      } catch {
        /* ignore parse errors */
      }
    }
    const contentDisposition = url.searchParams.get("response-content-disposition");
    if (contentDisposition?.trim()) {
      const hinted = decodeContentDispositionFilename(contentDisposition.trim());
      if (hinted) {
        return hinted;
      }
    }
    const pathname = url.pathname.split("/").filter(Boolean).pop();
    if (pathname) {
      return decodeURIComponent(pathname);
    }
  } catch {
    /* ignore */
  }
  return "envato.zip";
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const urlParam = (searchParams.get("url") || searchParams.get("q") || "").trim();
    if (!urlParam) {
      return NextResponse.json({ status: false, mensagem: "Informe a URL do Envato Elements" }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(urlParam);
    } catch {
      return NextResponse.json({ status: false, mensagem: "URL inválida" }, { status: 400 });
    }

    if (!/^https?:$/i.test(targetUrl.protocol)) {
      return NextResponse.json(
        { status: false, mensagem: "Apenas URLs HTTP/HTTPS são aceitas" },
        { status: 400 },
      );
    }

    if (!isEnvatoElementsHost(targetUrl.hostname)) {
      return NextResponse.json(
        { status: false, mensagem: "Envie um link válido do Envato Elements" },
        { status: 400 },
      );
    }

    const timeoutMs = Number.parseInt(searchParams.get("timeout_ms") || searchParams.get("timeout") || "180000", 10) || 180000;
    const remoteData = await enqueueAutoDownJobAndWait(
      targetUrl.toString(),
      {
        source: "api-rest",
        endpoint: "envato",
      },
      timeoutMs,
    );

    if (!remoteData.ok) {
      return NextResponse.json(
        {
          status: false,
          mensagem: remoteData.result.message || "A extensao retornou erro ao processar o Envato.",
        },
        { status: 502 },
      );
    }

    const downloadUrl = remoteData.result.directLink || remoteData.result.previewUrl;
    if (!downloadUrl) {
      return NextResponse.json(
        { status: false, mensagem: "Resposta sem link de download" },
        { status: 502 },
      );
    }

    const payload = {
      url: downloadUrl,
      filename:
        typeof remoteData.result.filename === "string" && remoteData.result.filename.trim()
          ? remoteData.result.filename.trim()
          : deriveFilename(downloadUrl),
      mime:
        typeof remoteData.result.mime === "string" && remoteData.result.mime.trim()
          ? remoteData.result.mime.trim()
          : undefined,
      stdout: remoteData.result.status === "success" ? remoteData.result.message || undefined : undefined,
      stderr: remoteData.result.status === "error" ? remoteData.result.message || undefined : undefined,
      source: targetUrl.toString(),
      job_id: remoteData.job.id,
      client_id: remoteData.result.clientId,
    };

    return NextResponse.json({ status: true, código: 200, resultado: payload });
  } catch (err: any) {
    const message =
      err?.name === "AbortError"
        ? "Tempo esgotado ao consultar o downloader do Envato."
        : err?.message || "Erro ao consultar o Envato.";
    return NextResponse.json({ status: false, mensagem: message }, { status: 500 });
  }
});
