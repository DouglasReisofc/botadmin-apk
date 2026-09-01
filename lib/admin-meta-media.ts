import { getMetaApiVersion } from "./meta";
import type { AdminWebhookRow } from "./db";
import { resolveMetaTemplateCredentials } from "./admin-meta-templates";
import { resolveMetaProfileCredentials } from "./meta-profile";
import type { TemplateMediaKind, TemplateMediaUpload } from "types/admin-meta-templates";

type AnyWebhookRow = AdminWebhookRow | null;

type MetaUploadSessionResponse = {
  id?: string;
  h?: string;
  handle?: string;
};

type ChunkUploadOptions = {
  accessToken: string;
  uploadId: string;
  buffer: Buffer;
};

const META_ACCEPTED_MIME_BY_KIND: Record<TemplateMediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/3gpp"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
};

const MAX_FILE_SIZE_BYTES: Record<TemplateMediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  "3gpp": "video/3gpp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const assertFileConstraints = (kind: TemplateMediaKind, mimeType: string, size: number) => {
  const allowed = META_ACCEPTED_MIME_BY_KIND[kind];
  if (!allowed.includes(mimeType)) {
    throw new Error(
      `O arquivo enviado deve ser do tipo ${allowed.join(", ")} para ${kind}.`,
    );
  }

  const maxSize = MAX_FILE_SIZE_BYTES[kind];
  if (size > maxSize) {
    const megaBytes = (maxSize / (1024 * 1024)).toFixed(1);
    throw new Error(`O arquivo pode ter no máximo ${megaBytes} MB.`);
  }
};

const createMetaUploadSession = async (
  accessToken: string,
  appId: string,
  params: {
    mimeType: string;
    fileSize: number;
    fileName: string;
  },
): Promise<string> => {
  const version = getMetaApiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${appId}/uploads`);
  url.searchParams.set("file_length", `${params.fileSize}`);
  url.searchParams.set("file_type", params.mimeType);
  url.searchParams.set("file_name", params.fileName);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, { method: "POST" });
  const body = (await response.json().catch(() => null)) as MetaUploadSessionResponse | null;

  if (!response.ok || !body?.id) {
    console.error("[MetaTemplateMedia] Failed to create upload session", {
      status: response.status,
      statusText: response.statusText,
      body,
    });
    throw new Error("Não foi possível iniciar o upload com a Meta.");
  }

  return body.id;
};

const uploadMetaChunk = async ({ accessToken, uploadId, buffer }: ChunkUploadOptions) => {
  const version = getMetaApiVersion();
  const url = `https://graph.facebook.com/${version}/${uploadId}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: "0",
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });

  const body = (await response.json().catch(() => null)) as MetaUploadSessionResponse | null;

  if (!response.ok || !body?.h) {
    console.error("[MetaTemplateMedia] Failed to upload chunk", {
      status: response.status,
      statusText: response.statusText,
      body,
    });
    throw new Error("A Meta rejeitou o arquivo enviado.");
  }

  return body.h;
};

export const uploadTemplateMedia = async (
  webhook: AnyWebhookRow,
  file: File,
  kind: TemplateMediaKind,
): Promise<TemplateMediaUpload> => {
  const templateCredentials = await resolveMetaTemplateCredentials(webhook);
  if (!templateCredentials) {
    throw new Error(
      "Configure o access token e o Business Account ID do bot administrativo antes de enviar arquivos.",
    );
  }

  const profileCredentials = resolveMetaProfileCredentials(webhook);
  if (!profileCredentials) {
    throw new Error(
      "Configure também o App ID do webhook administrativo antes de enviar arquivos de modelo.",
    );
  }

  let mimeType = file.type?.trim() || "";
  if (!mimeType) {
    const extension = file.name?.split(".").pop()?.toLowerCase() ?? "";
    if (extension && EXTENSION_MIME_MAP[extension]) {
      mimeType = EXTENSION_MIME_MAP[extension];
    }
  }
  if (!mimeType) {
    throw new Error("Não foi possível identificar o tipo do arquivo. Utilize um formato suportado.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  assertFileConstraints(kind, mimeType, buffer.byteLength);

  const fileName = (() => {
    const name = file.name?.trim();
    if (name) {
      const base = name.replace(/[^a-z0-9_.-]/gi, "").slice(0, 80);
      return base || `${kind}-${Date.now()}`;
    }
    return `${kind}-${Date.now()}`;
  })();

  const uploadId = await createMetaUploadSession(
    templateCredentials.accessToken,
    profileCredentials.appId,
    {
      mimeType,
      fileSize: buffer.byteLength,
      fileName,
    },
  );

  const handle = await uploadMetaChunk({
    accessToken: templateCredentials.accessToken,
    uploadId,
    buffer,
  });

  return {
    uploadId,
    handle,
    kind,
    mimeType,
    fileName,
    fileSize: buffer.byteLength,
    previewUrl: null,
    createdAt: new Date().toISOString(),
  } satisfies TemplateMediaUpload;
};

export const resolveTemplateMediaUrl = async (
  webhook: AnyWebhookRow,
  handle: string,
): Promise<string> => {
  const trimmed = handle.trim();
  if (!trimmed) {
    throw new Error("Informe o identificador do arquivo.");
  }

  if (isHttpUrl(trimmed)) {
    return trimmed;
  }

  const credentials = await resolveMetaTemplateCredentials(webhook);
  if (!credentials) {
    throw new Error(
      "Configure o access token e o Business Account ID do bot administrativo antes de recuperar arquivos.",
    );
  }

  const version = getMetaApiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(trimmed)}`);
  url.searchParams.set("fields", "url");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
    },
  });

  const body = (await response.json().catch(() => null)) as { url?: string } | null;

  if (!response.ok || typeof body?.url !== "string" || !body.url.trim()) {
    console.error("[MetaTemplateMedia] Failed to resolve template media URL", {
      status: response.status,
      statusText: response.statusText,
      body,
    });
    throw new Error("Não foi possível obter a URL pública do arquivo na Meta.");
  }

  return body.url;
};
