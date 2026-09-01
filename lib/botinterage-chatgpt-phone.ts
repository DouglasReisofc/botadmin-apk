export const BOT_INTERAGE_CHATGPT_PHONE_MODEL = "__botadmin_chatgpt_phone__";

export const BOT_INTERAGE_CHATGPT_PHONE_LABEL = "BotInterage ChatGPT (Cromite + MCP)";

export const isBotInterageChatGptPhoneModel = (value?: string | null): boolean =>
  typeof value === "string" && value.trim() === BOT_INTERAGE_CHATGPT_PHONE_MODEL;
