import { readFile } from "node:fs/promises";

import { saveBotInterageWebhookConfig } from "../lib/admin-botinterage-config";

type WebhookResponse = {
  secret?: string;
  webhook?: { id?: string; client_id?: string; clientId?: string; secret?: string };
  item?: { id?: string; client_id?: string; clientId?: string; secret?: string };
  data?: { id?: string; client_id?: string; clientId?: string; secret?: string };
};

const main = async () => {
  const [responsePath, explicitClientId] = process.argv.slice(2);
  if (!responsePath || !explicitClientId) {
    throw new Error("Uso: configure-botinterage-webhook <resposta.json> <client-id>");
  }

  const payload = JSON.parse(await readFile(responsePath, "utf8")) as WebhookResponse;
  const webhook = payload.webhook ?? payload.item ?? payload.data ?? {};
  const secret = payload.secret ?? webhook.secret ?? "";
  const webhookId = webhook.id ?? "";

  await saveBotInterageWebhookConfig({
    secret,
    webhookId,
    clientId: explicitClientId,
  });

  console.log(JSON.stringify({ ok: true, webhookId, clientId: explicitClientId }));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha ao configurar webhook");
  process.exitCode = 1;
});
