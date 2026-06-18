import { api, type Project } from "./api";
import { useStore } from "./store";

function relTime(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TINTS = ["#7c6cff", "#36c5f0", "#2eb67d", "#ecb22e", "#e01e5a", "#9b8cff"];

export function Home() {
  const projects = useStore((s) => s.projects);
  const setView = useStore((s) => s.setView);
  const refresh = useStore((s) => s.refreshWorkspace);

  const enter = async (p: Project) => {
    if (!p.active) await api.activateProject(p.id);
    setView("canvas");
  };

  const create = async () => {
    const name = window.prompt("New canvas name", "Untitled Research");
    if (name === null) return;
    await api.createProject(name || "Untitled Research");
    await refresh();
    setView("canvas");
  };

  const rename = async (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    const name = window.prompt("Rename canvas", p.name);
    if (!name) return;
    await api.renameProject(p.id, name);
    refresh();
  };

  const remove = async (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete canvas "${p.name}"? This removes its history too.`)) return;
    await api.deleteProject(p.id);
    refresh();
  };

  return (
    <div className="loom-home">
      <div className="loom-home-inner">
        <header className="loom-home-head">
          <div className="loom-home-logo">◇</div>
          <h1>Welcome to Loom</h1>
          <p>
            A research canvas woven by Claude Code / Codex. Pick a canvas to continue,
            or start a new study — design it in chat and watch it build itself here.
          </p>
        </header>

        <div className="loom-home-grid">
          <button className="loom-card loom-card-new" onClick={create}>
            <div className="loom-card-plus">+</div>
            <div className="loom-card-new-label">New canvas</div>
          </button>

          {projects.map((p, i) => (
            <div key={p.id} className="loom-card" onClick={() => enter(p)}>
              <div className="loom-card-actions">
                <button className="loom-icon-btn" title="Rename" onClick={(e) => rename(p, e)}>
                  ✎
                </button>
                <button
                  className="loom-icon-btn danger"
                  title="Delete"
                  onClick={(e) => remove(p, e)}
                >
                  ✕
                </button>
              </div>
              <div
                className="loom-card-preview"
                style={{ ["--tint" as string]: TINTS[i % TINTS.length] }}
              >
                {Array.from({ length: Math.min(p.node_count, 14) }).map((_, k) => (
                  <span key={k} className="loom-card-dot" />
                ))}
                {p.node_count === 0 && <span className="loom-card-empty-dot">empty</span>}
              </div>
              <div className="loom-card-body">
                <div className="loom-card-name" title={p.name}>
                  {p.name}
                </div>
                <div className="loom-card-meta">
                  <span>{p.node_count} nodes</span>
                  <span>·</span>
                  <span>{p.checkpoints} versions</span>
                  <span>·</span>
                  <span>{relTime(p.updated_at)}</span>
                </div>
              </div>
              {p.active && <span className="loom-card-active">active</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
