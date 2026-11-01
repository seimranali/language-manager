// Concurrent registrations and logins. Needs REQUIRE_VERIFIED_MOBILE=false and raised rate limits.
import { check } from "k6";
import { login, mobile, register } from "./common.js";

export const options = {
  scenarios: { auth: { executor: "ramping-vus", stages: [{ duration: "30s", target: 50 }, { duration: "2m", target: 50 }, { duration: "15s", target: 0 }] } },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1500", "p(99)<3000"] },
};

export default function () {
  const number = mobile(__VU * 100000 + __ITER);
  check(register(number), { registered: (r) => r.status === 201 });
  check(login(number), { "logged in": (token) => Boolean(token) });
}
