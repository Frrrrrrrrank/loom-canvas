# Loom

A visual **research canvas** driven by Claude Code / Codex. You describe a study
in natural language; the canvas builds itself. You run it; Claude Code executes
each node and the results — markdown, charts, tables, HTML slides — appear on the
canvas. Built for consulting-style research: storyline-first, multi-version
"抽卡" exploration, and fully traceable evidence chains.

> Architecture in one line: **Claude Code / Codex is the brain** (all reasoning,
> your own subscription, zero API keys). The **canvas is a pure view + manual
> editor**. They talk over **MCP**. The server never calls an LLM.

This reuses the `GraphSpec` data model and React-Flow canvas idea from
[Sider-ai/hatchify](https://github.com/Sider-ai/hatchify), but drops Hatchify's
server-side LLM execution engine — because here the model executes the graph.

```
┌────────────────────────┐   MCP (stdio)   ┌─────────────────────────┐
│ Claude Code / Codex     │ ───────────────▶│ Loom canvas server       │
│  • designs the graph    │   localhost     │  • holds the GraphSpec   │
│  • runs nodes (=brain)  │◀─────────────── │  • REST + SSE            │
└────────────────────────┘                  │  • serves the canvas SPA │
                                            └───────────┬─────────────┘
            browser ◀── SSE live updates ───────────────┘
```

## Layout
```
loom/
  server/            # FastAPI canvas server + MCP bridge (Python, no LLM deps)
    loom/
      models.py      # GraphSpec data model (from Hatchify, extended)
      state.py       # in-memory store + JSON persistence + SSE pub/sub
      server.py      # REST API + SSE + static SPA host
      mcp_server.py  # 14 MCP tools, thin proxy to the REST API
    run.py           # start the canvas server
    run_mcp.py       # MCP stdio entry (spawned by Claude Code / Codex)
  web/               # Vite + React + @xyflow/react canvas
  .mcp.json          # Claude Code MCP config (auto-discovered)
  .claude/skills/loom/  # the workflow skill + consulting methodology
```

## Quick start

Hand the repo URL to your Claude Code / Codex and let it set itself up — the repo
ships `CLAUDE.md` / `AGENTS.md` with the steps. Or do it yourself:

```bash
git clone https://github.com/Frrrrrrrrank/loom-canvas.git
cd loom-canvas
python setup.py          # one command: venv + deps + writes .mcp.json
```

`setup.py` needs only **Python ≥ 3.10**. The canvas is shipped prebuilt in
`web/dist`, so **no Node / no build** is required to use Loom. (It uses `uv` if
present, otherwise stdlib `venv` + `pip`.)

Then start the server (leave it running):
```bash
server/.venv/Scripts/python server/run.py      # Windows
server/.venv/bin/python   server/run.py         # macOS / Linux
```
Open **http://127.0.0.1:8765** — that's your canvas. Toggle ☀ / ☾ for light/dark.

**Connect Claude Code** — run `claude` from the `loom/` folder; it auto-discovers
the `.mcp.json` that `setup.py` wrote (approve the `loom` server). Then:
```
用 Loom 搭一个昂跑台湾市场进入研究的画布     # watch the canvas build itself
运行这个画布                                  # Claude Code runs each node onto the canvas
```

**Connect Codex** — `setup.py` prints the exact block to paste into
`~/.codex/config.toml` (machine-specific paths), then restart Codex.

## Modifying the frontend (optional, needs Node)
```bash
cd web && pnpm install
pnpm dev       # canvas on :5173, proxies API+SSE to the server on :8765
pnpm build     # rebuild web/dist (commit it so end users still need no Node)
```

## What the canvas gives you
- **Self-building graph** — natural-language design via Claude Code, live on canvas.
- **Two-way editing** — drag nodes, draw edges, edit briefs in the inspector;
  Claude Code sees your changes. Both write the same source of truth.
- **Rich nodes** — markdown / charts / tables / HTML slides / images, inline.
- **并发试错 (抽卡)** — stack v1/v2/v3 result versions per node; pick the best.
- **快速追溯** — every result carries its evidence chain with confidence scores.
- **Multiple canvases** — each study (On Running today, Nike tomorrow) is its own
  project with its own graph and history; switch from the top-left dropdown.
- **Version history + branching** — edits auto-save as a version when you pause
  (configurable idle, default 60s); save named milestones too. Roll back to any
  point, and branch from an old version (Lovable-style). The ⟲ History panel
  shows the tree. Env: `LOOM_AUTOSAVE_IDLE` (seconds, 0 disables), `LOOM_AUTOSAVE_MAX`.

## Hand it to someone (give their Claude Code / Codex a prompt)

Prereqs on their machine: **git**, **Python ≥ 3.10**, and **Claude Code or Codex**.
No Node, no API keys.

**Step 1 — terminal, run once:**
```bash
git clone https://github.com/Frrrrrrrrank/loom-canvas.git
cd loom-canvas
```
Then start `claude` (or `codex`) **inside the `loom-canvas` folder** and paste:

**Step 2 — setup prompt:**
> 帮我把当前目录(loom-canvas)的 Loom 工具装好并跑起来:
> (1) 运行 `python setup.py`(需 Python ≥3.10;若 `python` 不是 3.10+ 用 `python3`。它会建 venv、装依赖、生成 .mcp.json,前端已预编译不需要 Node)。
> (2) 用 `server/.venv` 里的 Python 在**后台**启动 `server/run.py` 并保持运行(Windows: `server\.venv\Scripts\python.exe`;mac/Linux: `server/.venv/bin/python`),然后 curl `http://127.0.0.1:8765/health` 确认 ok,让我在浏览器打开它。
> (3) 读一下 `README.md` 和 `CLAUDE.md`,了解你怎么用 loom 工具。
> (4) setup 生成了 .mcp.json。告诉我:**退出后在 `loom-canvas` 目录里重新运行 claude 并 approve 'loom' server** 就能连上 loom 工具(用 Codex 的话,把 setup 打印的 `[mcp_servers.loom]` 块加到 `~/.codex/config.toml` 再重启)。

**Step 3 — restart** the CLI inside `loom-canvas` (so the `loom` tools connect), approve `loom`.

**Step 4 — use prompt:**
> 用 Loom 搭一个「<研究主题,例如:某品牌 XX 市场进入策略>」的研究画布并真的跑一遍:真实联网搜索填每个节点,同层无依赖的研究节点用并行子代理同时跑,storyline 出 2-3 个版本让我抽卡,结论都带来源。边做边让我在 `http://127.0.0.1:8765` 看。如果 loom 工具报连不上服务器,就在后台把 `server/run.py` 重新起一下。

(Lazier variant: open the CLI in an *empty* folder and have step 2's prompt also
`git clone` the repo first — but then the restart in step 3 must `cd loom-canvas`.)

## Config (env vars)
- `LOOM_HOST` / `LOOM_PORT` — server bind (default `127.0.0.1:8765`).
- `LOOM_DATA_DIR` — where projects + `artifacts/` live (default `~/.loom`).
- `LOOM_SERVER_URL` — used by the MCP bridge to reach the server.
- `LOOM_AUTOSAVE_IDLE` / `LOOM_AUTOSAVE_MAX` — idle-autosave seconds / version cap.
