const parseBoolean = (value: string | undefined | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["1", "true", "yes", "on", "debug", "verbose"].includes(normalized);
};

export const BOT_EVENTS_DEBUG = parseBoolean(process.env.BOT_EVENTS_DEBUG);
export const WEBHOOK_VERBOSE_LOGS = parseBoolean(process.env.WEBHOOK_VERBOSE_LOGS);
export const BOT_EVENTS_RAW_LOGS = parseBoolean(process.env.BOT_EVENTS_RAW_LOGS);

export const logBotEventsDebug = (...args: unknown[]) => {
  if (!BOT_EVENTS_DEBUG && !WEBHOOK_VERBOSE_LOGS) {
    return;
  }
  console.log(...args);
};

if (!BOT_EVENTS_DEBUG && !WEBHOOK_VERBOSE_LOGS) {
  const globalAny = globalThis as Record<string, unknown>;
  if (!globalAny.__botEventsLogPatched) {
    const suppressedPatterns = [
      /\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\/api\//i,
    ];

    const shouldSuppressString = (text: string | null | undefined): boolean => {
      if (!text) {
        return false;
      }
      return suppressedPatterns.some((pattern) => pattern.test(text));
    };

    const shouldSuppressArgs = (args: unknown[]): boolean => {
      if (!args || args.length === 0) {
        return false;
      }
      return args.some((entry) => typeof entry === "string" && shouldSuppressString(entry));
    };

    const wrapConsoleMethod = (method: "log" | "info" | "debug") => {
      const original = console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        if (shouldSuppressArgs(args)) {
          return;
        }
        original(...args);
      };
    };

    wrapConsoleMethod("log");
    wrapConsoleMethod("info");
    wrapConsoleMethod("debug");

    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
      try {
        const output = typeof chunk === "string" ? chunk : chunk?.toString?.("utf8");
        if (shouldSuppressString(output)) {
          if (typeof callback === "function") {
            callback();
          }
          return true;
        }
      } catch {
        // ignore suppression errors
      }
      return originalWrite(chunk, encoding, callback);
    }) as typeof process.stdout.write;

    globalAny.__botEventsLogPatched = true;
  }
}
