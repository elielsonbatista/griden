//! Tipos serde compartilhados entre o backend Rust e o frontend.
//! Estes structs são espelhados em `src/types/` no frontend.

use serde::{Deserialize, Serialize};

/// Tipo de banco suportado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    #[default]
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
}

/// Método de autenticação no servidor SSH.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SshAuthKind {
    #[default]
    Password,
    Key,
}

/// Configuração de conexão persistida (NUNCA contém a senha — esta fica no keychain).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnConfig {
    pub id: String,
    pub name: String,
    pub kind: DbKind,
    /// Host/IP (ignorado em sqlite).
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    /// Nome do banco (sqlite: caminho do arquivo).
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    /// Habilita TLS/SSL na conexão.
    #[serde(default)]
    pub ssl: bool,

    // --- Túnel SSH (opcional; ignorado em sqlite). Segredos ficam no keychain. ---
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

/// Payload de criação/edição vindo do frontend (pode trazer a senha em texto puro,
/// que é movida para o keychain e nunca persistida no arquivo de configs).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnInput {
    /// Quando ausente, uma nova conexão é criada com id gerado.
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

    // --- Túnel SSH ---
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

/// Metadado de uma coluna no resultado de uma query.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub type_name: String,
}

/// Resultado agnóstico de uma query. As células são `serde_json::Value` para
/// desacoplar dos tipos estáticos de cada driver.
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

// ----- Edição inline -----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditOp {
    Update,
    Insert,
    Delete,
}

/// Uma edição de linha vinda do grid. `pk` localiza a linha (update/delete);
/// `values` traz os novos valores (update/insert).
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

// ----- Introspecção (usado no schema browser e ERD; preenchido a partir do M3) -----

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

/// Colunas de uma tabela (usado para carregar o schema inteiro de uma vez no ERD).
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
