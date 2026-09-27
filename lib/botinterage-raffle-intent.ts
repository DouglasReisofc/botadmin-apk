/** Extract only explicitly supplied raffle fields; never invent a deadline or prize. */
export function parseAudioRaffleRequest(text: string, now = Date.now(), allowContinuation = false) {
  const explicit = /\b(?:cria|crie|criar|faz|faça|fazer|monta|monte|organiza|organize)\b/i.test(text) && /\bsorteio\b/i.test(text);
  const continuation = allowContinuation && /(?:\bcentavos?\b|\breais?\b|\bno\s+pix\b)/i.test(text) && /\bganhador(?:es)?\b/i.test(text);
  if (!explicit && !continuation) return null;
  const numbers: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
    quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
    sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100,
  };
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const numeric = '(?:\\d+(?:[.,]\\d+)?|' + Object.keys(numbers).join('|') + ')';
  const value = (raw: string) => numbers[raw] ?? Number(raw.replace(',', '.'));
  const money = normalized.match(new RegExp('(?:r\\$\\s*)?(' + numeric + ')\\s*(?:reais?\\b|no\\s+pix\\b|centavos?\\b)'));
  const winners = normalized.match(new RegExp('(' + numeric + ')\\s+ganhador(?:es)?\\b'));
  const duration = normalized.match(new RegExp('(?:(?:daqui\\s+a|em|duracao\\s+de)\\s+)?(' + numeric + ')\\s*(minutos?|horas?|segundos?)\\b'));
  if (!money || !winners || !duration) return { missing: true as const };
  const amount = value(money[1]) / (/centavo/.test(money[0]) ? 100 : 1);
  const winnersCount = value(winners[1]);
  const milliseconds = value(duration[1]) * (duration[2].startsWith('hora') ? 3_600_000 : duration[2].startsWith('segundo') ? 1000 : 60_000);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > 50 || milliseconds < 30_000 || milliseconds > 7 * 86_400_000) return { missing: true as const };
  return {
    missing: false as const,
    prize: `R$ ${amount.toFixed(2).replace('.', ',')}${/pix/.test(normalized) ? ' no Pix' : ''}`,
    winnersCount,
    endsAt: new Date(now + milliseconds).toISOString(),
    mentionAll: /(?:menciona|mencione|chama|chame|marca|marque|avisa|avise).{0,30}(?:todos|geral)|@todos/.test(normalized),
  };
}
