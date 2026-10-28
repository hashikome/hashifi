/**
 * Typed errors for RouterOS API interactions.
 *
 * Before this existed, callers string-matched `String(err)` to decide what went wrong
 * (see the `unknown parameter` retry that used to live in mikrotik.ts). Classifying once,
 * here, lets every caller branch on `kind` / `retryable` instead.
 */

export type RouterErrorKind = "unreachable" | "auth" | "command" | "unsupported" | "verify";

export interface RouterErrorContext {
  host: string;
  /** RouterOS command path, e.g. "/ip/hotspot/user/add" */
  command?: string;
  /** Already-redacted params — never pass raw credentials here */
  params?: string[];
  /** Verbatim message RouterOS replied with */
  rosMessage?: string;
  cause?: unknown;
}

export abstract class RouterError extends Error {
  abstract readonly kind: RouterErrorKind;
  /** Whether retrying the same call could plausibly succeed */
  abstract readonly retryable: boolean;

  readonly host: string;
  readonly command?: string;
  readonly params?: string[];
  readonly rosMessage?: string;

  constructor(message: string, ctx: RouterErrorContext) {
    super(message, { cause: ctx.cause });
    this.name = new.target.name;
    this.host = ctx.host;
    this.command = ctx.command;
    this.params = ctx.params;
    this.rosMessage = ctx.rosMessage;
  }

  /** Safe to persist in an audit log or ship to the admin UI */
  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      message: this.message,
      retryable: this.retryable,
      host: this.host,
      command: this.command ?? null,
      params: this.params ?? null,
      rosMessage: this.rosMessage ?? null,
    };
  }
}

/** TCP connect failed, timed out, or the socket dropped mid-command. */
export class RouterUnreachableError extends RouterError {
  readonly kind = "unreachable" as const;
  readonly retryable = true;
}

/** Credentials rejected. Retrying with the same credentials is pointless. */
export class RouterAuthError extends RouterError {
  readonly kind = "auth" as const;
  readonly retryable = false;
}

/** RouterOS understood the command and refused it (bad value, missing object, …). */
export class RouterCommandError extends RouterError {
  readonly kind = "command" as const;
  readonly retryable = false;
}

/**
 * The command or parameter does not exist on this board/firmware.
 * This is a capability signal, not a failure — e.g. `/ip hotspot` on RouterOS 7 smips,
 * or `=shared-users=` on a RouterOS 6 hAP Lite.
 */
export class RouterUnsupportedError extends RouterError {
  readonly kind = "unsupported" as const;
  readonly retryable = false;
}

/** The write was accepted but reading it back disagreed with what we asked for. */
export class RouterVerifyError extends RouterError {
  readonly kind = "verify" as const;
  readonly retryable = true;
}

/** Params may carry voucher codes and API passwords — never log them raw. */
const SECRET_PARAM_PREFIXES = ["=password=", "=api-password=", "=secret="];

export function redactParams(params: string[] | undefined): string[] | undefined {
  if (!params) return undefined;
  return params.map((p) => {
    const hit = SECRET_PARAM_PREFIXES.find((prefix) => p.startsWith(prefix));
    return hit ? `${hit}***` : p;
  });
}

/**
 * Map a raw thrown value onto the taxonomy.
 *
 * Order matters: "unsupported" and "auth" are matched before "unreachable", because
 * connection-ish words ("connect", "socket") appear in unrelated RouterOS messages.
 */
export function classifyRouterError(err: unknown, ctx: RouterErrorContext): RouterError {
  if (err instanceof RouterError) return err;

  const rosMessage = err instanceof Error ? err.message : String(err);
  const msg = rosMessage.toLowerCase();
  const full: RouterErrorContext = { ...ctx, rosMessage, cause: err };

  if (
    msg.includes("no such command") ||
    msg.includes("unknown parameter") ||
    msg.includes("not implemented") ||
    msg.includes("bad command name")
  ) {
    return new RouterUnsupportedError(
      `RouterOS does not support this on ${ctx.host}: ${rosMessage}`,
      full,
    );
  }

  if (
    msg.includes("cannot log in") ||
    msg.includes("invalid user name or password") ||
    msg.includes("login failed") ||
    msg.includes("not logged in")
  ) {
    return new RouterAuthError(`Authentication rejected by ${ctx.host}: ${rosMessage}`, full);
  }

  if (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("ehostunreach") ||
    msg.includes("enetunreach") ||
    msg.includes("ehostdown") ||
    msg.includes("epipe") ||
    msg.includes("socket closed")
  ) {
    return new RouterUnreachableError(`Cannot reach ${ctx.host}: ${rosMessage}`, full);
  }

  return new RouterCommandError(`RouterOS rejected command on ${ctx.host}: ${rosMessage}`, full);
}

export function isRetryable(err: unknown): boolean {
  return err instanceof RouterError ? err.retryable : false;
}
