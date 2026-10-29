import {
  createParamDecorator,
  type ExecutionContext,
  NotFoundException,
  ParseUUIDPipe,
} from "@nestjs/common";
import type { Request } from "express";
import { apiError } from "./error-envelope.js";

/** The caller's address and user agent, for the audit trail (`trust proxy` resolves the address). */
export const Origin = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  return { ipAddress: request.ip ?? null, userAgent: request.headers["user-agent"] ?? null };
});

/** An id in the path: anything that is not a UUID names nothing, so it is not found. */
export const idParam = () =>
  new ParseUUIDPipe({
    exceptionFactory: () => new NotFoundException(apiError("NOT_FOUND", "Not found.")),
  });
