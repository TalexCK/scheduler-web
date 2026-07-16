use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{any, get},
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use thiserror::Error;

use crate::{
    models::{HealthResponse, ListResponse, Overview, ServersResponse},
    repository,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/api/overview", get(overview))
        .route("/api/servers", get(servers))
        .route("/api/players", get(players))
        .route("/api/leaderboards", get(leaderboards))
        .route("/api/leaderboards/catalog", get(leaderboard_catalog))
        .route("/api/{*path}", any(api_not_found))
        .with_state(state)
}

async fn api_not_found() -> ApiError {
    ApiError::NotFound
}

async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, ApiError> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(HealthResponse {
        status: "ok",
        database: "connected",
    }))
}

async fn servers(State(state): State<AppState>) -> Result<Json<ServersResponse>, ApiError> {
    let (definitions, instances) = tokio::try_join!(
        repository::definitions(&state.pool),
        repository::instances(&state.pool),
    )?;
    Ok(Json(ServersResponse {
        definitions,
        instances,
    }))
}

async fn players(
    State(state): State<AppState>,
) -> Result<Json<ListResponse<crate::models::PlayerPresence>>, ApiError> {
    Ok(Json(ListResponse::new(
        repository::players(&state.pool).await?,
    )))
}

#[derive(Debug, Deserialize)]
struct LeaderboardQuery {
    game: String,
    metric: String,
    period: String,
    period_key: Option<String>,
    #[serde(default = "default_limit")]
    limit: u16,
}

const fn default_limit() -> u16 {
    100
}

async fn leaderboards(
    State(state): State<AppState>,
    Query(query): Query<LeaderboardQuery>,
) -> Result<Json<ListResponse<crate::models::LeaderboardEntry>>, ApiError> {
    if query.limit == 0 || query.limit > 500 {
        return Err(ApiError::BadRequest("limit 必须在 1 到 500 之间"));
    }
    if query.game != "bingo" || !valid_identifier(&query.metric, 64) {
        return Err(ApiError::BadRequest("game 或 metric 不合法"));
    }
    let period_key = match query.period.as_str() {
        "month" if query.period_key.as_deref().is_some_and(valid_month_key) => {
            query.period_key.as_deref()
        }
        "all_time" if query.period_key.is_none() => None,
        "month" => {
            return Err(ApiError::BadRequest(
                "月榜必须提供 YYYY-MM 格式的 period_key",
            ));
        }
        "all_time" => return Err(ApiError::BadRequest("总榜不能提供 period_key")),
        _ => return Err(ApiError::BadRequest("period 必须是 month 或 all_time")),
    };
    Ok(Json(ListResponse::new(
        repository::leaderboard(
            &state.pool,
            &query.game,
            &query.metric,
            &query.period,
            period_key,
            i64::from(query.limit),
        )
        .await?,
    )))
}

async fn leaderboard_catalog(
    State(state): State<AppState>,
) -> Result<Json<ListResponse<crate::models::LeaderboardCatalogEntry>>, ApiError> {
    Ok(Json(ListResponse::new(
        repository::leaderboard_catalog(&state.pool).await?,
    )))
}

fn valid_identifier(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_month_key(value: &str) -> bool {
    let Some((year, month)) = value.split_once('-') else {
        return false;
    };
    year.len() == 4
        && year.bytes().all(|byte| byte.is_ascii_digit())
        && month.len() == 2
        && month.bytes().all(|byte| byte.is_ascii_digit())
        && matches!(month.parse::<u8>(), Ok(1..=12))
}

async fn overview(State(state): State<AppState>) -> Result<Json<Overview>, ApiError> {
    let (definitions, instances, players) = tokio::try_join!(
        repository::definitions(&state.pool),
        repository::instances(&state.pool),
        repository::players(&state.pool),
    )?;
    Ok(Json(Overview {
        definitions,
        instances,
        players,
    }))
}

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("API 路径不存在")]
    NotFound,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message.to_string()),
            Self::NotFound => (StatusCode::NOT_FOUND, "API 路径不存在".into()),
            Self::Database(error) => {
                tracing::error!(%error, "数据库查询失败");
                (StatusCode::SERVICE_UNAVAILABLE, "数据服务暂时不可用".into())
            }
        };
        (status, Json(json!({ "error": { "message": message } }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;

    use super::*;

    fn test_app() -> Router {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://test:test@127.0.0.1:1/test")
            .expect("测试数据库 URL 应有效");
        router(AppState { pool })
    }

    #[tokio::test]
    async fn rejects_out_of_range_leaderboard_limit_before_database_access() {
        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/api/leaderboards?game=bingo&metric=normal&period=all_time&limit=0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn unknown_api_route_is_not_found() {
        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/api/unknown")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn validates_calendar_month_keys() {
        assert!(valid_month_key("2026-07"));
        assert!(!valid_month_key("2026-00"));
        assert!(!valid_month_key("2026-13"));
        assert!(!valid_month_key("26-07"));
    }
}
