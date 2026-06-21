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
- **One active canvas.** All your tools operate on whichever project is currently
  active on the server. The user can switch or create canvases in the browser at
  any time — so **call `get_graph` at the start of every design/run turn** to
  confirm which canvas you're on before editing. The `name` it returns is the
  active canvas. If the user says "in this new canvas, add …", they have already
  switched the active canvas in the UI — just `get_graph` then edit; your changes
  land on the canvas they're looking at. Use `new_project` only when YOU are
  starting a new study, not when the user already created the canvas themselves.

## Phase 1 — Design from a brief
Cards have **roles** that mirror a consulting research structure. Build with the
right role for each card (pass `role` to `add_node`):

1. one **core_question** card — the central question + boundary. Fill `fields`:
   `{basic_question, context, criteria_for_success, scope}`.
2. a few **issue** cards — the issue/hypothesis tree (拆解 core question). Each
   `fields`: `{issue, hypothesis, status:"untested"}`.
3. **research** cards — the evidence-gathering tasks. `instruction` (or
   `fields.question`) = the research question; `tools` hints (`web_search`,
   `social_listening`, `expert_network`, ...). **Issue↔Research is many-to-many**:
   connect one issue to several research cards, and a research card to several issues.
4. one **synthesis** card — distills the connected research into a storyline
   (the old "storyline", now placed *after* research; supports multiple versions).
5. one **output** card — the deck / visualization.

`connect` auto-labels the edge by the roles it joins (core_question→issue = breaks
down, issue→research = supports, research→synthesis = distills, synthesis→output =
visualizes, research→issue = evidence). Don't force the full chain — a study may
start straight at research. The core_question is the root/entry automatically.

Lay cards left→right by `x`/`y` (core_question x≈40, issues x≈380, research x≈720,
synthesis x≈1060, output x≈1400; stack siblings ~180px apart in y).

For bulk scaffolding use `replace_graph` (the JSON node uses `role` + `fields`);
prefer incremental `add_node`/`connect` for edits. As research completes, update the
relevant issue's `fields.status` to supported/challenged/mixed via `update_node`.

When the user edits in natural language ("把 social listening 改成只看小红书+抖音"
or "给 synthesis 再生成两版"), translate into `update_node`/`add_node`/`connect`.
The user may also drag/edit on the canvas; re-`get_graph` to resync before big edits.

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
