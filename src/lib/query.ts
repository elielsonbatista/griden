import type { Cell, DbKind, ForeignKey } from "@/types";

export function quoteIdent(kind: DbKind, ident: string): string {
  switch (kind) {
    case "mysql":
      return "`" + ident.replace(/`/g, "``") + "`";
    case "mssql":
      return "[" + ident.replace(/]/g, "]]") + "]";
    default:
      return '"' + ident.replace(/"/g, '""') + '"';
  }
}

export function qualifiedName(kind: DbKind, schema: string, table: string): string {
  if (kind === "sqlite") return quoteIdent(kind, table);
  return `${quoteIdent(kind, schema)}.${quoteIdent(kind, table)}`;
}

export function defaultSelect(kind: DbKind, schema: string, table: string): string {
  const t = qualifiedName(kind, schema, table);
  if (kind === "mssql") return `SELECT TOP 100 * FROM ${t}`;
  return `SELECT * FROM ${t} LIMIT 100`;
}

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

/** Conditions without a column, or without a required value, are ignored. */
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

export interface RelatedTarget {
  schema: string;
  table: string;
  filters: FilterCondition[];
}

/** Filters that open the row referenced by `fk`, read from the referencing row. */
export function relatedTarget(fk: ForeignKey, valueOf: (column: string) => Cell): RelatedTarget {
  const filters = fk.toColumns.map((toCol, i): FilterCondition => {
    const value = valueOf(fk.fromColumns[i]);
    return value === null
      ? { column: toCol, op: "isnull", value: "" }
      : { column: toCol, op: "=", value: String(value) };
  });
  return { schema: fk.toSchema, table: fk.toTable, filters };
}
