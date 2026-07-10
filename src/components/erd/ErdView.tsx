import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
  MarkerType,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk-api";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { api, errMessage } from "@/lib/ipc";
import { useConnections } from "@/stores/connections";
import {
  TableErdNode,
  ERD_NODE_WIDTH,
  erdNodeHeight,
  type TableNodeData,
} from "@/components/erd/TableErdNode";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Network } from "lucide-react";
import { toast } from "sonner";

// Runs the elk layout in a Web Worker so it doesn't block the main thread
// (important for large schemas, e.g. 160+ tables).
const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });

const nodeTypes = { table: TableErdNode };

const ELK_OPTS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "50",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
};

function preferredSchema(names: string[]): string | undefined {
  return (
    names.find((n) => n === "public" || n === "main" || n === "dbo") ?? names[0]
  );
}

export function ErdView() {
  const connections = useConnections((s) => s.connections);
  const connected = useConnections((s) => s.connected);
  const activeId = useConnections((s) => s.activeId);

  const conn =
    connections.find((c) => c.id === activeId && connected.has(c.id)) ??
    connections.find((c) => connected.has(c.id));

  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState<string | undefined>();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(false);
  // Incremented on every (re)load of the diagram; signals the canvas to
  // readjust the view without redoing fitView on every user drag.
  const [version, setVersion] = useState(0);

  // Load schemas when the connection changes.
  useEffect(() => {
    if (!conn) return;
    let alive = true;
    api
      .getSchemas(conn.id)
      .then((s) => {
        if (!alive) return;
        const names = s.map((x) => x.name);
        setSchemas(names);
        setSchema((cur) => (cur && names.includes(cur) ? cur : preferredSchema(names)));
      })
      .catch((e) => toast(errMessage(e)));
    return () => {
      alive = false;
    };
  }, [conn?.id]);

  const buildDiagram = useCallback(async () => {
    if (!conn || !schema) return;
    setLoading(true);
    try {
      // A single query fetches the columns of all tables (avoids N+1 and
      // pool exhaustion on large schemas).
      const [tableColumns, fks] = await Promise.all([
        api.getSchemaColumns(conn.id, schema),
        api.getForeignKeys(conn.id, schema),
      ]);

      const present = new Set(tableColumns.map((t) => t.table));
      const fkColsByTable = new Map<string, Set<string>>();
      for (const fk of fks) {
        const set = fkColsByTable.get(fk.fromTable) ?? new Set<string>();
        fk.fromColumns.forEach((c) => set.add(c));
        fkColsByTable.set(fk.fromTable, set);
      }

      const rawNodes: Node<TableNodeData>[] = tableColumns.map((t) => ({
        id: t.table,
        type: "table",
        position: { x: 0, y: 0 },
        data: {
          name: t.table,
          columns: t.columns,
          fkColumns: fkColsByTable.get(t.table) ?? new Set(),
        },
      }));

      const rawEdges: Edge[] = fks
        .filter((fk) => present.has(fk.fromTable) && present.has(fk.toTable))
        .map((fk, i) => ({
          id: `${fk.name}-${i}`,
          source: fk.fromTable,
          target: fk.toTable,
          label: fk.fromColumns.join(", "),
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "var(--color-primary)" },
        }));

      // Layout with elk.
      const graph = {
        id: "root",
        layoutOptions: ELK_OPTS,
        children: rawNodes.map((n) => ({
          id: n.id,
          width: ERD_NODE_WIDTH,
          height: erdNodeHeight(n.data.columns.length),
        })),
        edges: rawEdges.map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
      };
      const laid = await elk.layout(graph);
      const posById = new Map(
        (laid.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
      );
      setNodes(
        rawNodes.map((n) => ({ ...n, position: posById.get(n.id) ?? n.position })),
      );
      setEdges(rawEdges);
      setVersion((v) => v + 1);
    } catch (e) {
      toast(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, [conn?.id, schema, setNodes, setEdges]);

  useEffect(() => {
    buildDiagram();
  }, [buildDiagram]);

  if (!conn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Network className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">Diagramas ER</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Conecte-se a um banco para visualizar as relações entre tabelas.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="text-xs text-muted-foreground">{conn.name}</span>
        {schemas.length > 0 && (
          <Select value={schema} onValueChange={setSchema}>
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue placeholder="Schema" />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-xs text-muted-foreground">
          {nodes.length} tabela(s)
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <ErdCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            version={version}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

/**
 * React Flow canvas. Readjusts the zoom/position (fitView) whenever the nodes are
 * (re)loaded and measured — centering and showing as many items as possible.
 */
function ErdCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  version,
}: {
  nodes: Node<TableNodeData>[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node<TableNodeData>>;
  onEdgesChange: OnEdgesChange<Edge>;
  version: number;
}) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  // Reframes only when a new diagram is loaded (version changes) and the
  // nodes have already been measured (nodesInitialized) — not on every user drag/zoom.
  // No animation when there are many nodes (animating hundreds of nodes stutters).
  useEffect(() => {
    if (nodesInitialized) {
      const duration = nodes.length > 120 ? 0 : 400;
      void fitView({ padding: 0.15, duration, minZoom: 0.05, maxZoom: 1.2 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, nodesInitialized, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.05}
      // Renders only the nodes visible in the viewport — essential for large
      // graphs (React Flow doesn't virtualize nodes by default).
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
