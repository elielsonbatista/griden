//! Driver SQLite via sqlx.

use crate::error::Result;
use crate::models::{ColumnInfo, ConnConfig, QueryResult};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, TypeInfo};
use std::str::FromStr;
use std::time::Instant;

pub async fn connect(cfg: &ConnConfig, _password: Option<&str>) -> Result<sqlx::SqlitePool> {
    let path = cfg.database.as_deref().ok_or_else(|| {
        crate::error::AppError::InvalidConfig("caminho do arquivo SQLite ausente".into())
    })?;

    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{path}"))
        .map_err(|e| crate::error::AppError::InvalidConfig(e.to_string()))?
        .create_if_missing(false);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(60))
        .connect_with(opts)
        .await?;
    Ok(pool)
}

pub async fn execute(pool: &sqlx::SqlitePool, sql: &str) -> Result<QueryResult> {
    let started = Instant::now();
    let rows = sqlx::query(sql).fetch_all(pool).await?;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    if rows.is_empty() {
        return Ok(QueryResult::empty(0, elapsed_ms));
    }

    let columns: Vec<ColumnInfo> = rows[0]
        .columns()
        .iter()
        .map(|c| ColumnInfo {
            name: c.name().to_string(),
            type_name: c.type_info().name().to_string(),
        })
        .collect();

    let data: Vec<Vec<Value>> = rows
        .iter()
        .map(|row| (0..row.len()).map(|i| cell_to_json(row, i)).collect())
        .collect();

    Ok(QueryResult {
        rows_affected: data.len() as u64,
        columns,
        rows: data,
        elapsed_ms,
    })
}

fn cell_to_json(row: &SqliteRow, idx: usize) -> Value {
    let t = row.column(idx).type_info().name().to_uppercase();
    match t.as_str() {
        "INTEGER" | "BIGINT" | "INT" => json_opt(row.try_get::<Option<i64>, _>(idx)),
        "REAL" | "FLOAT" | "DOUBLE" => json_opt(row.try_get::<Option<f64>, _>(idx)),
        "BOOLEAN" => json_opt(row.try_get::<Option<bool>, _>(idx)),
        "BLOB" => match row.try_get::<Option<Vec<u8>>, _>(idx) {
            Ok(Some(bytes)) => Value::String(format!("0x{}", hex(&bytes))),
            _ => Value::Null,
        },
        // TEXT, NUMERIC, DATETIME, e desconhecidos: tenta string, depois i64/f64.
        _ => match row.try_get::<Option<String>, _>(idx) {
            Ok(Some(s)) => Value::String(s),
            Ok(None) => Value::Null,
            Err(_) => json_opt(row.try_get::<Option<i64>, _>(idx)),
        },
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn json_opt<T: Into<Value>>(v: std::result::Result<Option<T>, sqlx::Error>) -> Value {
    match v {
        Ok(Some(x)) => x.into(),
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use crate::drivers::AnyPool;
    use crate::models::{ConnConfig, DbKind};

    fn sample_cfg() -> ConnConfig {
        ConnConfig {
            id: "test".into(),
            name: "sample".into(),
            kind: DbKind::Sqlite,
            database: Some(concat!(env!("CARGO_MANIFEST_DIR"), "/../.dev/sample.db").into()),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn connect_ping_and_query_sqlite() {
        let pool = AnyPool::connect(&sample_cfg(), None)
            .await
            .expect("conectar no sqlite de exemplo");
        pool.ping().await.expect("ping");

        let res = pool
            .execute("SELECT id, name, born FROM authors ORDER BY id")
            .await
            .expect("query");

        assert_eq!(res.columns.len(), 3);
        assert_eq!(res.columns[1].name, "name");
        assert_eq!(res.rows.len(), 2);
        assert_eq!(res.rows[0][1], serde_json::json!("Ada Lovelace"));
        assert_eq!(res.rows[0][2], serde_json::json!(1815));

        // Tipos diversos: REAL e DATE.
        let books = pool
            .execute("SELECT title, price, published FROM books ORDER BY id")
            .await
            .expect("query books");
        assert_eq!(books.rows.len(), 2);
        assert_eq!(books.rows[0][1], serde_json::json!(42.5));
        assert_eq!(books.rows[0][2], serde_json::json!("1843-10-01"));

        pool.close().await;
    }

    #[tokio::test]
    async fn introspection_sqlite() {
        use crate::introspection;
        let pool = AnyPool::connect(&sample_cfg(), None).await.unwrap();

        let schemas = introspection::list_schemas(&pool).await.unwrap();
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].name, "main");

        let tables = introspection::list_tables(&pool, "main").await.unwrap();
        let names: Vec<_> = tables.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"authors"));
        assert!(names.contains(&"books"));

        let cols = introspection::list_columns(&pool, "main", "books")
            .await
            .unwrap();
        assert_eq!(cols[0].name, "id");
        assert!(cols[0].is_primary_key, "id deve ser PK");
        let title = cols.iter().find(|c| c.name == "title").unwrap();
        assert!(!title.nullable, "title é NOT NULL");
        assert!(!title.is_primary_key);

        // Foreign keys: books.author_id -> authors.id
        let fks = introspection::list_foreign_keys(&pool, "main")
            .await
            .unwrap();
        let fk = fks
            .iter()
            .find(|f| f.from_table == "books")
            .expect("FK em books");
        assert_eq!(fk.to_table, "authors");
        assert_eq!(fk.from_columns, vec!["author_id".to_string()]);
        assert_eq!(fk.to_columns, vec!["id".to_string()]);

        pool.close().await;
    }
}
