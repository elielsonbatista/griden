//! Túnel SSH para conexões de banco (port-forwarding local).
//!
//! Estabelece uma sessão SSH, abre um listener em `127.0.0.1:<porta efêmera>` e,
//! para cada conexão recebida, abre um canal `direct-tcpip` até o host/porta do
//! banco, copiando os bytes nos dois sentidos. O driver do banco conecta no
//! listener local sem saber do túnel.

use crate::error::{AppError, Result};
use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use std::sync::Arc;
use tokio::net::TcpListener;

/// Método de autenticação SSH.
pub enum SshAuth {
    Password(String),
    Key {
        path: String,
        passphrase: Option<String>,
    },
}

/// Parâmetros resolvidos para abrir o túnel (segredos já recuperados do keychain).
pub struct SshParams {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
}

/// Handler do cliente SSH. Aceita a chave do servidor (MVP — sem verificação de
/// known_hosts; uma evolução futura pode validar o fingerprint).
struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Túnel ativo. Ao ser destruído, encerra o loop de forwarding e a sessão SSH.
pub struct SshTunnel {
    local_port: u16,
    task: tokio::task::JoinHandle<()>,
}

impl SshTunnel {
    pub fn local_port(&self) -> u16 {
        self.local_port
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Abre o túnel até `target_host:target_port` através do servidor SSH.
pub async fn open(p: &SshParams, target_host: &str, target_port: u16) -> Result<SshTunnel> {
    let config = Arc::new(client::Config::default());
    // Timeout para não travar quando o servidor SSH está inalcançável.
    let connect = client::connect(config, (p.host.as_str(), p.port), Client);
    let mut session = match tokio::time::timeout(std::time::Duration::from_secs(10), connect).await
    {
        Ok(res) => res?,
        Err(_) => {
            return Err(AppError::Ssh(
                "tempo limite ao conectar ao servidor SSH".into(),
            ))
        }
    };

    let auth = match &p.auth {
        SshAuth::Password(pw) => {
            session
                .authenticate_password(p.user.clone(), pw.clone())
                .await?
        }
        SshAuth::Key { path, passphrase } => {
            let key = load_secret_key(path, passphrase.as_deref())
                .map_err(|e| AppError::Ssh(format!("falha ao ler a chave privada: {e}")))?;
            session
                .authenticate_publickey(
                    p.user.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), None),
                )
                .await?
        }
    };

    if !matches!(auth, client::AuthResult::Success) {
        return Err(AppError::Ssh("autenticação SSH falhou".into()));
    }

    let session = Arc::new(session);
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let local_port = listener.local_addr()?.port();
    let target_host = target_host.to_string();

    let task = tokio::spawn(async move {
        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => break,
            };
            // Desliga o algoritmo de Nagle: queries/respostas pequenas não devem
            // esperar (~40ms de delay), reduzindo a latência por round-trip.
            let _ = socket.set_nodelay(true);
            let session = session.clone();
            let host = target_host.clone();
            tokio::spawn(async move {
                let channel = match session
                    .channel_open_direct_tcpip(host, target_port as u32, "127.0.0.1", 0)
                    .await
                {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            });
        }
    });

    Ok(SshTunnel { local_port, task })
}
