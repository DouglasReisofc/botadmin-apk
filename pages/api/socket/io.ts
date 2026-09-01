import type { NextApiRequest, NextApiResponse } from "next";
import { Server as SocketIOServer, Socket } from "socket.io";

import { authenticateSocket, buildSupportThreadRoom, buildSupportUserRoom, registerSocketServer, SOCKET_PATH } from "lib/realtime";
import { getSupportThreadByWhatsapp } from "lib/support";
import type { SessionUser } from "types/auth";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: NextApiResponse["socket"] & {
    server: NextApiResponse["socket"]["server"] & {
      io?: SocketIOServer;
    };
  };
};

type SocketWithUser = Socket & {
  data: {
    user?: SessionUser;
    activeThreads?: Set<string>;
  };
};

declare module "http" {
  interface Server {
    io?: SocketIOServer;
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

const setupSocketHandlers = (io: SocketIOServer) => {
  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocket(socket.handshake.headers.cookie);
      if (!user) {
        console.warn("[socket] unauthorized handshake", {
          id: socket.id,
          referer: socket.handshake.headers.referer,
          userAgent: socket.handshake.headers["user-agent"],
        });
        return next(new Error("Unauthorized"));
      }
      console.info("[socket] authorized", { socketId: socket.id, userId: user.id });
      socket.data.user = user;
      socket.data.activeThreads = new Set();
      return next();
    } catch (error) {
      console.error("Socket auth failed", error);
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: SocketWithUser) => {
    console.info("[socket] connection established", { socketId: socket.id, userId: socket.data.user?.id });
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.join(buildSupportUserRoom(user.id));

    socket.on("support:join-thread", async (payload) => {
      if (!payload || typeof payload.whatsappId !== "string") {
        return;
      }
      const whatsappId = payload.whatsappId.trim();
      if (!whatsappId) {
        return;
      }

      try {
        const thread = await getSupportThreadByWhatsapp(user.id, whatsappId);
        if (!thread) {
          socket.emit("support:thread-not-found", { whatsappId });
          return;
        }
        const room = buildSupportThreadRoom(user.id, thread.whatsappId);
        socket.join(room);
        socket.data.activeThreads?.add(thread.whatsappId);
      } catch (error) {
        console.error("Failed to join support thread", error);
      }
    });

    socket.on("support:leave-thread", (payload) => {
      if (!payload || typeof payload.whatsappId !== "string") {
        return;
      }
      const whatsappId = payload.whatsappId.trim();
      if (!whatsappId) {
        return;
      }
      const room = buildSupportThreadRoom(user.id, whatsappId);
      socket.leave(room);
      socket.data.activeThreads?.delete(whatsappId);
    });

    socket.on("disconnect", () => {
      console.info("[socket] disconnected", { socketId: socket.id, userId: user.id });
      socket.data.activeThreads?.clear();
    });
  });
};

export default function handler(_req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new SocketIOServer(res.socket.server, {
      path: SOCKET_PATH,
      addTrailingSlash: false,
    });

    res.socket.server.io = io;
    registerSocketServer(io);
    setupSocketHandlers(io);
  }

  res.end();
}
