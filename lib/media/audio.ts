import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

const ensureFfmpegConfigured = (() => {
  let configured = false;
  return () => {
    if (!configured && ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
      configured = true;
    }
  };
})();

const sanitizeBaseName = (value: string | null | undefined): string => {
  if (!value) {
    return "audio";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "audio";
  }
  const safe = trimmed.replace(/[^a-z0-9-_]+/gi, "_").replace(/_+/g, "_");
  return safe || "audio";
};

const guessInputExtension = (fileName?: string | null, mimeType?: string | null): string => {
  if (fileName) {
    const ext = path.extname(fileName);
    if (ext) {
      return ext.toLowerCase();
    }
  }
  if (mimeType) {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes("ogg") || normalized.includes("opus")) return ".ogg";
    if (normalized.includes("mpeg") || normalized.includes("mp3")) return ".mp3";
    if (normalized.includes("wav")) return ".wav";
    if (normalized.includes("flac")) return ".flac";
    if (normalized.includes("aac")) return ".aac";
    if (normalized.includes("m4a")) return ".m4a";
    if (normalized.includes("mp4")) return ".mp4";
    if (normalized.includes("webm")) return ".webm";
    if (normalized.includes("matroska") || normalized.includes("mkv")) return ".mkv";
    if (normalized.includes("quicktime") || normalized.includes("mov")) return ".mov";
    if (normalized.includes("3gpp")) return ".3gp";
    if (normalized.includes("avi")) return ".avi";
  }
  return ".bin";
};

const runFfmpegToMp3 = (inputPath: string, outputPath: string, options?: { bitrateKbps?: number; sampleRate?: number; channels?: number }) =>
  new Promise<void>((resolve, reject) => {
    const { bitrateKbps = 192, sampleRate = 44100, channels = 2 } = options ?? {};
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate(`${bitrateKbps}`)
      .audioChannels(channels)
      .audioFrequency(sampleRate)
      .format("mp3")
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(outputPath);
  });

const runFfmpegToVoiceReferenceWav = (inputPath: string, outputPath: string) =>
  new Promise<void>((resolve, reject) => {
    ensureFfmpegConfigured();
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioChannels(1)
      .audioFrequency(44100)
      .audioFilters([
        "highpass=f=80",
        "lowpass=f=12000",
        "afftdn=nf=-25",
        "silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB:stop_periods=1:stop_duration=0.45:stop_threshold=-45dB",
        "loudnorm=I=-18:TP=-2:LRA=9",
      ])
      .format("wav")
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(outputPath);
  });

const runFfmpegToChatGptWav = (inputPath: string, outputPath: string) =>
  new Promise<void>((resolve, reject) => {
    ensureFfmpegConfigured();
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioChannels(1)
      .audioFrequency(48000)
      .audioFilters([
        "highpass=f=80",
        "lowpass=f=7600",
        "afftdn=nf=-25",
        "dynaudnorm=f=150:g=15:p=0.95",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
      ])
      .format("wav")
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(outputPath);
  });

const cleanupFiles = async (...paths: string[]): Promise<void> => {
  for (const file of paths) {
    try {
      await fs.unlink(file);
    } catch {
      // ignore
    }
  }
};

export const convertMediaBufferToMp3 = async (params: {
  buffer: Buffer;
  fileName?: string | null;
  mimeType?: string | null;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
}): Promise<{ buffer: Buffer; fileName: string; mimeType: "audio/mpeg" }> => {
  ensureFfmpegConfigured();
  const { buffer, fileName, mimeType, bitrateKbps, sampleRate, channels } = params;
  const baseName = sanitizeBaseName(fileName?.replace(/\.[^.]+$/, "") || "audio");
  const tmpBase = `tomp3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(tmpdir(), `${tmpBase}-input${guessInputExtension(fileName, mimeType)}`);
  const outputPath = path.join(tmpdir(), `${tmpBase}.mp3`);

  await fs.writeFile(inputPath, buffer);

  try {
    await runFfmpegToMp3(inputPath, outputPath, { bitrateKbps, sampleRate, channels });
    const mp3Buffer = await fs.readFile(outputPath);
    return {
      buffer: mp3Buffer,
      fileName: `${baseName}.mp3`,
      mimeType: "audio/mpeg",
    };
  } finally {
    await cleanupFiles(inputPath, outputPath);
  }
};

export const convertMediaBufferToVoiceReferenceWav = async (params: {
  buffer: Buffer;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<{ buffer: Buffer; fileName: string; mimeType: "audio/wav" }> => {
  ensureFfmpegConfigured();
  const { buffer, fileName, mimeType } = params;
  const baseName = sanitizeBaseName(fileName?.replace(/\.[^.]+$/, "") || "reference");
  const tmpBase = `voice_ref_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(tmpdir(), `${tmpBase}-input${guessInputExtension(fileName, mimeType)}`);
  const outputPath = path.join(tmpdir(), `${tmpBase}.wav`);

  await fs.writeFile(inputPath, buffer);

  try {
    await runFfmpegToVoiceReferenceWav(inputPath, outputPath);
    const wavBuffer = await fs.readFile(outputPath);
    return {
      buffer: wavBuffer,
      fileName: `${baseName}.wav`,
      mimeType: "audio/wav",
    };
  } finally {
    await cleanupFiles(inputPath, outputPath);
  }
};

export const convertMediaBufferToChatGptWav = async (params: {
  buffer: Buffer;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<{ buffer: Buffer; fileName: string; mimeType: "audio/wav" }> => {
  ensureFfmpegConfigured();
  const { buffer, fileName, mimeType } = params;
  const baseName = sanitizeBaseName(fileName?.replace(/\.[^.]+$/, "") || "audio");
  const tmpBase = `chatgpt_wav_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(tmpdir(), `${tmpBase}-input${guessInputExtension(fileName, mimeType)}`);
  const outputPath = path.join(tmpdir(), `${tmpBase}.wav`);

  await fs.writeFile(inputPath, buffer);

  try {
    await runFfmpegToChatGptWav(inputPath, outputPath);
    const wavBuffer = await fs.readFile(outputPath);
    return {
      buffer: wavBuffer,
      fileName: `${baseName}.wav`,
      mimeType: "audio/wav",
    };
  } finally {
    await cleanupFiles(inputPath, outputPath);
  }
};
