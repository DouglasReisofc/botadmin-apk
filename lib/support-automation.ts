import { emitSupportMessageEvent, emitSupportThreadUpdate } from "lib/realtime";
import {
  buildSupportThreadSummary,
  recordSupportMessage,
  serializeSupportMessage,
} from "lib/support";

const formatCurrency = (value?: number | string | null) => {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return null;
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
};

const firstName = (value?: string | null) => {
  const clean = value?.trim();
  return clean ? clean.split(/\s+/)[0] : null;
};

const emitAutomatedSupportRecord = async (
  record: Awaited<ReturnType<typeof recordSupportMessage>>,
) => {
  const message = serializeSupportMessage(record.message);
  const thread = await buildSupportThreadSummary(record.thread.userId, record.thread);
  emitSupportMessageEvent({
    userId: record.thread.userId,
    whatsappId: record.thread.whatsappId,
    message,
  });
  emitSupportThreadUpdate({
    userId: record.thread.userId,
    thread,
  });
};

export const sendAutomatedSupportMessage = async ({
  userId,
  text,
  origin,
}: {
  userId: number;
  text: string;
  origin: "signup_welcome" | "purchase_confirmation";
}) => {
  if (!Number.isFinite(userId) || userId <= 0 || !text.trim()) {
    return;
  }

  try {
    const record = await recordSupportMessage({
      userId,
      whatsappId: "__admin__",
      direction: "inbound",
      messageType: "text",
      text: text.trim(),
      customerName: "Suporte BotAdmin",
      profileName: "BotAdmin",
      senderRole: "admin",
      senderUserId: null,
      payload: {
        origin,
        automated: true,
      },
    });
    await emitAutomatedSupportRecord(record);
  } catch (error) {
    console.error("[support-automation] Falha ao enviar mensagem automática", error);
  }
};

export const sendSignupWelcomeSupportMessage = async ({
  userId,
  userName,
}: {
  userId: number;
  userName?: string | null;
}) => {
  const greeting = firstName(userName);
  await sendAutomatedSupportMessage({
    userId,
    origin: "signup_welcome",
    text: [
      greeting ? `Olá, ${greeting}! Bem-vindo ao BotAdmin.` : "Olá! Bem-vindo ao BotAdmin.",
      "Sua conta foi criada e confirmada com sucesso.",
      "Qualquer dúvida, pode responder por aqui que eu te ajudo.",
    ].join("\n"),
  });
};

export const sendPurchaseSupportMessage = async ({
  userId,
  userName,
  productName,
  amount,
}: {
  userId: number;
  userName?: string | null;
  productName?: string | null;
  amount?: number | string | null;
}) => {
  const greeting = firstName(userName);
  const amountLabel = formatCurrency(amount);
  const lines = [
    greeting ? `Parabéns, ${greeting}! Sua compra foi confirmada.` : "Parabéns! Sua compra foi confirmada.",
    productName?.trim() ? `Produto: ${productName.trim()}` : null,
    amountLabel ? `Valor: ${amountLabel}` : null,
    "Já liberei o acesso no painel. Qualquer coisa, estou por aqui.",
  ].filter(Boolean) as string[];

  await sendAutomatedSupportMessage({
    userId,
    origin: "purchase_confirmation",
    text: lines.join("\n"),
  });
};
