import crypto from "crypto";

import bcrypt from "bcryptjs";

import { getDb } from "lib/db";
const ownerEmail = "d.edits.influencer@gmail.com";
const mainGroupName = "grupo de teste botadmin";
const baseUrl = (process.env.STRESS_BASE_URL ?? "https://botadmin.shop").replace(/\/$/, "");
// 1 proprietário real + 1.499 participantes sintéticos = 1.500 ativos.
const participantCount = 1_499;
const auxiliaryGroupCount = 6;
const batchSize = Math.max(8, Math.min(100, Number(process.env.STRESS_BATCH ?? 40) || 40));

type User = { id: number; name: string; email: string };
type Group = { id: number; name: string; owner_user_id: number };
type Phase = { name: string; count: number; concurrency: number; pauseMs: number };

const phases: Phase[] = [
  { name: "aquecimento-http", count: 500, concurrency: 20, pauseMs: 700 },
  { name: "pico-http", count: 2_500, concurrency: 60, pauseMs: 600 },
  { name: "sustentacao-multigrupo", count: 4_000, concurrency: 40, pauseMs: 900 },
];

const textTemplates = [
  "Alguém viu a atualização do grupo?",
  "Estou acompanhando o teste em tempo real.",
  "Aqui a conversa chegou sem precisar recarregar.",
  "Confirmando que o histórico continua navegável.",
  "A lista está recebendo mensagens de vários participantes.",
  "Teste de grupo grande do BotAdmin em andamento.",
  "Essa mensagem está passando pelo endpoint HTTP real.",
  "Vou responder outra mensagem enquanto o pico acontece.",
  "O chat segue atualizando mesmo com outros grupos ativos.",
  "Validando persistência, ordenação e realtime.",
  "Mais um participante entrando na conversa simulada.",
  "A carga continua controlada nesta fase.",
];
const emojis = ["👍", "❤️", "😂", "🔥", "👏", "✅"];

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const percentile = (values: number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

const queryRows = async <T>(sql: string, params: unknown[] = []) => {
  const [rows] = await getDb().query<T[]>(sql, params);
  return rows;
};

const chunked = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const bulkMembership = async (groupId: number, users: User[]) => {
  for (const chunk of chunked(users, 150)) {
    const values: unknown[] = [];
    const placeholders = chunk
      .map((user) => {
        values.push(groupId, user.id, "member", "active");
        return "(?, ?, ?, ?)";
      })
      .join(",");
    await getDb().query(
      `INSERT INTO internal_group_members (group_id, user_id, role, status)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      values,
    );
  }
};

const main = async () => {
  const db = getDb();
  const owners = await queryRows<User>(
    "SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
    [ownerEmail],
  );
  if (!owners[0]) throw new Error(`Conta alvo não encontrada: ${ownerEmail}`);

  const mainGroups = await queryRows<Group>(
    `SELECT id, name, owner_user_id FROM internal_groups
      WHERE owner_user_id = ? AND LOWER(name) = LOWER(?) AND is_active = 1
      ORDER BY id DESC LIMIT 1`,
    [owners[0].id, mainGroupName],
  );
  if (!mainGroups[0]) throw new Error(`Grupo alvo não encontrado: ${mainGroupName}`);
  const mainGroupId = Number(mainGroups[0].id);

  const password = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  for (const chunk of Array.from({ length: Math.ceil(participantCount / 100) }, (_, index) => {
    const start = index * 100 + 1;
    const end = Math.min(participantCount, start + 99);
    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  })) {
    const values: unknown[] = [];
    const placeholders = chunk
      .map((number) => {
        const suffix = String(number).padStart(4, "0");
        values.push(
          `Participante extremo ${suffix}`,
          `extreme.${suffix}@botadmin.test`,
          password,
          "user",
          1,
          0,
          0,
          0,
        );
        return "(?, ?, ?, ?, ?, ?, ?, ?)";
      })
      .join(",");
    await db.query(
      `INSERT INTO users
        (name, email, password, role, is_active, balance,
         needs_credentials_completion, password_missing)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      values,
    );
  }

  const participants = await queryRows<User>(
    `SELECT id, name, email FROM users
      WHERE email LIKE 'extreme.%@botadmin.test'
      ORDER BY email LIMIT ?`,
    [participantCount],
  );
  if (participants.length !== participantCount) {
    throw new Error(`Participantes preparados: ${participants.length}/${participantCount}`);
  }
  await db.query(
    `UPDATE internal_group_members
        SET status = 'removed', updated_at = NOW()
      WHERE group_id = ?
        AND user_id IN (
          SELECT id FROM users
           WHERE email LIKE 'loadtest.%@botadmin.test'
              OR (email LIKE 'extreme.%@botadmin.test' AND email NOT LIKE 'extreme.owner.%@botadmin.test')
        )`,
    [mainGroupId],
  );
  await bulkMembership(mainGroupId, participants);
  await db.query(
    `UPDATE internal_groups SET is_active = 1, admins_only = 0, updated_at = NOW() WHERE id = ?`,
    [mainGroupId],
  );

  const auxiliaryGroups: Group[] = [];
  for (let index = 1; index <= auxiliaryGroupCount; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const ownerEmailForLoad = `extreme.owner.${suffix}@botadmin.test`;
    await db.query(
      `INSERT INTO users
        (name, email, password, role, is_active, balance,
         needs_credentials_completion, password_missing)
       VALUES (?, ?, ?, 'user', 1, 0, 0, 0)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      [`Dono auxiliar extremo ${suffix}`, ownerEmailForLoad, password],
    );
    const ownerRows = await queryRows<User>(
      "SELECT id, name, email FROM users WHERE email = ? LIMIT 1",
      [ownerEmailForLoad],
    );
    const auxiliaryOwner = ownerRows[0];
    if (!auxiliaryOwner) throw new Error(`Dono auxiliar ausente: ${ownerEmailForLoad}`);
    const inviteHash = crypto
      .createHash("sha256")
      .update(crypto.randomBytes(32))
      .digest("hex");
    const result = await db.query<{ insertId?: number }>(
      `INSERT INTO internal_groups
        (owner_user_id, name, description, invite_token_hash, is_active, admins_only)
       VALUES (?, ?, ?, ?, 1, 0)`,
      [
        auxiliaryOwner.id,
        `[CARGA] grupo auxiliar ${suffix}`,
        "Grupo sintético usado apenas no teste extremo de capacidade.",
        inviteHash,
      ],
    );
    const groupId = Number((result[0] as { insertId?: number }).insertId ?? 0);
    if (!groupId) {
      const rows = await queryRows<Group>(
        "SELECT id, name, owner_user_id FROM internal_groups WHERE owner_user_id = ? AND name = ? ORDER BY id DESC LIMIT 1",
        [auxiliaryOwner.id, `[CARGA] grupo auxiliar ${suffix}`],
      );
      if (!rows[0]) throw new Error(`Grupo auxiliar não criado: ${suffix}`);
      auxiliaryGroups.push(rows[0]);
    } else {
      auxiliaryGroups.push({
        id: groupId,
        name: `[CARGA] grupo auxiliar ${suffix}`,
        owner_user_id: auxiliaryOwner.id,
      });
    }
  }
  for (const auxiliary of auxiliaryGroups) {
    const ownerRows = await queryRows<User>(
      "SELECT id, name, email FROM users WHERE id = ? LIMIT 1",
      [auxiliary.owner_user_id],
    );
    if (ownerRows[0]) {
      await db.query(
        `INSERT INTO internal_group_members (group_id, user_id, role, status)
         VALUES (?, ?, 'owner', 'active')
         ON DUPLICATE KEY UPDATE role = 'owner', status = 'active', updated_at = NOW()`,
        [auxiliary.id, ownerRows[0].id],
      );
    }
    await bulkMembership(auxiliary.id, participants);
  }

  const sessionByUser = new Map<number, string>();
  const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  for (const chunk of chunked(participants, 150)) {
    const values: unknown[] = [];
    const placeholders = chunk
      .map((user) => {
        const sessionId = crypto.randomUUID();
        sessionByUser.set(user.id, sessionId);
        values.push(sessionId, user.id, sessionExpiresAt, null, null);
        return "(?, ?, ?, ?, ?)";
      })
      .join(",");
    await db.query(
      `INSERT INTO sessions
        (id, user_id, expires_at, impersonated_by_user_id, impersonated_from_session_id)
       VALUES ${placeholders}`,
      values,
    );
  }
  const groupIds = [mainGroupId, ...auxiliaryGroups.map((group) => Number(group.id))];
  const groupRecentIds = new Map<number, number[]>();
  const latencies: number[] = [];
  const errors: Array<{ groupId: number; status: number; error: string }> = [];
  let sent = 0;
  let reactions = 0;
  let replies = 0;
  let requestSequence = 0;
  const startedAt = Date.now();

  const sendOne = async (phase: string) => {
    const participant = participants[requestSequence % participants.length];
    const sequence = requestSequence++;
    const groupId = sequence % 10 < 7
      ? mainGroupId
      : groupIds[1 + (sequence % auxiliaryGroups.length)];
    const recent = groupRecentIds.get(groupId) ?? [];
    const replyTo = sequence % 11 === 0 && recent.length
      ? recent[(sequence * 5) % recent.length]
      : null;
    const text = `${textTemplates[sequence % textTemplates.length]} · ${phase} #${sequence}`;
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/internal-groups/${groupId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `sb_session=${sessionByUser.get(participant.id)}`,
        },
        body: JSON.stringify({ text, replyToMessageId: replyTo }),
        signal: AbortSignal.timeout(12_000),
      });
      const payload = await response.json().catch(() => ({}));
      const elapsed = performance.now() - started;
      latencies.push(elapsed);
      if (!response.ok || !payload?.message?.id) {
        errors.push({
          groupId,
          status: response.status,
          error: JSON.stringify(payload).slice(0, 240),
        });
        return;
      }
      const messageId = Number(payload.message.id);
      recent.push(messageId);
      if (recent.length > 100) recent.shift();
      groupRecentIds.set(groupId, recent);
      sent += 1;
      if (replyTo) replies += 1;

      if (sequence % 10 === 0) {
        const reactor = participants[(sequence + 17) % participants.length];
        const reactionResponse = await fetch(
          `${baseUrl}/api/internal-groups/${groupId}/messages/${messageId}/actions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: `sb_session=${sessionByUser.get(reactor.id)}`,
            },
            body: JSON.stringify({ action: "react", emoji: emojis[sequence % emojis.length] }),
            signal: AbortSignal.timeout(12_000),
          },
        );
        if (reactionResponse.ok) reactions += 1;
        else errors.push({ groupId, status: reactionResponse.status, error: "reaction" });
      }
    } catch (error) {
      errors.push({
        groupId,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  console.log(JSON.stringify({
    event: "ready",
    mainGroupId,
    auxiliaryGroups: groupIds.slice(1),
    participants: participants.length,
    activeMembersInMainGroup: participantCount + 1,
    plannedRequests: phases.reduce((total, phase) => total + phase.count, 0),
    endpoint: `${baseUrl}/api/internal-groups/{groupId}/messages`,
  }));

  try {
    for (const phase of phases) {
      console.log(JSON.stringify({ event: "phase.started", phase: phase.name }));
      let phaseSent = 0;
      while (phaseSent < phase.count) {
        const count = Math.min(phase.concurrency, phase.count - phaseSent);
        await Promise.all(Array.from({ length: count }, () => sendOne(phase.name)));
        phaseSent += count;
        const errorRate = errors.length / Math.max(1, requestSequence);
        const p95 = percentile(latencies, 0.95);
        console.log(JSON.stringify({
          event: "progress",
          phase: phase.name,
          requests: requestSequence,
          sent,
          errors: errors.length,
          errorRate: Number(errorRate.toFixed(4)),
          p95Ms: Math.round(p95),
        }));
        if (errorRate > 0.01 || p95 > 2_000) {
          throw new Error(
            `Carga abortada por limite de segurança: errorRate=${errorRate.toFixed(4)} p95=${Math.round(p95)}ms`,
          );
        }
        await sleep(phase.pauseMs);
      }
      console.log(JSON.stringify({ event: "phase.completed", phase: phase.name, sent }));
    }
    const summary = {
      event: "completed",
      mainGroupId,
      auxiliaryGroups: groupIds.slice(1),
      participants: participants.length,
      requests: requestSequence,
      sent,
      replies,
      reactions,
      errors: errors.length,
      sampleErrors: errors.slice(0, 5),
      elapsedMs: Date.now() - startedAt,
      throughputPerSecond: Number((sent / Math.max(1, (Date.now() - startedAt) / 1000)).toFixed(2)),
      latencyMs: {
        p50: Math.round(percentile(latencies, 0.5)),
        p95: Math.round(percentile(latencies, 0.95)),
        p99: Math.round(percentile(latencies, 0.99)),
        max: Math.round(Math.max(0, ...latencies)),
      },
    };
    console.log(JSON.stringify(summary));
  } finally {
    for (const chunk of chunked([...sessionByUser.values()], 300)) {
      await db
        .query("UPDATE sessions SET revoked_at = NOW() WHERE id IN (?)", [chunk])
        .catch(() => undefined);
    }
  }
};

main().catch((error) => {
  console.error(JSON.stringify({
    event: "fatal",
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }));
  process.exitCode = 1;
});
