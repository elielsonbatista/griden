pub mod mssql;
pub mod mysql;
pub mod postgres;
pub mod sqlite;

use crate::error::{AppError, Result};
use crate::models::{ConnConfig, DbKind, QueryResult};
use std::sync::Arc;
use tokio::sync::Mutex;

pub enum AnyPool {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
    Mssql(Arc<Mutex<mssql::MssqlClient>>),
}

impl AnyPool {
    /// `max_connections` is ignored for mssql, which has no pool.
    pub async fn connect(
        cfg: &ConnConfig,
        password: Option<&str>,
        max_connections: u32,
    ) -> Result<Self> {
        Ok(match cfg.kind {
            DbKind::Postgres => {
                AnyPool::Postgres(postgres::connect(cfg, password, max_connections).await?)
            }
            DbKind::Mysql => AnyPool::Mysql(mysql::connect(cfg, password, max_connections).await?),
            DbKind::Sqlite => {
                AnyPool::Sqlite(sqlite::connect(cfg, password, max_connections).await?)
            }
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

    /// Retries once on a stale pooled connection (closed idle by the server or tunnel);
    /// the pool discards it and opens a fresh one.
    pub async fn execute(&self, sql: &str) -> Result<QueryResult> {
        match self.execute_once(sql).await {
            Err(e) if e.is_connection_lost() => self.execute_once(sql).await,
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

    /// The retry on a stale connection is safe: a transaction that died before
    /// commit applied nothing.
    pub async fn execute_tx(&self, statements: &[String]) -> Result<u64> {
        match self.execute_tx_once(statements).await {
            Err(e) if e.is_connection_lost() => self.execute_tx_once(statements).await,
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

    /// `None` for sqlite or when the lookup fails, which disables cancellation.
    pub async fn session_id(&self) -> Option<i64> {
        match self {
            AnyPool::Postgres(p) => sqlx::query_scalar::<_, i32>("SELECT pg_backend_pid()")
                .fetch_one(p)
                .await
                .ok()
                .map(i64::from),
            // CONNECTION_ID() is BIGINT UNSIGNED; decoding straight into i64
            // mismatches sqlx's MySQL type check and fails silently via `.ok()`.
            AnyPool::Mysql(p) => sqlx::query_scalar::<_, u64>("SELECT connection_id()")
                .fetch_one(p)
                .await
                .ok()
                .map(|id| id as i64),
            AnyPool::Sqlite(_) => None,
            AnyPool::Mssql(c) => {
                let mut client = c.lock().await;
                let rows = client
                    .simple_query("SELECT @@SPID")
                    .await
                    .ok()?
                    .into_first_result()
                    .await
                    .ok()?;
                rows.first()
                    .and_then(|r| r.try_get::<i16, _>(0).ok().flatten())
                    .map(i64::from)
            }
        }
    }

    /// Must run on a different connection than the one being cancelled, which is
    /// busy running the statement.
    pub async fn cancel_session(&self, session_id: i64) -> Result<()> {
        match self {
            AnyPool::Postgres(p) => {
                sqlx::query("SELECT pg_cancel_backend($1)")
                    .bind(session_id as i32)
                    .execute(p)
                    .await?;
            }
            AnyPool::Mysql(p) => {
                // KILL doesn't support bind parameters; session_id is ours (from
                // connection_id()), never user input, so interpolation is safe.
                sqlx::query(&format!("KILL QUERY {session_id}"))
                    .execute(p)
                    .await?;
            }
            AnyPool::Sqlite(_) => {
                return Err(AppError::Other(
                    "cancelamento não é suportado para SQLite".into(),
                ));
            }
            AnyPool::Mssql(c) => {
                let mut client = c.lock().await;
                // No statement-only cancel: KILL ends the session, and
                // `with_reconnect_exec` reopens it.
                client.simple_query(format!("KILL {session_id}")).await?;
            }
        }
        Ok(())
    }

    pub async fn close(&self) {
        match self {
            AnyPool::Postgres(p) => p.close().await,
            AnyPool::Mysql(p) => p.close().await,
            AnyPool::Sqlite(p) => p.close().await,
            // tiberius closes the client on drop.
            AnyPool::Mssql(_) => {}
        }
    }
}
