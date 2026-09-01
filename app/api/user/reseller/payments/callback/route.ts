import { NextResponse } from "next/server";

import {
  completePartnerMercadoPagoOAuth,
  verifyPartnerMercadoPagoState,
} from "lib/partner-payments";
import { ResellerProgramError } from "lib/reseller-program";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const error = url.searchParams.get("error") || "";
  let destination = "/dashboard/user";
  try {
    if (state) {
      const parsed = verifyPartnerMercadoPagoState(state);
      destination = `/dashboard/user?partner_payment=${error ? "error" : "connected"}&partner_section=payments`;
      if (!error && code) await completePartnerMercadoPagoOAuth(parsed.userId, code);
    }
  } catch (caught) {
    console.error("[Mercado Pago OAuth callback] failed", caught);
    const message = caught instanceof ResellerProgramError ? caught.message : "Não foi possível conectar a conta Mercado Pago.";
    destination = `/dashboard/user?partner_payment=error&partner_section=payments&message=${encodeURIComponent(message.slice(0, 180))}`;
  }
  const configuredBase = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.DEFAULT_APP_URL || "https://botadmin.shop").trim();
  const publicBase = /^https?:\/\//i.test(configuredBase) ? configuredBase : `https://${configuredBase}`;
  return NextResponse.redirect(new URL(destination, publicBase));
}
