import { NextResponse } from "next/server";
import { dataServiceError } from "@/lib/api";
import { players } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await players();
    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    return dataServiceError(error);
  }
}
