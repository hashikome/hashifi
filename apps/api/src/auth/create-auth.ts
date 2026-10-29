import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, twoFactor } from "better-auth/plugins";
import type { AppConfig } from "../config/config.js";
import type { PrismaClient } from "../database/client.js";
import type { EmailSender } from "../email/email-sender.js";
import { captureFailure } from "../observability/telemetry.js";
import { consumeSignInCode } from "./sign-in-code-budget.js";
import { SIGN_IN_CODE_MINUTES, signInCodeEmail } from "./sign-in-code-email.js";

export const AUTH_BASE_PATH = "/api/auth";
export const BETTER_AUTH = Symbol("BETTER_AUTH");

export interface AuthDependencies {
  config: AppConfig;
  db: PrismaClient;
  email: EmailSender;
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Better Auth, configured to ADR-0007 rather than to the library's defaults:
 *
 * - Email one-time codes only. No passwords, no sign-up: a code is sent only to active staff,
 *   and every caller gets the same answer whether or not the email is staff.
 * - Codes are stored under an HMAC keyed by the auth secret, so a database copy does not
 *   reveal them (a bare hash of six digits is reversed by trying a million).
 * - A person with an authenticator app must give its code after the email code: the
 *   two-factor gate is widened to the email-code sign-in (`withEmailCodeGate`). No device is
 *   ever trusted to skip it. Admins must enroll; the staff guard holds them until they do.
 * - Rate limits are on in every environment and kept in PostgreSQL, shared by every process;
 *   a per-person budget (`consumeSignInCode`) limits codes sent whatever address asks.
 * - Inactive staff cannot get a code or a session.
 * - Library telemetry is off.
 */
export function createAuth({ config, db, email }: AuthDependencies) {
  const otpKey = config.auth.secret;
  return betterAuth({
    appName: "HashiFi",
    baseURL: config.appUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.auth.secret,
    trustedOrigins: [config.frontendOrigin],
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: { enabled: false },
    telemetry: { enabled: false },
    advanced: {
      database: { generateId: () => Bun.randomUUIDv7() },
      ipAddress: { trustedProxies: config.auth.trustedProxies },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      // The library allows three code requests and three sign-ins per minute per address.
      // Second-factor checks get a minute-long window too, rather than ten seconds.
      customRules: {
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const staff = await db.staff.findUnique({ where: { id: session.userId } });
            if (staff?.status !== "active") {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_INACTIVE",
                message: "This account cannot sign in.",
              });
            }
          },
          after: async (session) => {
            await db.staff.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type !== "sign-in") {
          throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are sent." });
        }
        if (ctx.path.startsWith("/two-factor/verify-") && ctx.body?.trustDevice === true) {
          // HashiFi trusts no device to skip the authenticator (withEmailCodeGate).
          return { context: { body: { ...ctx.body, trustDevice: false } } };
        }
        if (ctx.path === "/two-factor/enable") {
          // Enabling again would replace the authenticator with a session alone.
          const current = await getSessionFromCtx(ctx);
          if (current?.user.twoFactorEnabled === true) {
            throw new APIError("BAD_REQUEST", {
              code: "TWO_FACTOR_ALREADY_ENABLED",
              message: "An authenticator app is already set up.",
            });
          }
        }
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: SIGN_IN_CODE_MINUTES * 60,
        allowedAttempts: 5,
        disableSignUp: true,
        storeOTP: {
          hash: async (otp) => createHmac("sha256", otpKey).update(otp).digest("base64url"),
        },
        // Called only for an email that has a user (sign-up is disabled). Not awaited, so a
        // staff email and a stranger's take the same time to answer.
        sendVerificationOTP: async ({ email: address, otp }) => {
          void deliverSignInCode(db, email, address, otp).catch(captureFailure);
        },
      }),
      withEmailCodeGate(twoFactor({ issuer: "HashiFi", allowPasswordless: true })),
    ],
  });
}

async function deliverSignInCode(
  db: PrismaClient,
  email: EmailSender,
  address: string,
  code: string,
): Promise<void> {
  const user = await db.user.findUnique({ where: { email: address }, include: { staff: true } });
  if (user?.staff?.status !== "active") return;
  if (!(await consumeSignInCode(db, user.id))) return;
  await email.send(signInCodeEmail(address, code));
}

const TRUST_DEVICE_COOKIE = "trust_device";

/** The request headers with any "trust this device" cookie removed. */
function withoutTrustCookie(headers: HeadersInit | null): Headers {
  const copy = new Headers(headers ?? {});
  const cookie = copy.get("cookie");
  if (cookie !== null) {
    const kept = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !part.split("=")[0]?.endsWith(TRUST_DEVICE_COOKIE));
    copy.set("cookie", kept.join("; "));
  }
  return copy;
}

/**
 * The two-factor plugin gates only the password-style sign-ins (`/sign-in/email` and
 * similar), and the email-code plugin knows nothing of a second factor, so on its own an
 * enrolled authenticator would never be asked for. This widens the plugin's own gate to
 * `/sign-in/email-otp` rather than reimplementing it: the gate deletes the session the code
 * created and issues the two-factor challenge. It also hides any "trust this device" cookie
 * from the gate, so no device skips the second factor; none is issued either (`hooks.before`).
 */
function withEmailCodeGate<TPlugin extends ReturnType<typeof twoFactor>>(plugin: TPlugin): TPlugin {
  const after = plugin.hooks?.after;
  const gate = after?.[0];
  if (!gate || after.length !== 1) {
    // A library upgrade changed the hook layout; refuse to start rather than sign people in
    // without their second factor.
    throw new Error("The Better Auth two-factor plugin no longer has exactly one sign-in gate");
  }
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: [
        {
          matcher: (context) => gate.matcher(context) || context.path === "/sign-in/email-otp",
          handler: async (context) =>
            gate.handler({ ...context, headers: withoutTrustCookie(context.headers ?? null) }),
        },
      ],
    },
  };
}
