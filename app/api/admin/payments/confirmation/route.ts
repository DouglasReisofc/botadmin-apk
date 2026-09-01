import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getAdminPaymentConfirmationConfig,
  upsertAdminPaymentConfirmationConfig,
} from "lib/admin-payments";
import { deleteUploadedFile, saveUploadedFile } from "lib/uploads";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const config = await getAdminPaymentConfirmationConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Failed to load admin payment confirmation", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a mensagem de confirmação." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const formData = await request.formData();

    const messageText = formData.get("messageText");
    const buttonLabel = formData.get("buttonLabel");
    const removeImageRaw = formData.get("removeImage");
    const media = formData.get("media");

    const sanitizedMessageText = typeof messageText === "string" ? messageText : "";
    const sanitizedButtonLabel = typeof buttonLabel === "string" ? buttonLabel : "";
    const shouldRemoveImage = typeof removeImageRaw === "string" && removeImageRaw === "true";

    if (!sanitizedMessageText.trim()) {
      return NextResponse.json(
        { message: "Informe a mensagem que será enviada após o pagamento." },
        { status: 400 },
      );
    }

    if (!sanitizedButtonLabel.trim()) {
      return NextResponse.json(
        { message: "Defina o texto do botão que direcionará o usuário após o pagamento." },
        { status: 400 },
      );
    }

    if (media && !(media instanceof File)) {
      return NextResponse.json(
        { message: "Arquivo de imagem inválido." },
        { status: 400 },
      );
    }

    if (media instanceof File && media.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { message: "A imagem deve ter no máximo 5 MB." },
        { status: 400 },
      );
    }

    const currentConfig = await getAdminPaymentConfirmationConfig();
    let mediaPath = currentConfig.mediaPath;

    if (shouldRemoveImage && mediaPath) {
      await deleteUploadedFile(mediaPath);
      mediaPath = null;
    }

    if (media instanceof File && media.size > 0) {
      const storedPath = await saveUploadedFile(media, "payment-confirmation/admin");
      if (mediaPath && mediaPath !== storedPath) {
        await deleteUploadedFile(mediaPath);
      }
      mediaPath = storedPath;
    }

    const config = await upsertAdminPaymentConfirmationConfig({
      messageText: sanitizedMessageText,
      buttonLabel: sanitizedButtonLabel,
      mediaPath,
    });

    return NextResponse.json({
      message: "Mensagem de confirmação salva com sucesso.",
      config,
    });
  } catch (error) {
    console.error("Failed to update admin payment confirmation", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a mensagem de confirmação." },
      { status: 500 },
    );
  }
}
