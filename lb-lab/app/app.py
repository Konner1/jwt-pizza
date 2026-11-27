import json, os, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME = os.environ.get("SERVER_NAME", "unnamed")
LATENCY_MS = int(os.environ.get("LATENCY_MS", "0"))  # simulated work per request


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":  # endpoint a health check would poll
            body, ctype = b"ok", "text/plain"
        else:
            time.sleep(LATENCY_MS / 1000)
            body = json.dumps({"server": NAME}).encode()
            ctype = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep container logs quiet
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
