const path = require('path');
const fs = require('fs');
const { tmpdir } = require('os');
const cheerio = require('cheerio');

const DEFAULT_FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
};

const MAX_IMAGE_RESOLVE_DEPTH = 3;

const ensureFetch = (customFetch) => {
  if (typeof customFetch === 'function') return customFetch;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  try {
    return require('node-fetch');
  } catch (err) {
    throw new Error('Fetch API indisponível neste ambiente.');
  }
};

function guessExtensionFromUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const ext = path.extname(parsed.pathname || '').replace('.', '');
    return ext || '';
  } catch {
    return '';
  }
}

function looksLikeHtml(buffer) {
  const snippet = buffer.slice(0, 200).toString('utf8');
  return /<!doctype html|<html|<body|<head/i.test(snippet);
}

function extractImageCandidates(html, baseUrl) {
  const $ = cheerio.load(html);
  const candidates = new Set();
  const push = (value) => {
    if (!value) return;
    try {
      const normalized = new URL(value, baseUrl).href;
      candidates.add(normalized);
    } catch {
      /* ignore malformed URLs */
    }
  };

  [
    'meta[property="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'link[rel="image_src"]'
  ].forEach((selector) => {
    $(selector).each((_, el) => push($(el).attr('content') || $(el).attr('href')));
  });

  $('img[src]').each((_, el) => push($(el).attr('src')));
  return Array.from(candidates);
}

async function detectFileType(buffer, detector) {
  if (typeof detector === 'function') {
    try {
      return await detector(buffer);
    } catch {
      return null;
    }
  }

  if (!detectFileType.detector) {
    try {
      const ft = require('file-type');
      detectFileType.detector =
        typeof ft === 'function' ? ft : ft.fileTypeFromBuffer || ft.fromBuffer || ft.default;
    } catch {
      try {
        const ft = await import('file-type');
        detectFileType.detector =
          ft.fileTypeFromBuffer || ft.fromBuffer || ft.default;
      } catch {
        detectFileType.detector = async () => null;
      }
    }
  }

  try {
    return await detectFileType.detector(buffer);
  } catch {
    return null;
  }
}

async function resolveImageBufferFromLink(targetUrl, options = {}) {
  const fetchImpl = ensureFetch(options.fetch);
  const detect = options.detectFileType;
  const visited = options.visited || new Set();
  const depth = options.depth || 0;

  if (!targetUrl) throw new Error('Link da imagem não informado');
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error('Informe um link HTTP ou HTTPS válido');
  if (visited.has(targetUrl)) throw new Error('Detectado loop ao tentar resolver a imagem');
  if (depth > MAX_IMAGE_RESOLVE_DEPTH) throw new Error('Não foi possível localizar uma imagem no link informado');

  visited.add(targetUrl);

  let response;
  try {
    response = await fetchImpl(targetUrl, { headers: DEFAULT_FETCH_HEADERS, redirect: 'follow' });
  } catch (err) {
    throw new Error(`Falha ao buscar o link (${err.message})`);
  }

  const finalUrl = response.url || targetUrl;
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || '';
  const typeInfo = await detectFileType(buffer, detect);
  const bufferLooksLikeImage = typeInfo?.mime?.startsWith('image/') || /image\//i.test(contentType);

  if (bufferLooksLikeImage) {
    const ext =
      typeInfo?.ext ||
      (contentType.startsWith('image/') ? contentType.split('/')[1] : '') ||
      guessExtensionFromUrl(finalUrl) ||
      guessExtensionFromUrl(targetUrl) ||
      'jpg';

    return {
      buffer,
      ext,
      finalUrl
    };
  }

  const shouldParseAsHtml =
    /text\/html|application\/xhtml\+xml/i.test(contentType) ||
    looksLikeHtml(buffer);

  if (!shouldParseAsHtml) {
    throw new Error('O link informado não possui uma imagem disponível para download');
  }

  const html = buffer.toString('utf8');
  const candidates = extractImageCandidates(html, finalUrl);

  if (!candidates.length) {
    throw new Error('Não foi possível encontrar nenhuma imagem na página informada');
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await resolveImageBufferFromLink(candidate, {
        ...options,
        visited,
        depth: depth + 1
      });
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Não foi possível baixar a imagem encontrada na página');
}

async function downloadImageToTempFile(link, options = {}) {
  const result = await resolveImageBufferFromLink(link, options);
  const safeExt = result.ext ? `.${result.ext.replace(/^\./, '')}` : '.jpg';
  const tempFile = path.join(tmpdir(), `telegraph_${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`);
  await fs.promises.writeFile(tempFile, result.buffer);
  return { tempFile, finalUrl: result.finalUrl, ext: result.ext };
}

module.exports = {
  DEFAULT_FETCH_HEADERS,
  MAX_IMAGE_RESOLVE_DEPTH,
  resolveImageBufferFromLink,
  downloadImageToTempFile,
};
