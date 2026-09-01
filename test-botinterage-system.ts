import { performance } from "node:perf_hooks";

import { createBotInterageChatCompletion } from "lib/apis/botinterage";
import { getBotInterageRuntimeConfig } from "lib/admin-botinterage-config";

const main = async () => {
  const config = await getBotInterageRuntimeConfig();
  if (!config.enabled || !config.baseUrl || !config.token) {
    throw new Error("ChatGPT Sistema não está configurado.");
  }
  const startedAt = performance.now();
  const result = await createBotInterageChatCompletion({
    baseUrl: config.baseUrl,
    token: config.token,
    model: config.model,
    messages: [{ role: "user", content: "Responda apenas: adaptador interno OK" }],
  });
  console.log(JSON.stringify({
    ok: result.content === "adaptador interno OK",
    content: result.content,
    errorType: result.error?.type ?? null,
    elapsedMs: Math.round(performance.now() - startedAt),
  }));
};

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
