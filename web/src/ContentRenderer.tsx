import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ContentType, ResultVersion } from "./api";

const PALETTE = ["#7c6cff", "#36c5f0", "#2eb67d", "#ecb22e", "#e01e5a", "#9b59b6"];

function ChartView({ raw }: { raw: string }) {
  const spec = useMemo(() => {
    try {
      return JSON.parse(raw) as any;
    } catch {
      return null;
    }
  }, [raw]);
  if (!spec || !Array.isArray(spec.data))
    return <pre className="loom-pre">Invalid chart spec</pre>;

  const xKey = spec.xKey ?? "x";
  const series: { key: string; name?: string }[] = spec.series ?? [
    { key: "value", name: "value" },
  ];
  const type = spec.type ?? "bar";

  if (type === "pie") {
    const nameKey = spec.nameKey ?? xKey;
    const valueKey = series[0]?.key ?? "value";
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={spec.data}
            dataKey={valueKey}
            nameKey={nameKey}
            outerRadius={90}
            label
          >
            {spec.data.map((_: unknown, i: number) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const Chart = type === "line" ? LineChart : type === "area" ? AreaChart : BarChart;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <Chart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "var(--text-dim)" }} />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-dim)" }} />
        <Tooltip
          contentStyle={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) =>
          type === "line" ? (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name ?? s.key}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
            />
          ) : type === "area" ? (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.name ?? s.key}
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.2}
            />
          ) : (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name ?? s.key}
              fill={PALETTE[i % PALETTE.length]}
              radius={[4, 4, 0, 0]}
            />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

function TableView({ raw }: { raw: string }) {
  const spec = useMemo(() => {
    try {
      return JSON.parse(raw) as { columns: string[]; rows: unknown[][] };
    } catch {
      return null;
    }
  }, [raw]);
  if (!spec || !Array.isArray(spec.rows))
    return <pre className="loom-pre">Invalid table spec</pre>;
  return (
    <div className="loom-table-wrap">
      <table className="loom-table">
        <thead>
          <tr>
            {(spec.columns ?? []).map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContentRenderer({
  content,
  contentType,
  compact = false,
}: {
  content: string;
  contentType: ContentType;
  compact?: boolean;
}) {
  if (!content) return <div className="loom-empty">No output yet</div>;

  switch (contentType) {
    case "html":
    case "slides":
      return (
        <iframe
          title="html"
          className={compact ? "loom-iframe compact" : "loom-iframe"}
          sandbox="allow-scripts allow-same-origin allow-popups"
          srcDoc={content}
        />
      );
    case "chart":
      return <ChartView raw={content} />;
    case "table":
      return <TableView raw={content} />;
    case "image":
      return <img className="loom-img" src={content} alt="result" />;
    case "json":
      return (
        <pre className="loom-pre">
          {(() => {
            try {
              return JSON.stringify(JSON.parse(content), null, 2);
            } catch {
              return content;
            }
          })()}
        </pre>
      );
    case "text":
    case "error":
      return <pre className={contentType === "error" ? "loom-pre error" : "loom-pre"}>{content}</pre>;
    default:
      return (
        <div className="loom-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      );
  }
}

export function bestVersion(versions: ResultVersion[]): ResultVersion | undefined {
  return versions.find((v) => v.selected) ?? versions[versions.length - 1];
}
