const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const REMOVE_BG_ENDPOINT = 'https://apiv2.botadmin.shop/canva/remove-background';

function getMimeType(filename = '') {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function ensureBuffer(inputBuffer) {
  if (Buffer.isBuffer(inputBuffer)) {
    return inputBuffer;
  }

  if (inputBuffer?.type === 'Buffer' && Array.isArray(inputBuffer.data)) {
    return Buffer.from(inputBuffer.data);
  }

  throw new Error('Buffer inválido.');
}

async function normalizeImageInput({ filePath, buffer, fileName, mimeType, imageUrl }) {
  if (imageUrl) {
    return {
      imageUrl,
      fileName: fileName || path.basename(new URL(imageUrl).pathname) || `image_${Date.now()}.png`,
      mimeType: mimeType || 'image/png',
      buffer: null,
    };
  }

  let inputBuffer = buffer;
  let resolvedFileName = fileName;

  if (!inputBuffer) {
    if (!filePath) throw new Error('Nenhum arquivo fornecido.');
    if (!fs.existsSync(filePath)) throw new Error('Arquivo não encontrado.');
    inputBuffer = fs.readFileSync(filePath);
    resolvedFileName = resolvedFileName || path.basename(filePath);
  } else {
    inputBuffer = ensureBuffer(inputBuffer);
    if (!resolvedFileName) resolvedFileName = 'image.png';
  }

  let resolvedMimeType = mimeType || getMimeType(resolvedFileName);
  if (resolvedMimeType === 'image/webp') {
    inputBuffer = await sharp(inputBuffer).png().toBuffer();
    resolvedMimeType = 'image/png';
    if (path.extname(resolvedFileName).toLowerCase() !== '.png') {
      resolvedFileName = `${path.basename(resolvedFileName, path.extname(resolvedFileName))}.png`;
    }
  }

  return {
    imageUrl: null,
    fileName: resolvedFileName,
    mimeType: resolvedMimeType,
    buffer: inputBuffer,
  };
}

function parseJsonBuffer(data) {
  try {
    return JSON.parse(Buffer.from(data).toString('utf8'));
  } catch {
    return null;
  }
}

function createResponseError(message, status, data) {
  const error = new Error(message);
  error.response = { status, data };
  return error;
}

function extractResultUrl(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidates = [
    payload.result_direct_link,
    payload.result_link_info?.selected?.direct,
    payload.result_link_info?.candidates?.direct,
    payload.result_link_info?.candidates?.file,
    payload.job?.result_direct_link,
    payload.job?.result_link_info?.selected?.direct,
    payload.job?.result_link_info?.candidates?.direct,
    payload.job?.result_link_info?.candidates?.file,
    payload.direct_url,
    payload.output_url,
    payload.file_url,
    payload.url,
  ];

  return candidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
}

function extractResultBuffer(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const dataUrlCandidates = [
    payload.image_data_url,
    payload.result_image_data_url,
    payload.data_url,
    payload.encodedImageWithoutBackground,
  ];

  for (const candidate of dataUrlCandidates) {
    if (typeof candidate === 'string' && /^data:image\/.+;base64,/i.test(candidate)) {
      return Buffer.from(candidate.replace(/^data:image\/.+;base64,/i, ''), 'base64');
    }
  }

  const base64Candidates = [
    payload.base64,
    payload.result_base64,
    payload.image_base64,
  ];

  for (const candidate of base64Candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return Buffer.from(candidate, 'base64');
    }
  }

  return null;
}

async function callRemoveBackgroundApi(payload) {
  const response = await axios.post(REMOVE_BG_ENDPOINT, payload, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, image/*',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 300000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });

  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  const rawBuffer = Buffer.from(response.data || []);

  if (response.status < 200 || response.status >= 300) {
    const errorPayload = contentType.includes('application/json')
      ? parseJsonBuffer(rawBuffer) || rawBuffer.toString('utf8')
      : rawBuffer.toString('utf8');
    throw createResponseError('Erro ao remover fundo da imagem.', response.status, errorPayload);
  }

  if (contentType.startsWith('image/')) {
    return {
      raw: {
        ok: true,
        success: true,
        direct_result: true,
      },
      buffer: rawBuffer,
    };
  }

  const jsonPayload = parseJsonBuffer(rawBuffer);
  if (!jsonPayload) {
    throw createResponseError('Resposta inválida ao remover fundo.', response.status, rawBuffer.toString('utf8'));
  }

  const inlineBuffer = extractResultBuffer(jsonPayload);
  if (inlineBuffer) {
    return {
      raw: jsonPayload,
      buffer: inlineBuffer,
    };
  }

  const resultUrl = extractResultUrl(jsonPayload);
  if (!resultUrl) {
    throw createResponseError('Resposta não contém imagem final.', response.status, jsonPayload);
  }

  const fileResponse = await axios.get(resultUrl, {
    responseType: 'arraybuffer',
    timeout: 300000,
    maxRedirects: 5,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: {
      Accept: 'image/*',
      'User-Agent': 'Mozilla/5.0',
    },
    validateStatus: () => true,
  });

  if (fileResponse.status < 200 || fileResponse.status >= 300) {
    throw createResponseError('Falha ao baixar a imagem final sem fundo.', fileResponse.status, fileResponse.data);
  }

  return {
    raw: jsonPayload,
    buffer: Buffer.from(fileResponse.data || []),
  };
}

async function saveResultBuffer(resultBuffer, fileName = 'image.png') {
  const tempDir = path.join(process.cwd(), 'public', 'tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  const baseName = path.basename(fileName, path.extname(fileName)) || 'removebg';
  const outputPath = path.join(tempDir, `${baseName}_removebg_${Date.now()}.png`);
  fs.writeFileSync(outputPath, resultBuffer);
  return outputPath;
}

function normalizeRemoveBackgroundArgs(input) {
  if (typeof input === 'string') {
    return { filePath: input };
  }

  if (Buffer.isBuffer(input)) {
    return { buffer: input };
  }

  if (input?.type === 'Buffer' && Array.isArray(input.data)) {
    return { buffer: Buffer.from(input.data) };
  }

  return input || {};
}

async function removeBackground(input) {
  const normalized = await normalizeImageInput(normalizeRemoveBackgroundArgs(input));
  const payload = normalized.imageUrl
    ? { image_url: normalized.imageUrl }
    : {
        image_data_url: `data:${normalized.mimeType};base64,${normalized.buffer.toString('base64')}`,
        file_name: normalized.fileName,
      };

  const result = await callRemoveBackgroundApi(payload);
  const outputPath = await saveResultBuffer(result.buffer, normalized.fileName);

  return {
    buffer: result.buffer,
    filePath: outputPath,
    raw: result.raw,
  };
}

module.exports = {
  getMimeType,
  removeBackground,
};
