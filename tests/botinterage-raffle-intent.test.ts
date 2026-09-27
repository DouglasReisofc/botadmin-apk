import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudioRaffleRequest } from '../lib/botinterage-raffle-intent';

test('actual audio transcripts create the same raffle request', () => {
  const now = Date.parse('2026-09-27T06:00:00Z');
  for (const amount of ['50', 'cinquenta']) {
    const request = parseAudioRaffleRequest(`Cria para mim um sorteio de ${amount} reais no Pix com um ganhador daqui a um minuto o sorteio acaba, ok?`, now);
    assert(request && !request.missing);
    assert.equal(request.prize, 'R$ 50,00 no Pix');
    assert.equal(request.winnersCount, 1);
    assert.equal(request.endsAt, '2026-09-27T06:01:00.000Z');
    assert.equal(request.mentionAll, false);
  }
});

test('do not create from a question or incomplete fields', () => {
  assert.equal(parseAudioRaffleRequest('Qual é o resultado do sorteio?'), null);
  assert.deepEqual(parseAudioRaffleRequest('Crie um sorteio'), { missing: true });
});

test('honor an explicit request to mention everyone', () => {
  const request = parseAudioRaffleRequest('Crie sorteio de 50 reais com 2 ganhadores em dez minutos e mencione todos');
  assert(request && !request.missing);
  assert.equal(request.mentionAll, true);
  assert.equal(request.winnersCount, 2);
});
