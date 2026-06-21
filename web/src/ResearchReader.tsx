import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Finding, type GraphNode } from "./api";

function ConfBar({ v }: { v: number }) {
  const pct = Math.round((v ?? 0) * 100);
  const cls = pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";
  return (
    <div className="loom-conf" title={`confidence ${pct}%`}>
      <div className={`loom-conf-fill ${cls}`} style={{ width: `${pct}%` }} />
      <span className="loom-conf-num">{pct}%</span>
    </div>
  );
}

export function ResearchReader({ node }: { node: GraphNode }) {
  const r = node.research;
  const [filter, setFilter] = useState<"all" | "corroborated" | "marginal" | "accepted">("all");

  const findings = useMemo(() => {
    const fs = r?.findings ?? [];
    if (filter === "all") return fs;
    if (filter === "accepted") return fs.filter((f) => f.status === "accepted");
    return fs.filter((f) => f.novelty === filter);
  }, [r, filter]);

  if (!r) return <div className="loom-empty">No research yet — run this card.</div>;

  const corroborated = r.findings.filter((f) => f.novelty === "corroborated").length;
  const marginal = r.findings.filter((f) => f.novelty === "marginal").length;
  const accepted = r.findings.filter((f) => f.status === "accepted").length;

  const cycle = async (f: Finding) => {
    const next = f.status === "accepted" ? "rejected" : f.status === "rejected" ? "candidate" : "accepted";
    await api.setFindingStatus(node.id, f.id, next);
  };

  return (
    <div className="loom-reader">
      <div className="loom-reader-q">{r.question || node.label}</div>

      {/* runs */}
      <div className="loom-runs">
        {r.runs.map((run) => (
          <div key={run.id} className={`loom-run status-${run.status}`}>
            <div className="loom-run-head">
              <span className="loom-run-label">{run.label || run.id}</span>
              <span className={`loom-status ${run.status}`}>
                {run.status === "running" && <span className="loom-spinner" />}
                {run.status}
              </span>
            </div>
            {run.summary && (
              <div className="loom-md loom-run-summary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.summary}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* findings */}
      <div className="loom-findings-head">
        <span className="loom-sources-title">
          Findings — {corroborated} corroborated · {marginal} marginal · {accepted} accepted
        </span>
        <div className="loom-filter">
          {(["all", "corroborated", "marginal", "accepted"] as const).map((k) => (
            <button
              key={k}
              className={`loom-filter-btn ${filter === k ? "on" : ""}`}
              onClick={() => setFilter(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="loom-findings">
        {findings.map((f) => (
          <div key={f.id} className={`loom-finding ${f.status} novelty-${f.novelty}`}>
            <button className="loom-finding-acc" onClick={() => cycle(f)} title="accept / reject / reset">
              {f.status === "accepted" ? "✓" : f.status === "rejected" ? "✕" : "○"}
            </button>
            <div className="loom-finding-body">
              <div className="loom-finding-text">
                <span className={`loom-kind ${f.kind}`}>{f.kind}</span>
                {f.text}
              </div>
              <div className="loom-finding-meta">
                <span className={`loom-novelty ${f.novelty}`}>
                  {f.novelty === "corroborated" ? `✦ ${f.runs.length} runs` : "△ marginal"}
                </span>
                {f.sources.map((s, i) => (
                  <a
                    key={i}
                    className="loom-finding-src"
                    href={s.type === "url" ? s.ref : undefined}
                    target="_blank"
                    rel="noreferrer"
                    title={s.ref}
                  >
                    {s.label || s.ref}
                    {s.confidence != null && (
                      <span className="loom-src-conf"> {Math.round(s.confidence * 100)}%</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
            <ConfBar v={f.confidence} />
          </div>
        ))}
        {findings.length === 0 && <div className="loom-empty">No findings in this filter.</div>}
      </div>
    </div>
  );
}
