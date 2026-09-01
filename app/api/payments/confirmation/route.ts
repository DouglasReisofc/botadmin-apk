import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getPaymentConfirmationConfigForUser, upsertPaymentConfirmationConfig } from "lib/payments";
import { deleteUploadedFile, saveUploadedFile } from "lib/uploads";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
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
        { message: "Defina o texto do botão que abrirá o menu de compras." },
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

    const currentConfig = await getPaymentConfirmationConfigForUser(user.id);
    let mediaPath = currentConfig.mediaPath;

    if (shouldRemoveImage && mediaPath) {
      await deleteUploadedFile(mediaPath);
      mediaPath = null;
    }

    if (media instanceof File && media.size > 0) {
      const storedPath = await saveUploadedFile(media, `payment-confirmation/${user.id}`);
      if (mediaPath && mediaPath !== storedPath) {
        await deleteUploadedFile(mediaPath);
      }
      mediaPath = storedPath;
    }

    const config = await upsertPaymentConfirmationConfig({
      userId: user.id,
      messageText: sanitizedMessageText,
      buttonLabel: sanitizedButtonLabel,
      mediaPath,
    });

    return NextResponse.json({
      message: "Mensagem de confirmação salva com sucesso.",
      config,
    });
  } catch (error) {
    console.error("Failed to update payment confirmation message", error);
    return NextResponse.json(
      { message: "Não foi possível atualizar a mensagem de confirmação." },
      { status: 500 },
    );
  }
}
