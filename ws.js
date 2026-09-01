import express from "express";
import http from "http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const HTTP_HOST = "127.0.0.1";
const HTTP_PORT = 8765;

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const state = {
    pending: [],
    inFlight: new Map(),
    completed: new Map(),
    results: [],
    clients: new Map(),
    waiters: new Map()
};

function nowIso() {
    return new Date().toISOString();
}

function createJob(url, metadata = {}) {
    return {
        id: randomUUID(),
        url,
        metadata,
        created_at: nowIso()
    };
}

function detectSite(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        if (hostname === "elements.envato.com") {
            return "envato";
        }
        if (hostname === "freepik.com" || hostname === "www.freepik.com" || hostname.endsWith(".freepik.com")) {
            return "freepik";
        }
    } catch (error) {
        return null;
    }
    return null;
}

function normalizeSupportedUrl(rawUrl) {
    const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!value) {
        return null;
    }
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return detectSite(normalized) ? normalized : null;
}

function snapshotInFlight() {
    return Object.fromEntries(state.inFlight.entries());
}

function socketOpen(socket) {
    return socket && socket.readyState === socket.OPEN;
}

function sendJson(socket, payload) {
    if (!socketOpen(socket)) {
        return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
}

function dispatchNextJob(clientId) {
    const socket = state.clients.get(clientId);
    if (!socket || state.inFlight.has(clientId) || state.pending.length === 0) {
        return false;
    }

    const job = state.pending.shift();
    state.inFlight.set(clientId, job);
    return sendJson(socket, {
        type: "job",
        job,
        queue_size: state.pending.length
    });
}

function dispatchAllClients() {
    for (const clientId of state.clients.keys()) {
        dispatchNextJob(clientId);
    }
}

function requeueInFlight(clientId) {
    const job = state.inFlight.get(clientId);
    if (!job) {
        return;
    }
    state.inFlight.delete(clientId);
    if (!state.completed.has(job.id)) {
        state.pending.unshift(job);
    }
}

app.get("/", (_req, res) => {
    res.json({
        name: "AutoDown Local WS API",
        websocket: "ws://127.0.0.1:8765/ws",
        enqueue_example: "http://127.0.0.1:8765/enqueue?url=https://elements.envato.com/pt-br/nature-UKPADAK"
    });
});

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        pending_jobs: state.pending.length,
        connected_clients: [...state.clients.keys()],
        in_flight: snapshotInFlight(),
        results: state.results.length
    });
});

app.get("/jobs", (_req, res) => {
    res.json({
        pending: state.pending,
        in_flight: snapshotInFlight()
    });
});

app.get("/results", (_req, res) => {
    res.json({
        count: state.results.length,
        items: state.results
    });
});

app.post("/reset", (_req, res) => {
    state.pending = [];
    state.inFlight.clear();
    state.completed.clear();
    state.results = [];
    res.json({ ok: true });
});

function enqueueJob(url, metadata = {}) {
    const job = createJob(url, metadata);
    state.pending.push(job);
    dispatchAllClients();
    return job;
}

function waitForJobResult(jobId, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            state.waiters.delete(jobId);
            reject(new Error("Tempo limite aguardando retorno da extensao."));
        }, timeoutMs);

        state.waiters.set(jobId, {
            resolve: (result) => {
                clearTimeout(timeoutId);
                state.waiters.delete(jobId);
                resolve(result);
            },
            reject: (error) => {
                clearTimeout(timeoutId);
                state.waiters.delete(jobId);
                reject(error);
            }
        });
    });
}

async function enqueueAndWait(url, metadata = {}, timeoutMs = 180000) {
    const job = enqueueJob(url, metadata);
    const result = await waitForJobResult(job.id, timeoutMs);
    return {
        ok: result.status === "success",
        site: result.site,
        job,
        result
    };
}

app.get("/enqueue", (req, res) => {
    const url = normalizeSupportedUrl(req.query.url);
    if (!url) {
        res.status(400).json({
            ok: false,
            error: "Passe ?url=https://... com um link do Envato Elements ou Freepik."
        });
        return;
    }

    const timeoutMs = Number.parseInt(String(req.query.timeout || "180000"), 10) || 180000;

    enqueueAndWait(url, { source: "query" }, timeoutMs)
        .then((payload) => {
            res.json(payload);
        })
        .catch((error) => {
            res.status(504).json({
                ok: false,
                url,
                error: error.message || "Tempo limite aguardando resultado."
            });
        });
});

app.post("/enqueue", (req, res) => {
    const url = normalizeSupportedUrl(req.body?.url);
    const metadata = req.body?.metadata && typeof req.body.metadata === "object"
        ? req.body.metadata
        : {};

    if (!url) {
        res.status(400).json({
            ok: false,
            error: "Envie {\"url\":\"https://...\"} com um link do Envato Elements ou Freepik."
        });
        return;
    }

    const timeoutMs = Number.isFinite(req.body?.timeout_ms) ? req.body.timeout_ms : 180000;

    enqueueAndWait(url, metadata, timeoutMs)
        .then((payload) => {
            res.json(payload);
        })
        .catch((error) => {
            res.status(504).json({
                ok: false,
                url,
                error: error.message || "Tempo limite aguardando resultado."
            });
        });
});

wss.on("connection", (socket) => {
    let clientId = null;

    socket.on("message", (raw) => {
        let message = null;
        try {
            message = JSON.parse(String(raw));
        } catch (error) {
            sendJson(socket, {
                type: "error",
                message: "JSON invalido."
            });
            return;
        }

        if (!clientId) {
            if (message.type !== "hello") {
                sendJson(socket, {
                    type: "error",
                    message: "A primeira mensagem precisa ser hello."
                });
                socket.close();
                return;
            }

            clientId = message.client_id || `client-${randomUUID()}`;
            state.clients.set(clientId, socket);
            sendJson(socket, {
                type: "hello_ack",
                client_id: clientId,
                queue_size: state.pending.length,
                server_time: nowIso()
            });
            dispatchNextJob(clientId);
            return;
        }

        if (message.type === "pong") {
            return;
        }

        if (message.type !== "job_result") {
            sendJson(socket, {
                type: "error",
                message: `Tipo de mensagem nao suportado: ${message.type}`
            });
            return;
        }

        const jobId = message.job_id;
        if (!jobId) {
            sendJson(socket, {
                type: "error",
                message: "job_result sem job_id"
            });
            return;
        }

        const currentJob = state.inFlight.get(clientId);
        if (currentJob && currentJob.id === jobId) {
            state.inFlight.delete(clientId);
        } else {
            state.pending = state.pending.filter((job) => job.id !== jobId);
        }

        const result = {
            job_id: jobId,
            client_id: message.client_id || clientId,
            status: message.status || "success",
            site: message.site || null,
            requested_url: message.requested_url || null,
            direct_link: message.direct_link || null,
            preview_url: message.preview_url || null,
            message: message.message || null,
            completed_at: message.completed_at || nowIso()
        };

        state.completed.set(jobId, result);
        state.results.push(result);
        const waiter = state.waiters.get(jobId);
        if (waiter) {
            waiter.resolve(result);
        }

        sendJson(socket, {
            type: "job_ack",
            job_id: jobId,
            pending_jobs: state.pending.length
        });

        dispatchNextJob(clientId);
    });

    socket.on("close", () => {
        if (clientId) {
            state.clients.delete(clientId);
            requeueInFlight(clientId);
        }
    });
});

server.listen(HTTP_PORT, HTTP_HOST, () => {
    console.log(`AutoDown Local WS API em http://${HTTP_HOST}:${HTTP_PORT}`);
    console.log(`WebSocket: ws://${HTTP_HOST}:${HTTP_PORT}/ws`);
});
