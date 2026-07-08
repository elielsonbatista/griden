import type { Cell, DbKind } from "@/types";

/** Escapa um identificador (tabela/coluna) conforme o dialeto. */
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

/** Nome qualificado (schema.tabela), exceto sqlite que não usa schema. */
export function qualifiedName(kind: DbKind, schema: string, table: string): string {
  if (kind === "sqlite") return quoteIdent(kind, table);
  return `${quoteIdent(kind, schema)}.${quoteIdent(kind, table)}`;
}

/** SELECT padrão ao abrir uma tabela, com limite por dialeto. */
export function defaultSelect(kind: DbKind, schema: string, table: string): string {
  const t = qualifiedName(kind, schema, table);
  if (kind === "mssql") return `SELECT TOP 100 * FROM ${t}`;
  return `SELECT * FROM ${t} LIMIT 100`;
}

/** Renderiza um valor como literal SQL, escapado conforme o dialeto. */
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

// ----- Filtros da data view -----

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

/** Monta `SELECT * FROM tabela [WHERE ...] LIMIT 100` a partir dos filtros. */
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
