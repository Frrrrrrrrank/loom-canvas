import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { LoomNode } from "./nodes/LoomNode";
import { RELATION_LABEL, relationForRoles } from "./roles";
import { useStore } from "./store";

const nodeTypes = { loom: LoomNode };

// the selected card's full through-line: itself + all ancestors + all descendants
function lineageOf(
  g: { edges: { source: string; target: string }[] },
  id: string,
): Set<string> {
  const set = new Set<string>([id]);
  const walk = (dir: "up" | "down") => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const e of g.edges) {
        const next = dir === "up" ? (e.target === cur ? e.source : null) : e.source === cur ? e.target : null;
        if (next && !set.has(next)) {
          set.add(next);
          stack.push(next);
        }
      }
    }
  };
  walk("up");
  walk("down");
  return set;
}

export function Canvas() {
  const graph = useStore((s) => s.graph);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const beginDrag = useStore((s) => s.beginDrag);
  const endDrag = useStore((s) => s.endDrag);
  const theme = useStore((s) => s.theme);
  const dark = theme === "dark";

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const positions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Reconcile store graph -> React Flow nodes/edges. The server position is the
  // source of truth (so programmatic moves from Claude Code / the API show up live);
  // we only keep the local position for a node the user is actively dragging.
  useEffect(() => {
    if (!graph) return;
    const draggingSet = useStore.getState().dragging;
    // focus mode: when a card is selected, light up only its up/down through-line
    const lineage =
      selectedNodeId && graph.nodes.some((n) => n.id === selectedNodeId)
        ? lineageOf(graph, selectedNodeId)
        : null;
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      return graph.nodes.map((gn) => {
        const pos = draggingSet.has(gn.id)
          ? (prevPos.get(gn.id) ?? gn.position)
          : gn.position;
        positions.current.set(gn.id, pos);
        return {
          id: gn.id,
          type: "loom",
          position: pos,
          className: lineage && !lineage.has(gn.id) ? "loom-dim" : undefined,
          data: { node: gn },
        } as Node;
      });
    });
    const roleById = new Map(graph.nodes.map((n) => [n.id, n.role]));
    const STANCE_COLOR: Record<string, string> = {
      confirms: "#2eb67d",
      challenges: "#e01e5a",
      mixed: "#ecb22e",
      inconclusive: "#8a8aa3",
    };
    setEdges(
      graph.edges.map((ge) => {
        // backfill the relation from the two roles if the edge predates the feature
        const rel =
          ge.relation || relationForRoles(roleById.get(ge.source), roleById.get(ge.target));
        // an assessed evidence edge (issue->research) is coloured + labelled by verdict
        const stanceColor = ge.stance ? STANCE_COLOR[ge.stance] : null;
        const color = stanceColor ?? "#8a8aa3";
        const label = ge.stance ?? ge.label ?? RELATION_LABEL[rel] ?? undefined;
        // focus mode: an edge is "on the through-line" iff both ends are in the lineage
        const onPath = lineage ? lineage.has(ge.source) && lineage.has(ge.target) : true;
        const dimmed = lineage && !onPath;
        const baseW = ge.stance ? 2 : 1.5;
        return {
          id: ge.id,
          source: ge.source,
          target: ge.target,
          label: dimmed ? undefined : label,
          labelStyle: {
            fill: stanceColor ?? "var(--text-dim)",
            fontSize: 11,
            fontWeight: 600,
          },
          labelShowBg: true,
          labelBgStyle: { fill: "var(--bg)", fillOpacity: 0.9 },
          labelBgPadding: [5, 3] as [number, number],
          labelBgBorderRadius: 5,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: color,
            strokeWidth: lineage && onPath ? baseW + 0.8 : baseW,
            opacity: dimmed ? 0.1 : 1,
          },
          animated: false,
        };
      }),
    );
  }, [graph, selectedNodeId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target && c.source !== c.target) {
      api.addEdge(c.source, c.target).catch(() => {});
    }
  }, []);

  const onNodeDragStart = useCallback(
    (_: unknown, node: Node) => beginDrag(node.id),
    [beginDrag],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      positions.current.set(node.id, node.position);
      api.moveNode(node.id, node.position.x, node.position.y).catch(() => {});
      endDrag(node.id);
    },
    [endDrag],
  );

  const onNodesDelete = useCallback((deleted: Node[]) => {
    deleted.forEach((n) => api.deleteNode(n.id).catch(() => {}));
  }, []);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    deleted.forEach((e) => api.deleteEdge(e.source, e.target).catch(() => {}));
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onNodesDelete={onNodesDelete}
      onEdgesDelete={onEdgesDelete}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.75}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "default" }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1}
        color={dark ? "#2a2a3a" : "#d4d4e0"}
      />
      <MiniMap
        pannable
        zoomable
        nodeColor={() => (dark ? "#3a3a52" : "#c4c4d4")}
        maskColor={dark ? "rgba(10,10,18,0.6)" : "rgba(230,230,240,0.6)"}
        style={{
          background: dark ? "#14141f" : "#ffffff",
          border: `1px solid ${dark ? "#2a2a3a" : "#e2e2ec"}`,
        }}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
