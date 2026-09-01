import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getDb } from "lib/db";
import { createUserNotification } from "lib/user-notifications";
import { buildGenericNotificationEmail } from "lib/notifications";
import { sendEmail, EmailNotConfiguredError } from "lib/email";
import type { RowDataPacket } from "mysql2/promise";
import { emitUserNotificationCreated } from "lib/realtime";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const {
      subject,
      message,
      target,
      email,
    } = body as Record<string, unknown>;

    const normalizedSubject = typeof subject === "string" ? subject.trim() : "";
    const normalizedMessage = typeof message === "string" ? message.trim() : "";
    const targetType = typeof target === "string" ? target : "all";

    if (!normalizedSubject) {
      return NextResponse.json({ message: "Informe o assunto da notificação." }, { status: 400 });
    }

    if (!normalizedMessage) {
      return NextResponse.json({ message: "Descreva a mensagem que será enviada." }, { status: 400 });
    }

    const db = getDb();
    let recipients: { id: number; name: string; email: string }[] = [];

    if (targetType === "all") {
      const [rows] = await db.query<
        (RowDataPacket & { id: number; name: string; email: string })[]
      >(`SELECT id, name, email FROM users WHERE is_active = 1`);
      recipients = Array.isArray(rows) ? rows.map(r => ({ id: r.id, name: r.name, email: r.email })) : [];
    } else {
      const targetEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (!EMAIL_REGEX.test(targetEmail)) {
        return NextResponse.json({ message: "Informe um e-mail válido." }, { status: 400 });
      }

      const [rows] = await db.query<
        (RowDataPacket & { id: number; name: string; email: string })[]
      >(
        `SELECT id, name, email FROM users WHERE email = ? LIMIT 1`,
        [targetEmail],
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
      }

      recipients = rows;
    }

    if (recipients.length === 0) {
      return NextResponse.json({ message: "Nenhum destinatário encontrado." }, { status: 400 });
    }

    // Cria e emite em tempo real por usuário (garante id e envio imediato)
    await Promise.all(
      recipients.map(async (recipient) => {
        const notification = await createUserNotification({
          userId: recipient.id,
          type: "admin_message",
          title: normalizedSubject,
          message: normalizedMessage,
          metadata: { from: user.email },
        });
        emitUserNotificationCreated({
          userId: notification.userId,
          notification: {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            isRead: notification.isRead,
            createdAt: notification.createdAt,
            metadata: notification.metadata ?? null,
          },
        });

      }),
    );

    const emailResults = await Promise.allSettled(
      recipients.map(async (recipient) => {
        try {
          const { subject: finalSubject, html } = await buildGenericNotificationEmail({
            subject: normalizedSubject,
            message: normalizedMessage,
            userName: recipient.name,
          });

          await sendEmail({
            to: recipient.email,
            subject: finalSubject,
            text: normalizedMessage,
            html,
          });
        } catch (error) {
          if (error instanceof EmailNotConfiguredError) {
            throw error;
          }

          throw error;
        }
      }),
    );

    const smtpNotConfigured = emailResults.find(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof EmailNotConfiguredError,
    );

    if (smtpNotConfigured) {
      return NextResponse.json(
        { message: "Configure o SMTP antes de enviar notificações por e-mail." },
        { status: 400 },
      );
    }

    const failed = emailResults.filter((result) => result.status === "rejected").length;

    return NextResponse.json({
      message: failed === 0
        ? "Notificação enviada com sucesso."
        : `Notificação criada, mas ${failed} e-mail(s) não puderam ser enviados.`,
      recipients: recipients.length,
      failedEmails: failed,
    });
  } catch (error) {
    console.error("Failed to broadcast notification", error);
    return NextResponse.json(
      { message: "Não foi possível enviar a notificação." },
      { status: 500 },
    );
  }
}
