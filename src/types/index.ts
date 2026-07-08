// Tipos TS espelhando os structs serde do backend Rust (src-tauri/src/models.rs).

export type DbKind = "mysql" | "postgres" | "sqlite" | "mssql";

export type SshAuthKind = "password" | "key";

export interface ConnConfig {
  id: string;
  name: string;
  kind: DbKind;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  ssl: boolean;
  sshEnabled: boolean;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUser?: string | null;
  sshAuth: SshAuthKind;
  sshKeyPath?: string | null;
}

export interface ConnInput {
  id?: string | null;
  name: string;
  kind: DbKind;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  password?: string | null;
  ssl: boolean;
  sshEnabled: boolean;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUser?: string | null;
  sshAuth: SshAuthKind;
  sshKeyPath?: string | null;
  sshPassword?: string | null;
  sshPassphrase?: string | null;
}

export interface ColumnInfo {
  name: string;
  typeName: string;
}

export type Cell =
  | string
  | number
  | boolean
  | null
  | Cell[]
  | { [key: string]: Cell };

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Cell[][];
  rowsAffected: number;
  elapsedMs: number;
}

export interface SchemaInfo {
  name: string;
}

export type TableKind = "table" | "view";

export interface TableInfo {
  schema: string;
  name: string;
  kind: TableKind;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  default: string | null;
  ordinal: number;
}

export type EditOp = "update" | "insert" | "delete";

export interface RowEdit {
  op: EditOp;
  schema: string;
  table: string;
  pk: Record<string, Cell>;
  values: Record<string, Cell>;
}

export interface EditResult {
  affected: number;
}

export interface TableColumns {
  table: string;
  columns: ColumnMeta[];
}

export interface ForeignKey {
  name: string;
  fromSchema: string;
  fromTable: string;
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  toColumns: string[];
}

export const DB_KINDS: { value: DbKind; label: string; defaultPort?: number }[] = [
  { value: "mysql", label: "MySQL / MariaDB", defaultPort: 3306 },
  { value: "postgres", label: "PostgreSQL", defaultPort: 5432 },
  { value: "sqlite", label: "SQLite" },
  { value: "mssql", label: "SQL Server", defaultPort: 1433 },
];
