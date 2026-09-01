import { NextRequest, NextResponse } from "next/server";

import { getAutoDownStateSnapshot, pullAutoDownNativeJob } from "lib/autodown";
import { authorizeNative, readBooleanFlag } from "../_shared";

export const runtime = "nodejs";

const jsonNoStore = (body: Record<string, unknown>, init?: ResponseInit) => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
};

const positiveInt = (value: string | null): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
};

export async function GET(req: NextRequest) {
  const unauthorized = authorizeNative(req);
  if (unauthorized) {
    return unauthorized;
  }

  const params = req.nextUrl.searchParams;
  const clientId = params.get("client_id")?.trim();
  if (!clientId) {
    return jsonNoStore({ ok: false, error: "client_id obrigatorio" }, { status: 400 });
  }

  const job = pullAutoDownNativeJob({
    clientId,
    deviceId: params.get("device_id"),
    label: params.get("label"),
    manufacturer: params.get("manufacturer"),
    model: params.get("model"),
    androidVersion: params.get("android_version"),
    sdk: params.get("sdk"),
    version: params.get("version"),
    slots: positiveInt(params.get("slots")),
    monitorNetwork: readBooleanFlag(params.get("monitor_network")),
    monitorDom: readBooleanFlag(params.get("monitor_dom")),
  });
  const snapshot = getAutoDownStateSnapshot();

  return jsonNoStore({
    ok: true,
    job: job
      ? {
          id: job.id,
          url: job.url,
          site: job.site,
          metadata: job.metadata,
          created_at: job.createdAt,
        }
      : null,
    pending_jobs: snapshot.pendingJobs,
    worker: {
      client_id: clientId,
      monitor_network_enabled: false,
      monitor_dom_enabled: false,
    },
    monitor_settings: {
      monitor_network_enabled: false,
      monitor_dom_enabled: false,
    },
  });
}
