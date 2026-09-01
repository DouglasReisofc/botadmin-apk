const fs = require("fs");
const path = require("path");

const FormData = require("form-data");
const axios = require("axios");
const { chromium } = require("playwright");

const SESSION_FILE =
  process.env.INFLACT_SESSION_FILE ||
  path.join(process.cwd(), "inflact_session.json");
const SESSION_TTL_MS =
  Number(process.env.INFLACT_SESSION_TTL_MS) || 30 * 60 * 1000;
const TEST_HANDLE =
  process.env.INFLACT_TEST_USERNAME || "douglasreis.dev";

const VIEWER_URL =
  "https://inflact.com/downloader/api/viewer/profile/?lang=en";
const VIEWER_REELS_URL =
  "https://inflact.com/downloader/api/viewer/reels/";
const VIEWER_REELS_REFERER =
  "https://inflact.com/instagram-profile-viewer/reels/";
const DOWNLOADER_POST_URL =
  "https://inflact.com/downloader/api/downloader/post/";
const DOWNLOADER_REFERER =
  "https://inflact.com/instagram-downloader/video/";

const HEADER_WHITELIST = [
  "accept",
  "accept-language",
  "origin",
  "referer",
  "user-agent",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "sentry-trace",
  "baggage",
  "x-client-token",
  "x-client-signature",
  "cookie",
];

const readSessionFile = () => {
  try {
    const content = fs.readFileSync(SESSION_FILE, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const writeSessionFile = (session) => {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
  } catch (error) {
    console.error("[inflact] falha ao salvar sessão", error);
  }
};

const isSessionStale = (session) => {
  if (!session || !session.fetchedAt) return true;
  return Date.now() - session.fetchedAt > SESSION_TTL_MS;
};

const sanitizeHeaders = (headers = {}) => {
  const cleaned = {};
  for (const key of HEADER_WHITELIST) {
    if (headers[key]) {
      cleaned[key] = headers[key];
    }
  }
  return cleaned;
};

const cookiesToHeader = (cookies = []) =>
  cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

const obtainSessionWithBrowser = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto("https://inflact.com/instagram-viewer/profile/", {
      waitUntil: "load",
      timeout: 90_000,
    });
    await page.waitForTimeout(3000);
    const targetSelector = 'input[name="url"]';
    const requestPromise = page.waitForRequest(
      (req) =>
        req
          .url()
          .startsWith("https://inflact.com/downloader/api/viewer/profile"),
      { timeout: 60_000 },
    );
    await page.fill(targetSelector, TEST_HANDLE);
    await page.keyboard.press("Enter");
    const capturedRequest = await requestPromise;
    const requestHeaders = capturedRequest.headers();
    const filteredHeaders = sanitizeHeaders(requestHeaders);
    if (!filteredHeaders.cookie) {
      const cookies = await page.context().cookies();
      filteredHeaders.cookie = cookiesToHeader(cookies);
    }
    const cookies = await page.context().cookies();
    const session = {
      fetchedAt: Date.now(),
      headers: filteredHeaders,
      cookies,
      cookieHeader: filteredHeaders.cookie,
      userAgent: filteredHeaders["user-agent"],
    };
    writeSessionFile(session);
    return session;
  } finally {
    await browser.close();
  }
};

let refreshPromise = null;

const refreshSession = async () => {
  if (!refreshPromise) {
    refreshPromise = obtainSessionWithBrowser()
      .then((session) => {
        refreshPromise = null;
        return session;
      })
      .catch((error) => {
        refreshPromise = null;
        throw error;
      });
  }
  return refreshPromise;
};

const ensureSession = async (forceRefresh = false) => {
  const cached = readSessionFile();
  if (!forceRefresh && cached && !isSessionStale(cached)) {
    return cached;
  }
  return refreshSession();
};

const mergeSetCookieHeaders = (session, setCookieHeaders = []) => {
  if (!session) return session;
  if (!setCookieHeaders || setCookieHeaders.length === 0) return session;
  const jar = {};
  const currentHeader = session.cookieHeader || "";
  currentHeader.split(/;\s*/).forEach((item) => {
    if (!item) return;
    const [name, ...rest] = item.split("=");
    if (!name) return;
    jar[name.trim()] = rest.join("=");
  });
  setCookieHeaders.forEach((cookieLine) => {
    if (!cookieLine) return;
    const [pair] = cookieLine.split(";");
    if (!pair) return;
    const [name, ...rest] = pair.split("=");
    if (!name) return;
    jar[name.trim()] = rest.join("=");
  });
  const mergedHeader = Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  session.cookieHeader = mergedHeader;
  if (session.headers) {
    session.headers.cookie = mergedHeader;
  }
  return session;
};

const shouldForceRefresh = (status, body) => {
  if (!status && !body) return false;
  if (status && Number(status) === 403) return true;
  if (typeof body === "string" && /invalid client token/i.test(body)) {
    return true;
  }
  return false;
};

const buildRequestHeaders = (session, formHeaders) => {
  const headers = { ...(session.headers || {}) };
  delete headers["content-length"];
  delete headers["content-type"];
  return {
    ...headers,
    ...formHeaders,
  };
};

const buildDownloaderHeaders = (session, formHeaders) => ({
  ...buildRequestHeaders(session, formHeaders),
  Referer: DOWNLOADER_REFERER,
  Origin: "https://inflact.com",
});

const buildViewerReelsHeaders = (session, formHeaders) => ({
  ...buildRequestHeaders(session, formHeaders),
  Referer: VIEWER_REELS_REFERER,
  Origin: "https://inflact.com",
});

const fetchInflactProfile = async (username, opts = {}) => {
  let session = await ensureSession(Boolean(opts.forceRefresh));
  let attempt = 0;
  let lastError = null;
  while (attempt < 2) {
    attempt += 1;
    try {
      const form = new FormData();
      form.append("url", username);
      const headers = buildRequestHeaders(session, form.getHeaders());
      const response = await axios.post(VIEWER_URL, form, {
        headers,
        timeout: 45_000,
        maxRedirects: 0,
      });
      const setCookie = response.headers?.["set-cookie"];
      if (setCookie?.length) {
        session = mergeSetCookieHeaders(session, setCookie);
        writeSessionFile(session);
      }
      return response.data;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const body =
        typeof error?.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error?.response?.data || {});
      if (attempt < 2 && shouldForceRefresh(status, body)) {
        session = await refreshSession();
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const fetchInflactProfileReels = async (username, opts = {}) => {
  if (!username || typeof username !== "string") {
    throw new Error("Username do Instagram inválido");
  }
  let session = await ensureSession(Boolean(opts.forceRefresh));
  let attempt = 0;
  let lastError = null;
  while (attempt < 2) {
    attempt += 1;
    try {
      const form = new FormData();
      form.append("url", username.trim());
      form.append("cursor", typeof opts.cursor === "string" ? opts.cursor : "");
      const headers = buildViewerReelsHeaders(session, form.getHeaders());
      const response = await axios.post(VIEWER_REELS_URL, form, {
        headers,
        timeout: 60_000,
        maxRedirects: 0,
      });
      const setCookie = response.headers?.["set-cookie"];
      if (setCookie?.length) {
        session = mergeSetCookieHeaders(session, setCookie);
        writeSessionFile(session);
      }
      return response.data;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const body =
        typeof error?.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error?.response?.data || {});
      if (attempt < 2 && shouldForceRefresh(status, body)) {
        session = await refreshSession();
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

const fetchInflactDownloadPost = async (targetUrl, opts = {}) => {
  if (!targetUrl || typeof targetUrl !== "string") {
    throw new Error("URL do Instagram inválida");
  }
  let session = await ensureSession(Boolean(opts.forceRefresh));
  let attempt = 0;
  let lastError = null;
  while (attempt < 2) {
    attempt += 1;
    try {
      const form = new FormData();
      form.append("url", targetUrl.trim());
      const headers = buildDownloaderHeaders(session, form.getHeaders());
      const response = await axios.post(DOWNLOADER_POST_URL, form, {
        headers,
        timeout: 45_000,
        maxRedirects: 0,
      });
      const setCookie = response.headers?.["set-cookie"];
      if (setCookie?.length) {
        session = mergeSetCookieHeaders(session, setCookie);
        writeSessionFile(session);
      }
      return response.data;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const body =
        typeof error?.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error?.response?.data || {});
      if (attempt < 2 && shouldForceRefresh(status, body)) {
        session = await refreshSession();
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

module.exports = {
  ensureSession,
  refreshSession,
  fetchInflactProfile,
  fetchInflactProfileReels,
  fetchInflactDownloadPost,
};
