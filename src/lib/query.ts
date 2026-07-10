import type { Cell, DbKind } from "@/types";

/** Escapes an identifier (table/column) according to the dialect. */
export function quoteIdent(kind: DbKind, ident: string): string {
  switch (kind) {
    case "mysql":
      return "`" + ident.replace(/`/g, "``") + "`";
    case "mssql":
      return "[" + ident.replace(/]/g, "]]") + "]";
    default: // postgres, sqlite
      return '"' + ident.replace(/"/g, '""') + '"';
  }
}

/** Qualified name (schema.table), except sqlite which doesn't use a schema. */
export function qualifiedName(kind: DbKind, schema: string, table: string): string {
  if (kind === "sqlite") return quoteIdent(kind, table);
  return `${quoteIdent(kind, schema)}.${quoteIdent(kind, table)}`;
}

/** Default SELECT when opening a table, with a per-dialect limit. */
export function defaultSelect(kind: DbKind, schema: string, table: string): string {
  const t = qualifiedName(kind, schema, table);
  if (kind === "mssql") return `SELECT TOP 100 * FROM ${t}`;
  return `SELECT * FROM ${t} LIMIT 100`;
}

/** Renders a value as a SQL literal, escaped according to the dialect. */
export function sqlLiteral(kind: DbKind, value: Cell): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") {
    if (kind === "postgres") return value ? "TRUE" : "FALSE";
    return value ? "1" : "0";
  }
  if (typeof value === "number") return String(value);
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

// ----- Data view filters -----

export type FilterOp =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "isnull"
  | "notnull";

export const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "=", label: "igual" },
  { value: "!=", label: "diferente" },
  { value: ">", label: "maior" },
  { value: ">=", label: "maior ou igual" },
  { value: "<", label: "menor" },
  { value: "<=", label: "menor ou igual" },
  { value: "contains", label: "contém" },
  { value: "isnull", label: "é nulo" },
  { value: "notnull", label: "não é nulo" },
];

export function opNeedsValue(op: FilterOp): boolean {
  return op !== "isnull" && op !== "notnull";
}

export interface FilterCondition {
  column: string;
  op: FilterOp;
  value: string;
}

/** Builds `SELECT * FROM table [WHERE ...] LIMIT 100` from the filters. */
export function buildTableQuery(
  kind: DbKind,
  schema: string,
  table: string,
  conditions: FilterCondition[],
): string {
  const t = qualifiedName(kind, schema, table);
  const parts = conditions
    .filter((c) => c.column && (!opNeedsValue(c.op) || c.value !== ""))
    .map((c) => {
      const id = quoteIdent(kind, c.column);
      switch (c.op) {
        case "isnull":
          return `${id} IS NULL`;
        case "notnull":
          return `${id} IS NOT NULL`;
        case "contains":
          return `${id} LIKE ${sqlLiteral(kind, `%${c.value}%`)}`;
        default:
          return `${id} ${c.op} ${sqlLiteral(kind, c.value)}`;
      }
    });
  const where = parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  if (kind === "mssql") return `SELECT TOP 100 * FROM ${t}${where}`;
  return `SELECT * FROM ${t}${where} LIMIT 100`;
}
