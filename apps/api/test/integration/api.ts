import { afterAll, beforeAll } from "bun:test";
import { createHmac } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadConfig } from "../../src/config/config.js";
import type { EmailMessage, EmailSender } from "../../src/email/email-sender.js";
import { bootstrap } from "../../src/main.js";
import { TEST_DATABASE_URL } from "./harness.js";

export const FRONTEND_ORIGIN = "http://localhost:4000";

/** Keeps every message instead of sending it. */
export class CapturingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** The newest sign-in code sent to `to`, waiting briefly: codes are sent in the background. */
  async codeFor(to: string, after = 0): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const found =
        this.sent
          .slice(after)
          .reverse()
          .find((m) => m.to === to) ?? null;
      const code = found?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
      if (code !== null) return code;
      await Bun.sleep(20);
    }
    throw new Error(`no sign-in code reached ${to}`);
  }
}

/** The API on a free port, on the test database, for every test in the file. */
export function useApi(): { readonly url: string; readonly email: CapturingEmailSender } {
  const email = new CapturingEmailSender();
  const holder: { app: NestExpressApplication | null; url: string } = { app: null, url: "" };
  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      ENCRYPTION_KEY: "ab".repeat(32),
      BETTER_AUTH_SECRET: "cd".repeat(32),
      FRONTEND_ORIGIN,
      JOBS_ENABLED: "false",
    });
    const app = await bootstrap(config, { port: 0, email });
    holder.app = app;
    holder.url = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  });
  afterAll(async () => {
    await holder.app?.close();
  });
  return {
    get url() {
      return holder.url;
    },
    email,
  };
}

export interface Reply {
  status: number;
  body: unknown;
}

/** A browser: keeps cookies, sends the web's origin, and reports a client address. */
export class Client {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly base: () => string,
    public ip = "198.51.100.1",
  ) {}

  async request(method: string, path: string, body: unknown = null): Promise<Reply> {
    const headers: Record<string, string> = {
      Origin: FRONTEND_ORIGIN,
      "X-Forwarded-For": this.ip,
    };
    if (body !== null) headers["Content-Type"] = "application/json";
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const response = await fetch(`${this.base()}${path}`, {
      method,
      headers,
      body: body === null ? null : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    return { status: response.status, body: text === "" ? null : JSON.parse(text) };
  }

  has(cookieSuffix: string): boolean {
    return [...this.cookies.keys()].some((name) => name.endsWith(cookieSuffix));
  }
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as an authenticator app computes it. */
export function totp(otpauthUri: string, at = Date.now()): string {
  const secret = new URL(otpauthUri).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
