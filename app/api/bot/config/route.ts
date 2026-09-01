import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getBotMenuConfigForUser, upsertBotMenuConfig } from "lib/bot-config";
import { deleteUploadedFile, saveUploadedFile } from "lib/uploads";

const normalizeVariables = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") {
    return [] as string[];
  }

  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
};

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const config = await getBotMenuConfigForUser(user.id);

    return NextResponse.json({ config });
  } catch (error) {
    console.error("Failed to load bot menu configuration", error);
    return NextResponse.json(
      { message: "Não foi possível carregar a configuração do bot." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const formData = await request.formData();

    const readField = (
      name: string,
      options: { required?: boolean; allowEmpty?: boolean } = {},
    ): string => {
      const { required = false, allowEmpty = false } = options;
      const rawValue = formData.get(name);

      if (rawValue === null) {
        if (required) {
          throw new Error(`Campo obrigatório ausente: ${name}`);
        }
        return "";
      }

      if (typeof rawValue !== "string") {
        throw new Error(`Valor inválido recebido para ${name}`);
      }

      const trimmed = rawValue.trim();

      if (!trimmed && !allowEmpty) {
        if (required) {
          throw new Error(`Campo obrigatório ausente: ${name}`);
        }

        return "";
      }

      if (!trimmed && allowEmpty) {
        return "";
      }

      return trimmed;
    };

    let menuText: string;
    let menuFooterText: string;
    let menuButtonBuyText: string;
    let menuButtonAddBalanceText: string;
    let menuButtonSupportText: string;
    let menuButtonProfileText: string;
    let categoryListHeaderText: string;
    let categoryListBodyText: string;
    let categoryListFooterText: string;
    let categoryListFooterMoreText: string;
    let categoryListButtonText: string;
    let categoryListSectionTitle: string;
    let categoryListNextTitle: string;
    let categoryListNextDescription: string;
    let categoryListEmptyText: string;
    let categoryDetailBodyText: string;
    let categoryDetailFooterText: string;
    let categoryDetailButtonText: string;
    let categoryDetailFileCaption: string | null;
    let addBalanceReplyText: string;
    let supportReplyText: string;
    let profileMenuBodyText: string;
    let profileMenuFooterText: string;
    let profileButtonPurchasesText: string;
    let profileButtonSupportText: string;
    let profileButtonBackText: string;
    let profilePurchasesHeaderText: string;
    let profilePurchasesBodyText: string;
    let profilePurchasesFooterText: string;
    let profilePurchasesEmptyText: string;
    let profilePurchasesButtonText: string;
    let profileSupportReasonBodyText: string;
    let profileSupportReasonFooterText: string;
    let profileSupportReasonPurchaseText: string;
    let profileSupportReasonPaymentText: string;
    let profileSupportReasonOtherText: string;

    try {
      menuText = readField("menuText", { required: true });
      menuFooterText = readField("menuFooterText", { allowEmpty: true });
      menuButtonBuyText = readField("menuButtonBuyText", { required: true });
      menuButtonAddBalanceText = readField("menuButtonAddBalanceText", { required: true });
      menuButtonSupportText = readField("menuButtonSupportText", { required: true });
      menuButtonProfileText = readField("menuButtonProfileText", { required: true });
      categoryListHeaderText = readField("categoryListHeaderText", { required: true });
      categoryListBodyText = readField("categoryListBodyText", { required: true });
      categoryListFooterText = readField("categoryListFooterText", { allowEmpty: true });
      categoryListFooterMoreText = readField("categoryListFooterMoreText", { allowEmpty: true });
      categoryListButtonText = readField("categoryListButtonText", { required: true });
      categoryListSectionTitle = readField("categoryListSectionTitle", { required: true });
      categoryListNextTitle = readField("categoryListNextTitle", { required: true });
      categoryListNextDescription = readField("categoryListNextDescription", { required: true });
      categoryListEmptyText = readField("categoryListEmptyText", { required: true });
      categoryDetailBodyText = readField("categoryDetailBodyText", { required: true });
      categoryDetailFooterText = readField("categoryDetailFooterText", { allowEmpty: true });
      categoryDetailButtonText = readField("categoryDetailButtonText", { required: true });
      const detailCaptionRaw = readField("categoryDetailFileCaption", { allowEmpty: true });
      categoryDetailFileCaption = detailCaptionRaw.length > 0 ? detailCaptionRaw : null;
      addBalanceReplyText = readField("addBalanceReplyText", { required: true });
      supportReplyText = readField("supportReplyText", { required: true });
      profileMenuBodyText = readField("profileMenuBodyText", { required: true });
      profileMenuFooterText = readField("profileMenuFooterText", { allowEmpty: true });
      profileButtonPurchasesText = readField("profileButtonPurchasesText", { required: true });
      profileButtonSupportText = readField("profileButtonSupportText", { required: true });
      profileButtonBackText = readField("profileButtonBackText", { required: true });
      profilePurchasesHeaderText = readField("profilePurchasesHeaderText", { required: true });
      profilePurchasesBodyText = readField("profilePurchasesBodyText", { required: true });
      profilePurchasesFooterText = readField("profilePurchasesFooterText", { allowEmpty: true });
      profilePurchasesEmptyText = readField("profilePurchasesEmptyText", { required: true });
      profilePurchasesButtonText = readField("profilePurchasesButtonText", { required: true });
      profileSupportReasonBodyText = readField("profileSupportReasonBodyText", { required: true });
      profileSupportReasonFooterText = readField("profileSupportReasonFooterText", { allowEmpty: true });
      profileSupportReasonPurchaseText = readField("profileSupportReasonPurchaseText", { required: true });
      profileSupportReasonPaymentText = readField("profileSupportReasonPaymentText", { required: true });
      profileSupportReasonOtherText = readField("profileSupportReasonOtherText", { required: true });
    } catch (validationError) {
      const message = validationError instanceof Error
        ? validationError.message
        : "Não foi possível validar os campos enviados.";

      return NextResponse.json({ message }, { status: 400 });
    }

    const variablesRaw = formData.get("variables");
    const removeImage = (formData.get("removeImage") ?? "") === "true";
    const image = formData.get("image");

    const variables = normalizeVariables(variablesRaw);

    if (image && !(image instanceof File)) {
      return NextResponse.json(
        { message: "Arquivo de mídia inválido." },
        { status: 400 },
      );
    }

    const existingConfig = await getBotMenuConfigForUser(user.id);
    let imagePath = existingConfig?.imagePath ?? null;

    if (removeImage && imagePath) {
      await deleteUploadedFile(imagePath);
      imagePath = null;
    }

    if (image instanceof File && image.size > 0) {
      const storedPath = await saveUploadedFile(image, `bot-configs/${user.id}`);
      if (imagePath && imagePath !== storedPath) {
        await deleteUploadedFile(imagePath);
      }
      imagePath = storedPath;
    }

    const config = await upsertBotMenuConfig({
      userId: user.id,
      menuText,
      menuFooterText,
      menuButtonBuyText,
      menuButtonAddBalanceText,
      menuButtonSupportText,
      menuButtonProfileText,
      categoryListHeaderText,
      categoryListBodyText,
      categoryListFooterText,
      categoryListFooterMoreText,
      categoryListButtonText,
      categoryListSectionTitle,
      categoryListNextTitle,
      categoryListNextDescription,
      categoryListEmptyText,
      categoryDetailBodyText,
      categoryDetailFooterText,
      categoryDetailButtonText,
      categoryDetailFileCaption,
      addBalanceReplyText,
      supportReplyText,
      profileMenuBodyText,
      profileMenuFooterText,
      profileButtonPurchasesText,
      profileButtonSupportText,
      profileButtonBackText,
      profilePurchasesHeaderText,
      profilePurchasesBodyText,
      profilePurchasesFooterText,
      profilePurchasesEmptyText,
      profilePurchasesButtonText,
      profileSupportReasonBodyText,
      profileSupportReasonFooterText,
      profileSupportReasonPurchaseText,
      profileSupportReasonPaymentText,
      profileSupportReasonOtherText,
      variables,
      imagePath,
    });

    return NextResponse.json({
      message: "Configuração do bot atualizada com sucesso.",
      config,
    });
  } catch (error) {
    console.error("Failed to update bot menu configuration", error);
    return NextResponse.json(
      { message: "Não foi possível salvar a configuração do bot." },
      { status: 500 },
    );
  }
}
