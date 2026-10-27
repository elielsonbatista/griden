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
import { TableErdNode, type TableNodeData } from "@/components/erd/TableErdNode";
import {
  applyElkLayout,
  buildErdGraph,
  preferredSchema,
  toElkGraph,
} from "@/components/erd/graph";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Network } from "lucide-react";
import { toast } from "sonner";

// Layout runs in a worker: large schemas (160+ tables) would freeze the UI otherwise.
const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });

const nodeTypes = { table: TableErdNode };

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
  // Bumped per diagram load so the canvas refits once, not on every user drag.
  const [version, setVersion] = useState(0);

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
      .catch((e) => toast.error(errMessage(e), { duration: Infinity }));
    return () => {
      alive = false;
    };
  }, [conn?.id]);

  const buildDiagram = useCallback(async () => {
    if (!conn || !schema) return;
    setLoading(true);
    try {
      const [tableColumns, fks] = await Promise.all([
        api.getSchemaColumns(conn.id, schema),
        api.getForeignKeys(conn.id, schema),
      ]);
      const graph = buildErdGraph(tableColumns, fks);
      const laid = await elk.layout(toElkGraph(graph.nodes, graph.edges));
      setNodes(applyElkLayout(graph.nodes, laid));
      setEdges(graph.edges);
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(errMessage(e), { duration: Infinity });
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

  // fitView needs measured nodes. Animating hundreds of nodes stutters, so large diagrams jump.
  useEffect(() => {
    if (nodesInitialized) {
      const duration = nodes.length > 120 ? 0 : 400;
      void fitView({ padding: 0.15, duration, minZoom: 0.05, maxZoom: 1.2 });
    }
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
      // React Flow does not virtualize nodes by default.
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
