import { useEffect, useState } from "react";
import { api, type GraphNode } from "./api";
import { ContentRenderer } from "./ContentRenderer";
import { ResearchReader } from "./ResearchReader";
import { ISSUE_STATUS, ROLE_FIELDS, ROLE_ORDER, roleMeta } from "./roles";
import { useStore } from "./store";

export function Inspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const node = useStore((s) => s.graph?.nodes.find((n) => n.id === selectedNodeId));
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
  const [role, setRole] = useState(node.role);
  const [instruction, setInstruction] = useState(node.instruction);
  const [fields, setFields] = useState<Record<string, any>>(node.fields ?? {});

  useEffect(() => {
    setLabel(node.label);
    setRole(node.role);
    setInstruction(node.instruction);
    setFields(node.fields ?? {});
    setEditing(false);
  }, [node.id]);

  const meta = roleMeta(role);
  const roleFields = ROLE_FIELDS[role] ?? [];
  const selected =
    node.versions.find((v) => v.version === activeVersion) ??
    node.versions.find((v) => v.selected) ??
    node.versions[node.versions.length - 1];

  const save = async () => {
    await api.patchNode(node.id, { label, role, instruction, fields });
    setEditing(false);
  };
  const setF = (k: string, v: string) => setFields((p) => ({ ...p, [k]: v }));

  return (
    <div className="loom-inspector-inner">
      <header className="loom-insp-head">
        <div className="loom-insp-title">
          <span className="loom-insp-role" style={{ color: meta.tint }}>
            {meta.icon} {meta.label}
          </span>
          {editing ? (
            <input className="loom-input" value={label} onChange={(e) => setLabel(e.target.value)} />
          ) : (
            <h3>{node.label || node.id}</h3>
          )}
        </div>
        <div className="loom-insp-actions">
          {(node.versions.length > 0 || (node.role === "research" && node.research)) && (
            <button className="loom-btn ghost" onClick={onFullscreen} title="Fullscreen">⛶</button>
          )}
          <button className="loom-btn ghost" onClick={onClose} title="Close">✕</button>
        </div>
      </header>

      <div className="loom-insp-meta">
        <span className={`loom-status ${node.status}`}>{node.status}</span>
        <button className="loom-btn tiny" onClick={() => api.setEntry(node.id)} title="Make root">
          set root
        </button>
        <button className="loom-btn tiny" onClick={() => (editing ? save() : setEditing(true))}>
          {editing ? "save" : "edit"}
        </button>
      </div>

      {editing ? (
        <div className="loom-insp-edit">
          <label>role</label>
          <select className="loom-input" value={role} onChange={(e) => setRole(e.target.value as any)}>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {roleMeta(r).label}
              </option>
            ))}
          </select>
          {roleFields.map((rf) => (
            <div key={rf.key}>
              <label>{rf.label}</label>
              <textarea
                className="loom-input"
                rows={rf.long ? 3 : 1}
                value={fields[rf.key] ?? ""}
                onChange={(e) => setF(rf.key, e.target.value)}
              />
            </div>
          ))}
          {role === "issue" && (
            <div>
              <label>hypothesis status</label>
              <select
                className="loom-input"
                value={fields.status ?? "untested"}
                onChange={(e) => setF("status", e.target.value)}
              >
                {Object.keys(ISSUE_STATUS).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          {(role === "research" || role === "note" || role === "synthesis" || role === "output") && (
            <div>
              <label>brief / task</label>
              <textarea
                className="loom-input"
                rows={4}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>
          )}
        </div>
      ) : (
        <RoleBrief node={node} />
      )}

      {node.tools.length > 0 && (
        <div className="loom-tools spaced">
          {node.tools.map((t) => (
            <span key={t} className="loom-tool-chip">{t}</span>
          ))}
        </div>
      )}

      {node.role === "research" && node.research && (
        <ResearchSummary node={node} onOpen={onFullscreen} />
      )}

      {node.versions.length > 1 && (
        <div className="loom-version-tabs">
          {node.versions.map((v) => (
            <button
              key={v.version}
              className={`loom-version-tab ${selected?.version === v.version ? "on" : ""}`}
              onClick={() => setActiveVersion(v.version)}
            >
              {v.version}
              {v.selected && <span className="loom-pick-dot" title="selected" />}
            </button>
          ))}
          {selected && !selected.selected && (
            <button className="loom-btn tiny accent" onClick={() => api.selectVersion(node.id, selected.version)}>
              pick this
            </button>
          )}
        </div>
      )}

      <div className="loom-insp-content">
        {selected ? (
          <ContentRenderer content={selected.content} contentType={selected.content_type} />
        ) : (
          <div className="loom-empty">No result yet — run this card from Claude Code.</div>
        )}
      </div>

      {selected && selected.sources.length > 0 && (
        <div className="loom-sources">
          <div className="loom-sources-title">Evidence · 追溯</div>
          {selected.sources.map((s, i) => (
            <div key={i} className="loom-source-row">
              <span className={`loom-source-type ${s.type}`}>{s.type}</span>
              <span className="loom-source-ref" title={s.ref}>{s.label || s.ref}</span>
              {s.confidence != null && (
                <span className="loom-confidence">{Math.round(s.confidence * 100)}%</span>
              )}
            </div>
          ))}
        </div>
      )}

      {selected && selected.artifacts.length > 0 && (
        <div className="loom-artifacts">
          <div className="loom-sources-title">Artifacts</div>
          {selected.artifacts.map((a, i) => (
            <a key={i} className="loom-artifact" href={a.path} target="_blank" rel="noreferrer">
              📎 {a.filename}
              <span className="loom-artifact-type">{a.type}</span>
            </a>
          ))}
        </div>
      )}

      <CardChat node={node} />
    </div>
  );
}

function CardChat({ node }: { node: GraphNode }) {
  const [text, setText] = useState("");
  const agent = useStore((s) => s.agent);
  const thread = node.thread ?? [];
  const pending = thread.filter((m) => m.role === "user" && !m.processed).length;
  const auto = !!agent?.enabled;

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await api.sendCardMessage(node.id, t);
  };

  return (
    <div className="loom-chat">
      <div className="loom-chat-title">
        Discuss this card
        {pending > 0 && <span className="loom-chat-pending">{pending} pending</span>}
      </div>
      {thread.length > 0 && (
        <div className="loom-chat-thread">
          {thread.map((m) => (
            <div key={m.id} className={`loom-msg ${m.role}`}>
              <div className="loom-msg-who">{m.role === "user" ? "you" : "Claude Code"}</div>
              <div className="loom-msg-text">{m.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="loom-chat-input">
        <textarea
          className="loom-input"
          rows={2}
          placeholder="e.g. 再去多查一下 momo 的抽成；或:这个点和我认知不符,聊聊"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <button className="loom-btn accent" onClick={send} disabled={!text.trim()}>
          Send
        </button>
      </div>
      {pending > 0 && (
        <div className="loom-chat-hint">
          {agent?.running
            ? "Claude Code is responding…"
            : auto
              ? `Sent — ${agent?.kind} will auto-respond here shortly.`
              : 'Sent. In Claude Code say "处理画布留言" and it\'ll act on this card & reply here.'}
        </div>
      )}
    </div>
  );
}

function ResearchSummary({ node, onOpen }: { node: GraphNode; onOpen: () => void }) {
  const r = node.research!;
  const corroborated = r.findings.filter((f) => f.novelty === "corroborated").length;
  const marginal = r.findings.filter((f) => f.novelty === "marginal").length;
  const accepted = r.findings.filter((f) => f.status === "accepted").length;
  return (
    <div className="loom-research-sum">
      <div className="loom-research-stats">
        <span>{r.runs.length} runs</span>
        <span>·</span>
        <span>{corroborated} corroborated</span>
        <span>·</span>
        <span>{marginal} marginal</span>
        <span>·</span>
        <span className="loom-accepted">{accepted} accepted</span>
      </div>
      <button className="loom-btn accent" onClick={onOpen}>
        Open reading mode →
      </button>
    </div>
  );
}

function RoleBrief({ node }: { node: GraphNode }) {
  const f = node.fields ?? {};
  const roleFields = ROLE_FIELDS[node.role] ?? [];
  const hasFields = roleFields.some((rf) => f[rf.key]);
  return (
    <>
      {hasFields && (
        <div className="loom-insp-brief">
          {roleFields.map((rf) =>
            f[rf.key] ? (
              <div key={rf.key} className="loom-brief-row">
                <span className="loom-brief-key">{rf.label}</span>
                <span className="loom-brief-val">{f[rf.key]}</span>
              </div>
            ) : null,
          )}
          {node.role === "issue" && f.status && (
            <span className={`loom-issue-status ${ISSUE_STATUS[f.status]?.cls ?? "untested"}`}>
              {ISSUE_STATUS[f.status]?.label ?? f.status}
            </span>
          )}
        </div>
      )}
      {node.instruction && !hasFields && (
        <div className="loom-insp-brief">{node.instruction}</div>
      )}
    </>
  );
}

export function FullscreenModal() {
  const fullscreenNodeId = useStore((s) => s.fullscreenNodeId);
  const node = useStore((s) => s.graph?.nodes.find((n) => n.id === fullscreenNodeId));
  const setFullscreen = useStore((s) => s.setFullscreen);
  if (!node) return null;
  const isResearch = node.role === "research" && node.research;
  const v = node.versions.find((x) => x.selected) ?? node.versions[node.versions.length - 1];
  return (
    <div className="loom-modal-backdrop" onClick={() => setFullscreen(null)}>
      <div className="loom-modal" onClick={(e) => e.stopPropagation()}>
        <header className="loom-modal-head">
          <h3>
            {roleMeta(node.role).icon} {node.label || node.id}
          </h3>
          <button className="loom-btn ghost" onClick={() => setFullscreen(null)}>✕</button>
        </header>
        <div className="loom-modal-body">
          {isResearch ? (
            <ResearchReader node={node} />
          ) : v ? (
            <ContentRenderer content={v.content} contentType={v.content_type} />
          ) : (
            <div className="loom-empty">No result.</div>
          )}
        </div>
      </div>
    </div>
  );
}
