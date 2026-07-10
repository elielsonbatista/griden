import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Code2, Search, Plus, Minus } from "lucide-react";
import { FILTER_OPS, opNeedsValue, type FilterCondition, type FilterOp } from "@/lib/query";

export interface FilterRow extends FilterCondition {
  id: number;
}

let rowSeq = 1;
export const emptyFilterRow = (): FilterRow => ({
  id: rowSeq++,
  column: "",
  op: "=",
  value: "",
});

export function FilterBar({
  columns,
  rows,
  setRows,
  onApply,
  onToggleSql,
}: {
  columns: string[];
  rows: FilterRow[];
  setRows: Dispatch<SetStateAction<FilterRow[]>>;
  onApply: () => void;
  onToggleSql: () => void;
}) {
  // Clears the selected column if it no longer exists (table switch).
  useEffect(() => {
    setRows((rs) =>
      rs.some((r) => r.column && !columns.includes(r.column))
        ? rs.map((r) => (r.column && !columns.includes(r.column) ? { ...r, column: "" } : r))
        : rs,
    );
  }, [columns, setRows]);

  function update(id: number, patch: Partial<FilterRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="flex flex-col gap-1.5 border-b bg-muted/20 p-2">
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-center gap-2 text-xs">
          {i === 0 ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Filtrar com SQL"
              onClick={onToggleSql}
            >
              <Code2 className="h-4 w-4" />
            </Button>
          ) : (
            <span className="w-8 shrink-0 text-center text-[10px] font-medium text-muted-foreground">
              AND
            </span>
          )}

          <Select value={r.column} onValueChange={(v) => update(r.id, { column: v })}>
            <SelectTrigger size="sm" className="w-48 text-xs">
              <SelectValue placeholder="coluna" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={r.op}
            onValueChange={(v) => update(r.id, { op: v as FilterOp })}
          >
            <SelectTrigger size="sm" className="w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={r.value}
            disabled={!opNeedsValue(r.op)}
            onChange={(e) => update(r.id, { value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onApply()}
            placeholder={opNeedsValue(r.op) ? "valor" : ""}
            className="h-8 flex-1 text-xs"
          />

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Remover condição"
            disabled={rows.length === 1}
            onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
          >
            <Minus className="h-4 w-4" />
          </Button>

          {i === rows.length - 1 ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Adicionar condição"
              onClick={() => setRows((rs) => [...rs, emptyFilterRow()])}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : (
            <span className="w-8 shrink-0" />
          )}

          {i === 0 ? (
            <Button size="icon" className="h-8 w-8 shrink-0" title="Aplicar" onClick={onApply}>
              <Search className="h-4 w-4" />
            </Button>
          ) : (
            <span className="w-8 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}
