import type { RowDataPacket } from "mysql2";

import { getDb } from "../lib/db";

const main = async () => {
  const jobId = process.argv[2];
  if (!jobId) throw new Error("Informe o job_id");
  const db = getDb();
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT job_id AS jobId, status, delivered_message_id AS deliveredMessageId,
             last_error AS lastError, completed_at AS completedAt
      FROM botinterage_system_jobs
      WHERE job_id = ?
      LIMIT 1
    `,
    [jobId],
  );
  console.log(JSON.stringify(rows[0] ?? null));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha ao consultar job");
  process.exitCode = 1;
});
