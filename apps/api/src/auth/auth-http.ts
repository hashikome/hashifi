import { toNodeHandler } from "better-auth/node";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { apiError } from "../http/error-envelope.js";
import { AUTH_BASE_PATH, type Auth } from "./create-auth.js";

/**
 * The Better Auth routes HashiFi uses, by method and path under `/api/auth`. Everything else
 * the library offers (account changes, email verification, password and link flows, disabling
 * the second factor) is refused: each is a way in that ADR-0007 did not choose.
 */
const ALLOWED = new Set([
  "POST /email-otp/send-verification-otp",
  "POST /sign-in/email-otp",
  "GET /get-session",
  "POST /sign-out",
  "POST /two-factor/enable",
  "POST /two-factor/verify-totp",
  "POST /two-factor/verify-backup-code",
]);

/** Express middleware placed before Nest's body parser: Better Auth reads the raw request. */
export function authHttpMiddleware(auth: Auth): RequestHandler {
  const handler = toNodeHandler(auth);
  return (request: Request, response: Response, next: NextFunction) => {
    const path = new URL(request.originalUrl, "http://api").pathname.replace(/\/+$/, "");
    if (path !== AUTH_BASE_PATH && !path.startsWith(`${AUTH_BASE_PATH}/`)) {
      next();
      return;
    }
    const route = `${request.method} ${path.slice(AUTH_BASE_PATH.length)}`;
    if (!ALLOWED.has(route)) {
      response.status(404).json(apiError("NOT_FOUND", "Not found."));
      return;
    }
    void handler(request, response);
  };
}
