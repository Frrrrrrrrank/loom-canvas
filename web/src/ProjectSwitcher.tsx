import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";

export function ProjectSwitcher() {
  const projects = useStore((s) => s.projects);
  const graph = useStore((s) => s.graph);
  const refresh = useStore((s) => s.refreshWorkspace);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = projects.find((p) => p.active);
  const activeName = active?.name || graph?.name || "Research Canvas";

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const newProject = async () => {
    const name = window.prompt("New canvas name", "Untitled Research");
    if (name === null) return;
    await api.createProject(name || "Untitled Research");
    useStore.getState().setView("canvas");
    setOpen(false);
    refresh();
  };

  const switchTo = async (id: string) => {
    await api.activateProject(id);
    useStore.getState().setView("canvas");
    setOpen(false);
  };

  const rename = async (id: string, current: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const name = window.prompt("Rename canvas", current);
    if (!name) return;
    await api.renameProject(id, name);
    refresh();
  };

  const remove = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete canvas "${name}"? This removes its history too.`)) return;
    await api.deleteProject(id);
    refresh();
  };

  return (
    <div className="loom-projsw" ref={ref}>
      <button className="loom-projsw-btn" onClick={() => setOpen((o) => !o)}>
        <span className="loom-graph-name">{activeName}</span>
        <span className="loom-projsw-caret">▾</span>
      </button>
      {open && (
        <div className="loom-projsw-menu">
          <div className="loom-projsw-head">CANVASES</div>
          <div className="loom-projsw-list">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`loom-projsw-row ${p.active ? "active" : ""}`}
                onClick={() => switchTo(p.id)}
              >
                <span className="loom-projsw-dot" />
                <span className="loom-projsw-name" title={p.name}>
                  {p.name}
                </span>
                <span className="loom-projsw-count">{p.node_count}n</span>
                <button
                  className="loom-icon-btn"
                  title="Rename"
                  onClick={(e) => rename(p.id, p.name, e)}
                >
                  ✎
                </button>
                <button
                  className="loom-icon-btn danger"
                  title="Delete"
                  onClick={(e) => remove(p.id, p.name, e)}
                >
                  ✕
                </button>
              </div>
            ))}
            {projects.length === 0 && (
              <div className="loom-projsw-empty">No canvases yet</div>
            )}
          </div>
          <button className="loom-projsw-new" onClick={newProject}>
            + New canvas
          </button>
        </div>
      )}
    </div>
  );
}
