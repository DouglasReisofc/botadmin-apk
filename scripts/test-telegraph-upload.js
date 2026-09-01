#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const telegraphHelper = require('../lib/integrations/apis/funcoes/telegraph-helper.js');

async function ensureFetch() {
  if (typeof global.fetch === 'function') return global.fetch.bind(global);
  const fetchFn = await import('node-fetch');
  global.fetch = fetchFn.default;
  return fetchFn.default;
}

function exitWithUsage() {
  console.log('Usage: node scripts/test-telegraph-upload.js --link <URL> [--proxy socks5://user:pass@host:port]');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const value = args[i + 1];
    if (key === '--link' && value) {
      result.link = value;
      i += 1;
    } else if (key === '--proxy' && value) {
      result.proxy = value;
      i += 1;
    }
  }
  if (!result.link) exitWithUsage();
  return result;
}

function buildAxiosConfig(proxyUrl) {
  if (!proxyUrl) return {};
  const parsed = new URL(proxyUrl);
  if (parsed.protocol.startsWith('socks')) {
    const agent = new SocksProxyAgent(proxyUrl);
    return { httpAgent: agent, httpsAgent: agent, proxy: false };
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const auth = parsed.username
      ? {
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password || ''),
        }
      : undefined;
    return {
      proxy: {
        protocol: parsed.protocol.replace(':', ''),
        host: parsed.hostname,
        port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
        auth,
      },
    };
  }
  throw new Error(`Unsupported proxy scheme: ${parsed.protocol}`);
}

async function uploadToTelegraph(filePath, proxyUrl) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  const config = {
    url: 'https://telegra.ph/upload',
    method: 'POST',
    headers: {
      ...form.getHeaders(),
      'User-Agent': 'Mozilla/5.0 (Telegraph tester)',
    },
    data: form,
    timeout: 60_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    ...buildAxiosConfig(proxyUrl),
  };
  const response = await axios.request(config);
  if (!Array.isArray(response.data) || !response.data[0]?.src) {
    throw new Error(`Unexpected response: ${JSON.stringify(response.data)}`);
  }
  return `https://telegra.ph${response.data[0].src}`;
}

async function run() {
  const { link, proxy } = parseArgs();
  const fetchImpl = await ensureFetch();
  console.log(`[telegraph tester] baixando imagem de ${link}`);
  const { tempFile, finalUrl } = await telegraphHelper.downloadImageToTempFile(link, { fetch: fetchImpl });
  console.log(`[telegraph tester] arquivo temporário: ${tempFile}`);
  try {
    console.log(`[telegraph tester] enviando para telegra.ph${proxy ? ' via proxy' : ''}...`);
    const remoteUrl = await uploadToTelegraph(tempFile, proxy);
    console.log('[telegraph tester] upload concluído:');
    console.log('  origem:', finalUrl);
    console.log('  telegra.ph:', remoteUrl);
  } finally {
    fs.promises.unlink(tempFile).catch(() => {});
  }
}

run().catch((err) => {
  console.error('[telegraph tester] erro:', err.message || err);
  process.exit(1);
});
