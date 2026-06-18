"""Loom MCP bridge (stdio).

Claude Code / Codex spawns this process. It owns no state — every tool is a thin
proxy to the long-running canvas server's REST API. This keeps the design clean:
the canvas is the single source of truth, the MCP server just lets the model
read and mutate it, and the model itself is the execution engine.

Design-time tools (add_node, connect, ...) let the model build the canvas from
natural language. Runtime tools (get_run_plan, set_node_result, ...) let the
model execute the graph node-by-node and stream results back to the canvas.
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import httpx
from mcp.server.fastmcp import FastMCP

BASE_URL = os.environ.get("LOOM_SERVER_URL", "http://127.0.0.1:8765").rstrip("/")

mcp = FastMCP("loom")


def _client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=20.0)


def _call(method: str, path: str, **kwargs) -> Any:
    try:
        with _client() as c:
            r = c.request(method, path, **kwargs)
    except httpx.ConnectError:
        return {
            "error": "cannot reach Loom canvas server",
            "hint": f"start it first: it should be listening on {BASE_URL}",
        }
    if r.status_code >= 400:
        return {"error": f"{r.status_code}", "detail": r.text}
    try:
        return r.json()
    except Exception:
        return {"ok": True}


def _graph_summary() -> dict[str, Any]:
    """Fetch the full graph and return a token-cheap structural summary.

    Used as the return value of every mutating tool so the model sees the
    resulting canvas state after its edit (mutation endpoints return only the
    single changed entity)."""
    return _summary(_call("GET", "/api/graph"))


def _after(result: Any) -> dict[str, Any]:
    """Return the error if a mutation failed, else a fresh graph summary."""
    if isinstance(result, dict) and "error" in result:
        return result
    return _graph_summary()


def _summary(graph: dict[str, Any]) -> dict[str, Any]:
    """Trim a full graph dump to a token-cheap structural summary."""
    if "error" in graph:
        return graph
    return {
        "name": graph.get("name"),
        "description": graph.get("description"),
        "entry_point": graph.get("entry_point"),
        "nodes": [
            {
                "id": n["id"],
                "type": n["type"],
                "label": n["label"],
                "category": n.get("category"),
                "status": n.get("status"),
                "versions": [v["version"] for v in n.get("versions", [])],
            }
            for n in graph.get("nodes", [])
        ],
        "edges": [
            {"source": e["source"], "target": e["target"], "label": e.get("label")}
            for e in graph.get("edges", [])
        ],
    }


# ============== reads ==============
@mcp.tool()
def get_graph() -> dict[str, Any]:
    """Return a structural summary of the current canvas (nodes, edges, status).

    Use this before editing so you know what already exists. For a node's full
    result content, use get_node."""
    return _summary(_call("GET", "/api/graph"))


@mcp.tool()
def get_node(node_id: str) -> dict[str, Any]:
    """Return one node's full config and all result versions (with content)."""
    graph = _call("GET", "/api/graph")
    if "error" in graph:
        return graph
    for n in graph.get("nodes", []):
        if n["id"] == node_id:
            return n
    return {"error": f"node '{node_id}' not found"}


@mcp.tool()
def get_run_plan() -> dict[str, Any]:
    """Return the topologically-ordered execution plan.

    Call this when the user asks to run/execute the canvas. It gives you the node
    order, each node's instruction + tools, and which upstream results are ready.
    Then YOU (Claude Code/Codex) execute each step in order, writing each result
    back with set_node_result so the canvas updates live."""
    return _call("GET", "/api/run-plan")


# ============== graph-level edits ==============
@mcp.tool()
def set_meta(name: Optional[str] = None, description: Optional[str] = None) -> dict[str, Any]:
    """Set the canvas title and/or description."""
    return _after(_call("PATCH", "/api/graph", json={"name": name, "description": description}))


@mcp.tool()
def replace_graph(graph_json: str) -> dict[str, Any]:
    """Replace the ENTIRE canvas with a graph given as a JSON string.

    Use for bulk scaffolding (e.g. instantiating a research template). The JSON
    must match the Graph schema: {name, description, nodes:[{id,type,label,
    instruction,tools,category,position:{x,y}}], edges:[{id,source,target,label}],
    entry_point}. Prefer incremental add_node/connect for small edits."""
    try:
        data = json.loads(graph_json)
    except json.JSONDecodeError as e:
        return {"error": f"invalid JSON: {e}"}
    return _after(_call("PUT", "/api/graph", json=data))


@mcp.tool()
def clear_graph() -> dict[str, Any]:
    """Wipe the canvas to an empty graph. Destructive."""
    return _after(_call("DELETE", "/api/graph"))


@mcp.tool()
def set_entry_point(node_id: str) -> dict[str, Any]:
    """Mark which node executes first."""
    return _after(_call("POST", f"/api/graph/entry/{node_id}"))


# ============== nodes ==============
@mcp.tool()
def add_node(
    node_id: str,
    label: str,
    instruction: str = "",
    type: str = "agent",
    category: str = "general",
    tools: Optional[list[str]] = None,
    model: str = "",
    x: Optional[float] = None,
    y: Optional[float] = None,
) -> dict[str, Any]:
    """Add a node to the canvas.

    type: agent | function | input | output
    category (for agents): general | router | orchestrator | research | analysis | output
    instruction: the brief this agent will follow when executed.
    tools: capability hints (e.g. ['web_search','social_listening']).
    x,y: optional canvas position; omit to auto-place."""
    body: dict[str, Any] = {
        "id": node_id,
        "label": label,
        "instruction": instruction,
        "type": type,
        "category": category,
        "tools": tools or [],
        "model": model,
    }
    if x is not None and y is not None:
        body["position"] = {"x": x, "y": y}
    return _after(_call("POST", "/api/nodes", json=body))


@mcp.tool()
def update_node(node_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Patch a node's fields. Allowed keys: label, instruction, model, tools,
    category, config, status, type, position."""
    return _after(_call("PATCH", f"/api/nodes/{node_id}", json={"changes": changes}))


@mcp.tool()
def remove_node(node_id: str) -> dict[str, Any]:
    """Delete a node and its connected edges."""
    return _after(_call("DELETE", f"/api/nodes/{node_id}"))


# ============== edges ==============
@mcp.tool()
def connect(source: str, target: str, label: Optional[str] = None, condition: Optional[str] = None) -> dict[str, Any]:
    """Connect source node -> target node (data/control flow direction)."""
    return _after(
        _call("POST", "/api/edges", json={"source": source, "target": target, "label": label, "condition": condition})
    )


@mcp.tool()
def disconnect(source: str, target: str) -> dict[str, Any]:
    """Remove the edge source -> target."""
    return _after(_call("DELETE", "/api/edges", params={"source": source, "target": target}))


# ============== runtime: results ==============
@mcp.tool()
def set_node_status(node_id: str, status: str) -> dict[str, Any]:
    """Set a node's status: idle | pending | running | complete | error.
    Set 'running' before you start executing a node so the canvas shows it live."""
    return _after(_call("POST", f"/api/nodes/{node_id}/status", json={"status": status}))


@mcp.tool()
def set_node_result(
    node_id: str,
    content: str,
    content_type: str = "markdown",
    version: Optional[str] = None,
    status: str = "complete",
    sources: Optional[list[dict[str, Any]]] = None,
    artifacts: Optional[list[dict[str, Any]]] = None,
    select: bool = True,
) -> dict[str, Any]:
    """Write a result back to a node — this is how output appears on the canvas.

    content_type: markdown | html | slides | chart | table | image | json | text
      - markdown: rich text (default)
      - html / slides: a full self-contained HTML document (slides = reveal.js-style deck)
      - chart: JSON {type:'bar'|'line'|'pie'|'area', data:[...], xKey, series:[{key,name}]}
      - table: JSON {columns:[...], rows:[[...],...]}
      - image: a URL or /artifacts/... path
    version: label for 并发试错 / abstract-card. Call multiple times with v1, v2,
      v3 to stack alternative versions the user can compare and pick on the canvas.
    sources: evidence chain for 快速追溯, e.g.
      [{"type":"url","ref":"https://...","label":"...","confidence":0.8},
       {"type":"node","ref":"upstream_node_id"}]
    artifacts: produced files, e.g. [{"filename":"deck.pptx","path":"/artifacts/deck.pptx","type":"pptx"}]"""
    body = {
        "content": content,
        "content_type": content_type,
        "version": version,
        "status": status,
        "sources": sources or [],
        "artifacts": artifacts or [],
        "select": select,
    }
    return _after(_call("POST", f"/api/nodes/{node_id}/result", json=body))


# ============== projects (history of canvases) ==============
@mcp.tool()
def list_projects() -> Any:
    """List all canvases/projects in the workspace (id, name, node_count, active).
    Each project is an independent canvas with its own graph and version history."""
    return _call("GET", "/api/projects")


@mcp.tool()
def new_project(name: str) -> dict[str, Any]:
    """Create a NEW empty canvas/project and switch to it. Use this when the user
    starts a different study (e.g. a Nike analysis vs an existing On Running one)
    so each gets its own canvas and history. Returns the new project, then design
    it as usual with add_node/connect."""
    return _call("POST", "/api/projects", json={"name": name})


@mcp.tool()
def switch_project(project_id: str) -> dict[str, Any]:
    """Switch the active canvas to an existing project by id (from list_projects)."""
    return _call("POST", f"/api/projects/{project_id}/activate")


# ============== checkpoints (version history / rollback) ==============
@mcp.tool()
def checkpoint(message: str) -> dict[str, Any]:
    """Save the current canvas as a named version in this project's history.

    Call this at meaningful milestones so the user can roll back later — e.g.
    after finishing the design ("designed canvas"), and after a run ("ran research,
    v1"). Editing after restoring an old checkpoint creates a branch."""
    return _call("POST", "/api/checkpoints", json={"message": message})


@mcp.tool()
def list_history() -> Any:
    """List this project's saved versions (checkpoints) as a tree with head + parent
    links, plus whether there are unsaved changes."""
    return _call("GET", "/api/checkpoints")


@mcp.tool()
def restore_checkpoint(checkpoint_id: str) -> dict[str, Any]:
    """Roll the canvas back to a saved version (from list_history). Non-destructive:
    current unsaved work is auto-saved first, and editing after a restore branches
    from that point. The canvas updates live."""
    return _after(_call("POST", f"/api/checkpoints/{checkpoint_id}/restore"))


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
