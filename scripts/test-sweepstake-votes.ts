import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { extractSweepstakePollVote } from '../lib/bot-events/poll-vote';
import { normalizeJid } from '../lib/whatsapp';
import type { NormalizedMessage, NormalizedWebhookPayload } from '../lib/bot-events/types';

const join = createHash('sha256').update('Participar ✅').digest('hex');
const leave = createHash('sha256').update('Não participar ❌').digest('hex');
const phoneA = '5511999900001';
const phoneB = '5511999900002';
const botPhone = '5511999900003';

test('winner announcement has a real phone mention with both template syntaxes', () => {
  const { api } = persistenceHarness();
  const winner = { jid: `${phoneA}@s.whatsapp.net`, displayName: 'Pessoa Teste' };
  const draw = { question: 'Teste sem prêmio', participants: [winner], winnersCount: 1, maxParticipants: 10 };
  const announcement = api.buildSweepstakeAnnouncement(draw, [winner]);
  assert.ok(announcement.body.includes(`@${phoneA}`));
  assert.equal(announcement.mentions[0], winner.jid);
  for (const template of ['Parabéns {pushname}: {premio}', 'Parabéns {{pushname}}: {{premio}}', '{mencao} venceu']) {
    const rendered = api.renderSweepstakeWinnerMessage(template, winner, draw, 1);
    assert.ok(rendered.includes(`@${phoneA}`));
    assert.ok(!rendered.includes('{'));
    assert.ok(!rendered.includes('@s.whatsapp.net'));
  }
});

test('cleanup unpins and revokes, retries failures, and emits removal only after success', async () => {
  const calls: string[] = [];
  let deletes = 0;
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/sweepstake-poll-cleanup.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === './whatsapp') return { normalizeJid };
    if (name === './wuzapi') return {
      pinMessageInChat: async (_: unknown, key: any) => { assert.equal(key.pinned, false); calls.push('unpin'); },
      deleteMessageForEveryone: async (_: unknown, key: any) => { assert.equal(key.messageId, 'TEST'); assert.equal(key.participant, `${botPhone}@s.whatsapp.net`); calls.push('revoke'); if (++deletes === 1) throw new Error('temporary'); },
    };
    if (name === './whatsapp-conversations') return {
      deleteWhatsappConversationMessageForUser: async () => { calls.push('panel'); },
      recordWhatsappRealtimeEvent: async (event: any) => { assert.equal(event.payload.action, 'sweepstake.poll.removed'); return event; },
    };
    if (name === './whatsapp-realtime-bus') return { publishWhatsappRealtimeEvent: () => calls.push('event') };
    throw new Error(name);
  }});
  await exports.cleanupSweepstakePoll({}, { userId: 1, instanceId: 1, groupJid: 'test@g.us', pollMessageId: 'me:TEST', phone: botPhone });
  assert.deepEqual(calls, ['unpin', 'revoke', 'revoke', 'panel', 'event']);
});
const creatorLid = '243585429561559@lid';
const started = Date.parse('2026-09-28T23:00:00Z');

// Same EasyZap schema as the incident; test identities replace customer data.
function fixture(phone = phoneA, selected: string[] | undefined = [join], timestamp = started + 30000) {
  const raw = {
    eventType: 'message.received', schemaVersion: '2026-05-20',
    sender: { jid: `${phone}@s.whatsapp.net`, phone, name: 'Participante teste', lid: '269505188126937@lid' },
    pollUpdate: {
      pollCreationMessageKey: { id: 'TEST-POLL', participant: creatorLid },
      selectedOptions: selected as string[] | undefined, senderTimestampMS: timestamp,
    },
  };
  const message = {
    raw, senderJid: creatorLid, participant: creatorLid, timestamp: started / 1000,
  } as unknown as NormalizedMessage;
  const payload = { raw, data: raw, event: 'message.upsert', type: 'message.received' } as unknown as NormalizedWebhookPayload;
  return { raw, payload, message };
}

test('real envelope selects the voter, never the poll creator LID', () => {
  for (const phone of [phoneA, phoneB]) {
    const { payload, message } = fixture(phone);
    const vote = extractSweepstakePollVote(payload, message)!;
    assert.equal(vote.participantJid, phone);
    assert.equal(vote.participantIsLid, false);
    assert.equal(vote.displayName, 'Participante teste');
    assert.deepEqual(vote.selectedOptionHashes, [join]);
    assert.equal(vote.timestamp?.getTime(), started + 30000);
  }
});

test('encrypted selections are not mistaken for vote withdrawals', () => {
  const { payload, message, raw } = fixture();
  raw.pollUpdate.selectedOptions = undefined;
  assert.equal(extractSweepstakePollVote(payload, message), null);
  raw.pollUpdate.selectedOptions = [];
  assert.deepEqual(extractSweepstakePollVote(payload, message)?.selectedOptionHashes, []);
});

test('a poll creation key alone cannot register the creator as a voter', () => {
  const { payload, message, raw } = fixture();
  (raw as Record<string, unknown>).sender = undefined;
  message.senderJid = null;
  message.participant = null;
  assert.equal(extractSweepstakePollVote(payload, message), null);
});

test('legacy uppercase envelopes still preserve a genuine voter LID for resolution', () => {
  const payload = { data: {
    Info: { Sender: '269505188126937@lid', PushName: 'Teste' },
    Message: { PollUpdateMessage: { PollCreationMessageKey: { ID: 'TEST-POLL', Participant: creatorLid },
      SelectedOptions: [join], SenderTimestampMS: started + 30000 } },
  }, raw: {} } as unknown as NormalizedWebhookPayload;
  const message = { raw: {}, senderJid: null, participant: null } as NormalizedMessage;
  const vote = extractSweepstakePollVote(payload, message)!;
  assert.equal(vote.participantJid, '269505188126937');
  assert.equal(vote.participantIsLid, true);
});

// Execute the actual persistence module with an isolated transactional store.
// No production DB, WhatsApp messages or timers are touched by these tests.
function persistenceHarness() {
  const row: Record<string, any> = {
    id: 1, instance_id: 1, group_jid: 'TEST@g.us', poll_id: 'TEST-POLL', poll_message_id: 'TEST-POLL',
    question: 'Teste sem prêmio', join_option_hash: join,
    options: [{ hash: join, name: 'Participar ✅' }, { hash: leave, name: 'Não participar ❌' }],
    participants: [], winners: [], max_participants: 100, winners_count: 1,
    status: 'active', created_at: new Date(started), updated_at: new Date(started),
    expires_at: new Date(started + 120000), metadata: null,
  };
  let queue = Promise.resolve();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const db = {
    async getConnection() {
      let unlock: (() => void) | undefined;
      return {
        async beginTransaction() {},
        async query(sql: string, params: any[]) {
          if (sql.includes('FOR UPDATE')) {
            const previous = queue;
            queue = new Promise<void>(resolve => { unlock = resolve; });
            await previous;
            return [row.status === 'active' ? [clone(row)] : [], []];
          }
          if (sql.includes('SELECT phone')) return [[{ phone: botPhone }], []];
          if (sql.includes('UPDATE bot_sweepstakes')) {
            row.participants = JSON.parse(params[0]);
            row.metadata = JSON.parse(params[1]);
            return [{ affectedRows: 1 }, []];
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        async commit() { unlock?.(); unlock = undefined; },
        async rollback() { unlock?.(); unlock = undefined; },
        release() { unlock?.(); },
      };
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../lib/bot-sweepstakes.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  vm.runInNewContext(code, { exports, Date, console, require: (name: string) => {
    if (name === 'lib/db') return { getDb: () => db, ensureBotSweepstakesTable: async () => {} };
    if (name === './whatsapp') return { normalizeJid };
    return require(name);
  }});
  return { row, api: exports, stale: { id: 1, instanceId: 1, participants: [] } };
}

test('two concurrent real-envelope votes survive stale snapshots, withdrawal and replay', async () => {
  const { row, api, stale } = persistenceHarness();
  const votes = [phoneA, phoneB].map(phone => {
    const { payload, message } = fixture(phone);
    const vote = extractSweepstakePollVote(payload, message)!;
    return { ...vote, participantJid: `${vote.participantJid}@s.whatsapp.net` };
  });
  await Promise.all(votes.map(vote => api.recordSweepstakeVote(stale, vote)));
  assert.equal(row.participants.length, 2);
  assert.equal(new Set(row.participants.map((p: any) => p.jid)).size, 2);
  await api.recordSweepstakeVote(stale, { ...votes[0], selectedOptionHashes: [], timestamp: new Date(started + 50000) });
  assert.equal(row.participants.length, 1);
  const replay = await api.recordSweepstakeVote(stale, votes[0]);
  assert.equal(replay.accepted, false);
  assert.equal(row.participants.length, 1);
  const winners = api.pickSweepstakeWinners(row.participants, 1);
  assert.equal(winners[0].jid, `${phoneB}@s.whatsapp.net`);
});

test('bot, unresolved LID, late vote and completed draw cannot gain participants', async () => {
  const { row, api, stale } = persistenceHarness();
  for (const participantJid of [`${botPhone}@s.whatsapp.net`, creatorLid]) {
    const result = await api.recordSweepstakeVote(stale, { participantJid, selectedOptionHashes: [join], timestamp: new Date(started + 10000) });
    assert.equal(result.accepted, false);
  }
  await api.recordSweepstakeVote(stale, { participantJid: `${phoneA}@s.whatsapp.net`, selectedOptionHashes: [join], timestamp: new Date(started + 121000) });
  assert.equal(row.participants.length, 0);
  row.status = 'completed';
  await api.recordSweepstakeVote(stale, { participantJid: `${phoneA}@s.whatsapp.net`, selectedOptionHashes: [join], timestamp: new Date(started + 10000) });
  assert.equal(row.participants.length, 0);
});
