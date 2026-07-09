//! Tipo de erro central. Implementa `Serialize` para cruzar a fronteira IPC do Tauri
//! como uma string amigável.

use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("conexão não encontrada: {0}")]
    ConnectionNotFound(String),

    #[error("conexão não está aberta: {0}")]
    NotConnected(String),

    #[error("configuração inválida: {0}")]
    InvalidConfig(String),

    #[error("erro de banco: {0}")]
    Database(String),

    #[error("erro no keychain: {0}")]
    Keyring(String),

    #[error("erro de SSH: {0}")]
    Ssh(String),

    #[error("erro de I/O: {0}")]
    Io(#[from] std::io::Error),

    #[error("erro de serialização: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        let msg = e.to_string();
        // O alerta TLS "HandshakeFailure" é críptico: normalmente significa que o
        // servidor não fala TLS compatível na porta usada. Em túnel SSH, o certo é
        // desmarcar o SSL (o SSH já cifra).
        if msg.contains("HandshakeFailure") || msg.contains("handshake") {
            return AppError::Database(format!(
                "{msg} — falha no handshake TLS. Se estiver usando túnel SSH ou \
                 conexão local, desmarque a opção SSL/TLS (o servidor pode não \
                 oferecer TLS nessa porta)."
            ));
        }
        AppError::Database(msg)
    }
}

impl From<tiberius::error::Error> for AppError {
    fn from(e: tiberius::error::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

impl From<russh::Error> for AppError {
    fn from(e: russh::Error) -> Self {
        AppError::Ssh(e.to_string())
    }
}

impl AppError {
    // sqlx wraps disconnects as a generic error; matched by message substring since there's no dedicated variant.
    pub fn is_connection_lost(&self) -> bool {
        let AppError::Database(m) = self else {
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
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
