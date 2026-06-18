---
name: loom
description: Design and run a multi-agent research canvas in Loom. Use when the user wants to build a research/consulting workflow on the Loom canvas, scaffold a study from a project brief, run/execute the canvas, or produce a deck/report. Triggers on "用 Loom", "Loom 画布", "搭一个研究/画布", "run the canvas", "执行画布", "做个市场进入/用户/竞品研究", consulting-style research requests when the Loom MCP server is connected.
---

# Loom — research canvas for Claude Code / Codex

Loom is a visual canvas where **you (the model) are the execution engine**. The
canvas server holds the graph; you read and mutate it through the `loom` MCP
tools; the canvas re-renders live. There is no LLM in the server and no API key —
all reasoning is yours.

Two phases: **design** the canvas from a brief, then **run** it node-by-node,
writing each result back so it appears on the canvas.

## Before you start
- The canvas server must be running (default `http://127.0.0.1:8765`). If a tool
  returns `"cannot reach Loom canvas server"`, tell the user to start it
  (`python server/run.py` in the loom folder) and open the URL.
- Always call `get_graph` first to see what already exists. Don't clobber.

## Phase 1 — Design from a brief
Given a project brief (e.g. "On Running 台湾市场进入策略"), build a graph that
mirrors a real consulting workflow. Default shape:

1. an **input** node for the brief,
2. an **orchestrator** node = the *storyline* (拆解客户需求成 N 个研究模块),
3. several **research** nodes (one per module — see `methodology.md`),
4. one **analysis** node (synthesis / 交叉分析 / 提纯),
5. an **output** node (the deck / report).

Use incremental tools for clarity: `add_node` then `connect`. Give every node a
short `instruction` (its brief) and realistic `tools` hints
(`web_search`, `social_listening`, `expert_network`, ...). Set the entry point.
Lay nodes left→right by passing `x`/`y` (input x≈40, storyline/research x≈360,
analysis x≈720, output x≈1060; stack siblings ~200px apart in y) so the canvas
reads as a pipeline.

For a full template in one shot, `replace_graph` with a JSON graph — but prefer
incremental edits when adjusting an existing canvas.

When the user edits in natural language ("把 social listening 改成只看小红书+抖音，300 条"
or "再给 storyline 生成 4 个版本"), translate that into `update_node` /
`add_node` / `connect` calls. The user may also drag/edit on the canvas directly;
re-`get_graph` to resync before large edits.

## Phase 2 — Run the canvas
When the user says "运行 / run / 执行画布":
1. `get_run_plan` → it returns `steps` (each node's instruction, tools, ready
   upstream results) **and `levels`** — a list of node-id groups where every node
   in a group has no dependency on the others.
2. **Run level by level. Within a level, run the nodes IN PARALLEL — do not do
   them one at a time.** Concretely, for each level:
   - First `set_node_status(id, "running")` for every node in the level so they
     all light up on the canvas at once.
   - Then launch **one subagent per node in the SAME message** (Task/Agent tool,
     multiple tool calls in one turn → they run concurrently). Each subagent:
     does the node's work *as that node* (its instruction = its brief, using real
     tools — web search, file reading, analysis; pull upstream context via
     `get_node`), then calls `set_node_result(...)` for **its own node** with the
     right `content_type`, plus `sources` (追溯) and `artifacts`.
   - Move to the next level only after the current level's nodes have results.

   Why: a single agent executes tool calls serially, so without subagents five
   independent research nodes would run one-by-one. Fanning them out to parallel
   subagents is what makes them actually run at the same time. The server is
   concurrency-safe, so parallel `set_node_result` writes are fine.

   (For a tiny graph or a single-node level, just do the work inline — no subagent
   overhead needed.)
3. Respect edges: a node runs only after its upstream nodes have a result. The
   `levels` ordering already encodes this.

### content_type — pick the right renderer
- `markdown` — narrative findings, bullet insights (default).
- `chart` — JSON: `{"type":"bar|line|pie|area","xKey":"theme","data":[{"theme":"...","v":182}],"series":[{"key":"v","name":"提及数"}]}`.
- `table` — JSON: `{"columns":["专家","观点"],"rows":[["A","..."]]}`.
- `slides` / `html` — a full self-contained `<!doctype html>...` document; great
  for the final deck. Keep it dark-theme friendly. This is the deliverable
  format consultants present.
- `image` — a URL or `/artifacts/...` path.

### 并发试错 (抽卡) — the killer feature
When a storyline or analysis could go several ways, generate **multiple versions**
of the same node: call `set_node_result` with `version="v1"`, then `"v2"`, `"v3"`,
each a genuinely different angle (e.g. MVP-first / risk-first / channel-first
storyline). The canvas shows version tabs; the user picks one. Set `select=false`
on alternatives if you have a recommendation, `select=true` on your pick.

### 快速追溯 (traceability)
Every result should carry its evidence chain in `sources`:
`[{"type":"url","ref":"https://...","label":"IG hashtag","confidence":0.75},
  {"type":"node","ref":"social"}]`. Use `type:"node"` to point a synthesis back
to the upstream research it drew from. This is what makes a conclusion auditable.

## Projects & version history
Each canvas is a **project** with its own history. Use these so the user's work
is organized and recoverable:
- **A new, unrelated study → `new_project(name)`** first (e.g. the user pivots from
  On Running to a Nike analysis). Don't pile a second study onto an existing
  canvas. `list_projects` / `switch_project` to navigate.
- **`checkpoint(message)` at milestones** — after you finish the design
  ("designed canvas") and after a run completes ("ran research v1"). This gives the
  user restore points. Auto-checkpoints already protect destructive ops, but your
  explicit, well-labeled checkpoints are what make the history readable.
- **`list_history` / `restore_checkpoint(id)`** when the user wants to roll back.
  Editing after a restore branches automatically — tell the user their other
  versions stay intact.

## Style
- Match the consulting register: storyline-led, MECE modules, insight > raw data.
- Keep node instructions tight. Keep results skimmable on a card.
- Read `methodology.md` (next to this file) for the module/analysis library and
  ready-made workflow templates (market entry, brand/user research, CDD, growth).
