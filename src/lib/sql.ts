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

/** Cache de schema para autocomplete: connId -> { tabela: [colunas] }. */
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
 * Constrói (com cache) um mapa de tabelas->colunas para alimentar o autocomplete.
 * Percorre os schemas e tabelas; colunas são carregadas em paralelo, com limite.
 */
export async function buildSchemaMap(
  connId: string,
): Promise<Record<string, string[]>> {
  const cached = schemaCache.get(connId);
  if (cached) return cached;

  const map: Record<string, string[]> = {};
  try {
    const schemas = await api.getSchemas(connId);
    // Uma query por schema (em vez de uma por tabela) — evita inundar o pool/túnel.
    await Promise.all(
      schemas.map(async (s) => {
        try {
          const tables = await api.getSchemaColumns(connId, s.name);
          for (const t of tables) map[t.table] = t.columns.map((c) => c.name);
        } catch {
          // ignora schema sem acesso
        }
      }),
    );
  } catch {
    // sem schema disponível -> apenas keywords
  }
  schemaCache.set(connId, map);
  return map;
}

export function invalidateSchemaCache(connId: string) {
  schemaCache.delete(connId);
}
