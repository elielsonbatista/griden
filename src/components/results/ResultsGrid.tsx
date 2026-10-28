import { forwardRef, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Cell, ForeignKey, QueryResult } from "@/types";
import { cn } from "@/lib/utils";
import { formatCell } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import {
  buildRowEdits,
  cellEditFromText,
  cellEditToNull,
  pendingChangeCount,
  withCellEdit,
  type EditMap,
} from "@/lib/edits";
import { relatedTarget, type RelatedTarget } from "@/lib/query";
import {
  clampColumnWidth,
  columnVar,
  columnWidth,
  gridWidth,
  type ColumnWidths,
} from "@/lib/columnWidths";
import { api, errMessage } from "@/lib/ipc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  KeyRound,
  Loader2,
  Plus,
  Trash2,
  Undo2,
  Save,
  RotateCcw,
  Copy,
  Ban,
  Eye,
  Link2,
} from "lucide-react";
import { CellValueDialog } from "@/components/results/CellValueDialog";

const ROW_HEIGHT = 28;
const NUM_COL = 56;
const GRID_WIDTH_VAR = "--grid-width";

export interface EditableContext {
  connId: string;
  schema: string;
  table: string;
  pkColumns: string[];
}

type EditingCell = { kind: "row" | "insert"; index: number; col: string } | null;

export function ResultsGrid({
  result,
  editable,
  onSaved,
  foreignKeys,
  onOpenRelated,
  columnWidths,
  onColumnWidthChange,
}: {
  result: QueryResult;
  editable?: EditableContext;
  onSaved?: () => void;
  foreignKeys?: ForeignKey[];
  onOpenRelated?: (target: RelatedTarget) => void;
  columnWidths: ColumnWidths | undefined;
  /** `null` resets the column to the default width. */
  onColumnWidthChange: (column: string, width: number | null) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [edits, setEdits] = useState<EditMap>(new Map());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [inserts, setInserts] = useState<Record<string, Cell>[]>([]);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [saving, setSaving] = useState(false);
  // One context menu serves the whole grid, so it needs to know which cell was hit.
  const [menuTarget, setMenuTarget] = useState<{ rowIdx: number; col: string } | null>(
    null,
  );
  const [valueDialog, setValueDialog] = useState<{ rowIdx: number; col: string } | null>(
    null,
  );

  const colIndex = useMemo(() => {
    const m = new Map<string, number>();
    result.columns.forEach((c, i) => m.set(c.name, i));
    return m;
  }, [result.columns]);

  const pkSet = useMemo(() => new Set(editable?.pkColumns ?? []), [editable]);
  const canEdit = !!editable;
  const columnNames = useMemo(() => result.columns.map((c) => c.name), [result.columns]);
  const totalWidth = gridWidth(columnNames, columnWidths, NUM_COL);
  // Cells size themselves from CSS variables, so a drag can resize a column by
  // touching one element instead of re-rendering every visible cell per frame.
  const widthVars = useMemo(() => {
    const vars: Record<string, string> = { [GRID_WIDTH_VAR]: `${totalWidth}px` };
    columnNames.forEach((name, i) => {
      vars[columnVar(i)] = `${columnWidth(columnWidths, name)}px`;
    });
    return vars as React.CSSProperties;
  }, [columnNames, columnWidths, totalWidth]);

  function startResize(e: React.PointerEvent<HTMLElement>, index: number, column: string) {
    const grid = gridRef.current;
    if (e.button !== 0 || !grid) return;
    e.preventDefault();
    e.stopPropagation();

    const handle = e.currentTarget;
    const startX = e.clientX;
    const startWidth = columnWidth(columnWidths, column);
    const othersWidth = totalWidth - startWidth;
    let width = startWidth;

    function onMove(ev: PointerEvent) {
      width = clampColumnWidth(startWidth + ev.clientX - startX);
      grid!.style.setProperty(columnVar(index), `${width}px`);
      grid!.style.setProperty(GRID_WIDTH_VAR, `${othersWidth + width}px`);
    }
    function onEnd() {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      document.body.classList.remove("col-resizing");
      if (width !== startWidth) onColumnWidthChange(column, width);
    }

    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
    document.body.classList.add("col-resizing");
  }

  const fkByColumn = useMemo(() => {
    const m = new Map<string, ForeignKey>();
    for (const fk of foreignKeys ?? []) {
      for (const col of fk.fromColumns) if (!m.has(col)) m.set(col, fk);
    }
    return m;
  }, [foreignKeys]);

  function openFk(fk: ForeignKey, rowIdx: number) {
    onOpenRelated?.(relatedTarget(fk, (col) => cellValue(rowIdx, col)));
  }

  const virtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const dirtyCount = pendingChangeCount(edits, deleted, inserts);

  function originalValue(rowIdx: number, col: string): Cell {
    return result.rows[rowIdx][colIndex.get(col)!];
  }

  function reset() {
    setEdits(new Map());
    setDeleted(new Set());
    setInserts([]);
    setEditing(null);
  }

  function commitCell(value: string) {
    if (!editing) return;
    const { kind, index, col } = editing;
    if (kind === "row") {
      setCellValue(index, col, value);
    } else {
      setInserts((prev) => {
        const arr = prev.map((r) => ({ ...r }));
        arr[index][col] = value;
        return arr;
      });
    }
    setEditing(null);
  }

  function cellValue(rowIdx: number, col: string): Cell {
    const e = edits.get(rowIdx);
    if (e && e.has(col)) return e.get(col)!;
    return originalValue(rowIdx, col);
  }

  function setCellNull(rowIdx: number, col: string) {
    const next = cellEditToNull(originalValue(rowIdx, col));
    setEdits((prev) => withCellEdit(prev, rowIdx, col, next));
  }

  function setCellValue(rowIdx: number, col: string, text: string) {
    const next = cellEditFromText(text, originalValue(rowIdx, col));
    setEdits((prev) => withCellEdit(prev, rowIdx, col, next));
  }

  function toggleDelete(rowIdx: number) {
    setDeleted((p) => {
      const n = new Set(p);
      n.has(rowIdx) ? n.delete(rowIdx) : n.add(rowIdx);
      return n;
    });
  }

  function copyRowTsv(rowIdx: number) {
    void copyText(
      result.columns.map((c) => formatCell(cellValue(rowIdx, c.name))).join("\t"),
    );
  }

  function onCellContextMenu(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (el?.dataset.row != null && el.dataset.col != null) {
      setMenuTarget({ rowIdx: Number(el.dataset.row), col: el.dataset.col });
    } else {
      setMenuTarget(null);
    }
  }

  async function save() {
    if (!editable) return;
    const batch = buildRowEdits({ result, ...editable, edits, deleted, inserts });
    if (batch.length === 0) return;

    setSaving(true);
    try {
      const res = await api.applyEdits(editable.connId, batch);
      toast.success(`${res.affected} linha(s) alterada(s)`);
      reset();
      onSaved?.();
    } catch (e) {
      toast.error("Falha ao salvar alterações", {
        description: errMessage(e),
        duration: Infinity,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-full flex-col" onContextMenu={onCellContextMenu}>
      {canEdit && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2 text-xs">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1"
            onClick={() => setInserts((p) => [...p, {}])}
          >
            <Plus className="h-3.5 w-3.5" /> Linha
          </Button>
          <div className="flex-1" />
          {dirtyCount > 0 && (
            <>
              <span className="text-muted-foreground">{dirtyCount} alteração(ões)</span>
              <Button size="sm" variant="ghost" className="h-6 gap-1" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" /> Descartar
              </Button>
              <Button size="sm" className="h-6 gap-1" disabled={saving} onClick={save}>
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Salvar
              </Button>
            </>
          )}
        </div>
      )}

      <div ref={parentRef} className="flex-1 overflow-auto text-sm">
        <div
          ref={gridRef}
          style={{ ...widthVars, width: `var(${GRID_WIDTH_VAR})`, position: "relative" }}
        >
          <div className="sticky top-0 z-10 flex border-b bg-muted/60 backdrop-blur">
            <Cellbox width={NUM_COL} className="justify-center text-muted-foreground/60">
              #
            </Cellbox>
            {result.columns.map((c, i) => (
              <Cellbox key={c.name} width={`var(${columnVar(i)})`} className="relative h-8">
                {pkSet.has(c.name) && (
                  <KeyRound className="h-3 w-3 shrink-0 text-amber-500" />
                )}
                <span className="truncate font-medium">{c.name}</span>
                <span className="ml-auto truncate text-[10px] font-normal text-muted-foreground/60">
                  {c.typeName}
                </span>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Redimensionar coluna ${c.name}`}
                  title="Arraste para redimensionar · duplo clique para restaurar"
                  onPointerDown={(e) => startResize(e, i, c.name)}
                  onDoubleClick={() => onColumnWidthChange(c.name, null)}
                  className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-primary/40"
                />
              </Cellbox>
            ))}
          </div>

          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const rowIdx = v.index;
              const isDeleted = deleted.has(rowIdx);
              return (
                <div
                  key={rowIdx}
                  className={cn(
                    "group/r absolute left-0 flex border-b border-border/50",
                    isDeleted && "bg-destructive/10 line-through opacity-60",
                  )}
                  style={{
                    height: ROW_HEIGHT,
                    width: `var(${GRID_WIDTH_VAR})`,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  <Cellbox
                    width={NUM_COL}
                    className="justify-between gap-0 bg-muted/60 pl-2 pr-1 text-muted-foreground/50 tabular-nums"
                  >
                    <span>{rowIdx + 1}</span>
                    {canEdit && (
                      <button
                        title={isDeleted ? "Desfazer exclusão" : "Excluir linha"}
                        className="opacity-0 group-hover/r:opacity-100"
                        onClick={() => toggleDelete(rowIdx)}
                      >
                        {isDeleted ? (
                          <Undo2 className="h-3.5 w-3.5" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        )}
                      </button>
                    )}
                  </Cellbox>
                  {result.columns.map((c, colIdx) => {
                    const isEditing =
                      editing?.kind === "row" &&
                      editing.index === rowIdx &&
                      editing.col === c.name;
                    const fk = fkByColumn.get(c.name);
                    return (
                      <DataCell
                        key={c.name}
                        width={`var(${columnVar(colIdx)})`}
                        data-row={String(rowIdx)}
                        data-col={c.name}
                        value={cellValue(rowIdx, c.name)}
                        dirty={edits.get(rowIdx)?.has(c.name)}
                        editing={isEditing}
                        editable={canEdit && !isDeleted}
                        onStartEdit={() =>
                          setEditing({ kind: "row", index: rowIdx, col: c.name })
                        }
                        onCommit={commitCell}
                        onCancel={() => setEditing(null)}
                        onOpenFk={fk ? () => openFk(fk, rowIdx) : undefined}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>

          {inserts.map((row, i) => (
            <div
              key={`ins-${i}`}
              className="flex border-b border-emerald-500/30 bg-emerald-500/5"
              style={{ height: ROW_HEIGHT, width: `var(${GRID_WIDTH_VAR})` }}
            >
              <Cellbox
                width={NUM_COL}
                className="justify-between bg-muted/60 pl-2 pr-1 text-emerald-600"
              >
                <Plus className="h-3 w-3" />
                <button
                  title="Remover"
                  onClick={() => setInserts((p) => p.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </button>
              </Cellbox>
              {result.columns.map((c, colIdx) => {
                const isEditing =
                  editing?.kind === "insert" &&
                  editing.index === i &&
                  editing.col === c.name;
                return (
                  <DataCell
                    key={c.name}
                    width={`var(${columnVar(colIdx)})`}
                    value={row[c.name] ?? null}
                    editable
                    dirty={row[c.name] != null}
                    editing={isEditing}
                    onStartEdit={() =>
                      setEditing({ kind: "insert", index: i, col: c.name })
                    }
                    onCommit={commitCell}
                    onCancel={() => setEditing(null)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {menuTarget ? (
          <>
            <ContextMenuItem
              onSelect={() =>
                setValueDialog({ rowIdx: menuTarget.rowIdx, col: menuTarget.col })
              }
            >
              <Eye className="mr-2 h-4 w-4" /> Ver valor
            </ContextMenuItem>
            {fkByColumn.get(menuTarget.col) && (
              <ContextMenuItem
                onSelect={() => openFk(fkByColumn.get(menuTarget.col)!, menuTarget.rowIdx)}
              >
                <Link2 className="mr-2 h-4 w-4 text-sky-500" /> Abrir referência (FK)
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() =>
                copyText(formatCell(cellValue(menuTarget.rowIdx, menuTarget.col)))
              }
            >
              <Copy className="mr-2 h-4 w-4" /> Copiar valor
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copyRowTsv(menuTarget.rowIdx)}>
              <Copy className="mr-2 h-4 w-4" /> Copiar linha
            </ContextMenuItem>
            {canEdit && !deleted.has(menuTarget.rowIdx) && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => setCellNull(menuTarget.rowIdx, menuTarget.col)}
                >
                  <Ban className="mr-2 h-4 w-4" /> Definir NULL
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => toggleDelete(menuTarget.rowIdx)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir linha
                </ContextMenuItem>
              </>
            )}
          </>
        ) : (
          <ContextMenuItem disabled>Clique direito sobre uma célula</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>

    <CellValueDialog
      open={!!valueDialog}
      onOpenChange={(o) => !o && setValueDialog(null)}
      column={valueDialog?.col ?? ""}
      value={valueDialog ? cellValue(valueDialog.rowIdx, valueDialog.col) : null}
      editable={!!canEdit && !!valueDialog && !deleted.has(valueDialog.rowIdx)}
      onApply={(next) =>
        valueDialog && setCellValue(valueDialog.rowIdx, valueDialog.col, next)
      }
    />
    </>
  );
}

function Cellbox({
  children,
  className,
  width,
}: {
  children: React.ReactNode;
  className?: string;
  width: number | string;
}) {
  return (
    <div
      className={cn("flex h-7 shrink-0 items-center gap-1 border-r px-2", className)}
      style={{ width }}
    >
      {children}
    </div>
  );
}

interface DataCellProps {
  width: string;
  value: Cell;
  dirty?: boolean;
  editing?: boolean;
  editable?: boolean;
  onStartEdit?: () => void;
  onCommit?: (v: string) => void;
  onCancel?: () => void;
  onOpenFk?: () => void;
}

const DataCell = forwardRef<
  HTMLDivElement,
  DataCellProps & React.HTMLAttributes<HTMLDivElement>
>(function DataCell(
  {
    width,
    value,
    dirty,
    editing,
    editable,
    onStartEdit,
    onCommit,
    onCancel,
    onOpenFk,
    className,
    ...rest
  },
  ref,
) {
  if (editing) {
    return (
      <div className="flex h-7 shrink-0 items-center border-r" style={{ width }}>
        <input
          autoFocus
          defaultValue={formatCell(value)}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") onCancel?.();
          }}
          className="h-full w-full bg-background px-2 text-sm outline-none ring-1 ring-primary"
        />
      </div>
    );
  }

  const isNull = value === null;
  const isNum = typeof value === "number";
  return (
    <div
      ref={ref}
      {...rest}
      onDoubleClick={editable ? onStartEdit : undefined}
      className={cn(
        "group/cell flex h-7 shrink-0 items-center gap-1 border-r px-2 hover:bg-accent/60",
        isNum && "justify-end tabular-nums",
        isNull && "italic text-muted-foreground/40",
        dirty && "bg-amber-500/15",
        editable && "cursor-text",
        className,
      )}
      style={{ width }}
    >
      <span className="truncate">{isNull ? "NULL" : formatCell(value)}</span>
      {onOpenFk && (
        <button
          title="Abrir referência (FK) em nova aba"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFk();
          }}
          className="ml-auto shrink-0 rounded p-0.5 text-sky-500 opacity-0 hover:bg-sky-500/15 group-hover/cell:opacity-100"
        >
          <Link2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
});
