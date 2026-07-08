//! Camada de drivers de banco.
//!
//! `AnyPool` é a abstração central: um enum sobre os pools de cada backend
//! (sqlx para pg/mysql/sqlite, tiberius para mssql) com dispatch por variante.
//! Toda a decodificação de linhas converte para `serde_json::Value`, deixando o
//! resultado agnóstico de tipos estáticos.

pub mod mssql;
pub mod mysql;
pub mod postgres;
pub mod sqlite;

use crate::error::Result;
use crate::models::{ConnConfig, DbKind, QueryResult};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Pool/conexão viva para uma conexão aberta.
pub enum AnyPool {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
    Mssql(Arc<Mutex<mssql::MssqlClient>>),
}

impl AnyPool {
    /// Abre uma conexão de acordo com o tipo de banco.
    pub async fn connect(cfg: &ConnConfig, password: Option<&str>) -> Result<Self> {
        Ok(match cfg.kind {
            DbKind::Postgres => AnyPool::Postgres(postgres::connect(cfg, password).await?),
            DbKind::Mysql => AnyPool::Mysql(mysql::connect(cfg, password).await?),
            DbKind::Sqlite => AnyPool::Sqlite(sqlite::connect(cfg, password).await?),
            DbKind::Mssql => {
                AnyPool::Mssql(Arc::new(Mutex::new(mssql::connect(cfg, password).await?)))
            }
        })
    }

    pub fn kind(&self) -> DbKind {
        match self {
            AnyPool::Postgres(_) => DbKind::Postgres,
            AnyPool::Mysql(_) => DbKind::Mysql,
            AnyPool::Sqlite(_) => DbKind::Sqlite,
            AnyPool::Mssql(_) => DbKind::Mssql,
        }
    }

    /// Verifica se a conexão está viva.
    pub async fn ping(&self) -> Result<()> {
        match self {
            AnyPool::Postgres(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
            AnyPool::Mysql(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
            AnyPool::Sqlite(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
            AnyPool::Mssql(c) => {
                let mut client = c.lock().await;
                client
                    .simple_query("SELECT 1")
                    .await?
                    .into_first_result()
                    .await?;
            }
        }
        Ok(())
    }

    /// Executa um SQL e retorna o resultado agnóstico. Tenta uma segunda vez se a
    /// primeira falhar por conexão obsoleta (o servidor/túnel fechou a conexão
    /// ociosa do pool); o pool descarta a morta e abre uma nova.
    pub async fn execute(&self, sql: &str) -> Result<QueryResult> {
        match self.execute_once(sql).await {
            Err(e) if is_connection_error(&e) => self.execute_once(sql).await,
            other => other,
        }
    }

    async fn execute_once(&self, sql: &str) -> Result<QueryResult> {
        match self {
            AnyPool::Postgres(p) => postgres::execute(p, sql).await,
            AnyPool::Mysql(p) => mysql::execute(p, sql).await,
            AnyPool::Sqlite(p) => sqlite::execute(p, sql).await,
            AnyPool::Mssql(c) => {
                let mut client = c.lock().await;
                mssql::execute(&mut client, sql).await
            }
        }
    }

    /// Executa vários statements numa transação, retornando o total de linhas
    /// afetadas. Faz rollback se qualquer statement falhar. Re-tenta uma vez em
    /// caso de conexão obsoleta — seguro porque, se a conexão caiu, a transação
    /// não chegou a ser commitada (nada foi aplicado).
    pub async fn execute_tx(&self, statements: &[String]) -> Result<u64> {
        match self.execute_tx_once(statements).await {
            Err(e) if is_connection_error(&e) => self.execute_tx_once(statements).await,
            other => other,
        }
    }

    async fn execute_tx_once(&self, statements: &[String]) -> Result<u64> {
        match self {
            AnyPool::Postgres(p) => {
                let mut tx = p.begin().await?;
                let mut total = 0u64;
                for s in statements {
                    total += sqlx::query(s).execute(&mut *tx).await?.rows_affected();
                }
                tx.commit().await?;
                Ok(total)
            }
            AnyPool::Mysql(p) => {
                let mut tx = p.begin().await?;
                let mut total = 0u64;
                for s in statements {
                    total += sqlx::query(s).execute(&mut *tx).await?.rows_affected();
                }
                tx.commit().await?;
                Ok(total)
            }
            AnyPool::Sqlite(p) => {
                let mut tx = p.begin().await?;
                let mut total = 0u64;
                for s in statements {
                    total += sqlx::query(s).execute(&mut *tx).await?.rows_affected();
                }
                tx.commit().await?;
                Ok(total)
            }
            AnyPool::Mssql(c) => {
                let mut client = c.lock().await;
                client.execute("BEGIN TRANSACTION", &[]).await?;
                let mut total = 0u64;
                for s in statements {
                    match client.execute(s.as_str(), &[]).await {
                        Ok(res) => total += res.rows_affected().iter().sum::<u64>(),
                        Err(e) => {
                            let _ = client.execute("ROLLBACK", &[]).await;
                            return Err(e.into());
                        }
                    }
                }
                client.execute("COMMIT", &[]).await?;
                Ok(total)
            }
        }
    }

    /// Fecha a conexão liberando recursos.
    pub async fn close(&self) {
        match self {
            AnyPool::Postgres(p) => p.close().await,
            AnyPool::Mysql(p) => p.close().await,
            AnyPool::Sqlite(p) => p.close().await,
            AnyPool::Mssql(_) => { /* tiberius fecha no drop */ }
        }
    }
}

/// Heurística: o erro indica que a conexão foi fechada/quebrada (conexão obsoleta
/// no pool, túnel SSH derrubado, etc.)? Nesses casos vale uma nova tentativa.
/// O sqlx embrulha esses casos como `Error::Io` ("error communicating with database").
fn is_connection_error(e: &crate::error::AppError) -> bool {
    use crate::error::AppError;
    let AppError::Database(m) = e else {
        return false;
    };
    let m = m.to_ascii_lowercase();
    m.contains("error communicating with database")
        || m.contains("expected to read")
        || m.contains("unexpected end of file")
        || m.contains("eof")
        || m.contains("connection reset")
        || m.contains("broken pipe")
        || m.contains("connection closed")
        || m.contains("closed the connection")
}
