import { fileURLToPath } from "node:url";
import { z } from "zod";
import { intToIpv4, ipv4ToInt } from "../services/router-provision/ipv4.js";
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
  brand: {
    /** Cloudflare R2; required in production. Unset elsewhere, images go to `storeDir`. */
    r2: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null;
    storeDir: string;
  };
  mikrotik: {
    apiPort: number;
    connectTimeoutSeconds: number;
    /** Reaches every router here instead (the router sim's port forward). Never in production. */
    targetOverride: { host: string; port: number } | null;
  };
  routerManagementUrl: string | null;
  portalOrigin: string | null;
  /**
   * The platform side of the routers' management tunnel (ADR-0006), or null when routers are
   * reached on their LAN (development, the router sim's LAN mode).
   */
  tunnel: {
    /** CIDR; its first host is the platform, and `ROUTER_MANAGEMENT_URL` must use it. */
    network: string;
    platformPublicKey: string;
    endpointHost: string;
    endpointPort: number;
  } | null;
  /** Background jobs (expiry, reconciliation, router polling). Off for tooling and tests. */
  jobsEnabled: boolean;
  telemetry: {
    sentryDsn: string | null;
    release: string | null;
    tracesSampleRate: number;
  };
}

const url = z.url({ protocol: /^https?$/ });

/** `data/email/` at the repository root (git-ignored), wherever the API is started from. */
const DEFAULT_OUTBOX_DIR = fileURLToPath(new URL("../../../../data/email/", import.meta.url));
const DEFAULT_BRAND_DIR = fileURLToPath(new URL("../../../../data/brand/", import.meta.url));

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
  EMAIL_OUTBOX_DIR: z.string().min(1).default(DEFAULT_OUTBOX_DIR),
  R2_ENDPOINT: url.nullable().default(null),
  R2_BUCKET: z.string().min(1).nullable().default(null),
  R2_ACCESS_KEY_ID: z.string().min(1).nullable().default(null),
  R2_SECRET_ACCESS_KEY: z.string().min(1).nullable().default(null),
  BRAND_STORE_DIR: z.string().min(1).default(DEFAULT_BRAND_DIR),
  MIKROTIK_API_PORT: z.coerce.number().int().min(1).max(65535).default(8728),
  MIKROTIK_CONNECT_TIMEOUT: z.coerce.number().int().min(1).max(120).default(10),
  MIKROTIK_TARGET_OVERRIDE: z
    .string()
    .regex(/^[A-Za-z0-9.-]+:\d{1,5}$/, "must be host:port")
    .nullable()
    .default(null),
  ROUTER_MANAGEMENT_URL: url.nullable().default(null),
  PORTAL_ORIGIN: url.nullable().default(null),
  TUNNEL_NETWORK: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,3}){3}\/(?:[89]|1\d|2[0-9])$/, "must be an IPv4 CIDR from /8 to /29")
    .nullable()
    .default(null),
  TUNNEL_PLATFORM_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, "must be a WireGuard public key")
    .nullable()
    .default(null),
  TUNNEL_ENDPOINT: z
    .string()
    .regex(/^[A-Za-z0-9.-]+:\d{1,5}$/, "must be host:port")
    .nullable()
    .default(null),
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
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
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
      c.R2_ENDPOINT === null ? "R2_ENDPOINT" : null,
      c.R2_BUCKET === null ? "R2_BUCKET" : null,
      c.R2_ACCESS_KEY_ID === null ? "R2_ACCESS_KEY_ID" : null,
      c.R2_SECRET_ACCESS_KEY === null ? "R2_SECRET_ACCESS_KEY" : null,
      trustedProxies.length === 0 ? "TRUSTED_PROXIES" : null,
    ].filter((name) => name !== null);
    if (missing.length > 0) {
      throw new Error(
        `Invalid configuration:\n  ${missing.map((n) => `${n}: required in production`).join("\n  ")}`,
      );
    }
  }
  const tunnel = tunnelSettings(c);
  const targetOverride = targetOverrideOf(c);
  return {
    environment: c.NODE_ENV,
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    encryptionKey: Buffer.from(c.ENCRYPTION_KEY, "hex"),
    frontendOrigin: c.FRONTEND_ORIGIN,
    appUrl: c.APP_URL,
    auth: { secret: c.BETTER_AUTH_SECRET, trustedProxies },
    email: { resendApiKey: c.RESEND_API_KEY, from: c.EMAIL_FROM, outboxDir: c.EMAIL_OUTBOX_DIR },
    brand: {
      r2:
        c.R2_ENDPOINT !== null &&
        c.R2_BUCKET !== null &&
        c.R2_ACCESS_KEY_ID !== null &&
        c.R2_SECRET_ACCESS_KEY !== null
          ? {
              endpoint: c.R2_ENDPOINT,
              bucket: c.R2_BUCKET,
              accessKeyId: c.R2_ACCESS_KEY_ID,
              secretAccessKey: c.R2_SECRET_ACCESS_KEY,
            }
          : null,
      storeDir: c.BRAND_STORE_DIR,
    },
    mikrotik: {
      apiPort: c.MIKROTIK_API_PORT,
      connectTimeoutSeconds: c.MIKROTIK_CONNECT_TIMEOUT,
      targetOverride,
    },
    routerManagementUrl: c.ROUTER_MANAGEMENT_URL,
    portalOrigin: c.PORTAL_ORIGIN,
    tunnel,
    jobsEnabled: c.JOBS_ENABLED === "true",
    telemetry: {
      sentryDsn: c.SENTRY_DSN,
      release: c.SENTRY_RELEASE,
      tracesSampleRate: c.SENTRY_TRACES_SAMPLE_RATE,
    },
  };
}

/**
 * The tunnel settings are all set or all unset. When set, routers accept the RouterOS API only
 * from the platform's tunnel address, so `ROUTER_MANAGEMENT_URL` must be that address: any
 * other value would lock provisioning out of every router.
 */
function tunnelSettings(c: z.infer<typeof schema>): AppConfig["tunnel"] {
  const values = [c.TUNNEL_NETWORK, c.TUNNEL_PLATFORM_PUBLIC_KEY, c.TUNNEL_ENDPOINT];
  if (values.every((value) => value === null)) return null;
  const network = c.TUNNEL_NETWORK;
  const key = c.TUNNEL_PLATFORM_PUBLIC_KEY;
  const endpoint = c.TUNNEL_ENDPOINT;
  if (network === null || key === null || endpoint === null) {
    throw new Error(
      "Invalid configuration:\n  TUNNEL_NETWORK, TUNNEL_PLATFORM_PUBLIC_KEY and TUNNEL_ENDPOINT are set together or not at all",
    );
  }
  const [address = "", prefix = ""] = network.split("/");
  const base = ipv4ToInt(address);
  if (base === null) throw new Error(`Invalid configuration:\n  TUNNEL_NETWORK: ${network}`);
  const bits = Number(prefix);
  const platform = intToIpv4(((base & ((0xffffffff << (32 - bits)) >>> 0)) >>> 0) + 1);
  const managementHost =
    c.ROUTER_MANAGEMENT_URL === null ? null : new URL(c.ROUTER_MANAGEMENT_URL).hostname;
  if (managementHost !== platform) {
    throw new Error(
      `Invalid configuration:\n  ROUTER_MANAGEMENT_URL: must use the platform's tunnel address ${platform} when the tunnel is configured`,
    );
  }
  const at = endpoint.lastIndexOf(":");
  const endpointPort = Number(endpoint.slice(at + 1));
  if (endpointPort < 1 || endpointPort > 65535) {
    throw new Error("Invalid configuration:\n  TUNNEL_ENDPOINT: port out of range");
  }
  return { network, platformPublicKey: key, endpointHost: endpoint.slice(0, at), endpointPort };
}

/** Development only: a production router must never be reached anywhere but its own address. */
function targetOverrideOf(c: z.infer<typeof schema>): AppConfig["mikrotik"]["targetOverride"] {
  const value = c.MIKROTIK_TARGET_OVERRIDE;
  if (value === null) return null;
  if (c.NODE_ENV === "production") {
    throw new Error(
      "Invalid configuration:\n  MIKROTIK_TARGET_OVERRIDE: not allowed in production",
    );
  }
  const at = value.lastIndexOf(":");
  return { host: value.slice(0, at), port: Number(value.slice(at + 1)) };
}
