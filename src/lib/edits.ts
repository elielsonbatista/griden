import { formatCell } from "@/lib/format";
import type { Cell, QueryResult, RowEdit } from "@/types";

/** Pending edits: row index -> column -> new value. */
export type EditMap = Map<number, Map<string, Cell>>;

/** `undefined` reverts the cell to its original value. */
export function withCellEdit(
  edits: EditMap,
  rowIdx: number,
  col: string,
  next: Cell | undefined,
): EditMap {
  const m = new Map(edits);
  const row = new Map(m.get(rowIdx) ?? []);
  if (next === undefined) row.delete(col);
  else row.set(col, next);
  if (row.size === 0) m.delete(rowIdx);
  else m.set(rowIdx, row);
  return m;
}

/**
 * Text matching the original's display form is "no change", which also covers
 * NULL shown as "" and JSON shown serialized. Numeric columns keep numeric input numeric.
 */
export function cellEditFromText(text: string, original: Cell): Cell | undefined {
  if (text === formatCell(original)) return undefined;
  if (typeof original === "number" && text.trim() !== "" && !isNaN(Number(text))) {
    return Number(text);
  }
  return text;
}

export function cellEditToNull(original: Cell): Cell | undefined {
  return original === null ? undefined : null;
}

export function pendingChangeCount(
  edits: EditMap,
  deleted: Set<number>,
  inserts: Record<string, Cell>[],
): number {
  let updated = 0;
  for (const [rowIdx, cols] of edits) if (!deleted.has(rowIdx) && cols.size > 0) updated++;
  return updated + deleted.size + inserts.length;
}

/** Deleted rows drop their pending updates; empty inserted rows are skipped. */
export function buildRowEdits(params: {
  result: QueryResult;
  schema: string;
  table: string;
  pkColumns: string[];
  edits: EditMap;
  deleted: Set<number>;
  inserts: Record<string, Cell>[];
}): RowEdit[] {
  const { result, schema, table, pkColumns, edits, deleted, inserts } = params;
  const colIndex = new Map(result.columns.map((c, i) => [c.name, i]));
  const pkOf = (rowIdx: number): Record<string, Cell> =>
    Object.fromEntries(pkColumns.map((c) => [c, result.rows[rowIdx][colIndex.get(c)!]]));

  const batch: RowEdit[] = [];
  for (const [rowIdx, cols] of edits) {
    if (deleted.has(rowIdx) || cols.size === 0) continue;
    batch.push({ op: "update", schema, table, pk: pkOf(rowIdx), values: Object.fromEntries(cols) });
  }
  for (const rowIdx of deleted) {
    batch.push({ op: "delete", schema, table, pk: pkOf(rowIdx), values: {} });
  }
  for (const ins of inserts) {
    const values = Object.fromEntries(
      Object.entries(ins).filter(([, v]) => v !== "" && v !== null),
    );
    if (Object.keys(values).length > 0) batch.push({ op: "insert", schema, table, pk: {}, values });
  }
  return batch;
}
