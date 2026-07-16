import { getPool } from "@/lib/db";

export async function definitions() {
  const { rows } = await getPool().query(`
    SELECT server_id, display_name, game_id, game_order, autostart,
           min_players, max_players, updated_at
    FROM scheduler_server_definitions
    ORDER BY game_order NULLS LAST, display_name, server_id
  `);
  return rows;
}

export async function instances() {
  const { rows } = await getPool().query(`
    SELECT instance_id, server_id, state, pid, port, started_at,
           last_heartbeat, exit_code, player_count, updated_at
    FROM scheduler_server_instances
    ORDER BY CASE state WHEN 'ready' THEN 0 WHEN 'starting' THEN 1 WHEN 'stopping' THEN 2 ELSE 3 END,
             server_id, started_at DESC, instance_id
  `);
  return rows.map((row) => ({ ...row, pid: Number(row.pid) }));
}

export async function players() {
  const { rows } = await getPool().query(`
    SELECT player_uuid, username, server_id, ping_ms, observed_at
    FROM scheduler_players
    ORDER BY username, player_uuid
  `);
  return rows.map((row) => ({ ...row, ping_ms: Number(row.ping_ms) }));
}

export async function leaderboardCatalog() {
  const { rows } = await getPool().query(`
    SELECT DISTINCT game, metric, period, period_key, sort_order, unit
    FROM scheduler_leaderboard_entries
    WHERE game IS NOT NULL AND metric IS NOT NULL
      AND period IN ('month', 'all_time') AND player_id IS NOT NULL
    ORDER BY game, metric, period_key DESC NULLS LAST, period
  `);
  return rows;
}

export async function leaderboard(game: string, metric: string, period: string, periodKey: string | null, limit: number) {
  const { rows } = await getPool().query(`
    SELECT game, metric, period, period_key,
           rank() OVER (ORDER BY
             CASE WHEN sort_order = 'asc' THEN score END ASC NULLS LAST,
             CASE WHEN sort_order = 'desc' THEN score END DESC NULLS LAST)::bigint AS rank,
           player_id, player_uuid, username, score, sort_order, unit, updated_at
    FROM scheduler_leaderboard_entries
    WHERE game = $1 AND metric = $2 AND period = $3
      AND period_key IS NOT DISTINCT FROM $4
    ORDER BY rank, player_uuid
    LIMIT $5
  `, [game, metric, period, periodKey, limit]);
  return rows.map((row) => ({ ...row, rank: Number(row.rank), score: Number(row.score) }));
}
