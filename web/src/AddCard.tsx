import { useEffect, useRef, useState } from "react";
import { api, type NodeRole } from "./api";
import { ROLE_ORDER, roleMeta } from "./roles";
import { useStore } from "./store";

export function AddCard() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const add = async (role: NodeRole) => {
    const id = `${role}_${Math.random().toString(36).slice(2, 7)}`;
    await api.addNode({ id, role, label: roleMeta(role).label });
    useStore.getState().selectNode(id);
    setOpen(false);
  };

  return (
    <div className="loom-addcard" ref={ref}>
      <button className="loom-btn" onClick={() => setOpen((o) => !o)}>
        + Card
      </button>
      {open && (
        <div className="loom-addcard-menu">
          {ROLE_ORDER.map((r) => {
            const m = roleMeta(r);
            return (
              <button key={r} className="loom-addcard-row" onClick={() => add(r)}>
                <span className="loom-addcard-icon" style={{ color: m.tint }}>{m.icon}</span>
                <span className="loom-addcard-text">
                  <span className="loom-addcard-name">{m.label}</span>
                  <span className="loom-addcard-blurb">{m.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
