import type { RowDataPacket } from "mysql2";
import { getDb } from "/opt/botadmin/app/lib/db";

const main = async () => {
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT message_id AS messageId, direction, sender_jid AS senderJid,
            message_type AS messageType, text, media_json AS mediaJson,
            raw_json AS rawJson, timestamp
       FROM bot_whatsapp_messages
      WHERE instance_id = 266 AND chat_jid = '120363406245712972@g.us'
      ORDER BY timestamp DESC LIMIT 15`,
  );
  console.log(JSON.stringify(rows));
};
main().catch((error) => { console.error(error); process.exitCode = 1; });
