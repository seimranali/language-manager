import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
import { LANGUAGE_CODE_PATTERN, normalizeLanguageCode } from "@/shared/languages";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), "Include lower-case, upper-case and a digit.");

export function normalizeMobile(value: string): string | null {
  const phone = parsePhoneNumberFromString(value.trim());
  return phone?.isValid() ? phone.number : null;
}

export const mobileSchema = z.string().max(32).transform((value, ctx) => {
  const normalized = normalizeMobile(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: "Enter a valid international mobile number, e.g. +966500000000." });
    return z.NEVER;
  }
  return normalized;
});

export const languageCodeSchema = z
  .string()
  .max(16)
  .transform(normalizeLanguageCode)
  .refine((v) => LANGUAGE_CODE_PATTERN.test(v), "Invalid language code.");

const name = z.string().trim().min(1).max(100);

// `.strict()` rejects unknown keys, so `role` can never be supplied at registration.
export const registerSchema = z
  .object({
    firstName: name,
    lastName: name,
    gender: z.string().trim().toLowerCase().min(1).max(32),
    nativeLanguage: languageCodeSchema,
    mobile: mobileSchema,
    password: passwordSchema,
  })
  .strict();

export const updateProfileSchema = z
  .object({ firstName: name.optional(), lastName: name.optional(), gender: z.string().trim().toLowerCase().max(32).optional(), nativeLanguage: languageCodeSchema.optional() })
  .strict();

export const updatePreferencesSchema = z
  .object({
    preferredTargetLanguage: languageCodeSchema.nullable().optional(),
    preferredProvider: z.enum(["google", "claude", "auto"]).optional(),
    translationStyle: z.enum(["natural", "formal", "informal", "business", "technical"]).optional(),
    saveHistory: z.boolean().optional(),
  })
  .strict();

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) }).strict();

export type RegisterInput = z.output<typeof registerSchema>;
