import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { dataServiceError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getPool().query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (error) {
    return dataServiceError(error);
  }
}
