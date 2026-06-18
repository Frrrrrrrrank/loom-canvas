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

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  instruction: string;
  model: string;
  tools: string[];
  category: string;
  config: Record<string, unknown>;
  status: NodeStatus;
  versions: ResultVersion[];
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
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

export const api = {
  getGraph: () => fetch("/api/graph").then((r) => j<Graph>(r)),

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

export type SseEvent =
  | { type: "graph"; graph: Graph }
  | { type: "node_moved"; id: string; position: { x: number; y: number } };

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
