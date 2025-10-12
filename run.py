from __future__ import annotations

import argparse
import asyncio
import signal
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

from backend.app import create_app

ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "frontend" / "static"


def find_open_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def launch_browser(url: str) -> None:
    def _open():
        # Delay slightly so the server is ready before opening the tab.
        time.sleep(1.0)
        webbrowser.open(url)

    thread = threading.Thread(target=_open, daemon=True)
    thread.start()


async def serve_app(host: str, port: int, open_browser: bool = True) -> None:
    app = create_app(STATIC_DIR)
    shutdown_event = asyncio.Event()
    app.state.shutdown_event = shutdown_event

    if open_browser:
        launch_browser(f"http://{host}:{port}")

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
        reload=False,
        workers=1,
        loop="asyncio",
    )
    server = uvicorn.Server(config)

    async def shutdown_watcher():
        await shutdown_event.wait()
        server.should_exit = True

    async def serve():
        await server.serve()

    loop = asyncio.get_running_loop()

    def handle_signal(*_: object) -> None:
        shutdown_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_signal)
        except NotImplementedError:
            # Windows (and some environments) do not support add_signal_handler.
            signal.signal(sig, lambda *_: shutdown_event.set())

    await asyncio.gather(serve(), shutdown_watcher())


async def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description="Start the React + FastAPI demo app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=0, type=int, help="Port to bind to (0 chooses a random free port)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the default browser automatically")
    args = parser.parse_args(argv)

    port = args.port if args.port else find_open_port()
    await serve_app(args.host, port, open_browser=not args.no_browser)


if __name__ == "__main__":
    try:
        asyncio.run(main(sys.argv[1:]))
    except KeyboardInterrupt:
        pass
