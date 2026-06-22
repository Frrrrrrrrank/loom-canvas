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

## Hand it to someone (one prompt, nothing pre-installed)

For a non-technical recipient: they open **Claude Code or Codex** in any folder and
paste the single prompt below. Their agent installs whatever's missing (git, Python —
Node is never needed, no API keys), clones the repo, starts the server, and runs a
canvas — all by following [`BOOTSTRAP.md`](BOOTSTRAP.md). No manual commands, no
restart (the first run is driven over local HTTP).

```
你是我的安装助手。帮我在这台电脑上把一个叫 Loom 的本地研究画布工具从零装好并跑起来，全程你来做，我不会敲命令。我电脑上可能什么都没装（git、Python、Node 都可能没有）——缺什么你就帮我装什么（用这台机器对应的方式，比如 winget / brew / apt；装 Python 也可以用免管理员的 uv）。没有任何 API key。

步骤：
1. 确保有 git 和 Python 3.10+，缺就装上（Node 不需要）。
2. git clone https://github.com/Frrrrrrrrank/loom-canvas.git ，进入目录，读 BOOTSTRAP.md 并照做：python setup.py 建好环境装依赖、在后台启动 server/run.py、确认 http://127.0.0.1:8765 能打开，让我在浏览器打开它。
3. 第一次不用我重启或改配置——按 BOOTSTRAP.md 直接用本地 HTTP 接口驱动画布。
4. 帮我搭一个「<把这里换成你的研究主题，例如：lululemon 中国市场增长策略>」的研究画布并真的跑一遍：真实联网搜索逐节点填充，互相无依赖的节点并行跑，storyline 出 2-3 版让我挑，结论都带来源。边做边让我在 http://127.0.0.1:8765 看着它长出来。

哪一步需要我确认（装东西要权限/密码）就停下用一句话告诉我点什么。
```

## Config (env vars)
- `LOOM_HOST` / `LOOM_PORT` — server bind (default `127.0.0.1:8765`).
- `LOOM_DATA_DIR` — where projects + `artifacts/` live (default `~/.loom`).
- `LOOM_SERVER_URL` — used by the MCP bridge to reach the server.
- `LOOM_AUTOSAVE_IDLE` / `LOOM_AUTOSAVE_MAX` — idle-autosave seconds / version cap.
- `LOOM_AGENT` — auto-responder: `auto` (default, detect `claude`/`codex`) | `claude`
  | `codex` | `off`. When on (toggle 🤖 Auto in the topbar), a card message makes
  the server invoke your agent headlessly (`claude -p` / `codex exec`, your own
  subscription, no API key) to handle it and reply in the card — real-time, no
  "处理画布留言" needed. `LOOM_AGENT_CMD` overrides the command (`{prompt}`
  placeholder) if the default headless flags don't fit your CLI version;
  `LOOM_AGENT_DEBOUNCE` / `LOOM_AGENT_TIMEOUT` tune batching / max run time. On
  failure it falls back to the manual inbox.
  - **Codex** also needs the loom MCP in `~/.codex/config.toml` (a `[mcp_servers.loom]`
    block), and `LOOM_CODEX_MODEL` set to a model your account allows in `codex exec`
    (e.g. `gpt-5.5` — a ChatGPT account rejects some models). Run the server with
    `LOOM_AGENT=codex LOOM_CODEX_MODEL=gpt-5.5`. (Claude Code needs none of this — it
    uses the project `.mcp.json`.)
  - The server must run where your CLI is **logged in normally** (your own terminal),
    not inside another agent session (which can inject an auth gateway → 403).
