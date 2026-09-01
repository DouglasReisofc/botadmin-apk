import crypto from "crypto";

import bcrypt from "bcryptjs";

import { getDb } from "lib/db";
import {
  createInternalGroup,
  createInternalGroupMessage,
  runInternalGroupMessageAction,
} from "lib/internal-groups";
import { emitInternalGroupEvent } from "lib/internal-group-realtime";

const targetEmail = (
  process.env.STRESS_OWNER_EMAIL ?? "d.edits.influencer@gmail.com"
)
  .trim()
  .toLowerCase();
const targetGroupName = (
  process.env.STRESS_GROUP_NAME ?? "grupo de teste botadmin"
).trim();
const participantCount = Math.max(
  4,
  Math.min(60, Number(process.env.STRESS_PARTICIPANTS ?? 24) || 24),
);

type UserRow = { id: number; name: string; email: string };
type GroupRow = { id: number; name: string; owner_user_id: number };
type Phase = { name: string; count: number; batch: number; pauseMs: number };

const phases: Phase[] = [
  { name: "aquecimento", count: 80, batch: 2, pauseMs: 800 },
  { name: "pico", count: 240, batch: 12, pauseMs: 350 },
  { name: "sustentacao", count: 320, batch: 5, pauseMs: 1_100 },
];

const messages = [
  "Alguém conseguiu abrir as configurações do grupo agora?",
  "Aqui carregou rápido e a conversa atualizou na hora.",
  "Estou testando uma resposta enquanto outras mensagens chegam.",
  "O áudio apareceu certinho para vocês?",
  "Vou reagir nessa mensagem para validar o realtime.",
  "No meu celular a lista continua fluida durante o teste.",
  "Teste de conversa simultânea do grupo BotAdmin.",
  "Mais alguém está acompanhando o contador de mensagens?",
  "Acabei de voltar para o chat e o histórico permaneceu aqui.",
  "Enviando uma mensagem curta no meio do pico.",
  "Essa mensagem deve chegar sem atualizar a página.",
  "Respondendo pelo fluxo interno, sem passar pelo WhatsApp.",
  "O grupo continua recebendo as conversas normalmente.",
  "Validando nomes, horários, respostas e reações.",
  "Chegou instantâneo aqui, seguindo com o teste.",
  "Última verificação desta sequência de usuários simultâneos.",
];
const emojis = ["👍", "❤️", "😂", "🔥", "👏", "✅"];

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const percentile = (values: number[], ratio: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

const main = async () => {
  const db = getDb();
  const [ownerRows] = await db.query<UserRow[]>(
    "SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
    [targetEmail],
  );
  const owner = ownerRows?.[0];
  if (!owner) throw new Error(`Conta não encontrada: ${targetEmail}`);

  const [existingGroups] = await db.query<GroupRow[]>(
    `SELECT id, name, owner_user_id
       FROM internal_groups
      WHERE owner_user_id = ? AND LOWER(name) = LOWER(?) AND is_active = 1
      ORDER BY id DESC LIMIT 1`,
    [owner.id, targetGroupName],
  );
  let groupId = Number(existingGroups?.[0]?.id ?? 0);
  if (!groupId) {
    const created = await createInternalGroup(owner.id, {
      name: targetGroupName,
      description:
        "Grupo isolado para validação de carga, realtime e conversas BotAdmin.",
    });
    groupId = Number(created.group.id);
  }

  await db.query(
    `UPDATE internal_groups
        SET name = ?, description = ?, is_active = 1, admins_only = 0,
            updated_at = NOW()
      WHERE id = ?`,
    [
      targetGroupName,
      "Teste controlado de carga e conversas em tempo real do BotAdmin.",
      groupId,
    ],
  );

  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  for (let index = 1; index <= participantCount; index += 1) {
    const suffix = String(index).padStart(2, "0");
    await db.query(
      `INSERT INTO users
        (name, email, password, role, is_active, balance,
         needs_credentials_completion, password_missing)
       VALUES (?, ?, ?, 'user', 1, 0, 0, 0)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      [`Participante teste ${suffix}`, `loadtest.${suffix}@botadmin.test`, passwordHash],
    );
  }

  const [participants] = await db.query<UserRow[]>(
    `SELECT id, name, email FROM users
      WHERE email LIKE 'loadtest.%@botadmin.test'
      ORDER BY email LIMIT ?`,
    [participantCount],
  );
  if (participants.length < participantCount) {
    throw new Error(
      `Somente ${participants.length}/${participantCount} participantes foram preparados.`,
    );
  }

  for (const participant of participants) {
    await db.query(
      `INSERT INTO internal_group_members (group_id, user_id, role, status)
       VALUES (?, ?, 'member', 'active')
       ON DUPLICATE KEY UPDATE role = 'member', status = 'active', updated_at = NOW()`,
      [groupId, participant.id],
    );
    emitInternalGroupEvent({
      groupId,
      actorUserId: participant.id,
      type: "member.updated",
    });
  }

  emitInternalGroupEvent({
    groupId,
    actorUserId: owner.id,
    type: "group.updated",
  });

  console.log(
    JSON.stringify({
      event: "ready",
      groupId,
      groupName: targetGroupName,
      owner: owner.email,
      participants: participants.length,
      plannedMessages: phases.reduce((total, phase) => total + phase.count, 0),
    }),
  );

  const latencies: number[] = [];
  const errors: Array<{ sequence: number; error: string }> = [];
  const recentMessageIds: number[] = [];
  let sent = 0;
  let reactions = 0;
  let replies = 0;

  const sendOne = async (sequence: number, phase: string) => {
    const participant = participants[sequence % participants.length];
    const replyTo = sequence % 7 === 0 && recentMessageIds.length > 0
      ? recentMessageIds[(sequence * 3) % recentMessageIds.length]
      : null;
    const body = `${messages[sequence % messages.length]} · ${phase} #${sequence}`;
    const startedAt = performance.now();
    try {
      const result = await createInternalGroupMessage(groupId, participant.id, {
        text: body,
        replyToMessageId: replyTo,
      });
      const messageId = Number(result.message.id);
      latencies.push(performance.now() - startedAt);
      recentMessageIds.push(messageId);
      if (recentMessageIds.length > 80) recentMessageIds.shift();
      sent += 1;
      if (replyTo) replies += 1;
      emitInternalGroupEvent({
        groupId,
        actorUserId: participant.id,
        type: "message.created",
        messageId,
      });

      if (sequence % 4 === 0) {
        const reactor = participants[(sequence + 5) % participants.length];
        await runInternalGroupMessageAction(
          groupId,
          messageId,
          reactor.id,
          "react",
          { emoji: emojis[sequence % emojis.length] },
        );
        reactions += 1;
        emitInternalGroupEvent({
          groupId,
          actorUserId: reactor.id,
          type: "message.created",
          messageId,
        });
      }
    } catch (error) {
      errors.push({
        sequence,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  let sequence = 1;
  const testStartedAt = Date.now();
  for (const phase of phases) {
    console.log(JSON.stringify({ event: "phase.started", phase: phase.name }));
    let phaseSent = 0;
    while (phaseSent < phase.count) {
      const size = Math.min(phase.batch, phase.count - phaseSent);
      await Promise.all(
        Array.from({ length: size }, (_, offset) =>
          sendOne(sequence + offset, phase.name),
        ),
      );
      sequence += size;
      phaseSent += size;
      if (sent % 50 < size) {
        console.log(
          JSON.stringify({
            event: "progress",
            phase: phase.name,
            sent,
            errors: errors.length,
            p95Ms: Math.round(percentile(latencies, 0.95)),
          }),
        );
      }
      await sleep(phase.pauseMs);
    }
    console.log(
      JSON.stringify({ event: "phase.completed", phase: phase.name, sent }),
    );
    await sleep(1_500);
  }

  const elapsedMs = Date.now() - testStartedAt;
  const [messageCountRows] = await db.query<Array<{ total: number }>>(
    "SELECT COUNT(*) AS total FROM internal_group_messages WHERE group_id = ?",
    [groupId],
  );
  const summary = {
    event: "completed",
    groupId,
    participants: participants.length,
    sent,
    replies,
    reactions,
    errors: errors.length,
    sampleErrors: errors.slice(0, 5),
    elapsedMs,
    throughputPerSecond: Number((sent / (elapsedMs / 1000)).toFixed(2)),
    latencyMs: {
      p50: Math.round(percentile(latencies, 0.5)),
      p95: Math.round(percentile(latencies, 0.95)),
      p99: Math.round(percentile(latencies, 0.99)),
      max: Math.round(Math.max(0, ...latencies)),
    },
    messagesPersisted: Number(messageCountRows?.[0]?.total ?? 0),
  };
  console.log(JSON.stringify(summary));
  if (errors.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "fatal",
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
