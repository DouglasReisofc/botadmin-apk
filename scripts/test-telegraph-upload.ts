#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import FormData from 'form-data';
import axios, { AxiosRequestConfig } from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';

const telegraphHelper: typeof import('../lib/integrations/apis/funcoes/telegraph-helper.js') = require('../lib/integrations/apis/funcoes/telegraph-helper.js');

const ensureFetch = async () => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  const { default: fetchFn } = await import('node-fetch');
  globalThis.fetch = fetchFn as any;
  return fetchFn as typeof fetch;
};

const exitWithUsage = () => {
  console.log('Usage: tsx scripts/test-telegraph-upload.ts --link <URL> [--proxy socks5://user:pass@host:port]');
  process.exit(1);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result: { link?: string; proxy?: string } = {};
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
  return result as { link: string; proxy?: string };
};

const buildAxiosConfig = (proxyUrl?: string): AxiosRequestConfig => {
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
    } as AxiosRequestConfig;
  }
  throw new Error(`Unsupported proxy scheme: ${parsed.protocol}`);
};

const uploadToTelegraph = async (filePath: string, proxyUrl?: string) => {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  const config: AxiosRequestConfig = {
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
};

const run = async () => {
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
};

run().catch((err) => {
  console.error('[telegraph tester] erro:', err.message || err);
  process.exit(1);
});
