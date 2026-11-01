import { z } from "zod";
import { mobileSchema } from "@/modules/users/user.validation";

const device = z.object({ deviceName: z.string().trim().max(120).optional() });

export const loginSchema = device.extend({ mobile: mobileSchema, password: z.string().min(1).max(128) }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(128) }).strict();
export const verifyRequestSchema = z.object({ mobile: mobileSchema }).strict();
export const verifyConfirmSchema = z.object({ mobile: mobileSchema, code: z.string().regex(/^\d{6}$/) }).strict();
