import { NextRequest, NextResponse } from "next/server";

import { MegaCredentialsError } from "lib/admin-mega-credentials";
import { downloadMegaFileToPublic } from "lib/mega-downloader";
import { buildTempDownloadUrl } from "lib/temp-downloads";
import { withUserApiAuth } from "lib/api-rest-auth";

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get("url") ?? "").trim();
    if (!url) {
      return NextResponse.json({ message: "Informe o link do Mega." }, { status: 400 });
    }

    const result = await downloadMegaFileToPublic(url);
    const downloadUrl = buildTempDownloadUrl(result.filename);

    return NextResponse.json({
      ok: true,
      info: {
        filename: result.filename,
        size: result.size,
        mimeType: result.mimeType,
        downloadUrl,
      },
    });
  } catch (error) {
    if (error instanceof MegaCredentialsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Failed to process Mega download", error);
    const message =
      error instanceof Error && error.message ? error.message : "Erro ao baixar arquivo do Mega.";
    return NextResponse.json({ message }, { status: 500 });
  }
});
