import { beforeEach, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as confirm } from "@/app/api/v1/auth/verify-mobile/confirm/route";
import { POST as linkComplete } from "@/app/api/v1/telegram/link/complete/route";
import { POST as linkInfo } from "@/app/api/v1/telegram/link/info/route";
import { POST as webhook } from "@/app/api/v1/telegram/webhook/route";
import { getContainer } from "@/container";
import { call, db, nextMobile, PASSWORD, registration, resetWorld, type World } from "./harness";

const SECRET = { "x-telegram-bot-api-secret-token": "test-webhook-secret-value" };
let world: World;
let updateId = 1000;

beforeEach(async () => {
  world = await resetWorld();
});

const message = (from: number, fields: object) => ({
  update_id: (updateId += 1),
  message: { message_id: updateId, from: { id: from, is_bot: false }, chat: { id: from, type: "private" }, ...fields },
});
const say = async (from: number, text: string) => {
  const response = await call(webhook, { headers: SECRET, body: message(from, { text }) });
  expect(response.status).toBe(200);
  await waitForIdle();
};
const waitForIdle = async () => {
  for (let i = 0; i < 200; i += 1) {
    if ((await getContainer().queue.depth()) === 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
};
const last = () => world.telegram.sent.at(-1)!;
const tokenFrom = (text: string) => /#token=([\w-]+)/.exec(text)![1]!;

async function linkedUser(from: number) {
  const mobile = nextMobile();
  await call(register, { body: registration(mobile) });
  await call(confirm, { body: { mobile, code: world.sms.codeFor(mobile) } });
  await say(from, "/login");
  const done = await call(linkComplete, { body: { token: tokenFrom(last().text), mobile, password: PASSWORD } });
  expect(done.status).toBe(200);
  return mobile;
}

describe("webhook", () => {
  it("rejects a missing or wrong secret and processes nothing", async () => {
    const body = message(1, { text: "/start" });
    expect((await call(webhook, { body })).status).toBe(401);
    expect((await call(webhook, { body, headers: { "x-telegram-bot-api-secret-token": "wrong" } })).status).toBe(401);
    await waitForIdle();
    expect(world.telegram.sent).toHaveLength(0);
  });
  it("rejects malformed updates", async () => {
    expect((await call(webhook, { headers: SECRET, body: { nope: true } })).status).toBe(400);
  });
  it("handles duplicate deliveries exactly once, even concurrently", async () => {
    const body = message(2, { text: "/start" });
    const results = await Promise.all(Array.from({ length: 5 }, () => call(webhook, { headers: SECRET, body })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.json.data.duplicate === false)).toHaveLength(1);
    await waitForIdle();
    expect(world.telegram.sent).toHaveLength(1);
  });
  it("releases the claim when enqueueing fails so redelivery works", async () => {
    world = await resetWorld({ queue: { addTranslation: async () => {}, addTelegramUpdate: async () => { throw new Error("redis down"); }, removeTranslation: async () => {}, depth: async () => 0 } });
    const body = message(3, { text: "/start" });
    expect((await call(webhook, { headers: SECRET, body })).status).toBe(500);
    expect(await db.telegramUpdate.count()).toBe(0);
  });
  it("ignores group chats", async () => {
    await call(webhook, { headers: SECRET, body: message(4, { text: "/start", chat: { id: -5, type: "group" } }) });
    await waitForIdle();
    expect(world.telegram.sent).toHaveLength(0);
  });
});

describe("identity", () => {
  it("does not treat an unlinked sender as authenticated", async () => {
    await say(10, "translate this");
    expect(last().text).toMatch(/link an account/);
    expect(world.google.calls).toHaveLength(0);
  });
  it("links only with valid credentials, once, with no secrets in chat", async () => {
    const mobile = nextMobile();
    await call(register, { body: registration(mobile) });
    await call(confirm, { body: { mobile, code: world.sms.codeFor(mobile) } });
    await say(11, "/login");
    const token = tokenFrom(last().text);
    expect((await call(linkComplete, { body: { token, mobile, password: "Wrong-Password-1" } })).status).toBe(401);
    expect(await db.externalIdentity.count()).toBe(0);
    expect((await call(linkComplete, { body: { token, mobile, password: PASSWORD } })).status).toBe(200);
    expect((await call(linkComplete, { body: { token, mobile, password: PASSWORD } })).status).toBe(400);
    expect(await db.externalIdentity.count()).toBe(1);
    const chat = JSON.stringify(world.telegram.sent);
    expect(chat).not.toContain(PASSWORD);
    expect(chat).not.toMatch(/eyJ/);
  });
  it("stores only a hash of the link token", async () => {
    await say(12, "/login");
    const token = tokenFrom(last().text);
    expect(JSON.stringify(await db.telegramLinkToken.findMany())).not.toContain(token);
  });
  it("expires link tokens", async () => {
    await say(13, "/login");
    const token = tokenFrom(last().text);
    await db.telegramLinkToken.updateMany({ data: { expiresAt: new Date(0) } });
    expect((await call(linkInfo, { body: { token } })).status).toBe(400);
  });
  it("a deactivated account loses the bot", async () => {
    const mobile = await linkedUser(14);
    await db.user.update({ where: { mobile }, data: { isActive: false } });
    await say(14, "hello");
    expect(last().text).toMatch(/link an account/);
  });
  it("/logout unlinks", async () => {
    await linkedUser(15);
    await say(15, "/logout");
    expect(await db.externalIdentity.count()).toBe(0);
  });
});

describe("guided registration", () => {
  it("asks four questions, then creates a linked account with no secrets", async () => {
    const from = 20;
    await say(from, "/register");
    await say(from, "Ahmed");
    await say(from, "Ali");
    await say(from, "robot");
    expect(last().text).toMatch(/listed options/);
    await say(from, "male");
    await say(from, "Klingon");
    expect(last().text).toMatch(/not supported/);
    await say(from, "arabic");
    expect(last().text).toMatch(/account is ready/);
    const user = await db.user.findFirstOrThrow({ include: { externalIdentities: true } });
    expect(user).toMatchObject({ firstName: "Ahmed", lastName: "Ali", gender: "male", nativeLanguageCode: "ar", mobile: null, passwordHash: null, role: "USER" });
    expect(user.externalIdentities[0]?.externalUserId).toBe("20");
    await say(from, "Bonjour");
    expect(last().text).toContain("Dutch\n");
  });
  it("refuses a second registration from a linked user", async () => {
    await linkedUser(22);
    await say(22, "/register");
    expect(last().text).toMatch(/already linked/);
  });
});

describe("bot translation", () => {
  it("returns all three languages through the shared service", async () => {
    await linkedUser(30);
    await say(30, "Bonjour");
    expect(last().text).toContain("Dutch\n");
    expect(last().text).toContain("English\n");
    expect(last().text).toContain("Arabic (Saudi Arabia)\n");
    expect(await db.translationHistory.count()).toBe(1);
  });
  it("uses the preferred language, and shows settings and history", async () => {
    await linkedUser(31);
    await say(31, "/language fr");
    await say(31, "/translate Hello");
    expect(last().text).toContain("[google:fr] Hello");
    await say(31, "/mylanguage");
    expect(last().text).toContain("Preferred target: fr");
    await say(31, "/history");
    expect(last().text).toContain("Hello");
  });
  it("shows pronunciation under each translation", async () => {
    await linkedUser(34);
    await say(34, "Bonjour");
    expect(last().original).toContain("🇳🇱 Dutch\n");
    expect(last().original).not.toContain("🔊");
    expect(last().text).toContain("🔊 say nl");
    expect(last().text).not.toContain("🔊 say ar-SA");
  });
  it("reports a provider outage without crashing", async () => {
    await linkedUser(32);
    for (const code of ["nl", "en", "ar-SA"]) { world.google.failFor.add(code); world.claude.failFor.add(code); }
    await say(32, "Bonjour");
    expect(last().text).toMatch(/unavailable|down/i);
  });
});
