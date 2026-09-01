import type { RowDataPacket } from "mysql2";

import { getDb } from "../lib/db";

const main = async () => {
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT bg.id, bg.user_id AS userId, bg.instance_id AS instanceId,
             bg.remote_id AS remoteId, bg.name, bg.status,
             bi.session_status AS instanceStatus
      FROM bot_groups bg
      LEFT JOIN bot_instances bi ON bi.id = bg.instance_id
      WHERE bg.id = 1404
      LIMIT 1
    `,
  );
  console.log(JSON.stringify(rows[0] ?? null));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha ao consultar grupo");
  process.exitCode = 1;
});
