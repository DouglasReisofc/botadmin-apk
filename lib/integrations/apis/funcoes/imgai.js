// imgai.js — Wrapper para a Space Heartsync/NSFW-Uncensored-image (Gradio Queue)
// CommonJS; Node 18+; depende de `eventsource`
const ES = require('eventsource');
const EventSource = ES?.EventSource || ES?.default || ES;
if (typeof EventSource !== 'function') {
  throw new Error('Falha ao carregar EventSource. Instale `npm i eventsource`.');
}

const fs = require('node:fs');
const path = require('node:path');

const PROXY_FILE = path.join(__dirname, '../imageai3_proxies.txt');

function loadProxies() {
  try {
    return fs.readFileSync(PROXY_FILE, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
  } catch {
    return [];
  }
}

function pickProxy() {
  const list = loadProxies();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

const BASE = 'https://heartsync-nsfw-uncensored-image.hf.space';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildHeaders(ua) {
  return {
    Origin: BASE,
    Referer: `${BASE}/?not-for-all-audiences=true&__theme=system&cb=${Date.now()}`,
    'user-agent': ua || randomUserAgent(),
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  };
}

function makeSessionHash() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 11; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, opts = {}) {
  const bust = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${bust}cb=${Date.now()}`, { cache: 'no-store', ...opts });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${url}: ${txt}`);
  }
  return res.json();
}

function openSSE(sessionHash, proxy, headers) {
  const url = `${BASE}/gradio_api/queue/data?session_hash=${sessionHash}&cb=${Date.now()}`;
  const h = { ...headers, Accept: 'text/event-stream' };
  const opts = { headers: h };
  if (proxy) opts.proxy = proxy;
  return new EventSource(url, opts);
}

async function enqueue({ sessionHash, fn_index, data, trigger_id = 16, headers }) {
  const url = `${BASE}/gradio_api/queue/join?not-for-all-audiences=true&__theme=system&cb=${Date.now()}`;
  const body = {
    data,
    event_data: null,
    fn_index,
    trigger_id,
    session_hash: sessionHash,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`enqueue failed ${res.status}: ${txt}`);
  }
  const json = await res.json().catch(() => ({}));
  return json?.event_id ?? null;
}

function waitForResultOn(es, targetEventId, { debug = false, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (v, isErr) => {
      if (done) return;
      done = true;
      try { es.close(); } catch {}
      isErr ? reject(v) : resolve(v);
    };
    const timer = setTimeout(() => finish(new Error('timeout aguardando SSE'), true), timeoutMs);

    es.onmessage = (evt) => {
      if (!evt?.data) return;
      if (evt.data === 'PING') return;
      let msg; try { msg = JSON.parse(evt.data); } catch { return; }
      const eid = msg?.event_id || msg?.output?.event_id;
      if (debug) console.log('[SSE]', msg?.msg, 'eid=', eid);

      if (targetEventId && eid && eid !== targetEventId) return;

      if (msg?.msg === 'process_completed') {
        clearTimeout(timer);
        const out = msg?.output || msg;
        out.event_id = eid || out.event_id || targetEventId;
        finish(out, false);
      } else if (msg?.msg === 'queue_full' || msg?.msg === 'error') {
        clearTimeout(timer);
        finish(new Error(msg?.queue_full || msg?.error || 'queue/error'), true);
      }
    };

    es.onerror = (err) => { clearTimeout(timer); finish(err || new Error('SSE error'), true); };
  });
}

function extractImageUrls(output) {
  const urls = [];
  const data = output?.data || [];

  for (const item of data) {
    if (!item) continue;

    if (typeof item === 'string') {
      const s = item;
      if (s.startsWith('data:image/')) urls.push(s);
      else if (/^https?:\/\//i.test(s)) urls.push(s);
      else if (s.includes('/file=') || s.includes('/proxy=')) {
        urls.push(`${BASE}${s.startsWith('/') ? '' : '/'}${s}`);
      }
      continue;
    }

    if (typeof item === 'object') {
      if (item.url) {
        urls.push(item.url);
      } else if (item.path) {
        urls.push(`${BASE}/gradio_api/file=${item.path}`);
      } else {
        for (const k of Object.keys(item)) {
          const v = item[k];
          if (typeof v === 'string') {
            if (v.startsWith('data:image/')) urls.push(v);
            else if (/^https?:\/\//i.test(v)) urls.push(v);
            else if (v.includes('/file=') || v.includes('/proxy=')) {
              urls.push(`${BASE}${v.startsWith('/') ? '' : '/'}${v}`);
            }
          }
        }
      }
    }
  }
  return Array.from(new Set(urls));
}

async function downloadResultFile(relOrAbs, outPath, headers = buildHeaders()) {
  if (relOrAbs.startsWith('data:image/')) {
    const m = relOrAbs.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) throw new Error('data URI inválida');
    const ext = m[1].split('/')[1];
    const buf = Buffer.from(m[2], 'base64');
    const final = outPath || `./output.${ext}`;
    fs.writeFileSync(final, buf);
    return final;
  }

  let url = relOrAbs;
  if (!/^https?:\/\//.test(url)) url = `${BASE}${url.startsWith('/') ? '' : '/'}${url}`;

  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  const ext = ct.includes('png') ? 'png'
    : ct.includes('jpeg') ? 'jpg'
    : ct.includes('webp') ? 'webp'
    : path.extname(new URL(url).pathname).replace('.', '') || 'bin';
  const buf = Buffer.from(await res.arrayBuffer());
  const final = outPath || `./output.${ext}`;
  fs.writeFileSync(final, buf);
  return final;
}

async function autoDetectFnIndex(headers) {
  try {
    const cfg = await fetchJSON(`${BASE}/config`, { headers });
    const deps = Array.isArray(cfg?.dependencies) ? cfg.dependencies : [];
    const queued = deps.filter((d) => d?.queue === true && Number.isInteger(d?.fn_index));
    if (queued.length) {
      queued.sort((a, b) => b.fn_index - a.fn_index);
      return queued[0].fn_index;
    }
  } catch (_) { }
  return null;
}

async function generateImage(opts) {
  const {
    prompt,
    negative = 'text, talk bubble, low quality, watermark, signature',
    seed = 0,
    hires = true,
    width = 1024,
    height = 1024,
    cfg = 7,
    steps = 28,
    fn_index,
    do_handshake = true,
    debug = false,
    timeoutMs = 120000,
    retries = 1,
  } = opts || {};

  if (!prompt) throw new Error('prompt obrigatório');

  const proxy = pickProxy();
  const oldHttp = process.env.HTTP_PROXY;
  const oldHttps = process.env.HTTPS_PROXY;
  if (proxy) {
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
  }
  const headers = buildHeaders();
  const sessionHash = makeSessionHash();
  const es = openSSE(sessionHash, proxy, headers);

  if (do_handshake) {
    await enqueue({ sessionHash, fn_index: 1, data: [], trigger_id: 12, headers });
  }

  let genFn = fn_index;
  if (genFn == null) genFn = await autoDetectFnIndex(headers);
  if (genFn == null) genFn = 2;

  const data = [prompt, negative, seed, hires, width, height, cfg, steps];

  let genEventId = await enqueue({ sessionHash, fn_index: genFn, data, trigger_id: 16, headers });
  if (debug) console.log('event_id:', genEventId, 'session_hash:', sessionHash, 'fn_index:', genFn);

  let completed = await waitForResultOn(es, genEventId, { debug, timeoutMs });

  let fileUrls = extractImageUrls(completed);
  if (!fileUrls.length && retries > 0) {
    if (debug) console.log('Nenhuma URL encontrada — tentando retry...');
    await sleep(600);
    const es2 = openSSE(sessionHash, proxy, headers);
    genEventId = await enqueue({ sessionHash, fn_index: genFn, data, trigger_id: 16, headers });
    completed = await waitForResultOn(es2, genEventId, { debug, timeoutMs });
    fileUrls = extractImageUrls(completed);
  }

  const result = { sessionHash, eventId: genEventId, fileUrls, raw: completed };
  if (proxy) {
    if (oldHttp == null) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = oldHttp;
    if (oldHttps == null) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = oldHttps;
  }
  return result;
}

module.exports = {
  generateImage,
  downloadResultFile,
};
