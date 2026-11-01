import { describe, expect, it } from "vitest";
import { registerSchema } from "@/modules/users/user.validation";
import { multilingualSchema, translateSchema } from "@/modules/translations/translation.validation";
import { parseCommand, telegramUpdateSchema } from "@/modules/telegram/telegram.validation";
import { LANGUAGE_CODE_PATTERN, normalizeLanguageCode } from "@/shared/languages";
import { splitText } from "@/shared/text";

const valid = { firstName: "  Ahmed ", lastName: "Ali", gender: "male", nativeLanguage: "ar", mobile: "+966 50 123 4567", password: "StrongPassword123!" };

describe("registration validation", () => {
  it("trims names and normalizes mobile to E.164", () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.firstName).toBe("Ahmed");
    expect(parsed.mobile).toBe("+966501234567");
  });
  it("rejects bad mobile, weak password and self-assigned roles", () => {
    expect(registerSchema.safeParse({ ...valid, mobile: "12345" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, role: "ADMIN" }).success).toBe(false);
  });
});

describe("language codes", () => {
  it("normalizes case and separators", () => {
    expect(normalizeLanguageCode("AR_sa")).toBe("ar-SA");
    expect(normalizeLanguageCode("zh-hant")).toBe("zh-Hant");
  });
  it("validates shape", () => {
    expect(LANGUAGE_CODE_PATTERN.test("ar-SA")).toBe(true);
    expect(LANGUAGE_CODE_PATTERN.test("../etc")).toBe(false);
  });
});

describe("translation validation", () => {
  it("rejects blank text and unknown fields", () => {
    expect(multilingualSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(translateSchema.safeParse({ text: "a", targetLanguage: "ar", extra: 1 }).success).toBe(false);
  });
  it("defaults the source to auto", () => {
    expect(multilingualSchema.parse({ text: "a" }).sourceLanguage).toBe("auto");
  });
});

describe("telegram parsing", () => {
  it("parses commands with bot suffix and arguments", () => {
    expect(parseCommand("/translate@my_bot hello there")).toEqual({ command: "translate", args: "hello there" });
    expect(parseCommand("/start")).toEqual({ command: "start", args: "" });
    expect(parseCommand("not a command")).toBeNull();
  });
  it("rejects malformed updates", () => {
    expect(telegramUpdateSchema.safeParse({ update_id: "x" }).success).toBe(false);
    expect(telegramUpdateSchema.safeParse({ update_id: 1, edited_message: {} }).success).toBe(true);
  });
});

describe("splitText", () => {
  it("never exceeds the limit and reassembles exactly", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Sentence ${i} مرحبا. `).join("") + "\n\n" + "x".repeat(9000);
    const parts = splitText(text, 4096);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("")).toBe(text);
  });
  it("does not split surrogate pairs", () => {
    const parts = splitText("😀".repeat(3000), 4095);
    expect(parts.join("")).toBe("😀".repeat(3000));
    for (const part of parts) expect(part.charCodeAt(part.length - 1)).not.toSatisfy((c: number) => c >= 0xd800 && c <= 0xdbff);
  });
});
