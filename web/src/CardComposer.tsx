import { useState } from "react";
import { api } from "./api";
import { roleMeta } from "./roles";
import { useStore } from "./store";

// Floating "discuss this card" composer, docked bottom-center over the canvas
// (LibTV-style). The thread is collapsible — click the header to fold it down to
// just the input bar when it gets tall.
export function CardComposer() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const node = useStore((s) => s.graph?.nodes.find((n) => n.id === selectedNodeId));
  const agent = useStore((s) => s.agent);
  const [text, setText] = useState("");
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem("loom-composer-collapsed") === "1",
  );

  if (!node) return null;
  const thread = node.thread ?? [];
  const pending = thread.filter((m) => m.role === "user" && !m.processed).length;
  const auto = !!agent?.enabled;
  const meta = roleMeta(node.role);
  const hasThread = thread.length > 0;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("loom-composer-collapsed", next ? "1" : "0");
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await api.sendCardMessage(node.id, t);
  };

  return (
    <div className="loom-composer">
      <div className="loom-composer-header">
        <button
          className="loom-composer-titlebtn"
          onClick={toggle}
          title={collapsed ? "展开对话" : "收起对话"}
          disabled={!hasThread}
        >
          <span className="loom-composer-caret">{hasThread ? (collapsed ? "▸" : "▾") : "💬"}</span>
          <span className="loom-composer-title">对话修改这张卡片</span>
          {hasThread && collapsed && (
            <span className="loom-composer-count">{thread.length}</span>
          )}
        </button>
        <span className="loom-composer-target" title={node.label}>
          <span style={{ color: meta.tint }}>{meta.icon}</span> {node.label || node.id}
        </span>
      </div>

      {hasThread && !collapsed && (
        <div className="loom-composer-thread">
          {thread.slice(-8).map((m) => (
            <div key={m.id} className={`loom-msg ${m.role}`}>
              <div className="loom-msg-who">{m.role === "user" ? "you" : "Claude Code"}</div>
              <div className="loom-msg-text">{m.text}</div>
            </div>
          ))}
        </div>
      )}

      <div className="loom-composer-box">
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
