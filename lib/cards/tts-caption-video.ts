import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { createCanvas, registerFont } from "lib/utils/canvas-node";
import type { CanvasRenderingContext2D } from "lib/utils/canvas-node";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const TMP_ROOT = path.join(tmpdir(), "botadm-tts-caption-video");
const CARD_FONTS_DIR = path.join(process.cwd(), "lib", "integrations", "apis", "funcoes", "card", "1", "src", "fonts");
const PROJECT_FONTS_DIR = path.join(process.cwd(), "lib", "assets", "fonts");
const ffmpegBin = ffmpegStatic || "ffmpeg";
const ffprobeBin = ffprobeStatic.path || "ffprobe";

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 15;
const DEFAULT_END_HOLD_SECONDS = 0.85;

export type CaptionedAudioVideoStyle = {
  glowColor?: string | null;
  textColor?: string | null;
  inactiveTextColor?: string | null;
  fontScale?: number | null;
  fontPx?: number | null;
  yPct?: number | null;
  rain?: number | null;
  particles?: number | null;
  drops?: number | null;
  backgroundDim?: number | null;
  backgroundBlur?: number | null;
  backgroundSaturation?: number | null;
  captionLeadSeconds?: number | null;
  quality?: "standard" | "high" | "max";
};

type CaptionWord = {
  raw: string;
  text: string;
  start: number;
  end: number;
};

export type CaptionedAudioTimedWord = {
  text: string;
  start: number;
  end: number;
};

type NormalizedCaptionVideoStyle = {
  glowColor: string;
  textColor: string;
  inactiveTextColor: string;
  fontScale: number;
  fontPx: number;
  yPct: number;
  rain: number;
  particles: number;
  drops: number;
  backgroundDim: number;
  backgroundBlur: number;
  backgroundSaturation: number;
  captionLeadSeconds: number;
};

export type CaptionedAudioVideoOptions = {
  audioBuffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
  text: string;
  timedWords?: CaptionedAudioTimedWord[] | null;
  width?: number;
  height?: number;
  fps?: number;
  backgroundVideoBuffer?: Buffer | null;
  backgroundMimeType?: string | null;
  backgroundFileName?: string | null;
  style?: CaptionedAudioVideoStyle;
};

let fontsRegistered = false;

const ensureFonts = () => {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const tryRegister = (file: string, family: string, weight?: string | number) => {
    const fullPath = path.join(CARD_FONTS_DIR, file);
    if (fs.existsSync(fullPath)) {
      registerFont(fullPath, weight ? { family, weight } : { family });
    }
  };
  try {
    const sketchFont = path.join(PROJECT_FONTS_DIR, "go-around-the-books-2022.ttf");
    if (fs.existsSync(sketchFont)) {
      registerFont(sketchFont, { family: "Go around the books 2022" });
      registerFont(sketchFont, { family: "GoAroundBooks" });
    }
    tryRegister("JosefinSans-Regular.ttf", "CaptionSans", "400");
    tryRegister("bold.ttf", "CaptionBold", "800");
    tryRegister("LemonMilk.otf", "CaptionDisplay", "800");
  } catch {
    /* font registration is best effort */
  }
};

const ensureTmpDir = async () => {
  await fsp.mkdir(TMP_ROOT, { recursive: true }).catch(() => {});
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const stripControlChars = (value: string) =>
  (value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/([.!?])(?=\p{L})/gu, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

const runBinary = (binary: string, args: string[], cwd?: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(binary)} exited with code ${code}: ${stderr.slice(-1000)}`));
    });
  });

const probeAudioDuration = (inputPath: string) =>
  new Promise<number>((resolve) => {
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
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const value = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    });
  });

const extensionFromAudio = (mimeType?: string | null, fileName?: string | null) => {
  const fromName = fileName ? path.extname(fileName).toLowerCase() : "";
  if (fromName && fromName.length <= 8) return fromName;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("ogg") || mime.includes("opus")) return ".ogg";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("flac")) return ".flac";
  return ".mp3";
};

const extensionFromVideo = (mimeType?: string | null, fileName?: string | null) => {
  const fromName = fileName ? path.extname(fileName).toLowerCase() : "";
  if (fromName && [".mp4", ".mov", ".mkv", ".webm", ".m4v", ".3gp"].includes(fromName)) return fromName;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("quicktime") || mime.includes("mov")) return ".mov";
  if (mime.includes("3gpp")) return ".3gp";
  return ".mp4";
};

const normalizeHexColor = (value: string | null | undefined, fallback: string) => {
  const raw = (value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`;
  const named: Record<string, string> = {
    branco: "#ffffff",
    white: "#ffffff",
    vermelho: "#ff341f",
    red: "#ff341f",
    azul: "#80bfff",
    blue: "#80bfff",
    roxo: "#b98cff",
    purple: "#b98cff",
    verde: "#8dffcc",
    green: "#8dffcc",
    rosa: "#ff8acb",
    pink: "#ff8acb",
  };
  return named[raw.toLowerCase()] || fallback;
};

const hexToRgb = (hex: string) => {
  const clean = normalizeHexColor(hex, "#ffffff").slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
};

const rgba = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp(alpha, 0, 1).toFixed(3)})`;
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = (seed: number, index: number) => {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) % 10000) / 10000;
};

const createParticles = (seed: number, width: number, height: number, intensity: number) =>
  Array.from({ length: Math.round(155 * intensity) }, (_, index) => ({
    x: seededRandom(seed, index * 5 + 1) * width,
    y: seededRandom(seed, index * 5 + 2) * height,
    r: 0.35 + seededRandom(seed, index * 5 + 3) * 0.95,
    phase: seededRandom(seed, index * 5 + 4) * Math.PI * 2,
    speed: 0.18 + seededRandom(seed, index * 5 + 5) * 0.72,
  }));

const createRainStreaks = (seed: number, width: number, height: number, intensity: number) =>
  Array.from({ length: Math.round(135 * intensity) }, (_, index) => ({
    x: seededRandom(seed, index * 7 + 11) * width,
    y: seededRandom(seed, index * 7 + 12) * height,
    length: height * (0.055 + seededRandom(seed, index * 7 + 13) * 0.095),
    alpha: 0.05 + seededRandom(seed, index * 7 + 14) * 0.12,
    speed: height * (0.34 + seededRandom(seed, index * 7 + 15) * 0.56),
    tilt: width * (0.006 + seededRandom(seed, index * 7 + 16) * 0.014),
    width: 0.45 + seededRandom(seed, index * 7 + 17) * 0.95,
  }));

const createLensDrops = (seed: number, width: number, height: number, intensity: number) =>
  Array.from({ length: Math.round(24 * intensity) }, (_, index) => ({
    x: seededRandom(seed, index * 6 + 31) * width,
    y: seededRandom(seed, index * 6 + 32) * height,
    r: width * (0.0035 + seededRandom(seed, index * 6 + 33) * 0.012),
    alpha: 0.035 + seededRandom(seed, index * 6 + 34) * 0.085,
    speed: height * (0.018 + seededRandom(seed, index * 6 + 35) * 0.04),
  }));

const makeCaptionWords = (text: string, speechDuration: number, displayDuration = speechDuration): CaptionWord[] => {
  const tokens = stripControlChars(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return [{ raw: "...", text: "...", start: 0, end: Math.max(displayDuration, speechDuration, 1) }];
  }
  const startDelay = Math.min(0.32, Math.max(0, speechDuration * 0.004));
  const usableDuration = Math.max(speechDuration - startDelay, tokens.length * 0.23, 1);
  const weights = tokens.map((token) => {
    const cleanLength = token.replace(/[^\p{L}\p{N}]/gu, "").length || token.length;
    const hasEllipsis = /(?:\.{2,}|…)/u.test(token);
    const punctuationPause = hasEllipsis
      ? 1.45
      : /[.!?]["')\]]?$/u.test(token)
        ? 0.78
        : /[,;:]["')\]]?$/u.test(token)
          ? 0.28
          : 0;
    return clamp(0.34 + Math.sqrt(cleanLength) * 0.34 + cleanLength * 0.035 + punctuationPause, 0.5, 3.4);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = startDelay;
  return tokens.map((token, index) => {
    const length = index === tokens.length - 1
      ? Math.max(displayDuration, speechDuration) - cursor
      : (weights[index] / totalWeight) * usableDuration;
    const start = cursor;
    const end = index === tokens.length - 1 ? Math.max(displayDuration, speechDuration) : cursor + length;
    cursor = end;
    return {
      raw: token,
      text: token.toUpperCase(),
      start,
      end,
    };
  });
};

const normalizeTimedCaptionWords = (
  timedWords: CaptionedAudioTimedWord[] | null | undefined,
  displayDuration: number,
): CaptionWord[] => {
  if (!Array.isArray(timedWords) || timedWords.length === 0) {
    return [];
  }
  return timedWords
    .map((word) => {
      const text = stripControlChars(word.text);
      const start = clamp(Number(word.start), 0, displayDuration);
      if (!text || !Number.isFinite(start) || start >= displayDuration) {
        return null;
      }
      const end = clamp(Number(word.end), start + 0.05, displayDuration);
      if (!Number.isFinite(end) || end <= start) {
        return null;
      }
      return {
        raw: text,
        text: text.toUpperCase(),
        start,
        end,
      };
    })
    .filter((word): word is CaptionWord => Boolean(word));
};

const activeWordIndex = (words: CaptionWord[], time: number) => {
  const index = words.findIndex((word) => time >= word.start && time < word.end);
  if (index >= 0) return index;
  return time >= words[words.length - 1].end ? words.length - 1 : 0;
};

const selectWindow = (words: CaptionWord[], activeIndex: number) => {
  const pageSize = words.length <= 5 ? words.length : 5;
  const start = Math.floor(activeIndex / pageSize) * pageSize;
  const safeStart = clamp(start, 0, Math.max(0, words.length - pageSize));
  return {
    start: safeStart,
    items: words.slice(safeStart, safeStart + pageSize),
  };
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

const wrapCaptionWords = (
  ctx: CanvasRenderingContext2D,
  words: Array<{ text: string; active: boolean }>,
  maxWidth: number,
) => {
  const lines: Array<Array<{ text: string; active: boolean; width: number }>> = [];
  let current: Array<{ text: string; active: boolean; width: number }> = [];
  let lineWidth = 0;
  for (const word of words) {
    const width = ctx.measureText(word.text).width;
    const space = current.length ? ctx.measureText(" ").width : 0;
    if (current.length && lineWidth + space + width > maxWidth) {
      lines.push(current);
      current = [];
      lineWidth = 0;
    }
    current.push({ ...word, width });
    lineWidth += (current.length > 1 ? space : 0) + width;
  }
  if (current.length) lines.push(current);
  return lines;
};

const drawCaptionFrame = (
  ctx: CanvasRenderingContext2D,
  options: {
    width: number;
    height: number;
    time: number;
    duration: number;
    seed: number;
    words: CaptionWord[];
    transparentBackground: boolean;
    style: NormalizedCaptionVideoStyle;
  },
) => {
  const { width, height, time, duration, seed, words, transparentBackground, style } = options;
  ctx.clearRect(0, 0, width, height);
  if (!transparentBackground) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.fillRect(0, 0, width, height);
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.46, 0, width * 0.5, height * 0.46, width * 0.76);
    vignette.addColorStop(0, "rgba(0,0,0,0.22)");
    vignette.addColorStop(0.6, "rgba(0,0,0,0.52)");
    vignette.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  const particles = createParticles(seed, width, height, style.particles);
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    const driftY = ((time * particle.speed * 18) + particle.y) % height;
    const alpha = 0.1 + Math.max(0, Math.sin(time * 1.4 + particle.phase)) * 0.38;
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = particle.r * 2.4;
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(particle.x, driftY, particle.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  const rain = createRainStreaks(seed, width, height, style.rain);
  ctx.lineCap = "round";
  for (const drop of rain) {
    const y = (drop.y + time * drop.speed) % (height + drop.length) - drop.length;
    const x = (drop.x + Math.sin(time * 0.65 + drop.y) * 8) % width;
    const gradient = ctx.createLinearGradient(x, y, x + drop.tilt, y + drop.length);
    gradient.addColorStop(0, rgba(style.glowColor, 0));
    gradient.addColorStop(0.45, rgba(style.glowColor, drop.alpha));
    gradient.addColorStop(1, rgba(style.glowColor, 0));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = drop.width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + drop.tilt, y + drop.length);
    ctx.stroke();
  }

  const lensDrops = createLensDrops(seed, width, height, style.drops);
  for (const drop of lensDrops) {
    const y = (drop.y + time * drop.speed) % height;
    const gloss = ctx.createRadialGradient(drop.x - drop.r * 0.35, y - drop.r * 0.35, 0, drop.x, y, drop.r);
    gloss.addColorStop(0, `rgba(255,255,255,${(drop.alpha * 1.7).toFixed(3)})`);
    gloss.addColorStop(0.44, `rgba(210,225,255,${drop.alpha.toFixed(3)})`);
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.arc(drop.x, y, drop.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const activeTime = clamp(time + style.captionLeadSeconds, 0, duration);
  const activeIndex = activeWordIndex(words, activeTime);
  const window = selectWindow(words, activeIndex);
  const captionWords = window.items.map((word, offset) => ({
    text: word.text,
    active: window.start + offset === activeIndex,
  }));

  const baseFontSize = Math.min(width * 0.135, height * 0.105);
  let fontSize = clamp(
    Math.round(style.fontPx > 0 ? style.fontPx : baseFontSize * style.fontScale),
    56,
    Math.min(260, Math.round(width * 0.2)),
  );
  ctx.font = `400 ${fontSize}px "Go around the books 2022", GoAroundBooks, CaptionDisplay, CaptionBold, Impact, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const maxTextWidth = width * 0.86;
  let lines = wrapCaptionWords(ctx, captionWords, maxTextWidth);
  const minFontSize = Math.max(44, Math.round(fontSize * 0.64));
  while (lines.length > 2 && fontSize > minFontSize) {
    fontSize = Math.max(minFontSize, Math.round(fontSize * 0.9));
    ctx.font = `400 ${fontSize}px "Go around the books 2022", GoAroundBooks, CaptionDisplay, CaptionBold, Impact, sans-serif`;
    lines = wrapCaptionWords(ctx, captionWords, maxTextWidth);
  }
  if (lines.length > 2) {
    lines = [
      lines[0],
      lines.slice(1).flat(),
    ];
  }
  const lineHeight = fontSize * 0.96;
  const centerY = height * style.yPct;

  let y = centerY - lineHeight / 2;
  for (const line of lines) {
    const lineWidth = line.reduce((sum, word, index) => sum + word.width + (index ? ctx.measureText(" ").width : 0), 0);
    let x = (width - lineWidth) / 2;
    for (const word of line) {
      ctx.shadowColor = word.active ? rgba(style.glowColor, 0.98) : rgba(style.glowColor, 0.22);
      ctx.shadowBlur = word.active ? 34 : 7;
      ctx.lineWidth = word.active ? 5 : 4;
      ctx.strokeStyle = word.active ? rgba(style.glowColor, 0.18) : rgba(style.glowColor, 0.055);
      ctx.strokeText(word.text, x, y);
      ctx.fillStyle = word.active ? style.textColor : style.inactiveTextColor;
      ctx.fillText(word.text, x, y);
      x += word.width + ctx.measureText(" ").width;
    }
    y += lineHeight;
  }
  ctx.shadowBlur = 0;
};

export const renderCaptionedAudioVideo = async (options: CaptionedAudioVideoOptions): Promise<Buffer> => {
  if (!options.audioBuffer || options.audioBuffer.length === 0) {
    throw new Error("audio buffer is empty");
  }
  const cleanText = stripControlChars(options.text);
  if (!cleanText) {
    throw new Error("caption text is empty");
  }

  ensureFonts();
  await ensureTmpDir();

  const workDir = path.join(TMP_ROOT, randomUUID());
  await fsp.mkdir(workDir, { recursive: true });
  try {
    const width = clamp(Math.round(options.width || DEFAULT_WIDTH), 640, 1920);
    const height = clamp(Math.round(options.height || DEFAULT_HEIGHT), 360, 1920);
    const fps = clamp(Math.round(options.fps || DEFAULT_FPS), 6, 24);
    const style = normalizeStyle(options.style);
    const quality = options.style?.quality || "high";
    const audioPath = path.join(workDir, `audio${extensionFromAudio(options.mimeType, options.fileName)}`);
    const backgroundPath = options.backgroundVideoBuffer && options.backgroundVideoBuffer.length > 0
      ? path.join(workDir, `background${extensionFromVideo(options.backgroundMimeType, options.backgroundFileName)}`)
      : null;
    const outputPath = path.join(workDir, "caption-video.mp4");
    await fsp.writeFile(audioPath, options.audioBuffer);
    if (backgroundPath && options.backgroundVideoBuffer) {
      await fsp.writeFile(backgroundPath, options.backgroundVideoBuffer);
    }

    const audioDuration = await probeAudioDuration(audioPath);
    const speechDuration = Math.max(audioDuration || Math.max(3, cleanText.split(/\s+/).length * 0.42), 1.5);
    const duration = speechDuration + DEFAULT_END_HOLD_SECONDS;
    const frameCount = Math.max(1, Math.ceil(duration * fps));
    const timedWords = normalizeTimedCaptionWords(options.timedWords, speechDuration);
    const words = timedWords.length > 0
      ? timedWords
      : makeCaptionWords(cleanText, speechDuration, duration);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const seed = hashString(cleanText);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = Math.min(duration, frame / fps);
      drawCaptionFrame(ctx, {
        width,
        height,
        time,
        duration,
        seed,
        words,
        transparentBackground: Boolean(backgroundPath),
        style,
      });
      const framePath = path.join(workDir, `frame-${String(frame).padStart(5, "0")}.png`);
      await fsp.writeFile(framePath, canvas.toBuffer("image/png"));
    }

    const crf = quality === "max" ? "16" : quality === "high" ? "18" : "22";
    const preset = quality === "max" ? "slow" : quality === "high" ? "medium" : "veryfast";
    if (backgroundPath) {
      const dimBrightness = -(style.backgroundDim * 0.78);
      const blur = Math.round(style.backgroundBlur);
      const blurFilter = blur > 0 ? `,boxblur=luma_radius=${blur}:luma_power=1:chroma_radius=${Math.max(1, Math.round(blur / 2))}:chroma_power=1` : "";
      await runBinary(ffmpegBin, [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-stream_loop",
        "-1",
        "-i",
        backgroundPath,
        "-framerate",
        String(fps),
        "-start_number",
        "0",
        "-i",
        path.join(workDir, "frame-%05d.png"),
        "-i",
        audioPath,
        "-t",
        String(duration),
        "-filter_complex",
        [
          `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,trim=duration=${duration},setpts=PTS-STARTPTS,eq=brightness=${dimBrightness.toFixed(3)}:contrast=1.08:saturation=${style.backgroundSaturation.toFixed(3)}${blurFilter}[bg]`,
          `[1:v]format=rgba,setpts=PTS-STARTPTS[ov]`,
          "[bg][ov]overlay=0:0:shortest=1[v]",
        ].join(";"),
        "-map",
        "[v]",
        "-map",
        "2:a:0",
        "-af",
        `apad=pad_dur=${DEFAULT_END_HOLD_SECONDS.toFixed(2)}`,
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        crf,
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        outputPath,
      ]);
    } else {
      await runBinary(ffmpegBin, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-framerate",
      String(fps),
      "-start_number",
      "0",
      "-i",
      path.join(workDir, "frame-%05d.png"),
      "-i",
      audioPath,
      "-t",
      String(duration),
      "-af",
      `apad=pad_dur=${DEFAULT_END_HOLD_SECONDS.toFixed(2)}`,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
      ]);
    }

    return await fsp.readFile(outputPath);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
};

const normalizeStyle = (style: CaptionedAudioVideoStyle | undefined): NormalizedCaptionVideoStyle => ({
  glowColor: normalizeHexColor(style?.glowColor, "#ffffff"),
  textColor: normalizeHexColor(style?.textColor, "#ffffff"),
  inactiveTextColor: normalizeHexColor(style?.inactiveTextColor, "#ededed"),
  fontScale: clamp(Number(style?.fontScale ?? 1), 0.55, 1.65),
  fontPx: clamp(Number(style?.fontPx ?? 0), 0, 260),
  yPct: clamp(Number(style?.yPct ?? 0.52), 0.18, 0.82),
  rain: clamp(Number(style?.rain ?? 1), 0, 2.2),
  particles: clamp(Number(style?.particles ?? 1), 0, 2.2),
  drops: clamp(Number(style?.drops ?? 0), 0, 2),
  backgroundDim: clamp(Number(style?.backgroundDim ?? 0.88), 0, 0.96),
  backgroundBlur: clamp(Number(style?.backgroundBlur ?? 4), 0, 18),
  backgroundSaturation: clamp(Number(style?.backgroundSaturation ?? 0.55), 0, 1.6),
  captionLeadSeconds: clamp(Number(style?.captionLeadSeconds ?? 0), -0.6, 0.8),
});
