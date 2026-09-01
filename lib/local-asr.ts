import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";

export type LocalAsrResult = {
  text: string | null;
  reason?: string;
  language?: string | null;
  languageProbability?: number | null;
  words?: Array<{ text: string; start: number; end: number }>;
};

const DEFAULT_LOCAL_ASR_PYTHON = "/root/venvs/fish-speech/bin/python";
const DEFAULT_SMALL_MODEL_ROOT = "/root/.cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots";
const DEFAULT_TINY_MODEL_ROOT = "/root/.cache/huggingface/hub/models--Systran--faster-whisper-tiny/snapshots";

const guessInputExtension = (fileName?: string | null, mimeType?: string | null): string => {
  const fromName = fileName ? path.extname(fileName).toLowerCase() : "";
  if (fromName && fromName.length <= 8) return fromName;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("flac")) return ".flac";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("amr")) return ".amr";
  return ".bin";
};

const firstSnapshot = async (root: string): Promise<string | null> => {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort();
    return dirs[0] ?? null;
  } catch {
    return null;
  }
};

const resolveLocalAsrModel = async (): Promise<string> => {
  const configured = process.env.BOTADMIN_LOCAL_ASR_MODEL?.trim();
  if (configured) return configured;
  return (
    (await firstSnapshot(DEFAULT_SMALL_MODEL_ROOT)) ??
    (await firstSnapshot(DEFAULT_TINY_MODEL_ROOT)) ??
    "small"
  );
};

const runLocalAsr = (
  pythonBin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; signal: NodeJS.Signals | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HF_HUB_OFFLINE: process.env.BOTADMIN_LOCAL_ASR_OFFLINE ?? "1",
      },
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 20000) stdout = stdout.slice(-20000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, signal });
    });
  });

export const transcribeAudioLocally = async (params: {
  buffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
  language?: string | null;
  timeoutMs?: number;
}): Promise<LocalAsrResult> => {
  const pythonBin = process.env.BOTADMIN_LOCAL_ASR_PYTHON?.trim() || DEFAULT_LOCAL_ASR_PYTHON;
  const scriptPath = path.join(process.cwd(), "scripts", "local-asr-transcribe.py");
  const timeoutMs = Math.max(10_000, Math.min(180_000, params.timeoutMs ?? 120_000));
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "botadmin-local-asr-"));
  const audioPath = path.join(workDir, `audio${guessInputExtension(params.fileName, params.mimeType)}`);

  try {
    await fs.access(pythonBin);
    await fs.access(scriptPath);
    await fs.writeFile(audioPath, params.buffer);
    const model = await resolveLocalAsrModel();
    const result = await runLocalAsr(
      pythonBin,
      [
        scriptPath,
        "--audio",
        audioPath,
        "--model",
        model,
        "--device",
        process.env.BOTADMIN_LOCAL_ASR_DEVICE?.trim() || "cpu",
        "--compute-type",
        process.env.BOTADMIN_LOCAL_ASR_COMPUTE_TYPE?.trim() || "int8",
        "--language",
        params.language?.trim() || process.env.BOTADMIN_LOCAL_ASR_LANGUAGE?.trim() || "pt",
      ],
      timeoutMs,
    );
    if (result.signal) {
      return { text: null, reason: `local_asr_killed_${result.signal}` };
    }
    if (result.code !== 0) {
      return {
        text: null,
        reason: (result.stderr || result.stdout || `local_asr_exit_${result.code}`).slice(0, 500),
      };
    }
    const payload = JSON.parse(result.stdout.trim()) as {
      text?: string;
      words?: Array<{ text?: string; start?: number; end?: number }>;
      language?: string | null;
      language_probability?: number | null;
    };
    const text = typeof payload.text === "string" ? payload.text.replace(/\s+/g, " ").trim() : "";
    const words = Array.isArray(payload.words)
      ? payload.words
          .map((word) => ({
            text: typeof word.text === "string" ? word.text.replace(/\s+/g, " ").trim() : "",
            start: typeof word.start === "number" ? word.start : Number.NaN,
            end: typeof word.end === "number" ? word.end : Number.NaN,
          }))
          .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
      : [];
    return {
      text: text || null,
      reason: text ? undefined : "empty_local_transcription",
      language: payload.language ?? null,
      languageProbability: typeof payload.language_probability === "number" ? payload.language_probability : null,
      words,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: null, reason: `local_asr_unavailable: ${message}` };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
