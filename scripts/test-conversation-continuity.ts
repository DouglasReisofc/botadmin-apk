import type { ResultSetHeader } from "mysql2";

import { getBotInterageRuntimeConfig } from "../lib/admin-botinterage-config";
import { createBotInterageChatCompletion } from "../lib/apis/botinterage";
import {
  getBotInterageSystemConversation,
  saveBotInterageSystemConversation,
} from "../lib/botinterage-system";
import { getDb } from "../lib/db";

const TEST_SENDER = "botadmin-continuity-test";

const main = async () => {
  const config = await getBotInterageRuntimeConfig();
  if (!config.enabled || !config.token) throw new Error("ChatGPT Sistema indisponível");

  const firstStarted = Date.now();
  const first = await createBotInterageChatCompletion({
    baseUrl: config.baseUrl,
    token: config.token,
    model: "auto",
    messages: [{ role: "user", content: "Memorize o código AZUL-4821 e responda somente OK." }],
  });
  if (first.error || !first.conversationId) {
    throw new Error(first.error?.message || "Primeira resposta sem conversation_id");
  }
  await saveBotInterageSystemConversation({
    groupId: 1404,
    senderJid: TEST_SENDER,
    conversationId: first.conversationId,
    messageId: first.messageId,
  });
  const persisted = await getBotInterageSystemConversation(1404, TEST_SENDER);

  const secondStarted = Date.now();
  const second = await createBotInterageChatCompletion({
    baseUrl: config.baseUrl,
    token: config.token,
    model: "auto",
    messages: [{ role: "user", content: "Qual foi o código que pedi para memorizar? Responda somente o código." }],
    conversationId: persisted?.conversationId,
    parentMessageId: persisted?.lastMessageId,
  });
  if (second.error) throw new Error(second.error.message || second.error.type);

  const db = getDb();
  await db.query<ResultSetHeader>(
    "DELETE FROM botinterage_system_conversations WHERE group_id = ? AND sender_jid = ?",
    [1404, TEST_SENDER],
  );
  const base = config.baseUrl.replace(/\/+$/, "");
  const prefix = base.endsWith("/v1") ? base : `${base}/v1`;
  await fetch(`${prefix}/conversations/${encodeURIComponent(first.conversationId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.token}` },
  }).catch(() => undefined);

  console.log(
    JSON.stringify({
      firstMs: secondStarted - firstStarted,
      secondMs: Date.now() - secondStarted,
      persisted: persisted?.conversationId === first.conversationId,
      sameConversation: second.conversationId === first.conversationId,
      remembered: /AZUL-?4821/i.test(second.content || ""),
    }),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha no teste de continuidade");
  process.exitCode = 1;
});
