//! Connection management: persisting configs (JSON), secrets in the OS
//! keychain, an optional SSH tunnel, and a registry of live connections.

use crate::drivers::AnyPool;
use crate::error::{AppError, Result};
use crate::models::{ConnConfig, ConnInput, DbKind, SshAuthKind};
use crate::tunnel::{self, SshAuth, SshParams, SshTunnel};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

const KEYRING_SERVICE: &str = "dev.griden.app";

/// A live connection: the driver pool and, if any, the SSH tunnel backing it.
/// The tunnel is torn down when the connection is removed (Drop).
struct LiveConnection {
    pool: Arc<AnyPool>,
    /// Single-connection pool dedicated to query execution (run/apply_edits).
    /// Ensures statements run in sequence (e.g. Run all, or two separate
    /// executions in the same tab) share the same database session —
    /// required for temporary tables, session variables, etc., which are
    /// scoped to the physical connection and would be lost if a random one
    /// from the pool were picked.
    exec_pool: Arc<AnyPool>,
    _tunnel: Option<SshTunnel>,
}

/// State managed by Tauri.
pub struct ConnectionManager {
    config_path: PathBuf,
    pools: Mutex<HashMap<String, LiveConnection>>,
}

impl ConnectionManager {
    /// Creates the manager pointing at `<config_dir>/connections.json`.
    pub fn new(config_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&config_dir)?;
        Ok(Self {
            config_path: config_dir.join("connections.json"),
            pools: Mutex::new(HashMap::new()),
        })
    }

    // ---- Config persistence ----

    pub fn list_configs(&self) -> Result<Vec<ConnConfig>> {
        if !self.config_path.exists() {
            return Ok(Vec::new());
        }
        let data = std::fs::read_to_string(&self.config_path)?;
        if data.trim().is_empty() {
            return Ok(Vec::new());
        }
        Ok(serde_json::from_str(&data)?)
    }

    fn write_configs(&self, configs: &[ConnConfig]) -> Result<()> {
        let data = serde_json::to_string_pretty(configs)?;
        std::fs::write(&self.config_path, data)?;
        Ok(())
    }

    pub fn get_config(&self, id: &str) -> Result<ConnConfig> {
        self.list_configs()?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::ConnectionNotFound(id.to_string()))
    }

    /// Creates or updates a connection. Passwords (database and SSH) go to the
    /// keychain and are never written to the config file.
    pub fn save_config(&self, input: ConnInput) -> Result<ConnConfig> {
        let mut configs = self.list_configs()?;
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let config = config_from_input(&id, &input);

        if let Some(pw) = input.password.as_deref() {
            if !pw.is_empty() {
                set_secret(&id, pw)?;
            }
        }
        if let Some(pw) = input.ssh_password.as_deref() {
            if !pw.is_empty() {
                set_secret(&ssh_pw_account(&id), pw)?;
            }
        }
        if let Some(pp) = input.ssh_passphrase.as_deref() {
            if !pp.is_empty() {
                set_secret(&ssh_pass_account(&id), pp)?;
            }
        }

        match configs.iter_mut().find(|c| c.id == id) {
            Some(existing) => *existing = config.clone(),
            None => configs.push(config.clone()),
        }
        self.write_configs(&configs)?;
        Ok(config)
    }

    pub async fn delete_config(&self, id: &str) -> Result<()> {
        self.disconnect(id).await;
        let configs: Vec<ConnConfig> = self
            .list_configs()?
            .into_iter()
            .filter(|c| c.id != id)
            .collect();
        self.write_configs(&configs)?;
        let _ = delete_secret(id);
        let _ = delete_secret(&ssh_pw_account(id));
        let _ = delete_secret(&ssh_pass_account(id));
        Ok(())
    }

    // ---- Live connections ----

    /// Opens (or reopens) the connection: a shared pool (introspection) and a
    /// single-connection pool dedicated to query execution, both over the
    /// same SSH tunnel when present.
    pub async fn connect(&self, id: &str) -> Result<()> {
        let config = self.get_config(id)?;
        let db_password = get_secret(id)?;
        let (ssh_password, ssh_passphrase) = if config.ssh_enabled {
            (
                get_secret(&ssh_pw_account(id))?,
                get_secret(&ssh_pass_account(id))?,
            )
        } else {
            (None, None)
        };

        let (target, tunnel) = resolve_target(&config, ssh_password, ssh_passphrase).await?;

        let pool = AnyPool::connect(
            &target,
            db_password.as_deref(),
            shared_pool_size(config.kind),
        )
        .await?;
        pool.ping().await?;

        let exec_pool = AnyPool::connect(&target, db_password.as_deref(), EXEC_POOL_SIZE).await?;
        exec_pool.ping().await?;

        self.pools.lock().await.insert(
            id.to_string(),
            LiveConnection {
                pool: Arc::new(pool),
                exec_pool: Arc::new(exec_pool),
                _tunnel: tunnel,
            },
        );
        Ok(())
    }

    // Full reopen, not just a pool retry: a dead SSH tunnel or MSSQL's single client won't self-heal.
    pub async fn reconnect(&self, id: &str) -> Result<()> {
        self.disconnect(id).await;
        self.connect(id).await
    }

    pub async fn get_pool(&self, id: &str) -> Result<Arc<AnyPool>> {
        self.pools
            .lock()
            .await
            .get(id)
            .map(|c| c.pool.clone())
            .ok_or_else(|| AppError::NotConnected(id.to_string()))
    }

    pub async fn get_exec_pool(&self, id: &str) -> Result<Arc<AnyPool>> {
        self.pools
            .lock()
            .await
            .get(id)
            .map(|c| c.exec_pool.clone())
            .ok_or_else(|| AppError::NotConnected(id.to_string()))
    }

    pub async fn disconnect(&self, id: &str) {
        if let Some(conn) = self.pools.lock().await.remove(id) {
            conn.pool.close().await;
            conn.exec_pool.close().await;
            // _tunnel is torn down on Drop when it goes out of scope.
        }
    }

    pub async fn is_connected(&self, id: &str) -> bool {
        self.pools.lock().await.contains_key(id)
    }

    /// Tests a config without persisting it: connects, pings, and closes.
    pub async fn test(&self, input: &ConnInput) -> Result<()> {
        let id = input.id.clone().unwrap_or_default();
        let config = config_from_input(&id, input);

        let db_password = resolve_secret(&input.password, input.id.as_deref(), |i| i.to_string());
        let ssh_password = resolve_secret(&input.ssh_password, input.id.as_deref(), ssh_pw_account);
        let ssh_passphrase =
            resolve_secret(&input.ssh_passphrase, input.id.as_deref(), ssh_pass_account);

        let (pool, _tunnel) = open_pool(
            &config,
            db_password.as_deref(),
            ssh_password,
            ssh_passphrase,
        )
        .await?;
        pool.close().await;
        Ok(())
    }
}

/// Builds the persistable `ConnConfig` from the input (without secrets).
fn config_from_input(id: &str, input: &ConnInput) -> ConnConfig {
    ConnConfig {
        id: id.to_string(),
        name: input.name.clone(),
        kind: input.kind,
        host: input.host.clone(),
        port: input.port,
        database: input.database.clone(),
        username: input.username.clone(),
        ssl: input.ssl,
        ssh_enabled: input.ssh_enabled,
        ssh_host: input.ssh_host.clone(),
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user.clone(),
        ssh_auth: input.ssh_auth,
        ssh_key_path: input.ssh_key_path.clone(),
    }
}

/// Opens the (shared) pool, setting up an SSH tunnel first when enabled
/// (except sqlite). Used only by `test()`, which needs no dedicated pool.
async fn open_pool(
    config: &ConnConfig,
    db_password: Option<&str>,
    ssh_password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<(Arc<AnyPool>, Option<SshTunnel>)> {
    let (target, tunnel) = resolve_target(config, ssh_password, ssh_passphrase).await?;
    let pool = AnyPool::connect(&target, db_password, shared_pool_size(config.kind)).await?;
    pool.ping().await?;
    Ok((Arc::new(pool), tunnel))
}

/// Resolves the connection target, opening an SSH tunnel when enabled (except
/// sqlite) and repointing the config at the tunnel's local listener.
async fn resolve_target(
    config: &ConnConfig,
    ssh_password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<(ConnConfig, Option<SshTunnel>)> {
    if config.ssh_enabled && config.kind != DbKind::Sqlite {
        let target_host = config.host.clone().unwrap_or_else(|| "localhost".into());
        let target_port = config.port.unwrap_or_else(|| default_port(config.kind));
        let params = ssh_params(config, ssh_password, ssh_passphrase)?;
        let tunnel = tunnel::open(&params, &target_host, target_port).await?;

        let mut local = config.clone();
        local.host = Some("127.0.0.1".into());
        local.port = Some(tunnel.local_port());
        Ok((local, Some(tunnel)))
    } else {
        Ok((config.clone(), None))
    }
}

fn shared_pool_size(kind: DbKind) -> u32 {
    match kind {
        DbKind::Sqlite => 5,
        DbKind::Postgres | DbKind::Mysql | DbKind::Mssql => 10,
    }
}

const EXEC_POOL_SIZE: u32 = 1;

fn ssh_params(
    config: &ConnConfig,
    ssh_password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<SshParams> {
    let host = config
        .ssh_host
        .clone()
        .ok_or_else(|| AppError::InvalidConfig("host SSH ausente".into()))?;
    let user = config
        .ssh_user
        .clone()
        .ok_or_else(|| AppError::InvalidConfig("usuário SSH ausente".into()))?;
    let auth = match config.ssh_auth {
        SshAuthKind::Password => SshAuth::Password(ssh_password.unwrap_or_default()),
        SshAuthKind::Key => SshAuth::Key {
            path: config
                .ssh_key_path
                .clone()
                .ok_or_else(|| AppError::InvalidConfig("caminho da chave SSH ausente".into()))?,
            passphrase: ssh_passphrase,
        },
    };
    Ok(SshParams {
        host,
        port: config.ssh_port.unwrap_or(22),
        user,
        auth,
    })
}

fn default_port(kind: DbKind) -> u16 {
    match kind {
        DbKind::Postgres => 5432,
        DbKind::Mysql => 3306,
        DbKind::Mssql => 1433,
        DbKind::Sqlite => 0,
    }
}

// ---- Keychain (secrets) ----

fn ssh_pw_account(id: &str) -> String {
    format!("{id}#ssh-password")
}

fn ssh_pass_account(id: &str) -> String {
    format!("{id}#ssh-passphrase")
}

/// Uses the provided value (if non-empty) or looks it up in the keychain by the account derived from the id.
fn resolve_secret(
    provided: &Option<String>,
    id: Option<&str>,
    account: impl Fn(&str) -> String,
) -> Option<String> {
    match provided {
        Some(p) if !p.is_empty() => Some(p.clone()),
        _ => id.and_then(|i| get_secret(&account(i)).ok().flatten()),
    }
}

fn entry(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, account).map_err(AppError::from)
}

fn set_secret(account: &str, password: &str) -> Result<()> {
    entry(account)?
        .set_password(password)
        .map_err(AppError::from)
}

fn get_secret(account: &str) -> Result<Option<String>> {
    match entry(account)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
}

fn delete_secret(account: &str) -> Result<()> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::from(e)),
    }
}
