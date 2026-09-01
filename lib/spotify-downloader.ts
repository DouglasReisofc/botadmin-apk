import fs from "node:fs";
import path from "path";

type SpotifyDownloaderModule = {
  spotifyDl?: (url: string) => Promise<Record<string, any>>;
};

let cachedSpotifyDownloader: ((url: string) => Promise<Record<string, any>>) | null = null;
let cachedModuleMtime: number | null = null;

const getSpotifyDownloader = (): ((url: string) => Promise<Record<string, any>>) => {
  const modulePath = path.join(
    process.cwd(),
    "lib",
    "integrations",
    "apis",
    "funcoes",
    "spotify-downloader.js",
  );
  let currentMtime: number | null = null;
  try {
    currentMtime = fs.statSync(modulePath).mtimeMs;
  } catch {
    currentMtime = null;
  }

  if (cachedSpotifyDownloader && cachedModuleMtime !== null && cachedModuleMtime === currentMtime) {
    return cachedSpotifyDownloader;
  }

  try {
    const evalRequire = eval("require") as NodeRequire & { cache?: Record<string, NodeModule> };
    if (evalRequire.cache && evalRequire.cache[modulePath]) {
      delete evalRequire.cache[modulePath];
    }
    const mod = evalRequire(modulePath) as SpotifyDownloaderModule;
    if (mod && typeof mod.spotifyDl === "function") {
      cachedSpotifyDownloader = mod.spotifyDl.bind(mod);
      cachedModuleMtime = currentMtime;
      return cachedSpotifyDownloader;
    }
  } catch (error) {
    console.error("[spotify] Failed to load spotify downloader", error);
  }
  throw new Error("Spotify downloader não disponível no momento.");
};

export type SpotifyTrackInfo = {
  downloadUrl: string;
  title: string;
  artist: string;
  album?: string | null;
  cover?: string | null;
  duration?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  durationSeconds?: number | null;
  spotifyUrl?: string | null;
  fileId?: string | null;
  raw?: Record<string, any> | null;
};

export const downloadSpotifyTrack = async (trackUrl: string): Promise<SpotifyTrackInfo> => {
  const downloader = getSpotifyDownloader();
  const data = await downloader(trackUrl);

  const downloadUrl =
    data?.dlink ||
    data?.download_url ||
    data?.downloadUrl ||
    data?.url ||
    data?.direct_download ||
    null;

  if (!downloadUrl || typeof downloadUrl !== "string") {
    throw new Error("Não foi possível obter o link de download do Spotify.");
  }

  const title = data?.song_name || data?.songName || "Spotify";
  const artist = data?.artist || data?.artist_name || "";

  return {
    downloadUrl,
    title,
    artist,
    album: data?.album_name || data?.album || null,
    cover: data?.img || data?.cover || null,
    duration: data?.duration || null,
    mimeType: typeof data?.mimetype === "string" ? data.mimetype : null,
    fileSize: typeof data?.filesize === "number" ? data.filesize : null,
     durationSeconds: typeof data?.duration_seconds === "number" ? data.duration_seconds : null,
     spotifyUrl: typeof data?.spotify_url === "string" ? data.spotify_url : trackUrl,
     fileId: typeof data?.file_id === "string" ? data.file_id : null,
     raw: data || null,
  };
};
