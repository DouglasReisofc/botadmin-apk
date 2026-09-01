import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, registerFont } from "lib/utils/canvas-node";
import type { CanvasRenderingContext2D } from "lib/utils/canvas-node";
import { parse as parseEmoji } from "twemoji-parser";

const FONTS_DIR = path.join(process.cwd(), "lib", "integrations", "apis", "funcoes", "fonts");
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
    tryRegister("Inter-Bold.ttf", "Inter", "700");
    tryRegister("Inter-SemiBold.ttf", "InterSemi", "600");
  } catch {
    // fonts são opcionais; em último caso fallbacks do sistema serão usados
  }
};

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar recurso: ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const loadAnyImage = async (src?: string | Buffer | null) => {
  if (!src) return null;
  try {
    if (Buffer.isBuffer(src)) {
      return await loadImage(src);
    }
    if (/^https?:\/\//i.test(src)) {
      const buffer = await fetchBuffer(src);
      return await loadImage(buffer);
    }
    const absolute = path.isAbsolute(src) ? src : path.resolve(src);
    return await loadImage(absolute);
  } catch {
    return null;
  }
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

const VERIFIED_ICON_PATH = path.join(process.cwd(), "resources", "verificado.png");
let verifiedIconPromise: Promise<ReturnType<typeof loadImage> | null> | null = null;

const getVerifiedIcon = async () => {
  if (!verifiedIconPromise) {
    verifiedIconPromise = loadAnyImage(VERIFIED_ICON_PATH);
  }
  return verifiedIconPromise;
};

const drawVerifiedBadge = async (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) => {
  const icon = await getVerifiedIcon();
  if (icon) {
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(icon, x, y, size, size);
    ctx.restore();
    return;
  }
  // Fallback: simple circle check if asset is missing
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1DA1F2";
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.3, y + size * 0.55);
  ctx.lineTo(x + size * 0.47, y + size * 0.72);
  ctx.lineTo(x + size * 0.74, y + size * 0.35);
  ctx.stroke();
  ctx.restore();
};

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

const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, emojiSize: number) => {
  const paragraphs = (text || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((p) => p.trim());
  const lines: string[] = [];
  const appendParagraph = (paragraph: string) => {
    if (!paragraph) {
      lines.push("");
      return;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (let i = 0; i < words.length; i += 1) {
      const candidate = line ? `${line} ${words[i]}` : words[i];
      if (measureTextWithEmoji(ctx, candidate, emojiSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
      }
      let remaining = words[i];
      while (measureTextWithEmoji(ctx, remaining, emojiSize) > maxWidth) {
        let cut = 1;
        while (
          cut < remaining.length &&
          measureTextWithEmoji(ctx, remaining.slice(0, cut + 1), emojiSize) <= maxWidth
        ) {
          cut += 1;
        }
        lines.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
      }
      line = remaining;
    }
    if (line) {
      lines.push(line);
    }
  };

  paragraphs.forEach((paragraph, index) => {
    appendParagraph(paragraph);
    if (index < paragraphs.length - 1) {
      lines.push("");
    }
  });

  if (!paragraphs.length) {
    appendParagraph("");
  }
  return lines;
};

const drawTextWithEmoji = async (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  textSize: number,
  color?: string,
) => {
  const tokens = parseEmoji(text || "");
  let cursor = x;
  let last = 0;
  for (const token of tokens) {
    if (token.indices[0] > last) {
      const part = text.slice(last, token.indices[0]);
      if (color) ctx.fillStyle = color;
      ctx.fillText(part, cursor, y);
      cursor += ctx.measureText(part).width;
    }
    const emojiImg = await loadAnyImage(token.url);
    if (emojiImg) {
      ctx.drawImage(emojiImg, cursor, y, textSize, textSize);
    }
    cursor += textSize;
    last = token.indices[1];
  }
  if (last < text.length) {
    const part = text.slice(last);
    if (color) ctx.fillStyle = color;
    ctx.fillText(part, cursor, y);
  }
};

const getCanvasSize = (opts: { width?: number; height?: number; preset?: string }) => {
  const { width, height, preset } = opts || {};
  if (width && height) return { W: Math.round(width), H: Math.round(height) };
  const p = String(preset || "").toLowerCase();
  if (p === "16:9" || p === "16x9" || p === "widescreen") return { W: 1920, H: 1080 };
  return { W: 1080, H: 1080 };
};

type FraseCardBaseOptions = {
  name?: string;
  handle?: string;
  text: string;
  avatar?: string | null;
  textWeight?: number | string;
  textScale?: number;
};

export type FraseCardOptions = FraseCardBaseOptions & {
  bg?: string | null;
  border?: string | null;
  preset?: string;
  valign?: string;
  width?: number;
  height?: number;
};

export type Frase2CardOptions = FraseCardBaseOptions & {
  width?: number;
  height?: number;
  centerBias?: number;
};

export type Frase4CardOptions = {
  image: Buffer | string;
  text: string;
  width?: number;
  height?: number;
  handle?: string | null;
};

export const createFraseCard = async (options: FraseCardOptions): Promise<Buffer> => {
  ensureFonts();

  const {
    name = "Douglas Reis",
    handle = "@seu_usuario",
    text,
    bg,
    avatar,
    border = null,
    preset = "square",
    valign = "center",
    width,
    height,
    textWeight = "400",
    textScale = 1,
  } = options;

  const { W, H } = getCanvasSize({ width, height, preset });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const scale = Math.min(W, H) / 1080;
  const margin = Math.round(56 * scale);
  const padding = Math.round(28 * scale);
  const avatarSize = Math.round(92 * scale);
  const nameSize = Math.round(38 * scale);
  const handleSize = Math.round(28 * scale);
  let textSize = Math.round(36 * scale * textScale);
  const minTextSize = Math.max(18, Math.round(24 * scale * textScale));
  const rounded = Math.round(26 * scale);

  if (bg) {
    const bgImg = await loadAnyImage(bg);
    if (bgImg) {
      const s = Math.max(W / bgImg.width, H / bgImg.height);
      const bw = bgImg.width * s;
      const bh = bgImg.height * s;
      ctx.drawImage(bgImg, (W - bw) / 2, (H - bh) / 2, bw, bh);
    }
  }
  if (!bg || !ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#0f0f12");
    gradient.addColorStop(1, "#1a1a1f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, W, H);

  ctx.font = `700 ${nameSize}px Inter, sans-serif`;
  const nameWidth = ctx.measureText(name).width;
  const headerHeight = Math.max(avatarSize, nameSize + Math.round(6 * scale) + handleSize);

  const boxWidth = W - margin * 2;
  const maxTextWidth = boxWidth - padding * 2;
  let lines: string[] = [];
  let lineHeight = 0;
  let textHeight = 0;
  let boxHeight = 0;

  while (true) {
    ctx.font = `${textWeight} ${textSize}px Inter, sans-serif`;
    lineHeight = Math.round(textSize * 1.32);
    lines = wrapLines(ctx, text, maxTextWidth, textSize);
    textHeight = lines.length * lineHeight;
    boxHeight = padding + headerHeight + Math.round(18 * scale) + textHeight + padding;
    if (boxHeight <= H - margin * 2 || textSize <= minTextSize) break;
    textSize -= 2;
  }

  const safeHeight = Math.min(boxHeight, H - margin * 2);
  let boxY: number;
  switch (String(valign).toLowerCase()) {
    case "top":
      boxY = margin;
      break;
    case "bottom":
      boxY = H - safeHeight - margin;
      break;
    default:
      boxY = Math.round((H - safeHeight) / 2);
      break;
  }
  boxY = Math.max(margin, Math.min(boxY, H - margin - safeHeight));

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 28 * scale;
  ctx.shadowOffsetY = 10 * scale;
  drawRoundedRect(ctx, margin, boxY, boxWidth, boxHeight, rounded);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();

  if (border) {
    ctx.lineWidth = Math.max(4, 8 * scale);
    ctx.strokeStyle = border;
    drawRoundedRect(ctx, margin, boxY, boxWidth, boxHeight, rounded);
    ctx.stroke();
  }

  const avatarX = margin + padding;
  const avatarY = boxY + padding;
  const avatarImg = await loadAnyImage(avatar || undefined);
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatarImg) {
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = "#E5E7EB";
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = "#9CA3AF";
    ctx.font = `700 ${Math.round(28 * scale)}px sans-serif`;
    ctx.fillText("🙂", avatarX + avatarSize / 2 - Math.round(14 * scale), avatarY + avatarSize / 2 - Math.round(14 * scale));
  }
  ctx.restore();

  const textStartX = avatarX + avatarSize + Math.round(20 * scale);
  const topY = avatarY + Math.round(6 * scale);

  ctx.fillStyle = "#0f172a";
  ctx.font = `700 ${nameSize}px Inter, sans-serif`;
  ctx.fillText(name, textStartX, topY);
  await drawVerifiedBadge(
    ctx,
    textStartX + nameWidth + Math.round(12 * scale),
    topY + nameSize * 0.15,
    Math.round(30 * scale),
  );

  ctx.fillStyle = "#64748b";
  ctx.font = `400 ${handleSize}px Inter, sans-serif`;
  ctx.fillText(handle, textStartX, topY + nameSize + Math.round(8 * scale));

  ctx.fillStyle = "#0b1220";
  ctx.font = `${textWeight} ${textSize}px Inter, sans-serif`;
  const startTextY = boxY + padding + headerHeight + Math.round(18 * scale);
  for (let i = 0; i < lines.length; i += 1) {
    await drawTextWithEmoji(ctx, lines[i], margin + padding, startTextY + i * lineHeight, textSize);
  }

  return canvas.toBuffer("image/png");
};

export const createFrase2Card = async (options: Frase2CardOptions): Promise<Buffer> => {
  ensureFonts();

  const {
    name = "surtada",
    handle = "@humsurtada",
    text,
    avatar,
    width = 1080,
    height = 1080,
    centerBias = 0,
  } = options;

  const W = Math.round(width);
  const H = Math.round(height);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const S = Math.min(W, H) / 1080;
  const marginTop = Math.round(48 * S);
  const marginBottom = Math.round(112 * S);
  const marginSides = Math.round(56 * S);
  const avatarSize = Math.round(104 * S);
  const gapX = Math.round(16 * S);
  const betweenLines = Math.round(6 * S);
  const gapAfterHeader = Math.round(80 * S);
  const headerYOffset = 0;

  const hasInter = fs.existsSync(path.join(FONTS_DIR, "Inter-Regular.ttf"));
  const fontFamily = hasInter ? "Inter" : "Helvetica Neue, Arial, sans-serif";

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  const avatarX = marginSides;
  const avatarImg = await loadAnyImage(avatar || undefined);
  const nameSize = Math.round(40 * S);
  const handleSize = Math.round(32 * S);
  const headerTextHeight = nameSize + betweenLines + handleSize;
  const headerHeight = Math.max(avatarSize, headerTextHeight);
  const textSizeStart = Math.round(62 * S);
  const textMinSize = Math.max(52, Math.round(52 * S));

  let textSize = textSizeStart;
  let lineHeight = Math.round(textSize * 1.25);
  let lines = wrapLines(ctx, text, W - marginSides * 2, textSize);

  const maxUsableHeight = H - marginTop - marginBottom;
  const fits = (heightVal: number) => heightVal <= maxUsableHeight;

  while (textSize >= textMinSize) {
    ctx.font = `400 ${textSize}px ${fontFamily}`;
    lineHeight = Math.round(textSize * 1.25);
    lines = wrapLines(ctx, text, W - marginSides * 2, textSize);
    const totalHeight = headerHeight + gapAfterHeader + lines.length * lineHeight;
    if (fits(totalHeight)) break;
    textSize -= 2;
  }

  lineHeight = Math.round(textSize * 1.25);
  lines = wrapLines(ctx, text, W - marginSides * 2, textSize);

  const stackHeight = headerHeight + gapAfterHeader + lines.length * lineHeight;
  let stackTop = Math.round((H - stackHeight) / 2);
  stackTop = Math.max(marginTop, Math.min(stackTop, H - marginBottom - stackHeight));
  stackTop -= Math.round(centerBias * S);

  const avatarY = stackTop + Math.round((headerHeight - avatarSize) / 2);

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatarImg) {
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = "#E5E7EB";
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = "#9CA3AF";
    ctx.font = `700 ${Math.round(64 * S)}px sans-serif`;
    ctx.fillText(
      "🙂",
      avatarX + avatarSize / 2 - Math.round(32 * S),
      avatarY + avatarSize / 2 - Math.round(32 * S),
    );
  }
  ctx.restore();

  const headerX = avatarX + avatarSize + gapX;
  const headerY = stackTop + Math.round((headerHeight - headerTextHeight) / 2) + headerYOffset;

  ctx.fillStyle = "#0F1419";
  ctx.font = `700 ${nameSize}px ${fontFamily}`;
  ctx.fillText(name, headerX, headerY);
  const nameWidth = ctx.measureText(name).width;
  await drawVerifiedBadge(
    ctx,
    headerX + nameWidth + Math.round(10 * S),
    headerY + Math.round(nameSize * 0.06),
    Math.round(nameSize * 0.95),
  );

  ctx.fillStyle = "#536471";
  ctx.font = `400 ${handleSize}px ${fontFamily}`;
  ctx.fillText(handle, headerX, headerY + nameSize + betweenLines);

  const textStartX = marginSides;
  const textTop = stackTop + headerHeight + gapAfterHeader;
  ctx.fillStyle = "#0F1419";
  ctx.font = `600 ${textSize}px ${fontFamily}`;
  for (let i = 0; i < lines.length; i += 1) {
    await drawTextWithEmoji(
      ctx,
      lines[i],
      textStartX,
      textTop + i * lineHeight,
      textSize,
      "#0F1419",
    );
  }

  return canvas.toBuffer("image/png");
};

export const createFrase4Card = async (options: Frase4CardOptions): Promise<Buffer> => {
  ensureFonts();
  const { image, text, width, height, handle } = options;
  const bg = await loadAnyImage(image);
  if (!bg) {
    throw new Error("Imagem de fundo inválida.");
  }
  const W = Math.round(width || bg.width || 1080);
  const H = Math.round(height || bg.height || 1080);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";
  ctx.textAlign = "center";

  // desenha imagem ajustada para cobrir
  const s = Math.max(W / bg.width, H / bg.height);
  const bw = bg.width * s;
  const bh = bg.height * s;
  const bx = (W - bw) / 2;
  const by = (H - bh) / 2;
  ctx.drawImage(bg, bx, by, bw, bh);

  const base = Math.min(W, H);
  let fontSize = Math.round(base * 0.085);
  const minFont = Math.round(base * 0.06);
  const maxWidth = Math.round(W * 0.9);
  let lines: string[] = [];
  let lineHeight = 0;

  while (fontSize >= minFont) {
    ctx.font = `900 ${fontSize}px Inter, sans-serif`;
    lineHeight = Math.round(fontSize * 1.18);
    lines = wrapLines(ctx, text, maxWidth, fontSize);
    const totalH = lines.length * lineHeight;
    if (totalH <= H * 0.5) break;
    fontSize -= 2;
  }

  const textHeight = lines.length * lineHeight;
  const startY = Math.max(Math.round(H * 0.6 - textHeight / 2), Math.round(H * 0.42));

  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(8, Math.round(fontSize * 0.24));
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  const textWidth = Math.max(...lines.map((line) => measureTextWithEmoji(ctx, line, fontSize)), 1);
  const baseX = Math.round((W - textWidth) / 2);
  for (let i = 0; i < lines.length; i += 1) {
    const y = startY + i * lineHeight;
    ctx.strokeText(lines[i], baseX, y);
    await drawTextWithEmoji(ctx, lines[i], baseX, y, fontSize, "#fff");
  }

  if (handle) {
    const tagFont = Math.max(20, Math.round(base * 0.032));
    ctx.font = `italic 400 ${tagFont}px Inter, sans-serif`;
    ctx.lineWidth = 0;
    ctx.strokeStyle = "transparent";
    ctx.fillStyle = "rgba(83, 100, 113, 0.92)"; // similar ao handle do frase2
    const tagY = startY + textHeight + Math.round(tagFont * 1.4);
    ctx.textAlign = "left";
    const handleWidth = measureTextWithEmoji(ctx, handle, tagFont);
    const handleX = Math.round((W - handleWidth) / 2);
    await drawTextWithEmoji(ctx, handle, handleX, tagY, tagFont, "rgba(83, 100, 113, 0.92)");
  }

  return canvas.toBuffer("image/png");
};
