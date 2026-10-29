import type { ApiError } from "@hashifi/types";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { captureFailure } from "../observability/telemetry.js";
import { enrichWideEvent } from "../observability/wide-event.js";

/** Builds the body of an `HttpException` in the API's error shape. */
export function apiError(
  code: string,
  message: string,
  details: Record<string, string> | null = null,
): ApiError {
  return { code, message, details };
}

/**
 * Every error leaves in one shape (`ApiError`). An `HttpException` keeps its status and, when
 * it carries one, its code; anything else is a 500 that says nothing of its cause and is
 * reported to Sentry.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(fromHttpException(exception));
      return;
    }
    captureFailure(exception);
    enrichWideEvent({
      "error.class": exception instanceof Error ? exception.constructor.name : typeof exception,
    });
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(apiError("INTERNAL_ERROR", "Something went wrong. Try again."));
  }
}

function fromHttpException(exception: HttpException): ApiError {
  const body: unknown = exception.getResponse();
  const fallback = HttpStatus[exception.getStatus()] ?? "ERROR";
  if (typeof body !== "object" || body === null) {
    return apiError(fallback, typeof body === "string" ? body : exception.message);
  }
  const record = body as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : fallback;
  const message = typeof record.message === "string" ? record.message : exception.message;
  const details =
    typeof record.details === "object" && record.details !== null
      ? (record.details as Record<string, string>)
      : null;
  return apiError(code, message, details);
}
