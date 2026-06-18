# Loom — instructions for Claude Code

Loom is a local **research canvas** that *you* (Claude Code) drive. You design a
multi-agent research workflow on a visual canvas and then execute it yourself —
all reasoning is yours, there is no LLM in the server and no API key.

## If this repo was just cloned (first run)
Set it up, then tell the user to open the canvas:

1. Run setup (creates a venv, installs deps, writes `.mcp.json`):
   ```
   python setup.py
   ```
2. Start the canvas server in the background and leave it running:
   ```
   server/.venv/Scripts/python server/run.py      # Windows
   server/.venv/bin/python server/run.py          # macOS / Linux
   ```
3. Tell the user to open **http://127.0.0.1:8765**.
4. `setup.py` wrote `.mcp.json`. The `loom` MCP server is picked up when Claude
   Code (re)starts in this folder — ask the user to restart `claude` here and
   approve the `loom` server. After that, the `loom` tools are available.

The prebuilt canvas ships in `web/dist`, so Node is **not** required to use Loom —
only Python. (Node is needed only to modify the frontend.)

## Using Loom (once the `loom` MCP tools are connected)
A `loom` skill is installed under `.claude/skills/loom/` — follow it. In short:

- **Design**: call `get_graph`, then build the canvas with `add_node` / `connect`
  (input brief → orchestrator/storyline → research nodes → analysis → output deck).
  The canvas updates live in the browser.
- **Run**: call `get_run_plan` — it returns `levels`, groups of nodes with no
  dependency on each other. Run level by level, but **within a level run the nodes
  in parallel by launching one subagent per node in a single message** (a single
  agent runs tools serially, so parallel subagents are what make independent
  research nodes run at the same time). Each subagent works *as its node* (real
  tools), then writes back with `set_node_result`, picking `content_type`
  (`markdown` / `chart` / `table` / `slides` / `image`). The server is
  concurrency-safe.
- **并发试错 (抽卡)**: stack `version="v1"`, `"v2"`, ... on one node so the user can
  compare and pick.
- **快速追溯**: attach `sources` (with confidence, and `type:"node"` to point back
  to upstream nodes) to every result.

See `.claude/skills/loom/methodology.md` for consulting workflow templates and the
analysis library.

## Notes
- If a `loom` tool returns "cannot reach Loom canvas server", the server isn't
  running — start it (step 2).
- Runtime data (the saved graph, artifacts) lives in `~/.loom` by default; set
  `LOOM_DATA_DIR` to override.
