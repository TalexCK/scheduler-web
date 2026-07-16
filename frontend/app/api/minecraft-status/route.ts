import { NextResponse } from "next/server";
import { offlineMinecraftStatus, queryMinecraftStatus } from "@/lib/minecraft-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const address = process.env.MC_STATUS_ADDRESS?.trim() || "frp-hen.com:25568";
  try {
    return NextResponse.json(await queryMinecraftStatus(address));
  } catch (error) {
    console.warn("Minecraft 状态探测失败", error instanceof Error ? error.message : "未知错误");
    return NextResponse.json(offlineMinecraftStatus(address));
  }
}
