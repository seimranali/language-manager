import { z } from "zod";
import { mobileSchema } from "@/modules/users/user.validation";

export const telegramUpdateSchema = z.looseObject({
  update_id: z.number().int().nonnegative(),
  message: z
    .looseObject({
      message_id: z.number().int(),
      from: z.looseObject({ id: z.number().int(), is_bot: z.boolean().optional() }).optional(),
      chat: z.looseObject({ id: z.number().int(), type: z.string() }),
      text: z.string().optional(),
      contact: z.looseObject({ phone_number: z.string(), user_id: z.number().int().optional() }).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.output<typeof telegramUpdateSchema>;

export const linkInfoSchema = z.object({ token: z.string().min(20).max(128) }).strict();
export const linkCompleteSchema = linkInfoSchema.extend({ mobile: mobileSchema, password: z.string().min(1).max(128) }).strict();

export function parseCommand(text: string): { command: string; args: string } | null {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? { command: match[1]!.toLowerCase(), args: (match[2] ?? "").trim() } : null;
}
