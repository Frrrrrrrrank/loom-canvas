import { useState } from "react";
import { api } from "./api";
import { roleMeta } from "./roles";
import { useStore } from "./store";

// Floating "discuss this card" composer, docked bottom-center over the canvas
// (LibTV-style). Split out from the right detail panel: details live on the right,
// the modify/chat box floats here.
export function CardComposer() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const node = useStore((s) => s.graph?.nodes.find((n) => n.id === selectedNodeId));
  const agent = useStore((s) => s.agent);
  const [text, setText] = useState("");

  if (!node) return null;
  const thread = node.thread ?? [];
  const pending = thread.filter((m) => m.role === "user" && !m.processed).length;
  const auto = !!agent?.enabled;
  const meta = roleMeta(node.role);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await api.sendCardMessage(node.id, t);
  };

  return (
    <div className="loom-composer">
      {thread.length > 0 && (
        <div className="loom-composer-thread">
          {thread.slice(-6).map((m) => (
            <div key={m.id} className={`loom-msg ${m.role}`}>
              <div className="loom-msg-who">{m.role === "user" ? "you" : "Claude Code"}</div>
              <div className="loom-msg-text">{m.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="loom-composer-box">
        <span className="loom-composer-tag" title={node.label}>
          <span style={{ color: meta.tint }}>{meta.icon}</span> {node.label || node.id}
        </span>
        <textarea
          className="loom-composer-input"
          rows={1}
          placeholder="跟这张卡对话：让它换角度多查 / 质疑某个点…  (⌘/Ctrl+Enter 发送)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <button
          className="loom-composer-send"
          onClick={send}
          disabled={!text.trim()}
          title="Send (⌘/Ctrl+Enter)"
        >
          ↑
        </button>
      </div>
      {pending > 0 && (
        <div className="loom-composer-hint">
          {agent?.running
            ? "Claude Code 正在回复…"
            : auto
              ? `已发送 — ${agent?.kind} 会自动回复到这张卡`
              : '已发送 — 在 Claude Code 里说"处理画布留言"'}
        </div>
      )}
    </div>
  );
}
