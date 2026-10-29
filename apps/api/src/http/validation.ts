import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";
import { apiError } from "./error-envelope.js";

/** Parses a request body or query, or answers 400 `VALIDATION_FAILED` naming each field. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const details: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".") || "body";
    details[path] ??= issue.message;
  }
  throw new BadRequestException(
    apiError("VALIDATION_FAILED", "Check the highlighted fields.", details),
  );
}
