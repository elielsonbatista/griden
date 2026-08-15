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
    // Disables sqlx's client-side prepared-statement cache: a connection tunneled
    // through a proxy (e.g. PgBouncer in transaction/statement pooling mode, or an
    // SSH tunnel terminating on a different backend) can route around it, so the
    // client's cached statement id ends up referring to a different prepared
    // statement server-side than the one it was cached for — surfacing as a
    // query's result silently carrying column metadata from an unrelated,
    // previously-run query on the same connection. sqlx's own docs recommend
    // `capacity(0)` for exactly "databases or proxies that have issues with
    // prepared statements". Each connection is otherwise reused for many
    // distinct, user-edited ad hoc statements (not the same query repeatedly),
    // so the cache buys little here relative to that risk.
    opts = opts.statement_cache_capacity(0);

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
    crate::drivers::assert_uniform_columns(&rows)?;

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
    // `try_get_unchecked` (not `try_get`) throughout: we already dispatch on the
    // column's own declared type name below, so sqlx's additional `Type::compatible()`
    // check is redundant here — and, per the identical MySQL case (see mysql.rs), that
    // check can be stricter than the wire format actually requires. Bypassing it
    // decodes the raw bytes directly instead of erroring a value out to NULL.
    match type_name.as_str() {
        "BOOL" => json_opt(row.try_get_unchecked::<Option<bool>, _>(idx), row, idx),
        "INT2" => json_opt(row.try_get_unchecked::<Option<i16>, _>(idx), row, idx),
        "INT4" => json_opt(row.try_get_unchecked::<Option<i32>, _>(idx), row, idx),
        "INT8" => json_opt(row.try_get_unchecked::<Option<i64>, _>(idx), row, idx),
        "FLOAT4" => json_opt(row.try_get_unchecked::<Option<f32>, _>(idx), row, idx),
        "FLOAT8" => json_opt(row.try_get_unchecked::<Option<f64>, _>(idx), row, idx),
        "NUMERIC" => json_string_opt(
            row.try_get_unchecked::<Option<rust_decimal::Decimal>, _>(idx),
            row,
            idx,
        ),
        "UUID" => json_string_opt(row.try_get_unchecked::<Option<uuid::Uuid>, _>(idx), row, idx),
        "DATE" => json_string_opt(
            row.try_get_unchecked::<Option<chrono::NaiveDate>, _>(idx),
            row,
            idx,
        ),
        "TIME" => json_string_opt(
            row.try_get_unchecked::<Option<chrono::NaiveTime>, _>(idx),
            row,
            idx,
        ),
        "TIMESTAMP" => json_string_opt(
            row.try_get_unchecked::<Option<chrono::NaiveDateTime>, _>(idx),
            row,
            idx,
        ),
        "TIMESTAMPTZ" => json_string_opt(
            row.try_get_unchecked::<Option<chrono::DateTime<chrono::Utc>>, _>(idx),
            row,
            idx,
        ),
        "JSON" | "JSONB" => row
            .try_get_unchecked::<Option<Value>, _>(idx)
            .unwrap_or(None)
            .unwrap_or(Value::Null),
        "BYTEA" => match row.try_get_unchecked::<Option<Vec<u8>>, _>(idx) {
            Ok(Some(bytes)) => Value::String(format!("\\x{}", hex(&bytes))),
            Ok(None) => Value::Null,
            Err(e) => decode_fallback(row, idx, &e),
        },
        // TEXT, VARCHAR, BPCHAR, NAME, and unknowns: try string.
        _ => json_string_opt(row.try_get_unchecked::<Option<String>, _>(idx), row, idx),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// A value is present but the typed decode above rejected it (e.g. a
/// type-mapping mismatch) — retry as a raw string rather than silently
/// reporting it as NULL, which would be indistinguishable from a real NULL.
fn decode_fallback(row: &PgRow, idx: usize, err: &sqlx::Error) -> Value {
    match row.try_get_unchecked::<Option<String>, _>(idx) {
        Ok(Some(s)) => Value::String(s),
        Ok(None) => Value::Null,
        Err(_) => {
            eprintln!(
                "griden: falha ao decodificar coluna '{}' (índice {idx}): {err}",
                row.column(idx).name(),
            );
            Value::Null
        }
    }
}

fn json_opt<T: Into<Value>>(
    v: std::result::Result<Option<T>, sqlx::Error>,
    row: &PgRow,
    idx: usize,
) -> Value {
    match v {
        Ok(Some(x)) => x.into(),
        Ok(None) => Value::Null,
        Err(e) => decode_fallback(row, idx, &e),
    }
}

fn json_string_opt<T: ToString>(
    v: std::result::Result<Option<T>, sqlx::Error>,
    row: &PgRow,
    idx: usize,
) -> Value {
    match v {
        Ok(Some(x)) => Value::String(x.to_string()),
        Ok(None) => Value::Null,
        Err(e) => decode_fallback(row, idx, &e),
    }
}
