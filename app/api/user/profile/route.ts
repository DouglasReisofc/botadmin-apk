import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { findUserIdByWhatsappDigits, updateUserProfile } from "lib/users";
import { deleteUploadedFile, saveUploadedFile } from "lib/uploads";
import { normalizeTimezoneInput } from "lib/timezones";

export async function GET() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }
  return NextResponse.json({ user: sessionUser });
}

export async function PATCH(request: Request) {
  const sessionUser = await getCurrentUser();

  if (!sessionUser) {
    return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let formData: FormData | null = null;
  let jsonBody: Record<string, unknown> | null = null;

  if (contentType.includes("multipart/form-data")) {
    formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ message: "Não foi possível ler os dados enviados." }, { status: 400 });
    }
  } else {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }
    jsonBody = body as Record<string, unknown>;
  }

  const readField = (key: string): unknown => {
    if (formData) {
      const value = formData.get(key);
      return value === null ? undefined : value;
    }
    return jsonBody?.[key];
  };

  const updates: {
    name?: string;
    email?: string;
    password?: string;
    whatsappNumber?: string | null;
    avatarPath?: string | null;
    timezone?: string | null;
  } = {};

  const name = readField("name");
  const email = readField("email");
  const password = readField("password");
  const whatsappDialCode = readField("whatsappDialCode");
  const whatsappNumber = readField("whatsappNumber");
  const removeAvatar = readField("removeAvatar");
  const timezoneField = readField("timezone");

  if (typeof name === "string" && name.trim()) {
    updates.name = name.trim();
  }

  if (typeof email === "string" && email.trim()) {
    updates.email = email.trim().toLowerCase();
  }

  if (typeof password === "string" && password.trim()) {
    updates.password = password.trim();
  }

  if (
    (typeof whatsappDialCode === "string" || whatsappDialCode === null) &&
    (typeof whatsappNumber === "string" || whatsappNumber === null)
  ) {
    if (!whatsappDialCode && !whatsappNumber) {
      updates.whatsappNumber = null;
    } else if (typeof whatsappDialCode === "string" && typeof whatsappNumber === "string") {
      const dial = whatsappDialCode.trim();
      const digits = whatsappNumber.replace(/[^0-9]/g, "");

      if (!dial || !digits) {
        return NextResponse.json({ message: "Informe o DDI e o número do WhatsApp." }, { status: 400 });
      }

      if (digits.length < 8 || digits.length > 15) {
        return NextResponse.json(
          { message: "Informe um número de WhatsApp válido (DDD + número)." },
          { status: 400 },
        );
      }

      const dialCode = dial.startsWith("+") ? dial : `+${dial}`;
      const fullNumber = `${dialCode}${digits}`;

      if (fullNumber.length > 25) {
        return NextResponse.json(
          { message: "Número de WhatsApp excede o tamanho permitido." },
          { status: 400 },
        );
      }

      const existingOwnerId = await findUserIdByWhatsappDigits(digits);
      if (existingOwnerId && existingOwnerId !== sessionUser.id) {
        return NextResponse.json(
          { message: "Este número de WhatsApp já está vinculado a outra conta." },
          { status: 400 },
        );
      }

      updates.whatsappNumber = fullNumber;
    }
  }

  if (removeAvatar === "true" || removeAvatar === true) {
    updates.avatarPath = null;
  }

  if (timezoneField !== undefined) {
    if (timezoneField === null) {
      updates.timezone = null;
    } else if (typeof timezoneField === "string") {
      const normalized = timezoneField.trim();
      if (!normalized) {
        updates.timezone = null;
      } else {
        const validTimezone = normalizeTimezoneInput(normalized);
        if (!validTimezone) {
          return NextResponse.json({ message: "Informe um fuso horário válido." }, { status: 400 });
        }
        updates.timezone = validTimezone;
      }
    }
  }

  let newAvatarPath: string | null = null;

  try {
    if (formData) {
      const avatar = formData.get("avatar");
      if (avatar instanceof File && avatar.size > 0) {
        if (!avatar.type.startsWith("image/")) {
          return NextResponse.json({ message: "Envie um arquivo de imagem válido." }, { status: 400 });
        }

        if (avatar.size > 5 * 1024 * 1024) {
          return NextResponse.json({ message: "O avatar deve ter no máximo 5 MB." }, { status: 400 });
        }

        newAvatarPath = await saveUploadedFile(avatar, "avatars");
        updates.avatarPath = newAvatarPath;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { message: "Informe ao menos um campo para atualizar." },
        { status: 400 },
      );
    }

    const updatedUser = await updateUserProfile(sessionUser.id, updates);

    return NextResponse.json({
      message: "Perfil atualizado com sucesso.",
      user: updatedUser,
    });
  } catch (error) {
    if (newAvatarPath) {
      try {
        await deleteUploadedFile(newAvatarPath);
      } catch (cleanupError) {
        console.error("Failed to clean avatar after error", cleanupError);
      }
    }

    console.error("Failed to update user profile", error);
    if (error instanceof Error && error.message) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { message: "Não foi possível atualizar o perfil." },
      { status: 500 },
    );
  }
}
