import { z } from "zod";
import { languageCodeSchema } from "@/modules/users/user.validation";

const base = z.object({
  text: z.string().refine((v) => v.trim().length > 0, "Text must not be empty."),
  sourceLanguage: z.union([z.literal("auto"), languageCodeSchema]).default("auto"),
  provider: z.enum(["google", "claude", "auto"]).optional(),
  style: z.enum(["natural", "formal", "informal", "business", "technical"]).optional(),
  context: z.string().trim().max(2_000).optional(),
  audience: z.string().trim().max(200).optional(),
  glossary: z.record(z.string().max(200), z.string().max(200)).optional(),
  preserveFormatting: z.boolean().default(true),
  correctGrammar: z.boolean().default(false),
  adaptIdioms: z.boolean().default(true),
  allowFallback: z.boolean().default(false),
  /** Skips cache and history for this request. */
  sensitive: z.boolean().default(false),
  /** Adds `pronunciation` to the Dutch target; its translation goes to Claude. */
  includePronunciation: z.boolean().default(false),
});

export const multilingualSchema = base.strict();
export const translateSchema = base.extend({ targetLanguage: languageCodeSchema }).strict();
export const jobSchema = base.extend({ targetLanguage: languageCodeSchema.optional() }).strict();

export const pageSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type MultilingualInput = z.output<typeof multilingualSchema>;
export type TranslateInput = z.output<typeof translateSchema>;
export type JobInput = z.output<typeof jobSchema>;
