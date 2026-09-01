import type { ResultSetHeader } from "mysql2";

import { getDb } from "../lib/db";

const main = async () => {
  const db = getDb();
  const [result] = await db.query<ResultSetHeader>(
    "DELETE FROM botinterage_system_conversations WHERE group_id = ? AND sender_jid IN (?, ?)",
    [1404, "botadmin-e2e-test", "botadmin-continuity-test"],
  );
  console.log(JSON.stringify({ ok: true, removedMappings: result.affectedRows }));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha na limpeza");
  process.exitCode = 1;
});
