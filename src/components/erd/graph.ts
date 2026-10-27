import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { ElkNode } from "elkjs/lib/elk-api";
import {
  ERD_NODE_WIDTH,
  erdNodeHeight,
  type TableNodeData,
} from "@/components/erd/TableErdNode";
import type { ForeignKey, TableColumns } from "@/types";

const ELK_OPTS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "50",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
};

export function preferredSchema(names: string[]): string | undefined {
  return names.find((n) => n === "public" || n === "main" || n === "dbo") ?? names[0];
}

/** Edges to tables outside the schema are dropped: they have no node to attach to. */
export function buildErdGraph(
  tableColumns: TableColumns[],
  fks: ForeignKey[],
): { nodes: Node<TableNodeData>[]; edges: Edge[] } {
  const present = new Set(tableColumns.map((t) => t.table));
  const fkColsByTable = new Map<string, Set<string>>();
  for (const fk of fks) {
    const set = fkColsByTable.get(fk.fromTable) ?? new Set<string>();
    fk.fromColumns.forEach((c) => set.add(c));
    fkColsByTable.set(fk.fromTable, set);
  }

  const nodes: Node<TableNodeData>[] = tableColumns.map((t) => ({
    id: t.table,
    type: "table",
    position: { x: 0, y: 0 },
    data: {
      name: t.table,
      columns: t.columns,
      fkColumns: fkColsByTable.get(t.table) ?? new Set(),
    },
  }));

  const edges: Edge[] = fks
    .filter((fk) => present.has(fk.fromTable) && present.has(fk.toTable))
    .map((fk, i) => ({
      id: `${fk.name}-${i}`,
      source: fk.fromTable,
      target: fk.toTable,
      label: fk.fromColumns.join(", "),
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--color-primary)" },
    }));

  return { nodes, edges };
}

export function toElkGraph(nodes: Node<TableNodeData>[], edges: Edge[]): ElkNode {
  return {
    id: "root",
    layoutOptions: ELK_OPTS,
    children: nodes.map((n) => ({
      id: n.id,
      width: ERD_NODE_WIDTH,
      height: erdNodeHeight(n.data.columns.length),
    })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

export function applyElkLayout(
  nodes: Node<TableNodeData>[],
  laid: ElkNode,
): Node<TableNodeData>[] {
  const posById = new Map(
    (laid.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
  );
  return nodes.map((n) => ({ ...n, position: posById.get(n.id) ?? n.position }));
}
