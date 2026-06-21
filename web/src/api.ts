// REST + SSE client for the Loom canvas server.

export type NodeType = "agent" | "function" | "input" | "output";
export type NodeStatus = "idle" | "pending" | "running" | "complete" | "error";
export type ContentType =
  | "markdown"
  | "html"
  | "slides"
  | "chart"
  | "table"
  | "image"
  | "json"
  | "text"
  | "error";

export interface Source {
  type: string;
  ref: string;
  label?: string | null;
  confidence?: number | null;
}

export interface Artifact {
  filename: string;
  path: string;
  type: string;
}

export interface ResultVersion {
  version: string;
  content: string;
  content_type: ContentType;
  sources: Source[];
  artifacts: Artifact[];
  selected: boolean;
  created_at: number;
}

export type NodeRole =
  | "core_question"
  | "issue"
  | "research"
  | "synthesis"
  | "output"
  | "note";

export interface CardMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: number;
  processed: boolean;
}

export interface ResearchRun {
  id: string;
  label: string;
  status: string;
  summary: string;
  created_at: number;
}

export interface Finding {
  id: string;
  text: string;
  kind: string;
  sources: Source[];
  confidence: number;
  runs: string[];
  novelty: string;
  status: string;
  created_at: number;
}

export interface Research {
  question: string;
  runs: ResearchRun[];
  findings: Finding[];
}

export interface GraphNode {
  id: string;
  role: NodeRole;
  type: NodeType;
  label: string;
  instruction: string;
  fields: Record<string, any>;
  model: string;
  tools: string[];
  category: string;
  config: Record<string, unknown>;
  status: NodeStatus;
  versions: ResultVersion[];
  thread: CardMessage[];
  research?: Research | null;
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation?: string | null;
  label?: string | null;
  condition?: string | null;
}

export interface Graph {
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entry_point: string | null;
  updated_at: number;
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export interface Project {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  node_count: number;
  checkpoints: number;
  active: boolean;
}

export interface Checkpoint {
  id: string;
  parent_id: string | null;
  message: string;
  created_at: number;
  node_count: number;
  edge_count: number;
  auto: boolean;
}

export interface History {
  head_id: string | null;
  dirty: boolean;
  checkpoints: Checkpoint[];
}

export const api = {
  getGraph: () => fetch("/api/graph").then((r) => j<Graph>(r)),

  // ---- projects (history of canvases) ----
  listProjects: () => fetch("/api/projects").then((r) => j<Project[]>(r)),
  createProject: (name: string) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => j<{ id: string; name: string }>(r)),
  activateProject: (id: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}/activate`, { method: "POST" }),
  renameProject: (id: string, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  deleteProject: (id: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ---- checkpoints (version history) ----
  getHistory: () => fetch("/api/checkpoints").then((r) => j<History>(r)),
  createCheckpoint: (message: string) =>
    fetch("/api/checkpoints", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  restoreCheckpoint: (id: string) =>
    fetch(`/api/checkpoints/${encodeURIComponent(id)}/restore`, { method: "POST" }),

  addNode: (body: Partial<GraphNode> & { id: string }) =>
    fetch("/api/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<GraphNode>(r)),

  patchNode: (id: string, changes: Record<string, unknown>) =>
    fetch(`/api/nodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
    }).then((r) => j<GraphNode>(r)),

  moveNode: (id: string, x: number, y: number) =>
    fetch(`/api/nodes/${encodeURIComponent(id)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x, y }),
    }),

  deleteNode: (id: string) =>
    fetch(`/api/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),

  selectVersion: (id: string, version: string) =>
    fetch(`/api/nodes/${encodeURIComponent(id)}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    }),

  sendCardMessage: (id: string, text: string) =>
    fetch(`/api/nodes/${encodeURIComponent(id)}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),

  setFindingStatus: (id: string, findingId: string, status: string) =>
    fetch(
      `/api/nodes/${encodeURIComponent(id)}/research/finding/${encodeURIComponent(findingId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      },
    ),

  getAgent: () => fetch("/api/agent").then((r) => j<AgentStatus>(r)),
  setAgent: (enabled: boolean) =>
    fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).then((r) => j<AgentStatus>(r)),

  addEdge: (source: string, target: string) =>
    fetch("/api/edges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, target }),
    }),

  deleteEdge: (source: string, target: string) =>
    fetch(
      `/api/edges?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`,
      { method: "DELETE" },
    ),

  setEntry: (id: string) =>
    fetch(`/api/graph/entry/${encodeURIComponent(id)}`, { method: "POST" }),

  setMeta: (name?: string, description?: string) =>
    fetch("/api/graph", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description }),
    }),
};

export interface AgentStatus {
  available: boolean;
  kind: string | null;
  enabled: boolean;
  running: boolean;
  last_error?: string | null;
}

export type SseEvent =
  | { type: "graph"; graph: Graph }
  | { type: "node_moved"; id: string; position: { x: number; y: number } }
  | { type: "workspace" }
  | ({ type: "agent" } & AgentStatus);

export function subscribe(
  onEvent: (e: SseEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const es = new EventSource("/api/events");
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore malformed */
    }
  };
  return () => es.close();
}
