import { NextResponse, type NextRequest } from "next/server";

const allowed = () => (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);

/** Native mobile and Telegram clients ignore CORS; only allow-listed browsers get headers. */
export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  const permitted = origin !== null && allowed().includes(origin);
  const response = req.method === "OPTIONS" ? new NextResponse(null, { status: 204 }) : NextResponse.next();
  if (permitted) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key");
  }
  return response;
}

export const config = { matcher: "/api/:path*" };
