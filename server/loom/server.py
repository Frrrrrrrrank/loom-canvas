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

from .models import Node
from .state import Store

# ---------------- paths ----------------
DATA_DIR = Path(os.environ.get("LOOM_DATA_DIR", Path.home() / ".loom"))
GRAPH_PATH = DATA_DIR / "graph.json"
ARTIFACT_DIR = DATA_DIR / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
WEB_DIST = Path(__file__).resolve().parent.parent.parent / "web" / "dist"

store = Store(GRAPH_PATH)

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
    type: str = "agent"
    label: str = ""
    instruction: str = ""
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
    steps = []
    for nid in order:
        node = g.node(nid)
        if not node or node.type not in ("agent", "function", "output"):
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
                "type": node.type,
                "category": node.category,
                "instruction": node.instruction,
                "tools": node.tools,
                "config": node.config,
                "upstream": upstream,
                "upstream_results": upstream_results,
                "status": node.status,
            }
        )
    return {
        "name": g.name,
        "description": g.description,
        "entry_point": g.entry_point,
        "order": order,
        "steps": steps,
    }


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


# ================= API: nodes =================
@app.post("/api/nodes")
def add_node(body: NodeBody) -> dict[str, Any]:
    node = Node(
        id=body.id,
        type=body.type,  # type: ignore[arg-type]
        label=body.label or body.id,
        instruction=body.instruction,
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


# ================= API: edges =================
@app.post("/api/edges")
def add_edge(body: EdgeBody) -> dict[str, Any]:
    try:
        return store.add_edge(body.source, body.target, body.label, body.condition).model_dump()
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
