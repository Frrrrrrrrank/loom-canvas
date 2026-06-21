import { create } from "zustand";
import {
  api,
  type AgentStatus,
  type Checkpoint,
  type Graph,
  type GraphNode,
  type Project,
  type SseEvent,
} from "./api";

export type Theme = "dark" | "light";
export type View = "home" | "canvas";

const initialTheme: Theme =
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem("loom-theme") as Theme)) ||
  "dark";

interface LoomState {
  graph: Graph | null;
  connected: boolean;
  selectedNodeId: string | null;
  fullscreenNodeId: string | null;
  theme: Theme;
  view: View;
  // history / projects
  projects: Project[];
  checkpoints: Checkpoint[];
  headId: string | null;
  dirty: boolean;
  historyOpen: boolean;
  agent: AgentStatus | null;
  // nodes the user is mid-drag on; we ignore server position echoes for these
  dragging: Set<string>;

  applyEvent: (e: SseEvent) => void;
  setConnected: (c: boolean) => void;
  selectNode: (id: string | null) => void;
  setFullscreen: (id: string | null) => void;
  toggleTheme: () => void;
  setView: (v: View) => void;
  setHistoryOpen: (open: boolean) => void;
  refreshWorkspace: () => Promise<void>;
  beginDrag: (id: string) => void;
  endDrag: (id: string) => void;
  nodeById: (id: string) => GraphNode | undefined;
}

export const useStore = create<LoomState>((set, get) => ({
  graph: null,
  connected: false,
  selectedNodeId: null,
  fullscreenNodeId: null,
  theme: initialTheme,
  // land on the active canvas (so you see what CC is building); the home gallery
  // is one click away via the Loom wordmark.
  view: "canvas",
  projects: [],
  checkpoints: [],
  headId: null,
  dirty: false,
  historyOpen: false,
  agent: null,
  dragging: new Set(),

  applyEvent: (e) => {
    if (e.type === "graph") {
      // keep the active project's card count live without a refetch
      const projects = get().projects.map((p) =>
        p.active ? { ...p, node_count: e.graph.nodes.length } : p,
      );
      set({ graph: e.graph, projects });
    } else if (e.type === "node_moved") {
      const g = get().graph;
      if (!g || get().dragging.has(e.id)) return;
      set({
        graph: {
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === e.id ? { ...n, position: e.position } : n,
          ),
        },
      });
    } else if (e.type === "workspace") {
      void get().refreshWorkspace();
    } else if (e.type === "agent") {
      const { type: _t, ...status } = e;
      set({ agent: status });
    }
  },

  setView: (view) => set({ view }),
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  refreshWorkspace: async () => {
    try {
      const [projects, history, agent] = await Promise.all([
        api.listProjects(),
        api.getHistory(),
        api.getAgent(),
      ]);
      set({
        projects,
        checkpoints: history.checkpoints,
        headId: history.head_id,
        dirty: history.dirty,
        agent,
      });
    } catch {
      /* server not up yet */
    }
  },

  setConnected: (connected) => set({ connected }),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  setFullscreen: (fullscreenNodeId) => set({ fullscreenNodeId }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === "dark" ? "light" : "dark";
      if (typeof localStorage !== "undefined")
        localStorage.setItem("loom-theme", theme);
      return { theme };
    }),
  beginDrag: (id) =>
    set((s) => ({ dragging: new Set(s.dragging).add(id) })),
  endDrag: (id) =>
    set((s) => {
      const d = new Set(s.dragging);
      d.delete(id);
      return { dragging: d };
    }),
  nodeById: (id) => get().graph?.nodes.find((n) => n.id === id),
}));
