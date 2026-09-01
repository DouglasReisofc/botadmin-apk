import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  MetaApiError,
  fetchMetaBusinessProfile,
  getMetaProfilePhotoContentType,
  resolveMetaProfileCredentials,
  updateMetaProfilePictureHandle,
  uploadMetaProfilePicture,
} from "lib/meta-profile";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const inferContentType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  return "image/jpeg";
};

const formatError = (error: MetaApiError) => {
  const code =
    typeof error.body === "object" &&
    error.body &&
    "error" in error.body &&
    typeof (error.body as { error?: unknown }).error === "object"
      ? (error.body as { error: { message?: unknown; code?: unknown } }).error
      : null;

  if (code && typeof code.message === "string" && typeof code.code === "number") {
    return `${code.code} ${code.message}`;
  }

  return error.bodyText || error.message;
};

async function main() {
  const [, , filePath] = process.argv;

  if (!filePath) {
    console.error(
      "Uso: npx tsx scripts/meta-profile-photo-cli.ts <caminho-da-imagem>",
    );
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  const buffer = await readFile(absolutePath);

  if (buffer.byteLength > MAX_SIZE_BYTES) {
    console.error("A imagem deve ter no máximo 5 MB.");
    process.exit(1);
  }

  const contentType = inferContentType(absolutePath);
  const file = new File([buffer], path.basename(absolutePath), { type: contentType });

  if (!getMetaProfilePhotoContentType(file)) {
    console.error("Envie uma imagem JPG ou PNG.");
    process.exit(1);
  }

  const credentials = resolveMetaProfileCredentials(null);

  if (!credentials) {
    console.error(
      "Defina as variáveis META_APP_ID, PHONE_NUMBER_ID e META_TOKEN antes de rodar este teste.",
    );
    process.exit(1);
  }

  try {
    console.log("Iniciando upload resumível da foto de perfil...");
    const handle = await uploadMetaProfilePicture(null, file, credentials);
    console.log("Upload concluído. Handle recebido:", handle);

    console.log("Aplicando handle ao perfil...");
    await updateMetaProfilePictureHandle(null, handle, credentials);
    console.log("Foto de perfil atualizada com sucesso.");

    const profile = await fetchMetaBusinessProfile(null, credentials);

    if (profile?.profilePictureUrl) {
      console.log("URL da nova foto:", profile.profilePictureUrl);
    }
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("Falha ao atualizar a foto de perfil via Meta:", formatError(error));
      console.error("Status:", error.status, error.statusText);
      console.error("Resposta:", error.bodyText);
      process.exit(1);
    }

    console.error("Erro inesperado:", error);
    process.exit(1);
  }
}

main();
