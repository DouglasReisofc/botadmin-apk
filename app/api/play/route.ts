import { NextRequest } from "next/server";

import { GET as restGet } from "../rest/ytplay/mp3/route";

export const GET = (req: NextRequest) => {
  const url = new URL(req.url);
  const nome = url.searchParams.get("nome");
  if (nome && !url.searchParams.get("q") && !url.searchParams.get("query")) {
    url.searchParams.set("q", nome);
  }
  const adapted = new NextRequest(url.toString(), {
    headers: req.headers,
    method: req.method,
  });
  return restGet(adapted);
};
