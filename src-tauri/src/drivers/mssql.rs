//! Microsoft SQL Server driver via tiberius.
//!
//! tiberius has no native pool; we keep a single `Client` guarded by a
//! `Mutex` (suitable for a desktop client). Queries serialize on one connection.

use crate::error::{AppError, Result};
use crate::models::{ColumnInfo, ConnConfig, QueryResult};
use serde_json::Value;
use std::time::Instant;
use tiberius::{AuthMethod, Client, ColumnType, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

pub type MssqlClient = Client<Compat<TcpStream>>;

pub async fn connect(cfg: &ConnConfig, password: Option<&str>) -> Result<MssqlClient> {
    let mut config = Config::new();
    config.host(cfg.host.as_deref().unwrap_or("localhost"));
    config.port(cfg.port.unwrap_or(1433));
    if let Some(db) = &cfg.database {
        config.database(db);
    }
    config.authentication(AuthMethod::sql_server(
        cfg.username.as_deref().unwrap_or("sa"),
        password.unwrap_or(""),
    ));
    config.encryption(if cfg.ssl {
        EncryptionLevel::Required
    } else {
        EncryptionLevel::NotSupported
    });
    // Trusts self-signed certificates (common in dev/local environments).
    config.trust_cert();

    // The timeout covers an unreachable host; "connection refused" fails immediately.
    let connect = async {
        let tcp = TcpStream::connect(config.get_addr()).await?;
        tcp.set_nodelay(true)?;
        Client::connect(config, tcp.compat_write())
            .await
            .map_err(crate::error::AppError::from)
    };
    match tokio::time::timeout(std::time::Duration::from_secs(10), connect).await {
        Ok(res) => res,
        Err(_) => Err(crate::error::AppError::Database(
            "tempo limite ao conectar ao servidor".into(),
        )),
    }
}

pub async fn execute(client: &mut MssqlClient, sql: &str) -> Result<QueryResult> {
    let started = Instant::now();
    let stream = client.simple_query(sql).await?;
    let rows = stream.into_first_result().await?;
    let elapsed_ms = started.elapsed().as_millis() as u64;

    if rows.is_empty() {
        return Ok(QueryResult::empty(0, elapsed_ms));
    }
    assert_uniform_columns(&rows)?;

    let columns: Vec<ColumnInfo> = rows[0]
        .columns()
        .iter()
        .map(|c| ColumnInfo {
            name: c.name().to_string(),
            type_name: format!("{:?}", c.column_type()),
        })
        .collect();

    let col_types: Vec<ColumnType> = rows[0].columns().iter().map(|c| c.column_type()).collect();

    let data: Vec<Vec<Value>> = rows
        .iter()
        .map(|row| {
            col_types
                .iter()
                .enumerate()
                .map(|(i, ct)| cell_to_json(row, i, *ct))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        rows_affected: data.len() as u64,
        columns,
        rows: data,
        elapsed_ms,
    })
}

/// Verifies every row shares the same column names as `rows[0]`. See the
/// sqlx-backed drivers' `assert_uniform_columns` in `drivers/mod.rs` for why.
fn assert_uniform_columns(rows: &[tiberius::Row]) -> Result<()> {
    let first: Vec<&str> = rows[0].columns().iter().map(|c| c.name()).collect();
    for (i, row) in rows.iter().enumerate().skip(1) {
        let cols: Vec<&str> = row.columns().iter().map(|c| c.name()).collect();
        if cols != first {
            return Err(AppError::Database(format!(
                "resultado inconsistente entre linhas (linha {i} tem colunas {cols:?}, esperado {first:?}) — \
                 isso normalmente indica múltiplas instruções SQL executadas em uma única chamada; \
                 separe os comandos com ';' e execute individualmente."
            )));
        }
    }
    Ok(())
}

fn cell_to_json(row: &tiberius::Row, i: usize, ct: ColumnType) -> Value {
    use ColumnType::*;
    match ct {
        Bit | Bitn => opt_bool(row.try_get::<bool, _>(i), row, i),
        Int1 => opt_num(row.try_get::<u8, _>(i), row, i),
        Int2 => opt_num(row.try_get::<i16, _>(i), row, i),
        Int4 => opt_num(row.try_get::<i32, _>(i), row, i),
        Int8 => opt_num(row.try_get::<i64, _>(i), row, i),
        Intn => int_variable(row, i),
        Float4 => opt_num(row.try_get::<f32, _>(i), row, i),
        Float8 | Floatn => opt_num(row.try_get::<f64, _>(i), row, i),
        Money | Money4 | Decimaln | Numericn => {
            opt_str(row.try_get::<rust_decimal::Decimal, _>(i), row, i)
        }
        Guid => opt_str(row.try_get::<uuid::Uuid, _>(i), row, i),
        Daten => opt_str(row.try_get::<chrono::NaiveDate, _>(i), row, i),
        Timen => opt_str(row.try_get::<chrono::NaiveTime, _>(i), row, i),
        Datetime | Datetime4 | Datetimen | Datetime2 => {
            opt_str(row.try_get::<chrono::NaiveDateTime, _>(i), row, i)
        }
        DatetimeOffsetn => opt_str(row.try_get::<chrono::DateTime<chrono::Utc>, _>(i), row, i),
        BigVarBin | BigBinary | Image => match row.try_get::<&[u8], _>(i) {
            Ok(Some(b)) => Value::String(format!("0x{}", hex(b))),
            Ok(None) => Value::Null,
            Err(e) => decode_fallback(row, i, &e),
        },
        // NVarchar, NChar, BigVarChar, BigChar, Text, NText, Xml, etc.
        _ => match row.try_get::<&str, _>(i) {
            Ok(Some(s)) => Value::String(s.to_string()),
            Ok(None) => Value::Null,
            Err(e) => decode_fallback(row, i, &e),
        },
    }
}

fn int_variable(row: &tiberius::Row, i: usize) -> Value {
    if let Ok(Some(v)) = row.try_get::<i64, _>(i) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<i32, _>(i) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<i16, _>(i) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<u8, _>(i) {
        return Value::from(v);
    }
    Value::Null
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// A value is present but the typed decode above rejected it (e.g. a
/// type-mapping mismatch) — retry as a raw string rather than silently
/// reporting it as NULL, which would be indistinguishable from a real NULL.
fn decode_fallback(row: &tiberius::Row, idx: usize, err: &tiberius::error::Error) -> Value {
    match row.try_get::<&str, _>(idx) {
        Ok(Some(s)) => Value::String(s.to_string()),
        Ok(None) => Value::Null,
        Err(_) => {
            let name = row.columns().get(idx).map(|c| c.name()).unwrap_or("?");
            eprintln!("griden: falha ao decodificar coluna '{name}' (índice {idx}): {err}");
            Value::Null
        }
    }
}

fn opt_bool(
    v: std::result::Result<Option<bool>, tiberius::error::Error>,
    row: &tiberius::Row,
    idx: usize,
) -> Value {
    match v {
        Ok(Some(b)) => Value::Bool(b),
        Ok(None) => Value::Null,
        Err(e) => decode_fallback(row, idx, &e),
    }
}

fn opt_num<T: Into<Value>>(
    v: std::result::Result<Option<T>, tiberius::error::Error>,
    row: &tiberius::Row,
    idx: usize,
) -> Value {
    match v {
        Ok(Some(x)) => x.into(),
        Ok(None) => Value::Null,
        Err(e) => decode_fallback(row, idx, &e),
    }
}

fn opt_str<T: ToString>(
    v: std::result::Result<Option<T>, tiberius::error::Error>,
    row: &tiberius::Row,
    idx: usize,
) -> Value {
    match v {
        Ok(Some(x)) => Value::String(x.to_string()),
        Ok(None) => Value::Null,
        Err(e) => decode_fallback(row, idx, &e),
    }
}
