import { NextResponse } from "next/server";
import { getContainer } from "@/container";

export async function GET() {
  try {
    const { maintenanceService, store } = getContainer();
    await maintenanceService.ping();
    if (!(await store.ping())) throw new Error("store unavailable");
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
