import { useMemo } from "react";
import { api, type Checkpoint } from "./api";
import { useStore } from "./store";

function relTime(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function HistoryPanel() {
  const open = useStore((s) => s.historyOpen);
  const setOpen = useStore((s) => s.setHistoryOpen);
  const checkpoints = useStore((s) => s.checkpoints);
  const headId = useStore((s) => s.headId);
  const dirty = useStore((s) => s.dirty);

  // a checkpoint whose parent has >1 child is a branch point
  const branchIds = useMemo(() => {
    const childCount = new Map<string, number>();
    for (const c of checkpoints)
      if (c.parent_id) childCount.set(c.parent_id, (childCount.get(c.parent_id) ?? 0) + 1);
    const set = new Set<string>();
    for (const c of checkpoints)
      if (c.parent_id && (childCount.get(c.parent_id) ?? 0) > 1) set.add(c.id);
    return set;
  }, [checkpoints]);

  if (!open) return null;

  const ordered = [...checkpoints].reverse(); // newest first

  const save = async () => {
    const msg = window.prompt("Save current canvas as version — label:", "manual save");
    if (msg === null) return;
    await api.createCheckpoint(msg || "manual save");
  };

  const restore = async (c: Checkpoint) => {
    if (!window.confirm(`Roll back to "${c.message}"? Current unsaved work is auto-saved first.`))
      return;
    await api.restoreCheckpoint(c.id);
  };

  return (
    <div className="loom-modal-backdrop" onClick={() => setOpen(false)}>
      <div className="loom-history" onClick={(e) => e.stopPropagation()}>
        <header className="loom-modal-head">
          <h3>Version history</h3>
          <div className="loom-insp-actions">
            <button className="loom-btn" onClick={save}>
              {dirty ? "● Save version" : "Save version"}
            </button>
            <button className="loom-btn ghost" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
        </header>
        <div className="loom-history-body">
          {dirty && (
            <div className="loom-history-dirty">
              You have unsaved edits since the last version.
            </div>
          )}
          {ordered.length === 0 && <div className="loom-empty">No versions yet.</div>}
          <div className="loom-timeline">
            {ordered.map((c) => {
              const isHead = c.id === headId;
              const isBranch = branchIds.has(c.id);
              return (
                <div key={c.id} className={`loom-cp ${isHead ? "head" : ""}`}>
                  <div className="loom-cp-rail">
                    <span className={`loom-cp-dot ${isBranch ? "branch" : ""}`} />
                  </div>
                  <div className="loom-cp-body">
                    <div className="loom-cp-line1">
                      <span className="loom-cp-msg">{c.message}</span>
                      {isHead && <span className="loom-cp-badge head">current</span>}
                      {c.auto && <span className="loom-cp-badge auto">auto</span>}
                      {isBranch && <span className="loom-cp-badge branch">⑂ branch</span>}
                    </div>
                    <div className="loom-cp-line2">
                      <span>{relTime(c.created_at)}</span>
                      <span>·</span>
                      <span>{c.node_count} nodes</span>
                      <span className="loom-cp-id">#{c.id.slice(0, 6)}</span>
                    </div>
                  </div>
                  {!isHead && (
                    <button className="loom-btn tiny" onClick={() => restore(c)}>
                      restore
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="loom-history-hint">
            Edits auto-save as a version when you pause (marked <b>auto</b>); use
            <b> Save version</b> for named milestones. Restoring an old version and then
            editing creates a new branch — your other versions stay intact.
          </p>
        </div>
      </div>
    </div>
  );
}
