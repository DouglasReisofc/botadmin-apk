import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "lib/auth";
import { loadMetaPlatformConfig, metaGraph, publicMetaPlatform } from "lib/meta-platform";
import { bindMetaConnection, createPendingMetaProfile, metaConnection, pendingMetaOnboarding, requestMetaCoexistenceSync, storePendingMetaAuthorization, updatePendingMetaOnboarding } from "lib/meta-channel";
import { getPublicAppBaseUrl } from "lib/meta";
import { isConnectionPurpose } from "lib/profile-connection-preferences";
import { decryptWwPanelSecret } from "lib/wwpanel";
import { resolveMetaOnboardingUser, verifyMetaOnboardingContext } from "lib/meta-onboarding-context";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(()=>null);
  const context = verifyMetaOnboardingContext(body?.context);
  if (body?.context && !context) return NextResponse.json({message:'A conexão expirou. Inicie novamente pelo BotAdmin.'},{status:403});
  if (context && Number(body?.instanceId) !== context.instanceId) return NextResponse.json({message:'Perfil inválido para esta autorização.'},{status:403});
  const user = context ? await resolveMetaOnboardingUser(context) : await getCurrentUser();
  if (!user) return NextResponse.json({message:"Não autenticado."},{status:401});
  const csrf = request.cookies.get("ba_meta_csrf")?.value;
  const expectedOrigin = process.env.NODE_ENV === "production"
    ? new URL(getPublicAppBaseUrl()).origin
    : request.nextUrl.origin;
  if (request.headers.get("origin") !== expectedOrigin || (!context && (!csrf || request.headers.get("x-meta-onboarding-csrf") !== csrf))) return NextResponse.json({message:"Conexão expirada. Abra novamente o cadastro."},{status:403});
  const wabaId = typeof body?.wabaId === "string" ? body.wabaId : typeof body?.wabaId === "number" ? String(body.wabaId) : "";
  const requestedPhoneId = typeof body?.phoneNumberId === "string" ? body.phoneNumberId : typeof body?.phoneNumberId === "number" ? String(body.phoneNumberId) : "";
  const code = typeof body?.code === "string" ? body.code : "";
  if (!body || (code.length > 4096) || (!code && !body.instanceId) || (wabaId && !/^\d{5,40}$/.test(wabaId)) || (requestedPhoneId && !/^\d{5,40}$/.test(requestedPhoneId))) return NextResponse.json({message:"A autorização foi recebida, mas faltaram dados válidos da conta WhatsApp. Tente conectar novamente."},{status:400});
  if (body.mode !== "coexistence") return NextResponse.json({message:"Use a conexão com coexistência para manter o WhatsApp Business no celular."},{status:400});
  if (!isConnectionPurpose(body.connectionPurpose) || body.connectionPurpose === "groups" || (body.profileName !== undefined && (typeof body.profileName !== "string" || body.profileName.length > 120))) return NextResponse.json({message:"A API oficial da Meta está disponível para atendimento individual. Para gerenciar grupos, escolha EasyZap."},{status:400});
  if (body.instanceId != null && (!Number.isSafeInteger(Number(body.instanceId)) || Number(body.instanceId) < 1)) return NextResponse.json({message:"Perfil Meta inválido."},{status:400});
  let pendingInstanceId: number | undefined;
  let instanceId: number | undefined;
  let existingPhoneNumberId: string | undefined;
  let accessToken = "";
  const saveAsPending = async (message: string, awaitingSignup = false) => {
    if (pendingInstanceId && accessToken) {
      if (existingPhoneNumberId) await storePendingMetaAuthorization(pendingInstanceId,user.id,accessToken,wabaId||null);
      else await updatePendingMetaOnboarding(pendingInstanceId,user.id,accessToken,wabaId||null,message);
    }
    if (instanceId && accessToken) return NextResponse.json({connected:false,pending:true,authorizationSaved:true,awaitingSignup,instanceId,message},{status:202});
    return NextResponse.json({message},{status:400});
  };
  try {
    const config = await loadMetaPlatformConfig();
    if (!publicMetaPlatform(config).ready) return NextResponse.json({message:"Integração desativada."},{status:503});
    if (body.instanceId) {
      const requested=Number(body.instanceId);
      const [pending,existing]=await Promise.all([pendingMetaOnboarding(requested,user.id),metaConnection(requested,user.id)]);
      if (pending) pendingInstanceId=requested;
      if (existing) { instanceId=requested; existingPhoneNumberId=existing.phone_number_id; }
      if (!pending && !existing) return NextResponse.json({message:"Perfil Meta não encontrado. Atualize a página e tente novamente."},{status:404});
    }
    if (code) {
      const tokenResponse = await fetch(`https://graph.facebook.com/${config.apiVersion}/oauth/access_token`, {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:config.appId,client_secret:config.appSecret,code}),signal:AbortSignal.timeout(20000),cache:'no-store',
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || typeof tokenData.access_token !== 'string') {
        const reason = tokenData.error?.message || 'A Meta não concluiu a autorização. O perfil permanece salvo como pendente.';
        return NextResponse.json({connected:false,pending:Boolean(pendingInstanceId),authorizationSaved:false,instanceId:pendingInstanceId??instanceId,message:reason},{status:400});
      }
      accessToken=tokenData.access_token;
      // Persist the user token immediately after exchanging OAuth, before
      // depending on the separate WA_EMBEDDED_SIGNUP event arriving.
      if (pendingInstanceId) {
        await storePendingMetaAuthorization(pendingInstanceId,user.id,accessToken,wabaId||null);
        instanceId=pendingInstanceId;
      } else if (instanceId) {
        const existing=await metaConnection(instanceId,user.id);
        if (!existing) return NextResponse.json({message:"Perfil Meta não encontrado."},{status:404});
        existingPhoneNumberId=existing.phone_number_id;
        await storePendingMetaAuthorization(instanceId,user.id,accessToken,wabaId||null);
        pendingInstanceId=instanceId;
      } else {
        instanceId=await createPendingMetaProfile(user.id,accessToken,wabaId||null,{purpose:body.connectionPurpose,name:body.profileName});
        pendingInstanceId=instanceId;
        await storePendingMetaAuthorization(instanceId,user.id,accessToken,wabaId||null);
      }
    } else if (pendingInstanceId) {
      const pending=await pendingMetaOnboarding(pendingInstanceId,user.id);
      accessToken=pending?.token_encrypted ? decryptWwPanelSecret(pending.token_encrypted) : "";
      instanceId=pendingInstanceId;
    } else if (instanceId) {
      const existing=await metaConnection(instanceId,user.id);
      accessToken=existing?.token_encrypted ? decryptWwPanelSecret(existing.token_encrypted) : "";
    }
    if (!accessToken || !instanceId) return NextResponse.json({message:"A autorização ainda não foi salva. Reconecte o perfil e tente novamente."},{status:400});
    if (!wabaId) return saveAsPending('Autorização salva com segurança. Aguardando os dados da conta WhatsApp para concluir o vínculo.',true);
    // Coexistence completion events may contain only waba_id. Resolve the phone
    // from the authorized WABA instead of treating Meta's successful finish as
    // an authorization failure. Never guess when a WABA exposes multiple phones.
    const phones = await metaGraph(config,accessToken,`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`);
    if (!Array.isArray(phones.data) || !phones.data.length) throw new Error('A Meta autorizou a conta, mas não retornou números disponíveis nesse WhatsApp Business.');
    const phone = requestedPhoneId
      ? phones.data.find((candidate:{id:string})=>candidate.id===requestedPhoneId)
      : phones.data.length === 1 ? phones.data[0] : undefined;
    if (!phone) return saveAsPending(requestedPhoneId
      ? 'O número informado não pertence à conta WhatsApp autorizada.'
      : 'A Meta autorizou a conta, mas não identificou qual número conectar. O perfil foi salvo como pendente para você concluir depois.');
    if (existingPhoneNumberId && existingPhoneNumberId !== phone.id) return saveAsPending("Este perfil já está conectado a outro número. Selecione o perfil correspondente antes de renovar a conexão.");
    await metaGraph(config,accessToken,`${wabaId}/subscribed_apps`,{});
    await metaGraph(config,accessToken,`${wabaId}/subscribed_apps`,{
      override_callback_uri:`${getPublicAppBaseUrl()}/api/meta/webhook`,verify_token:config.verifyToken,
    });
    const connectedInstanceId = await bindMetaConnection(user.id, phone, wabaId, accessToken, user.role === "admin", {purpose:body.connectionPurpose,name:body.profileName},pendingInstanceId);
    const coexistenceSync = existingPhoneNumberId ? [] : await Promise.all([
      ...(['smb_app_state_sync','history'] as const).map(async syncType=>requestMetaCoexistenceSync(connectedInstanceId,user.id,syncType).catch(error=>({syncType,status:'failed',requestId:null,progress:0,lastError:error instanceof Error?error.message:'Falha ao solicitar sincronização.',alreadyRequested:false}))),
    ]);
    const response = NextResponse.json({connected:true,instanceId:connectedInstanceId,phoneNumberId:phone.id,businessAccountId:wabaId,coexistenceSync});
    response.cookies.delete({name:'ba_meta_csrf',path:'/api/meta/onboarding'});
    return response;
  } catch(error) {
    if(instanceId && accessToken) return saveAsPending(error instanceof Error?error.message:'A autorização foi salva e o perfil ficará pendente até a Meta concluir a configuração.');
    return NextResponse.json({message:error instanceof Error?error.message:'Não foi possível conectar.'},{status:400});
  }
}
