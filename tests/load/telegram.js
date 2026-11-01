// Webhook burst with 10% duplicate deliveries.
import http from "k6/http";
import { check } from "k6";
import { BASE, JSON_HEADERS } from "./common.js";

export const options = {
  scenarios: { webhook: { executor: "constant-arrival-rate", rate: 200, timeUnit: "1s", duration: "2m", preAllocatedVUs: 100, maxVUs: 300 } },
  thresholds: { http_req_duration: ["p(95)<300"], http_req_failed: ["rate<0.01"] },
};

export default function () {
  const id = __ITER % 10 === 0 ? 1 : __VU * 10000000 + __ITER;
  const body = { update_id: id, message: { message_id: id, from: { id: 1 }, chat: { id: 1, type: "private" }, text: "/help" } };
  const response = http.post(`${BASE}/telegram/webhook`, JSON.stringify(body), {
    headers: { ...JSON_HEADERS, "X-Telegram-Bot-Api-Secret-Token": __ENV.TELEGRAM_WEBHOOK_SECRET },
  });
  check(response, { accepted: (r) => r.status === 200 });
}
