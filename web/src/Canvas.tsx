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

export function Canvas() {
  const graph = useStore((s) => s.graph);
  const beginDrag = useStore((s) => s.beginDrag);
  const endDrag = useStore((s) => s.endDrag);
  const theme = useStore((s) => s.theme);
  const dark = theme === "dark";

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const positions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Reconcile store graph -> React Flow nodes/edges, preserving live positions.
  useEffect(() => {
    if (!graph) return;
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      return graph.nodes.map((gn) => {
        const pos =
          prevPos.get(gn.id) ??
          positions.current.get(gn.id) ??
          gn.position;
        positions.current.set(gn.id, pos);
        return {
          id: gn.id,
          type: "loom",
          position: pos,
          data: { node: gn },
        } as Node;
      });
    });
    const roleById = new Map(graph.nodes.map((n) => [n.id, n.role]));
    setEdges(
      graph.edges.map((ge) => {
        // backfill the relation from the two roles if the edge predates the feature
        const rel =
          ge.relation || relationForRoles(roleById.get(ge.source), roleById.get(ge.target));
        return {
          id: ge.id,
          source: ge.source,
          target: ge.target,
          label: ge.label ?? RELATION_LABEL[rel] ?? undefined,
          labelStyle: { fill: "var(--text-dim)", fontSize: 11, fontWeight: 600 },
          labelShowBg: true,
          labelBgStyle: { fill: "var(--bg)", fillOpacity: 0.9 },
          labelBgPadding: [5, 3] as [number, number],
          labelBgBorderRadius: 5,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#8a8aa3" },
          style: { stroke: "#8a8aa3", strokeWidth: 1.5 },
          animated: false,
        };
      }),
    );
  }, [graph]);

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
