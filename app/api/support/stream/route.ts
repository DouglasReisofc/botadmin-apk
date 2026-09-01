import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import {
  getEventBus,
  type PurchaseCreatedPayload,
  type SupportMessageCreatedPayload,
  type SupportThreadUpdatePayload,
  type UserNotificationCreatedPayload,
} from "lib/realtime";
import { dispatchSupportReminders } from "lib/support-reminders";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const eventBus = getEventBus();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();

        const send = (event: string, data: unknown) => {
          const payload = typeof data === "string" ? data : JSON.stringify(data);
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        };

        // Initial comment to establish stream
        controller.enqueue(encoder.encode(`: connected\n\n`));

        const onThreadUpdated = (payload: SupportThreadUpdatePayload) => {
          if (!payload || payload.userId !== user.id) return;
          send("support:thread-updated", payload.thread);
        };

        const onMessageCreated = (payload: SupportMessageCreatedPayload) => {
          if (!payload || payload.userId !== user.id) return;
          send("support:message-created", {
            whatsappId: payload.whatsappId,
            message: payload.message,
          });
        };

        const onPurchaseCreated = (payload: PurchaseCreatedPayload) => {
          if (!payload || payload.userId !== user.id) return;
          send("purchase:created", payload.purchase);
        };

        const onNotificationCreated = (payload: UserNotificationCreatedPayload) => {
          if (!payload || payload.userId !== user.id) return;
          send("notification:created", payload.notification);
        };

        eventBus.on("support:thread-updated", onThreadUpdated);
        eventBus.on("support:message-created", onMessageCreated);
        eventBus.on("purchase:created", onPurchaseCreated);
        eventBus.on("notification:created", onNotificationCreated);

        void dispatchSupportReminders(user.id);
        const reminderInterval = setInterval(() => {
          void dispatchSupportReminders(user.id);
        }, 60000);

        // Keepalive ping to prevent proxies from closing the stream
        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        }, 25000);

        const abort = () => {
          clearInterval(keepAlive);
          clearInterval(reminderInterval);
          eventBus.off("support:thread-updated", onThreadUpdated);
          eventBus.off("support:message-created", onMessageCreated);
          eventBus.off("purchase:created", onPurchaseCreated);
          eventBus.off("notification:created", onNotificationCreated);
          controller.close();
        };

        // Close on client abort
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
    console.error("Failed to open SSE stream", error);
    return NextResponse.json({ message: "Erro ao abrir stream." }, { status: 500 });
  }
}
