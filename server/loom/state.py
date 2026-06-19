"""Project-aware graph store with a checkpoint history tree.

A workspace (~/.loom) holds many **projects**; each project is one named canvas
with its own working graph and its own tree of **checkpoints** (versions). Exactly
one project is active at a time; the existing graph-mutation API operates on the
active project's working graph and persists it. Restoring an old checkpoint and
then editing creates a branch (Lovable-style), because every new checkpoint's
parent is the current head.

Layout:
    <root>/active.txt                         # active project id
    <root>/projects/<pid>/working.json        # current editable graph
    <root>/projects/<pid>/project.json        # ProjectMeta + checkpoint tree
    <root>/projects/<pid>/snapshots/<cid>.json  # immutable graph per checkpoint
"""

from __future__ import annotations

import asyncio
import functools
import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from .models import (
    Artifact,
    Checkpoint,
    Edge,
    Graph,
    Node,
    Position,
    ProjectMeta,
    ResultVersion,
    Source,
)


def _synchronized(method):
    """Serialize a Store method under self._lock (reentrant).

    Endpoints run in FastAPI's threadpool, so parallel subagents can hit the
    store concurrently. This makes each read-modify-write-emit atomic, so the
    in-memory graph and the JSON files never tear under concurrent writes."""

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper


class Broadcaster:
    """Fan-out async pub/sub for SSE clients.

    Mutations (and the auto-save timer) run on worker/timer threads, not the event
    loop, so we deliver via the subscriber's own loop with call_soon_threadsafe —
    instant and thread-safe, instead of relying on the SSE keepalive to flush."""

    def __init__(self) -> None:
        self._subs: dict[asyncio.Queue, asyncio.AbstractEventLoop] = {}

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subs[q] = asyncio.get_running_loop()
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.pop(q, None)

    @staticmethod
    def _safe_put(q: asyncio.Queue, event: dict[str, Any]) -> None:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass

    def publish(self, event: dict[str, Any]) -> None:
        for q, loop in list(self._subs.items()):
            try:
                loop.call_soon_threadsafe(self._safe_put, q, event)
            except RuntimeError:
                self._subs.pop(q, None)


def _new_id() -> str:
    return uuid.uuid4().hex[:8]


class Store:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.projects_dir = self.root / "projects"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.bus = Broadcaster()
        self._lock = threading.RLock()
        self.active_pid: str = ""
        self.meta: ProjectMeta = ProjectMeta(id="")
        self.graph: Graph = Graph()
        # idle auto-save: a debounced snapshot fires this many seconds after the
        # last edit (0 disables). Auto-checkpoints are capped at _autosave_max.
        self._autosave_idle = float(os.environ.get("LOOM_AUTOSAVE_IDLE", "60"))
        self._autosave_max = int(os.environ.get("LOOM_AUTOSAVE_MAX", "40"))
        self._autosave_timer: Optional[threading.Timer] = None
        self._bootstrap()

    # ============== paths ==============
    def _pdir(self, pid: str) -> Path:
        return self.projects_dir / pid

    def _working_path(self, pid: str) -> Path:
        return self._pdir(pid) / "working.json"

    def _meta_path(self, pid: str) -> Path:
        return self._pdir(pid) / "project.json"

    def _snap_path(self, pid: str, cid: str) -> Path:
        return self._pdir(pid) / "snapshots" / f"{cid}.json"

    @staticmethod
    def _write_json(path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # ============== bootstrap / migration ==============
    def _discover(self) -> list[str]:
        return [
            p.name
            for p in self.projects_dir.iterdir()
            if p.is_dir() and (p / "project.json").exists()
        ]

    def _bootstrap(self) -> None:
        pids = self._discover()
        if not pids:
            legacy = self.root / "graph.json"
            if legacy.exists():
                try:
                    g = Graph.model_validate_json(legacy.read_text(encoding="utf-8"))
                except Exception:
                    g = Graph()
                pid = self._create_project_files(g.name or "Imported Canvas", g)
            else:
                pid = self._create_project_files("Untitled Research", Graph())
            self.active_pid = pid
        else:
            active_file = self.root / "active.txt"
            ap = active_file.read_text(encoding="utf-8").strip() if active_file.exists() else ""
            self.active_pid = ap if ap in pids else sorted(pids)[0]
        self._load_active()
        self._set_active_file()
        # ensure the project has at least a root checkpoint
        if not self.meta.checkpoints:
            self._checkpoint_internal("initial", auto=True)

    def _create_project_files(self, name: str, graph: Graph) -> str:
        pid = _new_id()
        (self._pdir(pid) / "snapshots").mkdir(parents=True, exist_ok=True)
        graph = graph.model_copy(deep=True)
        if name:
            graph.name = name
        meta = ProjectMeta(id=pid, name=name or graph.name or "Untitled Research")
        self._write_json(self._working_path(pid), graph.model_dump())
        self._write_json(self._meta_path(pid), meta.model_dump())
        return pid

    def _load_active(self) -> None:
        mp = self._meta_path(self.active_pid)
        self.meta = ProjectMeta.model_validate_json(mp.read_text(encoding="utf-8"))
        wp = self._working_path(self.active_pid)
        if wp.exists():
            try:
                self.graph = Graph.model_validate_json(wp.read_text(encoding="utf-8"))
            except Exception:
                self.graph = Graph()
        else:
            self.graph = Graph()

    def _set_active_file(self) -> None:
        (self.root / "active.txt").write_text(self.active_pid, encoding="utf-8")

    # ============== persistence + events ==============
    def _persist(self) -> None:
        now = time.time()
        self.graph.updated_at = now
        self.meta.updated_at = now
        if self.graph.name:
            self.meta.name = self.graph.name
        self._write_json(self._working_path(self.active_pid), self.graph.model_dump())
        self._write_json(self._meta_path(self.active_pid), self.meta.model_dump())
        self._schedule_autosave()

    # ============== idle auto-save ==============
    def _schedule_autosave(self) -> None:
        """(Re)start the debounce timer; fires an auto-checkpoint once edits idle."""
        if self._autosave_idle <= 0:
            return
        if self._autosave_timer is not None:
            self._autosave_timer.cancel()
        timer = threading.Timer(self._autosave_idle, self._autosave_fire)
        timer.daemon = True
        self._autosave_timer = timer
        timer.start()

    def _autosave_fire(self) -> None:
        try:
            with self._lock:
                if self._is_dirty():
                    self._checkpoint_internal("auto-save", auto=True)
                    self._prune_auto()
                    self._emit_workspace()
        except Exception:
            pass

    def _flush_autosave(self) -> None:
        """Cancel any pending timer and snapshot the active canvas now if dirty.

        Called before switching/creating a project so the outgoing canvas's
        unsaved edits become a version instead of being silently carried away."""
        if self._autosave_timer is not None:
            self._autosave_timer.cancel()
            self._autosave_timer = None
        if self._is_dirty():
            self._checkpoint_internal("auto-save", auto=True)
            self._prune_auto()

    def _prune_auto(self) -> None:
        """Keep at most _autosave_max auto-checkpoints (oldest dropped), so history
        stays readable. Manual checkpoints and the head are never pruned; children
        of a dropped node are reparented to its nearest surviving ancestor."""
        autos = [c for c in self.meta.checkpoints if c.auto and c.id != self.meta.head_id]
        excess = len(autos) - self._autosave_max
        if excess <= 0:
            return
        to_remove = autos[:excess]
        remove_ids = {c.id for c in to_remove}
        parent_of = {c.id: c.parent_id for c in self.meta.checkpoints}

        def survivor(pid: Optional[str]) -> Optional[str]:
            while pid in remove_ids:
                pid = parent_of.get(pid)
            return pid

        for c in self.meta.checkpoints:
            if c.parent_id in remove_ids:
                c.parent_id = survivor(c.parent_id)
        for c in to_remove:
            try:
                self._snap_path(self.active_pid, c.id).unlink(missing_ok=True)
            except Exception:
                pass
        self.meta.checkpoints = [c for c in self.meta.checkpoints if c.id not in remove_ids]
        self._write_json(self._meta_path(self.active_pid), self.meta.model_dump())

    def _emit(self, kind: str = "graph") -> None:
        self._persist()
        self.bus.publish({"type": kind, "graph": self.graph.model_dump()})

    def _emit_workspace(self) -> None:
        self.bus.publish({"type": "workspace"})

    # ============== reads ==============
    @_synchronized
    def snapshot(self) -> dict[str, Any]:
        return self.graph.model_dump()

    # ============== projects ==============
    @_synchronized
    def list_projects(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for p in self.projects_dir.iterdir():
            mp = p / "project.json"
            if not mp.exists():
                continue
            try:
                m = ProjectMeta.model_validate_json(mp.read_text(encoding="utf-8"))
            except Exception:
                continue
            node_count = 0
            wp = p / "working.json"
            if wp.exists():
                try:
                    node_count = len(json.loads(wp.read_text(encoding="utf-8")).get("nodes", []))
                except Exception:
                    pass
            out.append(
                {
                    "id": m.id,
                    "name": m.name,
                    "created_at": m.created_at,
                    "updated_at": m.updated_at,
                    "node_count": node_count,
                    "checkpoints": len(m.checkpoints),
                    "active": m.id == self.active_pid,
                }
            )
        out.sort(key=lambda x: x["updated_at"], reverse=True)
        return out

    @_synchronized
    def create_project(self, name: str = "") -> dict[str, Any]:
        self._flush_autosave()  # save the outgoing canvas's unsaved edits first
        pid = self._create_project_files(name or "Untitled Research", Graph())
        self.active_pid = pid
        self._set_active_file()
        self._load_active()
        self._checkpoint_internal("created", auto=True)
        self._emit()
        self._emit_workspace()
        return {"id": pid, "name": self.meta.name}

    @_synchronized
    def switch_project(self, pid: str) -> dict[str, Any]:
        if not self._meta_path(pid).exists():
            raise KeyError(pid)
        self._flush_autosave()  # save the outgoing canvas's unsaved edits first
        self.active_pid = pid
        self._set_active_file()
        self._load_active()
        self._emit()
        self._emit_workspace()
        return {"id": pid, "name": self.meta.name}

    @_synchronized
    def rename_project(self, pid: str, name: str) -> dict[str, Any]:
        mp = self._meta_path(pid)
        if not mp.exists():
            raise KeyError(pid)
        m = ProjectMeta.model_validate_json(mp.read_text(encoding="utf-8"))
        m.name = name
        self._write_json(mp, m.model_dump())
        if pid == self.active_pid:
            self.meta = m
            self.graph.name = name
            self._emit()
        self._emit_workspace()
        return {"id": pid, "name": name}

    @_synchronized
    def delete_project(self, pid: str) -> None:
        if not self._pdir(pid).exists():
            raise KeyError(pid)
        shutil.rmtree(self._pdir(pid), ignore_errors=True)
        if pid == self.active_pid:
            remaining = self._discover()
            if remaining:
                self.active_pid = sorted(remaining)[0]
            else:
                self.active_pid = self._create_project_files("Untitled Research", Graph())
            self._set_active_file()
            self._load_active()
            if not self.meta.checkpoints:
                self._checkpoint_internal("initial", auto=True)
            self._emit()
        self._emit_workspace()

    # ============== checkpoints (history) ==============
    def _checkpoint_internal(self, message: str, auto: bool = False) -> Checkpoint:
        cid = _new_id()
        cp = Checkpoint(
            id=cid,
            parent_id=self.meta.head_id,
            message=message or "snapshot",
            node_count=len(self.graph.nodes),
            edge_count=len(self.graph.edges),
            auto=auto,
        )
        self._write_json(self._snap_path(self.active_pid, cid), self.graph.model_dump())
        self.meta.checkpoints.append(cp)
        self.meta.head_id = cid
        self._write_json(self._meta_path(self.active_pid), self.meta.model_dump())
        return cp

    def _is_dirty(self) -> bool:
        """True if the working graph differs from the head checkpoint's snapshot."""
        if not self.meta.head_id:
            return bool(self.graph.nodes)
        snap = self._snap_path(self.active_pid, self.meta.head_id)
        if not snap.exists():
            return True
        try:
            head_graph = json.loads(snap.read_text(encoding="utf-8"))
        except Exception:
            return True
        cur = self.graph.model_dump()
        # ignore timestamp noise
        cur.pop("updated_at", None)
        head_graph.pop("updated_at", None)
        return json.dumps(cur, sort_keys=True, ensure_ascii=False) != json.dumps(
            head_graph, sort_keys=True, ensure_ascii=False
        )

    @_synchronized
    def checkpoint(self, message: str = "") -> dict[str, Any]:
        cp = self._checkpoint_internal(message, auto=False)
        self._emit_workspace()
        return cp.model_dump()

    @_synchronized
    def list_history(self) -> dict[str, Any]:
        return {
            "head_id": self.meta.head_id,
            "dirty": self._is_dirty(),
            "checkpoints": [c.model_dump() for c in self.meta.checkpoints],
        }

    @_synchronized
    def restore_checkpoint(self, cid: str) -> dict[str, Any]:
        if not any(c.id == cid for c in self.meta.checkpoints):
            raise KeyError(cid)
        snap = self._snap_path(self.active_pid, cid)
        if not snap.exists():
            raise KeyError(cid)
        # never lose uncommitted work: auto-snapshot current state first
        if self._is_dirty():
            self._checkpoint_internal("auto-save before restore", auto=True)
        self.graph = Graph.model_validate_json(snap.read_text(encoding="utf-8"))
        self.meta.head_id = cid
        self._emit()
        self._emit_workspace()
        return {"restored": cid, "head_id": self.meta.head_id}

    # ============== graph-level ==============
    @_synchronized
    def replace_graph(self, data: dict[str, Any]) -> Graph:
        if self._is_dirty() and self.graph.nodes:
            self._checkpoint_internal("auto-save before replace", auto=True)
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
        if self.graph.nodes:
            self._checkpoint_internal("auto-save before clear", auto=True)
        name = self.graph.name
        self.graph = Graph(name=name)
        self._emit()
        return self.graph

    # ============== nodes ==============
    @_synchronized
    def add_node(self, node: Node) -> Node:
        if self.graph.node(node.id):
            raise ValueError(f"node '{node.id}' already exists")
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
            self.graph.entry_point = self.graph.nodes[0].id if self.graph.nodes else None
        self._emit()

    @_synchronized
    def set_entry_point(self, node_id: str) -> Graph:
        if not self.graph.node(node_id):
            raise KeyError(node_id)
        self.graph.entry_point = node_id
        self._emit()
        return self.graph

    # ============== edges ==============
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

    # ============== results / versions ==============
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

    # ============== layout helper ==============
    def _auto_position(self) -> Position:
        n = len(self.graph.nodes)
        col = n % 3
        row = n // 3
        return Position(x=120 + col * 340, y=80 + row * 240)
