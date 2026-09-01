const fs = require("fs");
const path = require("path");

const DEFAULT_COOKIE_FILE =
  process.env.INSTAGRAM_COOKIE_FILE || path.join(process.cwd(), "instacookiesnetscape.txt");
const DEFAULT_SETTINGS_FILE =
  process.env.INSTAGRAM_SETTINGS_FILE || path.join(process.cwd(), "intensescared_settings.json");
const DEFAULT_USER_AGENT =
  process.env.INSTAGRAM_USER_AGENT ||
  "Instagram 269.0.0.18.75 Android (26/8.0.0; 480dpi; 1080x1920; OnePlus; 6T Dev; devitron; qcom; en_US; 314665256)";

let cookieCache = null;
let cookieCacheMtime = 0;
let settingsCache = null;
let settingsCacheMtime = 0;

const SANITIZE_REGEX = /^"+|"+$/g;

const sanitizeValue = (value) => {
  if (typeof value !== "string") return value;
  return value.replace(SANITIZE_REGEX, "").trim();
};

const parseNetscapeCookies = (content) => {
  const lines = content.split(/\r?\n/);
  const map = {};
  for (const rawLine of lines) {
    if (!rawLine) continue;
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) {
      continue;
    }
    if (line.startsWith("#HttpOnly_")) {
      line = line.replace(/^#HttpOnly_/, "");
    }
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const key = (parts[5] || "").trim();
    const value = (parts[6] || "").trim();
    if (!key) continue;
    map[key] = sanitizeValue(value);
  }
  return map;
};

const readCookieFile = () => {
  try {
    const stat = fs.statSync(DEFAULT_COOKIE_FILE);
    if (cookieCache && cookieCacheMtime === stat.mtimeMs) {
      return cookieCache;
    }
    const content = fs.readFileSync(DEFAULT_COOKIE_FILE, "utf8");
    cookieCache = parseNetscapeCookies(content);
    cookieCacheMtime = stat.mtimeMs;
    return cookieCache;
  } catch {
    cookieCache = null;
    cookieCacheMtime = 0;
    return null;
  }
};

const readSettingsFile = () => {
  try {
    const stat = fs.statSync(DEFAULT_SETTINGS_FILE);
    if (settingsCache && settingsCacheMtime === stat.mtimeMs) {
      return settingsCache;
    }
    const content = fs.readFileSync(DEFAULT_SETTINGS_FILE, "utf8");
    settingsCache = JSON.parse(content);
    settingsCacheMtime = stat.mtimeMs;
    return settingsCache;
  } catch {
    settingsCache = null;
    settingsCacheMtime = 0;
    return null;
  }
};

const getCookieMap = () => readCookieFile() || {};

const getCookieValue = (key) => {
  if (!key) return null;
  const envKey = `INSTAGRAM_${key.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue) {
    return sanitizeValue(envValue);
  }
  const cookies = getCookieMap();
  if (cookies[key]) {
    return sanitizeValue(cookies[key]);
  }
  return null;
};

const getInstagramCookieHeader = () => {
  const desiredKeys = ["sessionid", "csrftoken", "ds_user_id", "ig_did", "mid", "rur"];
  const cookiePairs = [];
  for (const key of desiredKeys) {
    const value = getCookieValue(key);
    if (value) {
      cookiePairs.push(`${key}=${value}`);
    }
  }
  if (!cookiePairs.some((item) => item.startsWith("sessionid="))) {
    throw new Error("Instagram sessionid indisponível. Atualize instacookiesnetscape.txt.");
  }
  return cookiePairs.join("; ");
};

const getInstagramUserAgent = () => {
  if (process.env.INSTAGRAM_USER_AGENT?.trim()) {
    return process.env.INSTAGRAM_USER_AGENT.trim();
  }
  const settings = readSettingsFile();
  if (settings?.user_agent) {
    return settings.user_agent;
  }
  return DEFAULT_USER_AGENT;
};

const buildInstagramRequestHeaders = (extra = {}) => {
  const cookieHeader = getInstagramCookieHeader();
  const userAgent = getInstagramUserAgent();
  const headers = {
    "User-Agent": userAgent,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.instagram.com/",
    Cookie: cookieHeader,
    "X-IG-App-ID": process.env.INSTAGRAM_APP_ID || "936619743392459",
    ...extra,
  };
  const csrf = getCookieValue("csrftoken");
  if (csrf) {
    headers["X-CSRFToken"] = csrf;
  }
  const settings = readSettingsFile();
  const deviceId = settings?.uuids?.android_device_id;
  if (deviceId) {
    headers["X-IG-Device-ID"] = deviceId;
  }
  return headers;
};

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const formatCookieLine = (key, value, secure = true, httpOnly = false) => {
  const expires = Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS;
  const domain = `.instagram.com`;
  const prefix = httpOnly ? "#HttpOnly_" : "";
  return `${prefix}${domain}\tTRUE\t/\t${secure ? "TRUE" : "FALSE"}\t${expires}\t${key}\t${value}`;
};

const persistCookieFile = (cookies) => {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# http://curl.haxx.se/rfc/cookie_spec.html",
    "# This file was generated automatically. Do not edit manually.",
    "",
  ];
  Object.entries(cookies).forEach(([key, value]) => {
    if (!value) return;
    const sanitized = sanitizeValue(String(value));
    if (!sanitized) return;
    const httpOnly = ["sessionid", "csrftoken", "ds_user_id", "rur"].includes(key);
    lines.push(formatCookieLine(key, sanitized, true, httpOnly));
  });
  try {
    fs.writeFileSync(DEFAULT_COOKIE_FILE, `${lines.join("\n")}\n`, "utf8");
    cookieCache = { ...cookies };
    cookieCacheMtime = Date.now();
  } catch (error) {
    console.error("[insta-session] Falha ao escrever cookies:", error);
  }
};

const updateInstagramCookiesFromSession = (session) => {
  if (!session || typeof session !== "object") {
    return null;
  }
  const current = { ...getCookieMap() };
  const merged = { ...current };
  const snapshot = session.cookies && typeof session.cookies === "object" ? session.cookies : {};
  Object.assign(merged, snapshot);
  ["sessionid", "csrftoken", "ds_user_id", "ig_did", "mid", "rur"].forEach((key) => {
    if (session[key]) {
      merged[key] = sanitizeValue(String(session[key]));
    }
  });
  persistCookieFile(merged);
  return merged;
};

module.exports = {
  getInstagramCookies: getCookieMap,
  getInstagramCookieHeader,
  getInstagramUserAgent,
  getInstagramSessionId: () => getCookieValue("sessionid"),
  buildInstagramRequestHeaders,
  updateInstagramCookiesFromSession,
};
