//! MySQL/MariaDB driver via sqlx.

use crate::error::{AppError, Result};
use crate::models::{ColumnInfo, ConnConfig, QueryResult};
use serde_json::Value;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::{Column, Connection, Row, TypeInfo};
use std::time::{Duration, Instant};

pub async fn connect(
    cfg: &ConnConfig,
    password: Option<&str>,
    max_connections: u32,
) -> Result<sqlx::MySqlPool> {
    let mut opts = MySqlConnectOptions::new()
        .host(cfg.host.as_deref().unwrap_or("localhost"))
        .port(cfg.port.unwrap_or(3306));
    if let Some(db) = &cfg.database {
        opts = opts.database(db);
    }
    if let Some(user) = &cfg.username {
        opts = opts.username(user);
    }
    if let Some(pw) = password {
        opts = opts.password(pw);
    }
    // SSL unchecked => actually disables TLS (avoids HandshakeFailure over
    // plaintext, e.g. via an SSH tunnel). SSL checked => requires TLS.
    opts = opts.ssl_mode(if cfg.ssl {
        MySqlSslMode::Required
    } else {
        MySqlSslMode::Disabled
    });
    // Disables sqlx's client-side prepared-statement cache: a connection tunneled
    // through a proxy/load balancer (e.g. an RDS proxy, ProxySQL, or an SSH
    // tunnel terminating on a different backend) can route around it, so the
    // client's cached statement id ends up referring to a different prepared
    // statement server-side than the one it was cached for — surfacing as a
    // query's result silently carrying column metadata from an unrelated,
    // previously-run query on the same connection. sqlx's own docs recommend
    // `capacity(0)` for exactly "databases or proxies that have issues with
    // prepared statements". Each connection is otherwise reused for many
    // distinct, user-edited ad hoc statements (not the same query repeatedly),
    // so the cache buys little here relative to that risk.
    opts = opts.statement_cache_capacity(0);

    // Probe: fails fast on "connection refused" (the pool would otherwise retry
    // until acquire_timeout). The timeout covers an unreachable host.
    let probe = sqlx::MySqlConnection::connect_with(&opts);
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

    let pool = MySqlPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(1)
        // Avoids a validation round-trip on every query (costly over an SSH tunnel).
        // Recycles connections to reduce stale ones; an automatic retry covers the rest.
        .test_before_acquire(false)
        .max_lifetime(Duration::from_secs(1800))
        .idle_timeout(Duration::from_secs(300))
        .acquire_timeout(Duration::from_secs(30))
        .connect_lazy_with(opts);
    Ok(pool)
}

pub async fn execute(pool: &sqlx::MySqlPool, sql: &str) -> Result<QueryResult> {
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
            // sqlx reports TINYINT(1) as "BOOLEAN"; we show the real type.
            type_name: match c.type_info().name() {
                "BOOLEAN" => "TINYINT".to_string(),
                other => other.to_string(),
            },
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

fn cell_to_json(row: &MySqlRow, idx: usize) -> Value {
    let t = row.column(idx).type_info().name().to_uppercase();
    let unsigned = t.contains("UNSIGNED");
    match t.split_whitespace().next().unwrap_or("") {
        // TINYINT(1) arrives as "BOOLEAN" in sqlx, but it is an integer: shows 0/1.
        //
        // `try_get_unchecked` (not `try_get`) below: sqlx's `Type::compatible()` check
        // is stricter than the wire format actually requires — e.g. it accepts `i32`
        // only for columns it tags "INT"/"TINYINT", and rejects the identical raw byte
        // layout when the same column is tagged "BOOLEAN" (TINYINT(1)) or "TIMESTAMP"
        // (vs. "DATETIME"). `try_get` enforces that check and errors out even though
        // the bytes decode fine; `try_get_unchecked` decodes the bytes directly.
        "BOOLEAN" | "BOOL" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" => {
            if unsigned {
                json_opt(row.try_get_unchecked::<Option<u32>, _>(idx), row, idx)
            } else {
                json_opt(row.try_get_unchecked::<Option<i32>, _>(idx), row, idx)
            }
        }
        "BIGINT" => {
            if unsigned {
                json_opt(row.try_get_unchecked::<Option<u64>, _>(idx), row, idx)
            } else {
                json_opt(row.try_get_unchecked::<Option<i64>, _>(idx), row, idx)
            }
        }
        "FLOAT" => json_opt(row.try_get_unchecked::<Option<f32>, _>(idx), row, idx),
        "DOUBLE" => json_opt(row.try_get_unchecked::<Option<f64>, _>(idx), row, idx),
        "DECIMAL" | "NEWDECIMAL" => json_string_opt(
            row.try_get_unchecked::<Option<rust_decimal::Decimal>, _>(idx),
            row,
            idx,
        ),
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
        "DATETIME" | "TIMESTAMP" => json_string_opt(
            row.try_get_unchecked::<Option<chrono::NaiveDateTime>, _>(idx),
            row,
            idx,
        ),
        "JSON" => row
            .try_get_unchecked::<Option<Value>, _>(idx)
            .unwrap_or(None)
            .unwrap_or(Value::Null),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" => {
            match row.try_get_unchecked::<Option<Vec<u8>>, _>(idx) {
                Ok(Some(bytes)) => Value::String(format!("0x{}", hex(&bytes))),
                Ok(None) => Value::Null,
                Err(e) => decode_fallback(row, idx, &e),
            }
        }
        _ => json_string_opt(row.try_get_unchecked::<Option<String>, _>(idx), row, idx),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// A value is present but the typed decode above rejected it (e.g. a MySQL
/// "zero date" `0000-00-00` that `chrono::NaiveDateTime` can't represent, or a
/// type-mapping mismatch) — retry as a raw string rather than silently
/// reporting it as NULL, which would be indistinguishable from a real NULL.
fn decode_fallback(row: &MySqlRow, idx: usize, err: &sqlx::Error) -> Value {
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
    row: &MySqlRow,
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
    row: &MySqlRow,
    idx: usize,
) -> Value {
    match v {
        Ok(Some(x)) => Value::String(x.to_string()),
        Ok(None) => Value::Null,
        Err(e) => decode_fallback(row, idx, &e),
    }
}
