import { NextResponse } from "next/server";
import { dataServiceError } from "@/lib/api";
import { definitions, instances } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [serverDefinitions, serverInstances] = await Promise.all([definitions(), instances()]);
    return NextResponse.json({ definitions: serverDefinitions, instances: serverInstances });
  } catch (error) {
    return dataServiceError(error);
  }
}
