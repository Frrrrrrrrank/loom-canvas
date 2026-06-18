"""Standalone launcher for the Loom MCP bridge (stdio).

Claude Code / Codex spawns this. It makes `loom` importable regardless of cwd,
then starts the stdio MCP server which proxies to the canvas server over HTTP
(LOOM_SERVER_URL, default http://127.0.0.1:8765).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from loom.mcp_server import main  # noqa: E402

if __name__ == "__main__":
    main()
