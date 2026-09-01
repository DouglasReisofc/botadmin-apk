import { cleanBotInterageRichText, createBotInterageChatCompletion } from "/opt/botadmin/app/lib/apis/botinterage";
import { getBotInterageRuntimeConfig } from "/opt/botadmin/app/lib/admin-botinterage-config";

const main = async () => {
  const config = await getBotInterageRuntimeConfig();
  if (!config.token) throw new Error("token indisponível");
  const startedAt = Date.now();
  const result = await createBotInterageChatCompletion({
    baseUrl: config.baseUrl,
    token: config.token,
    model: "auto",
    messages: [{ role: "user", content: "Responda somente: teste concluído." }],
  });
  const cleanSample = cleanBotInterageRichText(
    'entity["fictional_character","Donquixote Doflamingo","One Piece"] é um vilão.',
  );
  if (result.conversationId) {
    const base = config.baseUrl.replace(/\/+$/, "");
    const prefix = base.endsWith("/v1") ? base : `${base}/v1`;
    await fetch(`${prefix}/conversations/${encodeURIComponent(result.conversationId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.token}` },
    }).catch(() => undefined);
  }
  console.log(JSON.stringify({
    elapsedMs: Date.now() - startedAt,
    content: result.content,
    cleanSample,
    mediaCount: result.images?.length ?? 0,
    error: result.error ?? null,
  }));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
