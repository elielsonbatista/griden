import { api } from "@/lib/ipc";
import { useEditor } from "@/stores/editor";
import { buildTableQuery, defaultSelect, type FilterCondition } from "@/lib/query";
import type { DbKind } from "@/types";

/** A table without a primary key opens read-only; metadata failures degrade, never block. */
export async function openTableTab(params: {
  connId: string;
  connName: string;
  kind: DbKind;
  schema: string;
  table: string;
  filters?: FilterCondition[];
}): Promise<void> {
  const { connId, connName, kind, schema, table, filters } = params;

  const [cols, allFks] = await Promise.all([
    api.getColumns(connId, schema, table).catch(() => []),
    api.getForeignKeys(connId, schema).catch(() => []),
  ]);
  const pkColumns = cols.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const fks = allFks.filter((f) => f.fromTable === table);

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
