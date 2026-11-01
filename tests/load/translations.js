// Concurrent single and multilingual translation. VARY=false measures cache hits;
// provider stubs or a slow upstream can be placed behind ANTHROPIC_BASE_URL.
import http from "k6/http";
import { check } from "k6";
import { BASE, JSON_HEADERS, login, mobile, register } from "./common.js";

export const options = {
  scenarios: { translate: { executor: "constant-arrival-rate", rate: Number(__ENV.RATE || 50), timeUnit: "1s", duration: "3m", preAllocatedVUs: 100, maxVUs: 400 } },
  thresholds: { "http_req_duration{expected_response:true}": ["p(95)<2000", "p(99)<5000"], http_req_failed: ["rate<0.02"] },
};

export function setup() {
  const number = mobile(Date.now() % 1000000);
  register(number);
  return { token: login(number) };
}

export default function ({ token }) {
  const vary = __ENV.VARY !== "false";
  const text = vary ? `Load test sentence ${__VU}-${__ITER}.` : "A fixed sentence for cache measurement.";
  const response = http.post(`${BASE}/translations/multilingual`, JSON.stringify({ text, sourceLanguage: "en" }), {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
  });
  // 429 and 503 are correct backpressure, not failures, in overload runs.
  check(response, { "ok or shed": (r) => [200, 429, 503].includes(r.status) });
}
