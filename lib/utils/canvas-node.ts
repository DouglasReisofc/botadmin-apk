import type { CanvasRenderingContext2D } from "canvas";

type CanvasModule = typeof import("canvas");

let cachedCanvasModule: CanvasModule | null = null;

const loadCanvasModule = (): CanvasModule => {
  if (cachedCanvasModule) {
    return cachedCanvasModule;
  }

  const candidates = ["@napi-rs/canvas", "canvas"];
  let lastError: unknown = null;
  const evalRequire: NodeRequire = eval("require");

  for (const name of candidates) {
    try {
      const mod = evalRequire(name);
      if (mod && typeof mod.createCanvas === "function") {
        cachedCanvasModule = mod as CanvasModule;
        return cachedCanvasModule;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error("Canvas dependency not found. Install '@napi-rs/canvas' or 'canvas'.");
  if (lastError instanceof Error) {
    (error as Error & { cause?: Error }).cause = lastError;
  }
  throw error;
};

export const ensureCanvasModule = (): CanvasModule => loadCanvasModule();

export const createCanvas = (
  ...args: Parameters<CanvasModule["createCanvas"]>
): ReturnType<CanvasModule["createCanvas"]> => loadCanvasModule().createCanvas(...args);

export const loadImage = (
  ...args: Parameters<CanvasModule["loadImage"]>
): ReturnType<CanvasModule["loadImage"]> => loadCanvasModule().loadImage(...args);

export const registerFont = (...args: Parameters<CanvasModule["registerFont"]>): void => {
  const mod = loadCanvasModule() as CanvasModule & {
    registerFont?: (...values: Parameters<CanvasModule["registerFont"]>) => void;
    GlobalFonts?: {
      registerFromPath?: (fontPath: string, family?: string) => boolean;
    };
  };
  if (typeof mod.registerFont === "function") {
    mod.registerFont(...args);
    return;
  }
  const [fontPath, options] = args as unknown as [string, { family?: string } | undefined];
  if (typeof mod.GlobalFonts?.registerFromPath === "function" && options?.family) {
    mod.GlobalFonts.registerFromPath(fontPath, options.family);
  }
};

export type { CanvasRenderingContext2D };
