import { NextResponse } from "next/server";

import { getMercadoPagoPixChargeByPublicId } from "lib/payments";

export async function GET(
  _request: Request,
  context: { params: Promise<{ chargeId: string }> },
) {
  try {
    const { chargeId } = await context.params;
    const trimmedId = chargeId.trim();

    if (!trimmedId) {
      return new Response("Not Found", { status: 404 });
    }

    const charge = await getMercadoPagoPixChargeByPublicId(trimmedId);

    if (!charge || !charge.qrCodeBase64) {
      return new Response("Not Found", { status: 404 });
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(charge.qrCodeBase64, "base64");
    } catch (error) {
      console.error("Failed to decode Pix QR base64", error);
      return NextResponse.json(
        { message: "Não foi possível carregar o QR Code." },
        { status: 500 },
      );
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Failed to serve Pix QR image", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o QR Code." },
      { status: 500 },
    );
  }
}
