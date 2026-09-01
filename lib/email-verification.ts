import { removeEmailVerificationKeys } from "lib/admin-site";

const BYTEPLANT_ENDPOINT = "https://api.email-validator.net/api/verify";

type ByteplantResponse = {
  status?: number;
  info?: string;
  details?: string;
  result?: string;
  reason?: string;
};

type Evaluation =
  | { type: "deliverable"; message?: string | null }
  | { type: "invalid"; message?: string | null }
  | { type: "temporary"; message?: string | null }
  | { type: "key-error"; message?: string | null };

const ACCEPTED_STATUS = new Set([200, 215]);
const ACCEPTED_RESULTS = new Set([
  "ok",
  "accepted",
  "deliverable",
  "valid",
  "catchall",
  "catch-all",
]);
const TEMPORARY_STATUS = new Set([207, 208]);
const TEMPORARY_RESULTS = new Set(["unknown", "retry", "greylisted", "greylist"]);
const KEY_ERROR_STATUS = new Set([119, 120, 130]);

const evaluateByteplantResponse = (body: ByteplantResponse): Evaluation => {
  const status = typeof body.status === "number" ? body.status : null;
  const result = typeof body.result === "string" ? body.result.toLowerCase() : "";
  const message = body.info ?? body.details ?? body.reason ?? null;

  if (status !== null && KEY_ERROR_STATUS.has(status)) {
    return { type: "key-error", message: message ?? "API Key inválida ou esgotada." };
  }

  if ((status !== null && ACCEPTED_STATUS.has(status)) || ACCEPTED_RESULTS.has(result)) {
    return { type: "deliverable", message };
  }

  if ((status !== null && TEMPORARY_STATUS.has(status)) || TEMPORARY_RESULTS.has(result)) {
    return { type: "temporary", message: message ?? "Verificação temporariamente indisponível." };
  }

  return { type: "invalid", message: message ?? "Endereço rejeitado pelo serviço de verificação." };
};

export type EmailVerificationCheck =
  | { status: "skipped" }
  | { status: "deliverable"; info?: string; removedKeys?: string[] }
  | { status: "invalid"; message: string; removedKeys?: string[] }
  | { status: "unavailable"; message: string; removedKeys?: string[] };

export const verifyEmailWithByteplant = async (
  email: string,
  apiKeys: string[],
): Promise<EmailVerificationCheck> => {
  const uniqueKeys = Array.from(new Set(apiKeys.map((key) => key.trim()).filter(Boolean)));
  if (uniqueKeys.length === 0) {
    return { status: "skipped" };
  }

  let encounteredKeyError = false;
  let lastMessage: string | null = null;
  const keysMarkedForRemoval = new Set<string>();

  for (const apiKey of uniqueKeys) {
    const requestUrl = new URL(BYTEPLANT_ENDPOINT);
    requestUrl.searchParams.set("EmailAddress", email);
    requestUrl.searchParams.set("APIKey", apiKey);
    requestUrl.searchParams.set("OutputFormat", "JSON");
    requestUrl.searchParams.set("Timeout", "30");
    requestUrl.searchParams.set("CatchAllDetection", "1");

    try {
      const response = await fetch(requestUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as ByteplantResponse | null;

      if (!payload) {
        lastMessage = "Resposta inválida do serviço de verificação de e-mails.";
        continue;
      }

      const evaluation = evaluateByteplantResponse(payload);

      if (evaluation.type === "deliverable") {
        const removedKeys = Array.from(keysMarkedForRemoval);
        if (keysMarkedForRemoval.size > 0) {
          try {
            await removeEmailVerificationKeys(removedKeys);
          } catch (error) {
            console.error("[Email Verification] Failed to remove depleted API keys", error);
          }
        }

        return {
          status: "deliverable",
          info: evaluation.message ?? undefined,
          removedKeys,
        };
      }

      if (evaluation.type === "invalid") {
        const removedKeys = Array.from(keysMarkedForRemoval);
        if (keysMarkedForRemoval.size > 0) {
          try {
            await removeEmailVerificationKeys(removedKeys);
          } catch (error) {
            console.error("[Email Verification] Failed to remove depleted API keys", error);
          }
        }

        const fallback =
          "Não foi possível validar este e-mail. Verifique se digitou corretamente e tente novamente.";
        const apiMessage = evaluation.message?.trim() ?? "";
        const finalMessage =
          apiMessage && !/address\s+rejected/i.test(apiMessage) ? apiMessage : fallback;

        return {
          status: "invalid",
          message: finalMessage,
          removedKeys,
        };
      }

      if (evaluation.type === "temporary") {
        lastMessage =
          evaluation.message ??
          "O serviço de verificação está temporariamente indisponível. Tente novamente em instantes.";
        continue;
      }

      if (evaluation.type === "key-error") {
        encounteredKeyError = true;
        lastMessage = evaluation.message ?? "API Key inválida ou esgotada.";
        keysMarkedForRemoval.add(apiKey);
        continue;
      }

      lastMessage = "A verificação de e-mail retornou um estado desconhecido.";
    } catch (error) {
      console.error("[Email Verification] Request failed", error);
      lastMessage = "Não foi possível comunicar com o serviço de verificação de e-mails.";
    }
  }

  const removedKeys = Array.from(keysMarkedForRemoval);
  if (keysMarkedForRemoval.size > 0) {
    try {
      await removeEmailVerificationKeys(removedKeys);
    } catch (error) {
      console.error("[Email Verification] Failed to remove depleted API keys", error);
    }
  }

  if (encounteredKeyError) {
    return {
      status: "unavailable",
      message:
        lastMessage ??
        "Nenhuma API Key válida disponível para verificar e-mails. Atualize as configurações no painel administrativo.",
      removedKeys,
    };
  }

  return {
    status: "unavailable",
    message:
      lastMessage ??
      "Não foi possível validar o e-mail informado no momento. Tente novamente em instantes.",
    removedKeys,
  };
};
