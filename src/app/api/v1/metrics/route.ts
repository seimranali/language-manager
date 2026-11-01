import { getEnv } from "@/config/env";
import { metrics } from "@/infrastructure/metrics/metrics";
import { safeEqual } from "@/security/tokens";

export function GET(req: Request) {
  const token = getEnv().METRICS_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || !safeEqual(token, given)) return new Response(null, { status: 404 });
  return new Response(metrics.render(), { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
