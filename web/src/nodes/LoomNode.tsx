import { Handle, Position } from "@xyflow/react";
import { memo } from "react";
import type { GraphNode } from "../api";
import { bestVersion, ContentRenderer } from "../ContentRenderer";
import { ISSUE_STATUS, roleMeta } from "../roles";
import { useStore } from "../store";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  idle: { label: "idle", cls: "idle" },
  pending: { label: "pending", cls: "pending" },
  running: { label: "running", cls: "running" },
  complete: { label: "done", cls: "complete" },
  error: { label: "error", cls: "error" },
};

function LoomNodeInner({ data }: { data: { node: GraphNode } }) {
  const node = data.node;
  const selectNode = useStore((s) => s.selectNode);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const isEntry = useStore((s) => s.graph?.entry_point === node.id);
  const isEnd = useStore((s) => s.graph?.end_point === node.id);

  const meta = roleMeta(node.role);
  const status = STATUS_META[node.status] ?? STATUS_META.idle;
  const version = bestVersion(node.versions);
  const isSelected = selectedNodeId === node.id;
  const f = node.fields ?? {};

  return (
    <div
      className={`loom-node role-${node.role} ${isSelected ? "selected" : ""} status-${node.status}`}
      style={{ ["--tint" as string]: meta.tint }}
      onClick={() => selectNode(node.id)}
    >
      <Handle type="target" position={Position.Left} className="loom-handle" />

      <div className="loom-node-head">
        <span className="loom-node-icon">{meta.icon}</span>
        <span className="loom-role-tag">{meta.label}</span>
        {isEntry && <span className="loom-entry-badge">root</span>}
        {isEnd && <span className="loom-entry-badge end">end</span>}
        {(() => {
          const pending = (node.thread ?? []).filter(
            (m) => m.role === "user" && !m.processed,
          ).length;
          return pending > 0 ? (
            <span className="loom-msg-badge" title={`${pending} pending message(s)`}>
              💬 {pending}
            </span>
          ) : null;
        })()}
        <span className={`loom-status ${status.cls}`}>
          {node.status === "running" && <span className="loom-spinner" />}
          {status.label}
        </span>
      </div>

      <div className="loom-node-title" title={node.label}>
        {node.label || node.id}
      </div>

      {/* role-specific body */}
      {node.role === "core_question" && (
        <div className="loom-cq">
          {f.basic_question && <div className="loom-cq-q">{f.basic_question}</div>}
          {f.scope && <div className="loom-cq-meta">Scope · {f.scope}</div>}
        </div>
      )}

      {node.role === "issue" && (
        <div className="loom-issue">
          {f.issue && <div className="loom-issue-text">{f.issue}</div>}
          {f.hypothesis && (
            <div className="loom-hypo">
              <span className="loom-hypo-tag">H</span>
              {f.hypothesis}
            </div>
          )}
          {f.status && (
            <span className={`loom-issue-status ${ISSUE_STATUS[f.status]?.cls ?? "untested"}`}>
              {ISSUE_STATUS[f.status]?.label ?? f.status}
            </span>
          )}
        </div>
      )}

      {(node.role === "research" || node.role === "note") &&
        (node.instruction || f.question) &&
        !version &&
        !node.research && (
          <div className="loom-node-instruction">{f.question || node.instruction}</div>
        )}

      {node.role === "research" && node.research && (
        <div className="loom-research-card">
          <div className="loom-run-dots">
            {node.research.runs.map((r) => (
              <span key={r.id} className={`loom-run-dot status-${r.status}`} title={r.label} />
            ))}
            <span className="loom-run-count">{node.research.runs.length} runs</span>
          </div>
          <div className="loom-research-counts">
            <span className="cor">
              ✦ {node.research.findings.filter((x) => x.novelty === "corroborated").length}
            </span>
            <span className="mar">
              △ {node.research.findings.filter((x) => x.novelty === "marginal").length}
            </span>
            {(() => {
              const acc = node.research.findings.filter((x) => x.status === "accepted").length;
              return acc > 0 ? <span className="acc">✓ {acc}</span> : null;
            })()}
          </div>
        </div>
      )}

      {node.tools.length > 0 && (
        <div className="loom-tools">
          {node.tools.slice(0, 4).map((t) => (
            <span key={t} className="loom-tool-chip">
              {t}
            </span>
          ))}
        </div>
      )}

      {version && (
        <div className="loom-node-preview">
          <ContentRenderer
            content={version.content}
            contentType={version.content_type}
            compact
          />
        </div>
      )}

      {node.versions.length > 1 && (
        <div className="loom-version-strip">
          {node.versions.map((v) => (
            <span key={v.version} className={`loom-version-pill ${v.selected ? "on" : ""}`}>
              {v.version}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="loom-handle" />
    </div>
  );
}

export const LoomNode = memo(LoomNodeInner);
