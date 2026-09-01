const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { parse: parseEmoji } = require('twemoji-parser');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const crypto = require('crypto');
const PACK_NAME = (process.env.STICKER_PACK || 'BotAdmin melhor bot do whatsapp').trim();
const AUTHOR_NAME = (process.env.STICKER_AUTHOR || 'BotAdmin').trim();
const PACK_AUTHORITY = (process.env.STICKER_CONTENT_PROVIDER_AUTHORITY || 'com.botadmin.melhorbot.stickercontentprovider').trim();
const packIdentifierFromName = (packName) => {
  const hash = crypto.createHash('sha256').update(`botadmin.sticker.pack:${packName.trim().toLowerCase()}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
const PACK_ID = (process.env.STICKER_PACK_ID || `${PACK_AUTHORITY} ${packIdentifierFromName(PACK_NAME)}`).trim();
const EMOJI_BASE_URL = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/72';
const KEEP_CALM_FONT_FAMILY = 'KeepCalmMedium';
const KEEP_CALM_FONT_PATH = path.join(
  process.cwd(),
  'node_modules',
  'knights-canvas',
  'assets',
  'fonts',
  'KeepCalm-Medium.ttf',
);
const CUSTOM_FONTS = [
  { family: KEEP_CALM_FONT_FAMILY, path: KEEP_CALM_FONT_PATH },
];
const REGISTERED_FONTS = new Set();

let canvasModule = null;

function ensureCanvasModule() {
  if (canvasModule) {
    return canvasModule;
  }

  const candidates = ['@napi-rs/canvas', 'canvas'];
  let lastError = null;

  for (const name of candidates) {
    try {
      const mod = require(name);
      if (mod && typeof mod.createCanvas === 'function') {
        canvasModule = mod;
        registerCustomFonts(canvasModule);
        return canvasModule;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error("Canvas dependency not found. Install '@napi-rs/canvas' or 'canvas'.");
  if (lastError) {
    error.cause = lastError;
  }
  throw error;
}

function registerFontWithModule(mod, font) {
  if (!font?.path || !font.family || REGISTERED_FONTS.has(font.family)) {
    return;
  }
  if (!fs.existsSync(font.path)) {
    return;
  }
  try {
    if (mod?.GlobalFonts?.has && mod.GlobalFonts.registerFromPath) {
      if (!mod.GlobalFonts.has(font.family)) {
        mod.GlobalFonts.registerFromPath(font.path, font.family);
      }
    } else if (typeof mod.registerFont === 'function') {
      mod.registerFont(font.path, { family: font.family });
    }
    REGISTERED_FONTS.add(font.family);
  } catch (error) {
    console.warn('[attp] falha ao registrar fonte', { font: font.family, error: error?.message });
  }
}

function registerCustomFonts(mod) {
  CUSTOM_FONTS.forEach((font) => registerFontWithModule(mod, font));
}

const emojiCache = new Map();

const emojiToCodePoints = (emoji) =>
  Array.from(emoji || '')
    .map((char) => {
      const code = char.codePointAt(0);
      return typeof code === 'number' ? code.toString(16).toLowerCase() : null;
    })
    .filter(Boolean);

async function getEmojiImage(emoji) {
  const codePoints = emojiToCodePoints(emoji);
  if (!codePoints.length) {
    return null;
  }

  const cacheKey = codePoints.join('_');
  if (!emojiCache.has(cacheKey)) {
    emojiCache.set(
      cacheKey,
      (async () => {
        try {
          const filename = `emoji_u${codePoints.join('_')}.png`;
          const response = await fetch(`${EMOJI_BASE_URL}/${filename}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          const canvas = ensureCanvasModule();
          if (typeof canvas.loadImage === 'function') {
            return await canvas.loadImage(buffer);
          }
          if (canvas.Image) {
            const image = new canvas.Image();
            image.src = buffer;
            return image;
          }
        } catch (error) {
          console.warn('[attp] falha ao carregar emoji', { emoji, error: error?.message });
          return null;
        }
        return null;
      })(),
    );
  }

  return emojiCache.get(cacheKey);
}

function measureTextWithEmoji(ctx, text, emojiSize) {
  const tokens = parseEmoji(text || '');
  let width = 0;
  let lastIndex = 0;

  for (const token of tokens) {
    if (token.indices[0] > lastIndex) {
      width += ctx.measureText(text.slice(lastIndex, token.indices[0])).width;
    }
    width += emojiSize;
    lastIndex = token.indices[1];
  }

  if (lastIndex < (text || '').length) {
    width += ctx.measureText(text.slice(lastIndex)).width;
  }

  return width;
}

function fallbackWrapText(ctx, text, maxWidth, emojiSize) {
  const words = (text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!word) continue;
    const test = line ? `${line} ${word}` : word;
    const testWidth = measureTextWithEmoji(ctx, test, emojiSize);
    if (testWidth > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

async function drawFallbackText(ctx, rawText, color, stroke, options = {}) {
  const text = (rawText || '').trim() || ' ';
  const canvasSize = options.canvasSize ?? 400;
  const padding = options.padding ?? canvasSize * 0.05;
  const availableWidth = Math.max(20, canvasSize - padding * 2);
  const availableHeight = canvasSize - padding * 2;
  const maxFontSize = options.maxFontSize ?? 220;
  const minFontSize = options.minFontSize ?? 48;
  const fontStep = options.fontStep ?? 4;
  const lineHeightMultiplier = options.lineHeightMultiplier ?? 1.08;
  const forceUppercase = options.uppercase ?? false;
  const fontWeight = options.fontWeight ?? '900';
  const fontFamily =
    options.fontFamily ?? '"Poppins","Arial Black","Impact","Segoe UI","Helvetica","sans-serif"';

  const content = forceUppercase ? text.toUpperCase() : text;
  let fontSize = maxFontSize;
  let lines = [];
  let totalHeight = 0;
  let widestLine = 0;

  do {
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    lines = fallbackWrapText(ctx, content, availableWidth, fontSize);
    const lineHeight = fontSize * lineHeightMultiplier;
    totalHeight = lineHeight * lines.length;
    widestLine = lines.reduce(
      (max, line) => Math.max(max, measureTextWithEmoji(ctx, line, fontSize)),
      0,
    );
    if ((widestLine <= availableWidth && totalHeight <= availableHeight) || fontSize <= minFontSize) {
      break;
    }
    fontSize -= fontStep;
  } while (fontSize > minFontSize);

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  lines = fallbackWrapText(ctx, content, availableWidth, fontSize);
  const lineHeight = fontSize * lineHeightMultiplier;
  const centerX = canvasSize / 2;
  const startY = Math.max(
    padding + lineHeight / 2,
    padding + (availableHeight - lineHeight * lines.length) / 2 + lineHeight / 2,
  );
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  if (stroke) {
    ctx.lineWidth = Math.max(fontSize * 0.08, 1.5);
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const y = startY + index * lineHeight;
    const lineWidth = measureTextWithEmoji(ctx, line, fontSize);
    const startX = centerX - lineWidth / 2;
    await drawLineWithEmoji(ctx, line, startX, y, fontSize, color, stroke, {
      emojiSize: fontSize,
      textAlign: 'left',
    });
  }
}

function wrapText(ctx, text, maxWidth, emojiSize) {
  const paragraphs = (text || '')
    .replace(/\r/g, '')
    .split(/\n+/);

  const lines = [];
  let forcedBreak = false;

  const appendParagraph = (paragraph) => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    const tokens = paragraph.match(/(\s+|\S+)/g) || [];
    let line = '';
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const candidate = line + token;
      if (measureTextWithEmoji(ctx, candidate, emojiSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
      }
      let remaining = token;
      if (/^\s+$/.test(remaining)) {
        line = '';
        continue;
      }
      const trimmed = remaining.replace(/^\s+/, '');
      if (measureTextWithEmoji(ctx, trimmed, emojiSize) <= maxWidth) {
        line = trimmed;
        continue;
      }
      while (measureTextWithEmoji(ctx, remaining, emojiSize) > maxWidth && remaining.length > 1) {
        let cut = 1;
        while (
          cut < remaining.length &&
          measureTextWithEmoji(ctx, remaining.slice(0, cut + 1), emojiSize) <= maxWidth
        ) {
          cut += 1;
        }
        forcedBreak = true;
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
      lines.push('');
    }
  });

  if (!paragraphs.length) {
    appendParagraph('');
  }

  return {
    lines: lines.length ? lines : [''],
    forcedBreak,
  };
}

async function drawLineWithEmoji(ctx, line, anchorX, y, fontSize, color, stroke, options) {
  if (!line) {
    return;
  }

  const emojiSize = options.emojiSize ?? fontSize;
  const textAlign = options.textAlign ?? 'center';
  const lineWidth = measureTextWithEmoji(ctx, line, emojiSize);

  let cursorX = anchorX;
  if (textAlign === 'center') {
    cursorX -= lineWidth / 2;
  } else if (textAlign === 'right') {
    cursorX -= lineWidth;
  }

  const tokens = parseEmoji(line || '');
  let lastIndex = 0;

  const drawSegment = (segment) => {
    if (!segment) return;
    if (stroke) ctx.strokeText(segment, cursorX, y);
    ctx.fillText(segment, cursorX, y);
    cursorX += ctx.measureText(segment).width;
  };

  for (const token of tokens) {
    if (token.indices[0] > lastIndex) {
      drawSegment(line.slice(lastIndex, token.indices[0]));
    }
    const emojiImagePromise = getEmojiImage(token.text);
    if (emojiImagePromise) {
      const emojiImage = await emojiImagePromise;
      if (emojiImage) {
        ctx.drawImage(emojiImage, cursorX, y - emojiSize / 2, emojiSize, emojiSize);
        cursorX += emojiSize;
      } else {
        drawSegment(token.text);
      }
    } else {
      drawSegment(token.text);
    }
    lastIndex = token.indices[1];
  }

  if (lastIndex < line.length) {
    drawSegment(line.slice(lastIndex));
  }
}

async function drawText(ctx, text, color, stroke, options = {}) {
  const {
    canvasWidth = 400,
    canvasHeight = 400,
    padding = 20,
    maxFontSize = 200,
    minFontSize = 40,
    lineHeightMultiplier = 1.1,
    fontWeight = 'bold',
    fontFamily = '"Poppins","Segoe UI","Noto Sans","DejaVu Sans","Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
    textAlign = 'center',
    uppercase = false,
    strokeWidthRatio = 0.08,
    shadowColor = null,
    shadowBlur = 0,
    shadowOffsetX = 0,
    shadowOffsetY = 0,
    anchorLeft = padding,
    anchorRight = canvasWidth - padding,
    verticalAlign = 'middle',
  } = options;

  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;
  const normalizedText = uppercase ? text.toUpperCase() : text;

  let fontSize = maxFontSize;
  let lines = [];
  let forcedBreak = false;
  while (fontSize >= minFontSize) {
    const fontStack = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.font = fontStack;
    const directWidth = measureTextWithEmoji(ctx, normalizedText, fontSize);
    const singleHeight = fontSize * lineHeightMultiplier;
    if (directWidth <= availableWidth && singleHeight <= availableHeight) {
      lines = [normalizedText];
      forcedBreak = false;
      break;
    }

    const wrapState = wrapText(ctx, normalizedText, availableWidth, fontSize);
    lines = wrapState.lines;
    forcedBreak = wrapState.forcedBreak;
    const longestLine = lines.reduce(
      (max, line) => Math.max(max, measureTextWithEmoji(ctx, line, fontSize)),
      0,
    );
    const totalHeight = lines.length * (fontSize * lineHeightMultiplier);
    if (!forcedBreak && longestLine <= availableWidth && totalHeight <= availableHeight) {
      break;
    }
    if (
      lines.length === 1 &&
      measureTextWithEmoji(ctx, lines[0], fontSize) > availableWidth &&
      fontSize <= maxFontSize
    ) {
      let shrink = fontSize;
      while (shrink >= minFontSize) {
        ctx.font = `${fontWeight} ${shrink}px ${fontFamily}`;
        if (measureTextWithEmoji(ctx, lines[0], shrink) <= availableWidth) {
          fontSize = shrink;
          const shrinkWrap = wrapText(ctx, normalizedText, availableWidth, fontSize);
          lines = shrinkWrap.lines;
          forcedBreak = shrinkWrap.forcedBreak;
          break;
        }
        shrink -= 2;
      }
      break;
    }

    fontSize -= 4;
  }

  if (fontSize < minFontSize) {
    fontSize = minFontSize;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const finalWrap = wrapText(ctx, normalizedText, availableWidth, fontSize);
    lines = finalWrap.lines;
    forcedBreak = finalWrap.forcedBreak;
  }

  if (!lines.length) {
    lines = [normalizedText || ''];
  }

  const lineHeight = fontSize * lineHeightMultiplier;
  const contentHeight = lineHeight * lines.length;
  let startY = (canvasHeight - contentHeight) / 2 + lineHeight / 2;
  if (verticalAlign === 'top') {
    startY = padding + lineHeight / 2;
  } else if (verticalAlign === 'bottom') {
    startY = canvasHeight - padding - contentHeight + lineHeight / 2;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;

  if (shadowColor) {
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffsetX;
    ctx.shadowOffsetY = shadowOffsetY;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  if (stroke) {
    ctx.lineWidth = Math.max(fontSize * strokeWidthRatio, 1.5);
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
  }

  const centerX =
    textAlign === 'left' ? anchorLeft : textAlign === 'right' ? anchorRight : canvasWidth / 2;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const y = startY + index * lineHeight;
    if (!line) continue;
    await drawLineWithEmoji(ctx, line, centerX, y, fontSize, color, stroke, {
      emojiSize: fontSize,
      textAlign,
    });
  }
}

async function createFrame(text, color, filePath, stroke, options = {}) {
  const { createCanvas } = ensureCanvasModule();
  const {
    useFallbackTextRenderer,
    fallbackTextOptions,
    canvasSize = 400,
    outputSize = canvasSize,
    ...drawOptions
  } = options || {};
  const canvas = createCanvas(canvasSize, canvasSize);
  const ctx = canvas.getContext('2d');
  if (ctx.imageSmoothingEnabled !== undefined) {
    ctx.imageSmoothingEnabled = true;
  }
  if (ctx.imageSmoothingQuality) {
    ctx.imageSmoothingQuality = 'high';
  }
  if (ctx.patternQuality) {
    ctx.patternQuality = 'best';
  }
  if (ctx.quality) {
    ctx.quality = 'best';
  }
  if (ctx.antialias) {
    ctx.antialias = 'subpixel';
  }
  const background = drawOptions.background ?? '#00000000';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  if (useFallbackTextRenderer) {
    await drawFallbackText(ctx, text, color, stroke, { ...fallbackTextOptions, canvasSize });
  } else {
    await drawText(ctx, text, color, stroke, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      ...drawOptions,
    });
  }
  let finalCanvas = canvas;
  if (outputSize !== canvasSize) {
    const scaledCanvas = createCanvas(outputSize, outputSize);
    const scaledCtx = scaledCanvas.getContext('2d');
    if (scaledCtx.imageSmoothingEnabled !== undefined) scaledCtx.imageSmoothingEnabled = true;
    if (scaledCtx.imageSmoothingQuality) scaledCtx.imageSmoothingQuality = 'high';
    if (scaledCtx.patternQuality) scaledCtx.patternQuality = 'best';
    if (scaledCtx.quality) scaledCtx.quality = 'best';
    if (scaledCtx.antialias) scaledCtx.antialias = 'subpixel';
    scaledCtx.drawImage(canvas, 0, 0, outputSize, outputSize);
    finalCanvas = scaledCanvas;
  }
  await fs.promises.writeFile(filePath, finalCanvas.toBuffer('image/png'));
}

async function applyStickerMetadata(buffer) {
  try {
    const sticker = new Sticker(buffer, {
      pack: PACK_NAME,
      author: AUTHOR_NAME,
      type: StickerTypes.DEFAULT,
      quality: 100,
    });
    return await sticker.build();
  } catch (error) {
    console.warn('[attp] falha ao aplicar metadata do sticker', error?.message);
    return buffer;
  }
}

async function createWebp(text, colors, stroke, name, fps = 10, options = {}) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attp-'));
  const framePaths = [];
  for (let i = 0; i < colors.length; i++) {
    const fpath = path.join(tempDir, `frame_${i}.png`);
    await createFrame(text, colors[i], fpath, stroke, options);
    framePaths.push(fpath);
  }
  return new Promise((resolve, reject) => {
    const output = path.join(tempDir, `${name}.webp`);
    const canvasSize = options?.canvasSize ?? 400;
    const outputSize = options?.outputSize ?? canvasSize;
    const scaleFilter = `scale=${outputSize}:${outputSize}:flags=lanczos`;
    const args = [
      '-y',
      '-framerate', String(fps),
      '-start_number', '0',
      '-i', path.join(tempDir, 'frame_%d.png'),
      '-vf', scaleFilter,
      '-loop', '0',
      '-vcodec', 'libwebp',
      '-lossless', '1',
      '-preset', 'default',
      '-an',
      '-vsync', '0',
      output
    ];
    const ffmpegPath = require('ffmpeg-static');
    execFile(ffmpegPath || 'ffmpeg', args, async (error) => {
      await Promise.all(framePaths.map(f => fs.promises.unlink(f).catch(() => { })));
      if (error) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        return reject(error);
      }
      try {
        const buffer = await fs.promises.readFile(output);
        const finalBuffer = await applyStickerMetadata(buffer);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        resolve(finalBuffer);
      } catch (err) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        reject(err);
      }
    });
  });
}

function normalizeAttp3Input(text) {
  return (text || '').toLowerCase();
}

const REDUCED_FONT_OPTIONS = {
  maxFontSize: 150,
  minFontSize: 30,
  lineHeightMultiplier: 1.05,
  padding: 48,
};

const ATTP_FONT_STACK = `"${KEEP_CALM_FONT_FAMILY}","Poppins","Segoe UI","Helvetica","Arial",sans-serif`;

function createAttp(text) {
  // Mantém o brilho original alternando cores fortes e fundo totalmente transparente
  const colors = ['#ff0000', '#ff007f', '#ff00ff', '#ffea00', '#ff3d00', '#c800ff', '#39ff14', '#ff1744'];
  const normalized = (text || '').replace(/\s+/g, ' ').trim() || ' ';
  const baseReference = 400;
  const outputSize = 512;
  const canvasSize = 960;
  const ratio = canvasSize / baseReference;
  return createWebp(normalized, colors, null, 'attp', 26, {
    background: '#00000000',
    useFallbackTextRenderer: false,
    canvasSize,
    outputSize,
    padding: canvasSize * 0.1,
    maxFontSize: 260 * ratio,
    minFontSize: 35 * ratio,
    lineHeightMultiplier: 1.1,
    uppercase: true,
    fontWeight: '900',
    fontFamily: '"Poppins","Arial Black","Impact","Helvetica","sans-serif"',
    textAlign: 'center',
    strokeWidthRatio: 0,
    shadowColor: null,
  });
}

function createAttp2(text) {
  return createWebp(text, ['white'], '#000', 'attp2', 10, {
    ...REDUCED_FONT_OPTIONS,
  });
}

function createAttp3(text) {
  return createWebp(
    normalizeAttp3Input(text),
    ['#111111'],
    null,
    'attp3',
    12,
    {
      background: '#ffffff',
      maxFontSize: 72,
      minFontSize: 18,
      lineHeightMultiplier: 1.15,
      fontWeight: '400',
      fontFamily: '"Helvetica Neue","Helvetica","Arial","Noto Sans","sans-serif"',
      padding: 40,
      verticalAlign: 'top',
      shadowColor: 'rgba(0,0,0,0.08)',
      shadowBlur: 4,
      shadowOffsetX: 0,
      shadowOffsetY: 2,
      strokeWidthRatio: 0,
      textAlign: 'left',
    },
  );
}

module.exports = { createAttp, createAttp2, createAttp3 };
