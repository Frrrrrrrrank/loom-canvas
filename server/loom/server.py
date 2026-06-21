"""Loom canvas server.

Long-running process the user starts once. Holds the single live graph, exposes
a REST API (used by both the canvas frontend and the MCP bridge), streams state
changes over SSE, hosts produced artifacts, and serves the built canvas SPA.

No LLM dependencies — all reasoning happens in Claude Code / Codex.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .agent import AgentRunner
from .models import Node
from .state import Store

# ---------------- paths ----------------
DATA_DIR = Path(os.environ.get("LOOM_DATA_DIR", Path.home() / ".loom"))
ARTIFACT_DIR = DATA_DIR / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
WEB_DIST = Path(__file__).resolve().parent.parent.parent / "web" / "dist"

store = Store(DATA_DIR)
agent = AgentRunner(store, store.bus.publish)
store.on_user_message = agent.notify  # new card message -> auto-respond (if enabled)

app = FastAPI(title="Loom", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ================= request bodies =================
class MetaBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class NodeBody(BaseModel):
    id: str
    role: str = "note"
    type: str = "agent"
    label: str = ""
    instruction: str = ""
    fields: dict[str, Any] = {}
    model: str = ""
    tools: list[str] = []
    category: str = "general"
    config: dict[str, Any] = {}
    position: Optional[dict[str, float]] = None


class NodePatch(BaseModel):
    changes: dict[str, Any]


class MoveBody(BaseModel):
    x: float
    y: float


class EdgeBody(BaseModel):
    source: str
    target: str
    relation: Optional[str] = None
    label: Optional[str] = None
    condition: Optional[str] = None


class ResultBody(BaseModel):
    content: str
    content_type: str = "markdown"
    version: Optional[str] = None
    status: str = "complete"
    sources: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    select: bool = True


class StatusBody(BaseModel):
    status: str


class SelectBody(BaseModel):
    version: str


class MessageBody(BaseModel):
    text: str
    role: str = "user"


class ProjectBody(BaseModel):
    name: str = ""


class CheckpointBody(BaseModel):
    message: str = ""


# ================= API: reads =================
@app.get("/api/graph")
def get_graph() -> dict[str, Any]:
    return store.snapshot()


@app.get("/api/run-plan")
def get_run_plan() -> dict[str, Any]:
    """Topologically-ordered execution plan for Claude Code to follow.

    Each step carries the node's instruction, tools, upstream node ids and the
    currently-selected upstream results, so Claude Code can run nodes in order
    and write each result back via POST /api/nodes/{id}/result.
    """
    g = store.graph
    order = g.topo_order()
    # scope the run to root..end (set root / set end). Defaults: root = entry_point
    # (or all), end = none (all downstream). Lets you re-run just one branch.
    all_ids = {n.id for n in g.nodes}
    root = g.entry_point if (g.entry_point and g.node(g.entry_point)) else None
    end = g.end_point if (g.end_point and g.node(g.end_point)) else None
    reach = (g.descendants(root) | {root}) if root else set(all_ids)
    scope = (reach & (g.ancestors(end) | {end})) if end else reach
    steps = []
    for nid in order:
        node = g.node(nid)
        # core_question / issue are framing (not executed); research/synthesis/output run
        if not node or node.role not in ("research", "synthesis", "output"):
            continue
        if nid not in scope:
            continue
        upstream = g.upstream(nid)
        upstream_results = []
        for up in upstream:
            un = g.node(up)
            if not un:
                continue
            sv = un.selected_version()
            upstream_results.append(
                {
                    "node": up,
                    "label": un.label,
                    "selected_version": sv.version if sv else None,
                    "content_type": sv.content_type if sv else None,
                    "has_result": sv is not None,
                }
            )
        steps.append(
            {
                "id": nid,
                "label": node.label,
                "role": node.role,
                "type": node.type,
                "instruction": node.instruction,
                "fields": node.fields,
                "tools": node.tools,
                "upstream": upstream,
                "upstream_results": upstream_results,
                "status": node.status,
            }
        )

    # Parallel layering: a node's level = 1 + max(level of its upstream); nodes
    # with no upstream are level 0. Every executable node in the same level has
    # no dependency on the others, so they CAN and SHOULD be run concurrently
    # (Claude Code fans them out to parallel subagents).
    exec_ids = {s["id"] for s in steps}
    level: dict[str, int] = {}
    for nid in order:
        ups = g.upstream(nid)
        level[nid] = 0 if not ups else 1 + max((level.get(u, 0) for u in ups), default=0)
    levels: list[list[str]] = []
    max_level = max(level.values(), default=0)
    for lv in range(max_level + 1):
        layer = [nid for nid in order if level.get(nid) == lv and nid in exec_ids]
        if layer:
            levels.append(layer)

    return {
        "name": g.name,
        "description": g.description,
        "entry_point": g.entry_point,
        "root": root,
        "end": end,
        "scoped": bool(root) or bool(end),
        "order": order,
        "steps": steps,
        "levels": levels,
        "parallel_hint": (
            "Each inner list in 'levels' is a set of nodes with no dependency on "
            "each other — run them concurrently (one parallel subagent per node), "
            "not one at a time. Levels themselves run in sequence. 'steps' is already "
            "scoped to root..end — only re-run these."
        ),
    }


# ================= API: projects (history of canvases) =================
@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    return store.list_projects()


@app.post("/api/projects")
def create_project(body: ProjectBody) -> dict[str, Any]:
    return store.create_project(body.name)


@app.post("/api/projects/{pid}/activate")
def activate_project(pid: str) -> dict[str, Any]:
    try:
        return store.switch_project(pid)
    except KeyError:
        raise HTTPException(404, f"project '{pid}' not found")


@app.patch("/api/projects/{pid}")
def rename_project(pid: str, body: ProjectBody) -> dict[str, Any]:
    try:
        return store.rename_project(pid, body.name)
    except KeyError:
        raise HTTPException(404, f"project '{pid}' not found")


@app.delete("/api/projects/{pid}")
def delete_project(pid: str) -> dict[str, str]:
    try:
        store.delete_project(pid)
    except KeyError:
        raise HTTPException(404, f"project '{pid}' not found")
    return {"status": "ok"}


# ================= API: checkpoints (version history) =================
@app.get("/api/checkpoints")
def list_checkpoints() -> dict[str, Any]:
    return store.list_history()


@app.post("/api/checkpoints")
def create_checkpoint(body: CheckpointBody) -> dict[str, Any]:
    return store.checkpoint(body.message)


@app.post("/api/checkpoints/{cid}/restore")
def restore_checkpoint(cid: str) -> dict[str, Any]:
    try:
        return store.restore_checkpoint(cid)
    except KeyError:
        raise HTTPException(404, f"checkpoint '{cid}' not found")


# ================= API: graph mutations =================
@app.put("/api/graph")
def put_graph(body: dict[str, Any]) -> dict[str, Any]:
    return store.replace_graph(body).model_dump()


@app.patch("/api/graph")
def patch_meta(body: MetaBody) -> dict[str, Any]:
    return store.set_meta(body.name, body.description).model_dump()


@app.delete("/api/graph")
def clear_graph() -> dict[str, Any]:
    return store.clear().model_dump()


@app.post("/api/graph/entry/{node_id}")
def set_entry(node_id: str) -> dict[str, Any]:
    try:
        return store.set_entry_point(node_id).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.delete("/api/graph/entry")
def clear_entry() -> dict[str, Any]:
    return store.set_entry_point(None).model_dump()


@app.post("/api/graph/end/{node_id}")
def set_end(node_id: str) -> dict[str, Any]:
    try:
        return store.set_end_point(node_id).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.delete("/api/graph/end")
def clear_end() -> dict[str, Any]:
    return store.set_end_point(None).model_dump()


# ================= API: nodes =================
@app.post("/api/nodes")
def add_node(body: NodeBody) -> dict[str, Any]:
    node = Node(
        id=body.id,
        role=body.role,  # type: ignore[arg-type]
        type=body.type,  # type: ignore[arg-type]
        label=body.label or body.id,
        instruction=body.instruction,
        fields=body.fields,
        model=body.model,
        tools=body.tools,
        category=body.category,
        config=body.config,
    )
    if body.position:
        node.position.x = body.position.get("x", 0.0)
        node.position.y = body.position.get("y", 0.0)
    try:
        return store.add_node(node).model_dump()
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.patch("/api/nodes/{node_id}")
def patch_node(node_id: str, body: NodePatch) -> dict[str, Any]:
    try:
        return store.update_node(node_id, body.changes).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.post("/api/nodes/{node_id}/move")
def move_node(node_id: str, body: MoveBody) -> dict[str, Any]:
    try:
        return store.move_node(node_id, body.x, body.y).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.delete("/api/nodes/{node_id}")
def delete_node(node_id: str) -> dict[str, str]:
    try:
        store.remove_node(node_id)
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")
    return {"status": "ok"}


@app.post("/api/nodes/{node_id}/result")
def set_result(node_id: str, body: ResultBody) -> dict[str, Any]:
    try:
        return store.set_node_result(
            node_id,
            content=body.content,
            content_type=body.content_type,
            version=body.version,
            status=body.status,
            sources=body.sources,
            artifacts=body.artifacts,
            select=body.select,
        ).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.post("/api/nodes/{node_id}/status")
def set_status(node_id: str, body: StatusBody) -> dict[str, Any]:
    try:
        return store.set_status(node_id, body.status).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.post("/api/nodes/{node_id}/select")
def select_version(node_id: str, body: SelectBody) -> dict[str, Any]:
    try:
        return store.select_version(node_id, body.version).model_dump()
    except KeyError as e:
        raise HTTPException(404, str(e))


# ================= API: hypothesis back-propagation =================
class AssessBody(BaseModel):
    issue: str
    research: str
    stance: str
    note: Optional[str] = None


@app.post("/api/assess")
def assess(body: AssessBody) -> dict[str, Any]:
    try:
        return store.assess(body.issue, body.research, body.stance, body.note).model_dump()
    except KeyError as e:
        raise HTTPException(404, f"node not found: {e}")


# ================= API: research card (multi-run) =================
class RunBody(BaseModel):
    run_id: str = ""
    label: str = ""
    summary: str = ""
    status: str = "complete"


class FindingsBody(BaseModel):
    findings: list[dict[str, Any]]


class FindingStatusBody(BaseModel):
    status: str


@app.post("/api/nodes/{node_id}/research/run")
def add_research_run(node_id: str, body: RunBody) -> dict[str, Any]:
    try:
        return store.add_research_run(
            node_id, body.run_id, body.summary, body.label, body.status
        ).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.post("/api/nodes/{node_id}/research/findings")
def upsert_findings(node_id: str, body: FindingsBody) -> dict[str, Any]:
    try:
        return store.upsert_findings(node_id, body.findings).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.post("/api/nodes/{node_id}/research/finding/{finding_id}")
def set_finding_status(node_id: str, finding_id: str, body: FindingStatusBody) -> dict[str, Any]:
    try:
        return store.set_finding_status(node_id, finding_id, body.status).model_dump()
    except KeyError as e:
        raise HTTPException(404, str(e))


# ================= API: card chat / inbox =================
@app.post("/api/nodes/{node_id}/message")
def add_message(node_id: str, body: MessageBody) -> dict[str, Any]:
    try:
        return store.add_message(node_id, body.text, body.role).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.post("/api/nodes/{node_id}/reply")
def reply_to_card(node_id: str, body: MessageBody) -> dict[str, Any]:
    try:
        return store.reply_to_card(node_id, body.text).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.post("/api/nodes/{node_id}/processed")
def mark_processed(node_id: str) -> dict[str, Any]:
    try:
        return store.mark_processed(node_id).model_dump()
    except KeyError:
        raise HTTPException(404, f"node '{node_id}' not found")


@app.get("/api/inbox")
def get_inbox() -> list[dict[str, Any]]:
    return store.inbox()


# ================= API: auto-responder =================
class AgentToggle(BaseModel):
    enabled: bool


@app.get("/api/agent")
def agent_status() -> dict[str, Any]:
    return agent.status()


@app.post("/api/agent")
def agent_toggle(body: AgentToggle) -> dict[str, Any]:
    return agent.set_enabled(body.enabled)


# ================= API: edges =================
@app.post("/api/edges")
def add_edge(body: EdgeBody) -> dict[str, Any]:
    try:
        return store.add_edge(
            body.source, body.target, body.label, body.condition, body.relation
        ).model_dump()
    except KeyError as e:
        raise HTTPException(404, f"node not found: {e}")
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.delete("/api/edges")
def remove_edge(source: str, target: str) -> dict[str, str]:
    try:
        store.remove_edge(source, target)
    except KeyError:
        raise HTTPException(404, "edge not found")
    return {"status": "ok"}


# ================= SSE =================
@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    queue = store.bus.subscribe()

    async def gen():
        # prime with the current snapshot so a fresh client renders immediately
        yield _sse({"type": "graph", "graph": store.snapshot()})
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield _sse(event)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            store.bus.unsubscribe(queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


# ================= artifacts + static SPA =================
app.mount("/artifacts", StaticFiles(directory=str(ARTIFACT_DIR)), name="artifacts")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "web_built": str(WEB_DIST.exists())}


if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(str(WEB_DIST / "index.html"))

    @app.get("/{full_path:path}")
    def spa(full_path: str) -> FileResponse:
        candidate = WEB_DIST / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(WEB_DIST / "index.html"))
else:

    @app.get("/")
    def index_unbuilt() -> JSONResponse:
        return JSONResponse(
            {
                "msg": "Loom server is running, but the canvas is not built yet.",
                "hint": "cd web && pnpm install && pnpm build, or run the Vite dev server with pnpm dev.",
                "api": "/api/graph",
            }
        )
