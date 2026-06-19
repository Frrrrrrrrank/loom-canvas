# BOOTSTRAP.md — read this and set up Loom from scratch

You are an AI agent (Claude Code / Codex) setting up **Loom** for a non-technical
user on a machine that may have **no Python, no git, no Node**. Do every step
yourself — the user will not run any commands. There are **no API keys**; all
reasoning stays with you. Loom is a local research-canvas: you design a multi-agent
research workflow on a visual canvas and execute it, streaming results to the canvas.

Work through the steps in order. If a step needs the user's permission (installing
software, a password/UAC prompt), pause and tell them in one sentence what to click.

---

## 0. You should have the repo files
The user (or you) downloaded and extracted the project zip. `cd` into the repo
folder — it contains `setup.py`, `server/`, `web/`, this file. If you don't have it
yet, download and extract it (no git needed):
- URL: `https://github.com/Frrrrrrrrank/loom-canvas/archive/refs/heads/main.zip`
- Extract with `tar -xf` (built into Windows 10+/macOS/Linux) or PowerShell
  `Expand-Archive`. The folder is `loom-canvas-main`; `cd` into it.

## 1. Ensure a Python ≥ 3.10  (PY)
Check `python3 --version`, then `python --version`. If either is ≥ 3.10, use it as
**PY** and skip to step 2.

Otherwise install one **without admin rights** using `uv`:
- macOS / Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Windows (PowerShell): `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`

`uv` installs into the user's home and prints its path (e.g. `~/.local/bin/uv` or
`%USERPROFILE%\.local\bin\uv.exe`). If `uv` isn't on PATH yet, call it by full path.
Then download a Python and set PY:
- `uv python install 3.12`
- **PY** = `uv run --python 3.12 python`

Fallback if `uv` fails: install Python 3.12 via `winget install -e --id Python.Python.3.12`
(Windows) / `brew install python@3.12` (macOS) / `sudo apt install -y python3 python3-venv`
(Linux). These may prompt for confirmation or a password — ask the user.

## 2. Set up the project
Run (from the repo folder):  `PY setup.py`
(e.g. `python3 setup.py`, or `uv run --python 3.12 python setup.py`).
It creates `server/.venv`, installs the small dependency set, and writes `.mcp.json`.
The web UI ships **prebuilt** in `web/dist`, so **Node is NOT needed**.

## 3. Start the canvas server (background — keep it running)
The venv's Python is `server/.venv/Scripts/python.exe` (Windows) or
`server/.venv/bin/python` (macOS/Linux). Start the server in the **background** and
leave it running for the whole session:
  `<venv-python> server/run.py`
Verify it's up: `curl http://127.0.0.1:8765/health` → `{"status":"ok",...}`.
Tell the user to open **http://127.0.0.1:8765** in their browser (they'll see an
empty canvas / home).

## 4. Drive Loom over HTTP — no restart, no MCP needed
Loom also exposes a `loom` MCP server, but MCP tools only connect after the CLI is
restarted. To give the user a **zero-restart first run**, drive the canvas with plain
HTTP calls to the server. These endpoints mirror the MCP tools 1:1.

Base URL = `http://127.0.0.1:8765`. Send JSON bodies (curl:
`-H "content-type: application/json" -d '{...}'`; PowerShell:
`Invoke-RestMethod -Method Post -ContentType application/json -Body '{...}'`).

**Design the canvas**
| action | request |
|---|---|
| new canvas | `POST /api/projects` `{"name":"<study title>"}` |
| set title/desc | `PATCH /api/graph` `{"name":"...","description":"..."}` |
| add node | `POST /api/nodes` `{"id":"social","label":"Social Listening","instruction":"IG+小红书, 台湾, 近90天","type":"agent","category":"research","tools":["social_listening"]}` |
| connect | `POST /api/edges` `{"source":"brief","target":"social"}` |
| entry point | `POST /api/graph/entry/<id>` |
| read | `GET /api/graph` |

`type`: `input` (the brief) · `agent` (research/analysis/storyline) · `output` (the deck).
`category` (for agents): `orchestrator` (storyline) · `research` · `analysis` · `general`.
Shape: **input(brief) → orchestrator(storyline) → research nodes → analysis(synthesis) → output(deck)**.

**Run the canvas**
| action | request |
|---|---|
| get plan | `GET /api/run-plan` → `{steps:[...], levels:[[id,id], ...]}` |
| mark running | `POST /api/nodes/<id>/status` `{"status":"running"}` |
| write result | `POST /api/nodes/<id>/result` `{"content":"...","content_type":"markdown","version":"v1","sources":[...]}` |

`levels` groups nodes with no dependency on each other — **run each level's nodes in
parallel** (spawn one subagent per node; each does real web search and POSTs its own
result), then move to the next level.

`content_type` and the `content` shape:
- `markdown` — narrative findings (default).
- `chart` — `{"type":"bar|line|pie|area","xKey":"theme","data":[{"theme":"轻量","v":182}],"series":[{"key":"v","name":"提及"}]}`
- `table` — `{"columns":["品牌","定价带"],"rows":[["Hoka","NT$4-6k"]]}`
- `slides` — a full self-contained `<!doctype html>…` deck (the final deliverable).
- `image` — a URL or `/artifacts/...` path.

**抽卡 (multiple versions):** call `/result` again with `version:"v2"`, `"v3"` to stack
alternative storylines the user can compare and pick on the canvas.
**追溯 (sources):** attach `sources`, e.g. `[{"type":"url","ref":"https://…","confidence":0.8},{"type":"node","ref":"<upstream id>"}]`.

Templates and the analysis library live in `.claude/skills/loom/methodology.md` — read it.

## 5. Later sessions (optional, smoother)
Next time the user starts their CLI **inside this folder**, the `loom` MCP tools
auto-connect (Claude Code), or for Codex they add the `[mcp_servers.loom]` block that
`setup.py` printed to `~/.codex/config.toml`. Then you can use the `loom` tools
directly instead of raw HTTP. The HTTP path above always works as a fallback.
