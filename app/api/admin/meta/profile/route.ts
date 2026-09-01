import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getAdminWebhookRow } from "lib/admin-webhooks";
import {
  fetchMetaBusinessProfile,
  resolveMetaProfileCredentials,
  updateMetaBusinessProfile,
} from "lib/meta-profile";
import { coerceMetaProfileVertical, DEFAULT_META_PROFILE_VERTICAL } from "lib/meta-profile-verticals";

const ABOUT_LIMIT = 139;
const ADDRESS_LIMIT = 256;
const DESCRIPTION_LIMIT = 512;
const EMAIL_LIMIT = 128;
const WEBSITE_LIMIT = 256;
const MAX_WEBSITES = 2;

const sanitizeTextField = (value: unknown, limit: number) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
};

const sanitizeWebsites = (value: unknown): string[] => {
  if (typeof value === "string") {
    const items = value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return items.slice(0, MAX_WEBSITES).map((item) =>
      item.length > WEBSITE_LIMIT ? item.slice(0, WEBSITE_LIMIT) : item,
    );
  }

  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return items.slice(0, MAX_WEBSITES).map((item) =>
      item.length > WEBSITE_LIMIT ? item.slice(0, WEBSITE_LIMIT) : item,
    );
  }

  return [];
};

const sanitizeVertical = (value: unknown) => coerceMetaProfileVertical(value);

export async function GET() {
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
      return NextResponse.json({ profile: null, requiresSetup: true });
    }

    const profile = await fetchMetaBusinessProfile(webhook, credentials);

    if (profile) {
      profile.vertical = profile.vertical ?? DEFAULT_META_PROFILE_VERTICAL;
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Failed to load admin Meta profile", error);
    return NextResponse.json(
      { message: "Não foi possível carregar o perfil do WhatsApp." },
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

    const webhook = await getAdminWebhookRow();
    const credentials = resolveMetaProfileCredentials(webhook);

    if (!credentials) {
      return NextResponse.json(
        {
          message:
            "Configure o webhook da Meta com o token, app ID e phone number ID antes de atualizar o perfil.",
        },
        { status: 400 },
      );
    }

    const payload = await request.json();

    const about = sanitizeTextField(payload.about, ABOUT_LIMIT);
    const address = sanitizeTextField(payload.address, ADDRESS_LIMIT);
    const description = sanitizeTextField(payload.description, DESCRIPTION_LIMIT);
    const email = sanitizeTextField(payload.email, EMAIL_LIMIT);
    const vertical = sanitizeVertical(payload.vertical);
    const websites = sanitizeWebsites(payload.websites);

    const success = await updateMetaBusinessProfile(
      webhook,
      {
        about: about ?? undefined,
        address: address ?? undefined,
        description: description ?? undefined,
        email: email ?? undefined,
        vertical,
        websites,
      },
      credentials,
    );

    if (!success) {
      return NextResponse.json(
        { message: "Não foi possível atualizar o perfil no momento." },
        { status: 502 },
      );
    }

    const profile = await fetchMetaBusinessProfile(webhook, credentials);

    return NextResponse.json({
      message: "Perfil atualizado com sucesso.",
      profile,
    });
  } catch (error) {
    console.error("Failed to update admin Meta profile", error);
    return NextResponse.json(
      { message: "Não foi possível salvar as alterações do perfil." },
      { status: 500 },
    );
  }
}
