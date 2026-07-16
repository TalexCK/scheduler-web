use sqlx::PgPool;

use crate::models::{
    LeaderboardCatalogEntry, LeaderboardEntry, PlayerPresence, ServerDefinition, ServerInstance,
};

pub async fn definitions(pool: &PgPool) -> Result<Vec<ServerDefinition>, sqlx::Error> {
    sqlx::query_as::<_, ServerDefinition>(
        r#"
    SELECT server_id, display_name, game_id, game_order, autostart,
           min_players, max_players, updated_at
    FROM scheduler_server_definitions
    ORDER BY game_order NULLS LAST, display_name, server_id
    "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn instances(pool: &PgPool) -> Result<Vec<ServerInstance>, sqlx::Error> {
    sqlx::query_as::<_, ServerInstance>(
        r#"
    SELECT instance_id, server_id, state, pid, port, started_at,
           last_heartbeat, exit_code, player_count, updated_at
    FROM scheduler_server_instances
    ORDER BY
      CASE state WHEN 'ready' THEN 0 WHEN 'starting' THEN 1 WHEN 'stopping' THEN 2 ELSE 3 END,
      server_id, started_at DESC, instance_id
    "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn players(pool: &PgPool) -> Result<Vec<PlayerPresence>, sqlx::Error> {
    sqlx::query_as::<_, PlayerPresence>(
        r#"
    SELECT player_uuid, username, server_id, ping_ms, observed_at
    FROM scheduler_players
    ORDER BY username, player_uuid
    "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn leaderboard(
    pool: &PgPool,
    game: &str,
    metric: &str,
    period: &str,
    period_key: Option<&str>,
    limit: i64,
) -> Result<Vec<LeaderboardEntry>, sqlx::Error> {
    sqlx::query_as::<_, LeaderboardEntry>(
        r#"
    SELECT game, metric, period, period_key,
           rank() OVER (
             ORDER BY
               CASE WHEN sort_order = 'asc' THEN score END ASC NULLS LAST,
               CASE WHEN sort_order = 'desc' THEN score END DESC NULLS LAST
           )::bigint AS rank,
           player_id, player_uuid, username, score, sort_order, unit, updated_at
    FROM scheduler_leaderboard_entries
    WHERE game = $1
      AND metric = $2
      AND period = $3
      AND period_key IS NOT DISTINCT FROM $4
    ORDER BY rank, player_uuid
    LIMIT $5
    "#,
    )
    .bind(game)
    .bind(metric)
    .bind(period)
    .bind(period_key)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn leaderboard_catalog(
    pool: &PgPool,
) -> Result<Vec<LeaderboardCatalogEntry>, sqlx::Error> {
    sqlx::query_as::<_, LeaderboardCatalogEntry>(
        r#"
    SELECT DISTINCT game, metric, period, period_key, sort_order, unit
    FROM scheduler_leaderboard_entries
    WHERE game IS NOT NULL
      AND metric IS NOT NULL
      AND period IN ('month', 'all_time')
      AND player_id IS NOT NULL
    ORDER BY game, metric, period_key DESC NULLS LAST, period
    "#,
    )
    .fetch_all(pool)
    .await
}
