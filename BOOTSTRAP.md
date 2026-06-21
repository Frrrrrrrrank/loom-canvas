# BOOTSTRAP.md — read this and set up Loom from scratch

You are an AI agent (Claude Code / Codex) setting up **Loom** for a non-technical
user. The machine may have nothing installed (no git, no Python, no Node). Do every
step yourself — the user won't run commands. There are **no API keys**; all reasoning
stays with you. Loom is a local research-canvas: you design a multi-agent research
workflow on a visual canvas and execute it, streaming results to the canvas.

Work through the steps in order. If a step needs the user's permission (a software
install that prompts for a password / UAC), pause and tell them in one sentence what
to click.

---

## 1. Install what's missing — git and Python ≥ 3.10
Just install anything that's missing, the normal way for this OS:
- **git**: `winget install -e --id Git.Git` (Windows) · `brew install git` (macOS) ·
  `sudo apt install -y git` (Linux). (macOS may offer the Xcode Command Line Tools — fine.)
- **Python ≥ 3.10**: check `python3 --version` / `python --version` first. If missing or
  older, install it: `winget install -e --id Python.Python.3.12` (Windows) ·
  `brew install python@3.12` (macOS) · `sudo apt install -y python3 python3-venv` (Linux).
  No-admin alternative: install `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`
  on macOS/Linux, `irm https://astral.sh/uv/install.ps1 | iex` in PowerShell on Windows),
  then `uv python install 3.12`, and use `uv run --python 3.12 python` wherever a Python
  is needed below.

Node is **not** needed — the web UI ships prebuilt.

## 2. Get the code
```
git clone https://github.com/Frrrrrrrrank/loom-canvas.git
cd loom-canvas
```
(Only if git truly can't be installed: download
`https://github.com/Frrrrrrrrank/loom-canvas/archive/refs/heads/main.zip`, extract, and
`cd loom-canvas-main`.)

## 3. Set up
Run `python setup.py` (or `python3 setup.py`, or `uv run --python 3.12 python setup.py`).
It creates `server/.venv`, installs the small dependency set, and writes `.mcp.json`.

## 4. Start the canvas server (background — keep it running)
The venv's Python is `server/.venv/Scripts/python.exe` (Windows) or
`server/.venv/bin/python` (macOS/Linux). Start the server in the **background** and
leave it running for the whole session:
  `<venv-python> server/run.py`
Verify: `curl http://127.0.0.1:8765/health` → `{"status":"ok",...}`.
Tell the user to open **http://127.0.0.1:8765** in their browser.

## 5. Drive Loom over HTTP — no restart needed
Loom also exposes a `loom` MCP server, but MCP tools only connect after the CLI is
restarted. To give the user a **zero-restart first run**, drive the canvas with plain
HTTP calls — these endpoints mirror the MCP tools 1:1.

Base URL = `http://127.0.0.1:8765`. Send JSON bodies (curl:
`-H "content-type: application/json" -d '{...}'`; PowerShell:
`Invoke-RestMethod -Method Post -ContentType application/json -Body '{...}'`).

**Design the canvas**
| action | request |
|---|---|
| new canvas | `POST /api/projects` `{"name":"<study title>"}` |
| set title/desc | `PATCH /api/graph` `{"name":"...","description":"..."}` |
| add card | `POST /api/nodes` `{"id":"social","role":"research","label":"Social Listening","instruction":"IG+小红书, 台湾, 近90天","fields":{"question":"..."},"tools":["social_listening"]}` |
| connect | `POST /api/edges` `{"source":"cq","target":"i_channel"}` (relation auto-derived) |
| entry point | `POST /api/graph/entry/<id>` |
| read | `GET /api/graph` |

`role`: `core_question` (one per study; fields `{basic_question,context,criteria_for_success,scope}`)
· `issue` (fields `{issue,hypothesis,status}`) · `research` · `synthesis` · `output` · `note`.
Shape: **core_question → issue(s) → research → synthesis → output** (free-form; may start at research).
Issue↔research is many-to-many. Edges auto-label by role (decompose/support/distill/visualize/evidence).

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

## 6. Later sessions (optional, smoother)
Next time the user starts their CLI **inside this folder**, the `loom` MCP tools
auto-connect (Claude Code), or for Codex they add the `[mcp_servers.loom]` block that
`setup.py` printed to `~/.codex/config.toml`. Then you can use the `loom` tools
directly instead of raw HTTP. The HTTP path above always works as a fallback.
