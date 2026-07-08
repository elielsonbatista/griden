import { api } from "@/lib/ipc";
import { useEditor } from "@/stores/editor";
import { buildTableQuery, defaultSelect, type FilterCondition } from "@/lib/query";
import type { DbKind, ForeignKey } from "@/types";

/**
 * Abre uma aba "data view" (barra de filtros + grid) para uma tabela. Busca a PK
 * (para edição inline) e as foreign keys (para navegação) e, opcionalmente,
 * aplica filtros iniciais (ex.: ao navegar uma FK). Usado tanto pelo duplo-clique
 * na tabela quanto pelo clique numa célula de FK.
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
    /* sem colunas/PK -> grid não editável */
  }

  let fks: ForeignKey[] = [];
  try {
    const all = await api.getForeignKeys(connId, schema);
    fks = all.filter((f) => f.fromTable === table);
  } catch {
    /* sem FKs */
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
