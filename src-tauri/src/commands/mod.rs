//! Tauri commands exposed to the frontend. These are thin wrappers over the
//! `ConnectionManager` and the driver layer.

use crate::connection::ConnectionManager;
use crate::drivers::AnyPool;
use crate::edits;
use crate::error::{AppError, Result};
use crate::introspection;
use crate::models::{
    ColumnMeta, ConnConfig, ConnInput, EditResult, ForeignKey, QueryResult, RowEdit, SchemaInfo,
    TableColumns, TableInfo,
};
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

// Second failure after reconnect: surface a generic message instead of the raw driver error.
async fn with_reconnect<T, F, Fut>(mgr: &ConnectionManager, id: &str, op: F) -> Result<T>
where
    F: Fn(Arc<AnyPool>) -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let pool = mgr.get_pool(id).await?;
    match op(pool).await {
        Err(e) if e.is_connection_lost() => {
            mgr.reconnect(id)
                .await
                .map_err(|_| AppError::Database("Connection lost".into()))?;
            let pool = mgr
                .get_pool(id)
                .await
                .map_err(|_| AppError::Database("Connection lost".into()))?;
            match op(pool).await {
                Err(e) if e.is_connection_lost() => {
                    Err(AppError::Database("Connection lost".into()))
                }
                other => other,
            }
        }
        other => other,
    }
}

/// Like `with_reconnect`, but over the single-connection pool dedicated to
/// execution (`run_query`/`apply_edits`) — see [`ConnectionManager::get_exec_pool`].
async fn with_reconnect_exec<T, F, Fut>(mgr: &ConnectionManager, id: &str, op: F) -> Result<T>
where
    F: Fn(Arc<AnyPool>) -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let pool = mgr.get_exec_pool(id).await?;
    match op(pool).await {
        Err(e) if e.is_connection_lost() => {
            mgr.reconnect(id)
                .await
                .map_err(|_| AppError::Database("Connection lost".into()))?;
            let pool = mgr
                .get_exec_pool(id)
                .await
                .map_err(|_| AppError::Database("Connection lost".into()))?;
            match op(pool).await {
                Err(e) if e.is_connection_lost() => {
                    Err(AppError::Database("Connection lost".into()))
                }
                other => other,
            }
        }
        other => other,
    }
}

#[tauri::command]
pub fn list_connections(mgr: State<'_, ConnectionManager>) -> Result<Vec<ConnConfig>> {
    mgr.list_configs()
}

#[tauri::command]
pub fn save_connection(mgr: State<'_, ConnectionManager>, input: ConnInput) -> Result<ConnConfig> {
    mgr.save_config(input)
}

#[tauri::command]
pub async fn delete_connection(mgr: State<'_, ConnectionManager>, id: String) -> Result<()> {
    mgr.delete_config(&id).await
}

#[tauri::command]
pub async fn test_connection(mgr: State<'_, ConnectionManager>, input: ConnInput) -> Result<()> {
    mgr.test(&input).await
}

#[tauri::command]
pub async fn connect(mgr: State<'_, ConnectionManager>, id: String) -> Result<()> {
    mgr.connect(&id).await
}

#[tauri::command]
pub async fn disconnect(mgr: State<'_, ConnectionManager>, id: String) -> Result<()> {
    mgr.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn is_connected(mgr: State<'_, ConnectionManager>, id: String) -> Result<bool> {
    Ok(mgr.is_connected(&id).await)
}

#[tauri::command]
pub async fn run_query(
    mgr: State<'_, ConnectionManager>,
    id: String,
    sql: String,
) -> Result<QueryResult> {
    with_reconnect_exec(&mgr, &id, move |pool| {
        let sql = sql.clone();
        async move { pool.execute(&sql).await }
    })
    .await
}

#[tauri::command]
pub async fn get_schemas(mgr: State<'_, ConnectionManager>, id: String) -> Result<Vec<SchemaInfo>> {
    with_reconnect(&mgr, &id, |pool| async move {
        introspection::list_schemas(&pool).await
    })
    .await
}

#[tauri::command]
pub async fn get_tables(
    mgr: State<'_, ConnectionManager>,
    id: String,
    schema: String,
) -> Result<Vec<TableInfo>> {
    with_reconnect(&mgr, &id, move |pool| {
        let schema = schema.clone();
        async move { introspection::list_tables(&pool, &schema).await }
    })
    .await
}

#[tauri::command]
pub async fn get_columns(
    mgr: State<'_, ConnectionManager>,
    id: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnMeta>> {
    with_reconnect(&mgr, &id, move |pool| {
        let schema = schema.clone();
        let table = table.clone();
        async move { introspection::list_columns(&pool, &schema, &table).await }
    })
    .await
}

#[tauri::command]
pub async fn get_schema_columns(
    mgr: State<'_, ConnectionManager>,
    id: String,
    schema: String,
) -> Result<Vec<TableColumns>> {
    with_reconnect(&mgr, &id, move |pool| {
        let schema = schema.clone();
        async move { introspection::list_all_columns(&pool, &schema).await }
    })
    .await
}

#[tauri::command]
pub async fn get_foreign_keys(
    mgr: State<'_, ConnectionManager>,
    id: String,
    schema: String,
) -> Result<Vec<ForeignKey>> {
    with_reconnect(&mgr, &id, move |pool| {
        let schema = schema.clone();
        async move { introspection::list_foreign_keys(&pool, &schema).await }
    })
    .await
}

/// Opens a native "save as" dialog and writes the content (CSV, JSON, etc.). The
/// file filter is derived from the extension of `default_name`. Returns `false`
/// if the user cancels. Downloading via <a> does not work in the webview.
#[tauri::command]
pub async fn save_file(app: AppHandle, default_name: String, content: String) -> Result<bool> {
    let ext = std::path::Path::new(&default_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt")
        .to_string();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let Some(path) = rx.await.map_err(|e| AppError::Other(e.to_string()))? else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|e| AppError::Other(e.to_string()))?;
    std::fs::write(path, content)?;
    Ok(true)
}

#[tauri::command]
pub async fn apply_edits(
    mgr: State<'_, ConnectionManager>,
    id: String,
    changes: Vec<RowEdit>,
) -> Result<EditResult> {
    let kind = mgr.get_pool(&id).await?.kind();
    let statements: Vec<String> = changes
        .iter()
        .map(|e| edits::build_sql(kind, e))
        .collect::<Result<_>>()?;
    let affected = with_reconnect_exec(&mgr, &id, move |pool| {
        let statements = statements.clone();
        async move { pool.execute_tx(&statements).await }
    })
    .await?;
    Ok(EditResult { affected })
}
