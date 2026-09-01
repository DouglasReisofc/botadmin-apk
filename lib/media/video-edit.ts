import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const TMP_ROOT = path.join(tmpdir(), "botadm-video-edit");
const ffmpegBin = ffmpegStatic || "ffmpeg";
const ffprobeBin = ffprobeStatic.path || "ffprobe";

export type EditVideoFormat = "shorts" | "square" | "landscape";
export type EditVideoPreset = "viral" | "clean" | "cinematic" | "upscale";
export type EditVideoQuality = "standard" | "high" | "max";

export type EditVideoOptions = {
  inputBuffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
  format?: EditVideoFormat;
  preset?: EditVideoPreset;
  quality?: EditVideoQuality;
  fps?: number;
  width?: number | null;
  height?: number | null;
  trimSeconds?: number | null;
};

export type EditVideoResult = {
  buffer: Buffer;
  mimeType: "video/mp4";
  fileName: string;
  width: number;
  height: number;
  format: EditVideoFormat;
  preset: EditVideoPreset;
};

const ensureTmpDir = async () => {
  await fsp.mkdir(TMP_ROOT, { recursive: true }).catch(() => {});
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const runBinary = (binary: string, args: string[], cwd?: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(binary)} exited with code ${code}: ${stderr.slice(-1600)}`));
    });
  });

const extensionFromVideo = (mimeType?: string | null, fileName?: string | null) => {
  const fromName = fileName ? path.extname(fileName).toLowerCase() : "";
  if (fromName && [".mp4", ".mov", ".mkv", ".webm", ".m4v", ".3gp", ".avi"].includes(fromName)) return fromName;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("quicktime") || mime.includes("mov")) return ".mov";
  if (mime.includes("3gpp")) return ".3gp";
  if (mime.includes("x-msvideo")) return ".avi";
  return ".mp4";
};

const resolveOutputSize = (options: EditVideoOptions) => {
  const format = options.format ?? "shorts";
  let width = 1080;
  let height = 1920;
  if (format === "square") {
    width = 1080;
    height = 1080;
  } else if (format === "landscape") {
    width = 1920;
    height = 1080;
  }
  if (typeof options.width === "number" && Number.isFinite(options.width)) {
    width = Math.round(clamp(options.width, 480, 2160));
  }
  if (typeof options.height === "number" && Number.isFinite(options.height)) {
    height = Math.round(clamp(options.height, 480, 2160));
  }
  if (width % 2 !== 0) width += 1;
  if (height % 2 !== 0) height += 1;
  return { width, height, format };
};

const resolveQuality = (quality: EditVideoQuality) => {
  if (quality === "max") return { crf: "17", preset: "slow", audioBitrate: "192k" };
  if (quality === "high") return { crf: "19", preset: "medium", audioBitrate: "160k" };
  return { crf: "22", preset: "veryfast", audioBitrate: "128k" };
};

const buildVideoFilter = (width: number, height: number, fps: number, preset: EditVideoPreset) => {
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width}:${height}`,
    "setsar=1",
    `fps=${fps}`,
  ];

  if (preset === "clean") {
    filters.push("hqdn3d=1.0:1.0:4.0:4.0", "unsharp=5:5:0.35:3:3:0.18", "eq=contrast=1.025:saturation=1.045");
  } else if (preset === "cinematic") {
    filters.push("hqdn3d=1.2:1.2:5.0:5.0", "unsharp=5:5:0.42:3:3:0.20", "eq=contrast=1.075:saturation=1.12:brightness=0.006");
  } else if (preset === "upscale") {
    filters.push("hqdn3d=1.5:1.5:6.0:6.0", "unsharp=7:7:0.62:5:5:0.28", "eq=contrast=1.045:saturation=1.08");
  } else {
    filters.push("hqdn3d=1.35:1.35:5.5:5.5", "unsharp=5:5:0.55:3:3:0.24", "eq=contrast=1.055:saturation=1.10:brightness=0.004");
  }

  filters.push("format=yuv420p");
  return filters.join(",");
};

export const editVideoForShorts = async (options: EditVideoOptions): Promise<EditVideoResult> => {
  if (!options.inputBuffer || options.inputBuffer.length < 1024) {
    throw new Error("video_input_empty");
  }

  await ensureTmpDir();
  const workDir = path.join(TMP_ROOT, randomUUID());
  await fsp.mkdir(workDir, { recursive: true });

  const inputPath = path.join(workDir, `input${extensionFromVideo(options.mimeType, options.fileName)}`);
  const outputPath = path.join(workDir, "edited.mp4");
  const preset = options.preset ?? "viral";
  const quality = options.quality ?? "high";
  const { width, height, format } = resolveOutputSize(options);
  const fps = Math.round(clamp(Number(options.fps ?? 30), 18, 60));
  const qualitySettings = resolveQuality(quality);
  const trimSeconds =
    typeof options.trimSeconds === "number" && Number.isFinite(options.trimSeconds) && options.trimSeconds > 0
      ? clamp(options.trimSeconds, 1, 600)
      : null;

  try {
    await fsp.writeFile(inputPath, options.inputBuffer);
    const ffmpegArgs = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      ...(trimSeconds ? ["-t", trimSeconds.toFixed(3)] : []),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      buildVideoFilter(width, height, fps, preset),
      "-af",
      "loudnorm=I=-14:TP=-1.5:LRA=11",
      "-map_metadata",
      "-1",
      "-metadata",
      "title=",
      "-metadata",
      "comment=",
      "-c:v",
      "libx264",
      "-preset",
      qualitySettings.preset,
      "-crf",
      qualitySettings.crf,
      "-profile:v",
      "high",
      "-level",
      "4.2",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      qualitySettings.audioBitrate,
      "-movflags",
      "+faststart",
      "-max_muxing_queue_size",
      "1024",
      outputPath,
    ];

    await runBinary(ffmpegBin, ffmpegArgs, workDir);
    const buffer = await fsp.readFile(outputPath);
    return {
      buffer,
      mimeType: "video/mp4",
      fileName: `edit-${format}-${Date.now()}.mp4`,
      width,
      height,
      format,
      preset,
    };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

export const probeEditableVideoDuration = async (buffer: Buffer, mimeType?: string | null, fileName?: string | null) => {
  await ensureTmpDir();
  const workDir = path.join(TMP_ROOT, randomUUID());
  await fsp.mkdir(workDir, { recursive: true });
  const inputPath = path.join(workDir, `input${extensionFromVideo(mimeType, fileName)}`);
  try {
    await fsp.writeFile(inputPath, buffer);
    const childOutput = await new Promise<string>((resolve) => {
      const child = spawn(ffprobeBin, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputPath,
      ], { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("error", () => resolve(""));
      child.on("close", () => resolve(stdout.trim()));
    });
    const parsed = Number.parseFloat(childOutput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};
