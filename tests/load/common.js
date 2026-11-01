import http from "k6/http";

export const BASE = __ENV.BASE_URL || "http://localhost:3000/api/v1";
export const JSON_HEADERS = { "Content-Type": "application/json" };

export const mobile = (seed) => `+96650${String(1000000 + seed).slice(-7)}`;

export function register(number) {
  return http.post(`${BASE}/auth/register`, JSON.stringify({
    firstName: "Load", lastName: "Test", gender: "other", nativeLanguage: "en", mobile: number, password: "LoadTestPassword1",
  }), { headers: JSON_HEADERS });
}

export function login(number) {
  const response = http.post(`${BASE}/auth/login`, JSON.stringify({ mobile: number, password: "LoadTestPassword1" }), { headers: JSON_HEADERS });
  return response.json("data.accessToken");
}
