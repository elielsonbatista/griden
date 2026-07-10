import { api } from "@/lib/ipc";
import { useEditor } from "@/stores/editor";
import { buildTableQuery, defaultSelect, type FilterCondition } from "@/lib/query";
import type { DbKind, ForeignKey } from "@/types";

/**
 * Opens a "data view" tab (filter bar + grid) for a table. Fetches the PK
 * (for inline editing) and the foreign keys (for navigation) and, optionally,
 * applies initial filters (e.g. when navigating an FK). Used both by
 * double-clicking a table and by clicking an FK cell.
 */
export async function openTableTab(params: {
  connId: string;
  connName: string;
  kind: DbKind;
  schema: string;
  table: string;
  filters?: FilterCondition[];
}): Promise<void> {
  const { connId, connName, kind, schema, table, filters } = params;

  let pkColumns: string[] = [];
  try {
    const cols = await api.getColumns(connId, schema, table);
    pkColumns = cols.filter((c) => c.isPrimaryKey).map((c) => c.name);
  } catch {
    /* no columns/PK -> non-editable grid */
  }

  let fks: ForeignKey[] = [];
  try {
    const all = await api.getForeignKeys(connId, schema);
    fks = all.filter((f) => f.fromTable === table);
  } catch {
    /* no FKs */
  }

  const editable = pkColumns.length > 0 ? { schema, table, pkColumns } : undefined;
  const sql =
    filters && filters.length
      ? buildTableQuery(kind, schema, table, filters)
      : defaultSelect(kind, schema, table);

  const id = useEditor
    .getState()
    .openTab(connId, connName, sql, table, editable, fks, { schema, table }, filters);
  useEditor.getState().run(id);
}
