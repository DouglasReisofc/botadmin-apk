import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createCanvas, loadImage, registerFont } from "lib/utils/canvas-node";
import type { CanvasRenderingContext2D } from "lib/utils/canvas-node";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { fileTypeFromBuffer } from "file-type";
import { parse as parseEmoji } from "twemoji-parser";
import { createFrase2Card } from "lib/cards/frase-cards";

const FONTS_DIR = path.join(process.cwd(), "lib", "integrations", "apis", "funcoes", "fonts");
const TMP_ROOT = path.join(tmpdir(), "botadm-frase-video");
const ffmpegBin = ffmpegStatic || "ffmpeg";
const ffprobeBin = ffprobeStatic.path || "ffprobe";

let fontsRegistered = false;
const ensureFonts = () => {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const tryRegister = (file: string, family: string, weight: string | number) => {
    const fullPath = path.join(FONTS_DIR, file);
    if (fs.existsSync(fullPath)) {
      registerFont(fullPath, { family, weight });
    }
  };
  try {
    tryRegister("Inter-Regular.ttf", "Inter", "400");
    tryRegister("Inter-Bold.ttf", "InterBold", "700");
    tryRegister("Inter-ExtraBold.ttf", "InterExtra", "800");
    tryRegister("Inter-SemiBold.ttf", "InterSemi", "600");
  } catch {
    /* ignore font errors */
  }
};

const ensureTmpDir = async () => {
  await fsp.mkdir(TMP_ROOT, { recursive: true }).catch(() => {});
};

const randomFilePath = (prefix: string, ext: string) => path.join(TMP_ROOT, `${prefix}-${randomUUID()}${ext}`);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const measureTextWithEmoji = (ctx: CanvasRenderingContext2D, text: string, emojiSize: number) => {
  const tokens = parseEmoji(text || "");
  let width = 0;
  let last = 0;
  for (const token of tokens) {
    if (token.indices[0] > last) {
      width += ctx.measureText(text.slice(last, token.indices[0])).width;
    }
    width += emojiSize;
    last = token.indices[1];
  }
  if (last < text.length) {
    width += ctx.measureText(text.slice(last)).width;
  }
  return width;
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

const parseRichTokens = (raw: string) => {
  const text = raw ?? "";
  const segments: Array<{ text: string; bold: boolean }> = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false });
  }

  type Token = { text: string; bold: boolean; newline?: boolean; space?: boolean };
  const tokens: Token[] = [];

  for (const segment of segments) {
    const parts = segment.text.split(/(\n)/g);
    for (const part of parts) {
      if (part === "\n") {
        tokens.push({ text: "", bold: false, newline: true });
        continue;
      }
      if (!part) continue;
      const slice = part.split(/(\s+)/);
      for (const piece of slice) {
        if (!piece) continue;
        const isSpace = /^\s+$/.test(piece);
        tokens.push({ text: piece, bold: segment.bold && !isSpace, space: isSpace });
      }
    }
  }
  return tokens;
};

const wrapTokens = (
  ctx: CanvasRenderingContext2D,
  fontSize: number,
  maxWidth: number,
  tokens: ReturnType<typeof parseRichTokens>,
) => {
  const lines: Array<Array<{ text: string; bold: boolean; space?: boolean; width: number }>> = [];
  let current: Array<{ text: string; bold: boolean; space?: boolean; width: number }> = [];
  let width = 0;
  const lineHeight = Math.round(fontSize * 1.28);
  const setFont = (bold: boolean) => {
    ctx.font = `${bold ? "700" : "400"} ${fontSize}px ${bold ? "InterBold, InterExtra, Inter" : "Inter, InterSemi, sans-serif"}`;
  };

  for (const token of tokens) {
    if (token.newline) {
      if (current.length) {
        lines.push(current);
      }
      current = [];
      width = 0;
      continue;
    }
    setFont(Boolean(token.bold));
    const measured = token.space
      ? ctx.measureText(token.text).width
      : measureTextWithEmoji(ctx, token.text, fontSize);
    if (!token.space && width + measured > maxWidth && current.length) {
      lines.push(current);
      current = [];
      width = 0;
    }
    current.push({ text: token.text, bold: Boolean(token.bold), space: token.space, width: measured });
    width += measured;
  }
  if (current.length) {
    lines.push(current);
  }
  return { lines, lineHeight };
};

const saveOverlayBuffer = async (buffer: Buffer) => {
  await ensureTmpDir();
  const filePath = randomFilePath("overlay", ".png");
  await fsp.writeFile(filePath, buffer);
  return filePath;
};

const drawVariant1Overlay = async (
  width: number,
  height: number,
  text: string,
  overlayPct?: number | null,
  fontPct?: number | null,
  fontAbs?: number | null,
) => {
  ensureFonts();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const overlayAlpha = overlayPct != null ? clamp((overlayPct > 1 ? overlayPct / 100 : overlayPct), 0.1, 0.85) : 0.4;
  const baseFont = fontAbs ?? Math.round(height * ((fontPct ?? 3.6) / 100));
  const fontSize = clamp(baseFont, 26, 84);
  const maxTextWidth = Math.round(width * 0.78);
  const horizontalPadding = Math.round(fontSize * 1.2);
  const verticalPadding = Math.round(fontSize * 1.1);
  const tokens = parseRichTokens(text);
  const { lines, lineHeight } = wrapTokens(ctx, fontSize, maxTextWidth, tokens);
  const contentHeight = lines.length * lineHeight + Math.max(0, lines.length - 1) * Math.round(fontSize * 0.1);
  const boxWidth = Math.round(maxTextWidth + horizontalPadding * 2);
  const boxHeight = contentHeight + verticalPadding * 2;
  const boxX = Math.round((width - boxWidth) / 2);
  const boxY = Math.round((height - boxHeight) / 2);

  ctx.save();
  ctx.globalAlpha = overlayAlpha;
  drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, Math.round(fontSize * 0.8));
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  let cursorY = boxY + verticalPadding;
  for (const line of lines) {
    const lineWidth = line.reduce((acc, tk) => acc + tk.width, 0);
    let cursorX = Math.round((width - lineWidth) / 2);
    for (const token of line) {
      ctx.font = `${token.bold ? "700" : "400"} ${fontSize}px ${token.bold ? "InterBold, InterExtra, Inter" : "Inter, InterSemi, sans-serif"}`;
      ctx.fillStyle = token.bold ? "#fff" : "rgba(255,255,255,0.92)";
      if (token.bold && !token.space) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        drawRoundedRect(
          ctx,
          cursorX - Math.round(fontSize * 0.2),
          cursorY - Math.round(fontSize * 0.15),
          token.width + Math.round(fontSize * 0.4),
          fontSize + Math.round(fontSize * 0.3),
          Math.round(fontSize * 0.35),
        );
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.restore();
      }
      ctx.fillText(token.text, cursorX, cursorY);
      cursorX += token.width;
    }
    cursorY += lineHeight;
  }

  return saveOverlayBuffer(canvas.toBuffer("image/png"));
};

const drawVariant2Overlay = async (
  width: number,
  height: number,
  text: string,
  name: string,
  handle: string,
) => {
  ensureFonts();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cardBuffer = await createFrase2Card({
    name,
    handle,
    text,
  });
  const cardImage = await loadImage(cardBuffer);
  const maxCardWidth = width * 0.78;
  const maxCardHeight = height * 0.72;
  const scale = Math.min(maxCardWidth / cardImage.width, maxCardHeight / cardImage.height);
  const cardWidth = cardImage.width * scale;
  const cardHeight = cardImage.height * scale;
  const cardX = Math.round((width - cardWidth) / 2);
  const cardY = Math.round((height - cardHeight) / 2);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.round(40 * scale);
  ctx.shadowOffsetY = Math.round(24 * scale);
  ctx.drawImage(cardImage, cardX, cardY, cardWidth, cardHeight);
  ctx.restore();

  return saveOverlayBuffer(canvas.toBuffer("image/png"));
};

const probeVideoDimensions = async (filePath: string): Promise<{ width: number; height: number } | null> => {
  return new Promise((resolve) => {
    const ff = spawn(ffprobeBin, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      filePath,
    ]);
    let output = "";
    ff.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    ff.on("close", () => {
      const match = output.trim().match(/^(\d+)x(\d+)$/);
      if (match) {
        resolve({ width: Number(match[1]), height: Number(match[2]) });
      } else {
        resolve(null);
      }
    });
    ff.on("error", () => resolve(null));
  });
};

const runFfmpegCompose = async (
  inputPath: string,
  overlayPath: string,
  outputPath: string,
  dims: { width: number; height: number },
  dimAlpha: number,
) => {
  const filter = [
    `[0:v]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase`,
    `,crop=${dims.width}:${dims.height}`,
    ",format=rgba",
    `,drawbox=0:0:iw:ih:color=black@${dimAlpha.toFixed(2)}:t=fill[v0];`,
    `[1:v]scale=${dims.width}:${dims.height}[ovr];`,
    `[v0][ovr]overlay=0:0:shortest=1:format=auto[v]`,
  ].join("");

  await new Promise<void>((resolve, reject) => {
    const ff = spawn(ffmpegBin, [
      "-y",
      "-i",
      inputPath,
      "-loop",
      "1",
      "-i",
      overlayPath,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    let stderr = "";
    ff.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    ff.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
    ff.on("error", (error) => reject(error));
  });
};

const writeInputSource = async (
  source: FraseVideoSource,
): Promise<{ path: string; cleanup: boolean }> => {
  await ensureTmpDir();
  if (source.kind === "url") {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Falha ao baixar vídeo (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    let ext = ".mp4";
    try {
      const ft = await fileTypeFromBuffer(buffer);
      if (ft?.ext) {
        ext = `.${ft.ext}`;
      }
    } catch {}
    const filePath = randomFilePath("frase-video", ext);
    await fsp.writeFile(filePath, buffer);
    return { path: filePath, cleanup: true };
  }

  const buffer = source.buffer;
  if (!buffer || !buffer.length) {
    throw new Error("Fonte de vídeo vazia");
  }
  let ext = ".mp4";
  if (source.fileName && path.extname(source.fileName)) {
    ext = path.extname(source.fileName);
  } else {
    try {
      const ft = await fileTypeFromBuffer(buffer);
      if (ft?.ext) {
        ext = `.${ft.ext}`;
      }
    } catch {}
  }
  const filePath = randomFilePath("frase-video", ext);
  await fsp.writeFile(filePath, buffer);
  return { path: filePath, cleanup: true };
};

const cleanupFiles = async (...files: Array<string | null | undefined>) => {
  await Promise.all(
    files
      .filter(Boolean)
      .map(async (file) => {
        try {
          await fsp.unlink(file!);
        } catch {}
      }),
  );
};

export type FraseVideoSource =
  | { kind: "buffer"; buffer: Buffer; mimeType?: string | null; fileName?: string | null }
  | { kind: "url"; url: string };

export type FraseVideoVariant = "v1" | "v2";

export type FraseVideoRenderOptions = {
  source: FraseVideoSource;
  text: string;
  variant: FraseVideoVariant;
  handle: string;
  name?: string | null;
  overlayPct?: number | null;
  fontPct?: number | null;
  fontAbs?: number | null;
};

export const renderFraseVideo = async (options: FraseVideoRenderOptions): Promise<Buffer> => {
  const { source, text, variant, handle, name, overlayPct, fontPct, fontAbs } = options;
  const inputInfo = await writeInputSource(source);
  let overlayPath: string | null = null;
  let outputPath: string | null = null;
  try {
    const dims = (await probeVideoDimensions(inputInfo.path)) ?? { width: 1080, height: 1920 };
    const isVertical = dims.height >= dims.width;
    const targetDims = isVertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

    if (variant === "v2") {
      overlayPath = await drawVariant2Overlay(targetDims.width, targetDims.height, text, name || "Usuário", handle);
    } else {
      overlayPath = await drawVariant1Overlay(targetDims.width, targetDims.height, text, overlayPct, fontPct, fontAbs);
    }

    outputPath = randomFilePath("frase-video-out", ".mp4");
    const dimAlpha = variant === "v2" ? 0.25 : overlayPct != null ? clamp((overlayPct > 1 ? overlayPct / 100 : overlayPct) * 0.8, 0.15, 0.9) : 0.35;
    await runFfmpegCompose(inputInfo.path, overlayPath, outputPath, targetDims, dimAlpha);
    const buffer = await fsp.readFile(outputPath);
    return buffer;
  } finally {
    await cleanupFiles(inputInfo.cleanup ? inputInfo.path : null, overlayPath, outputPath);
  }
};
