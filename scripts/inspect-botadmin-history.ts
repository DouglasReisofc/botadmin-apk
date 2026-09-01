import type { RowDataPacket } from "mysql2";

import { getDb } from "/opt/botadmin/app/lib/db";

const main = async () => {
  const db = getDb();
  const [groups] = await db.query<RowDataPacket[]>(
    `SELECT id, user_id AS userId, instance_id AS instanceId, remote_id AS remoteId, name
       FROM bot_groups
      WHERE name LIKE '%Admin%' OR name LIKE '%Oficial%'
      ORDER BY updated_at DESC`,
  );
  const output = [];
  for (const group of groups) {
    const [messages] = await db.query<RowDataPacket[]>(
      `SELECT message_id AS messageId, direction, sender_jid AS senderJid,
              sender_name AS senderName, message_type AS messageType, text,
              LEFT(media_json, 1200) AS mediaJson, timestamp
         FROM bot_whatsapp_messages
        WHERE chat_jid = ? AND instance_id = ?
        ORDER BY timestamp DESC LIMIT 30`,
      [group.remoteid, group.instanceid],
    );
    const [contexts] = await db.query<RowDataPacket[]>(
      `SELECT id, role, sender_jid AS senderJid, whatsapp_message_id AS whatsappMessageId,
              content_type AS contentType, LEFT(content, 1800) AS content,
              LEFT(CAST(media_json AS CHAR), 1200) AS mediaJson, job_id AS jobId, created_at AS createdAt
         FROM botinterage_context_events
        WHERE group_id = ?
        ORDER BY created_at DESC LIMIT 30`,
      [group.id],
    );
    const [conversations] = await db.query<RowDataPacket[]>(
      `SELECT sender_jid AS senderJid, conversation_id AS conversationId,
              last_message_id AS lastMessageId, updated_at AS updatedAt
         FROM botinterage_system_conversations
        WHERE group_id = ?
        ORDER BY updated_at DESC LIMIT 20`,
      [group.id],
    );
    const [jobs] = await db.query<RowDataPacket[]>(
      `SELECT job_id AS jobId, sender_jid AS senderJid, prompt, status,
              delivered_message_id AS deliveredMessageId, last_error AS lastError,
              created_at AS createdAt, completed_at AS completedAt
         FROM botinterage_system_jobs
        WHERE group_id = ?
        ORDER BY created_at DESC LIMIT 20`,
      [group.id],
    );
    output.push({ group, messages, contexts, conversations, jobs });
  }
  console.log(JSON.stringify(output));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
