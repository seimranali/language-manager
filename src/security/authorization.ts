import { AppError } from "@/shared/errors";

export type Role = "USER" | "ADMIN";

export function assertRole(actual: Role, required: Role): void {
  if (required === "ADMIN" && actual !== "ADMIN") {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
  }
}

/** Hides existence of other users' resources by answering 404. */
export function assertOwner(ownerId: string, actorId: string): void {
  if (ownerId !== actorId) throw new AppError("NOT_FOUND", "The resource was not found.");
}
