import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends one email. Resolves once the provider has accepted it; rejects otherwise. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

/** Resend's HTTP API. No SDK: one request, with a timeout. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.transport("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok) throw new Error(`Resend refused the message: HTTP ${response.status}`);
  }
}

/**
 * Development without Resend: each message becomes a file in the outbox directory, so a
 * sign-in code can be read there. Never in logs, which redact codes anyway.
 */
export class OutboxEmailSender implements EmailSender {
  constructor(private readonly directory: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const name = `${new Date().toISOString().replaceAll(":", "-")}-${Bun.randomUUIDv7()}.txt`;
    const body = `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`;
    await writeFile(join(this.directory, name), body, { mode: 0o600 });
  }
}
