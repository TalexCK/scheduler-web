mod api;
mod config;
mod models;
mod repository;

use std::time::Duration;

use axum::{Router, http::HeaderValue};
use config::Config;
use sqlx::postgres::PgPoolOptions;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect_lazy(&config.database_url)?;

    let index = config.frontend_dir.join("index.html");
    let static_files = ServeDir::new(&config.frontend_dir).fallback(ServeFile::new(index));
    let mut app = Router::new()
        .merge(api::router(api::AppState { pool }))
        .fallback_service(static_files)
        .layer(TraceLayer::new_for_http());

    if let Some(origin) = config.cors_origin {
        let origin = HeaderValue::from_str(&origin)?;
        app = app.layer(CorsLayer::new().allow_origin(AllowOrigin::exact(origin)));
    }

    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    tracing::info!(address = %config.bind_addr, "scheduler-web 已启动");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("无法监听 Ctrl+C 信号");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("无法监听 SIGTERM 信号")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
      () = ctrl_c => {},
      () = terminate => {},
    }
}
