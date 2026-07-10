//! Per-dialect schema introspection. Built on top of `AnyPool::execute`,
//! reusing the dynamic row decoding. The meta-queries take schema/table names
//! as literals; they are escaped via `quote` to prevent injection.

use crate::drivers::AnyPool;
use crate::error::Result;
use crate::models::{
    ColumnMeta, DbKind, ForeignKey, SchemaInfo, TableColumns, TableInfo, TableKind,
};
use serde_json::Value;
use std::collections::HashMap;

/// Escapes a SQL string literal by doubling single quotes.
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn cell_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn cell_i64(v: &Value) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().unwrap_or(0),
        Value::String(s) => s.parse().unwrap_or(0),
        Value::Bool(b) => *b as i64,
        _ => 0,
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().map(|x| x != 0).unwrap_or(false),
        Value::String(s) => {
            let s = s.trim().to_ascii_uppercase();
            s == "1" || s == "YES" || s == "TRUE" || s == "Y"
        }
        _ => false,
    }
}

pub async fn list_schemas(pool: &AnyPool) -> Result<Vec<SchemaInfo>> {
    if pool.kind() == DbKind::Sqlite {
        return Ok(vec![SchemaInfo {
            name: "main".into(),
        }]);
    }
    let sql = match pool.kind() {
        DbKind::Postgres => {
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('pg_catalog','pg_toast','information_schema') \
             AND schema_name NOT LIKE 'pg_temp_%' AND schema_name NOT LIKE 'pg_toast_temp_%' \
             ORDER BY schema_name"
        }
        DbKind::Mysql => {
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys') \
             ORDER BY schema_name"
        }
        DbKind::Mssql => {
            "SELECT name FROM sys.schemas \
             WHERE name NOT IN ('sys','INFORMATION_SCHEMA','guest','db_owner','db_accessadmin', \
             'db_securityadmin','db_ddladmin','db_backupoperator','db_datareader','db_datawriter', \
             'db_denydatareader','db_denydatawriter') ORDER BY name"
        }
        DbKind::Sqlite => unreachable!(),
    };
    let res = pool.execute(sql).await?;
    Ok(res
        .rows
        .iter()
        .filter_map(|r| cell_str(&r[0]))
        .map(|name| SchemaInfo { name })
        .collect())
}

pub async fn list_tables(pool: &AnyPool, schema: &str) -> Result<Vec<TableInfo>> {
    let sql = match pool.kind() {
        DbKind::Sqlite => "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
            .to_string(),
        DbKind::Postgres | DbKind::Mysql => format!(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = {} ORDER BY table_name",
            quote(schema)
        ),
        DbKind::Mssql => format!(
            "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES \
             WHERE TABLE_SCHEMA = {} ORDER BY TABLE_NAME",
            quote(schema)
        ),
    };
    let res = pool.execute(&sql).await?;
    Ok(res
        .rows
        .iter()
        .filter_map(|r| {
            let name = cell_str(&r[0])?;
            let raw = cell_str(r.get(1).unwrap_or(&Value::Null)).unwrap_or_default();
            let kind = if raw.to_ascii_uppercase().contains("VIEW") {
                TableKind::View
            } else {
                TableKind::Table
            };
            Some(TableInfo {
                schema: schema.to_string(),
                name,
                kind,
            })
        })
        .collect())
}

pub async fn list_columns(pool: &AnyPool, schema: &str, table: &str) -> Result<Vec<ColumnMeta>> {
    match pool.kind() {
        DbKind::Sqlite => list_columns_sqlite(pool, table).await,
        DbKind::Postgres => list_columns_pg(pool, schema, table).await,
        DbKind::Mysql => list_columns_mysql(pool, schema, table).await,
        DbKind::Mssql => list_columns_mssql(pool, schema, table).await,
    }
}

async fn list_columns_sqlite(pool: &AnyPool, table: &str) -> Result<Vec<ColumnMeta>> {
    // PRAGMA does not accept a placeholder; the name is quoted as a literal.
    let sql = format!("PRAGMA table_info({})", quote(table));
    let res = pool.execute(&sql).await?;
    // columns: cid, name, type, notnull, dflt_value, pk
    Ok(res
        .rows
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            let name = cell_str(&r[1])?;
            Some(ColumnMeta {
                name,
                data_type: cell_str(&r[2]).unwrap_or_default(),
                nullable: cell_i64(&r[3]) == 0,
                is_primary_key: cell_i64(&r[5]) > 0,
                default: cell_str(&r[4]),
                ordinal: i as i32,
            })
        })
        .collect())
}

/// Rows in the format: name, data_type, is_nullable, default, ordinal, is_pk.
fn rows_to_columns(res: &crate::models::QueryResult) -> Vec<ColumnMeta> {
    res.rows
        .iter()
        .filter_map(|r| {
            let name = cell_str(&r[0])?;
            Some(ColumnMeta {
                name,
                data_type: cell_str(&r[1]).unwrap_or_default(),
                nullable: truthy(&r[2]),
                default: cell_str(&r[3]),
                ordinal: cell_i64(&r[4]) as i32,
                is_primary_key: truthy(&r[5]),
            })
        })
        .collect()
}

async fn list_columns_pg(pool: &AnyPool, schema: &str, table: &str) -> Result<Vec<ColumnMeta>> {
    let sql = format!(
        "SELECT c.column_name, c.data_type, \
           CASE WHEN c.is_nullable = 'YES' THEN 1 ELSE 0 END AS nullable, \
           c.column_default, c.ordinal_position, \
           CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_pk \
         FROM information_schema.columns c \
         LEFT JOIN ( \
           SELECT kcu.column_name FROM information_schema.table_constraints tc \
           JOIN information_schema.key_column_usage kcu \
             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = {s} AND tc.table_name = {t} \
         ) pk ON pk.column_name = c.column_name \
         WHERE c.table_schema = {s} AND c.table_name = {t} \
         ORDER BY c.ordinal_position",
        s = quote(schema),
        t = quote(table)
    );
    let res = pool.execute(&sql).await?;
    Ok(rows_to_columns(&res))
}

async fn list_columns_mysql(pool: &AnyPool, schema: &str, table: &str) -> Result<Vec<ColumnMeta>> {
    let sql = format!(
        "SELECT column_name, data_type, \
           CASE WHEN is_nullable = 'YES' THEN 1 ELSE 0 END AS nullable, \
           column_default, ordinal_position, \
           CASE WHEN column_key = 'PRI' THEN 1 ELSE 0 END AS is_pk \
         FROM information_schema.columns \
         WHERE table_schema = {s} AND table_name = {t} \
         ORDER BY ordinal_position",
        s = quote(schema),
        t = quote(table)
    );
    let res = pool.execute(&sql).await?;
    Ok(rows_to_columns(&res))
}

async fn list_columns_mssql(pool: &AnyPool, schema: &str, table: &str) -> Result<Vec<ColumnMeta>> {
    let sql = format!(
        "SELECT c.COLUMN_NAME, c.DATA_TYPE, \
           CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable, \
           c.COLUMN_DEFAULT, c.ORDINAL_POSITION, \
           CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk \
         FROM INFORMATION_SCHEMA.COLUMNS c \
         LEFT JOIN ( \
           SELECT ku.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME \
           WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = {s} AND tc.TABLE_NAME = {t} \
         ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME \
         WHERE c.TABLE_SCHEMA = {s} AND c.TABLE_NAME = {t} \
         ORDER BY c.ORDINAL_POSITION",
        s = quote(schema),
        t = quote(table)
    );
    let res = pool.execute(&sql).await?;
    Ok(rows_to_columns(&res))
}

// ----- All columns of the schema in a single query (ERD) -----

/// Loads the columns of ALL tables in the schema at once. Avoids the N+1
/// (one query per table) that exhausts the pool on large schemas.
pub async fn list_all_columns(pool: &AnyPool, schema: &str) -> Result<Vec<TableColumns>> {
    if pool.kind() == DbKind::Sqlite {
        // SQLite has no information_schema; uses PRAGMA per table (local and fast).
        let tables = list_tables(pool, "main").await?;
        let mut out = Vec::with_capacity(tables.len());
        for t in tables {
            let columns = list_columns_sqlite(pool, &t.name).await?;
            out.push(TableColumns {
                table: t.name,
                columns,
            });
        }
        return Ok(out);
    }

    let sql = match pool.kind() {
        DbKind::Postgres => format!(
            "SELECT c.table_name, c.column_name, c.data_type, \
               CASE WHEN c.is_nullable = 'YES' THEN 1 ELSE 0 END, \
               c.column_default, c.ordinal_position, \
               CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END \
             FROM information_schema.columns c \
             LEFT JOIN ( \
               SELECT kcu.table_name, kcu.column_name \
               FROM information_schema.table_constraints tc \
               JOIN information_schema.key_column_usage kcu \
                 ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
               WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = {s} \
             ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name \
             WHERE c.table_schema = {s} \
             ORDER BY c.table_name, c.ordinal_position",
            s = quote(schema)
        ),
        DbKind::Mysql => format!(
            "SELECT table_name, column_name, data_type, \
               CASE WHEN is_nullable = 'YES' THEN 1 ELSE 0 END, \
               column_default, ordinal_position, \
               CASE WHEN column_key = 'PRI' THEN 1 ELSE 0 END \
             FROM information_schema.columns \
             WHERE table_schema = {s} \
             ORDER BY table_name, ordinal_position",
            s = quote(schema)
        ),
        DbKind::Mssql => format!(
            "SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, \
               CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END, \
               c.COLUMN_DEFAULT, c.ORDINAL_POSITION, \
               CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END \
             FROM INFORMATION_SCHEMA.COLUMNS c \
             LEFT JOIN ( \
               SELECT ku.TABLE_NAME, ku.COLUMN_NAME \
               FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
               JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME \
               WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = {s} \
             ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME \
             WHERE c.TABLE_SCHEMA = {s} \
             ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION",
            s = quote(schema)
        ),
        DbKind::Sqlite => unreachable!(),
    };

    let res = pool.execute(&sql).await?;
    // Rows: table_name, column_name, data_type, nullable, default, ordinal, is_pk.
    let mut order: Vec<String> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<TableColumns> = Vec::new();

    for r in &res.rows {
        let table = match cell_str(&r[0]) {
            Some(t) => t,
            None => continue,
        };
        let name = match cell_str(&r[1]) {
            Some(n) => n,
            None => continue,
        };
        let idx = *index.entry(table.clone()).or_insert_with(|| {
            order.push(table.clone());
            out.push(TableColumns {
                table: table.clone(),
                columns: Vec::new(),
            });
            out.len() - 1
        });
        out[idx].columns.push(ColumnMeta {
            name,
            data_type: cell_str(&r[2]).unwrap_or_default(),
            nullable: truthy(&r[3]),
            default: cell_str(&r[4]),
            ordinal: cell_i64(&r[5]) as i32,
            is_primary_key: truthy(&r[6]),
        });
    }
    Ok(out)
}

// ----- Foreign keys (ERD) -----

pub async fn list_foreign_keys(pool: &AnyPool, schema: &str) -> Result<Vec<ForeignKey>> {
    if pool.kind() == DbKind::Sqlite {
        return list_foreign_keys_sqlite(pool).await;
    }
    let sql = match pool.kind() {
        DbKind::Postgres => format!(
            "SELECT tc.constraint_name, tc.table_schema, tc.table_name, kcu.column_name, \
               ccu.table_schema, ccu.table_name, ccu.column_name \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
               ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema \
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = {s} \
             ORDER BY tc.constraint_name, kcu.ordinal_position",
            s = quote(schema)
        ),
        DbKind::Mysql => format!(
            "SELECT constraint_name, table_schema, table_name, column_name, \
               referenced_table_schema, referenced_table_name, referenced_column_name \
             FROM information_schema.key_column_usage \
             WHERE referenced_table_name IS NOT NULL AND table_schema = {s} \
             ORDER BY constraint_name, ordinal_position",
            s = quote(schema)
        ),
        DbKind::Mssql => format!(
            "SELECT fk.name, sch.name, t.name, c.name, rsch.name, rt.name, rc.name \
             FROM sys.foreign_keys fk \
             JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id \
             JOIN sys.tables t ON t.object_id = fk.parent_object_id \
             JOIN sys.schemas sch ON sch.schema_id = t.schema_id \
             JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = fkc.parent_column_id \
             JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id \
             JOIN sys.schemas rsch ON rsch.schema_id = rt.schema_id \
             JOIN sys.columns rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id \
             WHERE sch.name = {s} ORDER BY fk.name, fkc.constraint_column_id",
            s = quote(schema)
        ),
        DbKind::Sqlite => unreachable!(),
    };
    let res = pool.execute(&sql).await?;
    Ok(group_fks(&res))
}

/// Groups rows [name, from_schema, from_table, from_col, to_schema, to_table, to_col]
/// by constraint_name, preserving the column order.
fn group_fks(res: &crate::models::QueryResult) -> Vec<ForeignKey> {
    let mut order: Vec<String> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut fks: Vec<ForeignKey> = Vec::new();

    for r in &res.rows {
        let get = |i: usize| cell_str(r.get(i).unwrap_or(&Value::Null)).unwrap_or_default();
        let name = get(0);
        let key = format!("{}|{}", name, get(2));
        let idx = *index.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            fks.push(ForeignKey {
                name: name.clone(),
                from_schema: get(1),
                from_table: get(2),
                from_columns: Vec::new(),
                to_schema: get(4),
                to_table: get(5),
                to_columns: Vec::new(),
            });
            fks.len() - 1
        });
        fks[idx].from_columns.push(get(3));
        fks[idx].to_columns.push(get(6));
    }
    fks
}

async fn list_foreign_keys_sqlite(pool: &AnyPool) -> Result<Vec<ForeignKey>> {
    let tables = list_tables(pool, "main").await?;
    let mut fks = Vec::new();
    for t in tables.iter().filter(|t| t.kind == TableKind::Table) {
        let sql = format!("PRAGMA foreign_key_list({})", quote(&t.name));
        let res = pool.execute(&sql).await?;
        // columns: id, seq, table, from, to, on_update, on_delete, match
        let mut by_id: HashMap<i64, usize> = HashMap::new();
        let mut local: Vec<ForeignKey> = Vec::new();
        for r in &res.rows {
            let id = cell_i64(&r[0]);
            let to_table = cell_str(&r[2]).unwrap_or_default();
            let from_col = cell_str(&r[3]).unwrap_or_default();
            let to_col = cell_str(&r[4]).unwrap_or_default();
            let idx = *by_id.entry(id).or_insert_with(|| {
                local.push(ForeignKey {
                    name: format!("{}_fk_{}", t.name, id),
                    from_schema: "main".into(),
                    from_table: t.name.clone(),
                    from_columns: Vec::new(),
                    to_schema: "main".into(),
                    to_table,
                    to_columns: Vec::new(),
                });
                local.len() - 1
            });
            local[idx].from_columns.push(from_col);
            local[idx].to_columns.push(to_col);
        }
        fks.extend(local);
    }
    Ok(fks)
}
