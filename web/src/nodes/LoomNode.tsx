import { Handle, Position } from "@xyflow/react";
import { memo } from "react";
import type { GraphNode } from "../api";
import { bestVersion, ContentRenderer } from "../ContentRenderer";
import { useStore } from "../store";

const CATEGORY_META: Record<string, { icon: string; tint: string }> = {
  input: { icon: "📥", tint: "#64748b" },
  output: { icon: "📤", tint: "#7c6cff" },
  research: { icon: "🔬", tint: "#36c5f0" },
  analysis: { icon: "📊", tint: "#2eb67d" },
  router: { icon: "🔀", tint: "#ecb22e" },
  orchestrator: { icon: "🎼", tint: "#e01e5a" },
  general: { icon: "🤖", tint: "#9b8cff" },
};

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

  const meta = CATEGORY_META[node.type === "input" || node.type === "output" ? node.type : node.category] ??
    CATEGORY_META.general;
  const status = STATUS_META[node.status] ?? STATUS_META.idle;
  const version = bestVersion(node.versions);
  const isSelected = selectedNodeId === node.id;

  return (
    <div
      className={`loom-node ${isSelected ? "selected" : ""} status-${node.status}`}
      style={{ ["--tint" as string]: meta.tint }}
      onClick={() => selectNode(node.id)}
    >
      <Handle type="target" position={Position.Left} className="loom-handle" />
      <div className="loom-node-head">
        <span className="loom-node-icon">{meta.icon}</span>
        <span className="loom-node-title" title={node.label}>
          {node.label || node.id}
        </span>
        {isEntry && <span className="loom-entry-badge">entry</span>}
        <span className={`loom-status ${status.cls}`}>
          {node.status === "running" && <span className="loom-spinner" />}
          {status.label}
        </span>
      </div>

      {node.instruction && !version && (
        <div className="loom-node-instruction">{node.instruction}</div>
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
            <span
              key={v.version}
              className={`loom-version-pill ${v.selected ? "on" : ""}`}
            >
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
