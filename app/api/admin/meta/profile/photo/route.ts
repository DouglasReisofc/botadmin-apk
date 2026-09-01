import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  MetaApiError,
  fetchMetaBusinessProfile,
  getMetaProfilePhotoContentType,
  removeMetaProfilePicture,
  resolveMetaProfileCredentials,
  updateMetaProfilePictureHandle,
  uploadMetaProfilePicture,
} from "lib/meta-profile";

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const webhook = await getAdminWebhookRow();
    const credentials = resolveMetaProfileCredentials(webhook);

    if (!credentials) {
      return NextResponse.json(
        {
          message:
            "Configure o webhook da Meta com o app ID, token e phone number ID antes de atualizar a foto.",
        },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const photo = formData.get("photo");

    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json(
        { message: "Selecione uma imagem válida para enviar." },
        { status: 400 },
      );
    }

    if (photo.size > MAX_PHOTO_SIZE_BYTES) {
      return NextResponse.json(
        { message: "A imagem deve ter no máximo 5 MB." },
        { status: 400 },
      );
    }

    if (!getMetaProfilePhotoContentType(photo)) {
      return NextResponse.json(
        { message: "Envie uma imagem JPG ou PNG." },
        { status: 400 },
      );
    }

    const handle = await uploadMetaProfilePicture(webhook, photo, credentials);

    await updateMetaProfilePictureHandle(webhook, handle, credentials);

    const profile = await fetchMetaBusinessProfile(webhook, credentials);

    return NextResponse.json({
      message: "Foto atualizada com sucesso.",
      profile,
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("[Admin Meta Profile] Upload photo failed", error.context, error.bodyText);

      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }

      if (error.bodyText) {
        return new NextResponse(error.bodyText, {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }

    console.error("Failed to upload admin Meta profile picture", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Não foi possível atualizar a foto do perfil.";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const webhook = await getAdminWebhookRow();
    const credentials = resolveMetaProfileCredentials(webhook);

    if (!credentials) {
      return NextResponse.json(
        {
          message:
            "Configure o webhook da Meta com o app ID, token e phone number ID antes de remover a foto.",
        },
        { status: 400 },
      );
    }

    await removeMetaProfilePicture(webhook, credentials);

    const profile = await fetchMetaBusinessProfile(webhook, credentials);

    return NextResponse.json({
      message: "Foto removida com sucesso.",
      profile,
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("[Admin Meta Profile] Delete photo failed", error.context, error.bodyText);

      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }

      if (error.bodyText) {
        return new NextResponse(error.bodyText, {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }

    console.error("Failed to delete admin Meta profile picture", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Não foi possível remover a foto do perfil.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
