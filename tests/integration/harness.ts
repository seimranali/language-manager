import { NextRequest } from "next/server";
import { generateOpaqueToken } from "@/security/tokens";
import { buildContainer, setContainerForTests, type Overrides } from "@/container";
import { MemoryStore } from "@/infrastructure/cache/store";
import { getPrisma } from "@/infrastructure/database/prisma";
import { seed } from "../../prisma/seed";
import { FakeProvider, FakeSms, FakeTelegram } from "../helpers/fakes";

export const db = getPrisma();

export interface World {
  google: FakeProvider;
  claude: FakeProvider;
  sms: FakeSms;
  telegram: FakeTelegram;
}

export async function resetWorld(overrides: Overrides = {}): Promise<World> {
  await db.$executeRawUnsafe(`TRUNCATE users, sessions, refresh_tokens, mobile_verifications, external_identities, translation_history, translation_results, user_preferences, translation_jobs, provider_usage, telegram_updates, telegram_link_tokens, telegram_conversations, audit_logs, languages CASCADE`);
  await seed(db);
  const world = { google: new FakeProvider("google"), claude: new FakeProvider("claude", true), sms: new FakeSms(), telegram: new FakeTelegram() };
  setContainerForTests(buildContainer({ providers: [world.google, world.claude], sms: world.sms, telegramClient: world.telegram, store: new MemoryStore(10_000), ...overrides }));
  return world;
}

type Handler = (req: NextRequest, segment?: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(handler: Handler, options: { method?: string; body?: unknown; token?: string; params?: Record<string, string>; query?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(options.headers);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const req = new NextRequest(`http://test.local/api${options.query ?? ""}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
  const response = await handler(req, { params: Promise.resolve(options.params ?? {}) });
  return { status: response.status, json: await response.json(), headers: response.headers };
}

let counter = 0;
export const nextMobile = () => `+96650120${String(10000 + (counter += 1)).slice(1)}`;
export const PASSWORD = "StrongPassword123!";
export const registration = (mobile: string) => ({ firstName: "Ahmed", lastName: "Ali", gender: "male", nativeLanguage: "ar", mobile, password: PASSWORD });

export { generateOpaqueToken };
