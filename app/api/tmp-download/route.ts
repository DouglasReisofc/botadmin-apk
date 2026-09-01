import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import mime from "mime-types";

import {
  getTempDownloadFilePath,
  verifyTempDownloadSignature,
} from "lib/temp-downloads";

export const runtime = "nodejs";

const isValidFilename = (value: string): boolean =>
  value.length > 0 && !value.includes("/") && !value.includes("\\") && !value.includes("..");

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const filename = (searchParams.get("file") ?? "").trim();
  const signature = (searchParams.get("sig") ?? "").trim();

  if (!isValidFilename(filename) || !verifyTempDownloadSignature(filename, signature)) {
    return NextResponse.json({ message: "Link inválido ou expirado." }, { status: 400 });
  }

  const filePath = getTempDownloadFilePath(filename);

  let stats: fs.Stats;
  try {
    stats = await fsp.stat(filePath);
  } catch {
    return NextResponse.json({ message: "Arquivo já foi removido." }, { status: 404 });
  }

  const nodeStream = fs.createReadStream(filePath);

  const cleanup = () => {
    fsp.unlink(filePath).catch(() => undefined);
  };

  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);

  const readable = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  const mimeType = mime.lookup(filename) || "application/octet-stream";

  return new NextResponse(readable, {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": stats.size.toString(),
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
};
