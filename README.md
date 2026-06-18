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
- **Version history + branching** — save versions, roll back to any point, and
  branch from an old version (Lovable-style). The ⟲ History panel shows the tree.

## Config (env vars)
- `LOOM_HOST` / `LOOM_PORT` — server bind (default `127.0.0.1:8765`).
- `LOOM_DATA_DIR` — where `graph.json` + `artifacts/` live (default `~/.loom`).
- `LOOM_SERVER_URL` — used by the MCP bridge to reach the server.
