import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { api, subscribe } from "./api";
import { Canvas } from "./Canvas";
import { FullscreenModal, Inspector } from "./Inspector";
import { useStore } from "./store";

export default function App() {
  const graph = useStore((s) => s.graph);
  const connected = useStore((s) => s.connected);
  const applyEvent = useStore((s) => s.applyEvent);
  const setConnected = useStore((s) => s.setConnected);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  useEffect(() => {
    const unsub = subscribe(applyEvent, setConnected);
    return unsub;
  }, [applyEvent, setConnected]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const addNode = async () => {
    const id = `node_${Math.random().toString(36).slice(2, 7)}`;
    await api.addNode({ id, label: "New node", type: "agent", category: "general" });
    useStore.getState().selectNode(id);
  };

  return (
    <div className="loom-app">
      <header className="loom-topbar">
        <div className="loom-brand">
          <span className="loom-logo">◇</span>
          <span className="loom-brand-name">Loom</span>
          <span className="loom-brand-sep">/</span>
          <span className="loom-graph-name">{graph?.name || "Research Canvas"}</span>
        </div>
        <div className="loom-topbar-right">
          <button className="loom-btn" onClick={addNode}>
            + Node
          </button>
          <button
            className="loom-btn ghost loom-theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <span className={`loom-conn ${connected ? "on" : "off"}`}>
            <span className="loom-conn-dot" />
            {connected ? "live" : "disconnected"}
          </span>
        </div>
      </header>

      <div className="loom-body">
        <ReactFlowProvider>
          <div className="loom-canvas-wrap">
            <Canvas />
            {(!graph || graph.nodes.length === 0) && (
              <div className="loom-onboard">
                <h2>Empty canvas</h2>
                <p>
                  Design it from Claude Code / Codex — try:
                  <br />
                  <code>"用 Loom 搭一个昂跑台湾市场进入研究的画布"</code>
                </p>
                <p className="loom-onboard-dim">
                  Or click <b>+ Node</b> to add one manually. Both stay in sync.
                </p>
              </div>
            )}
          </div>
        </ReactFlowProvider>
        <Inspector />
      </div>
      <FullscreenModal />
    </div>
  );
}
