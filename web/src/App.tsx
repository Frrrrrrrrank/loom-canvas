import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { api, subscribe } from "./api";
import { AddCard } from "./AddCard";
import { Canvas } from "./Canvas";
import { HistoryPanel } from "./HistoryPanel";
import { Home } from "./Home";
import { FullscreenModal, Inspector } from "./Inspector";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useStore } from "./store";

export default function App() {
  const graph = useStore((s) => s.graph);
  const connected = useStore((s) => s.connected);
  const applyEvent = useStore((s) => s.applyEvent);
  const setConnected = useStore((s) => s.setConnected);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const refreshWorkspace = useStore((s) => s.refreshWorkspace);
  const setHistoryOpen = useStore((s) => s.setHistoryOpen);
  const dirty = useStore((s) => s.dirty);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  useEffect(() => {
    const unsub = subscribe(applyEvent, setConnected);
    refreshWorkspace();
    return unsub;
  }, [applyEvent, setConnected, refreshWorkspace]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const saveVersion = async () => {
    const msg = window.prompt("Save current canvas as version — label:", "manual save");
    if (msg === null) return;
    await api.createCheckpoint(msg || "manual save");
  };

  return (
    <div className="loom-app">
      <header className="loom-topbar">
        <div className="loom-brand">
          <button
            className="loom-brand-btn"
            onClick={() => setView("home")}
            title="Home"
          >
            <span className="loom-logo">◇</span>
            <span className="loom-brand-name">Loom</span>
          </button>
          {view === "canvas" && (
            <>
              <span className="loom-brand-sep">/</span>
              <ProjectSwitcher />
            </>
          )}
        </div>
        <div className="loom-topbar-right">
          {view === "canvas" && (
            <>
              {(() => {
                const pending = (graph?.nodes ?? []).reduce(
                  (a, n) => a + (n.thread ?? []).filter((m) => m.role === "user" && !m.processed).length,
                  0,
                );
                return pending > 0 ? (
                  <span
                    className="loom-inbox"
                    title='在 Claude Code 里说"处理画布留言",它会处理这些卡片留言并回复'
                  >
                    💬 {pending}
                  </span>
                ) : null;
              })()}
              <button className="loom-btn ghost" onClick={saveVersion} title="Save a version">
                {dirty ? "● Save" : "Save"}
              </button>
              <button
                className="loom-btn ghost"
                onClick={() => setHistoryOpen(true)}
                title="Version history"
              >
                ⟲ History
              </button>
              <AddCard />
            </>
          )}
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

      {view === "home" ? (
        <Home />
      ) : (
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
                    Or click <b>+ Card</b> to add one manually (start with a Core Question).
                  </p>
                </div>
              )}
            </div>
          </ReactFlowProvider>
          <Inspector />
        </div>
      )}
      <FullscreenModal />
      <HistoryPanel />
    </div>
  );
}
