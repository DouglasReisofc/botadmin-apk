import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { deleteAndroidKeystore, getAndroidSigningStatus, saveAndroidKeystore } from "lib/mobile-signing";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });

    const url = new URL(request.url);
    const download = url.searchParams.get("download");
    if (download) {
      // Admin download of decrypted keystore
      const payload = await (await import("lib/mobile-signing")).getAndroidKeystoreForCi();
      if (!payload?.base64) {
        return NextResponse.json({ message: "Keystore não configurado." }, { status: 404 });
      }
      const buf = Buffer.from(payload.base64, "base64");
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename=android-keystore.jks`,
        },
      });
    }

    const status = await getAndroidSigningStatus();
    return NextResponse.json(status);
  } catch (_error) {
    return NextResponse.json({ message: 'Falha ao carregar status do keystore.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });

    const form = await request.formData();
    const file = form.get("keystore");
    const keyAlias = String(form.get("keyAlias") ?? "").trim();
    const keyPassword = String(form.get("keyPassword") ?? "");
    const storePassword = String(form.get("storePassword") ?? "");

    const remove = String(form.get("remove")).toLowerCase() === "true";

    if (remove) {
      await deleteAndroidKeystore();
      return NextResponse.json({ message: "Keystore removido." });
    }

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Envie o arquivo .jks/.keystore/.p12 do Android." }, { status: 400 });
    }

    if (!keyAlias || !keyPassword || !storePassword) {
      return NextResponse.json({ message: "Informe alias, senha do alias e senha do keystore." }, { status: 400 });
    }

    const meta = await saveAndroidKeystore(file, { keyAlias, keyPassword, storePassword });
    return NextResponse.json({ message: "Keystore salvo com sucesso.", meta });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao salvar o keystore.';
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    await deleteAndroidKeystore();
    return NextResponse.json({ message: "Keystore removido." });
  } catch (_error) {
    return NextResponse.json({ message: 'Falha ao remover o keystore.' }, { status: 500 });
  }
}
