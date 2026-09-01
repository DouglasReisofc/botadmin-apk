const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const TOKEN_FILE = process.env.MELI_TOKEN_FILE || path.join(process.cwd(), 'storage', 'meli-token.json');
const CREDENTIAL_FILE = process.env.MELI_CREDENTIAL_FILE || path.join(process.cwd(), 'storage', 'meli-credentials.json');
const OAUTH_ENDPOINT = 'https://api.mercadolibre.com/oauth/token';

let cachedToken = null;
let refreshPromise = null;

function readJsonFileSync(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[meli-token] Falha ao ler', filePath, err.message);
    return null;
  }
}

async function readJsonFile(filePath) {
  try {
    await fsp.access(filePath);
  } catch {
    return null;
  }
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[meli-token] Erro ao ler', filePath, err.message);
    return null;
  }
}

async function writeJsonFile(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getCredentials() {
  const clientId = process.env.MELI_APP_ID || process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };
  const fromFile = readJsonFileSync(CREDENTIAL_FILE);
  if (fromFile?.clientId && fromFile?.clientSecret) {
    return { clientId: String(fromFile.clientId), clientSecret: String(fromFile.clientSecret) };
  }
  throw new Error('Credenciais do Mercado Livre não configuradas. Defina MELI_APP_ID/MELI_CLIENT_SECRET ou storage/meli-credentials.json');
}

async function loadTokenData() {
  if (cachedToken) return cachedToken;
  const fileData = await readJsonFile(TOKEN_FILE);
  if (fileData) {
    cachedToken = fileData;
  }
  return cachedToken;
}

async function saveTokenData(data) {
  cachedToken = data;
  await writeJsonFile(TOKEN_FILE, data);
}

function isTokenValid(token) {
  if (!token?.access_token || !token?.expires_at) return false;
  const expiresAt = new Date(token.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  const now = Date.now();
  const safetyWindow = 60 * 1000; // 1 minuto
  return now + safetyWindow < expiresAt;
}

async function requestToken(params) {
  const body = new URLSearchParams(params);
  const response = await fetch(OAUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`[meli-token] Falha ao solicitar token: ${response.status} ${response.statusText} => ${errorPayload}`);
  }

  const result = await response.json();
  const expiresIn = Number(result.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  const normalized = {
    access_token: result.access_token,
    refresh_token: result.refresh_token || params.refresh_token,
    expires_at: expiresAt
  };

  await saveTokenData(normalized);
  return normalized;
}

async function refreshAccessToken(currentRefreshToken) {
  const credentials = getCredentials();
  return requestToken({
    grant_type: 'refresh_token',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: currentRefreshToken
  });
}

async function exchangeCodeForTokens(code) {
  const credentials = getCredentials();
  return requestToken({
    grant_type: 'authorization_code',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    redirect_uri: process.env.MELI_REDIRECT_URI || 'https://botadmin.shop/webhook/ml'
  });
}

async function getValidAccessToken(forceRefresh = false) {
  const token = await loadTokenData();
  if (!token) {
    throw new Error('Token do Mercado Livre não encontrado. Autorize o app novamente.');
  }
  if (!forceRefresh && isTokenValid(token)) {
    return token.access_token;
  }

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(token.refresh_token)
      .catch(err => {
        console.error('[meli-token] Falha ao atualizar token:', err.message);
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  const refreshed = await refreshPromise;
  return refreshed.access_token;
}

module.exports = {
  getValidAccessToken,
  exchangeCodeForTokens,
  saveTokenData,
  loadTokenData
};
