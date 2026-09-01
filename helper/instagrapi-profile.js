const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  getInstagramCookies,
  updateInstagramCookiesFromSession,
} = require("./instagram-session");

const PYTHON_BIN = process.env.INSTAGRAM_PYTHON_BIN || "python3";
const LOGIN_USER =
  process.env.INSTAGRAM_LOGIN ||
  process.env.INSTAGRAM_USERNAME ||
  "intensescared";
const LOGIN_PASS =
  process.env.INSTAGRAM_PASSWORD ||
  process.env.INSTAGRAM_PASS ||
  "Dev7766@#$%";
const SETTINGS_FILE =
  process.env.INSTAGRAM_SETTINGS_FILE ||
  path.join(process.cwd(), "intensescared_settings.json");
const COOKIE_FILE =
  process.env.INSTAGRAM_COOKIE_FILE ||
  path.join(process.cwd(), "instacookiesnetscape.txt");
const SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "instagrapi_profile.py",
);

const fileExists = (target) => {
  try {
    return !!target && fs.existsSync(target);
  } catch {
    return false;
  }
};

const sanitizeSession = (value) => {
  if (!value) return null;
  return value.replace(/^"+|"+$/g, "").trim();
};

const resolveSessionId = () => {
  const sessionFromEnv = sanitizeSession(process.env.INSTAGRAM_SESSIONID);
  if (sessionFromEnv) return sessionFromEnv;
  const cookies = getInstagramCookies();
  if (cookies?.sessionid) {
    return sanitizeSession(cookies.sessionid);
  }
  if (!COOKIE_FILE || !fs.existsSync(COOKIE_FILE)) return null;
  try {
    const content = fs.readFileSync(COOKIE_FILE, "utf8");
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      if (rawLine.includes("sessionid")) {
        const parts = rawLine.replace(/^#HttpOnly_/, "").split("\t");
        if (parts.length >= 7 && parts[5] === "sessionid") {
          return sanitizeSession(parts[6]);
        }
      }
    }
  } catch {
    return null;
  }
  return null;
};

const runPythonScript = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        const error = new Error(
          `instagrapi script exited with code ${code}: ${stderr || stdout}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        return reject(error);
      }
      resolve(stdout);
    });
    proc.on("error", (err) => {
      reject(err);
    });
  });

const shouldForceRefresh = (message = "") =>
  /please wait/i.test(message) ||
  /429/.test(message) ||
  /Too many 429/i.test(message) ||
  /RetryError/.test(message);

const parseJsonSafe = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

async function runInstagrapiScript(username, options = {}) {
  if (!fileExists(SCRIPT_PATH)) {
    throw new Error("Script instagrapi_profile.py não encontrado.");
  }
  const args = [SCRIPT_PATH, "--username", username.replace(/^@/, "")];
  const posts = Number.isFinite(options.posts)
    ? Math.max(0, Math.min(12, Number(options.posts)))
    : 6;
  args.push("--posts", String(posts));

  const sessionid = options.sessionid || resolveSessionId();
  if (sessionid) {
    args.push("--sessionid", sessionid);
  }
  if (fileExists(SETTINGS_FILE)) {
    args.push("--settings", SETTINGS_FILE);
  }

  const loginUser = options.instaUser || LOGIN_USER;
  const loginPass = options.instaPass || LOGIN_PASS;
  if (loginUser && loginPass) {
    args.push("--insta-user", loginUser, "--insta-pass", loginPass);
  }
  if (options.forceLogin) {
    args.push("--force-login");
  }
  if (options.sessionDumpPath) {
    args.push("--dump-session-json", options.sessionDumpPath);
  }

  try {
    const rawOutput = await runPythonScript(args);
    const parsed = parseJsonSafe(rawOutput);
    if (!parsed) {
      throw new Error(`Resposta inválida do instagrapi: ${rawOutput}`);
    }
    return parsed;
  } catch (error) {
    const errMsg = error.stderr || error.message || String(error);
    throw new Error(`Falha ao executar instagrapi: ${errMsg}`);
  }
}

async function fetchInstagramProfile(username, options = {}) {
  if (!username) {
    throw new Error("Username obrigatório");
  }
  const attempt = async (forceLogin = false) => {
    let sessionDumpPath = null;
    if (forceLogin) {
      sessionDumpPath = path.join(
        os.tmpdir(),
        `instagrapi-session-${Date.now()}-${Math.random()}.json`,
      );
    }
    try {
      const payload = await runInstagrapiScript(username, {
        ...options,
        forceLogin,
        sessionDumpPath,
      });
      if (payload?.session) {
        updateInstagramCookiesFromSession(payload.session);
      } else if (sessionDumpPath && fs.existsSync(sessionDumpPath)) {
        const sessionData = parseJsonSafe(
          fs.readFileSync(sessionDumpPath, "utf8"),
        );
        if (sessionData) {
          updateInstagramCookiesFromSession(sessionData);
        }
      }
      return payload;
    } catch (error) {
      if (sessionDumpPath && fs.existsSync(sessionDumpPath)) {
        try {
          const sessionData = parseJsonSafe(
            fs.readFileSync(sessionDumpPath, "utf8"),
          );
          if (sessionData) {
            updateInstagramCookiesFromSession(sessionData);
          }
        } catch {
          /* ignore */
        }
      }
      throw error;
    } finally {
      if (sessionDumpPath) {
        fs.rmSync(sessionDumpPath, { force: true });
      }
    }
  };

  const initialForce = Boolean(options.forceLogin);
  try {
    return await attempt(initialForce);
  } catch (error) {
    if (initialForce || !shouldForceRefresh(error?.message || "")) {
      throw error;
    }
    return await attempt(true);
  }
}

module.exports = {
  fetchInstagramProfile,
};
