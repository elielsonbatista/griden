import { Handle, Position, type NodeProps } from "@xyflow/react";
import { KeyRound, Link2 } from "lucide-react";
import type { ColumnMeta } from "@/types";

export interface TableNodeData {
  name: string;
  columns: ColumnMeta[];
  fkColumns: Set<string>;
  [key: string]: unknown;
}

export const ERD_NODE_WIDTH = 230;
export const ERD_ROW_HEIGHT = 22;
export const ERD_HEADER_HEIGHT = 32;

export function erdNodeHeight(cols: number) {
  return ERD_HEADER_HEIGHT + cols * ERD_ROW_HEIGHT + 4;
}

export function TableErdNode({ data }: NodeProps & { data: TableNodeData }) {
  return (
    <div
      className="overflow-hidden rounded-md border border-border bg-card shadow-md"
      style={{ width: ERD_NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <Handle type="source" position={Position.Right} className="!bg-primary" />
      <div
        className="flex items-center gap-1.5 border-b bg-muted px-2 font-medium"
        style={{ height: ERD_HEADER_HEIGHT }}
      >
        <span className="truncate text-sm">{data.name}</span>
      </div>
      <div>
        {data.columns.map((c) => (
          <div
            key={c.name}
            className="flex items-center gap-1.5 px-2 text-xs"
            style={{ height: ERD_ROW_HEIGHT }}
          >
            {c.isPrimaryKey ? (
              <KeyRound className="h-3 w-3 shrink-0 text-amber-500" />
            ) : data.fkColumns.has(c.name) ? (
              <Link2 className="h-3 w-3 shrink-0 text-sky-500" />
            ) : (
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/30" />
            )}
            <span className="truncate">{c.name}</span>
            <span className="ml-auto truncate text-[10px] text-muted-foreground/60">
              {c.dataType}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
