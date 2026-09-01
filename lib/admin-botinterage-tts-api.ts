import { getBotInterageTtsRuntimeConfig } from "lib/admin-botinterage-tts-config";

export class AdminBotInterageTtsApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminBotInterageTtsApiError";
    this.status = status;
  }
}

const resolveEndpoint = (baseUrl: string, suffixPath: string): string => {
  const base = new URL(baseUrl);
  const normalizedBasePath = base.pathname.replace(/\/+$/, "");
  const normalizedSuffix = suffixPath.startsWith("/") ? suffixPath : `/${suffixPath}`;
  base.pathname = normalizedBasePath
    ? `${normalizedBasePath}${normalizedSuffix}`
    : normalizedSuffix;
  base.search = "";
  return base.toString();
};

export const getAdminBotInterageTtsRuntime = async () => {
  const runtime = await getBotInterageTtsRuntimeConfig();
  const baseUrl = runtime.baseUrl?.trim() || "";
  const token = runtime.token?.trim() || "";

  if (!runtime.enabled) {
    throw new AdminBotInterageTtsApiError(
      "Ative a API privada de TTS antes de gerenciar vozes.",
      400,
    );
  }
  if (!baseUrl) {
    throw new AdminBotInterageTtsApiError(
      "Configure a URL base da API privada de TTS.",
      400,
    );
  }
  if (!token) {
    throw new AdminBotInterageTtsApiError(
      "Configure o token da API privada de TTS.",
      400,
    );
  }

  return {
    runtime,
    baseUrl,
    token,
  };
};

export const fetchAdminBotInterageTtsUpstream = async (
  suffixPath: string,
  init: RequestInit = {},
) => {
  const { baseUrl, token } = await getAdminBotInterageTtsRuntime();
  const endpoint = resolveEndpoint(baseUrl, suffixPath);
  const headers = new Headers(init.headers ?? {});
  headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(endpoint, {
    ...init,
    headers,
    cache: "no-store",
  });

  return response;
};
