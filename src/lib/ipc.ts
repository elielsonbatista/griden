// Wrappers tipados em volta de `invoke()` do Tauri.
import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnMeta,
  ConnConfig,
  ConnInput,
  EditResult,
  ForeignKey,
  QueryResult,
  RowEdit,
  SchemaInfo,
  TableColumns,
  TableInfo,
} from "@/types";

export const api = {
  listConnections(): Promise<ConnConfig[]> {
    return invoke("list_connections");
  },
  saveConnection(input: ConnInput): Promise<ConnConfig> {
    return invoke("save_connection", { input });
  },
  deleteConnection(id: string): Promise<void> {
    return invoke("delete_connection", { id });
  },
  testConnection(input: ConnInput): Promise<void> {
    return invoke("test_connection", { input });
  },
  connect(id: string): Promise<void> {
    return invoke("connect", { id });
  },
  disconnect(id: string): Promise<void> {
    return invoke("disconnect", { id });
  },
  isConnected(id: string): Promise<boolean> {
    return invoke("is_connected", { id });
  },
  runQuery(id: string, sql: string): Promise<QueryResult> {
    return invoke("run_query", { id, sql });
  },
  getSchemas(id: string): Promise<SchemaInfo[]> {
    return invoke("get_schemas", { id });
  },
  getTables(id: string, schema: string): Promise<TableInfo[]> {
    return invoke("get_tables", { id, schema });
  },
  getColumns(id: string, schema: string, table: string): Promise<ColumnMeta[]> {
    return invoke("get_columns", { id, schema, table });
  },
  getSchemaColumns(id: string, schema: string): Promise<TableColumns[]> {
    return invoke("get_schema_columns", { id, schema });
  },
  getForeignKeys(id: string, schema: string): Promise<ForeignKey[]> {
    return invoke("get_foreign_keys", { id, schema });
  },
  applyEdits(id: string, edits: RowEdit[]): Promise<EditResult> {
    return invoke("apply_edits", { id, changes: edits });
  },
  /** Abre diálogo nativo de salvar e grava o conteúdo. Retorna false se cancelado. */
  saveFile(defaultName: string, content: string): Promise<boolean> {
    return invoke("save_file", { defaultName, content });
  },
};

/** Normaliza erros vindos do backend (que chegam como string serializada). */
export function errMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
