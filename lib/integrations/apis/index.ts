// Wrappers para consumir adapters CJS no ambiente ESM/TS.
import { createRequire } from 'module';

export const integrationRequire = createRequire(process.cwd() + '/');

// Wrappers dinâmicos (evitam carregar submódulos no import do index)
export async function ytSearch(query: string, limit?: number) {
  try {
    const adapter = integrationRequire('lib/integrations/apis/funcoes/api.js');
    if (adapter && typeof adapter.ytSearch === 'function') {
      const res = await adapter.ytSearch(query);
      return Array.isArray(res) ? res.slice(0, limit ?? 10) : Array.isArray(res?.videos) ? res.videos.slice(0, limit ?? 10) : res;
    }
  } catch {}
  const mod = await import('../../apis/yt');
  return mod.ytSearch(query, limit);
}

export async function ytPlayMp3(query: string) {
  const mod = await import('../../apis/yt');
  return mod.ytPlayMp3(query);
}

export async function ytPlayMp4(query: string) {
  const mod = await import('../../apis/yt');
  return mod.ytPlayMp4(query);
}
