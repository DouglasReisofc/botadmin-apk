import { NextRequest, NextResponse } from "next/server";

import { sendTelegramMessage } from "lib/telegram";

const DEFAULT_TELEGRAM_TOKEN = "6741906072:AAGKdcIAqQNuT-t6kFpcm_v1ho9e95OUdJk";
const DEFAULT_CHAT_IDS = ["866806693", "-4171299802"];

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_RAW_BOT_TOKEN ?? DEFAULT_TELEGRAM_TOKEN;
const TELEGRAM_CHAT_IDS = (
  process.env.TELEGRAM_RAW_CHAT_IDS ?? DEFAULT_CHAT_IDS.join(",")
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!TELEGRAM_TOKEN || TELEGRAM_CHAT_IDS.length === 0) {
    console.error("[webhook/all] Telegram config missing");
    return NextResponse.json(
      { ok: false, message: "Telegram config missing" },
      { status: 500 },
    );
  }

  const receivedAt = new Date().toISOString();
  const sourceIp =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") ||
    // @ts-expect-error - NextRequest may expose ip in some runtimes
    (req as any).ip ||
    "unknown";

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (error) {
    console.error("[webhook/all] failed to read body", { error });
  }

  const infoBlock = [
    "<b>Webhook ALL</b>",
    `🕒 ${receivedAt}`,
    `📍 ${sourceIp}`,
    `🔀 ${req.method} ${req.nextUrl.pathname}${req.nextUrl.search}`,
    `📦 ${rawBody.length} bytes`,
  ].join("\n");

  const safeBody = escapeHtml(rawBody || "(sem corpo)");
  const bodyChunks = chunkText(safeBody, 3500);

  for (let index = 0; index < bodyChunks.length; index += 1) {
    const suffix =
      bodyChunks.length > 1
        ? `\nParte ${index + 1}/${bodyChunks.length}`
        : "";
    const message = `${infoBlock}${suffix}\n<pre>${bodyChunks[index]}</pre>`;
    for (const chatId of TELEGRAM_CHAT_IDS) {
      try {
        await sendTelegramMessage({
          chatId,
          text: message,
          token: TELEGRAM_TOKEN,
          parseMode: "HTML",
          disableWebPagePreview: true,
        });
      } catch (error) {
        console.error("[webhook/all] telegram send failed", {
          chatId,
          error,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    forwardedTo: TELEGRAM_CHAT_IDS,
    bytes: rawBody.length,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function chunkText(value: string, size: number) {
  if (!value) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size));
  }
  return chunks;
}
