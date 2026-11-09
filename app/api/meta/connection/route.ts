import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { loadMetaPlatformConfig, publicMetaPlatform, loadMetaPurpose, saveMetaPurpose, metaGraph } from "lib/meta-platform";
import { getWebhookRowForUser } from "lib/webhooks";
import { ensureMetaChannelTables, metaCoexistenceSyncStatus } from "lib/meta-channel";
import { getDb } from "lib/db";
import { getInstanceForUser } from "lib/bot-instances";
import { decryptWwPanelSecret } from "lib/wwpanel";
import { getPublicAppBaseUrl } from "lib/meta";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const webhook = await getWebhookRowForUser(user.id);
  const platform = await loadMetaPlatformConfig();
  await ensureMetaChannelTables();
  const [connections] = await getDb().query<Array<{instance_id:number;phone_number_id:string;waba_id:string;status:string;token_encrypted:string;display_phone_number:string|null}>>('SELECT mc.*, bi.phone AS display_phone_number FROM meta_connections mc LEFT JOIN bot_instances bi ON bi.id = mc.instance_id WHERE mc.user_id = ?',[user.id]);
  const requestedInstance = Number(request.nextUrl.searchParams.get("instanceId"));
  const [pending] = await getDb().query<Array<{instance_id:number}>>('SELECT instance_id FROM meta_onboarding_pending WHERE user_id = ?',[user.id]);
  const current = requestedInstance ? connections.find(row => row.instance_id === requestedInstance) : connections[0];
  if (requestedInstance && !current) return NextResponse.json({message:"Perfil Meta não encontrado."},{status:404});
  let verification: Record<string, unknown> | null = null;
  const accessToken = current ? (current.status === 'connected' && current.token_encrypted ? decryptWwPanelSecret(current.token_encrypted) : null) : webhook?.access_token;
  const phoneNumberId = current?.phone_number_id ?? webhook?.phone_number_id;
  if (request.nextUrl.searchParams.get("verify") === "1" && accessToken && phoneNumberId) {
    try {
      const phone = await metaGraph(platform, accessToken, `${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`);
      verification = { ok: true, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name, qualityRating: phone.quality_rating, checkedAt: new Date().toISOString() };
    } catch (error) {
      verification = { ok: false, message: error instanceof Error ? error.message : "Falha ao consultar a Meta.", checkedAt: new Date().toISOString() };
    }
  }
  const serializedConnections = await Promise.all(connections.map(async (row) => {
    // Coexistence can pair this official Meta profile to a regular BotAdmin
    // instance. Surface the peer id so the superadmin can inspect both
    // conversation indexes with the same shared chat UI.
    const instance = await getInstanceForUser(user.id, row.instance_id).catch(() => null);
    const connectionDigits = String(row.display_phone_number ?? "").replace(/\D/g, "");
    const [coexistenceCandidates] = await getDb().query<Array<{id:number;phone:string|null;purpose:string|null}>>(
      "SELECT id, phone, purpose FROM bot_instances WHERE user_id = ? AND id <> ?",
      [user.id, row.instance_id],
    );
    // The administrative Bot instance can predate OAuth and therefore have
    // no profile-mesh row despite sharing the exact same WhatsApp number.
    const coexistencePeerId = instance?.meshPeerId ?? coexistenceCandidates.find((candidate) => {
      const candidateDigits = String(candidate.phone ?? "").replace(/\D/g, "");
      return Boolean(connectionDigits) && candidateDigits === connectionDigits && candidate.purpose === "admin_system";
    })?.id ?? null;
    return {
      instanceId: row.instance_id,
      phoneNumberId: row.phone_number_id,
      displayPhoneNumber: row.display_phone_number,
      businessAccountId: row.waba_id,
      status: row.status,
      meshPeerId: instance?.meshPeerId ?? null,
      coexistencePeerId,
    };
  }));
  return NextResponse.json({
    onboarding: publicMetaPlatform(platform),
    onboardingPendingInstanceIds: pending.map(row=>Number(row.instance_id)),
    purpose: await loadMetaPurpose(user.id),
    verification,
    connections: serializedConnections,
    connection: {
      configured: current ? current.status === 'connected' && Boolean(current.token_encrypted) : Boolean(webhook?.access_token && webhook?.phone_number_id),
      phoneNumberId: current?.phone_number_id ?? webhook?.phone_number_id ?? null,
      businessAccountId: current?.waba_id ?? webhook?.business_account_id ?? null,
      lastEventAt: webhook?.last_event_at ?? null,
      coexistenceSync: current ? await metaCoexistenceSyncStatus(current.instance_id) : [],
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({message:"Não autenticado."},{status:401});
  const expectedOrigin = process.env.NODE_ENV === "production"
    ? new URL(getPublicAppBaseUrl()).origin
    : request.nextUrl.origin;
  if (request.headers.get("origin") && request.headers.get("origin") !== expectedOrigin) return NextResponse.json({message:"Origem inválida."},{status:403});
  const payload = await request.json().catch(() => null);
  if (!payload || !["service","groups","both"].includes(payload.purpose)) return NextResponse.json({message:"Objetivo inválido."},{status:400});
  await saveMetaPurpose(user.id, payload.purpose);
  return NextResponse.json({purpose:payload.purpose});
}
