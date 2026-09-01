#!/usr/bin/env python3
"""Small durable localhost spool for EasyZap -> BotAdmin webhooks.

EasyZap retries a webhook only for a short period.  During a blue/green
restart (or a temporary queue backpressure response) that is not sufficient,
so this relay acknowledges after durably writing the JSON body and forwards it
in the background until the active BotAdmin slot accepts it.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid

LISTEN = ("127.0.0.1", int(os.environ.get("BOTADMIN_RELAY_PORT", "4325")))
SPOOL = Path(os.environ.get("BOTADMIN_RELAY_SPOOL", "/var/lib/botadmin-webhook-relay/spool"))
ACTIVE_FILE = Path(os.environ.get("BOTADMIN_ACTIVE_FILE", "/opt/botadmin/bluegreen/active-slot"))
MAX_BODY = 50 * 1024 * 1024
STOP = threading.Event()


def active_ports():
    try:
        slot = ACTIVE_FILE.read_text().strip().lower()
    except OSError:
        slot = "green"
    first = 4323 if slot == "green" else 4322
    return (first, 4322 if first == 4323 else 4323)


def forward(path: Path) -> bool:
    try:
        body = path.read_bytes()
    except OSError:
        return True
    for port in active_ports():
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/webhooks/bot-events",
            data=body,
            headers={"Content-Type": "application/json", "Host": "botadmin.shop", "X-Botadmin-Relay": "durable"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                status = response.status
            if 200 <= status < 300:
                path.unlink(missing_ok=True)
                return True
            # A malformed/unauthorized event cannot become valid by retrying.
            if 400 <= status < 500 and status not in (408, 429):
                path.unlink(missing_ok=True)
                return True
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500 and exc.code not in (408, 429):
                path.unlink(missing_ok=True)
                return True
        except (OSError, TimeoutError):
            pass
    return False


def worker():
    while not STOP.is_set():
        files = sorted(SPOOL.glob("*.json"), key=lambda p: p.name)
        progressed = False
        for path in files[:64]:
            if forward(path):
                progressed = True
            else:
                # Do not let one temporarily unavailable/overloaded event
                # head-of-line block newer messages from other instances.
                # Try the remaining spool entries in this pass and retry the
                # failed item on the next cycle.
                continue
        if not progressed:
            STOP.wait(0.5)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "queued": len(list(SPOOL.glob("*.json")))}).encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except Exception:
            self.send_error(400, "Invalid JSON")
            return
        SPOOL.mkdir(parents=True, exist_ok=True)
        target = SPOOL / f"{time.time_ns()}-{uuid.uuid4().hex}.json"
        tmp = target.with_suffix(".tmp")
        try:
            tmp.write_bytes(body)
            os.replace(tmp, target)
        except OSError:
            tmp.unlink(missing_ok=True)
            self.send_error(503, "Spool unavailable")
            return
        self.send_response(202)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "accepted": True, "durable": True}).encode())


def main():
    SPOOL.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=worker, daemon=True).start()
    server = ThreadingHTTPServer(LISTEN, Handler)
    try:
        server.serve_forever()
    finally:
        STOP.set()
        server.server_close()


if __name__ == "__main__":
    main()
