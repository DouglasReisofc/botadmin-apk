import nodemailer, { Transporter } from "nodemailer";

import { getAdminSmtpTransportConfig } from "lib/admin-smtp";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export class EmailNotConfiguredError extends Error {
  constructor(message = "Configurações de e-mail não definidas.") {
    super(message);
    this.name = "EmailNotConfiguredError";
  }
}

export class EmailDeliveryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EmailDeliveryError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        configurable: true,
        enumerable: false,
        writable: false,
      });
    }
  }
}

const buildFromHeader = (fromName: string, fromEmail: string) => {
  if (!fromName.trim()) {
    return fromEmail;
  }

  return `"${fromName.replace(/["<>]/g, " ").trim()}" <${fromEmail}>`;
};

let cachedTransporter: {
  key: string;
  transporter: Transporter | null;
} | null = null;

const getTransporter = async () => {
  const config = await getAdminSmtpTransportConfig();

  if (!config || !config.host || !config.fromEmail || !config.password) {
    throw new EmailNotConfiguredError();
  }

  const cacheKey = [
    config.host,
    config.port,
    config.secure ? "1" : "0",
    config.username ?? "",
    config.updatedAt ?? "",
  ].join(":");

  if (cachedTransporter && cachedTransporter.key === cacheKey && cachedTransporter.transporter) {
    return {
      transporter: cachedTransporter.transporter,
      config,
    } as const;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username ?? config.fromEmail,
      pass: config.password,
    },
  });

  cachedTransporter = {
    key: cacheKey,
    transporter,
  };

  return {
    transporter,
    config,
  } as const;
};

export const sendEmail = async (options: SendEmailOptions) => {
  const { transporter, config } = await getTransporter();

  try {
    const message = await transporter.sendMail({
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      from: buildFromHeader(config.fromName, config.fromEmail),
      replyTo: config.replyTo ?? config.fromEmail,
    });

    return {
      success: true,
      messageId: message.messageId,
    } as const;
  } catch (error) {
    throw new EmailDeliveryError("Falha ao enviar e-mail de notificação.", error);
  }
};
