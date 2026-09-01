import { getMetaApiVersion } from "./meta";
import { normalizeMetaProfileVertical } from "./meta-profile-verticals";
import type { AdminWebhookRow, UserWebhookRow } from "./db";
import type { MetaBusinessProfile } from "types/meta";

export type MetaProfileCredentials = {
  accessToken: string;
  phoneNumberId: string;
  appId: string;
};

type AnyWebhookRow = UserWebhookRow | AdminWebhookRow | null;

export const resolveMetaProfileCredentials = (
  webhook: AnyWebhookRow,
): MetaProfileCredentials | null => {
  const webhookAccessToken = webhook?.access_token?.trim() ?? "";
  const webhookPhoneNumberId = webhook?.phone_number_id?.trim() ?? "";
  const webhookAppId = webhook?.app_id?.trim() ?? "";

  const envAccessToken = process.env.META_TOKEN?.trim() ?? "";
  const envPhoneNumberId = process.env.PHONE_NUMBER_ID?.trim() ?? "";
  const envAppId = process.env.META_APP_ID?.trim() ?? "";

  const accessToken = webhookAccessToken || envAccessToken;
  const phoneNumberId = webhookPhoneNumberId || envPhoneNumberId;
  const appId = webhookAppId || envAppId;

  if (!accessToken || !phoneNumberId || !appId) {
    return null;
  }

  if (!webhookAccessToken || !webhookPhoneNumberId || !webhookAppId) {
    console.warn(
      "[Meta Profile] Credenciais faltando nas configurações do webhook. Usando variáveis de ambiente como fallback.",
    );
  }

  return { accessToken, phoneNumberId, appId } satisfies MetaProfileCredentials;
};

type MetaApiErrorPayload = {
  status: number;
  statusText: string;
  bodyText: string;
  body: unknown;
  context: string;
};

export class MetaApiError extends Error {
  public readonly status: number;

  public readonly statusText: string;

  public readonly bodyText: string;

  public readonly body: unknown;

  public readonly context: string;

  constructor({ status, statusText, bodyText, body, context }: MetaApiErrorPayload) {
    super(
      `${context}: ${status} ${statusText}${bodyText ? ` ${bodyText}` : ""}`.trim(),
    );

    this.name = "MetaApiError";
    this.status = status;
    this.statusText = statusText;
    this.bodyText = bodyText;
    this.body = body;
    this.context = context;
  }
}

const parseMetaJson = (raw: string): unknown => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.error("[Meta Profile] Failed to parse Meta response", error, raw);
    return null;
  }
};

const readMetaResponse = async (
  response: Response,
  context: string,
): Promise<{ bodyText: string; body: unknown }> => {
  const bodyText = await response.text().catch(() => "");
  const body = parseMetaJson(bodyText);

  if (!response.ok) {
    const error = new MetaApiError({
      status: response.status,
      statusText: response.statusText,
      bodyText,
      body,
      context,
    });

    const errorCode =
      typeof body === "object" && body && "error" in body &&
      typeof (body as Record<string, unknown>).error === "object"
        ? (body as { error: { code?: unknown; error_subcode?: unknown } }).error
        : null;

    if (
      errorCode &&
      typeof errorCode.code === "number" &&
      errorCode.code === 131009 &&
      typeof errorCode.error_subcode === "number" &&
      errorCode.error_subcode === 2494102
    ) {
      console.error(
        "[Meta Profile] Provável uso de ID de /media ou handle de outra WABA/token.",
        body,
      );
    }

    throw error;
  }

  return { bodyText, body };
};

const SUPPORTED_PROFILE_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
};

export const getMetaProfilePhotoContentType = (file: File): string | null => {
  const type = file.type?.trim().toLowerCase();

  if (type && type in SUPPORTED_PROFILE_PHOTO_TYPES) {
    return SUPPORTED_PROFILE_PHOTO_TYPES[type];
  }

  const name = file.name?.trim().toLowerCase() ?? "";

  if (name.endsWith(".png")) {
    return "image/png";
  }

  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  return null;
};

const PROFILE_FIELDS = [
  "about",
  "address",
  "description",
  "email",
  "profile_picture_url",
  "vertical",
  "websites",
] as const;

export const fetchMetaBusinessProfile = async (
  webhook: AnyWebhookRow,
  credentialsOverride?: MetaProfileCredentials,
): Promise<MetaBusinessProfile | null> => {
  const credentials = credentialsOverride ?? resolveMetaProfileCredentials(webhook);

  if (!credentials) {
    return null;
  }

  const version = getMetaApiVersion();
  const url = new URL(
    `https://graph.facebook.com/${version}/${credentials.phoneNumberId}/whatsapp_business_profile`,
  );
  url.searchParams.set("fields", PROFILE_FIELDS.join(","));

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(
        `[Meta Profile] Failed to fetch profile: ${response.status} ${response.statusText}`,
        errorText,
      );
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          data?: Array<Record<string, unknown>>;
          whatsapp_business_profile?: Record<string, unknown> | null;
        }
      | (Record<string, unknown> & { data?: unknown; whatsapp_business_profile?: unknown })
      | null;

    if (!payload || typeof payload !== "object") {
      return null;
    }

    let data: Record<string, unknown> | null = null;

    if (
      "whatsapp_business_profile" in payload &&
      payload.whatsapp_business_profile &&
      typeof payload.whatsapp_business_profile === "object"
    ) {
      data = payload.whatsapp_business_profile as Record<string, unknown>;
    } else if (Array.isArray(payload.data) && payload.data.length > 0) {
      data = payload.data[0] ?? null;
    } else if (!("data" in payload) && !("whatsapp_business_profile" in payload)) {
      data = payload as Record<string, unknown>;
    }

    if (!data) {
      return null;
    }

    const toNullableString = (value: unknown): string | null => {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const websites = Array.isArray(data.websites)
      ? data.websites
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];

    return {
      about: toNullableString(data.about),
      address: toNullableString(data.address),
      description: toNullableString(data.description),
      email: toNullableString(data.email),
      profilePictureUrl: toNullableString(data.profile_picture_url),
      vertical: normalizeMetaProfileVertical(data.vertical) ?? null,
      websites,
    } satisfies MetaBusinessProfile;
  } catch (error) {
    console.error("[Meta Profile] Unexpected error while fetching profile", error);
    return null;
  }
};

export const fetchMetaDisplayPhoneNumber = async (
  webhook: AnyWebhookRow,
  credentialsOverride?: MetaProfileCredentials,
): Promise<string | null> => {
  const credentials = credentialsOverride ?? resolveMetaProfileCredentials(webhook);

  const phoneNumberId = (() => {
    if (webhook && "phone_number_id" in webhook && typeof webhook.phone_number_id === "string") {
      const trimmed = webhook.phone_number_id.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return credentials?.phoneNumberId ?? "";
  })();

  if (!credentials || !phoneNumberId) {
    return null;
  }

  const version = getMetaApiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${phoneNumberId}`);
  url.searchParams.set("fields", "display_phone_number");

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    const result = await readMetaResponse(
      response,
      "[Meta Profile] Failed to fetch phone number",
    );

    if (
      result.body &&
      typeof result.body === "object" &&
      "display_phone_number" in result.body &&
      typeof (result.body as { display_phone_number?: unknown }).display_phone_number === "string"
    ) {
      const value = (result.body as { display_phone_number: string }).display_phone_number.trim();
      if (!value) {
        return null;
      }
      const normalized = value.replace(/[^0-9+]/g, "");
      return normalized || value;
    }
  } catch (error) {
    console.error("[Meta Profile] Unexpected error while fetching phone number", error);
  }

  return null;
};

export const updateMetaBusinessProfile = async (
  webhook: AnyWebhookRow,
  payload: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    vertical?: string;
    websites?: string[];
  },
  credentialsOverride?: MetaProfileCredentials,
): Promise<boolean> => {
  const credentials = credentialsOverride ?? resolveMetaProfileCredentials(webhook);

  if (!credentials) {
    return false;
  }

  const version = getMetaApiVersion();
  const url = `https://graph.facebook.com/${version}/${credentials.phoneNumberId}/whatsapp_business_profile`;

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
  };

  if (typeof payload.about === "string") {
    body.about = payload.about;
  }

  if (typeof payload.address === "string") {
    body.address = payload.address;
  }

  if (typeof payload.description === "string") {
    body.description = payload.description;
  }

  if (typeof payload.email === "string") {
    body.email = payload.email;
  }

  if (typeof payload.vertical === "string") {
    body.vertical = payload.vertical;
  }

  if (Array.isArray(payload.websites)) {
    body.websites = payload.websites;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(
        `[Meta Profile] Failed to update profile: ${response.status} ${response.statusText}`,
        errorText,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Meta Profile] Unexpected error while updating profile", error);
    return false;
  }
};

const resolveProfileUploadFilename = (file: File) => {
  const rawName = file.name?.trim();
  const contentType = file.type?.trim().toLowerCase() ?? "";
  const extensionFromType = contentType.startsWith("image/")
    ? contentType.replace(/^image\//, "")
    : "";

  const normalizeExtension = (value: string) => {
    const sanitized = value.replace(/[^a-z0-9]/gi, "").toLowerCase();

    if (["jpg", "jpeg", "png"].includes(sanitized)) {
      return `.${sanitized === "jpeg" ? "jpg" : sanitized}`;
    }

    return ".jpg";
  };

  const buildFilename = (base: string, extension: string) => {
    const sanitizedBase = base.replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
    const safeBase = sanitizedBase.length > 0 ? sanitizedBase : `profile-${Date.now()}`;
    return `${safeBase}${extension}`;
  };

  if (rawName) {
    const parts = rawName.split(".");
    const base = parts.slice(0, -1).join(".") || parts[0];
    const rawExtension = parts.length > 1 ? parts.at(-1) ?? "" : "";
    const extension = normalizeExtension(rawExtension || extensionFromType);

    return buildFilename(base, extension);
  }

  const defaultExtension = normalizeExtension(extensionFromType);
  return buildFilename("profile", defaultExtension);
};

export const uploadMetaProfilePicture = async (
  webhook: AnyWebhookRow,
  file: File,
  credentialsOverride?: MetaProfileCredentials,
): Promise<string> => {
  const credentials = credentialsOverride ?? resolveMetaProfileCredentials(webhook);

  if (!credentials) {
    throw new Error("Meta credentials are not configured.");
  }

  const contentType = getMetaProfilePhotoContentType(file);

  if (!contentType) {
    throw new Error("A imagem deve ser PNG ou JPG.");
  }

  const version = getMetaApiVersion();
  const filename = resolveProfileUploadFilename(file);
  const arrayBuffer = await file.arrayBuffer();
  const fileLength = arrayBuffer.byteLength;

  const sessionUrl = new URL(
    `https://graph.facebook.com/${version}/${credentials.appId}/uploads`,
  );
  sessionUrl.searchParams.set("file_length", `${fileLength}`);
  sessionUrl.searchParams.set("file_type", contentType);
  sessionUrl.searchParams.set("file_name", filename);
  sessionUrl.searchParams.set("access_token", credentials.accessToken);

  console.log("[Meta Profile] Creating profile photo upload session", {
    url: sessionUrl.toString(),
    contentType,
    fileLength,
    filename,
  });

  const sessionResponse = await fetch(sessionUrl, {
    method: "POST",
    headers: {},
  });

  const sessionResult = await readMetaResponse(
    sessionResponse,
    "[Meta Profile] Failed to create profile photo upload session",
  );

  console.log("[Meta Profile] Create upload session response", {
    status: sessionResponse.status,
    statusText: sessionResponse.statusText,
    body: sessionResult.bodyText,
  });

  const uploadId =
    typeof (sessionResult.body as { id?: unknown } | null)?.id === "string"
      ? ((sessionResult.body as { id: string }).id || "").trim()
      : "";

  if (!uploadId) {
    throw new Error("Meta não retornou o ID da sessão de upload.");
  }

  const uploadUrl = `https://graph.facebook.com/${version}/${uploadId}`;

  console.log("[Meta Profile] Enviando imagem para sessão de upload", {
    uploadId,
    uploadUrl,
  });

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${credentials.accessToken}`,
      file_offset: "0",
      "Content-Type": "application/octet-stream",
    },
    body: Buffer.from(arrayBuffer),
  });

  const uploadResult = await readMetaResponse(
    uploadResponse,
    "[Meta Profile] Failed to upload profile photo chunk",
  );

  console.log("[Meta Profile] Upload chunk response", {
    status: uploadResponse.status,
    statusText: uploadResponse.statusText,
    body: uploadResult.bodyText,
  });

  const handle =
    typeof (uploadResult.body as { h?: unknown } | null)?.h === "string"
      ? ((uploadResult.body as { h: string }).h || "").trim()
      : "";

  if (!handle) {
    throw new Error("Meta não retornou o handle da imagem.");
  }

  return handle;
};

export const updateMetaProfilePictureHandle = async (
  webhook: AnyWebhookRow,
  profilePictureHandle: string,
  credentialsOverride?: MetaProfileCredentials,
): Promise<void> => {
  const credentials = credentialsOverride ?? resolveMetaProfileCredentials(webhook);

  if (!credentials) {
    throw new Error("Meta credentials are not configured.");
  }

  const trimmedHandle = profilePictureHandle.trim();

  if (!trimmedHandle) {
    throw new Error("Handle da imagem inválido.");
  }

  const version = getMetaApiVersion();
  const url = `https://graph.facebook.com/${version}/${credentials.phoneNumberId}/whatsapp_business_profile`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      profile_picture_handle: trimmedHandle,
    }),
  });

  const result = await readMetaResponse(
    response,
    "[Meta Profile] Failed to set profile picture",
  );

  console.log("[Meta Profile] Set profile picture response", {
    status: response.status,
    statusText: response.statusText,
    body: result.bodyText,
  });

  if (
    typeof result.body === "object" &&
    result.body &&
    "success" in result.body &&
    (result.body as { success?: unknown }).success === false
  ) {
    throw new Error("Meta não confirmou a atualização da foto de perfil.");
  }
};

export const removeMetaProfilePicture = async (
  webhook: AnyWebhookRow,
  credentialsOverride?: MetaProfileCredentials,
): Promise<void> => {
  const credentials = credentialsOverride ?? resolveMetaProfileCredentials(webhook);

  if (!credentials) {
    throw new Error("Meta credentials are not configured.");
  }

  const version = getMetaApiVersion();
  const url = new URL(
    `https://graph.facebook.com/${version}/${credentials.phoneNumberId}/profile/photo`,
  );
  url.searchParams.set("messaging_product", "whatsapp");

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
    },
  });

  if (!response.ok) {
    await readMetaResponse(response, "[Meta Profile] Failed to delete profile picture");
  }
};
