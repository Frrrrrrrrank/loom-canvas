# Loom — instructions for Codex (and other coding agents)

Loom is a local **research canvas** that *you* drive. You design a multi-agent
research workflow on a visual canvas and then execute it yourself — all reasoning
is yours, there is no LLM in the server and no API key.

## Setting up from scratch (nothing pre-installed)
If the machine may lack Python / git / Node, follow `BOOTSTRAP.md` — it covers
installing a Python via `uv` (no admin), getting the code without git, and driving
the canvas over HTTP with **no restart**. The steps below assume Python ≥ 3.10 exists.

## First run (repo just cloned)
1. `python setup.py` — creates a venv, installs deps, prints the MCP config block.
2. Start the canvas server and leave it running:
   - Windows: `server/.venv/Scripts/python server/run.py`
   - macOS/Linux: `server/.venv/bin/python server/run.py`
3. Open **http://127.0.0.1:8765**.
4. Register the MCP server. Add to `~/.codex/config.toml` (setup.py prints the
   exact paths for this machine):
   ```toml
   [mcp_servers.loom]
   command = "<repo>/server/.venv/Scripts/python.exe"   # or .../bin/python
   args = ["<repo>/server/run_mcp.py"]
   env = { LOOM_SERVER_URL = "http://127.0.0.1:8765" }
   ```
   Restart Codex so it loads the `loom` tools.

The prebuilt canvas ships in `web/dist`, so Node is **not** required — only Python.

## Using Loom
- **Design** the canvas: `get_graph`, then `add_node` / `connect`
  (input brief → orchestrator/storyline → research nodes → analysis → output deck).
- **Run** it: `get_run_plan`, execute each node *as that node* with your real
  tools, write results via `set_node_result` choosing `content_type`
  (`markdown` / `chart` / `table` / `slides` / `image`).
- **Multiple versions** per node (`version="v1"`, `"v2"`, ...) for side-by-side
  comparison (抽卡). **Sources** on every result for traceability (追溯), using
  `type:"node"` to link back to upstream nodes.

Full tool list and templates: see `README.md` and `.claude/skills/loom/`.
If a tool says "cannot reach Loom canvas server", start the server (step 2).
