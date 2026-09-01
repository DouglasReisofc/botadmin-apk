const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const yts = require("yt-search");

const PYTHON_BIN = process.env.SPOTDL_PYTHON_PATH || "python3";
const METADATA_SCRIPT = path.join(process.cwd(), "lib", "python", "spotify_dl_cli.py");
const AUDIO_SCRIPT = path.join(process.cwd(), "lib", "python", "audio_downloader.py");
const TMP_DIR = path.join(process.cwd(), "lib", "python", "tmp");
const REQUEST_TIMEOUT = Number(process.env.SPOTDL_TIMEOUT_MS || 120_000);
const YT_DURATION_TOLERANCE = Number(process.env.SPOTDL_YT_DURATION_TOLERANCE || 12);

const ensureScript = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} não encontrado (${filePath}).`);
  }
};

ensureScript(METADATA_SCRIPT, "Wrapper de metadados do Spotify");
ensureScript(AUDIO_SCRIPT, "Downloader de áudio");

const resolveBaseUrl = () => {
  const candidates = [
    process.env.BASE_SITE_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_BASE_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    "http://localhost:4478",
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim().replace(/\/+$/, "");
    }
  }

  return "http://localhost:4478";
};

const BASE_URL = resolveBaseUrl();

const runPythonJson = (scriptPath, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [scriptPath, ...args], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, REQUEST_TIMEOUT);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const output = stdout.trim();
      let payload = null;
      if (output) {
        try {
          payload = JSON.parse(output);
        } catch {
          payload = null;
        }
      }

      if (code !== 0 || !payload) {
        const message =
          (payload && payload.error) ||
          stderr.trim() ||
          output ||
          "Script Python retornou erro.";
        const error = new Error(message);
        error.code = code;
        return reject(error);
      }

      if (!payload.ok) {
        return reject(new Error(payload.error || "Falha ao obter metadados do Spotify."));
      }

      return resolve(payload.result);
    });
  });

const runAudioDownloader = (videoUrl) =>
  new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [AUDIO_SCRIPT, videoUrl, BASE_URL], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, REQUEST_TIMEOUT);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const message = stderr.trim() || stdout.trim() || "Falha ao baixar áudio pelo yt-dlp.";
        const error = new Error(message);
        error.code = code;
        return reject(error);
      }

      const id = stdout.trim();
      if (!id) {
        return reject(new Error("O downloader não retornou o identificador do arquivo."));
      }

      resolve(id);
    });
  });

const searchYoutubeCandidate = async (query, targetDuration) => {
  const result = await yts(query);
  if (!result || !Array.isArray(result.videos) || result.videos.length === 0) {
    throw new Error("Nenhum resultado encontrado no YouTube.");
  }

  const tolerance = targetDuration
    ? Math.max(5, Math.min(YT_DURATION_TOLERANCE, Math.ceil(targetDuration * 0.2)))
    : YT_DURATION_TOLERANCE;

  const normalized = result.videos.find((video) => {
    if (!targetDuration || !video.seconds) {
      return true;
    }
    return Math.abs(video.seconds - targetDuration) <= tolerance;
  });

  return normalized || result.videos[0];
};

const buildSearchQuery = (metadata) => {
  const parts = [metadata.title, metadata.artist];
  if (!metadata.artist && Array.isArray(metadata.artists) && metadata.artists.length) {
    parts.push(metadata.artists.join(" "));
  }
  return `${parts.filter(Boolean).join(" ")} audio`;
};

const resolveFileStats = (fileId) => {
  const candidates = [
    { path: path.join(TMP_DIR, `${fileId}.mp3`), mimetype: "audio/mpeg" },
    { path: path.join(TMP_DIR, `${fileId}.m4a`), mimetype: "audio/mp4" },
    { path: path.join(TMP_DIR, `${fileId}.webm`), mimetype: "audio/webm" },
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      const stats = fs.statSync(candidate.path);
      return { ...candidate, size: stats.size };
    }
  }

  throw new Error("Arquivo de áudio não foi localizado após o download.");
};

const composeResponse = (metadata, downloadId, fileInfo) => {
  const downloadUrl = `${BASE_URL}/api/rest/playaudio/${downloadId}`;
  return {
    song_name: metadata.title || "Spotify",
    artist: metadata.artist || "",
    artist_name: metadata.artist || "",
    artists: metadata.artists || [],
    album_name: metadata.album || "",
    release_date: metadata.release_date || null,
    duration: metadata.duration_text || null,
    duration_seconds: metadata.duration_seconds || null,
    img: metadata.cover || null,
    cover: metadata.cover || null,
    spotify_url: metadata.spotify_url || null,
    track_url: metadata.spotify_url || null,
    file_id: downloadId,
    filesize: fileInfo.size,
    bitrate: "128k",
    format: path.extname(fileInfo.path).replace(".", "") || "mp3",
    mimetype: fileInfo.mimetype,
    source: "spotify+yt-search",
    download_url: downloadUrl,
    downloadUrl,
    dlink: downloadUrl,
    direct_download: downloadUrl,
    url: downloadUrl,
  };
};

async function spotifyDl(spotifyTrackUrl) {
  if (!spotifyTrackUrl || typeof spotifyTrackUrl !== "string") {
    throw new Error("Informe a URL da música do Spotify.");
  }

  const metadata = await runPythonJson(METADATA_SCRIPT, ["--url", spotifyTrackUrl.trim()]);

  const query = buildSearchQuery(metadata);
  const candidate = await searchYoutubeCandidate(query, metadata.duration_seconds || null);

  const downloadId = await runAudioDownloader(candidate.url);
  const fileInfo = resolveFileStats(downloadId);

  return composeResponse(metadata, downloadId, fileInfo);
}

module.exports = { spotifyDl };
