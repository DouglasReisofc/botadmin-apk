import { generateNananaImage } from "lib/apis/nanana-image";

const prompt = process.argv.slice(2).join(" ").trim() || "produto em destaque com fundo studio";

const main = async (): Promise<void> => {
  const startedAt = Date.now();
  console.log(
    JSON.stringify(
      {
        mode: "nanana-image-test",
        prompt,
        hasFpId: Boolean(process.env.NANANA_FP_ID?.trim()),
        hasVisitorId: Boolean(process.env.NANANA_VISITOR_ID?.trim()),
        hasSessionCookie: Boolean(process.env.NANANA_SESSION_COOKIE?.trim()),
        otpFallbackEnabled: /^(1|true|yes|on)$/i.test(process.env.NANANA_USE_OTP_AUTH || ""),
      },
      null,
      2,
    ),
  );

  try {
    const result = await generateNananaImage({
      prompt,
      references: [],
      allowTransparentFallback: true,
      timeoutMs: 60_000,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          requestId: result.requestId,
          imageUrl: result.imageUrls[0] || null,
          elapsedMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const err = error as {
      message?: string;
      status?: number;
      responseData?: unknown;
      stack?: string;
    };
    console.error(
      JSON.stringify(
        {
          ok: false,
          message: err?.message || String(error),
          status: typeof err?.status === "number" ? err.status : null,
          responseData: err?.responseData ?? null,
          elapsedMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
};

void main();
