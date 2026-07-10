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
        "BOOLEAN" | "BOOL" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" => {
            if unsigned {
                json_opt(row.try_get::<Option<u32>, _>(idx))
            } else {
                json_opt(row.try_get::<Option<i32>, _>(idx))
            }
        }
        "BIGINT" => {
            if unsigned {
                json_opt(row.try_get::<Option<u64>, _>(idx))
            } else {
                json_opt(row.try_get::<Option<i64>, _>(idx))
            }
        }
        "FLOAT" => json_opt(row.try_get::<Option<f32>, _>(idx)),
        "DOUBLE" => json_opt(row.try_get::<Option<f64>, _>(idx)),
        "DECIMAL" | "NEWDECIMAL" => {
            json_string_opt(row.try_get::<Option<rust_decimal::Decimal>, _>(idx))
        }
        "DATE" => json_string_opt(row.try_get::<Option<chrono::NaiveDate>, _>(idx)),
        "TIME" => json_string_opt(row.try_get::<Option<chrono::NaiveTime>, _>(idx)),
        "DATETIME" | "TIMESTAMP" => {
            json_string_opt(row.try_get::<Option<chrono::NaiveDateTime>, _>(idx))
        }
        "JSON" => row
            .try_get::<Option<Value>, _>(idx)
            .unwrap_or(None)
            .unwrap_or(Value::Null),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" => {
            match row.try_get::<Option<Vec<u8>>, _>(idx) {
                Ok(Some(bytes)) => Value::String(format!("0x{}", hex(&bytes))),
                _ => Value::Null,
            }
        }
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
