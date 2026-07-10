//! PostgreSQL driver via sqlx.

use crate::error::{AppError, Result};
use crate::models::{ColumnInfo, ConnConfig, QueryResult};
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgRow};
use sqlx::{Column, Connection, Row, TypeInfo};
use std::time::{Duration, Instant};

pub async fn connect(
    cfg: &ConnConfig,
    password: Option<&str>,
    max_connections: u32,
) -> Result<sqlx::PgPool> {
    let mut opts = PgConnectOptions::new()
        .host(cfg.host.as_deref().unwrap_or("localhost"))
        .port(cfg.port.unwrap_or(5432));
    if let Some(db) = &cfg.database {
        opts = opts.database(db);
    }
    if let Some(user) = &cfg.username {
        opts = opts.username(user);
    }
    if let Some(pw) = password {
        opts = opts.password(pw);
    }
    // SSL checked => requires TLS (without verifying the hostname, fine via a tunnel).
    // SSL unchecked => actually disables TLS (not just "prefer"), avoiding a
    // HandshakeFailure when connecting over plaintext (e.g. through an SSH tunnel).
    opts = opts.ssl_mode(if cfg.ssl {
        sqlx::postgres::PgSslMode::Require
    } else {
        sqlx::postgres::PgSslMode::Disable
    });

    // Probe: a single connection that fails fast on "connection refused".
    // (The pool on its own would retry until acquire_timeout — hence the long loading.)
    // The timeout covers the case of an unreachable host (SYN with no response).
    let probe = sqlx::PgConnection::connect_with(&opts);
    match tokio::time::timeout(Duration::from_secs(10), probe).await {
        Ok(Ok(conn)) => {
            let _ = conn.close().await;
        }
        Ok(Err(e)) => return Err(AppError::from(e)),
        Err(_) => {
            return Err(AppError::Database(
                "tempo limite ao conectar ao servidor".into(),
            ))
        }
    }

    // Lazy pool: connections are created on demand (the server is already validated).
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(1)
        // Avoids a validation round-trip on every query (costly over an SSH tunnel).
        // In exchange, recycles connections to reduce stale ones; an automatic
        // retry (AnyPool::execute) covers any that still slip through.
        .test_before_acquire(false)
        .max_lifetime(Duration::from_secs(1800))
        .idle_timeout(Duration::from_secs(300))
        .acquire_timeout(Duration::from_secs(30))
        .connect_lazy_with(opts);
    Ok(pool)
}

pub async fn execute(pool: &sqlx::PgPool, sql: &str) -> Result<QueryResult> {
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
        .map(|row| {
            (0..row.len())
                .map(|i| cell_to_json(row, i))
                .collect::<Vec<_>>()
        })
        .collect();

    Ok(QueryResult {
        rows_affected: data.len() as u64,
        columns,
        rows: data,
        elapsed_ms,
    })
}

fn cell_to_json(row: &PgRow, idx: usize) -> Value {
    let type_name = row.column(idx).type_info().name().to_uppercase();
    match type_name.as_str() {
        "BOOL" => json_opt(row.try_get::<Option<bool>, _>(idx)),
        "INT2" => json_opt(row.try_get::<Option<i16>, _>(idx)),
        "INT4" => json_opt(row.try_get::<Option<i32>, _>(idx)),
        "INT8" => json_opt(row.try_get::<Option<i64>, _>(idx)),
        "FLOAT4" => json_opt(row.try_get::<Option<f32>, _>(idx)),
        "FLOAT8" => json_opt(row.try_get::<Option<f64>, _>(idx)),
        "NUMERIC" => json_string_opt(row.try_get::<Option<rust_decimal::Decimal>, _>(idx)),
        "UUID" => json_string_opt(row.try_get::<Option<uuid::Uuid>, _>(idx)),
        "DATE" => json_string_opt(row.try_get::<Option<chrono::NaiveDate>, _>(idx)),
        "TIME" => json_string_opt(row.try_get::<Option<chrono::NaiveTime>, _>(idx)),
        "TIMESTAMP" => json_string_opt(row.try_get::<Option<chrono::NaiveDateTime>, _>(idx)),
        "TIMESTAMPTZ" => {
            json_string_opt(row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(idx))
        }
        "JSON" | "JSONB" => row
            .try_get::<Option<Value>, _>(idx)
            .unwrap_or(None)
            .unwrap_or(Value::Null),
        "BYTEA" => match row.try_get::<Option<Vec<u8>>, _>(idx) {
            Ok(Some(bytes)) => Value::String(format!("\\x{}", hex(&bytes))),
            _ => Value::Null,
        },
        // TEXT, VARCHAR, BPCHAR, NAME, and unknowns: try string.
        _ => json_string_opt(row.try_get::<Option<String>, _>(idx)),
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

fn json_string_opt<T: ToString>(v: std::result::Result<Option<T>, sqlx::Error>) -> Value {
    match v {
        Ok(Some(x)) => Value::String(x.to_string()),
        _ => Value::Null,
    }
}
