import { NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { assertInternalGroupMember, InternalGroupError } from "lib/internal-groups";
import { getInternalGroupEventBus, type InternalGroupRealtimeEvent } from "lib/internal-group-realtime";

export const runtime = "nodejs";
type Context = { params: Promise<{ groupId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    const groupId = Number((await context.params).groupId);
    await assertInternalGroupMember(groupId, user.id);
    const bus = getInternalGroupEventBus();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const send = (event: InternalGroupRealtimeEvent) => {
          if (closed || event.groupId !== groupId) return;
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };
        controller.enqueue(encoder.encode(": connected\n\n"));
        bus.on("event", send);
        const keepAlive = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
        }, 20_000);
        request.signal.addEventListener("abort", () => {
          if (closed) return;
          closed = true;
          clearInterval(keepAlive);
          bus.off("event", send);
          controller.close();
        });
      },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    }});
  } catch (error) {
    if (error instanceof InternalGroupError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Não foi possível abrir o canal do grupo." }, { status: 500 });
  }
}
