import { Pool } from "pg";
import "server-only";

let pool: Pool | undefined;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("缺少必需环境变量 DATABASE_URL");
    const max = Number.parseInt(process.env.DB_MAX_CONNECTIONS ?? "10", 10);
    pool = new Pool({ connectionString, max: Number.isFinite(max) && max > 0 ? max : 10 });
  }
  return pool;
}
