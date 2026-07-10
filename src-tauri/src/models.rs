//! Serde types shared between the Rust backend and the frontend.
//! These structs are mirrored in `src/types/` on the frontend.

use serde::{Deserialize, Serialize};

/// Supported database type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    #[default]
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
}

/// Authentication method for the SSH server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SshAuthKind {
    #[default]
    Password,
    Key,
}

/// Persisted connection configuration (NEVER contains the password — that lives in the keychain).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnConfig {
    pub id: String,
    pub name: String,
    pub kind: DbKind,
    /// Host/IP (ignored for sqlite).
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    /// Database name (sqlite: file path).
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    /// Enables TLS/SSL on the connection.
    #[serde(default)]
    pub ssl: bool,

    // --- SSH tunnel (optional; ignored for sqlite). Secrets live in the keychain. ---
    #[serde(default)]
    pub ssh_enabled: bool,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_auth: SshAuthKind,
    #[serde(default)]
    pub ssh_key_path: Option<String>,
}

/// Create/edit payload coming from the frontend (may carry the password in plain
/// text, which is moved to the keychain and never persisted to the config file).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnInput {
    /// When absent, a new connection is created with a generated id.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub kind: DbKind,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub ssl: bool,

    // --- SSH tunnel ---
    #[serde(default)]
    pub ssh_enabled: bool,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_auth: SshAuthKind,
    #[serde(default)]
    pub ssh_key_path: Option<String>,
    #[serde(default)]
    pub ssh_password: Option<String>,
    #[serde(default)]
    pub ssh_passphrase: Option<String>,
}

/// Metadata for a column in a query result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub type_name: String,
}

/// Driver-agnostic query result. Cells are `serde_json::Value` to
/// decouple from each driver's static types.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
}

impl QueryResult {
    pub fn empty(rows_affected: u64, elapsed_ms: u64) -> Self {
        Self {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected,
            elapsed_ms,
        }
    }
}

// ----- Inline editing -----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditOp {
    Update,
    Insert,
    Delete,
}

/// A row edit coming from the grid. `pk` locates the row (update/delete);
/// `values` carries the new values (update/insert).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowEdit {
    pub op: EditOp,
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub pk: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub values: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    pub affected: u64,
}

// ----- Introspection (used in the schema browser and ERD; populated starting from M3) -----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TableKind {
    Table,
    View,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub default: Option<String>,
    pub ordinal: i32,
}

/// Columns of a table (used to load the entire schema at once in the ERD).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumns {
    pub table: String,
    pub columns: Vec<ColumnMeta>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    pub name: String,
    pub from_schema: String,
    pub from_table: String,
    pub from_columns: Vec<String>,
    pub to_schema: String,
    pub to_table: String,
    pub to_columns: Vec<String>,
}
