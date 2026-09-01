import { createCanvas, loadImage } from "lib/utils/canvas-node";
import sharp from "sharp";

type NsfwPrediction = {
  className?: string;
  probability?: number;
};

type NsfwModel = {
  classify: (input: unknown, topK?: number) => Promise<NsfwPrediction[]>;
};

type NsfwJsModule = {
  load: (modelUrl?: string, options?: Record<string, unknown>) => Promise<NsfwModel>;
};

type NsfwQueueEntry<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  task: () => Promise<T>;
};

export type NsfwScanResult = {
  available: boolean;
  flagged: boolean;
  reason:
    | "ok"
    | "queue_full"
    | "buffer_empty"
    | "media_too_large"
    | "model_unavailable"
    | "decode_failed"
    | "classify_failed";
  threshold: number;
  scores: {
    porn: number;
    hentai: number;
    sexy: number;
    neutral: number;
    drawing: number;
    nsfw: number;
  };
  predictions: Array<{ className: string; probability: number }>;
};

const parseIntEnv = (value: string | undefined, fallback: number, min = 0): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

const parseFloatEnv = (value: string | undefined, fallback: number, min = 0, max = 1): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const NSFW_MODEL_URL = (process.env.NSFW_MODEL_URL || "").trim();
const NSFW_MODEL_RETRY_MS = parseIntEnv(process.env.NSFW_MODEL_RETRY_MS, 5 * 60_000, 10_000);
const NSFW_QUEUE_LIMIT = parseIntEnv(process.env.NSFW_QUEUE_LIMIT, 64, 1);
const NSFW_MAX_CONCURRENT = parseIntEnv(process.env.NSFW_MAX_CONCURRENT, 1, 1);
const NSFW_TOP_K = parseIntEnv(process.env.NSFW_TOP_K, 5, 1);
const NSFW_MAX_IMAGE_BYTES = parseIntEnv(process.env.NSFW_MAX_IMAGE_BYTES, 8 * 1024 * 1024, 128 * 1024);
const NSFW_MAX_DIMENSION = parseIntEnv(process.env.NSFW_MAX_DIMENSION, 768, 128);
const NSFW_MAX_ANIMATED_FRAMES = parseIntEnv(process.env.NSFW_MAX_ANIMATED_FRAMES, 3, 1);
const NSFW_PORN_THRESHOLD = parseFloatEnv(process.env.NSFW_PORN_THRESHOLD, 0.5, 0, 1);
const NSFW_HENTAI_THRESHOLD = parseFloatEnv(process.env.NSFW_HENTAI_THRESHOLD, 0.5, 0, 1);
const NSFW_SEXY_WEIGHT = parseFloatEnv(process.env.NSFW_SEXY_WEIGHT, 0.35, 0, 1);
const NSFW_TOTAL_THRESHOLD = parseFloatEnv(process.env.NSFW_TOTAL_THRESHOLD, 0.68, 0, 1);

const queue: NsfwQueueEntry<NsfwScanResult>[] = [];
let activeQueueCount = 0;

let cachedModel: NsfwModel | null = null;
let pendingModelLoad: Promise<NsfwModel | null> | null = null;
let modelFailedUntil = 0;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const normalizePredictions = (predictions: NsfwPrediction[]): Array<{ className: string; probability: number }> =>
  (Array.isArray(predictions) ? predictions : [])
    .map((entry) => ({
      className: typeof entry.className === "string" ? entry.className.trim() : "",
      probability:
        typeof entry.probability === "number" && Number.isFinite(entry.probability)
          ? clamp01(entry.probability)
          : 0,
    }))
    .filter((entry) => entry.className.length > 0)
    .sort((a, b) => b.probability - a.probability);

const toScoreMap = (predictions: Array<{ className: string; probability: number }>) => {
  const scores = new Map<string, number>();
  for (const entry of predictions) {
    scores.set(entry.className.toLowerCase(), clamp01(entry.probability));
  }
  return scores;
};

const readScore = (map: Map<string, number>, key: string): number => {
  const value = map.get(key.toLowerCase()) ?? 0;
  return clamp01(value);
};

const resolveModel = async (): Promise<NsfwModel | null> => {
  if (cachedModel) {
    return cachedModel;
  }

  const now = Date.now();
  if (modelFailedUntil > now) {
    return null;
  }

  if (pendingModelLoad) {
    return pendingModelLoad;
  }

  pendingModelLoad = (async () => {
    try {
      const req = eval("require") as NodeRequire;
      const nsfwjs = req("nsfwjs") as NsfwJsModule;

      let model: NsfwModel | null = null;
      if (NSFW_MODEL_URL) {
        try {
          model = await nsfwjs.load(NSFW_MODEL_URL);
        } catch (error) {
          console.warn("[NSFW] failed to load custom model URL, trying default", {
            modelUrl: NSFW_MODEL_URL,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!model) {
        model = await nsfwjs.load();
      }

      cachedModel = model;
      return model;
    } catch (error) {
      modelFailedUntil = Date.now() + NSFW_MODEL_RETRY_MS;
      console.error("[NSFW] model unavailable", {
        retryInMs: NSFW_MODEL_RETRY_MS,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      pendingModelLoad = null;
    }
  })();

  return pendingModelLoad;
};

const pumpQueue = () => {
  while (activeQueueCount < NSFW_MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      return;
    }
    activeQueueCount += 1;
    Promise.resolve()
      .then(next.task)
      .then((result) => next.resolve(result))
      .catch((error) => {
        next.reject(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        activeQueueCount = Math.max(0, activeQueueCount - 1);
        pumpQueue();
      });
  }
};

const enqueueScan = (task: () => Promise<NsfwScanResult>): Promise<NsfwScanResult> => {
  if (queue.length >= NSFW_QUEUE_LIMIT) {
    return Promise.resolve({
      available: false,
      flagged: false,
      reason: "queue_full",
      threshold: NSFW_TOTAL_THRESHOLD,
      scores: { porn: 0, hentai: 0, sexy: 0, neutral: 0, drawing: 0, nsfw: 0 },
      predictions: [],
    });
  }

  return new Promise<NsfwScanResult>((resolve, reject) => {
    queue.push({ resolve, reject, task });
    pumpQueue();
  });
};

const emptyUnavailableResult = (
  reason: NsfwScanResult["reason"],
): NsfwScanResult => ({
  available: false,
  flagged: false,
  reason,
  threshold: NSFW_TOTAL_THRESHOLD,
  scores: { porn: 0, hentai: 0, sexy: 0, neutral: 0, drawing: 0, nsfw: 0 },
  predictions: [],
});

const resolveCandidateBuffers = async (buffer: Buffer): Promise<Buffer[]> => {
  const candidates: Buffer[] = [buffer];
  if (NSFW_MAX_ANIMATED_FRAMES <= 1) {
    return candidates;
  }

  try {
    const metadata = await sharp(buffer, { animated: true, limitInputPixels: false }).metadata();
    const pages = Math.max(1, Number(metadata.pages ?? 1));
    if (!Number.isFinite(pages) || pages <= 1) {
      return candidates;
    }

    const indices = Array.from(
      new Set([0, Math.floor((pages - 1) / 2), pages - 1].filter((index) => index >= 0 && index < pages)),
    ).slice(0, NSFW_MAX_ANIMATED_FRAMES);

    for (const frameIndex of indices) {
      try {
        const frame = await sharp(buffer, { animated: true, limitInputPixels: false })
          .extractFrame(frameIndex)
          .png({ compressionLevel: 9 })
          .toBuffer();
        if (frame && frame.length > 0) {
          candidates.push(frame);
        }
      } catch {
        // Ignore per-frame extraction errors and keep other candidates.
      }
    }
  } catch {
    // Ignore metadata failures; we'll still try the original buffer.
  }

  return candidates;
};

const loadImageWithFallback = async (
  buffer: Buffer,
): Promise<Awaited<ReturnType<typeof loadImage>> | null> => {
  try {
    return await loadImage(buffer);
  } catch {
    try {
      const normalized = await sharp(buffer, { animated: true, limitInputPixels: false })
        .png({ compressionLevel: 9 })
        .toBuffer();
      return await loadImage(normalized);
    } catch {
      return null;
    }
  }
};

const classifySingleBuffer = async (
  model: NsfwModel,
  buffer: Buffer,
): Promise<NsfwScanResult> => {
  const image = await loadImageWithFallback(buffer);
  if (!image) {
    return emptyUnavailableResult("decode_failed");
  }

  try {
    const width = Math.max(1, Math.floor(Number((image as { width?: number }).width ?? 0)));
    const height = Math.max(1, Math.floor(Number((image as { height?: number }).height ?? 0)));
    const longest = Math.max(width, height);
    const scale = longest > NSFW_MAX_DIMENSION ? NSFW_MAX_DIMENSION / longest : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image as any, 0, 0, targetWidth, targetHeight);

    const rawPredictions = await model.classify(canvas as unknown as object, NSFW_TOP_K);
    const predictions = normalizePredictions(rawPredictions);
    const scoreMap = toScoreMap(predictions);

    const porn = readScore(scoreMap, "Porn");
    const hentai = readScore(scoreMap, "Hentai");
    const sexy = readScore(scoreMap, "Sexy");
    const neutral = readScore(scoreMap, "Neutral");
    const drawing = readScore(scoreMap, "Drawing");
    const nsfw = clamp01(porn + hentai + sexy * NSFW_SEXY_WEIGHT);

    return {
      available: true,
      flagged: false,
      reason: "ok",
      threshold: NSFW_TOTAL_THRESHOLD,
      scores: { porn, hentai, sexy, neutral, drawing, nsfw },
      predictions,
    };
  } catch (error) {
    console.error("[NSFW] classify failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return emptyUnavailableResult("classify_failed");
  }
};

const classifyBufferInternal = async (buffer: Buffer): Promise<NsfwScanResult> => {
  if (!buffer || buffer.length === 0) {
    return emptyUnavailableResult("buffer_empty");
  }

  if (buffer.length > NSFW_MAX_IMAGE_BYTES) {
    return emptyUnavailableResult("media_too_large");
  }

  const model = await resolveModel();
  if (!model) {
    return emptyUnavailableResult("model_unavailable");
  }

  const candidates = await resolveCandidateBuffers(buffer);
  let best: NsfwScanResult | null = null;
  let firstUnavailableReason: NsfwScanResult["reason"] | null = null;

  for (const candidate of candidates) {
    const partial = await classifySingleBuffer(model, candidate);
    if (!partial.available) {
      if (!firstUnavailableReason) {
        firstUnavailableReason = partial.reason;
      }
      continue;
    }
    if (!best || partial.scores.nsfw > best.scores.nsfw) {
      best = partial;
    }
  }

  if (!best) {
    return emptyUnavailableResult(firstUnavailableReason ?? "decode_failed");
  }

  const porn = best.scores.porn;
  const hentai = best.scores.hentai;
  const nsfw = best.scores.nsfw;
  const flagged =
    porn >= NSFW_PORN_THRESHOLD ||
    hentai >= NSFW_HENTAI_THRESHOLD ||
    nsfw >= NSFW_TOTAL_THRESHOLD;

  return {
    ...best,
    flagged,
  };
};

export const scanMediaNsfw = async (buffer: Buffer): Promise<NsfwScanResult> =>
  enqueueScan(() => classifyBufferInternal(buffer));
