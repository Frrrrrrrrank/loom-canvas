"""Entry point for the Loom canvas server."""

from __future__ import annotations

import os

import uvicorn


def serve() -> None:
    host = os.environ.get("LOOM_HOST", "127.0.0.1")
    port = int(os.environ.get("LOOM_PORT", "8765"))
    uvicorn.run("loom.server:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    serve()
