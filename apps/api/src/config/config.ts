import { z } from "zod";
import { readSecret } from "./secret.js";

/**
 * The API's configuration, read once at startup and validated: a missing or malformed value
 * stops the process with a message naming it, rather than failing later. Secrets follow the
 * `<NAME>_FILE` contract (secret.ts); everything else is an ordinary variable.
 */
export interface AppConfig {
  environment: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  /** 32 bytes for AES-256-GCM. */
  encryptionKey: Buffer;
  frontendOrigin: string;
  appUrl: string;
  auth: {
    /** Signs session cookies and keys the stored sign-in codes. At least 32 characters. */
    secret: string;
    /**
     * Proxies allowed to report the client address in `x-forwarded-for`; sign-in rate limits
     * key on that address. Required in production (Traefik's network).
     */
    trustedProxies: string[];
  };
  email: {
    /** Resend; required in production. Unset elsewhere, messages go to `outboxDir`. */
    resendApiKey: string | null;
    from: string;
    outboxDir: string;
  };
  mikrotik: { apiPort: number; connectTimeoutSeconds: number };
  routerManagementUrl: string | null;
  portalOrigin: string | null;
  /** Background jobs (expiry, reconciliation, router polling). Off for tooling and tests. */
  jobsEnabled: boolean;
  telemetry: {
    sentryDsn: string | null;
    release: string | null;
    tracesSampleRate: number;
  };
}

const url = z.url({ protocol: /^https?$/ });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes as 64 hex characters (openssl rand -hex 32)"),
  FRONTEND_ORIGIN: url.default("http://localhost:4000"),
  APP_URL: url.default("http://localhost:8080"),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters (openssl rand -hex 32)"),
  TRUSTED_PROXIES: z.string().default(""),
  RESEND_API_KEY: z.string().min(1).nullable().default(null),
  EMAIL_FROM: z.string().min(3).default("HashiFi <no-reply@hashikome.com>"),
  EMAIL_OUTBOX_DIR: z.string().min(1).default(".local/outbox"),
  MIKROTIK_API_PORT: z.coerce.number().int().min(1).max(65535).default(8728),
  MIKROTIK_CONNECT_TIMEOUT: z.coerce.number().int().min(1).max(120).default(10),
  ROUTER_MANAGEMENT_URL: url.nullable().default(null),
  PORTAL_ORIGIN: url.nullable().default(null),
  JOBS_ENABLED: z.enum(["true", "false"]).default("true"),
  SENTRY_DSN: z.url().nullable().default(null),
  SENTRY_RELEASE: z.string().min(1).nullable().default(null),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});

const SECRETS = [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "RESEND_API_KEY",
  "SENTRY_DSN",
] as const;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const input: Record<string, string | null> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = (SECRETS as readonly string[]).includes(key)
      ? readSecret(key, env)
      : (env[key]?.trim() ?? "");
    input[key] = value === "" ? null : value;
  }
  // Absent optional values fall to their defaults; zod applies a default only to undefined.
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)),
  );
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  const c = parsed.data;
  const trustedProxies = c.TRUSTED_PROXIES.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (c.NODE_ENV === "production") {
    const missing = [
      c.RESEND_API_KEY === null ? "RESEND_API_KEY" : null,
      trustedProxies.length === 0 ? "TRUSTED_PROXIES" : null,
    ].filter((name) => name !== null);
    if (missing.length > 0) {
      throw new Error(
        `Invalid configuration:\n  ${missing.map((n) => `${n}: required in production`).join("\n  ")}`,
      );
    }
  }
  return {
    environment: c.NODE_ENV,
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    encryptionKey: Buffer.from(c.ENCRYPTION_KEY, "hex"),
    frontendOrigin: c.FRONTEND_ORIGIN,
    appUrl: c.APP_URL,
    auth: { secret: c.BETTER_AUTH_SECRET, trustedProxies },
    email: { resendApiKey: c.RESEND_API_KEY, from: c.EMAIL_FROM, outboxDir: c.EMAIL_OUTBOX_DIR },
    mikrotik: { apiPort: c.MIKROTIK_API_PORT, connectTimeoutSeconds: c.MIKROTIK_CONNECT_TIMEOUT },
    routerManagementUrl: c.ROUTER_MANAGEMENT_URL,
    portalOrigin: c.PORTAL_ORIGIN,
    jobsEnabled: c.JOBS_ENABLED === "true",
    telemetry: {
      sentryDsn: c.SENTRY_DSN,
      release: c.SENTRY_RELEASE,
      tracesSampleRate: c.SENTRY_TRACES_SAMPLE_RATE,
    },
  };
}
