import { NextResponse } from "next/server";
import { dataServiceError } from "@/lib/api";
import { definitions, instances, players } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [serverDefinitions, serverInstances, onlinePlayers] = await Promise.all([definitions(), instances(), players()]);
    return NextResponse.json({ definitions: serverDefinitions, instances: serverInstances, players: onlinePlayers });
  } catch (error) {
    return dataServiceError(error);
  }
}
