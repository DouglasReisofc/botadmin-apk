const TELEGRAM_API_BASE = "https://api.telegram.org";

export type TelegramMessageOptions = {
  chatId: string;
  text: string;
  token?: string;
  parseMode?: "HTML" | "MarkdownV2";
  disableNotification?: boolean;
  disableWebPagePreview?: boolean;
};

export async function sendTelegramMessage({
  chatId,
  text,
  token,
  parseMode = "HTML",
  disableNotification = false,
  disableWebPagePreview = true,
}: TelegramMessageOptions) {
  const botToken = token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("Telegram bot token is not configured");
  }

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        disable_web_page_preview: disableWebPagePreview,
      }),
    },
  );

  const data = await response.json().catch(() => undefined);
  if (!response.ok || (data && data.ok === false)) {
    const description =
      (data && data.description) || `${response.status} ${response.statusText}`;
    throw new Error(`Telegram send failed: ${description}`);
  }

  return data;
}
