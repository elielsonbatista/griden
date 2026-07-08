//! Geração de SQL para edição inline (UPDATE/INSERT/DELETE).
//!
//! Os valores são renderizados como literais SQL escapados conforme o dialeto.
//! Aceitável para um cliente desktop onde o usuário edita o próprio banco; uma
//! evolução futura pode migrar para queries parametrizadas.

use crate::error::{AppError, Result};
use crate::models::{DbKind, EditOp, RowEdit};
use serde_json::Value;

fn quote_ident(kind: DbKind, ident: &str) -> String {
    match kind {
        DbKind::Mysql => format!("`{}`", ident.replace('`', "``")),
        DbKind::Mssql => format!("[{}]", ident.replace(']', "]]")),
        _ => format!("\"{}\"", ident.replace('"', "\"\"")),
    }
}

fn qualified(kind: DbKind, schema: &str, table: &str) -> String {
    if kind == DbKind::Sqlite || schema.is_empty() {
        quote_ident(kind, table)
    } else {
        format!("{}.{}", quote_ident(kind, schema), quote_ident(kind, table))
    }
}

fn quote_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Renderiza um valor JSON como literal SQL.
fn lit(kind: DbKind, v: &Value) -> String {
    match v {
        Value::Null => "NULL".to_string(),
        Value::Bool(b) => match kind {
            DbKind::Postgres => if *b { "TRUE" } else { "FALSE" }.to_string(),
            _ => if *b { "1" } else { "0" }.to_string(),
        },
        Value::Number(n) => n.to_string(),
        Value::String(s) => quote_str(s),
        other => quote_str(&other.to_string()),
    }
}

/// Gera o statement SQL para uma edição.
pub fn build_sql(kind: DbKind, edit: &RowEdit) -> Result<String> {
    let qname = qualified(kind, &edit.schema, &edit.table);

    match edit.op {
        EditOp::Update => {
            if edit.values.is_empty() {
                return Err(AppError::InvalidConfig("update sem valores".into()));
            }
            if edit.pk.is_empty() {
                return Err(AppError::InvalidConfig(
                    "update requer chave primária".into(),
                ));
            }
            let set = edit
                .values
                .iter()
                .map(|(c, v)| format!("{} = {}", quote_ident(kind, c), lit(kind, v)))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!(
                "UPDATE {} SET {} WHERE {}",
                qname,
                set,
                where_pk(kind, edit)
            ))
        }
        EditOp::Delete => {
            if edit.pk.is_empty() {
                return Err(AppError::InvalidConfig(
                    "delete requer chave primária".into(),
                ));
            }
            Ok(format!(
                "DELETE FROM {} WHERE {}",
                qname,
                where_pk(kind, edit)
            ))
        }
        EditOp::Insert => {
            if edit.values.is_empty() {
                return Err(AppError::InvalidConfig("insert sem valores".into()));
            }
            let cols = edit
                .values
                .keys()
                .map(|c| quote_ident(kind, c))
                .collect::<Vec<_>>()
                .join(", ");
            let vals = edit
                .values
                .values()
                .map(|v| lit(kind, v))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!(
                "INSERT INTO {} ({}) VALUES ({})",
                qname, cols, vals
            ))
        }
    }
}

fn where_pk(kind: DbKind, edit: &RowEdit) -> String {
    edit.pk
        .iter()
        .map(|(c, v)| {
            if v.is_null() {
                format!("{} IS NULL", quote_ident(kind, c))
            } else {
                format!("{} = {}", quote_ident(kind, c), lit(kind, v))
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[cfg(test)]
mod tests {
    use super::build_sql;
    use crate::drivers::AnyPool;
    use crate::models::{ConnConfig, DbKind, EditOp, RowEdit};
    use std::collections::HashMap;

    fn cfg(path: &str) -> ConnConfig {
        ConnConfig {
            id: "t".into(),
            name: "t".into(),
            kind: DbKind::Sqlite,
            database: Some(path.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn build_update_sql_quotes_and_escapes() {
        let mut pk = HashMap::new();
        pk.insert("id".to_string(), serde_json::json!(1));
        let mut values = HashMap::new();
        values.insert("name".to_string(), serde_json::json!("O'Brien"));
        let edit = RowEdit {
            op: EditOp::Update,
            schema: "main".into(),
            table: "authors".into(),
            pk,
            values,
        };
        let sql = build_sql(DbKind::Sqlite, &edit).unwrap();
        assert!(sql.starts_with("UPDATE \"authors\" SET "));
        assert!(sql.contains("\"name\" = 'O''Brien'"));
        assert!(sql.contains("WHERE \"id\" = 1"));
    }

    #[tokio::test]
    async fn apply_edits_roundtrip_sqlite() {
        // Copia o banco de exemplo para um arquivo temporário gravável.
        let src = concat!(env!("CARGO_MANIFEST_DIR"), "/../.dev/sample.db");
        let dst = concat!(env!("CARGO_MANIFEST_DIR"), "/../.dev/edits_test.db");
        let _ = std::fs::remove_file(dst);
        std::fs::copy(src, dst).expect("copiar db");

        let pool = AnyPool::connect(&cfg(dst), None).await.unwrap();

        // UPDATE
        let mut pk = HashMap::new();
        pk.insert("id".to_string(), serde_json::json!(1));
        let mut values = HashMap::new();
        values.insert("name".to_string(), serde_json::json!("Ada L."));
        let upd = RowEdit {
            op: EditOp::Update,
            schema: "main".into(),
            table: "authors".into(),
            pk: pk.clone(),
            values,
        };
        let n = pool
            .execute_tx(&[build_sql(DbKind::Sqlite, &upd).unwrap()])
            .await
            .unwrap();
        assert_eq!(n, 1);
        let res = pool
            .execute("SELECT name FROM authors WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(res.rows[0][0], serde_json::json!("Ada L."));

        // INSERT
        let mut ins_vals = HashMap::new();
        ins_vals.insert("id".to_string(), serde_json::json!(99));
        ins_vals.insert("name".to_string(), serde_json::json!("New Author"));
        let ins = RowEdit {
            op: EditOp::Insert,
            schema: "main".into(),
            table: "authors".into(),
            pk: HashMap::new(),
            values: ins_vals,
        };
        pool.execute_tx(&[build_sql(DbKind::Sqlite, &ins).unwrap()])
            .await
            .unwrap();

        // DELETE
        let mut del_pk = HashMap::new();
        del_pk.insert("id".to_string(), serde_json::json!(99));
        let del = RowEdit {
            op: EditOp::Delete,
            schema: "main".into(),
            table: "authors".into(),
            pk: del_pk,
            values: HashMap::new(),
        };
        pool.execute_tx(&[build_sql(DbKind::Sqlite, &del).unwrap()])
            .await
            .unwrap();

        let count = pool.execute("SELECT COUNT(*) FROM authors").await.unwrap();
        // 2 originais (update não muda contagem), insert +1, delete -1 => 2
        assert_eq!(count.rows[0][0], serde_json::json!(2));

        pool.close().await;
        let _ = std::fs::remove_file(dst);
    }
}
