import { getBotInterageRuntimeConfig } from "/opt/botadmin/app/lib/admin-botinterage-config";

const main = async () => {
  const conversationId = process.argv[2];
  if (!conversationId) throw new Error("Informe conversation_id");
  const config = await getBotInterageRuntimeConfig();
  if (!config.token) throw new Error("Token indisponível");
  const base = config.baseUrl.replace(/\/+$/, "");
  const prefix = base.endsWith("/v1") ? base : `${base}/v1`;
  const [conversationResponse, imagesResponse] = await Promise.all([
    fetch(`${prefix}/conversations/${encodeURIComponent(conversationId)}?num_turns=20`, {
      headers: { Authorization: `Bearer ${config.token}` },
    }),
    fetch(`${prefix}/conversations/${encodeURIComponent(conversationId)}/images?limit=20`, {
      headers: { Authorization: `Bearer ${config.token}` },
    }),
  ]);
  const conversation = await conversationResponse.json().catch(() => null);
  const images = await imagesResponse.json().catch(() => null);
  console.log(JSON.stringify({
    conversationHttp: conversationResponse.status,
    imagesHttp: imagesResponse.status,
    conversation,
    images,
  }));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
