import { NextRequest } from "next/server";

import { GET as restGet } from "../../rest/ytmp3/route";

export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = (req: NextRequest) => {
  const url = new URL(req.url);
  const link = url.searchParams.get("link") || url.searchParams.get("url");
  if (link && !url.searchParams.get("q")) {
    url.searchParams.set("q", link);
  }
  const adapted = new NextRequest(url.toString(), {
    headers: req.headers,
    method: req.method,
  });
  return restGet(adapted);
};
