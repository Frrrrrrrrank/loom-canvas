#!/usr/bin/env python3
"""Loom one-shot setup. Cross-platform, standard-library only.

Run with your system Python (>=3.10):

    python setup.py

It will:
  1. create a virtualenv at server/.venv and install the server deps,
  2. build the web canvas if needed (skipped when the prebuilt web/dist ships),
  3. write a machine-specific .mcp.json so Claude Code auto-discovers Loom,
  4. print how to start the server and connect Claude Code / Codex.

No API keys, no database. All reasoning happens in your Claude Code / Codex.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Make output safe on legacy Windows consoles (GBK/cp1252) so the Chinese
# next-steps and status markers never raise UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server"
WEB = ROOT / "web"
VENV = SERVER / ".venv"
DEPS = ["fastapi", "uvicorn", "httpx", "mcp", "pydantic"]


def info(msg: str) -> None:
    print(f"  > {msg}")


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def warn(msg: str) -> None:
    print(f"[!]  {msg}")


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    info(" ".join(str(c) for c in cmd))
    return subprocess.run(cmd, check=True, **kw)


def venv_python() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def have(exe: str) -> bool:
    return shutil.which(exe) is not None


def check_python() -> None:
    if sys.version_info < (3, 10):
        sys.exit(
            f"Loom needs Python >= 3.10; you ran {sys.version.split()[0]}.\n"
            "Install a newer Python and re-run: python setup.py"
        )


def make_venv() -> None:
    if venv_python().exists():
        ok(f"virtualenv already present at {VENV}")
        return
    if have("uv"):
        run(["uv", "venv", str(VENV)])
    else:
        run([sys.executable, "-m", "venv", str(VENV)])
    ok("virtualenv created")


def install_deps() -> None:
    py = venv_python()
    if have("uv"):
        run(["uv", "pip", "install", "--python", str(py), *DEPS])
    else:
        run([str(py), "-m", "pip", "install", "--upgrade", "pip"])
        run([str(py), "-m", "pip", "install", *DEPS])
    ok("server dependencies installed")


def build_web() -> None:
    dist = WEB / "dist" / "index.html"
    if dist.exists():
        ok("web canvas already built (web/dist present) — skipping")
        return
    pm = "pnpm" if have("pnpm") else ("npm" if have("npm") else None)
    if not pm:
        warn(
            "web/dist is missing and neither pnpm nor npm was found.\n"
            "  The server will run but the canvas page won't render.\n"
            "  Install Node, then: cd web && (pnpm|npm) install && (pnpm|npm) run build"
        )
        return
    run([pm, "install"], cwd=WEB)
    run([pm, "run", "build"], cwd=WEB)
    ok("web canvas built")


def write_mcp_config() -> None:
    py = str(venv_python()).replace("\\", "/")
    run_mcp = str(SERVER / "run_mcp.py").replace("\\", "/")
    cfg = {
        "mcpServers": {
            "loom": {
                "command": py,
                "args": [run_mcp],
                "env": {"LOOM_SERVER_URL": "http://127.0.0.1:8765"},
            }
        }
    }
    (ROOT / ".mcp.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    ok("wrote .mcp.json (Claude Code will auto-discover the 'loom' MCP server)")


def print_next_steps() -> None:
    py = str(venv_python()).replace("\\", "/")
    run_py = str(SERVER / "run.py").replace("\\", "/")
    run_mcp = str(SERVER / "run_mcp.py").replace("\\", "/")
    print("\n" + "=" * 64)
    ok("Loom is set up.")
    print(
        f"""
1) Start the canvas server (leave it running):
     {py} {run_py}
   Then open  http://127.0.0.1:8765  in your browser.

2) Claude Code: run `claude` from this folder ({ROOT.name}/) and approve the
   'loom' MCP server when prompted. Then say e.g.:
     用 Loom 搭一个昂跑台湾市场进入研究的画布
     运行这个画布

   Codex: add this to ~/.codex/config.toml
     [mcp_servers.loom]
     command = "{py}"
     args = ["{run_mcp}"]
     env = {{ LOOM_SERVER_URL = "http://127.0.0.1:8765" }}
"""
    )
    print("=" * 64)


def main() -> None:
    check_python()
    info(f"Loom root: {ROOT}")
    make_venv()
    install_deps()
    build_web()
    write_mcp_config()
    print_next_steps()


if __name__ == "__main__":
    main()
