import {
  sql,
  PostgreSQL,
  MySQL,
  SQLite,
  MSSQL,
  StandardSQL,
  type SQLDialect,
} from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import { api } from "@/lib/ipc";
import type { DbKind } from "@/types";

const DIALECTS: Record<DbKind, SQLDialect> = {
  postgres: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
  mssql: MSSQL,
};

/** connId -> table -> column names. */
const schemaCache = new Map<string, Record<string, string[]>>();

export function sqlExtension(
  kind: DbKind,
  schema?: Record<string, string[]>,
): Extension {
  return sql({
    dialect: DIALECTS[kind] ?? StandardSQL,
    schema,
    upperCaseKeywords: true,
  });
}

export async function buildSchemaMap(
  connId: string,
): Promise<Record<string, string[]>> {
  const cached = schemaCache.get(connId);
  if (cached) return cached;

  const map: Record<string, string[]> = {};
  try {
    const schemas = await api.getSchemas(connId);
    // One query per schema, not per table, so a large schema does not flood the pool or tunnel.
    await Promise.all(
      schemas.map(async (s) => {
        try {
          const tables = await api.getSchemaColumns(connId, s.name);
          for (const t of tables) map[t.table] = t.columns.map((c) => c.name);
        } catch {
          // A schema without access just contributes no completions.
        }
      }),
    );
  } catch {
    // Without schema metadata the editor still completes keywords.
  }
  schemaCache.set(connId, map);
  return map;
}

export function invalidateSchemaCache(connId: string) {
  schemaCache.delete(connId);
}
