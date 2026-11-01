import { NextResponse } from "next/server";
import { openApiDocument } from "@/shared/http/openapi";

export function GET() {
  return NextResponse.json(openApiDocument());
}
