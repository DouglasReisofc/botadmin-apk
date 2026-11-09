import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { isConnectionPurpose } from "lib/profile-connection-preferences";
import { createPendingMetaProfile, pendingMetaOnboarding, metaConnection, storePendingMetaAuthorization } from "lib/meta-channel";
import { createMetaOnboardingContext } from "lib/meta-onboarding-context";
import { getPublicAppBaseUrl } from "lib/meta";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const expectedOrigin = process.env.NODE_ENV === "production"
    ? new URL(getPublicAppBaseUrl()).origin
    : request.nextUrl.origin;
  // Navegadores sempre enviam Origin em POST; o app (Dio) não envia. Só recusa
  // quando há um Origin diferente do site (proteção CSRF continua valendo).
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== expectedOrigin) {
    return NextResponse.json({ message: "Origem inválida." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || !isConnectionPurpose(body.purpose) || body.purpose === "groups" ||
      (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 120))) {
    return NextResponse.json({ message: "Dados do perfil Meta inválidos." }, { status: 400 });
  }
  try {
    let instanceId = Number(body.instanceId) || null;
    if (body.instanceId != null && (!Number.isSafeInteger(instanceId) || Number(instanceId) < 1)) return NextResponse.json({message:'Perfil Meta inválido.'},{status:400});
    if (instanceId && !(await pendingMetaOnboarding(instanceId,user.id)) && !(await metaConnection(instanceId,user.id))) return NextResponse.json({message:'Perfil Meta não encontrado nesta conta.'},{status:404});
    if (instanceId && !(await pendingMetaOnboarding(instanceId,user.id))) await storePendingMetaAuthorization(instanceId,user.id,'',null);
    instanceId ??= await createPendingMetaProfile(user.id, "", null, {
      purpose: body.purpose,
      name: body.name,
    });
    return NextResponse.json({ saved: true, pending: true, instanceId, context: createMetaOnboardingContext(Number(user.id),Number(instanceId),body.native === true) }, {headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : "Não foi possível preparar o perfil Meta.",
    }, { status: 400 });
  }
}
