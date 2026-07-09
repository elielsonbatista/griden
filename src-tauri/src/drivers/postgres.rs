//! Driver PostgreSQL via sqlx.

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
    // SSL marcado => exige TLS (sem verificar hostname, ok via túnel).
    // SSL desmarcado => desliga TLS de fato (não apenas "prefer"), evitando
    // HandshakeFailure quando se conecta em texto puro (ex.: por túnel SSH).
    opts = opts.ssl_mode(if cfg.ssl {
        sqlx::postgres::PgSslMode::Require
    } else {
        sqlx::postgres::PgSslMode::Disable
    });

    // Sondagem: uma única conexão que falha rápido em "connection refused".
    // (O pool, sozinho, re-tentaria até o acquire_timeout — daí o loading longo.)
    // O timeout cobre o caso de host inalcançável (SYN sem resposta).
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

    // Pool preguiçoso: conexões são criadas sob demanda (servidor já validado).
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(1)
        // Evita um round-trip de validação a cada query (custoso via túnel SSH).
        // Em troca, recicla conexões para reduzir conexões obsoletas; um retry
        // automático (AnyPool::execute) cobre as que ainda escaparem.
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
        // TEXT, VARCHAR, BPCHAR, NAME, e desconhecidos: tenta string.
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
