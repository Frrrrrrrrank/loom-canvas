"""In-memory graph store with JSON persistence and an async SSE broadcaster.

There is exactly one live graph per server process (MVP scope). State mutations
go through `Store`, which (a) persists to disk and (b) publishes a change event
to every connected SSE subscriber so the canvas re-renders in real time.
"""

from __future__ import annotations

import asyncio
import functools
import json
import threading
import time
from pathlib import Path
from typing import Any, Optional

from .models import (
    Artifact,
    Edge,
    Graph,
    Node,
    Position,
    ResultVersion,
    Source,
)


def _synchronized(method):
    """Serialize a Store method under self._lock.

    Endpoints run in FastAPI's threadpool, so parallel subagents can hit the
    store concurrently. This makes each read-modify-write-emit atomic, so the
    in-memory graph and the JSON file never tear under concurrent writes."""

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper


class Broadcaster:
    """Fan-out async pub/sub for SSE clients."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # slow client: drop it rather than block the whole server
                self._subscribers.discard(q)


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.bus = Broadcaster()
        self._lock = threading.RLock()
        self.graph: Graph = self._load()

    # ---------------- persistence ----------------
    def _load(self) -> Graph:
        if self.path.exists():
            try:
                return Graph.model_validate_json(self.path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return Graph()

    def _persist(self) -> None:
        self.graph.updated_at = time.time()
        self.path.write_text(
            self.graph.model_dump_json(indent=2), encoding="utf-8"
        )

    def _emit(self, kind: str = "graph") -> None:
        self._persist()
        self.bus.publish({"type": kind, "graph": self.graph.model_dump()})

    # ---------------- reads ----------------
    @_synchronized
    def snapshot(self) -> dict[str, Any]:
        return self.graph.model_dump()

    # ---------------- graph-level ----------------
    @_synchronized
    def replace_graph(self, data: dict[str, Any]) -> Graph:
        self.graph = Graph.model_validate(data)
        self._emit()
        return self.graph

    @_synchronized
    def set_meta(self, name: Optional[str], description: Optional[str]) -> Graph:
        if name is not None:
            self.graph.name = name
        if description is not None:
            self.graph.description = description
        self._emit()
        return self.graph

    @_synchronized
    def clear(self) -> Graph:
        self.graph = Graph()
        self._emit()
        return self.graph

    # ---------------- nodes ----------------
    @_synchronized
    def add_node(self, node: Node) -> Node:
        if self.graph.node(node.id):
            raise ValueError(f"node '{node.id}' already exists")
        # auto-place if no position given
        if node.position.x == 0 and node.position.y == 0:
            node.position = self._auto_position()
        self.graph.nodes.append(node)
        if self.graph.entry_point is None and node.type in ("agent", "input"):
            self.graph.entry_point = node.id
        self._emit()
        return node

    @_synchronized
    def update_node(self, node_id: str, changes: dict[str, Any]) -> Node:
        node = self.graph.node(node_id)
        if not node:
            raise KeyError(node_id)
        allowed = {
            "label", "instruction", "model", "tools", "category",
            "config", "status", "type", "position",
        }
        for k, v in changes.items():
            if k not in allowed:
                continue
            if k == "position" and isinstance(v, dict):
                node.position = Position.model_validate(v)
            else:
                setattr(node, k, v)
        self._emit()
        return node

    @_synchronized
    def move_node(self, node_id: str, x: float, y: float) -> Node:
        node = self.graph.node(node_id)
        if not node:
            raise KeyError(node_id)
        node.position = Position(x=x, y=y)
        # position-only change: persist but emit lightweight event
        self._persist()
        self.bus.publish(
            {"type": "node_moved", "id": node_id, "position": node.position.model_dump()}
        )
        return node

    @_synchronized
    def remove_node(self, node_id: str) -> None:
        if not self.graph.node(node_id):
            raise KeyError(node_id)
        self.graph.nodes = [n for n in self.graph.nodes if n.id != node_id]
        self.graph.edges = [
            e for e in self.graph.edges if e.source != node_id and e.target != node_id
        ]
        if self.graph.entry_point == node_id:
            self.graph.entry_point = (
                self.graph.nodes[0].id if self.graph.nodes else None
            )
        self._emit()

    @_synchronized
    def set_entry_point(self, node_id: str) -> Graph:
        if not self.graph.node(node_id):
            raise KeyError(node_id)
        self.graph.entry_point = node_id
        self._emit()
        return self.graph

    # ---------------- edges ----------------
    @_synchronized
    def add_edge(
        self,
        source: str,
        target: str,
        label: Optional[str] = None,
        condition: Optional[str] = None,
    ) -> Edge:
        if not self.graph.node(source):
            raise KeyError(source)
        if not self.graph.node(target):
            raise KeyError(target)
        edge_id = f"{source}->{target}"
        if any(e.id == edge_id for e in self.graph.edges):
            raise ValueError(f"edge '{edge_id}' already exists")
        edge = Edge(id=edge_id, source=source, target=target, label=label, condition=condition)
        self.graph.edges.append(edge)
        self._emit()
        return edge

    @_synchronized
    def remove_edge(self, source: str, target: str) -> None:
        edge_id = f"{source}->{target}"
        before = len(self.graph.edges)
        self.graph.edges = [e for e in self.graph.edges if e.id != edge_id]
        if len(self.graph.edges) == before:
            raise KeyError(edge_id)
        self._emit()

    # ---------------- results / versions ----------------
    @_synchronized
    def set_node_result(
        self,
        node_id: str,
        content: str,
        content_type: str = "markdown",
        version: Optional[str] = None,
        status: str = "complete",
        sources: Optional[list[dict[str, Any]]] = None,
        artifacts: Optional[list[dict[str, Any]]] = None,
        select: bool = True,
    ) -> Node:
        node = self.graph.node(node_id)
        if not node:
            raise KeyError(node_id)
        label = version or f"v{len(node.versions) + 1}"
        rv = ResultVersion(
            version=label,
            content=content,
            content_type=content_type,  # type: ignore[arg-type]
            sources=[Source.model_validate(s) for s in (sources or [])],
            artifacts=[Artifact.model_validate(a) for a in (artifacts or [])],
            selected=select,
        )
        # replace a version with the same label, else append
        existing = next((i for i, v in enumerate(node.versions) if v.version == label), None)
        if select:
            for v in node.versions:
                v.selected = False
        if existing is not None:
            node.versions[existing] = rv
        else:
            node.versions.append(rv)
        node.status = status  # type: ignore[assignment]
        self._emit()
        return node

    @_synchronized
    def select_version(self, node_id: str, version: str) -> Node:
        node = self.graph.node(node_id)
        if not node:
            raise KeyError(node_id)
        found = False
        for v in node.versions:
            v.selected = v.version == version
            found = found or v.selected
        if not found:
            raise KeyError(version)
        self._emit()
        return node

    @_synchronized
    def set_status(self, node_id: str, status: str) -> Node:
        node = self.graph.node(node_id)
        if not node:
            raise KeyError(node_id)
        node.status = status  # type: ignore[assignment]
        self._emit()
        return node

    # ---------------- layout helper ----------------
    def _auto_position(self) -> Position:
        n = len(self.graph.nodes)
        col = n % 3
        row = n // 3
        return Position(x=120 + col * 340, y=80 + row * 240)
