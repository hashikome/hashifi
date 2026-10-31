import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Sends one text to one number. Resolves once accepted; delivery is reported separately. */
export interface SmsSender {
  send(message: { to: string; text: string }): Promise<{ jobId: string | null }>;
}

export const SMS_SENDER = Symbol("SMS_SENDER");

/** BRIQ's Karibu API. No SDK: one request, with a timeout. */
export class BriqSmsSender implements SmsSender {
  constructor(
    private readonly apiKey: string,
    private readonly appId: string,
    private readonly senderId: string,
    private readonly baseUrl = "https://karibu.briq.tz",
  ) {}

  async send(message: { to: string; text: string }) {
    const response = await fetch(`${this.baseUrl}/v1/message/send-instant`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        // Without the app, delivery reports do not reach our webhook.
        "X-App-ID": this.appId,
      },
      body: JSON.stringify({
        content: message.text,
        recipients: [message.to],
        sender_id: this.senderId,
      }),
    });
    const body = (await response.json()) as { success?: boolean; job_id?: string };
    if (!response.ok || body.success !== true) {
      throw new Error(`The SMS was refused (HTTP ${response.status})`);
    }
    return { jobId: body.job_id ?? null };
  }
}

/** Development and tests: one file per message under `data/sms/`, as email does. */
export class OutboxSmsSender implements SmsSender {
  constructor(private readonly dir: string) {}

  async send(message: { to: string; text: string }) {
    await mkdir(this.dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomUUID()}.txt`;
    await writeFile(join(this.dir, name), `To: ${message.to}\n\n${message.text}\n`);
    return { jobId: null };
  }
}
