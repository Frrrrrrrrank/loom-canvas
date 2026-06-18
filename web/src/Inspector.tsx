import { useEffect, useState } from "react";
import { api, type GraphNode } from "./api";
import { ContentRenderer } from "./ContentRenderer";
import { useStore } from "./store";

export function Inspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const node = useStore((s) =>
    s.graph?.nodes.find((n) => n.id === selectedNodeId),
  );
  const selectNode = useStore((s) => s.selectNode);
  const setFullscreen = useStore((s) => s.setFullscreen);

  if (!node) return null;
  return (
    <aside className="loom-inspector">
      <InspectorBody
        key={node.id}
        node={node}
        onClose={() => selectNode(null)}
        onFullscreen={() => setFullscreen(node.id)}
      />
    </aside>
  );
}

function InspectorBody({
  node,
  onClose,
  onFullscreen,
}: {
  node: GraphNode;
  onClose: () => void;
  onFullscreen: () => void;
}) {
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [instruction, setInstruction] = useState(node.instruction);
  const [category, setCategory] = useState(node.category);

  useEffect(() => {
    setLabel(node.label);
    setInstruction(node.instruction);
    setCategory(node.category);
  }, [node.id]);

  const selected =
    node.versions.find((v) => v.version === activeVersion) ??
    node.versions.find((v) => v.selected) ??
    node.versions[node.versions.length - 1];

  const save = async () => {
    await api.patchNode(node.id, { label, instruction, category });
    setEditing(false);
  };

  return (
    <div className="loom-inspector-inner">
      <header className="loom-insp-head">
        <div className="loom-insp-title">
          <span className="loom-insp-id">{node.type}</span>
          {editing ? (
            <input
              className="loom-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          ) : (
            <h3>{node.label || node.id}</h3>
          )}
        </div>
        <div className="loom-insp-actions">
          {node.versions.length > 0 && (
            <button className="loom-btn ghost" onClick={onFullscreen} title="Fullscreen">
              ⛶
            </button>
          )}
          <button className="loom-btn ghost" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </header>

      <div className="loom-insp-meta">
        <span className={`loom-status ${node.status}`}>{node.status}</span>
        <button
          className="loom-btn tiny"
          onClick={() => api.setEntry(node.id)}
          title="Make this the entry point"
        >
          set entry
        </button>
        <button
          className="loom-btn tiny"
          onClick={() => (editing ? save() : setEditing(true))}
        >
          {editing ? "save" : "edit"}
        </button>
      </div>

      {editing && (
        <div className="loom-insp-edit">
          <label>category</label>
          <select
            className="loom-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["general", "research", "analysis", "router", "orchestrator", "output"].map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ),
            )}
          </select>
          <label>instruction / brief</label>
          <textarea
            className="loom-input"
            rows={5}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </div>
      )}

      {!editing && node.instruction && (
        <div className="loom-insp-brief">{node.instruction}</div>
      )}

      {node.tools.length > 0 && (
        <div className="loom-tools spaced">
          {node.tools.map((t) => (
            <span key={t} className="loom-tool-chip">
              {t}
            </span>
          ))}
        </div>
      )}

      {node.versions.length > 1 && (
        <div className="loom-version-tabs">
          {node.versions.map((v) => (
            <button
              key={v.version}
              className={`loom-version-tab ${
                (selected?.version === v.version) ? "on" : ""
              }`}
              onClick={() => setActiveVersion(v.version)}
            >
              {v.version}
              {v.selected && <span className="loom-pick-dot" title="selected" />}
            </button>
          ))}
          {selected && !selected.selected && (
            <button
              className="loom-btn tiny accent"
              onClick={() => api.selectVersion(node.id, selected.version)}
            >
              pick this
            </button>
          )}
        </div>
      )}

      <div className="loom-insp-content">
        {selected ? (
          <ContentRenderer
            content={selected.content}
            contentType={selected.content_type}
          />
        ) : (
          <div className="loom-empty">No result yet — run this node from Claude Code.</div>
        )}
      </div>

      {selected && selected.sources.length > 0 && (
        <div className="loom-sources">
          <div className="loom-sources-title">Evidence · 追溯</div>
          {selected.sources.map((s, i) => (
            <div key={i} className="loom-source-row">
              <span className={`loom-source-type ${s.type}`}>{s.type}</span>
              <span className="loom-source-ref" title={s.ref}>
                {s.label || s.ref}
              </span>
              {s.confidence != null && (
                <span className="loom-confidence">
                  {Math.round(s.confidence * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {selected && selected.artifacts.length > 0 && (
        <div className="loom-artifacts">
          <div className="loom-sources-title">Artifacts</div>
          {selected.artifacts.map((a, i) => (
            <a
              key={i}
              className="loom-artifact"
              href={a.path}
              target="_blank"
              rel="noreferrer"
            >
              📎 {a.filename}
              <span className="loom-artifact-type">{a.type}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function FullscreenModal() {
  const fullscreenNodeId = useStore((s) => s.fullscreenNodeId);
  const node = useStore((s) =>
    s.graph?.nodes.find((n) => n.id === fullscreenNodeId),
  );
  const setFullscreen = useStore((s) => s.setFullscreen);
  if (!node) return null;
  const v = node.versions.find((x) => x.selected) ?? node.versions[node.versions.length - 1];
  return (
    <div className="loom-modal-backdrop" onClick={() => setFullscreen(null)}>
      <div className="loom-modal" onClick={(e) => e.stopPropagation()}>
        <header className="loom-modal-head">
          <h3>{node.label || node.id}</h3>
          <button className="loom-btn ghost" onClick={() => setFullscreen(null)}>
            ✕
          </button>
        </header>
        <div className="loom-modal-body">
          {v ? (
            <ContentRenderer content={v.content} contentType={v.content_type} />
          ) : (
            <div className="loom-empty">No result.</div>
          )}
        </div>
      </div>
    </div>
  );
}
