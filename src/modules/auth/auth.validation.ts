import { z } from "zod";
import { emailSchema, mobileSchema } from "@/modules/users/user.validation";

const device = z.object({ deviceName: z.string().trim().max(120).optional() });

export const loginSchema = device
  .extend({ mobile: mobileSchema.optional(), email: emailSchema.optional(), password: z.string().min(1).max(128) })
  .strict()
  .refine((v) => Boolean(v.mobile) !== Boolean(v.email), { message: "Provide either an email address or a mobile number.", path: ["email"] });
export const verifyEmailRequestSchema = z.object({ email: emailSchema }).strict();
export const verifyEmailConfirmSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(128) }).strict();
export const verifyRequestSchema = z.object({ mobile: mobileSchema }).strict();
export const verifyConfirmSchema = z.object({ mobile: mobileSchema, code: z.string().regex(/^\d{6}$/) }).strict();
