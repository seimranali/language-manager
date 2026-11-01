import type { z } from "zod";
import { AppError } from "./errors";

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError("VALIDATION_ERROR", "The request contains invalid data.", {
    fields: result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
  });
}
