import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { Sticker, StickerTypes } from "wa-sticker-formatter";
import Sharp from "sharp";

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".webm",
  ".gif",
]);

export const DEFAULT_STICKER_PACK_NAME = "BotAdmin melhor bot do whatsapp";
export const DEFAULT_STICKER_PACK_AUTHOR = "BotAdmin";
export const DEFAULT_STICKER_CONTENT_PROVIDER_AUTHORITY =
  process.env.STICKER_CONTENT_PROVIDER_AUTHORITY?.trim() ||
  "com.botadmin.melhorbot.stickercontentprovider";

const stickerPackIdentifierFromName = (packName: string): string => {
  const hash = createHash("sha256").update(`botadmin.sticker.pack:${packName.trim().toLowerCase()}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

export const formatStickerContentProviderPackId = (packName: string): string =>
  `${DEFAULT_STICKER_CONTENT_PROVIDER_AUTHORITY} ${stickerPackIdentifierFromName(packName)}`;

export const STICKER_PACK_NAME = (process.env.STICKER_PACK || DEFAULT_STICKER_PACK_NAME).trim();
export const STICKER_PACK_AUTHOR = (process.env.STICKER_AUTHOR || DEFAULT_STICKER_PACK_AUTHOR).trim();

export const deriveStickerPackId = (packName: string): string => {
  const normalized = packName.trim();
  if (!normalized) {
    return STICKER_PACK_ID;
  }
  return formatStickerContentProviderPackId(normalized);
};

export const STICKER_PACK_ID = (
  process.env.STICKER_PACK_ID || deriveStickerPackId(STICKER_PACK_NAME)
).trim();

export type InstanceStickerMeta = {
  pack: string;
  author: string;
  packId: string;
};

export const resolveInstanceStickerMeta = (
  toggles?: { stickerPack?: string | null; stickerAuthor?: string | null } | null,
): InstanceStickerMeta => {
  const pack = (toggles?.stickerPack?.trim() || STICKER_PACK_NAME).trim() || DEFAULT_STICKER_PACK_NAME;
  const author =
    (toggles?.stickerAuthor?.trim() || STICKER_PACK_AUTHOR).trim() || DEFAULT_STICKER_PACK_AUTHOR;
  return {
    pack,
    author,
    packId: deriveStickerPackId(pack),
  };
};

const DEFAULT_PACK = STICKER_PACK_NAME;
const DEFAULT_AUTHOR = STICKER_PACK_AUTHOR;
const DEFAULT_PACK_ID = STICKER_PACK_ID;

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export type StickerSource =
  | { kind: "buffer"; buffer: Buffer; fileName?: string | null; mimeType?: string | null }
  | { kind: "url"; url: string; fileName?: string | null; mimeType?: string | null }
  | { kind: "data"; dataUri: string; fileName?: string | null; mimeType?: string | null };

const guessExtension = (fileName?: string | null, mimeType?: string | null) => {
  if (fileName) {
    const ext = path.extname(fileName);
    if (ext) {
      return ext.toLowerCase();
    }
  }

  if (mimeType) {
    const [type, subtype] = mimeType.split("/");
    if (type && subtype) {
      if (subtype.includes("webp")) {
        return ".webp";
      }
      if (subtype.includes("png")) {
        return ".png";
      }
      if (subtype.includes("gif")) {
        return ".gif";
      }
      if (subtype.includes("mp4") || subtype.includes("mpeg4")) {
        return ".mp4";
      }
      if (subtype.includes("jpeg") || subtype.includes("jpg")) {
        return ".jpg";
      }
    }
  }

  return ".jpg";
};

const decodeDataUri = (input: string): { buffer: Buffer; mimeType?: string } | null => {
  const match = /^data:([^;]+);base64,(.*)$/i.exec(input);
  if (!match) {
    return null;
  }
  const [, mime, data] = match;
  try {
    return { buffer: Buffer.from(data, "base64"), mimeType: mime };
  } catch {
    return null;
  }
};

const readSourceToFile = async (
  source: StickerSource,
): Promise<{ inputPath: string; extension: string; mimeType?: string | null; isVideo: boolean }> => {
  let buffer: Buffer | null = null;
  let mimeType: string | undefined;

  if (source.kind === "buffer") {
    buffer = source.buffer;
    mimeType = source.mimeType ?? undefined;
    // Se o buffer for texto (JSON/base64/data URI), tenta normalizar
    try {
      const head = buffer.subarray(0, Math.min(buffer.length, 64)).toString("utf8");
      // Data URI inline
      if (head.startsWith("data:")) {
        const asText = buffer.toString("utf8");
        const decoded = decodeDataUri(asText);
        if (decoded) {
          buffer = decoded.buffer;
          mimeType = decoded.mimeType ?? mimeType;
        }
      } else if (head.startsWith("{") || head.startsWith("[")) {
        // JSON com base64
        try {
          const json = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
          const candidates = [json.base64, json.Base64, json.b64, json.B64, json.data, json.Data, json.buffer, json.Buffer];
          const b64 = candidates.find((v) => typeof v === "string" && (v as string).trim().length > 0) as string | undefined;
          if (b64) {
            const cleaned = b64.startsWith("data:") ? b64.replace(/^data:[^;]+;base64,/, "") : b64;
            buffer = Buffer.from(cleaned, "base64");
          }
        } catch { /* ignore parse errors */ }
      }
    } catch { /* ignore */ }
  } else if (source.kind === "data") {
    const decoded = decodeDataUri(source.dataUri);
    if (!decoded) {
      throw new Error("Invalid data URI for sticker conversion");
    }
    buffer = decoded.buffer;
    mimeType = decoded.mimeType ?? source.mimeType ?? undefined;
  } else {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to download sticker source: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    mimeType = response.headers.get("content-type") ?? source.mimeType ?? undefined;
  }

  if (!buffer) {
    throw new Error("Invalid sticker source");
  }

  const extension = guessExtension(source.fileName ?? null, mimeType ?? undefined);
  const inputPath = path.join(tmpdir(), `stk_in_${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`);
  await fs.writeFile(inputPath, buffer);

  const normalizedMime = mimeType ?? undefined;
  const animatedWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP" &&
    buffer.includes(Buffer.from("ANMF", "ascii"));
  const isVideo =
    VIDEO_EXTENSIONS.has(extension) ||
    (normalizedMime?.startsWith("video/") ?? false) ||
    animatedWebp;

  return { inputPath, extension, mimeType: normalizedMime ?? null, isVideo };
};

const runFfmpeg = (input: string, output: string, options: string[]) =>
  new Promise<void>((resolve, reject) => {
    ffmpeg(input)
      .addOutputOptions(options)
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(output);
  });

const ensureVideoDuration = async (inputPath: string): Promise<number> =>
  new Promise((resolve) => {
    try {
      ffmpeg.ffprobe(inputPath, (err, info) => {
        if (!err && info?.format?.duration) {
          const duration = Number(info.format.duration);
          if (Number.isFinite(duration)) {
            resolve(Math.min(5, Math.max(0, Math.floor(duration)) || 5));
            return;
          }
        }
        resolve(5);
      });
    } catch {
      resolve(5);
    }
  });

const MAX_STICKER_SIZE = 980 * 1024;
const WEBP_RIFF_HEADER = "RIFF";
const WEBP_FORMAT_HEADER = "WEBP";

const isWebpBuffer = (buffer: Buffer): boolean =>
  buffer.length >= 12 &&
  buffer.subarray(0, 4).toString("ascii") === WEBP_RIFF_HEADER &&
  buffer.subarray(8, 12).toString("ascii") === WEBP_FORMAT_HEADER;

const isAnimatedWebpBuffer = (buffer: Buffer): boolean => {
  if (!isWebpBuffer(buffer)) {
    return false;
  }
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunk === "VP8X" && dataOffset < buffer.length && (buffer[dataOffset] & 0x02) !== 0) {
      return true;
    }
    if (chunk === "ANMF") {
      return true;
    }
    offset += 8 + ((size + 1) & ~1);
  }
  return false;
};

const shouldSaltStickerImagePart = (): boolean => {
  const value = process.env.STICKER_DEDUPE_SALT?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off" && value !== "no";
};

const stickerSalt = () => {
  const seed = createHash("sha256")
    .update(`${Date.now()}:${process.hrtime.bigint().toString()}:${Math.random()}`)
    .digest();
  return {
    xSeed: seed[0],
    ySeed: seed[1],
    r: seed[2],
    g: seed[3],
    b: seed[4],
  };
};

const addStaticStickerDedupeSalt = async (webpBuffer: Buffer): Promise<Buffer> => {
  const metadata = await Sharp(webpBuffer, { animated: false }).metadata();
  const width = Math.max(1, metadata.width ?? 512);
  const height = Math.max(1, metadata.height ?? 512);
  const salt = stickerSalt();
  const pixel = await Sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: salt.r, g: salt.g, b: salt.b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  return Sharp(webpBuffer, { animated: false })
    .ensureAlpha()
    .composite([{ input: pixel, left: salt.xSeed % width, top: salt.ySeed % height }])
    .webp({ quality: 100, effort: 6 })
    .toBuffer();
};

const addAnimatedStickerDedupeSalt = async (webpBuffer: Buffer): Promise<Buffer> => {
  const salt = stickerSalt();
  const output = Buffer.from(webpBuffer);
  for (let offset = 12; offset + 8 <= output.length;) {
    const chunk = output.subarray(offset, offset + 4).toString("ascii");
    const size = output.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > output.length) {
      return webpBuffer;
    }
    if (chunk === "ANMF" && size >= 16) {
      const frameHeaderOffset = offset + 8;
      const currentDuration =
        output[frameHeaderOffset + 12] |
        (output[frameHeaderOffset + 13] << 8) |
        (output[frameHeaderOffset + 14] << 16);
      const nextDuration = Math.max(1, Math.min(0xffffff, currentDuration + (salt.r % 7) + 1));
      output[frameHeaderOffset + 12] = nextDuration & 0xff;
      output[frameHeaderOffset + 13] = (nextDuration >> 8) & 0xff;
      output[frameHeaderOffset + 14] = (nextDuration >> 16) & 0xff;
      return output;
    }
    offset = end;
  }
  return webpBuffer;
};

const addStickerDedupeSalt = async (webpBuffer: Buffer): Promise<Buffer> => {
  if (!shouldSaltStickerImagePart() || !isWebpBuffer(webpBuffer)) {
    return webpBuffer;
  }
  try {
    return isAnimatedWebpBuffer(webpBuffer)
      ? await addAnimatedStickerDedupeSalt(webpBuffer)
      : await addStaticStickerDedupeSalt(webpBuffer);
  } catch (error) {
    console.warn("[sticker] Falha ao aplicar salt anti-duplicata; mantendo sticker original", { error });
    return webpBuffer;
  }
};

const createStickerExifBuffer = (options?: {
  pack?: string | null;
  author?: string | null;
  packId?: string | null;
  emojis?: string[] | null;
}) => {
  const metadata = {
    "sticker-pack-id": options?.packId?.trim() || DEFAULT_PACK_ID,
    "sticker-pack-name": options?.pack?.trim() || DEFAULT_PACK,
    "sticker-pack-publisher": options?.author?.trim() || DEFAULT_AUTHOR,
    emojis: (() => {
      const values = Array.isArray(options?.emojis)
        ? options.emojis.filter((emoji) => typeof emoji === "string" && emoji.trim())
        : [];
      return values.length > 0 ? values : ["🤖"];
    })(),
  };
  const json = Buffer.from(JSON.stringify(metadata), "utf8");
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  header.writeUIntLE(json.length, 14, 4);
  return Buffer.concat([header, json]);
};

const addStickerExifToWebp = async (
  webpBuffer: Buffer,
  options?: { pack?: string | null; author?: string | null; packId?: string | null; emojis?: string[] | null },
): Promise<Buffer> => {
  const webpmux = (eval("require") as NodeRequire)("node-webpmux");
  const image = new webpmux.Image();
  await image.load(webpBuffer);
  image.exif = createStickerExifBuffer(options);
  return image.save(null);
};

const tryConvertSticker = async (
  params: {
    inputPath: string;
    outputPath: string;
    isVideo: boolean;
    durationLimit: number;
  },
  config: {
    fps?: number;
    quality?: number;
    duration?: number;
    scale?: number;
    filters?: string[];
  },
): Promise<number> => {
  const { inputPath, outputPath, isVideo, durationLimit } = params;
  const { fps = 12, quality = 70, duration = durationLimit, scale = 512, filters } = config;

  // Gera preenchimento totalmente transparente para evitar "borda branca"
  const padColor = "black@0";
  const padFilter = [
    `scale=${scale}:${scale}:force_original_aspect_ratio=decrease`,
    `pad=${scale}:${scale}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`,
  ];
  const cropFilter = [
    `scale=${scale}:${scale}:force_original_aspect_ratio=increase`,
    `crop=${scale}:${scale}`,
  ];

  const addAlpha = (filtersInput: string[]): string[] => {
    const withAlpha = [] as string[];
    for (const f of filtersInput) {
      if (f.startsWith("scale=")) withAlpha.push(f);
    }
    withAlpha.push("format=rgba");
    for (const f of filtersInput) {
      if (!f.startsWith("scale=")) withAlpha.push(f);
    }
    if (isVideo) {
      withAlpha.push(`fps=${fps}`);
    }
    return withAlpha;
  };

  const preferredFilters = (() => {
    if (filters && filters.length > 0) {
      return filters;
    }
    return addAlpha(padFilter);
  })();

  const fallbackFilters = (() => {
    if (filters && filters.length > 0) {
      return filters;
    }
    return addAlpha(cropFilter);
  })();

  const baseOptions = isVideo
    ? [
        "-vcodec", "libwebp",
        "-pix_fmt", "yuva420p",
        "-loop", "0",
        "-ss", "0",
        "-t", String(duration),
        "-an",
        "-vsync", "0",
        "-map_metadata", "-1",
        "-q:v", String(quality),
        "-compression_level", "6",
        "-preset", "default",
      ]
    : [
        "-vcodec", "libwebp",
        "-pix_fmt", "yuva420p",
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-vsync", "0",
        "-map_metadata", "-1",
      ];

  const attempt = async (filters: string[]) => {
    const vf = filters.join(",");
    await runFfmpeg(inputPath, outputPath, ["-vf", vf, ...baseOptions]);
    const stat = await fs.stat(outputPath).catch(() => ({ size: 0 }));
    return stat.size || 0;
  };

  try {
    const size = await attempt(preferredFilters);
    if (size > 0) {
      return size;
    }
  } catch {
    // try fallback
  }

  return attempt(fallbackFilters);
};

const buildStickerWebp = async (
  webpBuffer: Buffer,
  options?: {
    pack?: string | null;
    author?: string | null;
    packId?: string | null;
    emojis?: string[] | null;
    type?: StickerTypes | string;
  },
): Promise<Buffer> => {
  if (webpBuffer.length === 0) {
    throw new Error("Sticker WebP vazio.");
  }
  const preparedWebpBuffer = await addStickerDedupeSalt(webpBuffer);
  try {
    return await addStickerExifToWebp(preparedWebpBuffer, options);
  } catch {
    // Se o WebP não puder receber EXIF diretamente, reconstrói via formatter.
  }
  const sticker = new Sticker(preparedWebpBuffer, {
    pack: options?.pack?.trim() || DEFAULT_PACK,
    author: options?.author?.trim() || DEFAULT_AUTHOR,
    type: options?.type ?? StickerTypes.DEFAULT,
    quality: 100,
  });
  try {
    return await sticker.build();
  } catch (error) {
    console.warn("[sticker] Formatter não aceitou o WebP; enviando WebP normalizado sem reconstrução", { error });
    return preparedWebpBuffer;
  }
};

const writeStickerMetadata = async (
  outputPath: string,
  options?: {
    pack?: string | null;
    author?: string | null;
    packId?: string | null;
    emojis?: string[] | null;
    type?: StickerTypes | string;
  },
): Promise<Buffer> => {
  const webpBuffer = await fs.readFile(outputPath);
  const finalBuffer = await buildStickerWebp(webpBuffer, options);
  await fs.writeFile(outputPath, finalBuffer);
  return finalBuffer;
};

type StickerConversionMode = "pad" | "crop";

export const convertToStickerWebp = async (
  source: StickerSource,
  options?: {
    mode?: StickerConversionMode;
    pack?: string | null;
    author?: string | null;
    packId?: string | null;
    emojis?: string[] | null;
  },
): Promise<{ buffer: Buffer; mimeType: string }> => {
  const mode: StickerConversionMode = options?.mode === "crop" ? "crop" : "pad";
  const { inputPath, isVideo, mimeType, extension } = await readSourceToFile(source);
  const outputPath = path.join(tmpdir(), `stk_out_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`);
  const frameFallbackPath = path.join(
    tmpdir(),
    `stk_frame_${Date.now()}_${Math.random().toString(36).slice(2)}.png`,
  );

  try {
    const durationLimit = isVideo ? await ensureVideoDuration(inputPath) : 5;
    const primaryFilters = mode === "crop" ? ["crop"] : ["pad"];
    const secondaryFilters = mode === "crop" ? ["pad"] : ["crop"];

    const makeFilters = (kind: "pad" | "crop", fps?: number) => {
      const padColor = "black@0";
      const padFilter = [
        `scale=${512}:${512}:force_original_aspect_ratio=decrease`,
        `pad=${512}:${512}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`,
      ];
      const cropFilter = [
        `scale=${512}:${512}:force_original_aspect_ratio=increase`,
        `crop=${512}:${512}`,
      ];
      const base = kind === "crop" ? cropFilter : padFilter;
      const addAlpha = (filters: string[]): string[] => {
        const withAlpha = [] as string[];
        for (const f of filters) {
          if (f.startsWith("scale=")) withAlpha.push(f);
        }
        withAlpha.push("format=rgba");
        for (const f of filters) {
          if (!f.startsWith("scale=")) withAlpha.push(f);
        }
        if (fps) {
          withAlpha.push(`fps=${fps}`);
        }
        return withAlpha;
      };
      return addAlpha(base);
    };

    if (isVideo) {
      const attempts = [
        { fps: 12, quality: 70, duration: durationLimit, scale: 512 },
        { fps: 10, quality: 75, duration: Math.min(durationLimit, 5), scale: 512 },
        { fps: 10, quality: 80, duration: Math.min(durationLimit, 4), scale: 512 },
        { fps: 8, quality: 85, duration: Math.min(durationLimit, 4), scale: 480 },
        { fps: 8, quality: 90, duration: Math.min(durationLimit, 3), scale: 448 },
      ];

      const applyFilters = async (filterKind: "pad" | "crop", attempt: typeof attempts[number]) =>
        tryConvertSticker(
          { inputPath, outputPath, isVideo: true, durationLimit },
          {
            fps: attempt.fps,
            quality: attempt.quality,
            duration: attempt.duration,
            scale: attempt.scale,
            filters: makeFilters(filterKind, attempt.fps),
          },
        );

      let converted = false;
      for (const attempt of attempts) {
        for (const filterKind of primaryFilters) {
          try {
            const size = await applyFilters(filterKind as "pad" | "crop", attempt);
            if (size > 0 && size <= MAX_STICKER_SIZE) {
              converted = true;
              break;
            }
          } catch {
            /* continue */
          }
        }
        if (converted) break;
      }

      if (!converted) {
        const fallbackAttempt = { fps: 8, quality: 95, duration: Math.min(durationLimit, 3), scale: 384 };
        for (const filterKind of [...primaryFilters, ...secondaryFilters]) {
          try {
            await applyFilters(filterKind as "pad" | "crop", fallbackAttempt);
            converted = true;
            break;
          } catch {
            /* continue */
          }
        }
      }
    } else {
      const applyFilters = async (filterKind: "pad" | "crop") =>
        tryConvertSticker(
          { inputPath, outputPath, isVideo: false, durationLimit: 5 },
          { fps: 12, quality: 70, duration: 5, scale: 512, filters: makeFilters(filterKind) },
        );
      try {
        for (const filterKind of primaryFilters) {
          await applyFilters(filterKind as "pad" | "crop");
          break;
        }
      } catch {
        // Fallback sem ffmpeg para imagens
        try {
          const inputBuf = await fs.readFile(inputPath);
          const webpBuf = await Sharp(inputBuf)
            .resize(512, 512, {
              fit: mode === "crop" ? "cover" : "contain",
              position: "center",
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .webp({ quality: 80 })
            .toBuffer();
          await fs.writeFile(outputPath, webpBuf);
        } catch (e) {
          throw e;
        }
      }
      await writeStickerMetadata(outputPath, options);
    }

    let buffer: Buffer | null = null;
    try {
      buffer = await fs.readFile(outputPath);
    } catch (error) {
      if (!isVideo) {
        throw error instanceof Error ? error : new Error("Não consegui gerar o arquivo da figurinha.");
      }
      // fallback: captura frame e gera sticker estático
      try {
        await runFfmpeg(inputPath, frameFallbackPath, [
          "-vf",
          [
            "scale=512:512:force_original_aspect_ratio=decrease",
            "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0",
          ].join(","),
          "-vframes",
          "1",
        ]);
        const frameBuf = await fs.readFile(frameFallbackPath);
        const webpBuf = await Sharp(frameBuf)
          .resize(512, 512, { fit: "cover", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 80 })
          .toBuffer();
        await fs.writeFile(outputPath, webpBuf);
        buffer = await writeStickerMetadata(outputPath, options);
      } catch (fallbackErr) {
        throw fallbackErr instanceof Error
          ? fallbackErr
          : new Error("Fallback de frame falhou ao gerar figurinha.");
      }
    }

    if (!buffer) {
      throw new Error("Não consegui gerar o arquivo da figurinha.");
    }
    buffer = await buildStickerWebp(buffer, options);
    return { buffer, mimeType: "image/webp" };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
    await fs.unlink(frameFallbackPath).catch(() => {});
  }
};

export const ensureStickerWebp = async (
  source: StickerSource,
  options?: {
    mode?: StickerConversionMode;
    pack?: string | null;
    author?: string | null;
    packId?: string | null;
    emojis?: string[] | null;
  },
): Promise<{ buffer: Buffer; mimeType: string }> => {
  return convertToStickerWebp(source, options);
};

export const ensureStickerWebpSquare = async (
  source: StickerSource,
): Promise<{ buffer: Buffer; mimeType: string }> => {
  return convertToStickerWebp(source, { mode: "crop" });
};

export const rebuildWebpStickerMeta = async (
  webpBuffer: Buffer,
  options: { pack: string; author: string; packId?: string | null },
): Promise<Buffer> => {
  return buildStickerWebp(webpBuffer, {
    pack: options.pack,
    author: options.author,
    packId: options.packId,
  });
};

export const finalizeStickerWebp = async (
  webpBuffer: Buffer,
  options?: { pack?: string | null; author?: string | null; packId?: string | null; emojis?: string[] | null },
): Promise<Buffer> => {
  return buildStickerWebp(webpBuffer, options);
};
