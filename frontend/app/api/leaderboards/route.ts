import { NextRequest, NextResponse } from "next/server";
import { badRequest, dataServiceError, validIdentifier, validMonthKey } from "@/lib/api";
import { leaderboard } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const game = params.get("game") ?? "";
  const metric = params.get("metric") ?? "";
  const period = params.get("period") ?? "";
  const periodKey = params.get("period_key");
  const limit = Number.parseInt(params.get("limit") ?? "100", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return badRequest("limit 必须在 1 到 500 之间");
  if (game !== "bingo" || !validIdentifier(metric)) return badRequest("game 或 metric 不合法");
  if (period === "month" && (!periodKey || !validMonthKey(periodKey))) return badRequest("月榜必须提供 YYYY-MM 格式的 period_key");
  if (period === "all_time" && periodKey !== null) return badRequest("总榜不能提供 period_key");
  if (period !== "month" && period !== "all_time") return badRequest("period 必须是 month 或 all_time");
  try {
    const data = await leaderboard(game, metric, period, periodKey, limit);
    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    return dataServiceError(error);
  }
}
