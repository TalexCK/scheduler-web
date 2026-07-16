use std::{env, net::SocketAddr, path::PathBuf};

use thiserror::Error;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub frontend_dir: PathBuf,
    pub max_connections: u32,
    pub cors_origin: Option<String>,
    pub minecraft_status_address: String,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url = required("DATABASE_URL")?;
        let bind_addr = env::var("BIND_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".into())
            .parse()
            .map_err(|_| ConfigError::Invalid("BIND_ADDR"))?;
        let frontend_dir = env::var("FRONTEND_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("frontend/dist"));
        let max_connections = env::var("DB_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "10".into())
            .parse()
            .map_err(|_| ConfigError::Invalid("DB_MAX_CONNECTIONS"))?;
        if max_connections == 0 {
            return Err(ConfigError::Invalid("DB_MAX_CONNECTIONS"));
        }

        Ok(Self {
            database_url,
            bind_addr,
            frontend_dir,
            max_connections,
            cors_origin: env::var("CORS_ORIGIN")
                .ok()
                .filter(|value| !value.is_empty()),
            minecraft_status_address: env::var("MC_STATUS_ADDRESS")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "frp-hen.com:25568".into()),
        })
    }
}

fn required(name: &'static str) -> Result<String, ConfigError> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ConfigError::Missing(name))
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("缺少必需环境变量 {0}")]
    Missing(&'static str),
    #[error("环境变量 {0} 的值无效")]
    Invalid(&'static str),
}
