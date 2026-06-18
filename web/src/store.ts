import { create } from "zustand";
import type { Graph, GraphNode, SseEvent } from "./api";

export type Theme = "dark" | "light";

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
  // nodes the user is mid-drag on; we ignore server position echoes for these
  dragging: Set<string>;

  applyEvent: (e: SseEvent) => void;
  setConnected: (c: boolean) => void;
  selectNode: (id: string | null) => void;
  setFullscreen: (id: string | null) => void;
  toggleTheme: () => void;
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
  dragging: new Set(),

  applyEvent: (e) => {
    if (e.type === "graph") {
      set({ graph: e.graph });
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
