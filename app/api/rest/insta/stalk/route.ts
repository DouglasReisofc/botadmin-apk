import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { withUserApiAuth } from "lib/api-rest-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const INTEGRATION_API_PATH = path.join(
  process.cwd(),
  "lib",
  "integrations",
  "apis",
  "funcoes",
  "api.js",
);

const loadIntegrationApi = () => {
  try {
    const req = eval("require") as NodeRequire;
    return req(INTEGRATION_API_PATH);
  } catch (error) {
    console.error("[rest/insta/stalk] falha ao carregar integração", error);
    return null as any;
  }
};

export const GET = withUserApiAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const user = (searchParams.get('user') || searchParams.get('username') || '').trim();
    if (!user) return NextResponse.json({ message: 'Informe user' }, { status: 400 });
    const integrationApi = loadIntegrationApi();
    if (!integrationApi?.instaStalk) {
      return NextResponse.json({ message: "instaStalk indisponível" }, { status: 503 });
    }
    const refreshFlag = searchParams.get("refresh");
    const forceRefresh =
      refreshFlag === "1" ||
      refreshFlag?.toLowerCase() === "true" ||
      refreshFlag?.toLowerCase() === "force";
    const data = await integrationApi.instaStalk(user, { forceRefresh });
    return NextResponse.json({ status: true, ok: true, resultado: data, data });
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || 'Erro' }, { status: 500 });
  }
});
