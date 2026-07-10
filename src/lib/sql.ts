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

/** Schema cache for autocomplete: connId -> { table: [columns] }. */
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

/**
 * Builds (with caching) a table->columns map to feed the autocomplete.
 * Walks the schemas and tables; columns are loaded in parallel, with a limit.
 */
export async function buildSchemaMap(
  connId: string,
): Promise<Record<string, string[]>> {
  const cached = schemaCache.get(connId);
  if (cached) return cached;

  const map: Record<string, string[]> = {};
  try {
    const schemas = await api.getSchemas(connId);
    // One query per schema (instead of one per table) — avoids flooding the pool/tunnel.
    await Promise.all(
      schemas.map(async (s) => {
        try {
          const tables = await api.getSchemaColumns(connId, s.name);
          for (const t of tables) map[t.table] = t.columns.map((c) => c.name);
        } catch {
          // ignore schema without access
        }
      }),
    );
  } catch {
    // no schema available -> keywords only
  }
  schemaCache.set(connId, map);
  return map;
}

export function invalidateSchemaCache(connId: string) {
  schemaCache.delete(connId);
}
