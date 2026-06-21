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

from pydantic import BaseModel, Field, model_validator

NodeType = Literal["agent", "function", "input", "output"]
NodeStatus = Literal["idle", "pending", "running", "complete", "error"]
ContentType = Literal[
    "markdown", "html", "slides", "chart", "table", "image", "json", "text", "error"
]

# A card's role in the research workflow (the semantic backbone):
#   core_question  one per study — defines the question + boundary
#   issue          an issue/hypothesis (issue tree), with a support status
#   research       a (deep) research task that gathers evidence
#   synthesis      distills connected research into a storyline (multi-version)
#   output         the deliverable / visualization (deck)
#   note           generic free node
NodeRole = Literal["core_question", "issue", "research", "synthesis", "output", "note"]

# How a card supports/challenges an issue's hypothesis (set from research).
IssueStatus = Literal["untested", "supported", "challenged", "mixed"]

# Typed meaning of an edge, by the roles it connects.
EdgeRelation = Literal["decompose", "support", "distill", "visualize", "evidence", "relate"]

# legacy category/type -> role, so existing graphs migrate automatically
_CATEGORY_TO_ROLE = {
    "research": "research",
    "analysis": "synthesis",
    "orchestrator": "synthesis",
    "output": "output",
    "general": "note",
}
_TYPE_TO_ROLE = {"input": "core_question", "output": "output"}

_RELATION_BY_ROLES = {
    ("core_question", "issue"): "decompose",
    ("issue", "research"): "support",
    ("research", "synthesis"): "distill",
    ("synthesis", "output"): "visualize",
    ("research", "issue"): "evidence",
}


def relation_for_roles(src_role: str, tgt_role: str) -> str:
    return _RELATION_BY_ROLES.get((src_role, tgt_role), "relate")


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


FindingKind = Literal["number", "fact", "judgment"]
FindingNovelty = Literal["corroborated", "marginal"]
FindingStatus = Literal["candidate", "accepted", "rejected"]
RunStatus = Literal["running", "complete", "error"]


class ResearchRun(BaseModel):
    """One concurrent deep-research pass (run by one CC/Codex subagent)."""

    id: str
    label: str = ""
    status: RunStatus = "complete"
    summary: str = Field("", description="markdown narrative of what this run found")
    created_at: float = Field(default_factory=_now)


class Finding(BaseModel):
    """An atomic claim/number distilled from the runs — the unit of traceability.

    confidence is per-finding (per the user's spec: we care about the confidence of
    each NUMBER, derived from source provenance × how many sources/runs corroborate
    it), not per-source. novelty flags whether multiple runs agreed (corroborated)
    or it's a marginal increment only one run surfaced — the human then accepts/rejects."""

    id: str
    text: str
    kind: FindingKind = "fact"
    sources: list[Source] = Field(default_factory=list)
    confidence: float = Field(0.0, description="0..1, from provenance × corroboration")
    runs: list[str] = Field(default_factory=list, description="run ids that surfaced this")
    novelty: FindingNovelty = "corroborated"
    status: FindingStatus = "candidate"
    created_at: float = Field(default_factory=_now)


class Research(BaseModel):
    """The multi-run payload of a research card."""

    question: str = ""
    runs: list[ResearchRun] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)


class ResultVersion(BaseModel):
    """One 'card' in the 并发试错 deck for a node."""

    version: str = Field(..., description="label, e.g. v1 / v2 / 'risk-first'")
    content: str = ""
    content_type: ContentType = "markdown"
    sources: list[Source] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)
    selected: bool = False
    created_at: float = Field(default_factory=_now)


class CardMessage(BaseModel):
    """One turn in a card's chat thread.

    role 'user' = a human note typed on the canvas (LibTV-style in-card chat);
    role 'assistant' = Claude Code's reply. Unprocessed user messages form the
    inbox the model drains when the user says '处理画布留言'."""

    id: str
    role: Literal["user", "assistant"]
    text: str
    created_at: float = Field(default_factory=_now)
    processed: bool = Field(default=False, description="for user msgs: has CC handled it")


class Node(BaseModel):
    id: str = Field(..., description="unique node id within the graph")
    role: NodeRole = Field(
        "note",
        description="card role: core_question | issue | research | synthesis | output | note",
    )
    type: NodeType = "agent"  # legacy; role is the semantic field
    label: str = ""
    # --- design-time content (set at design time) ---
    instruction: str = Field("", description="the card's brief / task")
    fields: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "role-specific structured content. "
            "core_question: {basic_question, context, criteria_for_success, scope}; "
            "issue: {issue, hypothesis, status}; research: {question}"
        ),
    )
    model: str = Field("", description="informational only; Claude Code is the executor")
    tools: list[str] = Field(default_factory=list)
    category: str = Field("general", description="legacy; superseded by role")
    config: dict[str, Any] = Field(default_factory=dict)
    # --- runtime state (written back at execution time) ---
    status: NodeStatus = "idle"
    versions: list[ResultVersion] = Field(default_factory=list)
    thread: list[CardMessage] = Field(default_factory=list)
    research: Optional[Research] = Field(
        default=None, description="multi-run payload (research-role cards only)"
    )
    position: Position = Field(default_factory=Position)

    def unprocessed(self) -> int:
        return sum(1 for m in self.thread if m.role == "user" and not m.processed)

    @model_validator(mode="after")
    def _derive_role(self) -> "Node":
        # migrate legacy graphs: if role wasn't set, infer it from type/category
        if self.role == "note":
            inferred = _TYPE_TO_ROLE.get(self.type) or _CATEGORY_TO_ROLE.get(self.category)
            if inferred:
                self.role = inferred  # type: ignore[assignment]
        return self

    def selected_version(self) -> Optional[ResultVersion]:
        for v in self.versions:
            if v.selected:
                return v
        return self.versions[-1] if self.versions else None


class Edge(BaseModel):
    id: str
    source: str = Field(..., description="source node id")
    target: str = Field(..., description="target node id")
    relation: Optional[str] = Field(
        default=None,
        description="typed meaning: decompose | support | distill | visualize | evidence | relate",
    )
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


class Checkpoint(BaseModel):
    """One saved version in a project's history tree.

    parent_id links checkpoints into a tree, so restoring an old checkpoint and
    editing creates a branch (Lovable-style), not a destructive overwrite."""

    id: str
    parent_id: Optional[str] = None
    message: str = "snapshot"
    created_at: float = Field(default_factory=_now)
    node_count: int = 0
    edge_count: int = 0
    auto: bool = Field(default=False, description="created automatically (e.g. before a destructive op)")


class ProjectMeta(BaseModel):
    """A project = one named canvas with its own working graph + history tree."""

    id: str
    name: str = "Untitled Research"
    created_at: float = Field(default_factory=_now)
    updated_at: float = Field(default_factory=_now)
    head_id: Optional[str] = Field(
        default=None, description="checkpoint the current working graph descends from"
    )
    checkpoints: list[Checkpoint] = Field(default_factory=list)
