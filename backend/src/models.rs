use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Serialize, FromRow)]
pub struct ServerDefinition {
    pub server_id: String,
    pub display_name: String,
    pub game_id: Option<String>,
    pub game_order: Option<i32>,
    pub autostart: bool,
    pub min_players: Option<i32>,
    pub max_players: Option<i32>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ServerInstance {
    pub instance_id: Uuid,
    pub server_id: String,
    pub state: String,
    pub pid: i64,
    pub port: i32,
    pub started_at: DateTime<Utc>,
    pub last_heartbeat: Option<DateTime<Utc>>,
    pub exit_code: Option<i32>,
    pub player_count: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PlayerPresence {
    pub player_uuid: Uuid,
    pub username: String,
    pub server_id: Option<String>,
    pub ping_ms: i64,
    pub observed_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct LeaderboardEntry {
    pub game: String,
    pub metric: String,
    pub period: String,
    pub period_key: Option<String>,
    pub rank: i64,
    pub player_id: String,
    pub player_uuid: Uuid,
    pub username: String,
    pub score: i64,
    pub sort_order: String,
    pub unit: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct LeaderboardCatalogEntry {
    pub game: String,
    pub metric: String,
    pub period: String,
    pub period_key: Option<String>,
    pub sort_order: String,
    pub unit: String,
}

#[derive(Debug, Serialize)]
pub struct ServersResponse {
    pub definitions: Vec<ServerDefinition>,
    pub instances: Vec<ServerInstance>,
}

#[derive(Debug, Serialize)]
pub struct Overview {
    pub definitions: Vec<ServerDefinition>,
    pub instances: Vec<ServerInstance>,
    pub players: Vec<PlayerPresence>,
}

#[derive(Debug, Serialize)]
pub struct ListResponse<T> {
    pub data: Vec<T>,
    pub total: usize,
}

impl<T> ListResponse<T> {
    pub fn new(data: Vec<T>) -> Self {
        let total = data.len();
        Self { data, total }
    }
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub database: &'static str,
}
