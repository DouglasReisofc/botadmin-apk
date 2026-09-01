import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";

import { getCurrentUser } from "lib/auth";
import { cacheAdminOperationalUserAvatar } from "lib/admin-operational-instance";
import { getDb } from "lib/db";
import {
  getEventBus,
  type PurchaseCreatedPayload,
  type SupportMessageCreatedPayload,
  type SupportThreadUpdatePayload,
  type UserNotificationCreatedPayload,
} from "lib/realtime";

export const runtime = "nodejs";

type SupportUserSummary = {
  id: number;
  name: string;
  email: string | null;
  whatsappNumber: string | null;
  avatarUrl: string | null;
};

type SupportUserSummaryRow = RowDataPacket & {
  id: number;
  name: string | null;
  email: string | null;
  whatsapp_number: string | null;
  avatar_path: string | null;
};

const userCache = new Map<number, { expiresAt: number; value: SupportUserSummary | null }>();

const normalizeAvatarUrl = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `/${trimmed.replace(/^\/+/, "").replace(/\\/g, "/")}`;
};

const loadSupportUserSummary = async (userId: number): Promise<SupportUserSummary | null> => {
  const now = Date.now();
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const db = getDb();
    const [rows] = await db.query<SupportUserSummaryRow[]>(
      `SELECT id, name, email, whatsapp_number, avatar_path FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    let avatarUrl = normalizeAvatarUrl(row?.avatar_path ?? null);
    if (row && !avatarUrl && row.whatsapp_number) {
      avatarUrl = await cacheAdminOperationalUserAvatar(Number(row.id), row.whatsapp_number).catch(() => null);
    }

    const value = row
      ? {
          id: Number(row.id),
          name: row.name?.trim() || row.email?.trim() || `Usuário #${row.id}`,
          email: row.email ?? null,
          whatsappNumber: row.whatsapp_number ?? null,
          avatarUrl,
        }
      : null;
    userCache.set(userId, { expiresAt: now + 60_000, value });
    return value;
  } catch (error) {
    console.error("[admin-support] Falha ao carregar usuário do evento", error);
    return null;
  }
};

const withSupportUser = async <
  T extends SupportMessageCreatedPayload | SupportThreadUpdatePayload
>(payload: T): Promise<T & {
  user: SupportUserSummary | null;
  userName?: string | null;
  userEmail?: string | null;
  userWhatsapp?: string | null;
  userAvatarUrl?: string | null;
}> => {
  const user = await loadSupportUserSummary(payload.userId);
  return {
    ...payload,
    user,
    userName: user?.name ?? null,
    userEmail: user?.email ?? null,
    userWhatsapp: user?.whatsappNumber ?? null,
    userAvatarUrl: user?.avatarUrl ?? null,
  };
};

export async function GET(request: Request) {
  try {
    const session = await getCurrentUser();
    if (!session) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }
    if (session.role !== "admin") {
      return NextResponse.json({ message: "Acesso restrito aos administradores." }, { status: 403 });
    }

    const bus = getEventBus();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          const payload = typeof data === "string" ? data : JSON.stringify(data);
          controller.enqueue(enc.encode(`event: ${event}\n`));
          controller.enqueue(enc.encode(`data: ${payload}\n\n`));
        };

        controller.enqueue(enc.encode(`: admin-stream-connected\n\n`));

        const onThreadUpdated = (payload: SupportThreadUpdatePayload) => {
          // Admin recebe todas as atualizações, preservando userId + thread
          void withSupportUser(payload)
            .then((enriched) => send("support:thread-updated", enriched))
            .catch(() => send("support:thread-updated", payload));
        };

        const onMessageCreated = (payload: SupportMessageCreatedPayload) => {
          void withSupportUser(payload)
            .then((enriched) => send("support:message-created", enriched))
            .catch(() => send("support:message-created", payload));
        };

        const onPurchaseCreated = (payload: PurchaseCreatedPayload) => {
          send("purchase:created", payload);
        };

        const onNotificationCreated = (payload: UserNotificationCreatedPayload) => {
          if (!payload || payload.userId !== session.id) return;
          send("notification:created", payload.notification);
        };

        bus.on("support:thread-updated", onThreadUpdated);
        bus.on("support:message-created", onMessageCreated);
        bus.on("purchase:created", onPurchaseCreated);
        bus.on("notification:created", onNotificationCreated);

        const keepAlive = setInterval(() => controller.enqueue(enc.encode(`: ping\n\n`)), 25000);

        const abort = () => {
          clearInterval(keepAlive);
          bus.off("support:thread-updated", onThreadUpdated);
          bus.off("support:message-created", onMessageCreated);
          bus.off("purchase:created", onPurchaseCreated);
          bus.off("notification:created", onNotificationCreated);
          controller.close();
        };

        request.signal.addEventListener("abort", abort);
      },
      cancel() {},
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[admin-support] Falha ao abrir stream", error);
    return NextResponse.json({ message: "Erro ao abrir stream." }, { status: 500 });
  }
}
