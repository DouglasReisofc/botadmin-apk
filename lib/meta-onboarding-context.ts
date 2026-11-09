import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb } from 'lib/db';

type MetaOnboardingContext = { userId: number; instanceId: number; expiresAt: number; native: boolean };
function secret() {
  const key = process.env.META_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('Chave de proteção da integração Meta ausente.');
  return key;
}
export function createMetaOnboardingContext(userId: number, instanceId: number, native: boolean) {
  const payload = Buffer.from(JSON.stringify({userId, instanceId, native, expiresAt: Date.now() + 30 * 60_000})).toString('base64url');
  const signature = createHmac('sha256', secret()).update('meta-onboarding:' + payload).digest('base64url');
  return payload + '.' + signature;
}
export function verifyMetaOnboardingContext(value: unknown): MetaOnboardingContext | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) return null;
    const expected = createHmac('sha256', secret()).update('meta-onboarding:' + payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(data.userId) || data.userId < 1 || !Number.isSafeInteger(data.instanceId) || data.instanceId < 1 || typeof data.native !== 'boolean' || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 30 * 60_000) return null;
    return data;
  } catch { return null; }
}
export async function resolveMetaOnboardingUser(context: MetaOnboardingContext) {
  const [rows] = await getDb().query<Array<{id: number; role: string}>>('SELECT id, role FROM users WHERE id = ? AND is_active = 1 LIMIT 1', [context.userId]);
  return rows[0] ? {id: Number(rows[0].id), role: rows[0].role} : null;
}
