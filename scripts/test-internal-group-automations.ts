import { loadEnvConfig } from "@next/env";
import type { RowDataPacket } from "mysql2";

loadEnvConfig(process.cwd(), false);

import { getGroupSettings, upsertGroupSettings } from "../lib/bot-group-settings";
import { getDb } from "../lib/db";
import {
  createInternalGroupMessage,
  processInternalGroupBotMessage,
} from "../lib/internal-groups";

type TestResult = {
  name: string;
  ok: boolean;
  reaction?: string | null;
  reactionLatencyMs?: number | null;
  details?: string;
};

const groupId = Number(process.env.QA_INTERNAL_GROUP_ID || 2);
const createdMessageIds = new Set<number>();
const results: TestResult[] = [];

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const getReaction = async (messageId: number): Promise<string | null> => {
  const [rows] = await getDb().query<(RowDataPacket & { emoji: string })[]>(
    "SELECT emoji FROM internal_group_bot_reactions WHERE message_id = ? LIMIT 1",
    [messageId],
  );
  return rows[0]?.emoji ?? null;
};

const createAndProcess = async (params: {
  userId: number;
  text?: string;
  messageType?: string;
  mediaPath?: string;
}) => {
  const response = await createInternalGroupMessage(groupId, params.userId, {
    text: params.text,
    messageType: params.messageType ?? "text",
    mediaPath: params.mediaPath,
    mediaMimeType: params.messageType === "image" ? "image/png" : null,
    mediaFileName: params.messageType === "image" ? "qa-image.png" : null,
    clientMessageId: `qa-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  const messageId = Number((response as { message?: { id?: number } }).message?.id ?? 0);
  if (!messageId) throw new Error("A mensagem sintética não foi persistida.");
  createdMessageIds.add(messageId);

  const startedAt = Date.now();
  const processing = processInternalGroupBotMessage(groupId, messageId, params.userId);
  let reaction: string | null = null;
  let reactionLatencyMs: number | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    reaction = await getReaction(messageId);
    if (reaction) {
      reactionLatencyMs = Date.now() - startedAt;
      break;
    }
    await sleep(50);
  }
  const botMessageIds = await processing;
  botMessageIds.forEach((id) => createdMessageIds.add(Number(id)));
  return { messageId, botMessageIds, reaction, reactionLatencyMs };
};

const botReplyContains = async (ids: number[], text: string) => {
  if (!ids.length) return false;
  const [rows] = await getDb().query<(RowDataPacket & { body: string | null })[]>(
    `SELECT body FROM internal_group_messages WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return rows.some((row) => (row.body ?? "").includes(text));
};

const main = async () => {
  const db = getDb();
  const [groups] = await db.query<(RowDataPacket & { bot_group_id: number })[]>(
    "SELECT bot_group_id FROM internal_groups WHERE id = ? LIMIT 1",
    [groupId],
  );
  const settingsId = Number(groups[0]?.bot_group_id ?? 0);
  if (!settingsId) throw new Error("Grupo interno de teste não possui configurações do robô.");

  const [members] = await db.query<(RowDataPacket & {
    user_id: number;
    role: string;
    status: string;
  })[]>(
    `SELECT m.user_id, m.role, m.status
       FROM internal_group_members m
       INNER JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? AND u.email LIKE 'loadtest.%@botadmin.test'
      ORDER BY m.user_id LIMIT 1`,
    [groupId],
  );
  const member = members[0];
  if (!member) throw new Error("Nenhum usuário sintético loadtest está no grupo.");

  const originalSettings = await getGroupSettings(settingsId);
  await db.query(
    "UPDATE internal_group_members SET role = 'member', status = 'active' WHERE group_id = ? AND user_id = ?",
    [groupId, member.user_id],
  );

  try {
    await upsertGroupSettings(settingsId, {
      commandToggles: { ...originalSettings.commandToggles, botinterage: true },
    });

    const ping = await createAndProcess({ userId: member.user_id, text: "!ping" });
    results.push({
      name: "comando reconhecido",
      ok: ping.reaction === "💬" && await botReplyContains(ping.botMessageIds, "Pong"),
      reaction: ping.reaction,
      reactionLatencyMs: ping.reactionLatencyMs,
    });

    const deniedToggle = await createAndProcess({ userId: member.user_id, text: "!antilink" });
    results.push({
      name: "comando administrativo por membro",
      ok: deniedToggle.reaction === "💬" && await botReplyContains(deniedToggle.botMessageIds, "Apenas administradores"),
      reaction: deniedToggle.reaction,
      reactionLatencyMs: deniedToggle.reactionLatencyMs,
    });

    const ai = await createAndProcess({
      userId: member.user_id,
      text: "Teste interno: responda apenas QA-BOTINTERAGE-OK.",
    });
    results.push({
      name: "BotInterage reconhecido",
      ok: ai.reaction === "🧠" && ai.botMessageIds.length > 0,
      reaction: ai.reaction,
      reactionLatencyMs: ai.reactionLatencyMs,
      details: `${ai.botMessageIds.length} resposta(s)`,
    });

    const safeModeration = {
      deleteMessage: true,
      registerInfraction: false,
      banUser: false,
      maxInfractions: 999,
    };
    const marker = `qa-proibida-${Date.now()}`;
    await upsertGroupSettings(settingsId, {
      antilink: true,
      commandToggles: {
        ...originalSettings.commandToggles,
        botinterage: true,
        antilink: true,
        antipalavras: true,
        antimage: true,
      },
      featureFlags: { ...originalSettings.featureFlags, antipalavras: true },
      moderationActions: {
        ...originalSettings.moderationActions,
        antilink: safeModeration,
        antipalavras: safeModeration,
        antimage: safeModeration,
      },
      bannedWords: [...originalSettings.bannedWords, marker],
    });

    const link = await createAndProcess({
      userId: member.user_id,
      text: `https://bloqueado-${Date.now()}.invalid/caminho`,
    });
    const [linkRows] = await db.query<(RowDataPacket & { deleted_at: Date | null })[]>(
      "SELECT deleted_at FROM internal_group_messages WHERE id = ?",
      [link.messageId],
    );
    results.push({
      name: "proteção antilink",
      ok: Boolean(linkRows[0]?.deleted_at) && await botReplyContains(link.botMessageIds, "Links não são permitidos"),
    });

    const word = await createAndProcess({ userId: member.user_id, text: marker });
    const [wordRows] = await db.query<(RowDataPacket & { deleted_at: Date | null })[]>(
      "SELECT deleted_at FROM internal_group_messages WHERE id = ?",
      [word.messageId],
    );
    results.push({
      name: "proteção antipalavras",
      ok: Boolean(wordRows[0]?.deleted_at) && await botReplyContains(word.botMessageIds, "palavra proibida"),
    });

    const image = await createAndProcess({
      userId: member.user_id,
      messageType: "image",
      mediaPath: "https://example.invalid/qa-image.png",
    });
    const [imageRows] = await db.query<(RowDataPacket & { deleted_at: Date | null })[]>(
      "SELECT deleted_at FROM internal_group_messages WHERE id = ?",
      [image.messageId],
    );
    results.push({
      name: "proteção antimage",
      ok: Boolean(imageRows[0]?.deleted_at) && await botReplyContains(image.botMessageIds, "antimage"),
    });
  } finally {
    await upsertGroupSettings(settingsId, {
      antilink: originalSettings.antilink,
      commandToggles: originalSettings.commandToggles,
      featureFlags: originalSettings.featureFlags,
      moderationActions: originalSettings.moderationActions,
      bannedWords: originalSettings.bannedWords,
      allowedLinks: originalSettings.allowedLinks,
    });
    await db.query(
      "UPDATE internal_group_members SET role = ?, status = ? WHERE group_id = ? AND user_id = ?",
      [member.role, member.status, groupId, member.user_id],
    );
    const ids = [...createdMessageIds].filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length) {
      await db.query(
        `DELETE FROM internal_group_messages WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
    }
  }

  console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
  process.exit(results.every((result) => result.ok) ? 0 : 1);
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
