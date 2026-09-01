import { buildAttpEndpoint } from "lib/attp-endpoint";

export const runtime = "nodejs";
export const maxDuration = 120;

export const GET = buildAttpEndpoint("createAttp2", "attp2");
