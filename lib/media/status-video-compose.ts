import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ffmpegStatic from "ffmpeg-static";

const ffmpegBin = ffmpegStatic || "ffmpeg";
const TMP_ROOT = path.join(tmpdir(), "botadmin-status-compose");

export type StatusVideoComposeOptions = {
  video: Buffer;
  overlay: Buffer;
  fileName?: string | null;
  mimeType?: string | null;
  backgroundColor: string;
  mediaScale: number;
  mediaX: number;
  mediaY: number;
  mediaRotation: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const extensionFromVideo = (mimeType?: string | null, fileName?: string | null) => {
  const fromName = fileName ? path.extname(fileName).toLowerCase() : "";
  if ([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".3gp"].includes(fromName)) {
    return fromName;
  }
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("quicktime")) return ".mov";
  return ".mp4";
};

const runFfmpeg = (args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg status compose failed (${code}): ${stderr.slice(-1800)}`));
    });
  });

const normalizeColor = (value: string) => {
  const clean = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(clean) ? `0x${clean}` : "0x075E54";
};

export async function composeStatusVideo(options: StatusVideoComposeOptions) {
  if (options.video.length < 1024) throw new Error("status_video_empty");
  if (options.overlay.length < 64) throw new Error("status_overlay_empty");

  await fsp.mkdir(TMP_ROOT, { recursive: true });
  const workDir = path.join(TMP_ROOT, randomUUID());
  await fsp.mkdir(workDir, { recursive: true });
  const input = path.join(
    workDir,
    `source${extensionFromVideo(options.mimeType, options.fileName)}`,
  );
  const overlay = path.join(workDir, "overlay.png");
  const output = path.join(workDir, "status.mp4");
  const scale = clamp(Number(options.mediaScale) || 1, 0.25, 4);
  const alignX = clamp(Number(options.mediaX) || 0, -1.35, 1.35);
  const alignY = clamp(Number(options.mediaY) || 0, -1.35, 1.35);
  const rotation = clamp(Number(options.mediaRotation) || 0, -Math.PI * 100, Math.PI * 100);
  const color = normalizeColor(options.backgroundColor);

  // A mídia começa ocupando 62% da largura e no máximo 42% da altura,
  // exatamente como a camada exibida pelo editor Flutter. O usuário então
  // ajusta escala e posição; o PNG transparente leva texto/formatação.
  const fitScale = `min(669.6/iw,806.4/ih)*${scale.toFixed(5)}`;
  const filter = [
    `[0:v]scale=w='trunc(iw*${fitScale}/2)*2':h='trunc(ih*${fitScale}/2)*2':flags=lanczos,setsar=1,format=rgba,rotate=angle=${rotation.toFixed(7)}:ow='rotw(${rotation.toFixed(7)})':oh='roth(${rotation.toFixed(7)})':c=none[media]`,
    `color=c=${color}:s=1080x1920:r=30[background]`,
    `[background][media]overlay=x='(W-669.6)*((${alignX.toFixed(5)})+1)/2-(w-669.6)/2':y='(H-806.4)*((${alignY.toFixed(5)})+1)/2-(h-806.4)/2':shortest=1[placed]`,
    `[placed][1:v]overlay=0:0:shortest=1,format=yuv420p[video]`,
  ].join(";");

  try {
    await Promise.all([
      fsp.writeFile(input, options.video),
      fsp.writeFile(overlay, options.overlay),
    ]);
    await runFfmpeg(
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-loop",
        "1",
        "-i",
        overlay,
        "-filter_complex",
        filter,
        "-map",
        "[video]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-shortest",
        output,
      ],
      workDir,
    );
    return await fsp.readFile(output);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
