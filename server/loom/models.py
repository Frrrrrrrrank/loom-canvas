"""Loom domain model.

Adapted from Hatchify's GraphSpec (name / agents / functions / nodes / edges /
entry_point) but reshaped for Scheme 2: the server never runs an LLM. It only
holds the graph and the results that Claude Code / Codex writes back, then
streams them to the canvas. So nodes carry runtime state (status, versioned
results, position) that Hatchify kept server-side in its execution engine.
"""

from __future__ import annotations

import time
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

NodeType = Literal["agent", "function", "input", "output"]
NodeStatus = Literal["idle", "pending", "running", "complete", "error"]
ContentType = Literal[
    "markdown", "html", "slides", "chart", "table", "image", "json", "text", "error"
]


def _now() -> float:
    return time.time()


class Position(BaseModel):
    x: float = 0.0
    y: float = 0.0


class Source(BaseModel):
    """One link in an evidence chain — powers 快速追溯 on the canvas."""

    type: str = Field("url", description="url | node | doc | dataset | tool")
    ref: str = Field(..., description="URL, upstream node id, document name, etc.")
    label: Optional[str] = None
    confidence: Optional[float] = Field(
        default=None, description="0..1 confidence the analyst assigns to this source"
    )


class Artifact(BaseModel):
    """A produced file (e.g. a .pptx / .html export) served by the canvas server."""

    filename: str
    path: str = Field(..., description="server-relative path under /artifacts/")
    type: str = Field("file", description="pptx | html | png | csv | ...")


class ResultVersion(BaseModel):
    """One 'card' in the 并发试错 deck for a node."""

    version: str = Field(..., description="label, e.g. v1 / v2 / 'risk-first'")
    content: str = ""
    content_type: ContentType = "markdown"
    sources: list[Source] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)
    selected: bool = False
    created_at: float = Field(default_factory=_now)


class Node(BaseModel):
    id: str = Field(..., description="unique node id within the graph")
    type: NodeType = "agent"
    label: str = ""
    # --- design-time config (set by Claude Code at design time) ---
    instruction: str = Field("", description="the agent's brief / system instruction")
    model: str = Field("", description="informational only; Claude Code is the executor")
    tools: list[str] = Field(default_factory=list)
    category: str = Field(
        "general",
        description="general | router | orchestrator | research | analysis | output",
    )
    config: dict[str, Any] = Field(default_factory=dict)
    # --- runtime state (written back at execution time) ---
    status: NodeStatus = "idle"
    versions: list[ResultVersion] = Field(default_factory=list)
    position: Position = Field(default_factory=Position)

    def selected_version(self) -> Optional[ResultVersion]:
        for v in self.versions:
            if v.selected:
                return v
        return self.versions[-1] if self.versions else None


class Edge(BaseModel):
    id: str
    source: str = Field(..., description="source node id")
    target: str = Field(..., description="target node id")
    label: Optional[str] = None
    condition: Optional[str] = Field(
        default=None, description="optional human-readable routing condition"
    )


class Graph(BaseModel):
    name: str = "Untitled Research"
    description: str = ""
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    entry_point: Optional[str] = None
    updated_at: float = Field(default_factory=_now)

    # ---- convenience lookups ----
    def node(self, node_id: str) -> Optional[Node]:
        return next((n for n in self.nodes if n.id == node_id), None)

    def upstream(self, node_id: str) -> list[str]:
        return [e.source for e in self.edges if e.target == node_id]

    def downstream(self, node_id: str) -> list[str]:
        return [e.target for e in self.edges if e.source == node_id]

    def topo_order(self) -> list[str]:
        """Kahn topological sort; falls back to insertion order on a cycle."""
        ids = [n.id for n in self.nodes]
        indeg = {i: 0 for i in ids}
        for e in self.edges:
            if e.target in indeg and e.source in indeg:
                indeg[e.target] += 1
        # seed with entry point first if present
        queue = [i for i in ids if indeg[i] == 0]
        if self.entry_point and self.entry_point in queue:
            queue.remove(self.entry_point)
            queue.insert(0, self.entry_point)
        order: list[str] = []
        indeg = dict(indeg)
        while queue:
            cur = queue.pop(0)
            order.append(cur)
            for e in self.edges:
                if e.source == cur and e.target in indeg:
                    indeg[e.target] -= 1
                    if indeg[e.target] == 0:
                        queue.append(e.target)
        # append any nodes left out by a cycle, preserving order
        for i in ids:
            if i not in order:
                order.append(i)
        return order
